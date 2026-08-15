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
  type ScientificAxisKind,
  type ScientificDataset,
  type ScientificMetadataObject,
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
import type { Hdf5Datatype } from './hdf5-dataset.ts'
import {
  openHdf5File,
  type Hdf5DatasetObject,
  type Hdf5File,
  type Hdf5OpenOptions,
} from './hdf5-file.ts'
import {
  inspectNcemEmd,
  ncemEmdVersionPart,
  type NcemEmdInspectionLimits,
  type NcemEmdNumericGroup,
} from './ncem-emd.ts'

export interface NcemEmdReaderOptions {
  readonly hdf5?: Readonly<Hdf5OpenOptions>
  readonly inspection?: Readonly<NcemEmdInspectionLimits>
  readonly maxPlaneBytes?: number
}

interface NcemEmdDatasetEntry {
  readonly id: string
  readonly name: string
  readonly group: NcemEmdNumericGroup
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly identity: ScientificDatasetIdentity
  readonly dataset: ScientificDataset
}

const defaultMaxPlaneBytes = 268_435_456

const positiveSafeInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const checkedProduct = (values: readonly number[], maximum: number, label: string): number => {
  let product = 1n
  for (const value of values) {
    product *= BigInt(value)
    if (product > BigInt(maximum)) throw limitExceeded(`${label} exceeds ${maximum} bytes`)
  }
  return Number(product)
}

const sampleType = (datatype: Hdf5Datatype): RasterSampleType => {
  if (datatype.kind === 'float') {
    if (datatype.format === 'binary16') return 'float16'
    if (datatype.format === 'binary32') return 'float32'
    return 'float64'
  }
  if (datatype.kind !== 'integer') {
    throw unsupportedOperation('NCEM EMD numeric data must use an integer or float datatype')
  }
  if (
    datatype.bitOffset !== 0 ||
    datatype.bitPrecision !== datatype.byteLength * 8 ||
    datatype.lowPadding !== 0 ||
    datatype.highPadding !== 0
  ) {
    throw unsupportedOperation('NCEM EMD numeric data uses a packed integer datatype')
  }
  if (datatype.signed) {
    if (datatype.byteLength === 1) return 'int8'
    if (datatype.byteLength === 2) return 'int16'
    if (datatype.byteLength === 4) return 'int32'
    throw unsupportedOperation(`NCEM EMD signed ${datatype.byteLength * 8}-bit data is unsupported`)
  }
  if (datatype.byteLength === 1) return 'uint8'
  if (datatype.byteLength === 2) return 'uint16'
  if (datatype.byteLength === 4) return 'uint32'
  if (datatype.byteLength === 8) return 'uint64'
  throw unsupportedOperation(`NCEM EMD unsigned ${datatype.byteLength * 8}-bit data is unsupported`)
}

const axisKind = (name: string | undefined): ScientificAxisKind => {
  const normalized = name?.toLowerCase() ?? ''
  if (normalized.includes('time')) return 'time'
  if (normalized.includes('energy') || normalized.includes('wavelength')) return 'spectral'
  if (normalized.includes('reciprocal') || normalized.includes('diffraction')) {
    return 'reciprocal-space'
  }
  if (normalized.includes('angle')) return 'angle'
  if (normalized.includes('channel')) return 'channel'
  if (/\b(position|x|y|z)\b/.test(normalized)) return 'space'
  return 'other'
}

const datasetName = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.length === 0 ? path : name
}

const descriptorFor = (
  group: NcemEmdNumericGroup,
  object: Hdf5DatasetObject,
  resourceId: string,
  acquisitionMetadata: ScientificMetadataObject,
): NormalizedScientificDatasetDescriptor => {
  const type = sampleType(object.metadata.datatype)
  const axes = group.dimensions.map((dimension, index) => ({
    id: `dim${index + 1}`,
    ...(dimension.name === undefined ? {} : { name: dimension.name }),
    kind: axisKind(dimension.name),
    length: dimension.length,
    ...(dimension.unit === undefined ? {} : { unit: dimension.unit }),
    coordinates: dimension.coordinates,
    calibration: {
      kind: 'embedded' as const,
      resourceId,
      locator: `${dimension.path} values and attributes`,
    },
  }))
  const axisIds = axes.map(({ id }) => id)
  return normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes,
    sampleType: type,
    components: [{ id: 'value', name: 'Value', kind: 'scalar' }],
    metadata: {
      ncemEmd: {
        groupPath: group.path,
        dataPath: group.dataPath,
        acquisition: acquisitionMetadata,
      },
    },
    capabilities: {
      regionReads: axes.length >= 2,
      resolutionLevels: false,
      planeReads: axes.length >= 2 ? { kind: 'any-axis-pair' } : { kind: 'none' },
      seriesReads: { kind: 'axes', axes: axisIds },
    },
  })
}

const canonicalData = (
  data: Uint8Array<ArrayBuffer>,
  shape: readonly number[],
  horizontalAxis: number | undefined,
  verticalAxis: number | undefined,
  bytesPerSample: number,
  littleEndian: boolean,
): Uint8Array<ArrayBuffer> => {
  const width = horizontalAxis === undefined ? shape[0] : shape[horizontalAxis]
  const height = verticalAxis === undefined ? 1 : shape[verticalAxis]
  if (width === undefined || height === undefined)
    throw invalidInput('NCEM EMD block shape is incomplete')
  const strides = new Array<number>(shape.length)
  let stride = 1
  for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
    strides[axis] = stride
    stride *= shape[axis] ?? 0
  }
  const horizontalStride = horizontalAxis === undefined ? 1 : (strides[horizontalAxis] ?? 0)
  const verticalStride = verticalAxis === undefined ? 0 : (strides[verticalAxis] ?? 0)
  const direct = horizontalStride === 1 && (height === 1 || verticalStride === width)
  const output = direct ? data : new Uint8Array(data.byteLength)
  if (!direct) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const source = (y * verticalStride + x * horizontalStride) * bytesPerSample
        output.set(data.subarray(source, source + bytesPerSample), (y * width + x) * bytesPerSample)
      }
    }
  }
  if (littleEndian && bytesPerSample > 1) {
    for (let offset = 0; offset < output.byteLength; offset += bytesPerSample) {
      for (let left = 0, right = bytesPerSample - 1; left < right; left += 1, right -= 1) {
        const value = output[offset + left] ?? 0
        output[offset + left] = output[offset + right] ?? 0
        output[offset + right] = value
      }
    }
  }
  return output
}

class NcemEmdScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #file: Hdf5File
  readonly #path: string
  readonly #littleEndian: boolean
  readonly #maxPlaneBytes: number

  constructor(
    file: Hdf5File,
    path: string,
    datatype: Hdf5Datatype,
    descriptor: NormalizedScientificDatasetDescriptor,
    maxPlaneBytes: number,
  ) {
    this.#file = file
    this.#path = path
    this.#littleEndian =
      (datatype.kind === 'integer' || datatype.kind === 'float') &&
      datatype.byteLength > 1 &&
      datatype.byteOrder === 'little-endian'
    this.descriptor = descriptor
    this.#maxPlaneBytes = maxPlaneBytes
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    if (this.descriptor.axes.length < 2) {
      throw unsupportedOperation(
        'One-dimensional NCEM EMD datasets support readSeries(), not planes',
      )
    }
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const bytesPerSample = rasterSampleBytes(this.descriptor.sampleType)
    checkedProduct(
      [normalized.width, normalized.height, bytesPerSample],
      this.#maxPlaneBytes,
      'NCEM EMD selected plane',
    )
    const horizontalAxis = this.descriptor.axes.findIndex(
      ({ id }) => id === normalized.displayAxes[0],
    )
    const verticalAxis = this.descriptor.axes.findIndex(
      ({ id }) => id === normalized.displayAxes[1],
    )
    const fixed = new Map(normalized.fixedIndices.map(({ axisId, index }) => [axisId, index]))
    const start = this.descriptor.axes.map((axis, index) =>
      index === horizontalAxis
        ? normalized.x
        : index === verticalAxis
          ? normalized.y
          : (fixed.get(axis.id) ?? 0),
    )
    const shape = this.descriptor.axes.map((_axis, index) =>
      index === horizontalAxis ? normalized.width : index === verticalAxis ? normalized.height : 1,
    )
    for await (const block of this.#file.readDataset(
      this.#path,
      { start, shape },
      normalized.signal === undefined ? {} : { signal: normalized.signal },
    )) {
      throwIfAborted(normalized.signal)
      const width = block.shape[horizontalAxis]
      const height = block.shape[verticalAxis]
      const x = block.start[horizontalAxis]
      const y = block.start[verticalAxis]
      if (width === undefined || height === undefined || x === undefined || y === undefined) {
        throw invalidInput('NCEM EMD selected plane block is incomplete')
      }
      const data = canonicalData(
        block.data,
        block.shape,
        horizontalAxis,
        verticalAxis,
        bytesPerSample,
        this.#littleEndian,
      )
      yield Object.freeze({
        x,
        y,
        width,
        height,
        stride: width * bytesPerSample,
        format: Object.freeze({
          sampleType: this.descriptor.sampleType,
          channels: 1,
          planar: false,
        }),
        data,
      })
    }
  }

  async *readSeries(
    request: Readonly<ScientificSeriesReadRequest>,
  ): AsyncIterable<ScientificSeriesBlock> {
    const normalized = normalizeScientificSeriesReadRequest(this.descriptor, request)
    const selectedAxis = this.descriptor.axes.findIndex(({ id }) => id === normalized.axisId)
    const bytesPerSample = rasterSampleBytes(this.descriptor.sampleType)
    checkedProduct(
      [normalized.length, bytesPerSample],
      this.#maxPlaneBytes,
      'NCEM EMD selected series',
    )
    const fixed = new Map(normalized.fixedIndices.map(({ axisId, index }) => [axisId, index]))
    const start = this.descriptor.axes.map((axis, index) =>
      index === selectedAxis ? normalized.start : (fixed.get(axis.id) ?? 0),
    )
    const shape = this.descriptor.axes.map((_axis, index) =>
      index === selectedAxis ? normalized.length : 1,
    )
    for await (const block of this.#file.readDataset(
      this.#path,
      { start, shape },
      normalized.signal === undefined ? {} : { signal: normalized.signal },
    )) {
      throwIfAborted(normalized.signal)
      const blockStart = block.start[selectedAxis]
      const length = block.shape[selectedAxis]
      if (blockStart === undefined || length === undefined) {
        throw invalidInput('NCEM EMD selected series block is incomplete')
      }
      yield Object.freeze({
        start: blockStart,
        length,
        format: Object.freeze({
          sampleType: this.descriptor.sampleType,
          channels: 1,
          planar: false,
        }),
        data: canonicalData(
          block.data,
          block.shape,
          selectedAxis,
          undefined,
          bytesPerSample,
          this.#littleEndian,
        ),
      })
    }
  }
}

export const ncemEmdReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/ncem-emd',
  version: '1.0.0',
  format: 'NCEM EMD 0.2',
  extensions: Object.freeze(['emd']),
  mediaTypes: Object.freeze(['application/x-hdf5']),
  capabilities: Object.freeze({
    datasets: 'numeric-groups',
    selectedReads: true,
  }),
})

const createDocument = async (
  context: Readonly<ScientificOpenContext>,
  options: Readonly<NcemEmdReaderOptions>,
  maxPlaneBytes: number,
): Promise<ScientificDocument> => {
  const file = await openHdf5File(context.primary.source, {
    ...(options.hdf5 ?? {}),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  try {
    const inspection = await inspectNcemEmd(file, {
      ...(options.inspection ?? {}),
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const acquisition = normalizeScientificMetadataObject(inspection.metadata)
    const entries: NcemEmdDatasetEntry[] = []
    for (const group of inspection.numericGroups) {
      throwIfAborted(context.signal)
      const object = await file.get(
        group.dataPath,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      if (object?.kind !== 'dataset') {
        throw invalidInput(`NCEM EMD numeric data ${JSON.stringify(group.dataPath)} is missing`)
      }
      const id = group.path
      const descriptor = descriptorFor(group, object, context.primary.id, acquisition)
      const identity = await createScientificDatasetIdentity({
        reader: ncemEmdReaderDescriptor,
        datasetId: id,
        resources: [context.primary],
      })
      const dataset = identifyScientificDataset(
        new NcemEmdScientificDataset(
          file,
          group.dataPath,
          object.metadata.datatype,
          descriptor,
          maxPlaneBytes,
        ),
        identity,
      )
      entries.push(
        Object.freeze({
          id,
          name: datasetName(group.path),
          group,
          descriptor,
          identity,
          dataset,
        }),
      )
    }
    const metadata = normalizeScientificMetadataObject({
      version: '0.2',
      numericGroupCount: entries.length,
      acquisition,
    })
    return Object.freeze({
      reader: Object.freeze({
        id: ncemEmdReaderDescriptor.id,
        version: ncemEmdReaderDescriptor.version,
      }),
      format: ncemEmdReaderDescriptor.format,
      metadata,
      datasets: Object.freeze(
        entries.map((entry) =>
          Object.freeze({
            id: entry.id,
            name: entry.name,
            descriptor: entry.descriptor,
            identity: entry.identity,
            metadata: normalizeScientificMetadataObject({
              groupPath: entry.group.path,
              dataPath: entry.group.dataPath,
            }),
          }),
        ),
      ),
      async openDataset(id: string, openOptions: Readonly<AbortOptions> = {}) {
        throwIfAborted(openOptions.signal ?? context.signal)
        const entry = entries.find((candidate) => candidate.id === id)
        if (entry === undefined) throw invalidInput(`Unknown NCEM EMD dataset ${id}`)
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

export const createNcemEmdReader = (
  options: Readonly<NcemEmdReaderOptions> = {},
): ScientificReader => {
  const maxPlaneBytes = positiveSafeInteger(
    'NCEM EMD reader maxPlaneBytes',
    options.maxPlaneBytes ?? defaultMaxPlaneBytes,
  )
  return Object.freeze({
    descriptor: ncemEmdReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      let file: Hdf5File | undefined
      try {
        file = await openHdf5File(context.primary.source, {
          ...(options.hdf5 ?? {}),
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        })
        const attributes = await file.attributes(
          '/',
          ['version_major', 'version_minor'],
          context.signal === undefined ? {} : { signal: context.signal },
        )
        const names = new Map(attributes?.map((attribute) => [attribute.name, attribute]))
        const major = names.get('version_major')
        const minor = names.get('version_minor')
        const roots = await Promise.all(
          ['/data', '/signals'].map((path) =>
            file?.get(path, context.signal === undefined ? {} : { signal: context.signal }),
          ),
        )
        const matches =
          major !== undefined &&
          minor !== undefined &&
          ncemEmdVersionPart(major, 'version_major') === 0 &&
          ncemEmdVersionPart(minor, 'version_minor') === 2 &&
          roots.some((root) => root?.kind === 'group')
        return Object.freeze({
          confidence: matches ? 0.99 : 0,
          reason: matches
            ? 'HDF5 root declares NCEM EMD version 0.2 with a numeric-group root'
            : 'NCEM EMD version is absent',
        })
      } catch (error: unknown) {
        throwIfAborted(context.signal)
        if (error instanceof ImageError && error.code === 'LIMIT_EXCEEDED') throw error
        if (!(error instanceof ImageError)) throw error
        return Object.freeze({ confidence: 0, reason: 'NCEM EMD structure is absent' })
      } finally {
        file?.close()
      }
    },
    open(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      return createDocument(context, options, maxPlaneBytes)
    },
  })
}

export const ncemEmdReader = createNcemEmdReader()
