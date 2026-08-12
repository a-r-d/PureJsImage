import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { OperationDescriptor, OperationJsonObject, OperationJsonValue } from './descriptor.ts'

export type OperationProviderKind = 'reference' | 'wasm' | 'webgpu' | 'worker-rpc' | 'remote'

export interface OperationProviderDescriptor {
  readonly id: string
  readonly version: number
  readonly kind: OperationProviderKind
  readonly buildFingerprint: string
  readonly title?: string
}

export interface OperationImplementationDescriptor {
  readonly operationId: string
  readonly operationVersion: number
  readonly implementationVersion: string
  readonly bitExactConformance?: boolean
}

export interface OperationProviderRequest {
  readonly descriptor: OperationDescriptor
  readonly parameters: OperationJsonValue
  readonly inputs: readonly unknown[]
  readonly inputCharacteristics?: OperationJsonObject
  readonly signal: AbortSignal
}

export interface OperationCostEstimate {
  readonly setupMilliseconds: number
  readonly transferMilliseconds: number
  readonly computeMilliseconds: number
  readonly readbackMilliseconds: number
  readonly retainedBytes: number
  readonly confidence: number
}

export interface OperationOwnedOutput {
  readonly value: unknown
  release(): void | Promise<void>
}

export interface OperationImplementation {
  readonly descriptor: OperationImplementationDescriptor
  supports(request: Readonly<OperationProviderRequest>): boolean
  estimate(request: Readonly<OperationProviderRequest>): OperationCostEstimate
  execute(request: Readonly<OperationProviderRequest>): Promise<readonly OperationOwnedOutput[]>
}

export interface PreparedOperationProvider {
  readonly descriptor: OperationProviderDescriptor
  readonly implementations: readonly OperationImplementation[]
}

export interface OperationProvider {
  readonly descriptor: OperationProviderDescriptor
  prepare(signal?: AbortSignal): Promise<PreparedOperationProvider | undefined>
}

export type OperationProviderPolicy =
  | { readonly mode: 'reference-only' }
  | {
      readonly mode: 'automatic'
      readonly allowedProviderIds?: readonly string[]
      readonly allowedProviderKinds?: readonly OperationProviderKind[]
    }
  | {
      readonly mode: 'pinned'
      readonly providerId: string
      readonly providerVersion: number
      readonly buildFingerprint?: string
    }

export interface OperationProviderProvenance {
  readonly provider: OperationProviderDescriptor
  readonly implementation: OperationImplementationDescriptor
  readonly reproducibility: OperationDescriptor['reproducibility']
  readonly estimate: OperationCostEstimate
}

export interface OperationExecutionResult {
  readonly outputs: readonly OperationOwnedOutput[]
  readonly provenance: OperationProviderProvenance
  release(): Promise<void>
}

const isPositiveVersion = (value: number): boolean => Number.isSafeInteger(value) && value > 0

export const normalizeOperationProviderDescriptor = (
  descriptor: OperationProviderDescriptor,
): OperationProviderDescriptor => {
  if (
    typeof descriptor.id !== 'string' ||
    descriptor.id.trim().length === 0 ||
    (descriptor.kind !== 'reference' &&
      descriptor.kind !== 'wasm' &&
      descriptor.kind !== 'webgpu' &&
      descriptor.kind !== 'worker-rpc' &&
      descriptor.kind !== 'remote') ||
    typeof descriptor.buildFingerprint !== 'string' ||
    descriptor.buildFingerprint.trim().length === 0 ||
    !isPositiveVersion(descriptor.version) ||
    (descriptor.title !== undefined &&
      (typeof descriptor.title !== 'string' || descriptor.title.trim().length === 0))
  ) {
    throw invalidInput('Operation provider descriptor is invalid')
  }
  return Object.freeze({
    id: descriptor.id,
    version: descriptor.version,
    kind: descriptor.kind,
    buildFingerprint: descriptor.buildFingerprint,
    ...(descriptor.title === undefined ? {} : { title: descriptor.title }),
  })
}

const freezeImplementationDescriptor = (
  descriptor: OperationImplementationDescriptor,
): OperationImplementationDescriptor => {
  if (
    typeof descriptor.operationId !== 'string' ||
    descriptor.operationId.trim().length === 0 ||
    typeof descriptor.implementationVersion !== 'string' ||
    descriptor.implementationVersion.trim().length === 0 ||
    !isPositiveVersion(descriptor.operationVersion) ||
    (descriptor.bitExactConformance !== undefined &&
      typeof descriptor.bitExactConformance !== 'boolean')
  ) {
    throw invalidInput('Operation implementation descriptor is invalid')
  }
  return Object.freeze({
    operationId: descriptor.operationId,
    operationVersion: descriptor.operationVersion,
    implementationVersion: descriptor.implementationVersion,
    ...(descriptor.bitExactConformance === undefined
      ? {}
      : { bitExactConformance: descriptor.bitExactConformance }),
  })
}

export const createOperationProvider = (options: {
  readonly descriptor: OperationProviderDescriptor
  prepare(signal?: AbortSignal): Promise<readonly OperationImplementation[] | undefined>
}): OperationProvider => {
  const descriptor = normalizeOperationProviderDescriptor(options.descriptor)
  return Object.freeze({
    descriptor,
    async prepare(signal?: AbortSignal): Promise<PreparedOperationProvider | undefined> {
      signal?.throwIfAborted()
      const implementations = await options.prepare(signal)
      signal?.throwIfAborted()
      if (implementations === undefined) return undefined
      const keys = new Set<string>()
      const normalized = implementations.map((implementation) => {
        const implementationDescriptor = freezeImplementationDescriptor(implementation.descriptor)
        const key = `${implementationDescriptor.operationId}\u0000${implementationDescriptor.operationVersion}`
        if (keys.has(key)) {
          throw invalidInput(
            `Provider ${descriptor.id} repeats implementation ${implementationDescriptor.operationId}@${implementationDescriptor.operationVersion}`,
          )
        }
        keys.add(key)
        return Object.freeze({ ...implementation, descriptor: implementationDescriptor })
      })
      return Object.freeze({ descriptor, implementations: Object.freeze(normalized) })
    },
  })
}

export interface OperationProviderSelection {
  readonly provider: PreparedOperationProvider
  readonly implementation: OperationImplementation
  readonly estimate: OperationCostEstimate
}

const validateEstimate = (estimate: OperationCostEstimate): OperationCostEstimate => {
  const times = [
    estimate.setupMilliseconds,
    estimate.transferMilliseconds,
    estimate.computeMilliseconds,
    estimate.readbackMilliseconds,
  ]
  if (
    times.some((value) => !Number.isFinite(value) || value < 0) ||
    !Number.isSafeInteger(estimate.retainedBytes) ||
    estimate.retainedBytes < 0 ||
    !Number.isFinite(estimate.confidence) ||
    estimate.confidence < 0 ||
    estimate.confidence > 1
  ) {
    throw invalidInput('Operation provider returned an invalid cost estimate')
  }
  return Object.freeze({ ...estimate })
}

const elapsedCost = (estimate: OperationCostEstimate): number =>
  estimate.setupMilliseconds +
  estimate.transferMilliseconds +
  estimate.computeMilliseconds +
  estimate.readbackMilliseconds

const confidenceAdjustedCost = (estimate: OperationCostEstimate): number =>
  elapsedCost(estimate) / Math.max(estimate.confidence, 0.05)

const compareCandidates = (
  left: OperationProviderSelection,
  right: OperationProviderSelection,
): number => {
  const elapsed = confidenceAdjustedCost(left.estimate) - confidenceAdjustedCost(right.estimate)
  if (elapsed !== 0) return elapsed
  const retained = left.estimate.retainedBytes - right.estimate.retainedBytes
  if (retained !== 0) return retained
  const confidence = right.estimate.confidence - left.estimate.confidence
  if (confidence !== 0) return confidence
  const provider = left.provider.descriptor.id.localeCompare(right.provider.descriptor.id)
  if (provider !== 0) return provider
  const version = left.provider.descriptor.version - right.provider.descriptor.version
  if (version !== 0) return version
  return left.implementation.descriptor.implementationVersion.localeCompare(
    right.implementation.descriptor.implementationVersion,
  )
}

const matchesPolicy = (
  descriptor: OperationProviderDescriptor,
  policy: OperationProviderPolicy,
): boolean => {
  if (policy.mode === 'reference-only') return descriptor.kind === 'reference'
  if (policy.mode === 'pinned') {
    return (
      descriptor.id === policy.providerId &&
      descriptor.version === policy.providerVersion &&
      (policy.buildFingerprint === undefined ||
        descriptor.buildFingerprint === policy.buildFingerprint)
    )
  }
  return (
    (policy.allowedProviderIds === undefined ||
      policy.allowedProviderIds.includes(descriptor.id)) &&
    (policy.allowedProviderKinds === undefined ||
      policy.allowedProviderKinds.includes(descriptor.kind))
  )
}

const releaseOutputs = async (outputs: readonly OperationOwnedOutput[]): Promise<void> => {
  let firstError: unknown
  for (const output of outputs) {
    try {
      await output.release()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
}

export interface OperationRuntimeSnapshot {
  readonly providers: readonly OperationProviderDescriptor[]
}

export class OperationRuntime {
  readonly #providers: readonly PreparedOperationProvider[]
  readonly capabilitySnapshot: OperationRuntimeSnapshot

  constructor(providers: Iterable<PreparedOperationProvider>) {
    const providerKeys = new Set<string>()
    const normalized: PreparedOperationProvider[] = []
    for (const provider of providers) {
      const descriptor = normalizeOperationProviderDescriptor(provider.descriptor)
      const key = `${descriptor.id}\u0000${descriptor.version}`
      if (providerKeys.has(key)) {
        throw invalidInput(
          `Operation provider already prepared: ${descriptor.id}@${descriptor.version}`,
        )
      }
      providerKeys.add(key)
      const implementationKeys = new Set<string>()
      const implementations = provider.implementations.map((implementation) => {
        const implementationDescriptor = freezeImplementationDescriptor(implementation.descriptor)
        const implementationKey = `${implementationDescriptor.operationId}\u0000${implementationDescriptor.operationVersion}`
        if (implementationKeys.has(implementationKey)) {
          throw invalidInput(
            `Provider ${descriptor.id} repeats implementation ${implementationDescriptor.operationId}@${implementationDescriptor.operationVersion}`,
          )
        }
        implementationKeys.add(implementationKey)
        return Object.freeze({ ...implementation, descriptor: implementationDescriptor })
      })
      normalized.push(
        Object.freeze({
          descriptor,
          implementations: Object.freeze(implementations),
        }),
      )
    }
    this.#providers = Object.freeze(normalized)
    this.capabilitySnapshot = Object.freeze({
      providers: Object.freeze(normalized.map((provider) => provider.descriptor)),
    })
    Object.freeze(this)
  }

  select(
    request: Readonly<OperationProviderRequest>,
    policy: OperationProviderPolicy = { mode: 'automatic' },
  ): OperationProviderSelection {
    request.signal.throwIfAborted()
    if (
      request.descriptor.reproducibility.class === 'provider-pinned' &&
      policy.mode !== 'pinned'
    ) {
      throw unsupportedOperation(
        'Provider-pinned operation requires an exact pinned provider policy',
      )
    }
    const candidates: OperationProviderSelection[] = []
    for (const provider of this.#providers) {
      if (!matchesPolicy(provider.descriptor, policy)) continue
      for (const implementation of provider.implementations) {
        if (
          implementation.descriptor.operationId !== request.descriptor.id ||
          implementation.descriptor.operationVersion !== request.descriptor.version
        ) {
          continue
        }
        if (
          request.descriptor.reproducibility.class === 'bit-exact' &&
          implementation.descriptor.bitExactConformance !== true
        ) {
          continue
        }
        if (!implementation.supports(request)) continue
        candidates.push({
          provider,
          implementation,
          estimate: validateEstimate(implementation.estimate(request)),
        })
      }
    }
    candidates.sort(compareCandidates)
    const selected = candidates[0]
    if (selected !== undefined) return selected
    if (
      policy.mode === 'pinned' ||
      request.descriptor.reproducibility.class === 'provider-pinned'
    ) {
      throw unsupportedOperation('Pinned operation provider is unavailable or declined the request')
    }
    throw unsupportedOperation(
      `No operation provider supports ${request.descriptor.id}@${request.descriptor.version}`,
    )
  }

  async execute(
    request: Readonly<OperationProviderRequest>,
    policy: OperationProviderPolicy = { mode: 'automatic' },
  ): Promise<OperationExecutionResult> {
    const selected = this.select(request, policy)
    const outputs = await selected.implementation.execute(request)
    try {
      request.signal.throwIfAborted()
      const frozenOutputs = Object.freeze([...outputs])
      let released = false
      return Object.freeze({
        outputs: frozenOutputs,
        provenance: Object.freeze({
          provider: selected.provider.descriptor,
          implementation: selected.implementation.descriptor,
          reproducibility: request.descriptor.reproducibility,
          estimate: selected.estimate,
        }),
        async release(): Promise<void> {
          if (released) return
          released = true
          await releaseOutputs(frozenOutputs)
        },
      })
    } catch (error) {
      await releaseOutputs(outputs)
      throw error
    }
  }
}

export const prepareOperationRuntime = async (
  providers: Iterable<OperationProvider>,
  signal?: AbortSignal,
): Promise<OperationRuntime> => {
  const prepared: PreparedOperationProvider[] = []
  for (const provider of providers) {
    signal?.throwIfAborted()
    const declared = normalizeOperationProviderDescriptor(provider.descriptor)
    const available = await provider.prepare(signal)
    if (available === undefined) continue
    const actual = normalizeOperationProviderDescriptor(available.descriptor)
    if (
      declared.id !== actual.id ||
      declared.version !== actual.version ||
      declared.kind !== actual.kind ||
      declared.buildFingerprint !== actual.buildFingerprint ||
      declared.title !== actual.title
    ) {
      throw invalidInput(`Provider ${declared.id} changed identity during preparation`)
    }
    prepared.push(available)
  }
  return new OperationRuntime(prepared)
}
