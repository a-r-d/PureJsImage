import type { AbortOptions } from '../abort.ts'
import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type { RasterBlock, RasterSampleType } from '../raster.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from './dataset.ts'
import { validateRasterBlock } from './samples.ts'

export type NumericArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | BigUint64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array

/** Native tile storage types. Canonical float16 samples expand to float32. */
export type NumericSampleType = Exclude<RasterSampleType, 'float16'>
export type NumericTileLayout = 'interleaved' | 'planar'

export interface NumericTile {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly sampleType: NumericSampleType
  readonly componentCount: number
  readonly layout: NumericTileLayout
  readonly rowStrideElements: number
  readonly planeStrideElements?: number
  readonly data: NumericArray
  /** Idempotent ownership release. */
  readonly release: () => void
}

/** Bytes retained by keeping this tile's typed-array backing allocation alive. */
export const numericTileRetainedBytes = (tile: NumericTile): number => tile.data.buffer.byteLength

export interface NumericTileStorage {
  readonly data: NumericArray
  readonly release?: () => void
}

export interface NumericTileAllocationRequest {
  readonly sampleType: NumericSampleType
  readonly minimumElements: number
}

/** Caller-owned allocation policy. No allocator is installed globally. */
export interface NumericTileAllocator {
  allocate(request: Readonly<NumericTileAllocationRequest>): NumericTileStorage
}

export interface RasterBlockToNumericTileOptions extends AbortOptions {
  /** Omit to preserve the source type, except that float16 expands to float32. */
  readonly targetSampleType?: NumericSampleType
  /** Reusable caller-owned destination. It must have the exact requested typed-array class. */
  readonly destination?: NumericArray
  readonly allocator?: NumericTileAllocator
}

export interface ValidatedNumericTileLayout {
  readonly occupiedElements: number
  readonly requiredElements: number
}

const endianProbe = new Uint16Array([0x0102])
export const nativeLittleEndian = new Uint8Array(endianProbe.buffer)[0] === 0x02

const once = (callback: (() => void) | undefined): (() => void) => {
  let released = false
  return () => {
    if (released) return
    released = true
    callback?.()
  }
}

const numericSampleBytes = (sampleType: NumericSampleType): 1 | 2 | 4 | 8 => {
  if (sampleType === 'uint8' || sampleType === 'int8') return 1
  if (sampleType === 'uint16' || sampleType === 'int16') return 2
  if (sampleType === 'uint32' || sampleType === 'int32' || sampleType === 'float32') {
    return 4
  }
  return 8
}

const arraySampleType = (data: NumericArray): NumericSampleType => {
  if (data instanceof Uint8Array) return 'uint8'
  if (data instanceof Uint16Array) return 'uint16'
  if (data instanceof Uint32Array) return 'uint32'
  if (data instanceof BigUint64Array) return 'uint64'
  if (data instanceof Int8Array) return 'int8'
  if (data instanceof Int16Array) return 'int16'
  if (data instanceof Int32Array) return 'int32'
  if (data instanceof Float32Array) return 'float32'
  return 'float64'
}

const allocateArray = (sampleType: NumericSampleType, length: number): NumericArray => {
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

const halfFloat = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

const preservedSampleType = (sampleType: RasterSampleType): NumericSampleType =>
  sampleType === 'float16' ? 'float32' : sampleType

const isRasterSampleType = (value: unknown): value is RasterSampleType =>
  value === 'uint8' ||
  value === 'uint16' ||
  value === 'uint32' ||
  value === 'uint64' ||
  value === 'int8' ||
  value === 'int16' ||
  value === 'int32' ||
  value === 'float16' ||
  value === 'float32' ||
  value === 'float64'

const isNumericSampleType = (value: unknown): value is NumericSampleType =>
  isRasterSampleType(value) && value !== 'float16'

const elementStrides = (
  block: RasterBlock,
  bytesPerSample: number,
  planeStrideBytes: number,
): { readonly row: number; readonly plane?: number } => {
  const packedRow = block.width * (block.format.planar ? 1 : block.format.channels)
  const row = block.stride % bytesPerSample === 0 ? block.stride / bytesPerSample : packedRow
  if (!block.format.planar) return { row }
  const packedPlane = row * block.height
  const plane =
    planeStrideBytes % bytesPerSample === 0 ? planeStrideBytes / bytesPerSample : packedPlane
  return { row, plane }
}

const requiredElements = (
  block: RasterBlock,
  rowStrideElements: number,
  planeStrideElements: number | undefined,
): number => {
  const rowElements = block.width * (block.format.planar ? 1 : block.format.channels)
  const occupied = rowStrideElements * (block.height - 1) + rowElements
  return block.format.planar
    ? (planeStrideElements ?? occupied) * (block.format.channels - 1) + occupied
    : occupied
}

const validateStorage = (
  storage: NumericTileStorage,
  sampleType: NumericSampleType,
  minimumElements: number,
): void => {
  if (arraySampleType(storage.data) !== sampleType) {
    throw invalidInput(`Numeric tile storage must use ${sampleType} elements`)
  }
  if (storage.data.length < minimumElements) {
    throw invalidInput('Numeric tile storage is smaller than the required element count')
  }
}

const acquireStorage = (
  sampleType: NumericSampleType,
  minimumElements: number,
  options: Readonly<RasterBlockToNumericTileOptions>,
): NumericTileStorage => {
  if (options.destination !== undefined && options.allocator !== undefined) {
    throw invalidInput('Numeric tile conversion accepts either destination or allocator, not both')
  }
  const storage =
    options.destination !== undefined
      ? { data: options.destination }
      : (options.allocator?.allocate({ sampleType, minimumElements }) ?? {
          data: allocateArray(sampleType, minimumElements),
        })
  try {
    validateStorage(storage, sampleType, minimumElements)
  } catch (error) {
    storage.release?.()
    throw error
  }
  return storage
}

const sameNumber = (left: number, right: number): boolean =>
  left === right || (Number.isNaN(left) && Number.isNaN(right))

const checkedNumber = (value: number | bigint, target: NumericSampleType): number | bigint => {
  if (target === 'uint64') {
    if (typeof value === 'bigint') return value
    if (!Number.isSafeInteger(value) || value < 0) {
      throw invalidInput(`Numeric tile value ${value} cannot be represented exactly as uint64`)
    }
    return BigInt(value)
  }
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidInput(
        `Numeric tile uint64 value ${value} cannot be represented exactly as ${target}`,
      )
    }
    value = Number(value)
  }
  if (target === 'uint8') {
    if (!Number.isInteger(value) || value < 0 || value > 0xff)
      throw invalidInput('Numeric tile value is outside uint8')
    return value
  }
  if (target === 'uint16') {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff)
      throw invalidInput('Numeric tile value is outside uint16')
    return value
  }
  if (target === 'uint32') {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
      throw invalidInput('Numeric tile value is outside uint32')
    return value
  }
  if (target === 'int8') {
    if (!Number.isInteger(value) || value < -0x80 || value > 0x7f)
      throw invalidInput('Numeric tile value is outside int8')
    return value
  }
  if (target === 'int16') {
    if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff)
      throw invalidInput('Numeric tile value is outside int16')
    return value
  }
  if (target === 'int32') {
    if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff)
      throw invalidInput('Numeric tile value is outside int32')
    return value
  }
  if (target === 'float32') {
    const converted = Math.fround(value)
    if (!sameNumber(converted, value)) {
      throw invalidInput(`Numeric tile value ${value} cannot be represented exactly as float32`)
    }
    return converted
  }
  return value
}

const writeChecked = (
  destination: NumericArray,
  index: number,
  target: NumericSampleType,
  value: number | bigint,
): void => {
  const checked = checkedNumber(value, target)
  if (destination instanceof BigUint64Array) {
    if (typeof checked !== 'bigint') {
      throw invalidInput('Numeric tile uint64 conversion produced a non-bigint value')
    }
    destination[index] = checked
  } else {
    if (typeof checked !== 'number') {
      throw invalidInput('Numeric tile conversion produced an unexpected bigint value')
    }
    destination[index] = checked
  }
}

const sourceOffset = (
  block: RasterBlock,
  planeStride: number,
  bytesPerSample: number,
  x: number,
  y: number,
  component: number,
): number =>
  block.format.planar
    ? component * planeStride + y * block.stride + x * bytesPerSample
    : y * block.stride + (x * block.format.channels + component) * bytesPerSample

const targetOffset = (
  block: RasterBlock,
  rowStrideElements: number,
  planeStrideElements: number | undefined,
  x: number,
  y: number,
  component: number,
): number =>
  block.format.planar
    ? component * (planeStrideElements ?? 0) + y * rowStrideElements + x
    : y * rowStrideElements + x * block.format.channels + component

const readCanonical = (
  view: DataView,
  offset: number,
  sampleType: RasterSampleType,
): number | bigint => {
  if (sampleType === 'uint8') return view.getUint8(offset)
  if (sampleType === 'uint16') return view.getUint16(offset, false)
  if (sampleType === 'uint32') return view.getUint32(offset, false)
  if (sampleType === 'uint64') return view.getBigUint64(offset, false)
  if (sampleType === 'int8') return view.getInt8(offset)
  if (sampleType === 'int16') return view.getInt16(offset, false)
  if (sampleType === 'int32') return view.getInt32(offset, false)
  if (sampleType === 'float16') return halfFloat(view.getUint16(offset, false))
  if (sampleType === 'float32') return view.getFloat32(offset, false)
  return view.getFloat64(offset, false)
}

interface ConversionStrides {
  readonly sourceComponent: number
  readonly sourcePixel: number
  readonly targetComponent: number
  readonly targetPixel: number
}

const conversionStrides = (
  block: RasterBlock,
  planeStride: number,
  bytesPerSample: number,
  planeStrideElements: number | undefined,
): ConversionStrides =>
  block.format.planar
    ? {
        sourceComponent: planeStride,
        sourcePixel: bytesPerSample,
        targetComponent: planeStrideElements ?? 0,
        targetPixel: 1,
      }
    : {
        sourceComponent: bytesPerSample,
        sourcePixel: bytesPerSample * block.format.channels,
        targetComponent: 1,
        targetPixel: block.format.channels,
      }

const convertPreservedSamples = (
  block: RasterBlock,
  planeStride: number,
  destination: NumericArray,
  rowStrideElements: number,
  planeStrideElements: number | undefined,
  signal: AbortSignal | undefined,
): void => {
  const sampleType = block.format.sampleType
  const bytesPerSample =
    sampleType === 'float16' ? 2 : numericSampleBytes(preservedSampleType(sampleType))
  const strides = conversionStrides(block, planeStride, bytesPerSample, planeStrideElements)
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
  for (let component = 0; component < block.format.channels; component += 1) {
    const sourceComponent = component * strides.sourceComponent
    const targetComponent = component * strides.targetComponent
    for (let y = 0; y < block.height; y += 1) {
      throwIfAborted(signal)
      let source = sourceComponent + y * block.stride
      let target = targetComponent + y * rowStrideElements
      const end = source + block.width * strides.sourcePixel
      if (sampleType === 'uint8' && destination instanceof Uint8Array) {
        while (source < end) {
          destination[target] = view.getUint8(source)
          source += strides.sourcePixel
          target += strides.targetPixel
        }
      } else if (sampleType === 'int8' && destination instanceof Int8Array) {
        while (source < end) {
          destination[target] = view.getInt8(source)
          source += strides.sourcePixel
          target += strides.targetPixel
        }
      } else if (sampleType === 'uint16' && destination instanceof Uint16Array) {
        while (source < end) {
          destination[target] = view.getUint16(source, false)
          source += strides.sourcePixel
          target += strides.targetPixel
        }
      } else if (sampleType === 'int16' && destination instanceof Int16Array) {
        while (source < end) {
          destination[target] = view.getInt16(source, false)
          source += strides.sourcePixel
          target += strides.targetPixel
        }
      } else if (sampleType === 'float16' && destination instanceof Float32Array) {
        while (source < end) {
          destination[target] = halfFloat(view.getUint16(source, false))
          source += strides.sourcePixel
          target += strides.targetPixel
        }
      } else if (sampleType === 'uint32' && destination instanceof Uint32Array) {
        while (source < end) {
          destination[target] = view.getUint32(source, false)
          source += strides.sourcePixel
          target += strides.targetPixel
        }
      } else if (sampleType === 'int32' && destination instanceof Int32Array) {
        while (source < end) {
          destination[target] = view.getInt32(source, false)
          source += strides.sourcePixel
          target += strides.targetPixel
        }
      } else if (sampleType === 'float32' && destination instanceof Float32Array) {
        while (source < end) {
          destination[target] = view.getFloat32(source, false)
          source += strides.sourcePixel
          target += strides.targetPixel
        }
      } else if (sampleType === 'uint64' && destination instanceof BigUint64Array) {
        while (source < end) {
          destination[target] = view.getBigUint64(source, false)
          source += strides.sourcePixel
          target += strides.targetPixel
        }
      } else if (sampleType === 'float64' && destination instanceof Float64Array) {
        while (source < end) {
          destination[target] = view.getFloat64(source, false)
          source += strides.sourcePixel
          target += strides.targetPixel
        }
      } else {
        throw invalidInput('Numeric tile preserve conversion received incompatible storage')
      }
    }
  }
}

const convertCheckedSamples = (
  block: RasterBlock,
  planeStride: number,
  destination: NumericArray,
  target: NumericSampleType,
  rowStrideElements: number,
  planeStrideElements: number | undefined,
  signal: AbortSignal | undefined,
): void => {
  const bytesPerSample =
    block.format.sampleType === 'float16'
      ? 2
      : numericSampleBytes(preservedSampleType(block.format.sampleType))
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
  for (let component = 0; component < block.format.channels; component += 1) {
    for (let y = 0; y < block.height; y += 1) {
      throwIfAborted(signal)
      for (let x = 0; x < block.width; x += 1) {
        const source = sourceOffset(block, planeStride, bytesPerSample, x, y, component)
        const targetOffsetValue = targetOffset(
          block,
          rowStrideElements,
          planeStrideElements,
          x,
          y,
          component,
        )
        writeChecked(
          destination,
          targetOffsetValue,
          target,
          readCanonical(view, source, block.format.sampleType),
        )
      }
    }
  }
}

const canViewCanonicalStorage = (block: RasterBlock, target: NumericSampleType): boolean => {
  if (target !== block.format.sampleType) return false
  const bytes = numericSampleBytes(target)
  if (bytes === 1) return true
  if (nativeLittleEndian || block.data.byteOffset % bytes !== 0) return false
  if (block.stride % bytes !== 0) return false
  return !block.format.planar || (block.planeStride ?? 0) % bytes === 0
}

const nativeView = (data: Uint8Array, sampleType: NumericSampleType): NumericArray => {
  if (sampleType === 'uint8') return data
  if (sampleType === 'int8') return new Int8Array(data.buffer, data.byteOffset, data.byteLength)
  const bytes = numericSampleBytes(sampleType)
  const length = Math.floor(data.byteLength / bytes)
  if (sampleType === 'uint16') return new Uint16Array(data.buffer, data.byteOffset, length)
  if (sampleType === 'uint32') return new Uint32Array(data.buffer, data.byteOffset, length)
  if (sampleType === 'uint64') return new BigUint64Array(data.buffer, data.byteOffset, length)
  if (sampleType === 'int16') return new Int16Array(data.buffer, data.byteOffset, length)
  if (sampleType === 'int32') return new Int32Array(data.buffer, data.byteOffset, length)
  if (sampleType === 'float32') return new Float32Array(data.buffer, data.byteOffset, length)
  return new Float64Array(data.buffer, data.byteOffset, length)
}

export const validateNumericTile = (tile: NumericTile): ValidatedNumericTileLayout => {
  if (
    !Number.isSafeInteger(tile.x) ||
    !Number.isSafeInteger(tile.y) ||
    !Number.isSafeInteger(tile.width) ||
    !Number.isSafeInteger(tile.height) ||
    !Number.isSafeInteger(tile.componentCount) ||
    !Number.isSafeInteger(tile.rowStrideElements) ||
    tile.x < 0 ||
    tile.y < 0 ||
    tile.width < 1 ||
    tile.height < 1 ||
    tile.componentCount < 1
  ) {
    throw invalidInput('Numeric tile has invalid dimensions')
  }
  if (arraySampleType(tile.data) !== tile.sampleType) {
    throw invalidInput('Numeric tile data does not match its sample type')
  }
  const rowElements = tile.width * (tile.layout === 'planar' ? 1 : tile.componentCount)
  if (!Number.isSafeInteger(rowElements) || tile.rowStrideElements < rowElements) {
    throw invalidInput('Numeric tile has an invalid row stride')
  }
  const occupiedElements = tile.rowStrideElements * (tile.height - 1) + rowElements
  const planeStride = tile.layout === 'planar' ? tile.planeStrideElements : occupiedElements
  if (
    !Number.isSafeInteger(occupiedElements) ||
    planeStride === undefined ||
    !Number.isSafeInteger(planeStride) ||
    planeStride < occupiedElements
  ) {
    throw invalidInput('Numeric tile has an invalid plane stride')
  }
  const required =
    tile.layout === 'planar'
      ? planeStride * (tile.componentCount - 1) + occupiedElements
      : occupiedElements
  if (!Number.isSafeInteger(required) || tile.data.length < required) {
    throw invalidInput('Numeric tile contains truncated sample data')
  }
  return { occupiedElements, requiredElements: required }
}

export const numericTileSampleOffset = (
  tile: NumericTile,
  x: number,
  y: number,
  component: number,
): number =>
  tile.layout === 'planar'
    ? component * (tile.planeStrideElements ?? 0) + y * tile.rowStrideElements + x
    : y * tile.rowStrideElements + x * tile.componentCount + component

/**
 * Converts canonical big-endian bytes to native typed storage exactly once. Byte-sized preserved
 * inputs are zero-copy; wider types are zero-copy only on a big-endian host with aligned storage.
 */
export const rasterBlockToNumericTile = (
  block: RasterBlock,
  options: Readonly<RasterBlockToNumericTileOptions> = {},
): NumericTile => {
  const releaseBlock = once(block.release)
  let releaseStorage: (() => void) | undefined
  try {
    throwIfAborted(options.signal)
    const rasterLayout = validateRasterBlock(block)
    if (
      !Number.isSafeInteger(block.x) ||
      !Number.isSafeInteger(block.y) ||
      block.x < 0 ||
      block.y < 0
    ) {
      throw invalidInput('Numeric tile conversion received invalid coordinates')
    }
    const target = options.targetSampleType ?? preservedSampleType(block.format.sampleType)
    const strides = elementStrides(block, rasterLayout.bytesPerSample, rasterLayout.planeStride)
    const minimumElements = requiredElements(block, strides.row, strides.plane)
    const zeroCopy =
      options.destination === undefined &&
      options.allocator === undefined &&
      canViewCanonicalStorage(block, target)
    if (zeroCopy) {
      const tile: NumericTile = {
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        sampleType: target,
        componentCount: block.format.channels,
        layout: block.format.planar ? 'planar' : 'interleaved',
        rowStrideElements: strides.row,
        ...(strides.plane === undefined ? {} : { planeStrideElements: strides.plane }),
        data: nativeView(block.data, target),
        release: releaseBlock,
      }
      validateNumericTile(tile)
      return Object.freeze(tile)
    }
    const storage = acquireStorage(target, minimumElements, options)
    releaseStorage = once(storage.release)
    if (target === preservedSampleType(block.format.sampleType)) {
      convertPreservedSamples(
        block,
        rasterLayout.planeStride,
        storage.data,
        strides.row,
        strides.plane,
        options.signal,
      )
    } else {
      convertCheckedSamples(
        block,
        rasterLayout.planeStride,
        storage.data,
        target,
        strides.row,
        strides.plane,
        options.signal,
      )
    }
    releaseBlock()
    const tile: NumericTile = {
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      sampleType: target,
      componentCount: block.format.channels,
      layout: block.format.planar ? 'planar' : 'interleaved',
      rowStrideElements: strides.row,
      ...(strides.plane === undefined ? {} : { planeStrideElements: strides.plane }),
      data: storage.data,
      release: releaseStorage,
    }
    validateNumericTile(tile)
    return Object.freeze(tile)
  } catch (error) {
    releaseStorage?.()
    releaseBlock()
    throw error
  }
}

export interface NumericTileReadRequest extends ScientificPlaneReadRequest {
  readonly targetSampleType?: NumericSampleType
}

export interface NumericTileSourceSemantics {
  readonly sourceSampleType: RasterSampleType
  readonly nativeSampleType: NumericSampleType
  readonly componentCount: number
  readonly layout: NumericTileLayout
  readonly supportedTargetSampleTypes: readonly NumericSampleType[]
}

export interface NumericTileSource {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  /** Present for a direct provider and exact for every tile it emits. */
  readonly directSemantics?: NumericTileSourceSemantics
  /**
   * Hard upper bound for the backing allocation retained by one returned tile. Direct sources that
   * omit this may still return pooled or padded views, but downstream runtimes must compact them.
   */
  estimateRetainedBytes?(request: Readonly<NumericTileReadRequest>): number
  readNumericTiles(request: Readonly<NumericTileReadRequest>): AsyncIterable<NumericTile>
}

/** Optional, explicitly implemented native-tile capability on a scientific dataset. */
export interface DirectNumericTileDataset extends ScientificDataset {
  readonly numericTileSource: NumericTileSource
}

export interface ScientificDatasetNumericTileAdapterOptions {
  readonly allocator?: NumericTileAllocator
}

class DatasetNumericTileSource implements NumericTileSource {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #dataset: ScientificDataset
  readonly #allocator: NumericTileAllocator | undefined

  constructor(
    dataset: ScientificDataset,
    options: Readonly<ScientificDatasetNumericTileAdapterOptions>,
  ) {
    this.#dataset = dataset
    this.descriptor = dataset.descriptor
    this.#allocator = options.allocator
  }

  async *readNumericTiles(request: Readonly<NumericTileReadRequest>): AsyncGenerator<NumericTile> {
    const { targetSampleType, ...planeRequest } = request
    throwIfAborted(request.signal)
    for await (const block of this.#dataset.readPlane(planeRequest)) {
      yield rasterBlockToNumericTile(block, {
        ...(targetSampleType === undefined ? {} : { targetSampleType }),
        ...(this.#allocator === undefined ? {} : { allocator: this.#allocator }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    }
  }
}

export const scientificDatasetToNumericTileSource = (
  dataset: ScientificDataset,
  options: Readonly<ScientificDatasetNumericTileAdapterOptions> = {},
): NumericTileSource => new DatasetNumericTileSource(dataset, options)

const directNumericTileSource = (dataset: ScientificDataset): NumericTileSource | undefined => {
  if (!('numericTileSource' in dataset)) return undefined
  const candidate: unknown = dataset.numericTileSource
  if (candidate === null || typeof candidate !== 'object') return undefined
  if (!('readNumericTiles' in candidate) || typeof candidate.readNumericTiles !== 'function')
    return undefined
  if (!('descriptor' in candidate) || candidate.descriptor !== dataset.descriptor) return undefined
  if (!('directSemantics' in candidate) || candidate.directSemantics === undefined) return undefined
  const readNumericTiles = candidate.readNumericTiles
  const estimateRetainedBytes =
    'estimateRetainedBytes' in candidate && typeof candidate.estimateRetainedBytes === 'function'
      ? candidate.estimateRetainedBytes
      : undefined
  const semantics = candidate.directSemantics
  if (semantics === null || typeof semantics !== 'object') return undefined
  if (
    !('sourceSampleType' in semantics) ||
    !('nativeSampleType' in semantics) ||
    !('componentCount' in semantics) ||
    !('layout' in semantics) ||
    !('supportedTargetSampleTypes' in semantics) ||
    !Array.isArray(semantics.supportedTargetSampleTypes)
  ) {
    return undefined
  }
  const sourceSampleType = semantics.sourceSampleType
  const nativeSampleType = semantics.nativeSampleType
  const componentCount = semantics.componentCount
  const layout = semantics.layout
  const supportedTargetSampleTypes =
    semantics.supportedTargetSampleTypes.filter(isNumericSampleType)
  if (
    !isRasterSampleType(sourceSampleType) ||
    !isNumericSampleType(nativeSampleType) ||
    typeof componentCount !== 'number' ||
    (layout !== 'planar' && layout !== 'interleaved') ||
    supportedTargetSampleTypes.length !== semantics.supportedTargetSampleTypes.length
  ) {
    return undefined
  }
  const directSemantics: NumericTileSourceSemantics = {
    sourceSampleType,
    nativeSampleType,
    componentCount,
    layout,
    supportedTargetSampleTypes,
  }
  return {
    descriptor: dataset.descriptor,
    directSemantics,
    ...(estimateRetainedBytes === undefined
      ? {}
      : {
          estimateRetainedBytes: (request: Readonly<NumericTileReadRequest>) =>
            estimateRetainedBytes.call(candidate, request),
        }),
    readNumericTiles: (request) => readNumericTiles.call(candidate, request),
  }
}

const directSupports = (
  source: NumericTileSource,
  targetSampleType: NumericSampleType | undefined,
): boolean => {
  const semantics = source.directSemantics
  if (semantics === undefined) return false
  const expectedNative = preservedSampleType(source.descriptor.sampleType)
  if (
    semantics.sourceSampleType !== source.descriptor.sampleType ||
    semantics.nativeSampleType !== expectedNative ||
    semantics.componentCount !== source.descriptor.components.length
  ) {
    return false
  }
  if (!semantics.supportedTargetSampleTypes.includes(expectedNative)) return false
  return (
    targetSampleType === undefined ||
    semantics.supportedTargetSampleTypes.includes(targetSampleType)
  )
}

const validatedDirectTiles = async function* (
  source: NumericTileSource,
  request: Readonly<NumericTileReadRequest>,
): AsyncGenerator<NumericTile> {
  const semantics = source.directSemantics
  if (semantics === undefined) {
    throw invalidInput('Direct numeric tile source omitted its exact semantics')
  }
  const expectedSampleType = request.targetSampleType ?? semantics.nativeSampleType
  throwIfAborted(request.signal)
  for await (const tile of source.readNumericTiles(request)) {
    try {
      throwIfAborted(request.signal)
      validateNumericTile(tile)
      if (
        tile.sampleType !== expectedSampleType ||
        tile.componentCount !== semantics.componentCount ||
        tile.layout !== semantics.layout
      ) {
        throw invalidInput('Direct numeric tile source emitted undeclared tile semantics')
      }
    } catch (error) {
      tile.release()
      throw error
    }
    yield tile
  }
}

/** Selects an exact direct source when it declares support, otherwise returns the permanent adapter. */
export const resolveNumericTileSource = (
  dataset: ScientificDataset,
  options: Readonly<
    ScientificDatasetNumericTileAdapterOptions & { readonly targetSampleType?: NumericSampleType }
  > = {},
): NumericTileSource => {
  const direct = directNumericTileSource(dataset)
  const fallback = scientificDatasetToNumericTileSource(dataset, options)
  if (direct === undefined || !directSupports(direct, options.targetSampleType)) return fallback
  const semantics = direct.directSemantics
  if (semantics === undefined) return fallback
  return {
    descriptor: dataset.descriptor,
    directSemantics: semantics,
    ...(direct.estimateRetainedBytes === undefined
      ? {}
      : { estimateRetainedBytes: (request) => direct.estimateRetainedBytes?.(request) ?? 0 }),
    readNumericTiles(request) {
      return directSupports(direct, request.targetSampleType)
        ? validatedDirectTiles(direct, request)
        : fallback.readNumericTiles(request)
    },
  }
}
