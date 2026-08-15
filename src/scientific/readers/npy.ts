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
} from '../reader.ts'
import { createContiguousArrayDataset, type ContiguousArrayLimits } from './interchange-shared.ts'
import { resourceHasHint, singleDatasetDocument } from './shared.ts'

const magic = Uint8Array.of(0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59)

export interface NpyReaderLimits extends ContiguousArrayLimits {
  readonly maxHeaderBytes: number
  readonly maxDimensions: number
  readonly maxElements: number
}

export interface NpyReaderOptions {
  readonly limits?: Partial<NpyReaderLimits>
}

const defaults: Readonly<NpyReaderLimits> = Object.freeze({
  maxHeaderBytes: 1_048_576,
  maxDimensions: 8,
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

const resolveLimits = (input: Partial<NpyReaderLimits> = {}): Readonly<NpyReaderLimits> =>
  Object.freeze({
    maxHeaderBytes: positive(input.maxHeaderBytes, defaults.maxHeaderBytes, 'NPY maxHeaderBytes'),
    maxDimensions: positive(input.maxDimensions, defaults.maxDimensions, 'NPY maxDimensions'),
    maxElements: positive(input.maxElements, defaults.maxElements, 'NPY maxElements'),
    maxRegionBytes: positive(input.maxRegionBytes, defaults.maxRegionBytes, 'NPY maxRegionBytes'),
    maxReadOperations: positive(
      input.maxReadOperations,
      defaults.maxReadOperations,
      'NPY maxReadOperations',
    ),
    rowsPerBlock: positive(input.rowsPerBlock, defaults.rowsPerBlock, 'NPY rowsPerBlock'),
  })

interface ParsedNpy {
  readonly dataOffset: number
  readonly sampleType: RasterSampleType
  readonly littleEndian: boolean
  readonly shape: readonly number[]
  readonly fortranOrder: boolean
  readonly descriptor: string
  readonly version: string
}

const parseShape = (header: string): readonly number[] => {
  const match = header.match(/['"]shape['"]\s*:\s*\(([^)]*)\)/u)
  if (match === null) throw invalidInput('NPY header is missing shape')
  const content = match[1]?.trim() ?? ''
  if (content.length === 0) throw unsupportedOperation('Scalar NPY arrays are unsupported')
  const values = content
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw invalidInput('NPY shape contains an invalid dimension')
  }
  return Object.freeze(values)
}

const parseDtype = (
  descriptor: string,
): { readonly sampleType: RasterSampleType; readonly littleEndian: boolean } => {
  const match = descriptor.match(/^([<>=|])([?uif])(1|2|4|8)$/u)
  if (match === null) {
    throw unsupportedOperation(`NPY dtype ${descriptor} is unsupported`)
  }
  const order = match[1]
  const kind = match[2]
  const bytes = Number(match[3])
  if (kind === '?' && bytes === 1) return { sampleType: 'uint8', littleEndian: false }
  const key = `${kind}${bytes}`
  const sampleType: RasterSampleType =
    key === 'u1'
      ? 'uint8'
      : key === 'u2'
        ? 'uint16'
        : key === 'u4'
          ? 'uint32'
          : key === 'u8'
            ? 'uint64'
            : key === 'i1'
              ? 'int8'
              : key === 'i2'
                ? 'int16'
                : key === 'i4'
                  ? 'int32'
                  : key === 'f2'
                    ? 'float16'
                    : key === 'f4'
                      ? 'float32'
                      : key === 'f8'
                        ? 'float64'
                        : (() => {
                            throw unsupportedOperation(`NPY dtype ${descriptor} is unsupported`)
                          })()
  if (rasterSampleBytes(sampleType) > 1 && order === '|') {
    throw invalidInput(`NPY dtype ${descriptor} has no byte order for a multi-byte sample`)
  }
  if (rasterSampleBytes(sampleType) > 1 && order === '=') {
    throw unsupportedOperation(
      `NPY native-endian dtype ${descriptor} is not portable without the writer architecture`,
    )
  }
  return { sampleType, littleEndian: order !== '>' }
}

const parseNpy = async (
  context: Readonly<ScientificOpenContext>,
  limits: Readonly<NpyReaderLimits>,
): Promise<ParsedNpy> => {
  const prefix = await readExactly(
    context.primary.source,
    0,
    12,
    context.signal === undefined ? {} : { signal: context.signal },
  )
  if (!magic.every((byte, index) => prefix[index] === byte)) {
    throw invalidInput('NPY magic is missing')
  }
  const major = prefix[6] ?? 0
  const minor = prefix[7] ?? 0
  if (minor !== 0 || (major !== 1 && major !== 2 && major !== 3)) {
    throw unsupportedOperation(`NPY version ${major}.${minor} is unsupported`)
  }
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength)
  const lengthBytes = major === 1 ? 2 : 4
  const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true)
  if (headerLength < 1 || headerLength > limits.maxHeaderBytes) {
    throw limitExceeded(`NPY header exceeds ${limits.maxHeaderBytes} bytes`)
  }
  const dataOffset = 8 + lengthBytes + headerLength
  const bytes = await readExactly(
    context.primary.source,
    8 + lengthBytes,
    headerLength,
    context.signal === undefined ? {} : { signal: context.signal },
  )
  let header: string
  try {
    header = new TextDecoder(major === 3 ? 'utf-8' : 'latin1', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput('NPY header text is invalid')
  }
  if (!header.endsWith('\n')) throw invalidInput('NPY header must end with a newline')
  const descriptorMatch = header.match(/['"]descr['"]\s*:\s*['"]([^'"]+)['"]/u)
  const orderMatch = header.match(/['"]fortran_order['"]\s*:\s*(True|False)/u)
  if (descriptorMatch === null || orderMatch === null) {
    throw invalidInput('NPY header is missing dtype or storage order')
  }
  if (
    [...header.matchAll(/['"]descr['"]\s*:/gu)].length !== 1 ||
    [...header.matchAll(/['"]fortran_order['"]\s*:/gu)].length !== 1 ||
    [...header.matchAll(/['"]shape['"]\s*:/gu)].length !== 1
  ) {
    throw invalidInput('NPY header requires exactly one dtype, storage-order, and shape field')
  }
  const descriptor = descriptorMatch[1] ?? ''
  const dtype = parseDtype(descriptor)
  const shape = parseShape(header)
  if (shape.length > limits.maxDimensions) {
    throw limitExceeded(`NPY rank exceeds ${limits.maxDimensions}`)
  }
  let elements = 1
  for (const length of shape) {
    elements *= length
    if (!Number.isSafeInteger(elements) || elements > limits.maxElements) {
      throw limitExceeded(`NPY element count exceeds ${limits.maxElements}`)
    }
  }
  const payloadBytes = elements * rasterSampleBytes(dtype.sampleType)
  if (!Number.isSafeInteger(payloadBytes)) throw limitExceeded('NPY payload exceeds safe integers')
  if (dataOffset + payloadBytes !== context.primary.source.size) {
    throw invalidInput('NPY file must contain exactly one complete array')
  }
  return Object.freeze({
    dataOffset,
    sampleType: dtype.sampleType,
    littleEndian: dtype.littleEndian,
    shape,
    fortranOrder: orderMatch[1] === 'True',
    descriptor,
    version: `${major}.${minor}`,
  })
}

const axesFor = (parsed: ParsedNpy): readonly ScientificAxisDescriptor[] => {
  const logical = parsed.shape.map((length, index) => {
    return Object.freeze({
      id: `axis${index}`,
      name: `Axis ${index}`,
      kind: 'index' as const,
      length,
      coordinates: Object.freeze({ type: 'index' as const }),
    })
  })
  return Object.freeze(parsed.fortranOrder ? logical : logical.reverse())
}

export const npyReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/npy',
  version: '1.0.0',
  format: 'NumPy NPY',
  extensions: Object.freeze(['npy']),
  mediaTypes: Object.freeze(['application/x-npy']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'single', axes: 'ranked' }),
})

export const createNpyReader = (options: Readonly<NpyReaderOptions> = {}): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: npyReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        magic.byteLength,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const matches =
        bytes.byteLength === magic.byteLength && magic.every((byte, index) => bytes[index] === byte)
      if (!matches) return Object.freeze({ confidence: 0, reason: 'NPY magic is absent' })
      const hinted = resourceHasHint(
        context.primary,
        npyReaderDescriptor.extensions,
        npyReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 1 : 0.99,
        reason: hinted ? 'NPY magic and hint match' : 'NPY magic matches',
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      throwIfAborted(context.signal)
      const parsed = await parseNpy(context, limits)
      const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
        version: parsed.version,
        dtype: parsed.descriptor,
        fortranOrder: parsed.fortranOrder,
        logicalShape: parsed.shape,
        calibration: 'not provided by NPY',
      })
      const dataset = createContiguousArrayDataset({
        source: context.primary.source,
        dataOffset: parsed.dataOffset,
        sourceSampleType: parsed.sampleType,
        sourceLittleEndian: parsed.littleEndian,
        axes: axesFor(parsed),
        components: [Object.freeze({ id: 'value', name: 'Value', kind: 'scalar' })],
        metadata,
        limits,
      })
      return singleDatasetDocument({
        context,
        reader: npyReaderDescriptor,
        metadata,
        dataset,
        datasetId: 'array',
        datasetName: 'NumPy array',
      })
    },
  })
}

export const npyReader = createNpyReader()
