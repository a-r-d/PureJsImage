import { type AbortOptions, throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import { normalizeScientificMetadataObject, type ScientificMetadataObject } from '../dataset.ts'
import type { Hdf5Datatype } from './hdf5-dataset.ts'
import type { Hdf5DatasetObject, Hdf5File } from './hdf5-file.ts'

export interface VeloxEmdInspectionLimits {
  readonly maxDenseSpectra?: number
  readonly maxSpectrumStreams?: number
  readonly maxJsonBytes?: number
  readonly maxTotalJsonBytes?: number
  readonly maxSettingsBytes?: number
  readonly maxSettingsHeapBytes?: number
  readonly maxEnergyBins?: number
  readonly maxFrames?: number
  readonly maxFrameTableBytes?: number
  readonly maxEvents?: number
  readonly maxSpatialPixels?: number
}

export interface VeloxEmdInspectionOptions extends AbortOptions, VeloxEmdInspectionLimits {}

export interface VeloxEnergyCalibration {
  readonly origin: number
  readonly step: number
  readonly unit: 'eV'
}

export interface VeloxDenseSpectrumEntry {
  readonly id: string
  readonly dataPath: string
  readonly metadataPath: string
  readonly datatype: Hdf5Datatype
  readonly energyBins: number
  readonly storedSeries: number
  readonly detector: string
  readonly energyCalibration: VeloxEnergyCalibration | undefined
  readonly metadata: ScientificMetadataObject
}

export interface VeloxSpectrumStreamEntry {
  readonly id: string
  readonly dataPath: string
  readonly metadataPath: string
  readonly acquisitionSettingsPath: string
  readonly frameLocationTablePath: string
  readonly detector: string
  readonly energyBins: number
  readonly width: number
  readonly height: number
  readonly eventCount: number
  readonly frameOffsets: readonly number[]
  readonly energyCalibration: VeloxEnergyCalibration | undefined
  readonly metadata: ScientificMetadataObject
}

export interface VeloxEmdSpectrumInspection {
  readonly denseSpectra: readonly VeloxDenseSpectrumEntry[]
  readonly spectrumStreams: readonly VeloxSpectrumStreamEntry[]
}

export interface VeloxPointSpectrumReadOptions extends AbortOptions {
  readonly frame: number
  readonly x: number
  readonly y: number
  readonly start?: number
  readonly length?: number
  readonly maxSelectedFrameEvents?: number
  readonly maxEventBlockEvents?: number
  readonly maxEventReadOperations?: number
  readonly maxOutputBytes?: number
  readonly maxCountPerBin?: number
}

export interface VeloxPointSpectrumResult {
  readonly start: number
  readonly length: number
  /** Canonical big-endian uint32 counts for the requested native energy-channel interval. */
  readonly data: Uint8Array<ArrayBuffer>
  readonly scannedEvents: number
  readonly eventReadOperations: number
}

interface ResolvedLimits {
  readonly maxDenseSpectra: number
  readonly maxSpectrumStreams: number
  readonly maxJsonBytes: number
  readonly maxTotalJsonBytes: number
  readonly maxSettingsBytes: number
  readonly maxSettingsHeapBytes: number
  readonly maxEnergyBins: number
  readonly maxFrames: number
  readonly maxFrameTableBytes: number
  readonly maxEvents: number
  readonly maxSpatialPixels: number
}

interface JsonBudget {
  bytes: number
}

export interface VeloxJsonByteBudget {
  bytes: number
}

const positiveSafeInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const nonnegativeSafeInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${label} must be a nonnegative safe integer`)
  }
  return value
}

const resolveLimits = (limits: Readonly<VeloxEmdInspectionLimits>): ResolvedLimits =>
  Object.freeze({
    maxDenseSpectra: positiveSafeInteger(
      'Velox EMD maxDenseSpectra',
      limits.maxDenseSpectra ?? 4_096,
    ),
    maxSpectrumStreams: positiveSafeInteger(
      'Velox EMD maxSpectrumStreams',
      limits.maxSpectrumStreams ?? 4_096,
    ),
    maxJsonBytes: positiveSafeInteger('Velox EMD maxJsonBytes', limits.maxJsonBytes ?? 1_048_576),
    maxTotalJsonBytes: positiveSafeInteger(
      'Velox EMD maxTotalJsonBytes',
      limits.maxTotalJsonBytes ?? 67_108_864,
    ),
    maxSettingsBytes: positiveSafeInteger(
      'Velox EMD maxSettingsBytes',
      limits.maxSettingsBytes ?? 65_536,
    ),
    maxSettingsHeapBytes: positiveSafeInteger(
      'Velox EMD maxSettingsHeapBytes',
      limits.maxSettingsHeapBytes ?? 1_048_576,
    ),
    maxEnergyBins: positiveSafeInteger('Velox EMD maxEnergyBins', limits.maxEnergyBins ?? 65_535),
    maxFrames: positiveSafeInteger('Velox EMD maxFrames', limits.maxFrames ?? 1_048_576),
    maxFrameTableBytes: positiveSafeInteger(
      'Velox EMD maxFrameTableBytes',
      limits.maxFrameTableBytes ?? 33_554_432,
    ),
    maxEvents: positiveSafeInteger('Velox EMD maxEvents', limits.maxEvents ?? 4_294_967_296),
    maxSpatialPixels: positiveSafeInteger(
      'Velox EMD maxSpatialPixels',
      limits.maxSpatialPixels ?? 268_435_456,
    ),
  })

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

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw invalidInput(`${label} is missing`)
  return value
}

const finiteNumber = (value: unknown, label: string): number => {
  const parsed = typeof value === 'string' && value.length > 0 ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw invalidInput(`${label} is not finite`)
  }
  return parsed
}

const positiveInteger = (value: unknown, maximum: number, label: string): number => {
  const parsed = finiteNumber(value, label)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw invalidInput(`${label} is not positive`)
  if (parsed > maximum) throw limitExceeded(`${label} exceeds ${maximum}`)
  return parsed
}

const metadataStoredBytes = (object: Hdf5DatasetObject, path: string): number => {
  const dimensions = object.metadata.dataspace.dimensions
  if (
    object.metadata.dataspace.rank !== 2 ||
    object.metadata.datatype.kind !== 'integer' ||
    object.metadata.datatype.byteLength !== 1 ||
    object.metadata.datatype.signed ||
    dimensions[0] === undefined ||
    dimensions[1] === undefined
  ) {
    throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} has invalid storage`)
  }
  return dimensions[0]
}

export const readVeloxJsonColumn = async (
  file: Hdf5File,
  object: Hdf5DatasetObject,
  path: string,
  column: number,
  maximumBytes: number,
  signal: AbortSignal | undefined,
): Promise<ScientificMetadataObject> => {
  const dimensions = object.metadata.dataspace.dimensions
  const storedBytes = metadataStoredBytes(object, path)
  const columns = dimensions[1]
  if (columns === undefined || column < 0 || column >= columns) {
    throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} column is invalid`)
  }
  if (storedBytes > maximumBytes) {
    throw limitExceeded(
      `Velox EMD JSON dataset ${JSON.stringify(path)} has ${storedBytes} bytes; limit is ${maximumBytes}`,
    )
  }
  const bytes = new Uint8Array(storedBytes)
  let expectedStart = 0
  for await (const block of file.readDataset(
    path,
    { start: [0, column], shape: [storedBytes, 1] },
    signal === undefined ? {} : { signal },
  )) {
    const start = block.start[0]
    const rows = block.shape[0]
    if (
      start !== expectedStart ||
      rows === undefined ||
      block.shape[1] !== 1 ||
      block.data.byteLength !== rows
    ) {
      throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} is incomplete`)
    }
    bytes.set(block.data, start)
    expectedStart += rows
  }
  if (expectedStart !== storedBytes)
    throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} is incomplete`)
  let end = bytes.byteLength
  const nul = bytes.indexOf(0)
  if (nul >= 0) end = Math.min(end, nul)
  if (end === 0) throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} is empty`)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end))
  } catch {
    throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} is not UTF-8`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} is invalid JSON`)
  }
  return normalizeScientificMetadataObject(parsed)
}

export const readVeloxJsonColumns = async (
  file: Hdf5File,
  object: Hdf5DatasetObject,
  path: string,
  maximumColumnBytes: number,
  maximumTotalBytes: number,
  budget: VeloxJsonByteBudget,
  signal: AbortSignal | undefined,
): Promise<readonly ScientificMetadataObject[]> => {
  const dimensions = object.metadata.dataspace.dimensions
  const storedBytes = metadataStoredBytes(object, path)
  const columns = dimensions[1]
  if (columns === undefined || columns < 1) {
    throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} has no columns`)
  }
  if (storedBytes > maximumColumnBytes) {
    throw limitExceeded(
      `Velox EMD JSON dataset ${JSON.stringify(path)} has ${storedBytes} bytes per column; limit is ${maximumColumnBytes}`,
    )
  }
  const totalBytes = BigInt(storedBytes) * BigInt(columns)
  if (totalBytes > BigInt(maximumTotalBytes)) {
    throw limitExceeded(
      `Velox EMD JSON dataset ${JSON.stringify(path)} requires ${totalBytes} bytes; limit is ${maximumTotalBytes}`,
    )
  }
  const matrixBytes = Number(totalBytes)
  if (budget.bytes > maximumTotalBytes - matrixBytes) {
    throw limitExceeded(`Velox EMD aggregate JSON metadata exceeds ${maximumTotalBytes} bytes`)
  }
  budget.bytes += matrixBytes
  const stored = new Uint8Array(matrixBytes)
  let coveredBytes = 0
  for await (const block of file.readDataset(
    path,
    { start: [0, 0], shape: [storedBytes, columns] },
    signal === undefined ? {} : { signal },
  )) {
    const startRow = block.start[0]
    const startColumn = block.start[1]
    const rows = block.shape[0]
    const blockColumns = block.shape[1]
    if (
      startRow === undefined ||
      startColumn === undefined ||
      rows === undefined ||
      blockColumns === undefined ||
      startRow < 0 ||
      startColumn < 0 ||
      startRow + rows > storedBytes ||
      startColumn + blockColumns > columns ||
      block.data.byteLength !== rows * blockColumns
    ) {
      throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} is incomplete`)
    }
    for (let row = 0; row < rows; row += 1) {
      const sourceOffset = row * blockColumns
      const targetOffset = (startRow + row) * columns + startColumn
      stored.set(block.data.subarray(sourceOffset, sourceOffset + blockColumns), targetOffset)
    }
    coveredBytes += block.data.byteLength
  }
  if (coveredBytes !== Number(totalBytes)) {
    throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} is incomplete`)
  }
  const metadata: ScientificMetadataObject[] = []
  for (let column = 0; column < columns; column += 1) {
    const bytes = new Uint8Array(storedBytes)
    for (let row = 0; row < storedBytes; row += 1) {
      bytes[row] = stored[row * columns + column] ?? 0
    }
    let end = bytes.indexOf(0)
    if (end < 0) end = bytes.byteLength
    if (end === 0) {
      throw invalidInput(`Velox EMD JSON dataset ${JSON.stringify(path)} column ${column} is empty`)
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end))
    } catch {
      throw invalidInput(
        `Velox EMD JSON dataset ${JSON.stringify(path)} column ${column} is not UTF-8`,
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw invalidInput(
        `Velox EMD JSON dataset ${JSON.stringify(path)} column ${column} is invalid JSON`,
      )
    }
    metadata.push(normalizeScientificMetadataObject(parsed))
  }
  return Object.freeze(metadata)
}

const metadataFor = async (
  file: Hdf5File,
  path: string,
  limits: ResolvedLimits,
  budget: JsonBudget,
  signal: AbortSignal | undefined,
): Promise<ScientificMetadataObject> => {
  const object = await file.get(path, signal === undefined ? {} : { signal })
  if (object?.kind !== 'dataset')
    throw invalidInput(`Velox EMD metadata ${JSON.stringify(path)} is missing`)
  const bytes = metadataStoredBytes(object, path)
  if (budget.bytes > limits.maxTotalJsonBytes - bytes) {
    throw limitExceeded(`Velox EMD JSON metadata exceeds ${limits.maxTotalJsonBytes} bytes`)
  }
  budget.bytes += bytes
  return readVeloxJsonColumn(file, object, path, 0, limits.maxJsonBytes, signal)
}

const energyCalibration = (
  metadata: ScientificMetadataObject,
): VeloxEnergyCalibration | undefined => {
  const detectorName = nestedValue(metadata, ['BinaryResult', 'Detector'])
  const detectors = nestedValue(metadata, ['Detectors'])
  if (typeof detectorName !== 'string' || !isRecord(detectors)) return undefined
  const matching = Object.values(detectors).filter(
    (detector) => isRecord(detector) && detector.DetectorName === detectorName,
  )
  if (matching.length !== 1) return undefined
  const detector = matching[0]
  if (!isRecord(detector)) return undefined
  if (detector.Dispersion === undefined || detector.OffsetEnergy === undefined) return undefined
  const step = finiteNumber(detector.Dispersion, 'Velox EMD detector dispersion')
  const origin = finiteNumber(detector.OffsetEnergy, 'Velox EMD detector offset energy')
  if (step <= 0) throw invalidInput('Velox EMD detector dispersion must be positive')
  return Object.freeze({ origin, step, unit: 'eV' })
}

const detectorName = (metadata: ScientificMetadataObject, id: string): string => {
  const value = nestedValue(metadata, ['BinaryResult', 'Detector'])
  return typeof value === 'string' && value.length > 0 ? value : id
}

const croppedShape = (
  metadata: ScientificMetadataObject,
  maximumPixels: number,
): Readonly<{ width: number; height: number }> => {
  const scanWidth = positiveInteger(
    nestedValue(metadata, ['Scan', 'ScanSize', 'width']),
    maximumPixels,
    'Velox EMD scan width',
  )
  const scanHeight = positiveInteger(
    nestedValue(metadata, ['Scan', 'ScanSize', 'height']),
    maximumPixels,
    'Velox EMD scan height',
  )
  const left = finiteNumber(
    nestedValue(metadata, ['Scan', 'ScanArea', 'left']),
    'Velox EMD scan left',
  )
  const top = finiteNumber(nestedValue(metadata, ['Scan', 'ScanArea', 'top']), 'Velox EMD scan top')
  const right = finiteNumber(
    nestedValue(metadata, ['Scan', 'ScanArea', 'right']),
    'Velox EMD scan right',
  )
  const bottom = finiteNumber(
    nestedValue(metadata, ['Scan', 'ScanArea', 'bottom']),
    'Velox EMD scan bottom',
  )
  if (left < 0 || top < 0 || right > 1 || bottom > 1 || right <= left || bottom <= top) {
    throw invalidInput('Velox EMD normalized scan area is invalid')
  }
  const width = (right - left) * scanWidth
  const height = (bottom - top) * scanHeight
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw invalidInput('Velox EMD cropped scan dimensions are not exact integers')
  }
  if (width > Math.floor(maximumPixels / height)) {
    throw limitExceeded(`Velox EMD cropped scan exceeds ${maximumPixels} pixels`)
  }
  return Object.freeze({ width, height })
}

const parseSettings = (text: string, limits: ResolvedLimits): number => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw invalidInput('Velox EMD AcquisitionSettings is invalid JSON')
  }
  if (!isRecord(value)) throw invalidInput('Velox EMD AcquisitionSettings is not an object')
  const encoding = requiredString(value.StreamEncoding, 'Velox EMD stream encoding')
  if (encoding !== 'uint16' || value.encoding !== 'uint16') {
    throw unsupportedOperation(
      `Velox EMD stream encoding ${JSON.stringify(encoding)} is unsupported`,
    )
  }
  return positiveInteger(value.bincount, limits.maxEnergyBins, 'Velox EMD energy bins')
}

const readFrameOffsets = async (
  file: Hdf5File,
  object: Hdf5DatasetObject,
  path: string,
  eventCount: number,
  limits: ResolvedLimits,
  signal: AbortSignal | undefined,
): Promise<readonly number[]> => {
  const dimensions = object.metadata.dataspace.dimensions
  const datatype = object.metadata.datatype
  if (
    object.metadata.dataspace.rank !== 2 ||
    dimensions[0] === undefined ||
    dimensions[1] !== 1 ||
    datatype.kind !== 'integer' ||
    datatype.signed ||
    datatype.byteLength !== 8 ||
    datatype.byteOrder !== 'little-endian' ||
    datatype.bitOffset !== 0 ||
    datatype.bitPrecision !== 64
  ) {
    throw invalidInput(`Velox EMD frame table ${JSON.stringify(path)} has invalid storage`)
  }
  const frames = positiveInteger(dimensions[0], limits.maxFrames, 'Velox EMD frame count')
  if (frames > Math.floor(limits.maxFrameTableBytes / 8)) {
    throw limitExceeded(`Velox EMD frame table exceeds ${limits.maxFrameTableBytes} bytes`)
  }
  const offsets: number[] = []
  for await (const block of file.readDataset(
    path,
    { start: [0, 0], shape: [frames, 1] },
    signal === undefined ? {} : { signal },
  )) {
    throwIfAborted(signal)
    const blockStart = block.start[0]
    const rows = block.shape[0]
    if (
      blockStart !== offsets.length ||
      rows === undefined ||
      block.shape[1] !== 1 ||
      block.data.byteLength !== rows * 8
    ) {
      throw invalidInput('Velox EMD frame table block is misaligned')
    }
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let offset = 0; offset < block.data.byteLength; offset += 8) {
      const value = view.getBigUint64(offset, true)
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw limitExceeded('Velox EMD frame offset exceeds the safe integer range')
      }
      offsets.push(Number(value))
    }
  }
  if (offsets.length !== frames || offsets[0] !== 0) {
    throw invalidInput('Velox EMD frame table is incomplete or does not start at zero')
  }
  for (let index = 0; index < offsets.length; index += 1) {
    const current = offsets[index]
    const previous = offsets[index - 1]
    if (
      current === undefined ||
      current >= eventCount ||
      (previous !== undefined && current <= previous)
    ) {
      throw invalidInput(
        'Velox EMD frame offsets are not strictly increasing within the event stream',
      )
    }
  }
  return Object.freeze(offsets)
}

const childIds = async (
  file: Hdf5File,
  path: string,
  maximum: number,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> => {
  const links = await file.list(path, signal === undefined ? {} : { signal })
  const ids = links
    .filter(({ kind }) => kind === 'hard')
    .map(({ name }) => name)
    .sort()
  if (ids.length > maximum) throw limitExceeded(`${path} exceeds ${maximum} entries`)
  return Object.freeze(ids)
}

const inspectDenseSpectrum = async (
  file: Hdf5File,
  id: string,
  limits: ResolvedLimits,
  budget: JsonBudget,
  signal: AbortSignal | undefined,
): Promise<VeloxDenseSpectrumEntry> => {
  const group = `/Data/Spectrum/${id}`
  const dataPath = `${group}/Data`
  const metadataPath = `${group}/Metadata`
  const data = await file.get(dataPath, signal === undefined ? {} : { signal })
  if (data?.kind !== 'dataset')
    throw invalidInput(`Velox EMD spectrum ${JSON.stringify(id)} lacks Data`)
  const dimensions = data.metadata.dataspace.dimensions
  if (
    data.metadata.dataspace.rank !== 2 ||
    dimensions[0] === undefined ||
    dimensions[1] === undefined ||
    (data.metadata.datatype.kind !== 'integer' && data.metadata.datatype.kind !== 'float')
  ) {
    throw unsupportedOperation(
      `Velox EMD spectrum ${JSON.stringify(id)} is not a rank-2 numeric array`,
    )
  }
  const energyBins = positiveInteger(dimensions[0], limits.maxEnergyBins, 'Velox EMD energy bins')
  const storedSeries = positiveInteger(dimensions[1], limits.maxFrames, 'Velox EMD stored spectra')
  const metadata = await metadataFor(file, metadataPath, limits, budget, signal)
  return Object.freeze({
    id,
    dataPath,
    metadataPath,
    datatype: data.metadata.datatype,
    energyBins,
    storedSeries,
    detector: detectorName(metadata, id),
    energyCalibration: energyCalibration(metadata),
    metadata,
  })
}

const inspectSpectrumStream = async (
  file: Hdf5File,
  id: string,
  limits: ResolvedLimits,
  budget: JsonBudget,
  signal: AbortSignal | undefined,
): Promise<VeloxSpectrumStreamEntry> => {
  const group = `/Data/SpectrumStream/${id}`
  const dataPath = `${group}/Data`
  const metadataPath = `${group}/Metadata`
  const acquisitionSettingsPath = `${group}/AcquisitionSettings`
  const frameLocationTablePath = `${group}/FrameLocationTable`
  const data = await file.get(dataPath, signal === undefined ? {} : { signal })
  const table = await file.get(frameLocationTablePath, signal === undefined ? {} : { signal })
  if (data?.kind !== 'dataset' || table?.kind !== 'dataset') {
    throw invalidInput(
      `Velox EMD spectrum stream ${JSON.stringify(id)} lacks Data or FrameLocationTable`,
    )
  }
  const dimensions = data.metadata.dataspace.dimensions
  const datatype = data.metadata.datatype
  if (
    data.metadata.dataspace.rank !== 2 ||
    dimensions[0] === undefined ||
    dimensions[1] !== 1 ||
    datatype.kind !== 'integer' ||
    datatype.signed ||
    datatype.byteLength !== 2 ||
    datatype.byteOrder !== 'little-endian' ||
    datatype.bitOffset !== 0 ||
    datatype.bitPrecision !== 16
  ) {
    throw invalidInput(`Velox EMD spectrum stream ${JSON.stringify(id)} has invalid event storage`)
  }
  const eventCount = positiveInteger(dimensions[0], limits.maxEvents, 'Velox EMD event count')
  const settings = await file.readScalarString(acquisitionSettingsPath, {
    maxStringBytes: limits.maxSettingsBytes,
    maxGlobalHeapCollectionBytes: limits.maxSettingsHeapBytes,
    maxGlobalHeapObjectBytes: limits.maxSettingsBytes,
    ...(signal === undefined ? {} : { signal }),
  })
  if (settings === undefined) {
    throw invalidInput(`Velox EMD spectrum stream ${JSON.stringify(id)} lacks AcquisitionSettings`)
  }
  const energyBins = parseSettings(settings, limits)
  const metadata = await metadataFor(file, metadataPath, limits, budget, signal)
  const shape = croppedShape(metadata, limits.maxSpatialPixels)
  const frameOffsets = await readFrameOffsets(
    file,
    table,
    frameLocationTablePath,
    eventCount,
    limits,
    signal,
  )
  return Object.freeze({
    id,
    dataPath,
    metadataPath,
    acquisitionSettingsPath,
    frameLocationTablePath,
    detector: detectorName(metadata, id),
    energyBins,
    width: shape.width,
    height: shape.height,
    eventCount,
    frameOffsets,
    energyCalibration: energyCalibration(metadata),
    metadata,
  })
}

export const inspectVeloxEmdSpectra = async (
  file: Hdf5File,
  options: Readonly<VeloxEmdInspectionOptions> = {},
): Promise<VeloxEmdSpectrumInspection> => {
  throwIfAborted(options.signal)
  const limits = resolveLimits(options)
  const budget: JsonBudget = { bytes: 0 }
  const denseIds = await childIds(file, '/Data/Spectrum', limits.maxDenseSpectra, options.signal)
  const streamIds = await childIds(
    file,
    '/Data/SpectrumStream',
    limits.maxSpectrumStreams,
    options.signal,
  )
  const denseSpectra: VeloxDenseSpectrumEntry[] = []
  for (const id of denseIds) {
    throwIfAborted(options.signal)
    denseSpectra.push(await inspectDenseSpectrum(file, id, limits, budget, options.signal))
  }
  const spectrumStreams: VeloxSpectrumStreamEntry[] = []
  for (const id of streamIds) {
    throwIfAborted(options.signal)
    spectrumStreams.push(await inspectSpectrumStream(file, id, limits, budget, options.signal))
  }
  return Object.freeze({
    denseSpectra: Object.freeze(denseSpectra),
    spectrumStreams: Object.freeze(spectrumStreams),
  })
}

export const readVeloxPointSpectrum = async (
  file: Hdf5File,
  stream: Readonly<VeloxSpectrumStreamEntry>,
  options: Readonly<VeloxPointSpectrumReadOptions>,
): Promise<VeloxPointSpectrumResult> => {
  throwIfAborted(options.signal)
  const frame = nonnegativeSafeInteger('Velox EMD frame', options.frame)
  const x = nonnegativeSafeInteger('Velox EMD x', options.x)
  const y = nonnegativeSafeInteger('Velox EMD y', options.y)
  if (frame >= stream.frameOffsets.length) throw invalidInput('Velox EMD frame is out of range')
  if (x >= stream.width || y >= stream.height) {
    throw invalidInput('Velox EMD point coordinates are out of range')
  }
  const start = nonnegativeSafeInteger('Velox EMD energy start', options.start ?? 0)
  if (start >= stream.energyBins) throw invalidInput('Velox EMD energy start is out of range')
  const length = positiveSafeInteger(
    'Velox EMD energy length',
    options.length ?? stream.energyBins - start,
  )
  if (length > stream.energyBins - start) {
    throw invalidInput('Velox EMD energy interval is out of range')
  }
  const maxSelectedFrameEvents = positiveSafeInteger(
    'Velox EMD maxSelectedFrameEvents',
    options.maxSelectedFrameEvents ?? 67_108_864,
  )
  const maxEventBlockEvents = positiveSafeInteger(
    'Velox EMD maxEventBlockEvents',
    options.maxEventBlockEvents ?? 65_536,
  )
  const maxEventReadOperations = positiveSafeInteger(
    'Velox EMD maxEventReadOperations',
    options.maxEventReadOperations ?? 4_096,
  )
  const maxOutputBytes = positiveSafeInteger(
    'Velox EMD maxOutputBytes',
    options.maxOutputBytes ?? 268_435_456,
  )
  const maxCountPerBin = positiveSafeInteger(
    'Velox EMD maxCountPerBin',
    options.maxCountPerBin ?? 0xffff_ffff,
  )
  if (maxCountPerBin > 0xffff_ffff) {
    throw invalidInput('Velox EMD maxCountPerBin exceeds uint32')
  }
  if (length > Math.floor(maxOutputBytes / 4)) {
    throw limitExceeded(`Velox EMD point spectrum exceeds ${maxOutputBytes} output bytes`)
  }

  const frameStart = stream.frameOffsets[frame]
  const frameEnd = stream.frameOffsets[frame + 1] ?? stream.eventCount
  if (frameStart === undefined || frameEnd <= frameStart || frameEnd > stream.eventCount) {
    throw invalidInput('Velox EMD selected frame bounds are invalid')
  }
  const frameEvents = frameEnd - frameStart
  if (frameEvents > maxSelectedFrameEvents) {
    throw limitExceeded(
      `Velox EMD selected frame has ${frameEvents} events; limit is ${maxSelectedFrameEvents}`,
    )
  }

  const targetPixel = y * stream.width + x
  const pixelCount = stream.width * stream.height
  const counts = new Uint32Array(length)
  let pixel = 0
  let cursor = frameStart
  let scannedEvents = 0
  let eventReadOperations = 0
  let complete = false

  eventLoop: while (cursor < frameEnd) {
    throwIfAborted(options.signal)
    const blockEvents = Math.min(maxEventBlockEvents, frameEnd - cursor)
    let yieldedBlock = false
    for await (const block of file.readDataset(
      stream.dataPath,
      { start: [cursor, 0], shape: [blockEvents, 1] },
      options.signal === undefined ? {} : { signal: options.signal },
    )) {
      throwIfAborted(options.signal)
      eventReadOperations += 1
      yieldedBlock = true
      if (eventReadOperations > maxEventReadOperations) {
        throw limitExceeded(`Velox EMD event reads exceed ${maxEventReadOperations} operations`)
      }
      const blockStart = block.start[0]
      const rows = block.shape[0]
      if (
        blockStart !== cursor ||
        rows === undefined ||
        block.shape[1] !== 1 ||
        block.data.byteLength !== rows * 2
      ) {
        throw invalidInput('Velox EMD event block is misaligned')
      }
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let offset = 0; offset < block.data.byteLength; offset += 2) {
        const event = view.getUint16(offset, true)
        cursor += 1
        scannedEvents += 1
        if (event === 0xffff) {
          if (pixel >= pixelCount) {
            throw invalidInput('Velox EMD selected frame contains too many pixel gates')
          }
          if (pixel === targetPixel) {
            complete = true
            break eventLoop
          }
          pixel += 1
          continue
        }
        if (event >= stream.energyBins) {
          throw invalidInput(`Velox EMD event channel ${event} exceeds the native energy axis`)
        }
        if (pixel === targetPixel && event >= start && event < start + length) {
          const bin = event - start
          const count = counts[bin] ?? 0
          if (count >= maxCountPerBin) {
            throw limitExceeded(`Velox EMD energy channel ${event} exceeds uint32 counts`)
          }
          counts[bin] = count + 1
        }
      }
    }
    if (!yieldedBlock) throw invalidInput('Velox EMD event selection returned no data')
  }
  if (
    !complete &&
    !(targetPixel === pixelCount - 1 && pixel === targetPixel && cursor === frameEnd)
  ) {
    throw invalidInput('Velox EMD selected frame ends before the requested pixel gate')
  }

  const data = new Uint8Array(length * 4)
  const output = new DataView(data.buffer)
  for (let index = 0; index < counts.length; index += 1) {
    output.setUint32(index * 4, counts[index] ?? 0, false)
  }
  return Object.freeze({ start, length, data, scannedEvents, eventReadOperations })
}
