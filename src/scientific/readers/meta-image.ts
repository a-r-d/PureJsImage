import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterSampleType } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
import { readExactly } from '../../source.ts'
import type { ScientificAxisDescriptor, ScientificMetadataObject } from '../dataset.ts'
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

export interface MetaImageReaderLimits extends ContiguousArrayLimits {
  readonly maxHeaderBytes: number
  readonly maxDimensions: number
  readonly maxElements: number
  readonly maxChannels: number
}

export interface MetaImageReaderOptions {
  readonly limits?: Partial<MetaImageReaderLimits>
}

const defaults: Readonly<MetaImageReaderLimits> = Object.freeze({
  maxHeaderBytes: 1_048_576,
  maxDimensions: 8,
  maxElements: 1_000_000_000,
  maxChannels: 16,
  maxRegionBytes: 67_108_864,
  maxReadOperations: 1_048_576,
  rowsPerBlock: 32,
})

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1)
    throw invalidInput(`${label} must be positive`)
  return resolved
}

const resolveLimits = (
  input: Partial<MetaImageReaderLimits> = {},
): Readonly<MetaImageReaderLimits> =>
  Object.freeze({
    maxHeaderBytes: positive(
      input.maxHeaderBytes,
      defaults.maxHeaderBytes,
      'MetaImage maxHeaderBytes',
    ),
    maxDimensions: positive(input.maxDimensions, defaults.maxDimensions, 'MetaImage maxDimensions'),
    maxElements: positive(input.maxElements, defaults.maxElements, 'MetaImage maxElements'),
    maxChannels: positive(input.maxChannels, defaults.maxChannels, 'MetaImage maxChannels'),
    maxRegionBytes: positive(
      input.maxRegionBytes,
      defaults.maxRegionBytes,
      'MetaImage maxRegionBytes',
    ),
    maxReadOperations: positive(
      input.maxReadOperations,
      defaults.maxReadOperations,
      'MetaImage maxReadOperations',
    ),
    rowsPerBlock: positive(input.rowsPerBlock, defaults.rowsPerBlock, 'MetaImage rowsPerBlock'),
  })

interface MetaHeader {
  readonly fields: Readonly<Record<string, string>>
  readonly local: boolean
  readonly dataOffset: number
}

const parseHeader = (
  bytes: Uint8Array,
  sourceSize: number,
  limits: Readonly<MetaImageReaderLimits>,
): MetaHeader => {
  let text: string
  try {
    text = new TextDecoder('latin1', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput('MetaImage header is not valid text')
  }
  const localMatch = text.match(/^\s*ElementDataFile\s*=\s*LOCAL\s*\r?\n/imu)
  const dataOffset =
    localMatch?.index === undefined ? bytes.byteLength : localMatch.index + localMatch[0].length
  const headerText = localMatch === null ? text : text.slice(0, dataOffset)
  const fields: Record<string, string> = {}
  for (const line of headerText.split(/\r?\n|\r/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const equals = line.indexOf('=')
    if (equals < 1) throw invalidInput('MetaImage header line is malformed')
    const key = line.slice(0, equals).trim().toLowerCase()
    const value = line.slice(equals + 1).trim()
    if (fields[key] !== undefined)
      throw invalidInput(`MetaImage field ${key} occurs more than once`)
    fields[key] = value
  }
  const local = fields.elementdatafile?.toUpperCase() === 'LOCAL'
  if (!local && sourceSize > bytes.byteLength)
    throw limitExceeded(`MetaImage header exceeds ${limits.maxHeaderBytes} bytes`)
  return Object.freeze({ fields: Object.freeze(fields), local, dataOffset })
}

const required = (fields: Readonly<Record<string, string>>, key: string): string => {
  const value = fields[key.toLowerCase()]
  if (value === undefined || value.length === 0) throw invalidInput(`MetaImage requires ${key}`)
  return value
}

const numbers = (value: string, label: string): readonly number[] => {
  const output = value.trim().split(/\s+/u).map(Number)
  if (output.length === 0 || output.some((entry) => !Number.isFinite(entry)))
    throw invalidInput(`MetaImage ${label} is invalid`)
  return Object.freeze(output)
}

const dimensions = (value: string, label: string): readonly number[] => {
  const output = numbers(value, label)
  if (output.some((entry) => !Number.isSafeInteger(entry) || entry < 1))
    throw invalidInput(`MetaImage ${label} is invalid`)
  return output
}

const boolean = (value: string | undefined, fallback: boolean, label: string): boolean => {
  if (value === undefined) return fallback
  if (/^(true|1)$/iu.test(value)) return true
  if (/^(false|0)$/iu.test(value)) return false
  throw invalidInput(`MetaImage ${label} is invalid`)
}

const sampleType = (value: string): RasterSampleType => {
  const type = value.toUpperCase()
  if (type === 'MET_UCHAR') return 'uint8'
  if (type === 'MET_CHAR') return 'int8'
  if (type === 'MET_USHORT') return 'uint16'
  if (type === 'MET_SHORT') return 'int16'
  if (type === 'MET_UINT') return 'uint32'
  if (type === 'MET_INT') return 'int32'
  if (type === 'MET_ULONG_LONG') return 'uint64'
  if (type === 'MET_FLOAT') return 'float32'
  if (type === 'MET_DOUBLE') return 'float64'
  throw unsupportedOperation(`MetaImage element type ${value} is unsupported`)
}

const semantic = (
  index: number,
): {
  readonly id: string
  readonly name: string
  readonly kind: ScientificAxisDescriptor['kind']
} => {
  if (index === 0) return { id: 'x', name: 'X', kind: 'space' }
  if (index === 1) return { id: 'y', name: 'Y', kind: 'space' }
  if (index === 2) return { id: 'z', name: 'Z', kind: 'space' }
  if (index === 3) return { id: 'time', name: 'Time', kind: 'time' }
  return { id: `axis${index}`, name: `Axis ${index}`, kind: 'index' }
}

const axesFor = (
  fields: Readonly<Record<string, string>>,
  sizes: readonly number[],
  resourceId: string,
): readonly ScientificAxisDescriptor[] => {
  const spacing =
    fields.elementspacing === undefined ? [] : numbers(fields.elementspacing, 'ElementSpacing')
  const originText = fields.offset ?? fields.origin ?? fields.position
  const origin = originText === undefined ? [] : numbers(originText, 'Offset')
  if (spacing.length !== 0 && spacing.length !== sizes.length)
    throw invalidInput('MetaImage ElementSpacing rank mismatch')
  if (origin.length !== 0 && origin.length !== sizes.length)
    throw invalidInput('MetaImage origin rank mismatch')
  return Object.freeze(
    sizes.map((length, index) => {
      const details = semantic(index)
      const step = spacing[index]
      return Object.freeze({
        ...details,
        length,
        coordinates:
          step === undefined
            ? Object.freeze({ type: 'index' as const })
            : Object.freeze({ type: 'linear' as const, origin: origin[index] ?? 0, step }),
        ...(step === undefined
          ? {}
          : {
              calibration: Object.freeze({
                kind: 'embedded' as const,
                resourceId,
                locator: `metaimage:ElementSpacing[${index}],Offset[${index}]`,
                note: 'MetaImage does not standardize a physical unit; direction is preserved separately.',
              }),
            }),
      })
    }),
  )
}

const resolveData = async (
  context: Readonly<ScientificOpenContext>,
  header: MetaHeader,
): Promise<ScientificResource> => {
  if (header.local) return context.primary
  const name = required(header.fields, 'ElementDataFile')
  if (/\bLIST\b|%/iu.test(name) || name.trim().split(/\s+/u).length !== 1)
    throw unsupportedOperation('MetaImage multi-file series are unsupported')
  if (context.companions === undefined) throw invalidInput('MHD requires a companion resolver')
  const data = await context.companions.resolve(
    { kind: 'relative-name', name },
    context.signal === undefined ? {} : { signal: context.signal },
  )
  if (data === undefined) throw invalidInput(`MetaImage data companion ${name} is missing`)
  return data
}

export const metaImageReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/meta-image',
  version: '1.0.0',
  format: 'MetaImage MHD/MHA',
  extensions: Object.freeze(['mhd', 'mha']),
  mediaTypes: Object.freeze(['application/x-metaimage']),
  capabilities: Object.freeze({ resources: 'single-or-pair', datasets: 'single', axes: 'ranked' }),
})

export const createMetaImageReader = (
  options: Readonly<MetaImageReaderOptions> = {},
): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: metaImageReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        Math.min(context.primary.source.size, 8_192),
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const text = new TextDecoder('latin1').decode(bytes)
      const matches =
        /^\s*ObjectType\s*=\s*Image\s*$/imu.test(text) &&
        /^\s*NDims\s*=\s*\d+\s*$/imu.test(text) &&
        /^\s*ElementDataFile\s*=/imu.test(text)
      if (!matches)
        return Object.freeze({ confidence: 0, reason: 'MetaImage structural fields are absent' })
      const hinted = resourceHasHint(
        context.primary,
        metaImageReaderDescriptor.extensions,
        metaImageReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 1 : 0.98,
        reason: 'MetaImage structural fields match',
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      throwIfAborted(context.signal)
      const prefixLength = Math.min(context.primary.source.size, limits.maxHeaderBytes)
      const prefix = await readExactly(
        context.primary.source,
        0,
        prefixLength,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const header = parseHeader(prefix, context.primary.source.size, limits)
      if (required(header.fields, 'ObjectType').toLowerCase() !== 'image')
        throw unsupportedOperation('MetaImage supports only ObjectType Image')
      if (!boolean(header.fields.binarydata, true, 'BinaryData'))
        throw unsupportedOperation('ASCII MetaImage payloads are unsupported')
      if (boolean(header.fields.compresseddata, false, 'CompressedData'))
        throw unsupportedOperation('Compressed MetaImage payloads are unsupported')
      const rank = Number(required(header.fields, 'NDims'))
      if (!Number.isSafeInteger(rank) || rank < 1 || rank > limits.maxDimensions)
        throw limitExceeded(`MetaImage rank exceeds ${limits.maxDimensions}`)
      const sizes = dimensions(required(header.fields, 'DimSize'), 'DimSize')
      if (sizes.length !== rank) throw invalidInput('MetaImage DimSize count does not match NDims')
      const channels = Number(header.fields.elementnumberofchannels ?? '1')
      if (!Number.isSafeInteger(channels) || channels < 1 || channels > limits.maxChannels)
        throw limitExceeded(`MetaImage channel count exceeds ${limits.maxChannels}`)
      const type = sampleType(required(header.fields, 'ElementType'))
      let elements = channels
      for (const size of sizes) {
        elements *= size
        if (!Number.isSafeInteger(elements) || elements > limits.maxElements)
          throw limitExceeded('MetaImage element limit exceeded')
      }
      const data = await resolveData(context, header)
      const headerSize = Number(header.fields.headersize ?? '0')
      if (!Number.isSafeInteger(headerSize) || headerSize < 0)
        throw unsupportedOperation('MetaImage HeaderSize -1 and invalid values are unsupported')
      const dataOffset = header.local ? header.dataOffset : headerSize
      const payloadBytes = elements * rasterSampleBytes(type)
      if (!Number.isSafeInteger(payloadBytes) || dataOffset + payloadBytes !== data.source.size)
        throw invalidInput('MetaImage payload size does not match its header')
      const msb = boolean(
        header.fields.elementbyteordermsb ?? header.fields.binarydatabyteordermsb,
        false,
        'ElementByteOrderMSB',
      )
      const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
        fields: header.fields,
        direction:
          header.fields.transformmatrix === undefined
            ? []
            : numbers(header.fields.transformmatrix, 'TransformMatrix'),
      })
      const axes = axesFor(header.fields, sizes, header.local ? context.primary.id : data.id)
      const dataset = createContiguousArrayDataset({
        source: data.source,
        dataOffset,
        sourceSampleType: type,
        sourceLittleEndian: !msb,
        axes,
        components: Object.freeze(
          Array.from({ length: channels }, (_, index) =>
            Object.freeze({
              id: `component${index}`,
              name: channels === 1 ? 'Value' : `Component ${index}`,
              kind: channels === 1 ? ('scalar' as const) : ('vector' as const),
            }),
          ),
        ),
        metadata,
        limits,
      })
      return singleDatasetDocument({
        context,
        reader: metaImageReaderDescriptor,
        metadata,
        dataset,
        datasetId: 'image',
        datasetName: 'MetaImage',
        resources: header.local
          ? [context.primary]
          : [
              Object.freeze({ id: 'header', source: context.primary.source }),
              Object.freeze({ id: 'data', source: data.source }),
            ],
      })
    },
  })
}

export const metaImageReader = createMetaImageReader()
