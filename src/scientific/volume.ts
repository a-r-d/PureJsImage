import { invalidInput } from '../errors.ts'
import { rasterSampleBytes, type RasterBlock, type RasterSampleType } from '../raster.ts'
import type {
  MultidimensionalRasterDataset,
  PhysicalPixelSize,
  RasterChannelInfo,
  RasterPlaneRequest,
} from './dataset.ts'
import { isLabeledScientificDataset } from './dataset-adapters.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisIndex,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from './dataset-v2.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from './dataset-v2.ts'
import type { NumericArray, NumericTile, NumericTileSource } from './numeric-tile.ts'
import {
  rasterBlockToNumericTile,
  resolveNumericTileSource,
  validateNumericTile,
} from './numeric-tile.ts'
import { writeRasterSample } from './samples.ts'

type NumberNumericArray = Exclude<NumericArray, BigUint64Array>

const numericSource = (dataset: ScientificDataset): NumericTileSource =>
  resolveNumericTileSource(dataset, {
    ...(dataset.descriptor.sampleType === 'uint64' ? { targetSampleType: 'float64' } : {}),
  })

const numberTileData = (tile: NumericTile): NumberNumericArray => {
  validateNumericTile(tile)
  if (tile.data instanceof BigUint64Array) {
    throw invalidInput('Scientific uint64 values must be exactly convertible to float64')
  }
  return tile.data
}

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

export interface LabeledScientificVolumeSliceOptions {
  readonly displayAxes: readonly [horizontal: string, vertical: string]
  readonly fixedIndices: readonly ScientificAxisIndex[]
}

export interface LabeledScientificVolumeProjectionOptions {
  readonly displayAxes: readonly [horizontal: string, vertical: string]
  /** Explicit semantic axis to reduce. It must not be one of `displayAxes`. */
  readonly axis: string
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly mode: ScientificProjectionMode
  /** Maximum output rows retained while one reduction block is accumulated. */
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
    const tile = rasterBlockToNumericTile(block, {
      ...(block.format.sampleType === 'uint64' ? { targetSampleType: 'float64' } : {}),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    try {
      if (
        tile.x !== expectedX ||
        tile.y !== expectedY ||
        tile.width !== expectedWidth ||
        tile.componentCount !== 1
      ) {
        throw invalidInput('Scientific dataset emitted non-contiguous plane blocks')
      }
      const input = numberTileData(tile)
      for (let row = 0; row < tile.height; row += 1) {
        const sourceRow = row * tile.rowStrideElements
        for (let x = 0; x < tile.width; x += 1) {
          const target = (tile.y - (request.y ?? 0) + row) * expectedWidth + x
          values[target] = input[sourceRow + x] ?? Number.NaN
        }
      }
      expectedY += tile.height
    } finally {
      tile.release()
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
  sourceSampleType: RasterSampleType,
  mode: ScientificProjectionMode,
): RasterSampleType => {
  if (mode === 'mean') return 'float64'
  const integer =
    sourceSampleType === 'uint8' ||
    sourceSampleType === 'uint16' ||
    sourceSampleType === 'uint32' ||
    sourceSampleType === 'uint64' ||
    sourceSampleType === 'int8' ||
    sourceSampleType === 'int16' ||
    sourceSampleType === 'int32'
  return integer ? 'float64' : sourceSampleType
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
    this.sampleType = projectionSampleType(source.sampleType, mode)
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

const labeledDerivedDescriptor = (
  source: ScientificDataset,
  displayAxes: readonly [string, string],
  sampleType: RasterSampleType,
  operation: string,
): NormalizedScientificDatasetDescriptor => {
  const axes = displayAxes.map((axisId) => {
    const axis = source.descriptor.axes.find((candidate) => candidate.id === axisId)
    if (axis === undefined) throw invalidInput(`Scientific volume axis ${axisId} is unknown`)
    return axis
  })
  const levels = source.descriptor.levels.map((level) => ({
    level: level.level,
    axisLengths: displayAxes.map((axisId) => {
      const entry = level.axisLengths.find((candidate) => candidate.axisId === axisId)
      if (entry === undefined) throw invalidInput(`Scientific level omits display axis ${axisId}`)
      return entry
    }),
  }))
  return normalizeScientificDatasetDescriptor({
    schemaVersion: 2,
    axes,
    sampleType,
    components: source.descriptor.components,
    levels,
    ...(source.descriptor.noDataValue === undefined || sampleType === 'float64'
      ? sampleType === 'float64'
        ? { noDataValue: Number.NaN }
        : {}
      : { noDataValue: source.descriptor.noDataValue }),
    metadata: {
      source: source.descriptor.metadata ?? {},
      derived: { operation },
    },
    capabilities: {
      regionReads: source.descriptor.capabilities.regionReads,
      resolutionLevels: levels.length > 1,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [displayAxes] },
    },
  })
}

class LabeledSliceDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ScientificDataset
  readonly #displayAxes: readonly [string, string]
  readonly #fixedIndices: readonly ScientificAxisIndex[]

  constructor(source: ScientificDataset, options: Readonly<LabeledScientificVolumeSliceOptions>) {
    const selection = normalizeScientificPlaneReadRequest(source.descriptor, {
      displayAxes: options.displayAxes,
      fixedIndices: options.fixedIndices,
    })
    this.#source = source
    this.#displayAxes = selection.displayAxes
    this.#fixedIndices = selection.fixedIndices
    this.descriptor = labeledDerivedDescriptor(
      source,
      selection.displayAxes,
      source.descriptor.sampleType,
      `slice ${selection.displayAxes.join('/')}`,
    )
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    if (
      normalized.displayAxes[0] !== this.#displayAxes[0] ||
      normalized.displayAxes[1] !== this.#displayAxes[1]
    ) {
      throw invalidInput('Derived scientific slice display axes cannot be reordered')
    }
    yield* this.#source.readPlane({
      displayAxes: this.#displayAxes,
      fixedIndices: this.#fixedIndices,
      resolutionLevel: normalized.resolutionLevel,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    })
  }
}

const readLabeledScalarRegion = async (
  dataset: ScientificDataset,
  request: Readonly<ScientificPlaneReadRequest>,
): Promise<Float64Array> => {
  const normalized = normalizeScientificPlaneReadRequest(dataset.descriptor, request)
  const source = numericSource(dataset)
  const values = new Float64Array(normalized.width * normalized.height)
  let expectedY = normalized.y
  for await (const tile of source.readNumericTiles({
    ...normalized,
    ...(dataset.descriptor.sampleType === 'uint64' ? { targetSampleType: 'float64' } : {}),
  })) {
    try {
      if (
        tile.x !== normalized.x ||
        tile.y !== expectedY ||
        tile.width !== normalized.width ||
        tile.componentCount !== 1
      ) {
        throw invalidInput('Scientific dataset emitted non-contiguous scalar plane blocks')
      }
      const input = numberTileData(tile)
      for (let row = 0; row < tile.height; row += 1) {
        const sourceRow = row * tile.rowStrideElements
        for (let x = 0; x < tile.width; x += 1) {
          const target = (tile.y - normalized.y + row) * normalized.width + x
          values[target] = input[sourceRow + x] ?? Number.NaN
        }
      }
      expectedY += tile.height
    } finally {
      tile.release()
    }
  }
  if (expectedY !== normalized.y + normalized.height) {
    throw invalidInput('Scientific dataset emitted an incomplete scalar plane')
  }
  return values
}

class LabeledProjectionDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ScientificDataset
  readonly #displayAxes: readonly [string, string]
  readonly #axis: string
  readonly #fixedIndices: readonly ScientificAxisIndex[]
  readonly #mode: ScientificProjectionMode
  readonly #rowsPerBlock: number

  constructor(
    source: ScientificDataset,
    options: Readonly<LabeledScientificVolumeProjectionOptions>,
  ) {
    if (source.descriptor.components.length !== 1) {
      throw invalidInput('Scientific projection requires exactly one stored component')
    }
    if (options.displayAxes.includes(options.axis)) {
      throw invalidInput('Scientific projection axis must differ from both display axes')
    }
    const reductionAxis = source.descriptor.axes.find((axis) => axis.id === options.axis)
    if (reductionAxis === undefined) {
      throw invalidInput(`Scientific projection axis ${options.axis} is unknown`)
    }
    if (options.fixedIndices.some((selection) => selection.axisId === options.axis)) {
      throw invalidInput('Scientific projection axis must not also have a fixed index')
    }
    const validationFixed = [...options.fixedIndices, { axisId: options.axis, index: 0 }]
    const selection = normalizeScientificPlaneReadRequest(source.descriptor, {
      displayAxes: options.displayAxes,
      fixedIndices: validationFixed,
    })
    const rowsPerBlock = options.rowsPerBlock ?? 16
    if (!Number.isSafeInteger(rowsPerBlock) || rowsPerBlock < 1) {
      throw invalidInput('Scientific projection rowsPerBlock must be a positive safe integer')
    }
    if (options.mode !== 'max' && options.mode !== 'min' && options.mode !== 'mean') {
      throw invalidInput(`Unknown scientific projection mode ${options.mode}`)
    }
    this.#source = source
    this.#displayAxes = selection.displayAxes
    this.#axis = options.axis
    this.#fixedIndices = Object.freeze(
      selection.fixedIndices.filter((fixed) => fixed.axisId !== options.axis),
    )
    this.#mode = options.mode
    this.#rowsPerBlock = rowsPerBlock
    const sampleType = projectionSampleType(source.descriptor.sampleType, options.mode)
    this.descriptor = labeledDerivedDescriptor(
      source,
      selection.displayAxes,
      sampleType,
      `${options.mode} projection over ${options.axis}`,
    )
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    if (
      normalized.displayAxes[0] !== this.#displayAxes[0] ||
      normalized.displayAxes[1] !== this.#displayAxes[1]
    ) {
      throw invalidInput('Derived scientific projection display axes cannot be reordered')
    }
    const bytesPerSample = rasterSampleBytes(this.descriptor.sampleType)
    const sourceLevel = this.#source.descriptor.levels.find(
      (level) => level.level === normalized.resolutionLevel,
    )
    const axisLength = sourceLevel?.axisLengths.find((entry) => entry.axisId === this.#axis)?.length
    if (axisLength === undefined) {
      throw invalidInput(`Scientific level omits reduction axis ${this.#axis}`)
    }
    for (let localY = 0; localY < normalized.height; localY += this.#rowsPerBlock) {
      const blockHeight = Math.min(this.#rowsPerBlock, normalized.height - localY)
      const sampleCount = normalized.width * blockHeight
      const values = new Float64Array(sampleCount)
      values.fill(this.#mode === 'min' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
      const counts = new Uint32Array(sampleCount)
      for (let axisIndex = 0; axisIndex < axisLength; axisIndex += 1) {
        const plane = await readLabeledScalarRegion(this.#source, {
          displayAxes: this.#displayAxes,
          fixedIndices: [...this.#fixedIndices, { axisId: this.#axis, index: axisIndex }],
          resolutionLevel: normalized.resolutionLevel,
          x: normalized.x,
          y: normalized.y + localY,
          width: normalized.width,
          height: blockHeight,
          ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
        })
        for (let index = 0; index < sampleCount; index += 1) {
          const value = plane[index] ?? Number.NaN
          if (!usableProjectionValue(value, this.#source.descriptor.noDataValue)) continue
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
      const output = new Uint8Array(sampleCount * bytesPerSample)
      const view = new DataView(output.buffer)
      for (let index = 0; index < sampleCount; index += 1) {
        const count = counts[index] ?? 0
        const value =
          count === 0
            ? Number.NaN
            : this.#mode === 'mean'
              ? (values[index] ?? 0) / count
              : (values[index] ?? Number.NaN)
        writeRasterSample(view, index * bytesPerSample, this.descriptor.sampleType, value)
      }
      yield {
        x: normalized.x,
        y: normalized.y + localY,
        width: normalized.width,
        height: blockHeight,
        stride: normalized.width * bytesPerSample,
        format: Object.freeze({
          sampleType: this.descriptor.sampleType,
          channels: 1,
          planar: false,
        }),
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
export function sliceScientificVolume(
  dataset: MultidimensionalRasterDataset,
  options: Readonly<ScientificVolumeSliceOptions>,
): MultidimensionalRasterDataset
export function sliceScientificVolume(
  dataset: ScientificDataset,
  options: Readonly<LabeledScientificVolumeSliceOptions>,
): ScientificDataset
export function sliceScientificVolume(
  dataset: MultidimensionalRasterDataset | ScientificDataset,
  options: Readonly<ScientificVolumeSliceOptions | LabeledScientificVolumeSliceOptions>,
): MultidimensionalRasterDataset | ScientificDataset {
  if (isLabeledScientificDataset(dataset)) {
    if (!('displayAxes' in options)) {
      throw invalidInput('A labeled-axis slice requires explicit display axes and fixed indices')
    }
    return new LabeledSliceDataset(dataset, options)
  }
  if ('displayAxes' in options) {
    throw invalidInput('A fixed-axis slice requires xy, xz, or yz coordinates')
  }
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
export function projectScientificVolume(
  dataset: MultidimensionalRasterDataset,
  options: Readonly<ScientificVolumeProjectionOptions>,
): MultidimensionalRasterDataset
export function projectScientificVolume(
  dataset: ScientificDataset,
  options: Readonly<LabeledScientificVolumeProjectionOptions>,
): ScientificDataset
export function projectScientificVolume(
  dataset: MultidimensionalRasterDataset | ScientificDataset,
  options: Readonly<ScientificVolumeProjectionOptions | LabeledScientificVolumeProjectionOptions>,
): MultidimensionalRasterDataset | ScientificDataset {
  if (isLabeledScientificDataset(dataset)) {
    if (!('displayAxes' in options)) {
      throw invalidInput('A labeled-axis projection requires explicit display and reduction axes')
    }
    return new LabeledProjectionDataset(dataset, options)
  }
  if ('displayAxes' in options) {
    throw invalidInput('A fixed-axis projection does not accept labeled display axes')
  }
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
