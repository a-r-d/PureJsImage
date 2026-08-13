import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { OperationDescriptor, OperationJsonValue } from './descriptor.ts'

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

export interface OperationPlanningRequest {
  readonly descriptor: OperationDescriptor
  readonly parameters: OperationJsonValue
  readonly inputCharacteristics: readonly OperationJsonValue[]
  readonly signal: AbortSignal
}

export interface OperationExecutionRequest {
  readonly descriptor: OperationDescriptor
  readonly parameters: OperationJsonValue
  readonly inputs: readonly unknown[]
  readonly plannedInputCharacteristics: readonly OperationJsonValue[]
  readonly signal: AbortSignal
}

export interface OperationCostEstimate {
  readonly setupMilliseconds: number
  readonly transferMilliseconds: number
  readonly computeMilliseconds: number
  readonly readbackMilliseconds: number
  /** Bytes still owned by the provider after execution returns, including owned outputs. */
  readonly retainedBytes: number
  /** Peak provider working storage during execution, including output storage but excluding inputs. */
  readonly peakWorkingBytes: number
  /** Bytes expected to cross the provider boundary in either direction. */
  readonly transferBytes: number
  /** The retainedBytes portion owned by returned outputs. */
  readonly outputBytes: number
  readonly confidence: number
}

export interface OperationOwnedOutput {
  readonly value: unknown
  /**
   * Stable identity for the exclusively owned resource behind value. Providers must reuse the same
   * object when separate wrappers or views alias one allocation, device buffer, or remote handle.
   */
  readonly ownershipIdentity?: object
  release(): void | Promise<void>
}

export interface OperationImplementation {
  readonly descriptor: OperationImplementationDescriptor
  supportsPlan(request: Readonly<OperationPlanningRequest>): boolean
  estimatePlan(request: Readonly<OperationPlanningRequest>): OperationCostEstimate
  validateExecution?(request: Readonly<OperationExecutionRequest>): void
  execute(request: Readonly<OperationExecutionRequest>): Promise<readonly OperationOwnedOutput[]>
}

export interface PreparedOperationProvider {
  readonly descriptor: OperationProviderDescriptor
  readonly implementations: readonly OperationImplementation[]
  dispose?(): void | Promise<void>
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
      readonly maxRetainedBytes?: number
      readonly maxPeakWorkingBytes?: number
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
  prepare(signal?: AbortSignal): Promise<
    | readonly OperationImplementation[]
    | {
        readonly implementations: readonly OperationImplementation[]
        dispose?(): void | Promise<void>
      }
    | undefined
  >
}): OperationProvider => {
  const descriptor = normalizeOperationProviderDescriptor(options.descriptor)
  return Object.freeze({
    descriptor,
    async prepare(signal?: AbortSignal): Promise<PreparedOperationProvider | undefined> {
      signal?.throwIfAborted()
      const prepared = await options.prepare(signal)
      if (prepared === undefined) return undefined
      const implementations = 'implementations' in prepared ? prepared.implementations : prepared
      const dispose = 'implementations' in prepared ? prepared.dispose : undefined
      try {
        signal?.throwIfAborted()
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
        return Object.freeze({
          descriptor,
          implementations: Object.freeze(normalized),
          ...(dispose === undefined ? {} : { dispose }),
        })
      } catch (error) {
        await dispose?.()
        throw error
      }
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
    !Number.isSafeInteger(estimate.peakWorkingBytes) ||
    estimate.peakWorkingBytes < 0 ||
    !Number.isSafeInteger(estimate.transferBytes) ||
    estimate.transferBytes < 0 ||
    !Number.isSafeInteger(estimate.outputBytes) ||
    estimate.outputBytes < 0 ||
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

const estimateMatchesPolicy = (
  estimate: OperationCostEstimate,
  policy: OperationProviderPolicy,
): boolean =>
  policy.mode !== 'automatic' ||
  ((policy.maxRetainedBytes === undefined || estimate.retainedBytes <= policy.maxRetainedBytes) &&
    (policy.maxPeakWorkingBytes === undefined ||
      estimate.peakWorkingBytes <= policy.maxPeakWorkingBytes))

const validatePolicy = (policy: OperationProviderPolicy): void => {
  if (policy.mode !== 'automatic') return
  for (const [name, value] of [
    ['maxRetainedBytes', policy.maxRetainedBytes],
    ['maxPeakWorkingBytes', policy.maxPeakWorkingBytes],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw invalidInput(`${name} must be a non-negative safe integer`)
    }
  }
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

const storageIdentity = (value: unknown): object | undefined => {
  if (value === null || typeof value !== 'object') return undefined
  if (ArrayBuffer.isView(value)) return value.buffer
  if (value instanceof ArrayBuffer) return value
  if ('data' in value && ArrayBuffer.isView(value.data)) return value.data.buffer
  return value
}

/** Validates the detectable part of the provider's exclusive output-ownership contract. */
export const validateOperationOwnedOutputs = (
  outputs: readonly OperationOwnedOutput[],
  inputs: readonly unknown[] = [],
  inputOwnershipIdentities: readonly object[] = [],
): void => {
  if (new Set(outputs).size !== outputs.length) {
    throw invalidInput('Provider returned the same owned output for multiple ports')
  }
  const inputStorage = new Set<object>(inputOwnershipIdentities)
  for (const input of inputs) {
    const identity = storageIdentity(input)
    if (identity !== undefined) inputStorage.add(identity)
  }
  const outputResources = new Set<object>()
  for (const output of outputs) {
    if (
      output.ownershipIdentity !== undefined &&
      (output.ownershipIdentity === null || typeof output.ownershipIdentity !== 'object')
    ) {
      throw invalidInput('Provider returned an invalid output ownership identity')
    }
    if (output.ownershipIdentity !== undefined) {
      if (inputStorage.has(output.ownershipIdentity)) {
        throw invalidInput('Provider output improperly claims ownership of input storage')
      }
      if (outputResources.has(output.ownershipIdentity)) {
        throw invalidInput('Provider returned outputs that alias the same owned resource')
      }
    }
    const identity = storageIdentity(output.value)
    if (identity !== undefined) {
      if (inputStorage.has(identity)) {
        throw invalidInput('Provider output improperly claims ownership of input storage')
      }
      if (outputResources.has(identity)) {
        throw invalidInput('Provider returned outputs that alias the same storage')
      }
    }
    if (output.ownershipIdentity !== undefined) outputResources.add(output.ownershipIdentity)
    if (identity !== undefined) outputResources.add(identity)
  }
}

export interface OperationRuntimeSnapshot {
  readonly providers: readonly OperationProviderDescriptor[]
}

export class OperationRuntime {
  readonly #providers: readonly PreparedOperationProvider[]
  readonly capabilitySnapshot: OperationRuntimeSnapshot
  #closing = false
  #activeExecutions = 0
  #disposePromise: Promise<void> | undefined
  readonly #idleWaiters = new Set<() => void>()

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
          ...(provider.dispose === undefined ? {} : { dispose: provider.dispose }),
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
    request: Readonly<OperationPlanningRequest>,
    policy: OperationProviderPolicy = { mode: 'automatic' },
  ): OperationProviderSelection {
    if (this.#closing) throw invalidInput('Operation runtime is disposed')
    validatePolicy(policy)
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
        if (!implementation.supportsPlan(request)) continue
        const estimate = validateEstimate(implementation.estimatePlan(request))
        if (!estimateMatchesPolicy(estimate, policy)) continue
        candidates.push({
          provider,
          implementation,
          estimate,
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
    planningRequest: Readonly<OperationPlanningRequest>,
    executionRequest: Readonly<OperationExecutionRequest>,
    policy: OperationProviderPolicy = { mode: 'automatic' },
  ): Promise<OperationExecutionResult> {
    const selected = this.select(planningRequest, policy)
    this.#activeExecutions += 1
    let outputs: readonly OperationOwnedOutput[]
    try {
      selected.implementation.validateExecution?.(executionRequest)
      outputs = await selected.implementation.execute(executionRequest)
    } catch (error) {
      this.#finishExecution()
      throw error
    }
    try {
      validateOperationOwnedOutputs(outputs, executionRequest.inputs)
      executionRequest.signal.throwIfAborted()
      const frozenOutputs = Object.freeze([...outputs])
      let released = false
      const finishExecution = (): void => this.#finishExecution()
      return Object.freeze({
        outputs: frozenOutputs,
        provenance: Object.freeze({
          provider: selected.provider.descriptor,
          implementation: selected.implementation.descriptor,
          reproducibility: executionRequest.descriptor.reproducibility,
          estimate: selected.estimate,
        }),
        async release(): Promise<void> {
          if (released) return
          released = true
          try {
            await releaseOutputs(frozenOutputs)
          } finally {
            finishExecution()
          }
        },
      })
    } catch (error) {
      try {
        await releaseOutputs(outputs)
      } finally {
        this.#finishExecution()
      }
      throw error
    }
  }

  get isDisposed(): boolean {
    return this.#closing
  }

  async whenIdle(): Promise<void> {
    if (this.#activeExecutions === 0) return
    await new Promise<void>((resolve) => this.#idleWaiters.add(resolve))
  }

  async dispose(): Promise<void> {
    if (this.#disposePromise !== undefined) return this.#disposePromise
    this.#closing = true
    this.#disposePromise = (async () => {
      await this.whenIdle()
      let firstError: unknown
      for (const provider of [...this.#providers].reverse()) {
        try {
          await provider.dispose?.()
        } catch (error) {
          firstError ??= error
        }
      }
      if (firstError !== undefined) throw firstError
    })()
    return this.#disposePromise
  }

  #finishExecution(): void {
    this.#activeExecutions -= 1
    if (this.#activeExecutions !== 0) return
    for (const resolve of this.#idleWaiters) resolve()
    this.#idleWaiters.clear()
  }
}

export const prepareOperationRuntime = async (
  providers: Iterable<OperationProvider>,
  signal?: AbortSignal,
): Promise<OperationRuntime> => {
  const prepared: PreparedOperationProvider[] = []
  try {
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
        await available.dispose?.()
        throw invalidInput(`Provider ${declared.id} changed identity during preparation`)
      }
      prepared.push(available)
    }
    return new OperationRuntime(prepared)
  } catch (error) {
    for (const provider of prepared.reverse()) {
      try {
        await provider.dispose?.()
      } catch {
        // Preserve the preparation failure.
      }
    }
    throw error
  }
}
