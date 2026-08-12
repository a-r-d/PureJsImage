import { invalidInput } from '../errors.ts'

export type OperationJsonPrimitive = null | boolean | number | string
export type OperationJsonValue =
  | OperationJsonPrimitive
  | readonly OperationJsonValue[]
  | OperationJsonObject
export interface OperationJsonObject {
  readonly [key: string]: OperationJsonValue
}

export interface OperationValidationIssue {
  readonly code:
    | 'duplicate'
    | 'invalid-default'
    | 'invalid-id'
    | 'invalid-type'
    | 'invalid-value'
    | 'limit-exceeded'
    | 'missing-required'
    | 'non-finite'
    | 'out-of-range'
    | 'unknown-field'
  readonly path: string
  readonly message: string
}

export interface OperationValidationResult<Value> {
  readonly valid: boolean
  readonly issues: readonly OperationValidationIssue[]
  readonly value?: Value
}

export interface OperationValidationLimits {
  readonly maxDepth?: number
  readonly maxObjectKeys?: number
  readonly maxArrayLength?: number
  readonly maxInspectedValues?: number
  readonly maxIssues?: number
}

export interface ResolvedOperationValidationLimits {
  readonly maxDepth: number
  readonly maxObjectKeys: number
  readonly maxArrayLength: number
  readonly maxInspectedValues: number
  readonly maxIssues: number
}

export const defaultOperationValidationLimits: ResolvedOperationValidationLimits = Object.freeze({
  maxDepth: 32,
  maxObjectKeys: 1_024,
  maxArrayLength: 16_384,
  maxInspectedValues: 100_000,
  maxIssues: 256,
})

const positiveLimit = (value: number | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

export const resolveOperationValidationLimits = (
  limits: Readonly<OperationValidationLimits> = {},
): ResolvedOperationValidationLimits =>
  Object.freeze({
    maxDepth: positiveLimit(limits.maxDepth, defaultOperationValidationLimits.maxDepth, 'maxDepth'),
    maxObjectKeys: positiveLimit(
      limits.maxObjectKeys,
      defaultOperationValidationLimits.maxObjectKeys,
      'maxObjectKeys',
    ),
    maxArrayLength: positiveLimit(
      limits.maxArrayLength,
      defaultOperationValidationLimits.maxArrayLength,
      'maxArrayLength',
    ),
    maxInspectedValues: positiveLimit(
      limits.maxInspectedValues,
      defaultOperationValidationLimits.maxInspectedValues,
      'maxInspectedValues',
    ),
    maxIssues: positiveLimit(
      limits.maxIssues,
      defaultOperationValidationLimits.maxIssues,
      'maxIssues',
    ),
  })

export interface ValueTypeDescriptor {
  readonly id: string
  readonly version: number
  readonly title: string
  readonly description?: string
  readonly capabilities?: OperationJsonObject
  readonly builtIn?: boolean
}

export interface OperationValueTypeReference {
  readonly id: string
  readonly version?: number
}

export interface OperationPortDescriptor {
  readonly name: string
  readonly valueType: OperationValueTypeReference
  readonly title?: string
  readonly description?: string
  readonly constraints?: OperationJsonObject
  readonly optional?: boolean
  readonly variadic?: boolean
}

interface ParameterSchemaBase {
  readonly title?: string
  readonly description?: string
  readonly default?: OperationJsonValue
}

export interface NumberParameterSchema extends ParameterSchemaBase {
  readonly type: 'number'
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: boolean
  readonly exclusiveMaximum?: boolean
  readonly finiteOnly?: boolean
}

export interface IntegerParameterSchema extends ParameterSchemaBase {
  readonly type: 'integer'
  readonly minimum?: number
  readonly maximum?: number
}

export interface BooleanParameterSchema extends ParameterSchemaBase {
  readonly type: 'boolean'
}

export interface StringParameterSchema extends ParameterSchemaBase {
  readonly type: 'string'
  readonly minLength?: number
  readonly maxLength?: number
}

export interface EnumParameterSchema extends ParameterSchemaBase {
  readonly type: 'enum'
  readonly values: readonly OperationJsonPrimitive[]
}

export interface ObjectParameterSchema extends ParameterSchemaBase {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, ParameterSchema>>
  readonly required?: readonly string[]
  readonly closed?: boolean
}

export interface ArrayParameterSchema extends ParameterSchemaBase {
  readonly type: 'array'
  readonly items: ParameterSchema
  readonly minItems?: number
  readonly maxItems: number
}

export type ParameterSchema =
  | NumberParameterSchema
  | IntegerParameterSchema
  | BooleanParameterSchema
  | StringParameterSchema
  | EnumParameterSchema
  | ObjectParameterSchema
  | ArrayParameterSchema

export type OperationExecutionCharacteristic =
  | 'metadata-only'
  | 'tile-local'
  | 'neighborhood'
  | 'reduction'
  | 'dataset-transform'

export type OperationReproducibility =
  | { readonly class: 'bit-exact' }
  | { readonly class: 'backend-stable' }
  | { readonly class: 'tolerance-based'; readonly absolute: number; readonly relative: number }
  | { readonly class: 'provider-pinned' }

export interface OperationDeprecation {
  readonly message: string
  readonly replacementId?: string
  readonly replacementVersion?: number
}

export interface OperationDescriptor {
  readonly id: string
  readonly version: number
  readonly title: string
  readonly description?: string
  readonly category: string
  readonly tags: readonly string[]
  readonly inputs: readonly OperationPortDescriptor[]
  readonly outputs: readonly OperationPortDescriptor[]
  readonly parameters: ParameterSchema
  readonly execution: OperationExecutionCharacteristic
  readonly reproducibility: OperationReproducibility
  readonly deprecation?: OperationDeprecation
  readonly builtIn?: boolean
}

type UnknownRecord = { readonly [key: string]: unknown }

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const pointer = (path: string, key: string | number): string => {
  const encoded = String(key).replaceAll('~', '~0').replaceAll('/', '~1')
  return `${path}/${encoded}`
}

class ValidationContext {
  readonly limits: ResolvedOperationValidationLimits
  readonly issues: OperationValidationIssue[] = []
  inspected = 0
  limitReported = false

  constructor(limits: Readonly<OperationValidationLimits>) {
    this.limits = resolveOperationValidationLimits(limits)
  }

  inspect(path: string): boolean {
    this.inspected += 1
    if (this.inspected <= this.limits.maxInspectedValues) return true
    if (!this.limitReported) {
      this.limitReported = true
      this.issue('limit-exceeded', path, 'Validation inspected too many values')
    }
    return false
  }

  issue(code: OperationValidationIssue['code'], path: string, message: string): void {
    if (this.issues.length >= this.limits.maxIssues) return
    this.issues.push(Object.freeze({ code, path, message }))
  }
}

const plainRecord = (
  value: unknown,
  path: string,
  context: ValidationContext,
): UnknownRecord | undefined => {
  if (!isRecord(value)) {
    context.issue('invalid-type', path, 'Expected an object')
    return undefined
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    context.issue('invalid-type', path, 'Expected a plain object')
    return undefined
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    context.issue('invalid-value', path, 'Symbol keys are not JSON-safe')
  }
  const keys = Object.keys(value)
  if (keys.length > context.limits.maxObjectKeys) {
    context.issue('limit-exceeded', path, 'Object contains too many keys')
    return undefined
  }
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (property === undefined || !('value' in property)) {
      context.issue('invalid-type', pointer(path, key), 'Expected a JSON data property')
      return undefined
    }
  }
  return value
}

const unknownFields = (
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
  context: ValidationContext,
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      context.issue('unknown-field', pointer(path, key), `Unknown field ${key}`)
    }
  }
}

const stringValue = (
  value: unknown,
  path: string,
  context: ValidationContext,
  required = true,
): string | undefined => {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    context.issue('invalid-type', path, 'Expected a non-empty string')
    return undefined
  }
  return value
}

const booleanValue = (
  value: unknown,
  path: string,
  context: ValidationContext,
): boolean | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    context.issue('invalid-type', path, 'Expected a boolean')
    return undefined
  }
  return value
}

const nonNegativeInteger = (
  value: unknown,
  path: string,
  context: ValidationContext,
): number | undefined => {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0) {
    context.issue('invalid-value', path, 'Expected a non-negative safe integer')
    return undefined
  }
  return value
}

const positiveVersion = (
  value: unknown,
  path: string,
  context: ValidationContext,
): number | undefined => {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) {
    context.issue('invalid-value', path, 'Expected a positive safe integer version')
    return undefined
  }
  return value
}

const namespacedIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9-]*)+$/u
const portNamePattern = /^[a-z][a-zA-Z0-9]*$/u

export const isNamespacedOperationId = (value: string): boolean => namespacedIdPattern.test(value)

const namespacedId = (
  value: unknown,
  path: string,
  context: ValidationContext,
): string | undefined => {
  const id = stringValue(value, path, context)
  if (id !== undefined && !namespacedIdPattern.test(id)) {
    context.issue('invalid-id', path, 'Expected a lowercase namespaced identifier')
    return undefined
  }
  return id
}

const cloneJson = (
  value: unknown,
  path: string,
  context: ValidationContext,
  depth: number,
): OperationJsonValue | undefined => {
  if (!context.inspect(path)) return undefined
  if (depth > context.limits.maxDepth) {
    context.issue('limit-exceeded', path, 'JSON value exceeds the nesting limit')
    return undefined
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      context.issue('non-finite', path, 'JSON numbers must be finite')
      return undefined
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > context.limits.maxArrayLength) {
      context.issue('limit-exceeded', path, 'Array exceeds the validation length limit')
      return undefined
    }
    const output: OperationJsonValue[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        context.issue('invalid-value', pointer(path, index), 'JSON arrays must not contain holes')
        continue
      }
      const entry = cloneJson(value[index], pointer(path, index), context, depth + 1)
      if (entry !== undefined) output.push(entry)
    }
    return Object.freeze(output)
  }
  const record = plainRecord(value, path, context)
  if (record === undefined) {
    if (
      typeof value === 'undefined' ||
      typeof value === 'function' ||
      typeof value === 'symbol' ||
      typeof value === 'bigint'
    ) {
      context.issue('invalid-type', path, 'Value is not JSON-safe')
    }
    return undefined
  }
  const output: { [key: string]: OperationJsonValue } = {}
  for (const key of Object.keys(record)) {
    const entry = cloneJson(record[key], pointer(path, key), context, depth + 1)
    if (entry !== undefined) output[key] = entry
  }
  return Object.freeze(output)
}

const optionalJsonObject = (
  value: unknown,
  path: string,
  context: ValidationContext,
): OperationJsonObject | undefined => {
  if (value === undefined) return undefined
  const cloned = cloneJson(value, path, context, 0)
  return isRecord(cloned) ? cloned : undefined
}

export const validateOperationJsonObject = (
  input: unknown,
  limits: Readonly<OperationValidationLimits> = {},
): OperationValidationResult<OperationJsonObject> => {
  const context = new ValidationContext(limits)
  const value = optionalJsonObject(input, '', context)
  return finish(context, value)
}

export const normalizeOperationJsonObject = (
  input: unknown,
  limits: Readonly<OperationValidationLimits> = {},
): OperationJsonObject => {
  const result = validateOperationJsonObject(input, limits)
  if (result.value !== undefined) return result.value
  throw invalidInput(result.issues[0]?.message ?? 'Invalid JSON object')
}

const parseValueTypeReference = (
  value: unknown,
  path: string,
  context: ValidationContext,
): OperationValueTypeReference | undefined => {
  const record = plainRecord(value, path, context)
  if (record === undefined) return undefined
  unknownFields(record, ['id', 'version'], path, context)
  const id = namespacedId(record.id, pointer(path, 'id'), context)
  const version =
    record.version === undefined
      ? undefined
      : positiveVersion(record.version, pointer(path, 'version'), context)
  if (id === undefined) return undefined
  return Object.freeze({ id, ...(version === undefined ? {} : { version }) })
}

const parsePort = (
  value: unknown,
  path: string,
  context: ValidationContext,
): OperationPortDescriptor | undefined => {
  const record = plainRecord(value, path, context)
  if (record === undefined) return undefined
  unknownFields(
    record,
    ['name', 'valueType', 'title', 'description', 'constraints', 'optional', 'variadic'],
    path,
    context,
  )
  const name = stringValue(record.name, pointer(path, 'name'), context)
  if (name !== undefined && !portNamePattern.test(name)) {
    context.issue('invalid-id', pointer(path, 'name'), 'Port name must be stable lower camel case')
  }
  const valueType = parseValueTypeReference(record.valueType, pointer(path, 'valueType'), context)
  const title = stringValue(record.title, pointer(path, 'title'), context, false)
  const description = stringValue(record.description, pointer(path, 'description'), context, false)
  const constraints = optionalJsonObject(record.constraints, pointer(path, 'constraints'), context)
  const optional = booleanValue(record.optional, pointer(path, 'optional'), context)
  const variadic = booleanValue(record.variadic, pointer(path, 'variadic'), context)
  if (name === undefined || !portNamePattern.test(name) || valueType === undefined) return undefined
  return Object.freeze({
    name,
    valueType,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(constraints === undefined ? {} : { constraints }),
    ...(optional === true ? { optional: true } : {}),
    ...(variadic === true ? { variadic: true } : {}),
  })
}

const schemaFields: Readonly<Record<ParameterSchema['type'], readonly string[]>> = {
  number: [
    'type',
    'title',
    'description',
    'default',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'finiteOnly',
  ],
  integer: ['type', 'title', 'description', 'default', 'minimum', 'maximum'],
  boolean: ['type', 'title', 'description', 'default'],
  string: ['type', 'title', 'description', 'default', 'minLength', 'maxLength'],
  enum: ['type', 'title', 'description', 'default', 'values'],
  object: ['type', 'title', 'description', 'default', 'properties', 'required', 'closed'],
  array: ['type', 'title', 'description', 'default', 'items', 'minItems', 'maxItems'],
}

const finiteOptional = (
  value: unknown,
  path: string,
  context: ValidationContext,
): number | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    context.issue('non-finite', path, 'Expected a finite number')
    return undefined
  }
  return value
}

const parseSchema = (
  value: unknown,
  path: string,
  context: ValidationContext,
  depth: number,
): ParameterSchema | undefined => {
  if (!context.inspect(path)) return undefined
  if (depth > context.limits.maxDepth) {
    context.issue('limit-exceeded', path, 'Parameter schema exceeds the nesting limit')
    return undefined
  }
  const record = plainRecord(value, path, context)
  if (record === undefined) return undefined
  const type = record.type
  if (
    type !== 'number' &&
    type !== 'integer' &&
    type !== 'boolean' &&
    type !== 'string' &&
    type !== 'enum' &&
    type !== 'object' &&
    type !== 'array'
  ) {
    context.issue('invalid-value', pointer(path, 'type'), 'Unknown parameter schema type')
    return undefined
  }
  unknownFields(record, schemaFields[type], path, context)
  const title = stringValue(record.title, pointer(path, 'title'), context, false)
  const description = stringValue(record.description, pointer(path, 'description'), context, false)
  const base = {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
  }
  let schema: ParameterSchema | undefined
  if (type === 'number') {
    const minimum = finiteOptional(record.minimum, pointer(path, 'minimum'), context)
    const maximum = finiteOptional(record.maximum, pointer(path, 'maximum'), context)
    const exclusiveMinimum = booleanValue(
      record.exclusiveMinimum,
      pointer(path, 'exclusiveMinimum'),
      context,
    )
    const exclusiveMaximum = booleanValue(
      record.exclusiveMaximum,
      pointer(path, 'exclusiveMaximum'),
      context,
    )
    const finiteOnly = booleanValue(record.finiteOnly, pointer(path, 'finiteOnly'), context)
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      context.issue('out-of-range', path, 'Schema minimum exceeds maximum')
    }
    schema = Object.freeze({
      type,
      ...base,
      ...(minimum === undefined ? {} : { minimum }),
      ...(maximum === undefined ? {} : { maximum }),
      ...(exclusiveMinimum === true ? { exclusiveMinimum: true } : {}),
      ...(exclusiveMaximum === true ? { exclusiveMaximum: true } : {}),
      ...(finiteOnly === undefined ? {} : { finiteOnly }),
    })
  } else if (type === 'integer') {
    const minimum = finiteOptional(record.minimum, pointer(path, 'minimum'), context)
    const maximum = finiteOptional(record.maximum, pointer(path, 'maximum'), context)
    if (
      (minimum !== undefined && !Number.isSafeInteger(minimum)) ||
      (maximum !== undefined && !Number.isSafeInteger(maximum))
    ) {
      context.issue('invalid-value', path, 'Integer schema bounds must be safe integers')
    }
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      context.issue('out-of-range', path, 'Schema minimum exceeds maximum')
    }
    schema = Object.freeze({
      type,
      ...base,
      ...(minimum === undefined ? {} : { minimum }),
      ...(maximum === undefined ? {} : { maximum }),
    })
  } else if (type === 'boolean') {
    schema = Object.freeze({ type, ...base })
  } else if (type === 'string') {
    const minLength = nonNegativeInteger(record.minLength, pointer(path, 'minLength'), context)
    const maxLength = nonNegativeInteger(record.maxLength, pointer(path, 'maxLength'), context)
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
      context.issue('out-of-range', path, 'String minLength exceeds maxLength')
    }
    schema = Object.freeze({
      type,
      ...base,
      ...(minLength === undefined ? {} : { minLength }),
      ...(maxLength === undefined ? {} : { maxLength }),
    })
  } else if (type === 'enum') {
    if (!Array.isArray(record.values) || record.values.length < 1) {
      context.issue(
        'invalid-type',
        pointer(path, 'values'),
        'Enum values must be a non-empty array',
      )
    } else if (record.values.length > context.limits.maxArrayLength) {
      context.issue('limit-exceeded', pointer(path, 'values'), 'Enum contains too many values')
    } else {
      const values: OperationJsonPrimitive[] = []
      for (let index = 0; index < record.values.length; index += 1) {
        const entry = record.values[index]
        if (
          entry !== null &&
          typeof entry !== 'boolean' &&
          typeof entry !== 'string' &&
          (typeof entry !== 'number' || !Number.isFinite(entry))
        ) {
          context.issue(
            'invalid-type',
            pointer(pointer(path, 'values'), index),
            'Enum values must be JSON primitives',
          )
          continue
        }
        if (values.some((candidate) => Object.is(candidate, entry))) {
          context.issue(
            'duplicate',
            pointer(pointer(path, 'values'), index),
            'Enum value is duplicated',
          )
          continue
        }
        values.push(entry)
      }
      schema = Object.freeze({ type, ...base, values: Object.freeze(values) })
    }
  } else if (type === 'object') {
    const propertiesRecord = plainRecord(record.properties, pointer(path, 'properties'), context)
    const properties: Record<string, ParameterSchema> = {}
    if (propertiesRecord !== undefined) {
      for (const key of Object.keys(propertiesRecord)) {
        if (!portNamePattern.test(key)) {
          context.issue(
            'invalid-id',
            pointer(pointer(path, 'properties'), key),
            'Property name must be lower camel case',
          )
        }
        const child = parseSchema(
          propertiesRecord[key],
          pointer(pointer(path, 'properties'), key),
          context,
          depth + 1,
        )
        if (child !== undefined) properties[key] = child
      }
    }
    const required: string[] = []
    if (record.required !== undefined) {
      if (!Array.isArray(record.required)) {
        context.issue('invalid-type', pointer(path, 'required'), 'Required must be an array')
      } else {
        for (let index = 0; index < record.required.length; index += 1) {
          const entry = record.required[index]
          if (typeof entry !== 'string' || !(entry in properties)) {
            context.issue(
              'invalid-value',
              pointer(pointer(path, 'required'), index),
              'Required property is not declared',
            )
          } else if (required.includes(entry)) {
            context.issue(
              'duplicate',
              pointer(pointer(path, 'required'), index),
              'Required property is duplicated',
            )
          } else required.push(entry)
        }
      }
    }
    const closed = booleanValue(record.closed, pointer(path, 'closed'), context)
    schema = Object.freeze({
      type,
      ...base,
      properties: Object.freeze(properties),
      ...(required.length === 0 ? {} : { required: Object.freeze(required) }),
      ...(closed === undefined ? {} : { closed }),
    })
  } else {
    const items = parseSchema(record.items, pointer(path, 'items'), context, depth + 1)
    const minItems = nonNegativeInteger(record.minItems, pointer(path, 'minItems'), context)
    const maxItems = nonNegativeInteger(record.maxItems, pointer(path, 'maxItems'), context)
    if (maxItems === undefined || maxItems < 1) {
      context.issue(
        'missing-required',
        pointer(path, 'maxItems'),
        'Array schema requires positive maxItems',
      )
    }
    if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
      context.issue('out-of-range', path, 'Array minItems exceeds maxItems')
    }
    if (items !== undefined && maxItems !== undefined && maxItems > 0) {
      schema = Object.freeze({
        type,
        ...base,
        items,
        maxItems,
        ...(minItems === undefined ? {} : { minItems }),
      })
    }
  }
  if (schema !== undefined && record.default !== undefined) {
    const defaultContext = new ValidationContext(context.limits)
    const normalized = normalizeParameter(schema, record.default, path, defaultContext, 0, false)
    if (defaultContext.issues.length > 0 || normalized === undefined) {
      context.issue(
        'invalid-default',
        pointer(path, 'default'),
        'Default does not satisfy its schema',
      )
    } else {
      schema = Object.freeze({ ...schema, default: normalized })
    }
  }
  return schema
}

const primitiveEqual = (left: OperationJsonPrimitive, right: OperationJsonPrimitive): boolean =>
  Object.is(left, right)

const normalizeParameter = (
  schema: ParameterSchema,
  input: unknown,
  path: string,
  context: ValidationContext,
  depth: number,
  useDefault: boolean,
): OperationJsonValue | undefined => {
  if (!context.inspect(path)) return undefined
  if (depth > context.limits.maxDepth) {
    context.issue('limit-exceeded', path, 'Parameter value exceeds the nesting limit')
    return undefined
  }
  if (input === undefined && useDefault && schema.default !== undefined) return schema.default
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof input !== 'number') {
      context.issue('invalid-type', path, `Expected ${schema.type}`)
      return undefined
    }
    if (!Number.isFinite(input)) {
      context.issue('non-finite', path, 'Numeric parameter must be finite')
      return undefined
    }
    if (schema.type === 'integer' && !Number.isSafeInteger(input)) {
      context.issue('invalid-value', path, 'Integer parameter must be a safe integer')
      return undefined
    }
    if (
      schema.minimum !== undefined &&
      (schema.type === 'number' && schema.exclusiveMinimum
        ? input <= schema.minimum
        : input < schema.minimum)
    ) {
      context.issue('out-of-range', path, 'Numeric parameter is below its minimum')
    }
    if (
      schema.maximum !== undefined &&
      (schema.type === 'number' && schema.exclusiveMaximum
        ? input >= schema.maximum
        : input > schema.maximum)
    ) {
      context.issue('out-of-range', path, 'Numeric parameter exceeds its maximum')
    }
    return input
  }
  if (schema.type === 'boolean') {
    if (typeof input !== 'boolean') {
      context.issue('invalid-type', path, 'Expected boolean')
      return undefined
    }
    return input
  }
  if (schema.type === 'string') {
    if (typeof input !== 'string') {
      context.issue('invalid-type', path, 'Expected string')
      return undefined
    }
    if (schema.minLength !== undefined && input.length < schema.minLength) {
      context.issue('out-of-range', path, 'String is shorter than minLength')
    }
    if (schema.maxLength !== undefined && input.length > schema.maxLength) {
      context.issue('out-of-range', path, 'String exceeds maxLength')
    }
    return input
  }
  if (schema.type === 'enum') {
    if (
      input !== null &&
      typeof input !== 'boolean' &&
      typeof input !== 'string' &&
      (typeof input !== 'number' || !Number.isFinite(input))
    ) {
      context.issue('invalid-type', path, 'Expected an enum primitive')
      return undefined
    }
    if (!schema.values.some((value) => primitiveEqual(value, input))) {
      context.issue('invalid-value', path, 'Value is not in the enum')
    }
    return input
  }
  if (schema.type === 'array') {
    if (!Array.isArray(input)) {
      context.issue('invalid-type', path, 'Expected an array')
      return undefined
    }
    if (input.length > context.limits.maxArrayLength || input.length > schema.maxItems) {
      context.issue('limit-exceeded', path, 'Array exceeds maxItems')
      return undefined
    }
    if (schema.minItems !== undefined && input.length < schema.minItems) {
      context.issue('out-of-range', path, 'Array is shorter than minItems')
    }
    const output: OperationJsonValue[] = []
    for (let index = 0; index < input.length; index += 1) {
      if (!(index in input)) {
        context.issue(
          'invalid-value',
          pointer(path, index),
          'Parameter arrays must not contain holes',
        )
        continue
      }
      const entry = normalizeParameter(
        schema.items,
        input[index],
        pointer(path, index),
        context,
        depth + 1,
        true,
      )
      if (entry !== undefined) output.push(entry)
    }
    return Object.freeze(output)
  }
  const record = plainRecord(input, path, context)
  if (record === undefined) return undefined
  const output: { [key: string]: OperationJsonValue } = {}
  if (schema.closed !== false) {
    for (const key of Object.keys(record)) {
      if (!(key in schema.properties)) {
        context.issue('unknown-field', pointer(path, key), `Unknown parameter ${key}`)
      }
    }
  }
  for (const [key, childSchema] of Object.entries(schema.properties)) {
    if (record[key] === undefined && childSchema.default === undefined) {
      if (schema.required?.includes(key)) {
        context.issue(
          'missing-required',
          pointer(path, key),
          `Required parameter ${key} is missing`,
        )
      }
      continue
    }
    const child = normalizeParameter(
      childSchema,
      record[key],
      pointer(path, key),
      context,
      depth + 1,
      true,
    )
    if (child !== undefined) output[key] = child
    else if (schema.required?.includes(key) && record[key] === undefined) {
      context.issue('missing-required', pointer(path, key), `Required parameter ${key} is missing`)
    }
  }
  if (schema.closed === false) {
    for (const key of Object.keys(record)) {
      if (key in schema.properties) continue
      const child = cloneJson(record[key], pointer(path, key), context, depth + 1)
      if (child !== undefined) output[key] = child
    }
  }
  return Object.freeze(output)
}

const finish = <Value>(
  context: ValidationContext,
  value: Value | undefined,
): OperationValidationResult<Value> => {
  const issues = Object.freeze([...context.issues])
  return Object.freeze({
    valid: issues.length === 0 && value !== undefined,
    issues,
    ...(issues.length === 0 && value !== undefined ? { value } : {}),
  })
}

export const validateValueTypeDescriptor = (
  input: unknown,
  limits: Readonly<OperationValidationLimits> = {},
): OperationValidationResult<ValueTypeDescriptor> => {
  const context = new ValidationContext(limits)
  const record = plainRecord(input, '', context)
  if (record === undefined) return finish<ValueTypeDescriptor>(context, undefined)
  unknownFields(
    record,
    ['id', 'version', 'title', 'description', 'capabilities', 'builtIn'],
    '',
    context,
  )
  const id = namespacedId(record.id, '/id', context)
  const version = positiveVersion(record.version, '/version', context)
  const title = stringValue(record.title, '/title', context)
  const description = stringValue(record.description, '/description', context, false)
  const capabilities = optionalJsonObject(record.capabilities, '/capabilities', context)
  const builtIn = booleanValue(record.builtIn, '/builtIn', context)
  const descriptor: ValueTypeDescriptor | undefined =
    id === undefined || version === undefined || title === undefined
      ? undefined
      : Object.freeze({
          id,
          version,
          title,
          ...(description === undefined ? {} : { description }),
          ...(capabilities === undefined ? {} : { capabilities }),
          ...(builtIn === true ? { builtIn: true } : {}),
        })
  return finish(context, descriptor)
}

export const normalizeValueTypeDescriptor = (
  input: unknown,
  limits: Readonly<OperationValidationLimits> = {},
): ValueTypeDescriptor => {
  const result = validateValueTypeDescriptor(input, limits)
  if (result.value !== undefined) return result.value
  throw invalidInput(result.issues[0]?.message ?? 'Invalid value type descriptor')
}

const parsePorts = (
  value: unknown,
  path: string,
  context: ValidationContext,
): readonly OperationPortDescriptor[] => {
  if (!Array.isArray(value)) {
    context.issue('invalid-type', path, 'Ports must be an array')
    return Object.freeze([])
  }
  if (value.length > context.limits.maxArrayLength) {
    context.issue('limit-exceeded', path, 'Port array exceeds the length limit')
    return Object.freeze([])
  }
  const ports: OperationPortDescriptor[] = []
  const names = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const port = parsePort(value[index], pointer(path, index), context)
    if (port === undefined) continue
    if (names.has(port.name)) {
      context.issue(
        'duplicate',
        pointer(pointer(path, index), 'name'),
        `Duplicate port ${port.name}`,
      )
    } else {
      names.add(port.name)
      ports.push(port)
    }
  }
  return Object.freeze(ports)
}

const parseReproducibility = (
  value: unknown,
  path: string,
  context: ValidationContext,
): OperationReproducibility | undefined => {
  const record = plainRecord(value, path, context)
  if (record === undefined) return undefined
  const kind = record.class
  if (kind === 'bit-exact' || kind === 'backend-stable' || kind === 'provider-pinned') {
    unknownFields(record, ['class'], path, context)
    return Object.freeze({ class: kind })
  }
  if (kind === 'tolerance-based') {
    unknownFields(record, ['class', 'absolute', 'relative'], path, context)
    const absolute = finiteOptional(record.absolute, pointer(path, 'absolute'), context)
    const relative = finiteOptional(record.relative, pointer(path, 'relative'), context)
    if (absolute !== undefined && absolute < 0)
      context.issue('out-of-range', pointer(path, 'absolute'), 'Tolerance must be non-negative')
    if (relative !== undefined && relative < 0)
      context.issue('out-of-range', pointer(path, 'relative'), 'Tolerance must be non-negative')
    if (absolute !== undefined && relative !== undefined && absolute >= 0 && relative >= 0) {
      return Object.freeze({ class: kind, absolute, relative })
    }
    return undefined
  }
  context.issue('invalid-value', pointer(path, 'class'), 'Unknown reproducibility class')
  return undefined
}

export const validateOperationDescriptor = (
  input: unknown,
  limits: Readonly<OperationValidationLimits> = {},
): OperationValidationResult<OperationDescriptor> => {
  const context = new ValidationContext(limits)
  const record = plainRecord(input, '', context)
  if (record === undefined) return finish<OperationDescriptor>(context, undefined)
  unknownFields(
    record,
    [
      'id',
      'version',
      'title',
      'description',
      'category',
      'tags',
      'inputs',
      'outputs',
      'parameters',
      'execution',
      'reproducibility',
      'deprecation',
      'builtIn',
    ],
    '',
    context,
  )
  const id = namespacedId(record.id, '/id', context)
  const version = positiveVersion(record.version, '/version', context)
  const title = stringValue(record.title, '/title', context)
  const description = stringValue(record.description, '/description', context, false)
  const category = stringValue(record.category, '/category', context)
  const inputs = parsePorts(record.inputs, '/inputs', context)
  const outputs = parsePorts(record.outputs, '/outputs', context)
  const parameters = parseSchema(record.parameters, '/parameters', context, 0)
  const execution = record.execution
  if (
    execution !== 'metadata-only' &&
    execution !== 'tile-local' &&
    execution !== 'neighborhood' &&
    execution !== 'reduction' &&
    execution !== 'dataset-transform'
  ) {
    context.issue('invalid-value', '/execution', 'Unknown execution characteristic')
  }
  const reproducibility = parseReproducibility(record.reproducibility, '/reproducibility', context)
  const tags: string[] = []
  if (!Array.isArray(record.tags)) {
    context.issue('invalid-type', '/tags', 'Tags must be an array')
  } else if (record.tags.length > context.limits.maxArrayLength) {
    context.issue('limit-exceeded', '/tags', 'Tags exceed the array limit')
  } else {
    for (let index = 0; index < record.tags.length; index += 1) {
      const tag = stringValue(record.tags[index], pointer('/tags', index), context)
      if (tag !== undefined) {
        if (tags.includes(tag))
          context.issue('duplicate', pointer('/tags', index), `Duplicate tag ${tag}`)
        else tags.push(tag)
      }
    }
  }
  let deprecation: OperationDeprecation | undefined
  if (record.deprecation !== undefined) {
    const deprecated = plainRecord(record.deprecation, '/deprecation', context)
    if (deprecated !== undefined) {
      unknownFields(
        deprecated,
        ['message', 'replacementId', 'replacementVersion'],
        '/deprecation',
        context,
      )
      const message = stringValue(deprecated.message, '/deprecation/message', context)
      const replacementId =
        deprecated.replacementId === undefined
          ? undefined
          : namespacedId(deprecated.replacementId, '/deprecation/replacementId', context)
      const replacementVersion =
        deprecated.replacementVersion === undefined
          ? undefined
          : positiveVersion(
              deprecated.replacementVersion,
              '/deprecation/replacementVersion',
              context,
            )
      if ((replacementId === undefined) !== (replacementVersion === undefined)) {
        context.issue(
          'invalid-value',
          '/deprecation',
          'Replacement id and version must be declared together',
        )
      }
      if (message !== undefined) {
        deprecation = Object.freeze({
          message,
          ...(replacementId === undefined ? {} : { replacementId }),
          ...(replacementVersion === undefined ? {} : { replacementVersion }),
        })
      }
    }
  }
  const builtIn = booleanValue(record.builtIn, '/builtIn', context)
  const descriptor: OperationDescriptor | undefined =
    id === undefined ||
    version === undefined ||
    title === undefined ||
    category === undefined ||
    parameters === undefined ||
    reproducibility === undefined ||
    (execution !== 'metadata-only' &&
      execution !== 'tile-local' &&
      execution !== 'neighborhood' &&
      execution !== 'reduction' &&
      execution !== 'dataset-transform')
      ? undefined
      : Object.freeze({
          id,
          version,
          title,
          ...(description === undefined ? {} : { description }),
          category,
          tags: Object.freeze(tags),
          inputs,
          outputs,
          parameters,
          execution,
          reproducibility,
          ...(deprecation === undefined ? {} : { deprecation }),
          ...(builtIn === true ? { builtIn: true } : {}),
        })
  return finish(context, descriptor)
}

export const normalizeOperationDescriptor = (
  input: unknown,
  limits: Readonly<OperationValidationLimits> = {},
): OperationDescriptor => {
  const result = validateOperationDescriptor(input, limits)
  if (result.value !== undefined) return result.value
  throw invalidInput(result.issues[0]?.message ?? 'Invalid operation descriptor')
}

export const validateOperationParameters = (
  descriptor: OperationDescriptor,
  parameters: unknown,
  limits: Readonly<OperationValidationLimits> = {},
): OperationValidationResult<OperationJsonValue> => {
  const context = new ValidationContext(limits)
  const value = normalizeParameter(descriptor.parameters, parameters, '', context, 0, true)
  return finish(context, value)
}

export const coreValueTypeDescriptors: readonly ValueTypeDescriptor[] = Object.freeze(
  [
    { id: 'purejsimage.image', version: 1, title: 'Image', builtIn: true },
    { id: 'purejsimage.encoded-image', version: 1, title: 'Encoded image', builtIn: true },
    { id: 'purejsimage.dataset', version: 1, title: 'Scientific dataset', builtIn: true },
    { id: 'purejsimage.numeric-tile', version: 1, title: 'Numeric tile', builtIn: true },
  ].map((descriptor) => normalizeValueTypeDescriptor(descriptor)),
)
