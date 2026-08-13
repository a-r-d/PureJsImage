import { invalidInput } from '../errors.ts'
import type { OperationJsonObject, OperationJsonValue } from '../operations/descriptor.ts'
import {
  normalizeOperationJsonObject,
  normalizeOperationJsonValue,
} from '../operations/descriptor.ts'
import type { OperationProviderKind, OperationProviderPolicy } from '../operations/provider.ts'
import type { OperationRegistry, ValueTypeRegistry } from '../operations/registry.ts'
import type { NormalizedScientificDatasetDescriptor } from '../scientific/dataset.ts'
import type { ScientificDatasetIdentity } from '../scientific/reader.ts'
import type { SourceIdentity } from '../source-identity.ts'
import { normalizeSourceIdentity } from '../source-identity.ts'
import { canonicalJson, hashCanonicalJson } from './canonical-json.ts'
import type { AnalysisGraph, AnalysisIssue, AnalysisLimits } from './graph.ts'
import { hashAnalysisGraph, validateGraphWithValueTypes } from './graph.ts'
import type { AnalysisBindingIdentity, AnalysisSemanticIdentity } from './planner.ts'
import { computeAnalysisInvocationManifest, normalizeAnalysisSemanticIdentity } from './planner.ts'
import type { RoiLimits, RoiSet } from './roi.ts'
import {
  canonicalNormalizedRoiSemanticsJson,
  canonicalNormalizedRoiSetSemanticsJson,
  normalizeRoiSet,
  roiSetValueTypeId,
  roiValueTypeId,
} from './roi.ts'

export type PersistedBindingValue =
  | { readonly kind: 'source'; readonly sourceReference: string }
  | { readonly kind: 'roi'; readonly roiId: string }
  | { readonly kind: 'roi-set'; readonly roiIds?: readonly string[] }
  | { readonly kind: 'inline-json'; readonly value: OperationJsonValue }

export interface PersistedInputBinding {
  readonly input: string
  readonly valueType: { readonly id: string; readonly version: number }
  readonly identity: AnalysisSemanticIdentity
  readonly value: PersistedBindingValue
}

export interface PersistedSourceReference {
  readonly id: string
  readonly identity: AnalysisSemanticIdentity
  readonly locatorHint?: OperationJsonObject
}

export interface AnalysisProjectHashes {
  readonly graph: string
  readonly bindings: string
  readonly invocation: string
}

export interface AnalysisProjectV1 {
  readonly schemaVersion: 1
  readonly graph: AnalysisGraph
  readonly roiSet: RoiSet
  readonly bindings: readonly PersistedInputBinding[]
  readonly sourceReferences: readonly PersistedSourceReference[]
  readonly providerPolicy?: OperationProviderPolicy
  readonly display?: OperationJsonObject
  readonly createdWith: {
    readonly packageVersion: string
    readonly buildFingerprint: string
  }
  readonly hashes: AnalysisProjectHashes
}

export interface AnalysisProjectOptions {
  readonly operations: OperationRegistry
  readonly valueTypes: ValueTypeRegistry
  readonly roi: {
    readonly descriptor: NormalizedScientificDatasetDescriptor
    readonly limits?: Readonly<RoiLimits>
  }
  readonly analysisLimits?: Readonly<AnalysisLimits>
  readonly maxDocumentBytes?: number
  readonly maxSourceReferences?: number
  readonly maxBindings?: number
  readonly maxDisplayBytes?: number
}

export interface AnalysisProjectValidation {
  readonly valid: boolean
  readonly issues: readonly AnalysisIssue[]
  readonly project?: AnalysisProjectV1
}

type UnknownRecord = Readonly<Record<string, unknown>>
const isUnknownRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

class ProjectError extends Error {
  readonly path: string
  readonly code: AnalysisIssue['code']
  constructor(path: string, message: string, code: AnalysisIssue['code'] = 'invalid-graph') {
    super(message)
    this.name = 'ProjectError'
    this.path = path
    this.code = code
  }
}

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isUnknownRecord(value)) {
    throw new ProjectError(path, 'Expected an object', 'invalid-type')
  }
  return value
}

const exactKeys = (value: UnknownRecord, allowed: readonly string[], path: string): void => {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unknown !== undefined) throw new ProjectError(`${path}/${unknown}`, 'Unknown project field')
}

const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4_096) {
    throw new ProjectError(path, 'Expected a bounded non-empty string', 'invalid-type')
  }
  return value
}

const version = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ProjectError(path, 'Expected a positive safe integer', 'invalid-type')
  }
  return value
}

const hash = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new ProjectError(path, 'Expected a lowercase SHA-256 digest', 'invalid-type')
  }
  return value
}

const byteLimit = (value: number | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${name} must be positive`)
  return value
}

const jsonBytes = (value: unknown): number =>
  new TextEncoder().encode(canonicalJson(value)).byteLength

const parseSourceIdentity = (value: unknown, path: string): SourceIdentity => {
  const input = record(value, path)
  const kind = input.kind
  const size = input.size
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    throw new ProjectError(`${path}/size`, 'Source identity size is invalid')
  }
  if (kind === 'content') {
    exactKeys(input, ['kind', 'strength', 'stability', 'algorithm', 'digest', 'size'], path)
    if (
      input.strength !== 'strong' ||
      input.stability !== 'content-addressed' ||
      input.algorithm !== 'sha256'
    ) {
      throw new ProjectError(path, 'Content source identity semantics are invalid')
    }
    return normalizeSourceIdentity({
      kind,
      strength: input.strength,
      stability: input.stability,
      algorithm: input.algorithm,
      digest: text(input.digest, `${path}/digest`),
      size,
    })
  }
  if (kind === 'local-file') {
    exactKeys(input, ['kind', 'strength', 'stability', 'nameOrPath', 'size', 'lastModified'], path)
    if (input.strength !== 'weak' || input.stability !== 'metadata') {
      throw new ProjectError(path, 'Local source identity semantics are invalid')
    }
    if (typeof input.lastModified !== 'number') {
      throw new ProjectError(`${path}/lastModified`, 'Local identity lastModified is invalid')
    }
    return normalizeSourceIdentity({
      kind,
      strength: input.strength,
      stability: input.stability,
      nameOrPath: text(input.nameOrPath, `${path}/nameOrPath`),
      size,
      lastModified: input.lastModified,
    })
  }
  if (kind === 'session') {
    exactKeys(input, ['kind', 'strength', 'stability', 'id', 'size'], path)
    if (input.strength !== 'session' || input.stability !== 'instance') {
      throw new ProjectError(path, 'Session source identity semantics are invalid')
    }
    return normalizeSourceIdentity({
      kind,
      strength: input.strength,
      stability: input.stability,
      id: text(input.id, `${path}/id`),
      size,
    })
  }
  if (kind !== 'remote') throw new ProjectError(`${path}/kind`, 'Unknown source identity kind')
  exactKeys(input, ['kind', 'strength', 'stability', 'url', 'size', 'validator'], path)
  let validator:
    | { readonly kind: 'etag' | 'version-id' | 'last-modified'; readonly value: string }
    | undefined
  if (input.validator !== undefined) {
    const raw = record(input.validator, `${path}/validator`)
    exactKeys(raw, ['kind', 'value'], `${path}/validator`)
    if (raw.kind !== 'etag' && raw.kind !== 'version-id' && raw.kind !== 'last-modified') {
      throw new ProjectError(`${path}/validator/kind`, 'Remote validator kind is invalid')
    }
    validator = Object.freeze({ kind: raw.kind, value: text(raw.value, `${path}/validator/value`) })
  }
  const strong = validator?.kind === 'etag' || validator?.kind === 'version-id'
  if (
    input.strength !== (strong ? 'strong' : 'weak') ||
    input.stability !== (strong ? 'versioned' : 'best-effort')
  ) {
    throw new ProjectError(path, 'Remote source identity overstates its validator strength')
  }
  return normalizeSourceIdentity({
    kind,
    strength: strong ? 'strong' : 'weak',
    stability: strong ? 'versioned' : 'best-effort',
    url: text(input.url, `${path}/url`),
    size,
    ...(validator === undefined ? {} : { validator }),
  })
}

const parseSemanticIdentity = (value: unknown, path: string): AnalysisSemanticIdentity => {
  const input = record(value, path)
  if (input.kind === 'semantic-json') {
    exactKeys(input, ['kind', 'domain', 'sha256'], path)
    return Object.freeze({
      kind: input.kind,
      domain: text(input.domain, `${path}/domain`),
      sha256: hash(input.sha256, `${path}/sha256`),
    })
  }
  if (input.kind === 'application-defined') {
    exactKeys(input, ['kind', 'namespace', 'value'], path)
    return Object.freeze({
      kind: input.kind,
      namespace: text(input.namespace, `${path}/namespace`),
      value: text(input.value, `${path}/value`),
    })
  }
  if (input.kind !== 'scientific-dataset') return parseSourceIdentity(value, path)
  exactKeys(input, ['kind', 'reader', 'datasetId', 'resources'], path)
  const reader = record(input.reader, `${path}/reader`)
  exactKeys(reader, ['id', 'version'], `${path}/reader`)
  if (!Array.isArray(input.resources) || input.resources.length === 0) {
    throw new ProjectError(`${path}/resources`, 'Dataset identity requires resources')
  }
  const seen = new Set<string>()
  const resources = input.resources.map((entry, index) => {
    const resource = record(entry, `${path}/resources/${index}`)
    exactKeys(resource, ['id', 'identity'], `${path}/resources/${index}`)
    const id = text(resource.id, `${path}/resources/${index}/id`)
    if (seen.has(id))
      throw new ProjectError(`${path}/resources/${index}/id`, 'Duplicate resource id', 'duplicate')
    seen.add(id)
    return Object.freeze({
      id,
      identity: parseSourceIdentity(resource.identity, `${path}/resources/${index}/identity`),
    })
  })
  resources.sort((left, right) => compareText(left.id, right.id))
  const identity: ScientificDatasetIdentity = Object.freeze({
    kind: input.kind,
    reader: Object.freeze({
      id: text(reader.id, `${path}/reader/id`),
      version: text(reader.version, `${path}/reader/version`),
    }),
    datasetId: text(input.datasetId, `${path}/datasetId`),
    resources: Object.freeze(resources),
  })
  return identity
}

const parseProviderPolicy = (value: unknown, path: string): OperationProviderPolicy => {
  const input = record(value, path)
  if (input.mode === 'reference-only') {
    exactKeys(input, ['mode'], path)
    return Object.freeze({ mode: input.mode })
  }
  if (input.mode === 'pinned') {
    exactKeys(input, ['mode', 'providerId', 'providerVersion', 'buildFingerprint'], path)
    return Object.freeze({
      mode: input.mode,
      providerId: text(input.providerId, `${path}/providerId`),
      providerVersion: version(input.providerVersion, `${path}/providerVersion`),
      ...(input.buildFingerprint === undefined
        ? {}
        : { buildFingerprint: text(input.buildFingerprint, `${path}/buildFingerprint`) }),
    })
  }
  if (input.mode !== 'automatic')
    throw new ProjectError(`${path}/mode`, 'Provider policy mode is invalid')
  exactKeys(
    input,
    [
      'mode',
      'allowedProviderIds',
      'allowedProviderKinds',
      'maxRetainedBytes',
      'maxPeakWorkingBytes',
    ],
    path,
  )
  const stringArray = (raw: unknown, field: string): readonly string[] | undefined => {
    if (raw === undefined) return undefined
    if (!Array.isArray(raw)) throw new ProjectError(`${path}/${field}`, 'Expected an array')
    return Object.freeze(raw.map((entry, index) => text(entry, `${path}/${field}/${index}`)))
  }
  const nonNegative = (raw: unknown, field: string): number | undefined => {
    if (raw === undefined) return undefined
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
      throw new ProjectError(`${path}/${field}`, 'Expected a non-negative safe integer')
    }
    return raw
  }
  const rawKinds = stringArray(input.allowedProviderKinds, 'allowedProviderKinds')
  const kinds: OperationProviderKind[] | undefined = rawKinds?.map((kind) => {
    if (
      kind !== 'reference' &&
      kind !== 'wasm' &&
      kind !== 'webgpu' &&
      kind !== 'worker-rpc' &&
      kind !== 'remote'
    ) {
      throw new ProjectError(`${path}/allowedProviderKinds`, 'Provider kind is invalid')
    }
    return kind
  })
  const allowedProviderIds = stringArray(input.allowedProviderIds, 'allowedProviderIds')
  const maxRetainedBytes = nonNegative(input.maxRetainedBytes, 'maxRetainedBytes')
  const maxPeakWorkingBytes = nonNegative(input.maxPeakWorkingBytes, 'maxPeakWorkingBytes')
  return Object.freeze({
    mode: input.mode,
    ...(allowedProviderIds === undefined ? {} : { allowedProviderIds }),
    ...(kinds === undefined ? {} : { allowedProviderKinds: kinds }),
    ...(maxRetainedBytes === undefined ? {} : { maxRetainedBytes }),
    ...(maxPeakWorkingBytes === undefined ? {} : { maxPeakWorkingBytes }),
  })
}

const parseBindingValue = (value: unknown, path: string): PersistedBindingValue => {
  const input = record(value, path)
  if (input.kind === 'source') {
    exactKeys(input, ['kind', 'sourceReference'], path)
    return Object.freeze({
      kind: input.kind,
      sourceReference: text(input.sourceReference, `${path}/sourceReference`),
    })
  }
  if (input.kind === 'roi') {
    exactKeys(input, ['kind', 'roiId'], path)
    return Object.freeze({ kind: input.kind, roiId: text(input.roiId, `${path}/roiId`) })
  }
  if (input.kind === 'roi-set') {
    exactKeys(input, ['kind', 'roiIds'], path)
    if (input.roiIds === undefined) return Object.freeze({ kind: input.kind })
    if (!Array.isArray(input.roiIds)) throw new ProjectError(`${path}/roiIds`, 'Expected an array')
    const roiIds = input.roiIds.map((id, index) => text(id, `${path}/roiIds/${index}`))
    if (new Set(roiIds).size !== roiIds.length) {
      throw new ProjectError(`${path}/roiIds`, 'Duplicate ROI id', 'duplicate')
    }
    return Object.freeze({
      kind: input.kind,
      roiIds: Object.freeze(roiIds),
    })
  }
  if (input.kind === 'inline-json') {
    exactKeys(input, ['kind', 'value'], path)
    return Object.freeze({ kind: input.kind, value: normalizeOperationJsonValue(input.value) })
  }
  throw new ProjectError(`${path}/kind`, 'Persisted binding kind is invalid')
}

const semanticIdentityEqual = (
  left: AnalysisSemanticIdentity,
  right: AnalysisSemanticIdentity,
): boolean =>
  canonicalJson(normalizeAnalysisSemanticIdentity(left)) ===
  canonicalJson(normalizeAnalysisSemanticIdentity(right))

const derivedBindingIdentity = async (
  binding: PersistedInputBinding,
  roiSet: RoiSet,
): Promise<AnalysisSemanticIdentity | undefined> => {
  if (binding.value.kind === 'roi') {
    const roiId = binding.value.roiId
    const roi = roiSet.rois.find((entry) => entry.id === roiId)
    if (roi === undefined) throw new ProjectError('/bindings', `Unknown ROI ${roiId}`)
    return Object.freeze({
      kind: 'semantic-json',
      domain: 'purejsimage.roi-semantics.v1',
      sha256: await hashCanonicalJson(
        'purejsimage.roi-semantics.v1',
        canonicalNormalizedRoiSemanticsJson(roi),
      ),
    })
  }
  if (binding.value.kind === 'roi-set') {
    const selected =
      binding.value.roiIds === undefined
        ? roiSet.rois
        : binding.value.roiIds.map((id) => {
            const roi = roiSet.rois.find((entry) => entry.id === id)
            if (roi === undefined) throw new ProjectError('/bindings', `Unknown ROI ${id}`)
            return roi
          })
    const subset: RoiSet = Object.freeze({ schemaVersion: 1, rois: Object.freeze(selected) })
    return Object.freeze({
      kind: 'semantic-json',
      domain: 'purejsimage.roi-set-semantics.v1',
      sha256: await hashCanonicalJson(
        'purejsimage.roi-set-semantics.v1',
        canonicalNormalizedRoiSetSemanticsJson(subset),
      ),
    })
  }
  if (binding.value.kind === 'inline-json') {
    const value = binding.value.value
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string' ||
      binding.valueType.id.startsWith('purejsimage.')
    ) {
      const domain =
        value === null || typeof value !== 'object'
          ? `purejsimage.scalar-binding.${binding.valueType.id}.v${binding.valueType.version}`
          : `purejsimage.binding.${binding.valueType.id}.v${binding.valueType.version}`
      return Object.freeze({
        kind: 'semantic-json',
        domain,
        sha256: await hashCanonicalJson(domain, value),
      })
    }
  }
  return undefined
}

export const computeAnalysisProjectHashes = async (
  project: Pick<AnalysisProjectV1, 'graph' | 'bindings'>,
): Promise<AnalysisProjectHashes> => {
  const graph = await hashAnalysisGraph(project.graph)
  const identities: AnalysisBindingIdentity[] = project.bindings.map((binding) =>
    Object.freeze({
      input: binding.input,
      valueType: binding.valueType,
      identity: normalizeAnalysisSemanticIdentity(binding.identity),
    }),
  )
  identities.sort((left, right) => compareText(left.input, right.input))
  const invocation = await computeAnalysisInvocationManifest(graph, identities)
  return Object.freeze({
    graph,
    bindings: invocation.bindingHash,
    invocation: invocation.invocationHash,
  })
}

const normalizeProject = async (
  value: unknown,
  options: Readonly<AnalysisProjectOptions>,
): Promise<AnalysisProjectV1> => {
  const maxDocumentBytes = byteLimit(
    options.maxDocumentBytes,
    16 * 1_024 * 1_024,
    'maxDocumentBytes',
  )
  if (jsonBytes(value) > maxDocumentBytes)
    throw new ProjectError('', 'Project exceeds maxDocumentBytes', 'limit-exceeded')
  const input = record(value, '')
  exactKeys(
    input,
    [
      'schemaVersion',
      'graph',
      'roiSet',
      'bindings',
      'sourceReferences',
      'providerPolicy',
      'display',
      'createdWith',
      'hashes',
    ],
    '',
  )
  if (input.schemaVersion !== 1)
    throw new ProjectError('/schemaVersion', 'Unsupported project schema version')
  const graphValidation = validateGraphWithValueTypes(
    input.graph,
    options.operations,
    options.valueTypes,
    options.analysisLimits,
  )
  if (graphValidation.graph === undefined) {
    const issue = graphValidation.issues[0]
    throw new ProjectError(
      `/graph${issue?.path ?? ''}`,
      issue?.message ?? 'Graph is invalid',
      issue?.code,
    )
  }
  const graph = graphValidation.graph
  const roiSet = normalizeRoiSet(input.roiSet, options.roi.descriptor, options.roi.limits)
  const sourceLimit = byteLimit(options.maxSourceReferences, 1_024, 'maxSourceReferences')
  if (!Array.isArray(input.sourceReferences))
    throw new ProjectError('/sourceReferences', 'Expected an array')
  if (input.sourceReferences.length > sourceLimit)
    throw new ProjectError('/sourceReferences', 'Too many source references', 'limit-exceeded')
  const sourceIdentities = new Map<string, AnalysisSemanticIdentity>()
  const sourceReferences: PersistedSourceReference[] = input.sourceReferences.map(
    (entry, index) => {
      const source = record(entry, `/sourceReferences/${index}`)
      exactKeys(source, ['id', 'identity', 'locatorHint'], `/sourceReferences/${index}`)
      const id = text(source.id, `/sourceReferences/${index}/id`)
      if (sourceIdentities.has(id))
        throw new ProjectError(
          `/sourceReferences/${index}/id`,
          'Duplicate source reference',
          'duplicate',
        )
      const identity = parseSemanticIdentity(source.identity, `/sourceReferences/${index}/identity`)
      sourceIdentities.set(id, identity)
      return Object.freeze({
        id,
        identity,
        ...(source.locatorHint === undefined
          ? {}
          : { locatorHint: normalizeOperationJsonObject(source.locatorHint) }),
      })
    },
  )
  if (!Array.isArray(input.bindings)) throw new ProjectError('/bindings', 'Expected an array')
  const bindingLimit = byteLimit(options.maxBindings, 1_024, 'maxBindings')
  if (input.bindings.length > bindingLimit)
    throw new ProjectError('/bindings', 'Too many bindings', 'limit-exceeded')
  const graphInputs = new Map(graph.inputs.map((entry) => [entry.name, entry]))
  const seenBindings = new Set<string>()
  const bindings: PersistedInputBinding[] = []
  for (let index = 0; index < input.bindings.length; index += 1) {
    const raw = record(input.bindings[index], `/bindings/${index}`)
    exactKeys(raw, ['input', 'valueType', 'identity', 'value'], `/bindings/${index}`)
    const name = text(raw.input, `/bindings/${index}/input`)
    if (seenBindings.has(name))
      throw new ProjectError(`/bindings/${index}/input`, 'Duplicate binding', 'duplicate')
    seenBindings.add(name)
    const graphInput = graphInputs.get(name)
    if (graphInput === undefined)
      throw new ProjectError(`/bindings/${index}/input`, `Unknown graph input ${name}`)
    const valueTypeRaw = record(raw.valueType, `/bindings/${index}/valueType`)
    exactKeys(valueTypeRaw, ['id', 'version'], `/bindings/${index}/valueType`)
    const valueType = Object.freeze({
      id: text(valueTypeRaw.id, `/bindings/${index}/valueType/id`),
      version: version(valueTypeRaw.version, `/bindings/${index}/valueType/version`),
    })
    if (
      valueType.id !== graphInput.valueType.id ||
      valueType.version !== graphInput.valueType.version
    ) {
      throw new ProjectError(
        `/bindings/${index}/valueType`,
        'Binding value type does not match graph input',
        'invalid-type',
      )
    }
    const definition = options.valueTypes.get(valueType.id, valueType.version)
    if (definition === undefined)
      throw new ProjectError(
        `/bindings/${index}/valueType`,
        'Binding value type is not registered',
        'invalid-type',
      )
    const identity = parseSemanticIdentity(raw.identity, `/bindings/${index}/identity`)
    let bindingValue = parseBindingValue(raw.value, `/bindings/${index}/value`)
    if (bindingValue.kind === 'source') {
      const sourceIdentity = sourceIdentities.get(bindingValue.sourceReference)
      if (sourceIdentity === undefined)
        throw new ProjectError(
          `/bindings/${index}/value/sourceReference`,
          'Unknown source reference',
        )
      if (!semanticIdentityEqual(identity, sourceIdentity)) {
        throw new ProjectError(
          `/bindings/${index}/identity`,
          'Binding identity does not match source reference',
        )
      }
    } else if (bindingValue.kind === 'roi') {
      if (valueType.id !== roiValueTypeId || valueType.version !== 1)
        throw new ProjectError(
          `/bindings/${index}/value`,
          'ROI binding requires the ROI value type',
        )
    } else if (bindingValue.kind === 'roi-set') {
      if (valueType.id !== roiSetValueTypeId || valueType.version !== 1)
        throw new ProjectError(
          `/bindings/${index}/value`,
          'ROI-set binding requires the ROI-set value type',
        )
    } else if (definition.validate !== undefined) {
      const validation = definition.validate(bindingValue.value)
      if (validation.value === undefined)
        throw new ProjectError(
          `/bindings/${index}/value`,
          validation.issues[0]?.message ?? 'Inline value is invalid',
        )
      bindingValue = Object.freeze({ kind: 'inline-json', value: validation.value })
    }
    const normalized: PersistedInputBinding = Object.freeze({
      input: name,
      valueType,
      identity,
      value: bindingValue,
    })
    const derived = await derivedBindingIdentity(normalized, roiSet)
    if (derived !== undefined && !semanticIdentityEqual(identity, derived)) {
      throw new ProjectError(`/bindings/${index}/identity`, 'Stored binding identity is stale')
    }
    bindings.push(normalized)
  }
  const missing = graph.inputs.find((entry) => !seenBindings.has(entry.name))
  if (missing !== undefined)
    throw new ProjectError('/bindings', `Graph input ${missing.name} is not bound`, 'missing-input')
  bindings.sort((left, right) => compareText(left.input, right.input))
  const display =
    input.display === undefined ? undefined : normalizeOperationJsonObject(input.display)
  const maxDisplayBytes = byteLimit(options.maxDisplayBytes, 1_048_576, 'maxDisplayBytes')
  if (display !== undefined && jsonBytes(display) > maxDisplayBytes)
    throw new ProjectError('/display', 'Display state exceeds maxDisplayBytes', 'limit-exceeded')
  const createdWithRaw = record(input.createdWith, '/createdWith')
  exactKeys(createdWithRaw, ['packageVersion', 'buildFingerprint'], '/createdWith')
  const createdWith = Object.freeze({
    packageVersion: text(createdWithRaw.packageVersion, '/createdWith/packageVersion'),
    buildFingerprint: text(createdWithRaw.buildFingerprint, '/createdWith/buildFingerprint'),
  })
  const hashesRaw = record(input.hashes, '/hashes')
  exactKeys(hashesRaw, ['graph', 'bindings', 'invocation'], '/hashes')
  const hashes = Object.freeze({
    graph: hash(hashesRaw.graph, '/hashes/graph'),
    bindings: hash(hashesRaw.bindings, '/hashes/bindings'),
    invocation: hash(hashesRaw.invocation, '/hashes/invocation'),
  })
  const project: AnalysisProjectV1 = Object.freeze({
    schemaVersion: 1,
    graph,
    roiSet,
    bindings: Object.freeze(bindings),
    sourceReferences: Object.freeze(sourceReferences),
    ...(input.providerPolicy === undefined
      ? {}
      : { providerPolicy: parseProviderPolicy(input.providerPolicy, '/providerPolicy') }),
    ...(display === undefined ? {} : { display }),
    createdWith,
    hashes,
  })
  const computed = await computeAnalysisProjectHashes(project)
  if (computed.graph !== hashes.graph)
    throw new ProjectError('/hashes/graph', 'Stored graph hash is stale')
  if (computed.bindings !== hashes.bindings)
    throw new ProjectError('/hashes/bindings', 'Stored binding hash is stale')
  if (computed.invocation !== hashes.invocation)
    throw new ProjectError('/hashes/invocation', 'Stored invocation hash is stale')
  return project
}

export const validateAnalysisProjectV1 = async (
  value: unknown,
  options: Readonly<AnalysisProjectOptions>,
): Promise<AnalysisProjectValidation> => {
  try {
    const project = await normalizeProject(value, options)
    return Object.freeze({ valid: true, issues: Object.freeze([]), project })
  } catch (error) {
    const issue =
      error instanceof ProjectError
        ? Object.freeze({
            code: error.code,
            severity: 'error' as const,
            path: error.path,
            message: error.message,
          })
        : Object.freeze({
            code: 'invalid-graph' as const,
            severity: 'error' as const,
            path: '',
            message: error instanceof Error ? error.message : 'Project validation failed',
          })
    return Object.freeze({ valid: false, issues: Object.freeze([issue]) })
  }
}

export const normalizeAnalysisProjectV1 = async (
  value: unknown,
  options: Readonly<AnalysisProjectOptions>,
): Promise<AnalysisProjectV1> => {
  const validation = await validateAnalysisProjectV1(value, options)
  if (validation.project === undefined) {
    throw invalidInput(validation.issues[0]?.message ?? 'Analysis project is invalid')
  }
  return validation.project
}
