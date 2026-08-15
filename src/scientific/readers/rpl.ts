import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterSampleType } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
import { readExactly } from '../../source.ts'
import type {
  ScientificAxisDescriptor,
  ScientificCalibrationEvidence,
  ScientificMetadataObject,
} from '../dataset.ts'
import { normalizeScientificMetadataObject } from '../dataset.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
  ScientificResource,
} from '../reader.ts'
import { createContiguousArrayDataset, type ContiguousArrayLimits } from './interchange-shared.ts'
import { resourceHasHint, singleDatasetDocument } from './shared.ts'

export interface RplReaderLimits extends ContiguousArrayLimits {
  readonly maxHeaderBytes: number
  readonly maxElements: number
}

export interface RplReaderOptions {
  readonly limits?: Partial<RplReaderLimits>
}

const defaults: Readonly<RplReaderLimits> = Object.freeze({
  maxHeaderBytes: 1_048_576,
  maxElements: 1_000_000_000,
  maxRegionBytes: 67_108_864,
  maxReadOperations: 1_048_576,
  rowsPerBlock: 32,
})

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

const resolveLimits = (input: Partial<RplReaderLimits> = {}): Readonly<RplReaderLimits> =>
  Object.freeze({
    maxHeaderBytes: positive(input.maxHeaderBytes, defaults.maxHeaderBytes, 'RPL maxHeaderBytes'),
    maxElements: positive(input.maxElements, defaults.maxElements, 'RPL maxElements'),
    maxRegionBytes: positive(input.maxRegionBytes, defaults.maxRegionBytes, 'RPL maxRegionBytes'),
    maxReadOperations: positive(
      input.maxReadOperations,
      defaults.maxReadOperations,
      'RPL maxReadOperations',
    ),
    rowsPerBlock: positive(input.rowsPerBlock, defaults.rowsPerBlock, 'RPL rowsPerBlock'),
  })

const decodeHeader = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('latin1', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput('RPL header is not valid Latin-1 text')
  }
}

const parseHeaderText = (text: string): Readonly<Record<string, string>> => {
  const rows = text.split(/\r?\n|\r/u)
  const values: Record<string, string> = {}
  let sawColumns = false
  for (const row of rows) {
    const trimmed = row.trim()
    if (trimmed.length === 0 || trimmed.startsWith(';')) continue
    const columns = row.split('\t')
    if (!sawColumns) {
      if (columns.length < 2) throw invalidInput('RPL first data line must name two columns')
      sawColumns = true
      continue
    }
    const key = columns[0]?.trim().toLowerCase() ?? ''
    const value = columns[1]?.trim() ?? ''
    if (key.length === 0) throw invalidInput('RPL contains an empty key')
    if (values[key] !== undefined) throw invalidInput(`RPL key ${key} occurs more than once`)
    values[key] = value
  }
  if (!sawColumns) throw invalidInput('RPL header has no column line')
  return Object.freeze(values)
}

const isRplHeader = (bytes: Uint8Array): boolean => {
  try {
    const fields = parseHeaderText(decodeHeader(bytes))
    return ['width', 'height', 'depth', 'data-type', 'data-length'].every(
      (key) => fields[key] !== undefined,
    )
  } catch {
    return false
  }
}

const required = (fields: Readonly<Record<string, string>>, key: string): string => {
  const value = fields[key]
  if (value === undefined || value.length === 0) throw invalidInput(`RPL requires ${key}`)
  return value
}

const integer = (fields: Readonly<Record<string, string>>, key: string, minimum = 1): number => {
  const value = Number(required(fields, key))
  if (!Number.isSafeInteger(value) || value < minimum) throw invalidInput(`RPL ${key} is invalid`)
  return value
}

const optionalFinite = (
  fields: Readonly<Record<string, string>>,
  key: string,
): number | undefined => {
  const raw = fields[key]
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) throw invalidInput(`RPL ${key} must be finite`)
  return value
}

const optionalText = (
  fields: Readonly<Record<string, string>>,
  key: string,
): string | undefined => {
  const value = fields[key]?.trim()
  return value === undefined || value.length === 0 ? undefined : value
}

const sampleType = (type: string, length: number): RasterSampleType => {
  const key = `${type.toLowerCase()}:${length}`
  if (key === 'unsigned:1') return 'uint8'
  if (key === 'unsigned:2') return 'uint16'
  if (key === 'unsigned:4') return 'uint32'
  if (key === 'unsigned:8') return 'uint64'
  if (key === 'signed:1') return 'int8'
  if (key === 'signed:2') return 'int16'
  if (key === 'signed:4') return 'int32'
  if (key === 'float:4') return 'float32'
  if (key === 'float:8') return 'float64'
  throw unsupportedOperation(`RPL data type ${type} with ${length} bytes is unsupported`)
}

const stem = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > name.lastIndexOf('/') ? name.slice(0, dot) : name
}

interface RplPair {
  readonly header: ScientificResource
  readonly data: ScientificResource
  readonly fields: Readonly<Record<string, string>>
}

const readHeader = async (
  resource: ScientificResource,
  limits: Readonly<RplReaderLimits>,
  signal?: AbortSignal,
): Promise<Readonly<Record<string, string>>> => {
  if (resource.source.size > limits.maxHeaderBytes) {
    throw limitExceeded(`RPL header exceeds ${limits.maxHeaderBytes} bytes`)
  }
  return parseHeaderText(
    decodeHeader(
      await readExactly(
        resource.source,
        0,
        resource.source.size,
        signal === undefined ? {} : { signal },
      ),
    ),
  )
}

const resolvePair = async (
  context: Readonly<ScientificOpenContext>,
  limits: Readonly<RplReaderLimits>,
): Promise<RplPair> => {
  const prefix = await context.primary.source.read(
    0,
    Math.min(context.primary.source.size, limits.maxHeaderBytes),
    context.signal === undefined ? {} : { signal: context.signal },
  )
  const headerPrimary = isRplHeader(prefix)
  if (context.companions === undefined) throw invalidInput('RPL requires a companion resolver')
  if (headerPrimary) {
    const relativeName =
      context.primary.name === undefined ? undefined : `${stem(context.primary.name)}.raw`
    const data = await context.companions.resolve(
      { kind: 'role', role: 'data', ...(relativeName === undefined ? {} : { relativeName }) },
      context.signal === undefined ? {} : { signal: context.signal },
    )
    if (data === undefined) throw invalidInput('RPL RAW companion is missing')
    return Object.freeze({
      header: context.primary,
      data,
      fields: await readHeader(context.primary, limits, context.signal),
    })
  }
  if (context.primary.name === undefined)
    throw invalidInput('RPL RAW primary needs a resource name')
  const header = await context.companions.resolve(
    { kind: 'role', role: 'header', relativeName: `${stem(context.primary.name)}.rpl` },
    context.signal === undefined ? {} : { signal: context.signal },
  )
  if (header === undefined) throw invalidInput('RPL header companion is missing')
  return Object.freeze({
    header,
    data: context.primary,
    fields: await readHeader(header, limits, context.signal),
  })
}

const axis = (
  id: string,
  fallbackName: string,
  kind: ScientificAxisDescriptor['kind'],
  length: number,
  fields: Readonly<Record<string, string>>,
  resourceId: string,
): ScientificAxisDescriptor => {
  const scale = optionalFinite(fields, `${id}-scale`)
  const originIndex = optionalFinite(fields, `${id}-origin`) ?? 0
  const fallbackScale = id === 'depth' ? optionalFinite(fields, 'ev-per-chan') : undefined
  const step = scale ?? fallbackScale
  const unit = fields[`${id}-units`] ?? (fallbackScale === undefined ? undefined : 'eV')
  const calibration: ScientificCalibrationEvidence | undefined =
    step === undefined
      ? undefined
      : Object.freeze({
          kind: 'sidecar',
          resourceId,
          locator: `rpl:${id}-origin,${id}-scale${fallbackScale === undefined ? '' : ',ev-per-chan'}`,
          formula: `coordinate(index) = (index - ${originIndex}) * ${step}`,
        })
  return Object.freeze({
    id,
    name: optionalText(fields, `${id}-name`) ?? fallbackName,
    kind,
    length,
    ...(unit === undefined || unit.length === 0 ? {} : { unit }),
    coordinates:
      step === undefined
        ? Object.freeze({ type: 'index' as const })
        : Object.freeze({ type: 'linear' as const, origin: -originIndex * step, step }),
    ...(calibration === undefined ? {} : { calibration }),
  })
}

export const rplReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/rpl',
  version: '1.0.0',
  format: 'Lispix RPL/RAW',
  extensions: Object.freeze(['rpl', 'raw']),
  mediaTypes: Object.freeze(['application/x-rpl', 'application/x-lispix-raw']),
  capabilities: Object.freeze({
    resources: 'header-data-pair',
    datasets: 'single',
    axes: 'ranked',
  }),
})

export const createRplReader = (options: Readonly<RplReaderOptions> = {}): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: rplReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const prefix = await context.primary.source.read(
        0,
        Math.min(context.primary.source.size, limits.maxHeaderBytes),
        context.signal === undefined ? {} : { signal: context.signal },
      )
      if (!isRplHeader(prefix)) {
        if (context.companions === undefined || context.primary.name === undefined) {
          return Object.freeze({ confidence: 0, reason: 'RPL header is absent' })
        }
        const header = await context.companions.resolve(
          { kind: 'role', role: 'header', relativeName: `${stem(context.primary.name)}.rpl` },
          context.signal === undefined ? {} : { signal: context.signal },
        )
        if (header === undefined)
          return Object.freeze({ confidence: 0, reason: 'RPL companion is absent' })
        const bytes = await header.source.read(
          0,
          Math.min(header.source.size, limits.maxHeaderBytes),
          context.signal === undefined ? {} : { signal: context.signal },
        )
        if (!isRplHeader(bytes))
          return Object.freeze({ confidence: 0, reason: 'RPL companion is invalid' })
      }
      const hinted = resourceHasHint(
        context.primary,
        rplReaderDescriptor.extensions,
        rplReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 1 : 0.99,
        reason: 'RPL parameter structure and companion match',
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      throwIfAborted(context.signal)
      const pair = await resolvePair(context, limits)
      const width = integer(pair.fields, 'width')
      const height = integer(pair.fields, 'height')
      const depth = integer(pair.fields, 'depth')
      const offset = pair.fields.offset === undefined ? 0 : integer(pair.fields, 'offset', 0)
      const type = sampleType(
        required(pair.fields, 'data-type'),
        integer(pair.fields, 'data-length'),
      )
      const byteOrder = required(pair.fields, 'byte-order').toLowerCase()
      if (!['big-endian', 'little-endian', 'dont-care'].includes(byteOrder)) {
        throw invalidInput(`RPL byte-order ${byteOrder} is invalid`)
      }
      if (rasterSampleBytes(type) > 1 && byteOrder === 'dont-care') {
        throw invalidInput('RPL multi-byte samples require an explicit byte order')
      }
      const recordBy = required(pair.fields, 'record-by').toLowerCase()
      if (!['image', 'vector', 'dont-care'].includes(recordBy)) {
        throw unsupportedOperation(`RPL record-by ${recordBy} is unsupported`)
      }
      if (depth > 1 && recordBy === 'dont-care') {
        throw invalidInput('RPL depth greater than one requires image or vector record order')
      }
      const elements = width * height * depth
      if (!Number.isSafeInteger(elements) || elements > limits.maxElements) {
        throw limitExceeded(`RPL element count exceeds ${limits.maxElements}`)
      }
      const expected = offset + elements * rasterSampleBytes(type)
      if (!Number.isSafeInteger(expected) || expected !== pair.data.source.size) {
        throw invalidInput('RPL RAW payload size does not match its parameter list')
      }
      const x = axis('width', 'X', 'space', width, pair.fields, pair.header.id)
      const y = axis('height', 'Y', 'space', height, pair.fields, pair.header.id)
      const depthAxis = axis(
        'depth',
        optionalText(pair.fields, 'depth-name') ?? 'Depth',
        pair.fields.signal?.toUpperCase().includes('EDS') === true ||
          pair.fields['depth-units'] !== undefined
          ? 'spectral'
          : 'index',
        depth,
        pair.fields,
        pair.header.id,
      )
      const axes: readonly ScientificAxisDescriptor[] =
        depth === 1
          ? Object.freeze([Object.freeze({ ...x, id: 'x' }), Object.freeze({ ...y, id: 'y' })])
          : recordBy === 'vector'
            ? Object.freeze([
                depthAxis,
                Object.freeze({ ...x, id: 'x' }),
                Object.freeze({ ...y, id: 'y' }),
              ])
            : Object.freeze([
                Object.freeze({ ...x, id: 'x' }),
                Object.freeze({ ...y, id: 'y' }),
                depthAxis,
              ])
      const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
        recordBy,
        byteOrder,
        dataType: required(pair.fields, 'data-type'),
        dataLength: integer(pair.fields, 'data-length'),
        fields: pair.fields,
      })
      const dataset = createContiguousArrayDataset({
        source: pair.data.source,
        dataOffset: offset,
        sourceSampleType: type,
        sourceLittleEndian: byteOrder === 'little-endian',
        axes,
        components: [
          Object.freeze({
            id: 'value',
            name: optionalText(pair.fields, 'title') ?? 'Value',
            kind: 'scalar',
          }),
        ],
        metadata,
        ...(depth > 1 && recordBy === 'vector'
          ? {
              planePairs: [
                ['x', 'y'],
                ['depth', 'x'],
              ],
            }
          : {}),
        limits,
      })
      return singleDatasetDocument({
        context,
        reader: rplReaderDescriptor,
        metadata,
        dataset,
        datasetId: 'raster',
        datasetName: optionalText(pair.fields, 'title') ?? 'RPL raster',
        resources: [
          Object.freeze({ id: 'header', source: pair.header.source }),
          Object.freeze({ id: 'data', source: pair.data.source }),
        ],
      })
    },
  })
}

export const rplReader = createRplReader()
