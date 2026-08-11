import { invalidInput } from '../errors.ts'
import { rasterSampleBytes, type RasterBlock, type RasterSampleType } from '../raster.ts'
import type {
  MultidimensionalRasterDataset,
  PhysicalPixelSize,
  RasterChannelInfo,
  RasterPlaneRequest,
} from './dataset.ts'
import {
  rasterSampleOffset,
  readRasterSample,
  validateRasterBlock,
  writeRasterSample,
} from './samples.ts'

export type ScientificSliceAxis = 'xy' | 'xz' | 'yz'
export type ScientificProjectionMode = 'max' | 'min' | 'mean'

export interface ScientificVolumeSliceOptions {
  readonly axis: ScientificSliceAxis
  readonly index: number
  readonly c?: number
  readonly t?: number
}

export interface ScientificVolumeProjectionOptions {
  readonly axis?: 'z'
  readonly mode: ScientificProjectionMode
  readonly c?: number
  readonly t?: number
  /** Maximum output rows retained while one Z projection block is accumulated. */
  readonly rowsPerBlock?: number
}

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const selectedCoordinate = (value: number | undefined, size: number, name: string): number => {
  const selected = value ?? 0
  if (!Number.isSafeInteger(selected) || selected < 0 || selected >= size) {
    throw invalidInput(`Scientific volume ${name} coordinate is outside the dataset`)
  }
  return selected
}

const validateDerivedRequest = (
  request: Readonly<RasterPlaneRequest>,
  width: number,
  height: number,
): Region => {
  if (request.z !== 0 || request.t !== 0) {
    throw invalidInput('Derived scientific raster Z/T coordinates must be 0')
  }
  if (request.resolutionLevel !== undefined && request.resolutionLevel !== 0) {
    throw invalidInput('Derived scientific raster resolutionLevel must be 0')
  }
  const channels =
    request.c === undefined ? [0] : typeof request.c === 'number' ? [request.c] : request.c
  if (channels.length !== 1 || channels[0] !== 0) {
    throw invalidInput('Derived scientific raster channel selection must be 0')
  }
  const x = request.x ?? 0
  const y = request.y ?? 0
  const selectedWidth = request.width ?? width - x
  const selectedHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(selectedWidth) ||
    !Number.isSafeInteger(selectedHeight) ||
    x < 0 ||
    y < 0 ||
    selectedWidth < 1 ||
    selectedHeight < 1 ||
    x + selectedWidth > width ||
    y + selectedHeight > height
  ) {
    throw invalidInput('Derived scientific raster region is outside the dataset')
  }
  return { x, y, width: selectedWidth, height: selectedHeight }
}

const readScalarRegion = async (
  dataset: MultidimensionalRasterDataset,
  request: Readonly<RasterPlaneRequest>,
): Promise<Float64Array> => {
  const expectedX = request.x ?? 0
  const expectedWidth = request.width ?? dataset.sizeX
  const expectedHeight = request.height ?? dataset.sizeY
  const values = new Float64Array(expectedWidth * expectedHeight)
  let expectedY = request.y ?? 0
  for await (const block of dataset.readPlane(request)) {
    try {
      if (
        block.x !== expectedX ||
        block.y !== expectedY ||
        block.width !== expectedWidth ||
        block.format.channels !== 1
      ) {
        throw invalidInput('Scientific dataset emitted non-contiguous plane blocks')
      }
      const layout = validateRasterBlock(block)
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let row = 0; row < block.height; row += 1) {
        for (let x = 0; x < block.width; x += 1) {
          const target = (block.y - (request.y ?? 0) + row) * expectedWidth + x
          values[target] = readRasterSample(
            block.data,
            view,
            rasterSampleOffset(block, layout, x, row, 0),
            block.format.sampleType,
          )
        }
      }
      expectedY += block.height
    } finally {
      block.release?.()
    }
  }
  if (expectedY !== (request.y ?? 0) + expectedHeight) {
    throw invalidInput('Scientific dataset emitted an incomplete plane')
  }
  return values
}

const sliceGeometry = (
  dataset: MultidimensionalRasterDataset,
  axis: ScientificSliceAxis,
): {
  readonly width: number
  readonly height: number
  readonly physicalSizeX?: PhysicalPixelSize
  readonly physicalSizeY?: PhysicalPixelSize
  readonly originX?: PhysicalPixelSize
  readonly originY?: PhysicalPixelSize
} => {
  if (axis === 'xy') {
    return {
      width: dataset.sizeX,
      height: dataset.sizeY,
      ...(dataset.physicalSizeX === undefined ? {} : { physicalSizeX: dataset.physicalSizeX }),
      ...(dataset.physicalSizeY === undefined ? {} : { physicalSizeY: dataset.physicalSizeY }),
      ...(dataset.originX === undefined ? {} : { originX: dataset.originX }),
      ...(dataset.originY === undefined ? {} : { originY: dataset.originY }),
    }
  }
  if (axis === 'xz') {
    return {
      width: dataset.sizeX,
      height: dataset.sizeZ,
      ...(dataset.physicalSizeX === undefined ? {} : { physicalSizeX: dataset.physicalSizeX }),
      ...(dataset.physicalSizeZ === undefined ? {} : { physicalSizeY: dataset.physicalSizeZ }),
      ...(dataset.originX === undefined ? {} : { originX: dataset.originX }),
      ...(dataset.originZ === undefined ? {} : { originY: dataset.originZ }),
    }
  }
  return {
    width: dataset.sizeY,
    height: dataset.sizeZ,
    ...(dataset.physicalSizeY === undefined ? {} : { physicalSizeX: dataset.physicalSizeY }),
    ...(dataset.physicalSizeZ === undefined ? {} : { physicalSizeY: dataset.physicalSizeZ }),
    ...(dataset.originY === undefined ? {} : { originX: dataset.originY }),
    ...(dataset.originZ === undefined ? {} : { originY: dataset.originZ }),
  }
}

class VolumeSliceDataset implements MultidimensionalRasterDataset {
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ = 1
  readonly sizeC = 1
  readonly sizeT = 1
  readonly sampleType: RasterSampleType
  readonly dimensionOrder = 'XYZCT'
  readonly channels: readonly RasterChannelInfo[]
  readonly physicalSizeX?: PhysicalPixelSize
  readonly physicalSizeY?: PhysicalPixelSize
  readonly originX?: PhysicalPixelSize
  readonly originY?: PhysicalPixelSize
  readonly noDataValue?: number
  readonly metadata: Readonly<Record<string, string>>
  readonly #source: MultidimensionalRasterDataset
  readonly #axis: ScientificSliceAxis
  readonly #index: number
  readonly #channel: number
  readonly #time: number

  constructor(
    source: MultidimensionalRasterDataset,
    axis: ScientificSliceAxis,
    index: number,
    channel: number,
    time: number,
  ) {
    this.#source = source
    this.#axis = axis
    this.#index = index
    this.#channel = channel
    this.#time = time
    const geometry = sliceGeometry(source, axis)
    this.sizeX = geometry.width
    this.sizeY = geometry.height
    this.sampleType = source.sampleType
    this.channels = Object.freeze([source.channels[channel] ?? { samplesPerPixel: 1 }])
    if (geometry.physicalSizeX !== undefined) this.physicalSizeX = geometry.physicalSizeX
    if (geometry.physicalSizeY !== undefined) this.physicalSizeY = geometry.physicalSizeY
    if (geometry.originX !== undefined) this.originX = geometry.originX
    if (geometry.originY !== undefined) this.originY = geometry.originY
    if (source.noDataValue !== undefined) this.noDataValue = source.noDataValue
    this.metadata = Object.freeze({
      ...(source.metadata ?? {}),
      derivedOperation: `${axis} slice`,
      sourceIndex: String(index),
    })
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    const region = validateDerivedRequest(request, this.sizeX, this.sizeY)
    if (this.#axis === 'xy') {
      yield* this.#source.readPlane({
        z: this.#index,
        c: this.#channel,
        t: this.#time,
        ...region,
      })
      return
    }
    const bytesPerSample = rasterSampleBytes(this.sampleType)
    const rowBytes = region.width * bytesPerSample
    for (let row = 0; row < region.height; row += 1) {
      const sourceZ = region.y + row
      const values =
        this.#axis === 'xz'
          ? await readScalarRegion(this.#source, {
              z: sourceZ,
              c: this.#channel,
              t: this.#time,
              x: region.x,
              y: this.#index,
              width: region.width,
              height: 1,
            })
          : await readScalarRegion(this.#source, {
              z: sourceZ,
              c: this.#channel,
              t: this.#time,
              x: this.#index,
              y: region.x,
              width: 1,
              height: region.width,
            })
      const output = new Uint8Array(rowBytes)
      const view = new DataView(output.buffer)
      for (let x = 0; x < region.width; x += 1) {
        writeRasterSample(view, x * bytesPerSample, this.sampleType, values[x] ?? Number.NaN)
      }
      yield {
        x: region.x,
        y: region.y + row,
        width: region.width,
        height: 1,
        stride: rowBytes,
        format: Object.freeze({ sampleType: this.sampleType, channels: 1, planar: false }),
        data: output,
      }
    }
  }
}

const projectionSampleType = (
  source: MultidimensionalRasterDataset,
  mode: ScientificProjectionMode,
): RasterSampleType => {
  if (mode === 'mean') return 'float64'
  const integer =
    source.sampleType === 'uint8' ||
    source.sampleType === 'uint16' ||
    source.sampleType === 'uint32' ||
    source.sampleType === 'uint64' ||
    source.sampleType === 'int8' ||
    source.sampleType === 'int16' ||
    source.sampleType === 'int32'
  return integer ? 'float64' : source.sampleType
}

const usableProjectionValue = (value: number, noDataValue: number | undefined): boolean =>
  Number.isFinite(value) &&
  (noDataValue === undefined ||
    (Number.isNaN(noDataValue) ? !Number.isNaN(value) : value !== noDataValue))

class VolumeProjectionDataset implements MultidimensionalRasterDataset {
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ = 1
  readonly sizeC = 1
  readonly sizeT = 1
  readonly sampleType: RasterSampleType
  readonly dimensionOrder = 'XYZCT'
  readonly channels: readonly RasterChannelInfo[]
  readonly physicalSizeX?: PhysicalPixelSize
  readonly physicalSizeY?: PhysicalPixelSize
  readonly originX?: PhysicalPixelSize
  readonly originY?: PhysicalPixelSize
  readonly metadata: Readonly<Record<string, string>>
  readonly #source: MultidimensionalRasterDataset
  readonly #mode: ScientificProjectionMode
  readonly #channel: number
  readonly #time: number
  readonly #rowsPerBlock: number

  constructor(
    source: MultidimensionalRasterDataset,
    mode: ScientificProjectionMode,
    channel: number,
    time: number,
    rowsPerBlock: number,
  ) {
    this.#source = source
    this.#mode = mode
    this.#channel = channel
    this.#time = time
    this.#rowsPerBlock = rowsPerBlock
    this.sizeX = source.sizeX
    this.sizeY = source.sizeY
    this.sampleType = projectionSampleType(source, mode)
    this.channels = Object.freeze([source.channels[channel] ?? { samplesPerPixel: 1 }])
    if (source.physicalSizeX !== undefined) this.physicalSizeX = source.physicalSizeX
    if (source.physicalSizeY !== undefined) this.physicalSizeY = source.physicalSizeY
    if (source.originX !== undefined) this.originX = source.originX
    if (source.originY !== undefined) this.originY = source.originY
    this.metadata = Object.freeze({
      ...(source.metadata ?? {}),
      derivedOperation: `${mode} Z projection`,
    })
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    const region = validateDerivedRequest(request, this.sizeX, this.sizeY)
    const bytesPerSample = rasterSampleBytes(this.sampleType)
    const rowBytes = region.width * bytesPerSample
    for (let localY = 0; localY < region.height; localY += this.#rowsPerBlock) {
      const blockHeight = Math.min(this.#rowsPerBlock, region.height - localY)
      const sampleCount = region.width * blockHeight
      const values = new Float64Array(sampleCount)
      values.fill(this.#mode === 'min' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
      const counts = new Uint32Array(sampleCount)
      for (let z = 0; z < this.#source.sizeZ; z += 1) {
        const plane = await readScalarRegion(this.#source, {
          z,
          c: this.#channel,
          t: this.#time,
          x: region.x,
          y: region.y + localY,
          width: region.width,
          height: blockHeight,
        })
        for (let index = 0; index < sampleCount; index += 1) {
          const value = plane[index] ?? Number.NaN
          if (!usableProjectionValue(value, this.#source.noDataValue)) continue
          if (this.#mode === 'mean') {
            values[index] = (counts[index] === 0 ? 0 : (values[index] ?? 0)) + value
          } else if (this.#mode === 'min') {
            values[index] = Math.min(values[index] ?? Number.POSITIVE_INFINITY, value)
          } else {
            values[index] = Math.max(values[index] ?? Number.NEGATIVE_INFINITY, value)
          }
          counts[index] = (counts[index] ?? 0) + 1
        }
      }
      const output = new Uint8Array(rowBytes * blockHeight)
      const view = new DataView(output.buffer)
      for (let index = 0; index < sampleCount; index += 1) {
        const count = counts[index] ?? 0
        const value =
          count === 0
            ? Number.NaN
            : this.#mode === 'mean'
              ? (values[index] ?? 0) / count
              : (values[index] ?? Number.NaN)
        writeRasterSample(view, index * bytesPerSample, this.sampleType, value)
      }
      yield {
        x: region.x,
        y: region.y + localY,
        width: region.width,
        height: blockHeight,
        stride: rowBytes,
        format: Object.freeze({ sampleType: this.sampleType, channels: 1, planar: false }),
        data: output,
      }
    }
  }
}

/**
 * Returns a lazy 2D XY, XZ, or YZ numeric slice of a 3D dataset. XY reads are
 * forwarded to the source. XZ and YZ reads retain one output row at a time and
 * request only the contributing source row or column from each selected Z plane.
 */
export const sliceScientificVolume = (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<ScientificVolumeSliceOptions>,
): MultidimensionalRasterDataset => {
  if (options.axis !== 'xy' && options.axis !== 'xz' && options.axis !== 'yz') {
    throw invalidInput(`Unknown scientific slice axis ${options.axis}`)
  }
  const indexSize =
    options.axis === 'xy' ? dataset.sizeZ : options.axis === 'xz' ? dataset.sizeY : dataset.sizeX
  const index = selectedCoordinate(options.index, indexSize, 'slice')
  const channel = selectedCoordinate(options.c, dataset.sizeC, 'channel')
  const time = selectedCoordinate(options.t, dataset.sizeT, 'time')
  return new VolumeSliceDataset(dataset, options.axis, index, channel, time)
}

/**
 * Returns a lazy maximum, minimum, or mean projection along Z. Each output block
 * scans all contributing Z planes but retains only `rowsPerBlock` output rows,
 * one float accumulator per output sample, and one count per output sample.
 * NaN, infinity, and the source no-data value are ignored. A location with no
 * valid contributing sample is NaN. Mean output is float64.
 */
export const projectScientificVolume = (
  dataset: MultidimensionalRasterDataset,
  options: Readonly<ScientificVolumeProjectionOptions>,
): MultidimensionalRasterDataset => {
  if (options.axis !== undefined && options.axis !== 'z') {
    throw invalidInput('Scientific volume projection currently supports only the Z axis')
  }
  if (options.mode !== 'max' && options.mode !== 'min' && options.mode !== 'mean') {
    throw invalidInput(`Unknown scientific projection mode ${options.mode}`)
  }
  const rowsPerBlock = options.rowsPerBlock ?? 16
  if (!Number.isSafeInteger(rowsPerBlock) || rowsPerBlock < 1) {
    throw invalidInput('Scientific projection rowsPerBlock must be a positive safe integer')
  }
  const channel = selectedCoordinate(options.c, dataset.sizeC, 'channel')
  const time = selectedCoordinate(options.t, dataset.sizeT, 'time')
  return new VolumeProjectionDataset(dataset, options.mode, channel, time, rowsPerBlock)
}
