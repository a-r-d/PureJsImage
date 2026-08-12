import { invalidInput } from '../errors.ts'
import type {
  OperationDescriptor,
  OperationJsonValue,
  OperationValidationLimits,
  OperationValidationResult,
  ValueTypeDescriptor,
} from './descriptor.ts'
import {
  normalizeOperationDescriptor,
  normalizeValueTypeDescriptor,
  validateOperationParameters,
} from './descriptor.ts'

export interface OperationShapeRequest {
  readonly parameters: OperationJsonValue
  readonly inputs: readonly OperationJsonValue[]
}

export interface OperationLoweringRequest {
  readonly parameters: OperationJsonValue
}

export interface OperationDefinition<Lowered = unknown> {
  readonly descriptor: OperationDescriptor
  normalizeParameters(
    input: unknown,
    limits?: Readonly<OperationValidationLimits>,
  ): OperationValidationResult<OperationJsonValue>
  inferOutputShapes?(
    request: Readonly<OperationShapeRequest>,
  ): OperationValidationResult<readonly OperationJsonValue[]>
  lower?(request: Readonly<OperationLoweringRequest>): Lowered
}

export interface ValueTypeDefinition {
  readonly descriptor: ValueTypeDescriptor
  validate?(value: unknown): OperationValidationResult<OperationJsonValue>
}

export interface RegistryLimitPolicy {
  readonly maxEntries?: number
  readonly maxVersionsPerId?: number
  readonly maxSchemaNodes?: number
  readonly maxDescriptorBytes?: number
}

interface ResolvedRegistryLimits {
  readonly maxEntries: number
  readonly maxVersionsPerId: number
  readonly maxSchemaNodes: number
  readonly maxDescriptorBytes: number
}

const resolvePositiveLimit = (
  value: number | undefined,
  fallback: number,
  name: string,
): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const resolveRegistryLimits = (limits: Readonly<RegistryLimitPolicy>): ResolvedRegistryLimits =>
  Object.freeze({
    maxEntries: resolvePositiveLimit(limits.maxEntries, 1_024, 'maxEntries'),
    maxVersionsPerId: resolvePositiveLimit(limits.maxVersionsPerId, 16, 'maxVersionsPerId'),
    maxSchemaNodes: resolvePositiveLimit(limits.maxSchemaNodes, 4_096, 'maxSchemaNodes'),
    maxDescriptorBytes: resolvePositiveLimit(
      limits.maxDescriptorBytes,
      1_048_576,
      'maxDescriptorBytes',
    ),
  })

const keyOf = (id: string, version: number): string => `${id}\u0000${version}`

const jsonBytes = (value: OperationDescriptor | ValueTypeDescriptor): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength

const countSchemaNodes = (descriptor: OperationDescriptor): number => {
  const pending = [descriptor.parameters]
  let count = 0
  while (pending.length > 0) {
    const schema = pending.pop()
    if (schema === undefined) continue
    count += 1
    if (schema.type === 'array') pending.push(schema.items)
    else if (schema.type === 'object') pending.push(...Object.values(schema.properties))
  }
  return count
}

const validateDescriptorLimits = (
  descriptor: OperationDescriptor | ValueTypeDescriptor,
  limits: ResolvedRegistryLimits,
): void => {
  if (jsonBytes(descriptor) > limits.maxDescriptorBytes) {
    throw invalidInput(
      `Descriptor ${descriptor.id}@${descriptor.version} exceeds maxDescriptorBytes`,
    )
  }
  if ('parameters' in descriptor && countSchemaNodes(descriptor) > limits.maxSchemaNodes) {
    throw invalidInput(`Descriptor ${descriptor.id}@${descriptor.version} exceeds maxSchemaNodes`)
  }
}

const validateEntryCount = (
  total: number,
  versions: ReadonlyMap<string, number>,
  id: string,
  limits: ResolvedRegistryLimits,
): void => {
  if (total > limits.maxEntries) throw invalidInput('Registry exceeds maxEntries')
  const versionCount = (versions.get(id) ?? 0) + 1
  if (versionCount > limits.maxVersionsPerId) {
    throw invalidInput(`Registry id ${id} exceeds maxVersionsPerId`)
  }
}

export const createOperationDefinition = <Lowered = unknown>(options: {
  readonly descriptor: unknown
  readonly normalizeParameters?: OperationDefinition<Lowered>['normalizeParameters']
  readonly inferOutputShapes?: OperationDefinition<Lowered>['inferOutputShapes']
  readonly lower?: OperationDefinition<Lowered>['lower']
}): OperationDefinition<Lowered> => {
  const descriptor = normalizeOperationDescriptor(options.descriptor)
  const normalizeParameters =
    options.normalizeParameters ??
    ((input: unknown, limits: Readonly<OperationValidationLimits> = {}) =>
      validateOperationParameters(descriptor, input, limits))
  return Object.freeze({
    descriptor,
    normalizeParameters,
    ...(options.inferOutputShapes === undefined
      ? {}
      : { inferOutputShapes: options.inferOutputShapes }),
    ...(options.lower === undefined ? {} : { lower: options.lower }),
  })
}

export const createValueTypeDefinition = (options: {
  readonly descriptor: unknown
  readonly validate?: ValueTypeDefinition['validate']
}): ValueTypeDefinition =>
  Object.freeze({
    descriptor: normalizeValueTypeDescriptor(options.descriptor),
    ...(options.validate === undefined ? {} : { validate: options.validate }),
  })

export interface OperationRegistrySnapshot {
  readonly operations: readonly OperationDescriptor[]
}

export class OperationRegistry {
  readonly #definitions: ReadonlyMap<string, OperationDefinition>
  readonly #ordered: readonly OperationDefinition[]
  readonly capabilitySnapshot: OperationRegistrySnapshot

  constructor(
    registration: Iterable<OperationDefinition>,
    limitPolicy: Readonly<RegistryLimitPolicy> = {},
  ) {
    const limits = resolveRegistryLimits(limitPolicy)
    const definitions = new Map<string, OperationDefinition>()
    const ordered: OperationDefinition[] = []
    const versions = new Map<string, number>()
    const builtInIds = new Set<string>()
    for (const definition of registration) {
      const descriptor = normalizeOperationDescriptor(definition.descriptor)
      const key = keyOf(descriptor.id, descriptor.version)
      if (definitions.has(key)) {
        throw invalidInput(`Operation already registered: ${descriptor.id}@${descriptor.version}`)
      }
      if (
        (builtInIds.has(descriptor.id) && descriptor.builtIn !== true) ||
        (descriptor.builtIn === true &&
          versions.has(descriptor.id) &&
          !builtInIds.has(descriptor.id))
      ) {
        throw invalidInput(`Operation ${descriptor.id} cannot replace a built-in definition`)
      }
      validateEntryCount(ordered.length + 1, versions, descriptor.id, limits)
      validateDescriptorLimits(descriptor, limits)
      const normalized = Object.freeze({ ...definition, descriptor })
      definitions.set(key, normalized)
      ordered.push(normalized)
      versions.set(descriptor.id, (versions.get(descriptor.id) ?? 0) + 1)
      if (descriptor.builtIn === true) builtInIds.add(descriptor.id)
    }
    this.#definitions = definitions
    this.#ordered = Object.freeze(ordered)
    this.capabilitySnapshot = Object.freeze({
      operations: Object.freeze(ordered.map((definition) => definition.descriptor)),
    })
    Object.freeze(this)
  }

  get(id: string, version: number): OperationDefinition | undefined {
    return this.#definitions.get(keyOf(id, version))
  }

  definitions(): readonly OperationDefinition[] {
    return this.#ordered
  }
}

export interface ValueTypeRegistrySnapshot {
  readonly valueTypes: readonly ValueTypeDescriptor[]
}

export class ValueTypeRegistry {
  readonly #definitions: ReadonlyMap<string, ValueTypeDefinition>
  readonly #ordered: readonly ValueTypeDefinition[]
  readonly capabilitySnapshot: ValueTypeRegistrySnapshot

  constructor(
    registration: Iterable<ValueTypeDefinition>,
    limitPolicy: Readonly<RegistryLimitPolicy> = {},
  ) {
    const limits = resolveRegistryLimits(limitPolicy)
    const definitions = new Map<string, ValueTypeDefinition>()
    const ordered: ValueTypeDefinition[] = []
    const versions = new Map<string, number>()
    const builtInIds = new Set<string>()
    for (const definition of registration) {
      const descriptor = normalizeValueTypeDescriptor(definition.descriptor)
      const key = keyOf(descriptor.id, descriptor.version)
      if (definitions.has(key)) {
        throw invalidInput(`Value type already registered: ${descriptor.id}@${descriptor.version}`)
      }
      if (
        (builtInIds.has(descriptor.id) && descriptor.builtIn !== true) ||
        (descriptor.builtIn === true &&
          versions.has(descriptor.id) &&
          !builtInIds.has(descriptor.id))
      ) {
        throw invalidInput(`Value type ${descriptor.id} cannot replace a built-in definition`)
      }
      validateEntryCount(ordered.length + 1, versions, descriptor.id, limits)
      validateDescriptorLimits(descriptor, limits)
      const normalized = Object.freeze({ ...definition, descriptor })
      definitions.set(key, normalized)
      ordered.push(normalized)
      versions.set(descriptor.id, (versions.get(descriptor.id) ?? 0) + 1)
      if (descriptor.builtIn === true) builtInIds.add(descriptor.id)
    }
    this.#definitions = definitions
    this.#ordered = Object.freeze(ordered)
    this.capabilitySnapshot = Object.freeze({
      valueTypes: Object.freeze(ordered.map((definition) => definition.descriptor)),
    })
    Object.freeze(this)
  }

  get(id: string, version: number): ValueTypeDefinition | undefined {
    return this.#definitions.get(keyOf(id, version))
  }

  definitions(): readonly ValueTypeDefinition[] {
    return this.#ordered
  }
}

export const createOperationRegistry = (
  registration: Iterable<OperationDefinition>,
  limitPolicy: Readonly<RegistryLimitPolicy> = {},
): OperationRegistry => new OperationRegistry(registration, limitPolicy)

export const createValueTypeRegistry = (
  registration: Iterable<ValueTypeDefinition>,
  limitPolicy: Readonly<RegistryLimitPolicy> = {},
): ValueTypeRegistry => new ValueTypeRegistry(registration, limitPolicy)
