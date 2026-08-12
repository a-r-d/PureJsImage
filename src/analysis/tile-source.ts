import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { OperationJsonObject, OperationJsonValue } from '../operations/descriptor.ts'
import type {
  OperationCostEstimate,
  OperationOwnedOutput,
  OperationProviderRequest,
  OperationProviderSelection,
} from '../operations/provider.ts'
import type { OperationDefinition } from '../operations/registry.ts'
import type {
  NumericArray,
  NumericSampleType,
  NumericTile,
  NumericTileLayout,
  NumericTileSource,
} from '../scientific/numeric-tile.ts'
import { numericTileSampleOffset, validateNumericTile } from '../scientific/numeric-tile.ts'
import type { NormalizedScientificDatasetDescriptor } from '../scientific/dataset-v2.ts'
import { normalizeScientificPlaneReadRequest } from '../scientific/dataset-v2.ts'
import type {
  TileAddress,
  TileProviderTiming,
  TileRequest,
  TileSource,
  TileSourceResult,
} from './tile-runtime.ts'
import { canonicalTileKey, normalizeTileRequest, tileRequestKeyData } from './tile-runtime.ts'
import type { TileRuntime } from './tile-runtime.ts'

const once = (callback: () => void): (() => void) => {
  let called = false
  return () => {
    if (called) return
    called = true
    callback()
  }
}

const normalizeScientificTileAddress = (
  descriptor: NormalizedScientificDatasetDescriptor,
  address: TileAddress,
): TileAddress => {
  const plane = normalizeScientificPlaneReadRequest(descriptor, {
    displayAxes: address.displayAxes,
    fixedIndices: address.fixedIndices,
    resolutionLevel: address.resolutionLevel,
    x: address.x,
    y: address.y,
    width: address.width,
    height: address.height,
  })
  return Object.freeze({
    ...address,
    displayAxes: plane.displayAxes,
    fixedIndices: plane.fixedIndices,
    resolutionLevel: plane.resolutionLevel,
    x: plane.x,
    y: plane.y,
    width: plane.width,
    height: plane.height,
  })
}

const allocateNumericArray = (sampleType: NumericSampleType, length: number): NumericArray => {
  if (sampleType === 'uint8') return new Uint8Array(length)
  if (sampleType === 'uint16') return new Uint16Array(length)
  if (sampleType === 'uint32') return new Uint32Array(length)
  if (sampleType === 'uint64') return new BigUint64Array(length)
  if (sampleType === 'int8') return new Int8Array(length)
  if (sampleType === 'int16') return new Int16Array(length)
  if (sampleType === 'int32') return new Int32Array(length)
  if (sampleType === 'float32') return new Float32Array(length)
  return new Float64Array(length)
}

const numericValue = (data: NumericArray, index: number): number | bigint => {
  if (data instanceof BigUint64Array) return data[index] ?? 0n
  return data[index] ?? 0
}

const setNumericValue = (data: NumericArray, index: number, value: number | bigint): void => {
  if (data instanceof BigUint64Array) {
    if (typeof value !== 'bigint') throw invalidInput('Numeric tile merge changed bigint semantics')
    data[index] = value
    return
  }
  if (typeof value !== 'number') throw invalidInput('Numeric tile merge changed number semantics')
  data[index] = value
}

const packedTile = (
  address: TileAddress,
  sampleType: NumericSampleType,
  componentCount: number,
  layout: NumericTileLayout,
): NumericTile => {
  const rowStrideElements = address.width * (layout === 'interleaved' ? componentCount : 1)
  const planeStrideElements = rowStrideElements * address.height
  const elements = layout === 'planar' ? planeStrideElements * componentCount : planeStrideElements
  if (
    !Number.isSafeInteger(rowStrideElements) ||
    !Number.isSafeInteger(planeStrideElements) ||
    !Number.isSafeInteger(elements)
  ) {
    throw invalidInput('Packed tile storage size overflowed')
  }
  const data = allocateNumericArray(sampleType, elements)
  return Object.freeze({
    x: address.x,
    y: address.y,
    width: address.width,
    height: address.height,
    sampleType,
    componentCount,
    layout,
    rowStrideElements,
    ...(layout === 'planar' ? { planeStrideElements } : {}),
    data,
    release: once(() => undefined),
  })
}

const copyTile = (source: NumericTile, destination: NumericTile, coverage: Uint8Array): void => {
  validateNumericTile(source)
  if (
    source.sampleType !== destination.sampleType ||
    source.componentCount !== destination.componentCount ||
    source.x < destination.x ||
    source.y < destination.y ||
    source.x + source.width > destination.x + destination.width ||
    source.y + source.height > destination.y + destination.height
  ) {
    throw invalidInput('Numeric tile source emitted incompatible or out-of-region storage')
  }
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const destinationX = source.x - destination.x + x
      const destinationY = source.y - destination.y + y
      const coverageIndex = destinationY * destination.width + destinationX
      if (coverage[coverageIndex] !== 0)
        throw invalidInput('Numeric tile source overlaps output pixels')
      coverage[coverageIndex] = 1
      for (let component = 0; component < source.componentCount; component += 1) {
        setNumericValue(
          destination.data,
          numericTileSampleOffset(destination, destinationX, destinationY, component),
          numericValue(source.data, numericTileSampleOffset(source, x, y, component)),
        )
      }
    }
  }
}

class NumericTileSourceAdapter implements TileSource {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: NumericTileSource

  constructor(source: NumericTileSource) {
    this.#source = source
    this.descriptor = source.descriptor
  }

  tileKey(request: Readonly<TileRequest>): string {
    return canonicalTileKey({
      ...request,
      address: normalizeScientificTileAddress(this.descriptor, request.address),
    })
  }

  async readTile(request: Readonly<TileRequest>): Promise<TileSourceResult> {
    const address = normalizeScientificTileAddress(this.descriptor, request.address)
    const sourceRequest = {
      displayAxes: address.displayAxes,
      fixedIndices: address.fixedIndices,
      resolutionLevel: address.resolutionLevel,
      x: address.x,
      y: address.y,
      width: address.width,
      height: address.height,
      signal: request.signal,
      ...(request.target?.sampleType === undefined
        ? {}
        : { targetSampleType: request.target.sampleType }),
    }
    let output: NumericTile | undefined
    let coverage: Uint8Array | undefined
    let bytesRequested = 0
    try {
      for await (const sourceTile of this.#source.readNumericTiles(sourceRequest)) {
        try {
          request.signal.throwIfAborted()
          validateNumericTile(sourceTile)
          bytesRequested += sourceTile.data.byteLength
          if (!Number.isSafeInteger(bytesRequested))
            throw invalidInput('Tile byte count overflowed')
          if (output === undefined) {
            const layout = request.target?.layout ?? sourceTile.layout
            output = packedTile(address, sourceTile.sampleType, sourceTile.componentCount, layout)
            coverage = new Uint8Array(address.width * address.height)
          }
          if (coverage === undefined) throw invalidInput('Numeric tile coverage is unavailable')
          copyTile(sourceTile, output, coverage)
        } finally {
          sourceTile.release()
        }
      }
      request.signal.throwIfAborted()
      if (output === undefined || coverage === undefined) {
        throw invalidInput('Numeric tile source returned no tiles')
      }
      for (const covered of coverage) {
        if (covered === 0) throw invalidInput('Numeric tile source left uncovered output pixels')
      }
      return Object.freeze({ tile: output, accounting: Object.freeze({ bytesRequested }) })
    } catch (error) {
      output?.release()
      throw error
    }
  }
}

export const numericTileSourceToTileSource = (source: NumericTileSource): TileSource =>
  new NumericTileSourceAdapter(source)

export interface TileHalo {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export type TileBoundaryMode = 'clip'

export interface DerivedTileExecutionContext extends OperationJsonObject {
  readonly requested: OperationJsonObject
  readonly source: OperationJsonObject
  readonly halo: OperationJsonObject
  readonly boundaryMode: TileBoundaryMode
}

export interface DerivedTileSourceOptions {
  readonly runtime: TileRuntime
  readonly source: TileSource
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly operation: OperationDefinition
  readonly selections: readonly OperationProviderSelection[]
  readonly parameters: unknown
  readonly nodeSemanticHash: string
  readonly executionFingerprint: string
  readonly sourceNamespace: string
  readonly pinned?: boolean
  readonly boundaryMode?: TileBoundaryMode
  readonly halo?: (parameters: OperationJsonValue) => Readonly<TileHalo>
  readonly onReleaseError?: (error: unknown) => void
}

const boundedFingerprint = (value: string, name: string): string => {
  if (value.trim().length === 0 || value.length > 4_096) {
    throw invalidInput(`${name} must be a bounded non-empty string`)
  }
  return value
}

const normalizeHalo = (value: Readonly<TileHalo> | undefined): TileHalo => {
  const halo = value ?? { left: 0, right: 0, top: 0, bottom: 0 }
  for (const [name, amount] of Object.entries(halo)) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000) {
      throw invalidInput(`Tile halo ${name} is invalid`)
    }
  }
  return Object.freeze({ ...halo })
}

const estimateTiming = (estimate: OperationCostEstimate, measured: number): TileProviderTiming => {
  const times = [
    estimate.setupMilliseconds,
    estimate.transferMilliseconds,
    estimate.computeMilliseconds,
    estimate.readbackMilliseconds,
    measured,
  ]
  if (
    times.some((value) => !Number.isFinite(value) || value < 0) ||
    !Number.isSafeInteger(estimate.retainedBytes) ||
    estimate.retainedBytes < 0 ||
    !Number.isFinite(estimate.confidence) ||
    estimate.confidence < 0 ||
    estimate.confidence > 1
  ) {
    throw invalidInput('Derived tile provider returned invalid timing or memory estimates')
  }
  return Object.freeze({
    setupMillisecondsEstimate: estimate.setupMilliseconds,
    transferMillisecondsEstimate: estimate.transferMilliseconds,
    computeMillisecondsEstimate: estimate.computeMilliseconds,
    readbackMillisecondsEstimate: estimate.readbackMilliseconds,
    computeMillisecondsMeasured: measured,
  })
}

const isNumericArray = (value: unknown): value is NumericArray =>
  value instanceof Uint8Array ||
  value instanceof Uint16Array ||
  value instanceof Uint32Array ||
  value instanceof BigUint64Array ||
  value instanceof Int8Array ||
  value instanceof Int16Array ||
  value instanceof Int32Array ||
  value instanceof Float32Array ||
  value instanceof Float64Array

const isNumericTile = (value: unknown): value is NumericTile =>
  value !== null &&
  typeof value === 'object' &&
  'x' in value &&
  typeof value.x === 'number' &&
  'y' in value &&
  typeof value.y === 'number' &&
  'width' in value &&
  typeof value.width === 'number' &&
  'height' in value &&
  typeof value.height === 'number' &&
  'sampleType' in value &&
  (value.sampleType === 'uint8' ||
    value.sampleType === 'uint16' ||
    value.sampleType === 'uint32' ||
    value.sampleType === 'uint64' ||
    value.sampleType === 'int8' ||
    value.sampleType === 'int16' ||
    value.sampleType === 'int32' ||
    value.sampleType === 'float32' ||
    value.sampleType === 'float64') &&
  'componentCount' in value &&
  typeof value.componentCount === 'number' &&
  'layout' in value &&
  (value.layout === 'interleaved' || value.layout === 'planar') &&
  'rowStrideElements' in value &&
  typeof value.rowStrideElements === 'number' &&
  'data' in value &&
  isNumericArray(value.data) &&
  'release' in value &&
  typeof value.release === 'function'

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

export class DerivedTileSource implements TileSource {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #runtime: TileRuntime
  readonly #source: TileSource
  readonly #operation: OperationDefinition
  readonly #selections: readonly OperationProviderSelection[]
  readonly #parameters: OperationJsonValue
  readonly #nodeSemanticHash: string
  readonly #executionFingerprint: string
  readonly #sourceNamespace: string
  readonly #pinned: boolean
  readonly #boundaryMode: TileBoundaryMode
  readonly #halo: TileHalo
  readonly #onReleaseError: ((error: unknown) => void) | undefined

  constructor(options: Readonly<DerivedTileSourceOptions>) {
    if (options.selections.length === 0) {
      throw invalidInput('Derived tile source requires at least one planned provider selection')
    }
    for (const selection of options.selections) {
      if (
        selection.implementation.descriptor.operationId !== options.operation.descriptor.id ||
        selection.implementation.descriptor.operationVersion !==
          options.operation.descriptor.version
      ) {
        throw invalidInput('Derived tile provider selection does not match the operation version')
      }
    }
    const parameters = options.operation.normalizeParameters(options.parameters)
    if (parameters.value === undefined) {
      throw invalidInput(parameters.issues[0]?.message ?? 'Derived tile parameters are invalid')
    }
    this.descriptor = options.descriptor
    this.#runtime = options.runtime
    this.#source = options.source
    this.#operation = options.operation
    this.#selections = Object.freeze([...options.selections])
    this.#parameters = parameters.value
    this.#nodeSemanticHash = boundedFingerprint(options.nodeSemanticHash, 'nodeSemanticHash')
    this.#executionFingerprint = boundedFingerprint(
      options.executionFingerprint,
      'executionFingerprint',
    )
    this.#sourceNamespace = boundedFingerprint(options.sourceNamespace, 'sourceNamespace')
    this.#pinned = options.pinned === true
    this.#boundaryMode = options.boundaryMode ?? 'clip'
    if (this.#boundaryMode !== 'clip') throw unsupportedOperation('Unsupported tile boundary mode')
    this.#halo = normalizeHalo(options.halo?.(parameters.value))
    this.#onReleaseError = options.onReleaseError
  }

  tileKey(request: Readonly<TileRequest>): string {
    const normalized = this.#normalizeRequest(request)
    const execution = this.#executionRequest(normalized, [])
    const selected = this.#select(execution)
    return canonicalTileKey(
      normalized,
      Object.freeze({
        nodeSemanticHash: this.#nodeSemanticHash,
        operation: Object.freeze({
          id: this.#operation.descriptor.id,
          version: this.#operation.descriptor.version,
        }),
        normalizedParameters: this.#parameters,
        executionFingerprint: this.#executionFingerprint,
        provider: Object.freeze({
          id: selected.provider.descriptor.id,
          version: selected.provider.descriptor.version,
          buildFingerprint: selected.provider.descriptor.buildFingerprint,
          implementationVersion: selected.implementation.descriptor.implementationVersion,
        }),
      }),
    )
  }

  async readTile(request: Readonly<TileRequest>): Promise<TileSourceResult> {
    const normalized = this.#normalizeRequest(request)
    const sourceAddress = this.#sourceAddress(normalized.address)
    const sourceRequest: TileRequest = Object.freeze({
      address: sourceAddress,
      priority: normalized.priority,
      signal: normalized.signal,
      ...(normalized.target === undefined ? {} : { target: normalized.target }),
    })
    const selected = this.#select(this.#executionRequest(normalized, []))
    const sourceTile = await this.#runtime.requestDependency(this.#source, sourceRequest)
    let outputs: readonly OperationOwnedOutput[] | undefined
    try {
      normalized.signal.throwIfAborted()
      const execution = this.#executionRequest(normalized, [sourceTile], sourceAddress)
      if (!selected.implementation.supports(execution)) {
        throw unsupportedOperation('Planned tile provider changed support after source resolution')
      }
      const estimate = selected.implementation.estimate(execution)
      const timing = estimateTiming(estimate, 0)
      const started = performance.now()
      outputs = await selected.implementation.execute(execution)
      const measured = performance.now() - started
      normalized.signal.throwIfAborted()
      if (outputs.length !== 1 || outputs[0] === undefined) {
        throw invalidInput('Derived tile provider must return exactly one owned output')
      }
      const output = outputs[0]
      if (!isNumericTile(output.value)) {
        throw invalidInput('Derived tile provider output is not a NumericTile')
      }
      validateNumericTile(output.value)
      if (
        output.value.x !== normalized.address.x ||
        output.value.y !== normalized.address.y ||
        output.value.width !== normalized.address.width ||
        output.value.height !== normalized.address.height
      ) {
        throw invalidInput('Derived tile provider returned halo pixels or the wrong output region')
      }
      if (output.value.data.buffer === sourceTile.data.buffer) {
        throw invalidInput('Derived tile provider must return distinct owned storage')
      }
      const releasedOutput = once(() => {
        try {
          const released = output.release()
          if (released !== undefined) {
            void released.catch((error: unknown) => this.#onReleaseError?.(error))
          }
        } catch (error) {
          this.#onReleaseError?.(error)
          throw error
        }
      })
      const tile: NumericTile = Object.freeze({ ...output.value, release: releasedOutput })
      const measuredTiming = Object.freeze({
        ...timing,
        computeMillisecondsMeasured: measured,
      })
      const retainedAuxiliaryBytes = Math.max(
        0,
        estimate.retainedBytes - output.value.data.byteLength,
      )
      outputs = undefined
      return Object.freeze({
        tile,
        accounting: Object.freeze({
          retainedAuxiliaryBytes,
          bytesRequested: sourceTile.data.byteLength,
          providerTiming: measuredTiming,
        }),
      })
    } catch (error) {
      if (outputs !== undefined) {
        try {
          await releaseOutputs(outputs)
        } catch {
          // Preserve the operation failure.
        }
      }
      throw error
    } finally {
      sourceTile.release()
    }
  }

  #sourceAddress(output: TileAddress): TileAddress {
    const level = this.descriptor.levels.find((entry) => entry.level === output.resolutionLevel)
    const horizontal = level?.axisLengths.find((entry) => entry.axisId === output.displayAxes[0])
    const vertical = level?.axisLengths.find((entry) => entry.axisId === output.displayAxes[1])
    if (horizontal === undefined || vertical === undefined) {
      throw invalidInput('Derived tile axes are unavailable at the requested resolution level')
    }
    if (output.x + output.width > horizontal.length || output.y + output.height > vertical.length) {
      throw invalidInput('Derived tile request is outside the selected plane')
    }
    const x = Math.max(0, output.x - this.#halo.left)
    const y = Math.max(0, output.y - this.#halo.top)
    const right = Math.min(horizontal.length, output.x + output.width + this.#halo.right)
    const bottom = Math.min(vertical.length, output.y + output.height + this.#halo.bottom)
    return Object.freeze({
      ...output,
      cacheClass: 'source',
      namespace: this.#sourceNamespace,
      x,
      y,
      width: right - x,
      height: bottom - y,
    })
  }

  #normalizeRequest(request: Readonly<TileRequest>): TileRequest {
    const normalized = normalizeTileRequest(request, this.#runtime.limits.maxTilePixels)
    if (normalized.address.cacheClass !== 'derived') {
      throw invalidInput('Derived tile source requires a derived cache address')
    }
    return Object.freeze({
      ...normalized,
      address: normalizeScientificTileAddress(this.descriptor, normalized.address),
    })
  }

  #executionContext(
    request: TileRequest,
    sourceAddress?: TileAddress,
  ): DerivedTileExecutionContext {
    const actualSource = sourceAddress ?? this.#sourceAddress(request.address)
    return Object.freeze({
      requested: tileRequestKeyData(request),
      source: Object.freeze({
        x: actualSource.x,
        y: actualSource.y,
        width: actualSource.width,
        height: actualSource.height,
      }),
      halo: Object.freeze({ ...this.#halo }),
      boundaryMode: this.#boundaryMode,
    })
  }

  #executionRequest(
    request: TileRequest,
    inputs: readonly unknown[],
    sourceAddress?: TileAddress,
  ): OperationProviderRequest {
    return Object.freeze({
      descriptor: this.#operation.descriptor,
      parameters: this.#parameters,
      inputs: Object.freeze([...inputs]),
      inputCharacteristics: this.#executionContext(request, sourceAddress),
      signal: request.signal,
    })
  }

  #select(request: OperationProviderRequest): OperationProviderSelection {
    const candidates = this.#pinned ? this.#selections.slice(0, 1) : this.#selections
    for (const selection of candidates) {
      if (selection.implementation.supports(request)) return selection
    }
    throw unsupportedOperation(
      this.#pinned
        ? 'Pinned tile provider declined the requested shape or sample type'
        : 'Every planned tile provider declined the requested shape or sample type',
    )
  }
}

export const createDerivedTileSource = (
  options: Readonly<DerivedTileSourceOptions>,
): DerivedTileSource => new DerivedTileSource(options)
