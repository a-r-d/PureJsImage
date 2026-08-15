import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import { rasterSampleBytes, type RasterBlock, type RasterSampleType } from '../../raster.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
  normalizeScientificSeriesReadRequest,
  type NormalizedScientificDatasetDescriptor,
  type ScientificDataset,
  type ScientificPlaneReadRequest,
  type ScientificSeriesBlock,
  type ScientificSeriesReadRequest,
} from '../dataset.ts'
import {
  createScientificDatasetIdentity,
  identifyScientificDataset,
  type ScientificDatasetIdentity,
  type ScientificDocument,
  type ScientificOpenContext,
  type ScientificReader,
  type ScientificReaderDescriptor,
} from '../reader.ts'
import type { Hdf5CompoundDatatype, Hdf5Datatype } from '../formats/hdf5-dataset.ts'
import { openHdf5File, type Hdf5File, type Hdf5OpenOptions } from '../formats/hdf5-file.ts'
import { readVeloxJsonColumn } from '../formats/velox-emd.ts'

export interface VeloxEmdReaderLimits {
  readonly maxDatasets: number
  readonly maxJsonBytes: number
  readonly maxOutputBytes: number
}

export interface VeloxEmdReaderOptions {
  readonly hdf5?: Readonly<Hdf5OpenOptions>
  readonly limits?: Readonly<Partial<VeloxEmdReaderLimits>>
}

interface ResolvedLimits extends VeloxEmdReaderLimits {}

interface VeloxSampleLayout {
  readonly sampleType: RasterSampleType
  readonly components: 1 | 2
  readonly elementBytes: number
  readonly littleEndian: boolean
  readonly frequencyDomain?: Readonly<{
    positiveFrequencyOnly: true
    centered: false
    storage: 'half-even' | 'half-odd'
  }>
}

interface VeloxDatasetEntry {
  readonly id: string
  readonly name: string
  readonly identity: ScientificDatasetIdentity
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly dataset: ScientificDataset
}

const defaults: ResolvedLimits = Object.freeze({
  maxDatasets: 4_096,
  maxJsonBytes: 1_048_576,
  maxOutputBytes: 268_435_456,
})

const positiveSafeInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (input: Readonly<Partial<VeloxEmdReaderLimits>> = {}): ResolvedLimits =>
  Object.freeze({
    maxDatasets: positiveSafeInteger(
      'Velox EMD maxDatasets',
      input.maxDatasets ?? defaults.maxDatasets,
    ),
    maxJsonBytes: positiveSafeInteger(
      'Velox EMD maxJsonBytes',
      input.maxJsonBytes ?? defaults.maxJsonBytes,
    ),
    maxOutputBytes: positiveSafeInteger(
      'Velox EMD maxOutputBytes',
      input.maxOutputBytes ?? defaults.maxOutputBytes,
    ),
  })

const checkedProduct = (values: readonly number[], maximum: number, label: string): number => {
  let product = 1n
  for (const value of values) {
    product *= BigInt(value)
    if (product > BigInt(maximum)) throw limitExceeded(`${label} exceeds ${maximum} bytes`)
  }
  return Number(product)
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nestedValue = (value: unknown, path: readonly string[]): unknown => {
  let current = value
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const optionalFiniteNumber = (value: unknown): number | undefined => {
  const number = typeof value === 'string' && value.length > 0 ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

const primitiveSampleLayout = (datatype: Hdf5Datatype): VeloxSampleLayout => {
  if (datatype.kind === 'float') {
    const sampleType =
      datatype.format === 'binary16'
        ? 'float16'
        : datatype.format === 'binary32'
          ? 'float32'
          : 'float64'
    return Object.freeze({
      sampleType,
      components: 1,
      elementBytes: datatype.byteLength,
      littleEndian: datatype.byteLength > 1 && datatype.byteOrder === 'little-endian',
    })
  }
  if (datatype.kind !== 'integer') {
    throw unsupportedOperation('Velox EMD image data is not a supported numeric array')
  }
  if (
    datatype.bitOffset !== 0 ||
    datatype.bitPrecision !== datatype.byteLength * 8 ||
    datatype.lowPadding !== 0 ||
    datatype.highPadding !== 0
  ) {
    throw unsupportedOperation('Velox EMD image data uses a packed integer datatype')
  }
  let sampleType: RasterSampleType
  if (datatype.signed) {
    if (datatype.byteLength === 1) sampleType = 'int8'
    else if (datatype.byteLength === 2) sampleType = 'int16'
    else if (datatype.byteLength === 4) sampleType = 'int32'
    else throw unsupportedOperation('Velox EMD signed integer width is unsupported')
  } else if (datatype.byteLength === 1) sampleType = 'uint8'
  else if (datatype.byteLength === 2) sampleType = 'uint16'
  else if (datatype.byteLength === 4) sampleType = 'uint32'
  else if (datatype.byteLength === 8) sampleType = 'uint64'
  else throw unsupportedOperation('Velox EMD unsigned integer width is unsupported')
  return Object.freeze({
    sampleType,
    components: 1,
    elementBytes: datatype.byteLength,
    littleEndian: datatype.byteLength > 1 && datatype.byteOrder === 'little-endian',
  })
}

const complexSampleLayout = (datatype: Hdf5CompoundDatatype): VeloxSampleLayout => {
  if (datatype.byteLength !== 8 || datatype.members.length !== 2) {
    throw unsupportedOperation('Velox EMD compound image data is not one complex float32 value')
  }
  const real = datatype.members[0]
  const imaginary = datatype.members[1]
  if (
    real === undefined ||
    imaginary === undefined ||
    real.offset !== 0 ||
    imaginary.offset !== 4 ||
    real.datatype.kind !== 'float' ||
    imaginary.datatype.kind !== 'float' ||
    real.datatype.format !== 'binary32' ||
    imaginary.datatype.format !== 'binary32' ||
    real.datatype.byteOrder !== imaginary.datatype.byteOrder
  ) {
    throw unsupportedOperation('Velox EMD complex image members are not paired float32 values')
  }
  const pair = `${real.name}\0${imaginary.name}`
  const frequencyDomain =
    pair === 'realFloatHalfEven\0imagFloatHalfEven'
      ? Object.freeze({
          positiveFrequencyOnly: true as const,
          centered: false as const,
          storage: 'half-even' as const,
        })
      : pair === 'realFloatHalfOdd\0imagFloatHalfOdd'
        ? Object.freeze({
            positiveFrequencyOnly: true as const,
            centered: false as const,
            storage: 'half-odd' as const,
          })
        : undefined
  if (frequencyDomain === undefined && pair !== 'realFloat\0imagFloat') {
    throw unsupportedOperation('Velox EMD complex image member names are unsupported')
  }
  return Object.freeze({
    sampleType: 'float32',
    components: 2,
    elementBytes: 8,
    littleEndian: real.datatype.byteOrder === 'little-endian',
    ...(frequencyDomain === undefined ? {} : { frequencyDomain }),
  })
}

const sampleLayout = (datatype: Hdf5Datatype): VeloxSampleLayout =>
  datatype.kind === 'compound' ? complexSampleLayout(datatype) : primitiveSampleLayout(datatype)

const canonicalData = (
  input: Uint8Array<ArrayBuffer>,
  shape: readonly number[],
  horizontalAxis: number,
  verticalAxis: number | undefined,
  layout: VeloxSampleLayout,
): Uint8Array<ArrayBuffer> => {
  const width = shape[horizontalAxis]
  const height = verticalAxis === undefined ? 1 : shape[verticalAxis]
  if (width === undefined || height === undefined)
    throw invalidInput('Velox EMD block shape is incomplete')
  const strides = new Array<number>(shape.length)
  let stride = 1
  for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
    strides[axis] = stride
    stride *= shape[axis] ?? 0
  }
  const horizontalStride = strides[horizontalAxis] ?? 0
  const verticalStride = verticalAxis === undefined ? 0 : (strides[verticalAxis] ?? 0)
  const direct = horizontalStride === 1 && (height === 1 || verticalStride === width)
  const output = direct ? input : new Uint8Array(input.byteLength)
  if (!direct) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const source = (y * verticalStride + x * horizontalStride) * layout.elementBytes
        output.set(
          input.subarray(source, source + layout.elementBytes),
          (y * width + x) * layout.elementBytes,
        )
      }
    }
  }
  const componentBytes = rasterSampleBytes(layout.sampleType)
  if (layout.littleEndian && componentBytes > 1) {
    for (let offset = 0; offset < output.byteLength; offset += componentBytes) {
      for (let left = 0, right = componentBytes - 1; left < right; left += 1, right -= 1) {
        const value = output[offset + left] ?? 0
        output[offset + left] = output[offset + right] ?? 0
        output[offset + right] = value
      }
    }
  }
  return output
}

class VeloxScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #file: Hdf5File
  readonly #path: string
  readonly #layout: VeloxSampleLayout
  readonly #maxOutputBytes: number

  constructor(
    file: Hdf5File,
    path: string,
    layout: VeloxSampleLayout,
    descriptor: NormalizedScientificDatasetDescriptor,
    maxOutputBytes: number,
  ) {
    this.#file = file
    this.#path = path
    this.#layout = layout
    this.descriptor = descriptor
    this.#maxOutputBytes = maxOutputBytes
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    checkedProduct(
      [normalized.width, normalized.height, this.#layout.elementBytes],
      this.#maxOutputBytes,
      'Velox EMD selected plane',
    )
    const horizontal = this.descriptor.axes.findIndex(({ id }) => id === normalized.displayAxes[0])
    const vertical = this.descriptor.axes.findIndex(({ id }) => id === normalized.displayAxes[1])
    const fixed = new Map(normalized.fixedIndices.map(({ axisId, index }) => [axisId, index]))
    const start = this.descriptor.axes.map((axis, index) =>
      index === horizontal
        ? normalized.x
        : index === vertical
          ? normalized.y
          : (fixed.get(axis.id) ?? 0),
    )
    const shape = this.descriptor.axes.map((_axis, index) =>
      index === horizontal ? normalized.width : index === vertical ? normalized.height : 1,
    )
    for await (const block of this.#file.readDataset(
      this.#path,
      { start, shape },
      normalized.signal === undefined ? {} : { signal: normalized.signal },
    )) {
      throwIfAborted(normalized.signal)
      const width = block.shape[horizontal]
      const height = block.shape[vertical]
      const x = block.start[horizontal]
      const y = block.start[vertical]
      if (width === undefined || height === undefined || x === undefined || y === undefined) {
        throw invalidInput('Velox EMD selected plane block is incomplete')
      }
      yield Object.freeze({
        x,
        y,
        width,
        height,
        stride: width * this.#layout.elementBytes,
        format: Object.freeze({
          sampleType: this.#layout.sampleType,
          channels: this.#layout.components,
          planar: false,
        }),
        data: canonicalData(block.data, block.shape, horizontal, vertical, this.#layout),
      })
    }
  }

  async *readSeries(
    request: Readonly<ScientificSeriesReadRequest>,
  ): AsyncIterable<ScientificSeriesBlock> {
    const normalized = normalizeScientificSeriesReadRequest(this.descriptor, request)
    const selected = this.descriptor.axes.findIndex(({ id }) => id === normalized.axisId)
    checkedProduct(
      [normalized.length, this.#layout.elementBytes],
      this.#maxOutputBytes,
      'Velox EMD selected series',
    )
    const fixed = new Map(normalized.fixedIndices.map(({ axisId, index }) => [axisId, index]))
    const start = this.descriptor.axes.map((axis, index) =>
      index === selected ? normalized.start : (fixed.get(axis.id) ?? 0),
    )
    const shape = this.descriptor.axes.map((_axis, index) =>
      index === selected ? normalized.length : 1,
    )
    for await (const block of this.#file.readDataset(
      this.#path,
      { start, shape },
      normalized.signal === undefined ? {} : { signal: normalized.signal },
    )) {
      const blockStart = block.start[selected]
      const length = block.shape[selected]
      if (blockStart === undefined || length === undefined) {
        throw invalidInput('Velox EMD selected series block is incomplete')
      }
      yield Object.freeze({
        start: blockStart,
        length,
        format: Object.freeze({
          sampleType: this.#layout.sampleType,
          channels: this.#layout.components,
          planar: false,
        }),
        data: canonicalData(block.data, block.shape, selected, undefined, this.#layout),
      })
    }
  }
}

export const veloxEmdReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/velox-emd',
  version: '1.0.0',
  format: 'FEI/Thermo Velox EMD',
  extensions: Object.freeze(['emd']),
  mediaTypes: Object.freeze(['application/x-hdf5']),
  capabilities: Object.freeze({
    datasets: 'image-arrays',
    axes: 'x-y-frame',
    nativePrecision: true,
    rangeReads: true,
  }),
})

const imageEntry = async (
  file: Hdf5File,
  context: Readonly<ScientificOpenContext>,
  id: string,
  limits: ResolvedLimits,
): Promise<VeloxDatasetEntry> => {
  const groupPath = `/Data/Image/${id}`
  const dataPath = `${groupPath}/Data`
  const metadataPath = `${groupPath}/Metadata`
  const data = await file.get(
    dataPath,
    context.signal === undefined ? {} : { signal: context.signal },
  )
  const metadataObject = await file.get(
    metadataPath,
    context.signal === undefined ? {} : { signal: context.signal },
  )
  if (data?.kind !== 'dataset' || metadataObject?.kind !== 'dataset') {
    throw invalidInput(`Velox EMD image ${JSON.stringify(id)} lacks Data or Metadata`)
  }
  const dimensions = data.metadata.dataspace.dimensions
  if (data.metadata.dataspace.rank !== 3 || dimensions.some((length) => length < 1)) {
    throw unsupportedOperation(
      `Velox EMD image ${JSON.stringify(id)} is not a rank-3 numeric array`,
    )
  }
  const layout = sampleLayout(data.metadata.datatype)
  const metadata = await readVeloxJsonColumn(
    file,
    metadataObject,
    metadataPath,
    0,
    limits.maxJsonBytes,
    context.signal,
  )
  const width = dimensions[0]
  const height = dimensions[1]
  const frames = dimensions[2]
  if (width === undefined || height === undefined || frames === undefined) {
    throw invalidInput(`Velox EMD image ${JSON.stringify(id)} has incomplete dimensions`)
  }
  const pixelWidth = optionalFiniteNumber(
    nestedValue(metadata, ['BinaryResult', 'PixelSize', 'width']),
  )
  const pixelHeight = optionalFiniteNumber(
    nestedValue(metadata, ['BinaryResult', 'PixelSize', 'height']),
  )
  const offsetX = optionalFiniteNumber(nestedValue(metadata, ['BinaryResult', 'Offset', 'x']))
  const offsetY = optionalFiniteNumber(nestedValue(metadata, ['BinaryResult', 'Offset', 'y']))
  const unitX = optionalString(nestedValue(metadata, ['BinaryResult', 'PixelUnitX']))
  const unitY = optionalString(nestedValue(metadata, ['BinaryResult', 'PixelUnitY']))
  const frameTime = optionalFiniteNumber(nestedValue(metadata, ['Scan', 'FrameTime']))
  const evidence = (locator: string) =>
    Object.freeze({ kind: 'embedded' as const, resourceId: context.primary.id, locator })
  const axes = [
    Object.freeze({
      id: 'x',
      name: 'X',
      kind: unitX === '1/m' ? ('reciprocal-space' as const) : ('space' as const),
      length: width,
      ...(unitX === undefined ? {} : { unit: unitX }),
      coordinates:
        pixelWidth !== undefined && pixelWidth !== 0
          ? Object.freeze({ type: 'linear' as const, origin: offsetX ?? 0, step: pixelWidth })
          : Object.freeze({ type: 'index' as const }),
      ...(pixelWidth === undefined || pixelWidth === 0
        ? {}
        : { calibration: evidence(`${metadataPath} BinaryResult.PixelSize.width`) }),
    }),
    Object.freeze({
      id: 'y',
      name: 'Y',
      kind: unitY === '1/m' ? ('reciprocal-space' as const) : ('space' as const),
      length: height,
      ...(unitY === undefined ? {} : { unit: unitY }),
      coordinates:
        pixelHeight !== undefined && pixelHeight !== 0
          ? Object.freeze({ type: 'linear' as const, origin: offsetY ?? 0, step: pixelHeight })
          : Object.freeze({ type: 'index' as const }),
      ...(pixelHeight === undefined || pixelHeight === 0
        ? {}
        : { calibration: evidence(`${metadataPath} BinaryResult.PixelSize.height`) }),
    }),
    Object.freeze({
      id: 'frame',
      name: 'Frame',
      kind: frameTime !== undefined && frameTime > 0 ? ('time' as const) : ('other' as const),
      length: frames,
      ...(frameTime !== undefined && frameTime > 0 ? { unit: 's' } : {}),
      coordinates:
        frameTime !== undefined && frameTime > 0
          ? Object.freeze({ type: 'linear' as const, origin: 0, step: frameTime })
          : Object.freeze({ type: 'index' as const }),
      ...(frameTime !== undefined && frameTime > 0
        ? { calibration: evidence(`${metadataPath} Scan.FrameTime`) }
        : {}),
    }),
  ]
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes,
    sampleType: layout.sampleType,
    components:
      layout.components === 1
        ? [{ id: 'value', name: 'Value', kind: 'scalar' }]
        : [
            { id: 'real', name: 'Real', kind: 'other' },
            { id: 'imaginary', name: 'Imaginary', kind: 'other' },
          ],
    metadata: {
      veloxEmd: {
        imageId: id,
        firstFrame: metadata,
        ...(layout.frequencyDomain === undefined
          ? {}
          : { frequencyDomain: layout.frequencyDomain }),
      },
    },
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'any-axis-pair' },
      seriesReads: { kind: 'axes', axes: ['x', 'y', 'frame'] },
    },
  })
  const identity = await createScientificDatasetIdentity({
    reader: veloxEmdReaderDescriptor,
    datasetId: id,
    resources: [context.primary],
  })
  const dataset = identifyScientificDataset(
    new VeloxScientificDataset(file, dataPath, layout, descriptor, limits.maxOutputBytes),
    identity,
  )
  const detector = optionalString(nestedValue(metadata, ['BinaryResult', 'Detector']))
  return Object.freeze({ id, name: detector ?? id, identity, descriptor, dataset })
}

const hasPrunedSpectrumImages = async (
  file: Hdf5File,
  signal: AbortSignal | undefined,
): Promise<boolean> => {
  const options = signal === undefined ? {} : { signal }
  const spectrumImages = await file.list('/Data/SpectrumImage', options)
  if (spectrumImages === undefined || spectrumImages.length === 0) return false
  const streams = await file.list('/Data/SpectrumStream', options)
  return streams === undefined || streams.length === 0
}

const openDocument = async (
  context: Readonly<ScientificOpenContext>,
  options: Readonly<VeloxEmdReaderOptions>,
  limits: ResolvedLimits,
): Promise<ScientificDocument> => {
  const file = await openHdf5File(context.primary.source, {
    ...(options.hdf5 ?? {}),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  try {
    const links = await file.list(
      '/Data/Image',
      context.signal === undefined ? {} : { signal: context.signal },
    )
    const imageIds = (links ?? []).filter(({ kind }) => kind === 'hard').map(({ name }) => name)
    const prunedSpectrumImages = await hasPrunedSpectrumImages(file, context.signal)
    if (imageIds.length === 0 && prunedSpectrumImages) {
      throw unsupportedOperation(
        'Velox EMD pruned spectrum image has no SpectrumStream event data and cannot be decoded',
      )
    }
    if (imageIds.length === 0) throw unsupportedOperation('Velox EMD contains no supported images')
    if (imageIds.length > limits.maxDatasets) {
      throw limitExceeded(`Velox EMD has ${imageIds.length} images; limit is ${limits.maxDatasets}`)
    }
    const entries: VeloxDatasetEntry[] = []
    for (const id of imageIds.sort()) {
      throwIfAborted(context.signal)
      entries.push(await imageEntry(file, context, id, limits))
    }
    return Object.freeze({
      reader: Object.freeze({
        id: veloxEmdReaderDescriptor.id,
        version: veloxEmdReaderDescriptor.version,
      }),
      format: veloxEmdReaderDescriptor.format,
      metadata: normalizeScientificMetadataObject({
        imageCount: entries.length,
        prunedSpectrumImages,
      }),
      datasets: Object.freeze(
        entries.map((entry) =>
          Object.freeze({
            id: entry.id,
            name: entry.name,
            descriptor: entry.descriptor,
            identity: entry.identity,
          }),
        ),
      ),
      async openDataset(id: string, openOptions: Readonly<AbortOptions> = {}) {
        throwIfAborted(openOptions.signal ?? context.signal)
        const entry = entries.find((candidate) => candidate.id === id)
        if (entry === undefined) throw invalidInput(`Unknown Velox EMD dataset ${id}`)
        return entry.dataset
      },
      close() {
        file.close()
      },
    })
  } catch (error: unknown) {
    file.close()
    throw error
  }
}

export const createVeloxEmdReader = (
  options: Readonly<VeloxEmdReaderOptions> = {},
): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: veloxEmdReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      let file: Hdf5File | undefined
      try {
        file = await openHdf5File(context.primary.source, {
          ...(options.hdf5 ?? {}),
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        })
        const version = await file.get(
          '/Version',
          context.signal === undefined ? {} : { signal: context.signal },
        )
        const data = await file.get(
          '/Data',
          context.signal === undefined ? {} : { signal: context.signal },
        )
        const image = await file.get(
          '/Data/Image',
          context.signal === undefined ? {} : { signal: context.signal },
        )
        const spectrumImage = await file.get(
          '/Data/SpectrumImage',
          context.signal === undefined ? {} : { signal: context.signal },
        )
        const matches =
          version?.kind === 'dataset' &&
          version.metadata.dataspace.elementCount === 1 &&
          (version.metadata.datatype.kind === 'fixed-string' ||
            version.metadata.datatype.kind === 'variable-string') &&
          data?.kind === 'group' &&
          (image?.kind === 'group' || spectrumImage?.kind === 'group')
        return Object.freeze({
          confidence: matches ? 0.995 : 0,
          reason: matches
            ? 'HDF5 contains Velox Version and Data image hierarchy'
            : 'Velox EMD hierarchy is absent',
        })
      } catch (error: unknown) {
        throwIfAborted(context.signal)
        if (error instanceof ImageError && error.code === 'LIMIT_EXCEEDED') throw error
        if (!(error instanceof ImageError)) throw error
        return Object.freeze({ confidence: 0, reason: 'Velox EMD hierarchy is absent' })
      } finally {
        file?.close()
      }
    },
    open(context: Readonly<ScientificOpenContext>) {
      return openDocument(context, options, limits)
    },
  })
}

export const veloxEmdReader = createVeloxEmdReader()
