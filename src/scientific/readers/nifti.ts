import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterSampleType } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
import { readExactly, type ImageSource } from '../../source.ts'
import type { ScientificAxisDescriptor, ScientificMetadataObject } from '../dataset.ts'
import { normalizeScientificMetadataObject } from '../dataset.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import {
  boundedGzipSource,
  createContiguousArrayDataset,
  type ContiguousArrayLimits,
} from './interchange-shared.ts'
import { resourceHasHint, singleDatasetDocument } from './shared.ts'

const gzipMagic = Uint8Array.of(0x1f, 0x8b)

export interface NiftiReaderLimits extends ContiguousArrayLimits {
  readonly maxInputBytes: number
  readonly maxDecodedBytes: number
  readonly maxElements: number
}

export interface NiftiReaderOptions {
  readonly limits?: Partial<NiftiReaderLimits>
}

const defaults: Readonly<NiftiReaderLimits> = Object.freeze({
  maxInputBytes: 1_073_741_824,
  maxDecodedBytes: 2_147_483_648,
  maxElements: 1_000_000_000,
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

const resolveLimits = (input: Partial<NiftiReaderLimits> = {}): Readonly<NiftiReaderLimits> =>
  Object.freeze({
    maxInputBytes: positive(input.maxInputBytes, defaults.maxInputBytes, 'NIfTI maxInputBytes'),
    maxDecodedBytes: positive(
      input.maxDecodedBytes,
      defaults.maxDecodedBytes,
      'NIfTI maxDecodedBytes',
    ),
    maxElements: positive(input.maxElements, defaults.maxElements, 'NIfTI maxElements'),
    maxRegionBytes: positive(input.maxRegionBytes, defaults.maxRegionBytes, 'NIfTI maxRegionBytes'),
    maxReadOperations: positive(
      input.maxReadOperations,
      defaults.maxReadOperations,
      'NIfTI maxReadOperations',
    ),
    rowsPerBlock: positive(input.rowsPerBlock, defaults.rowsPerBlock, 'NIfTI rowsPerBlock'),
  })

interface ParsedNifti {
  readonly version: 1 | 2
  readonly littleEndian: boolean
  readonly shape: readonly number[]
  readonly sampleType: RasterSampleType
  readonly dataOffset: number
  readonly slope: number
  readonly intercept: number
  readonly pixdim: readonly number[]
  readonly xyztUnits: number
  readonly qformCode: number
  readonly sformCode: number
  readonly quaternion: readonly number[]
  readonly qoffset: readonly number[]
  readonly sform: readonly number[]
  readonly description: string
}

const int64 = (view: DataView, offset: number, littleEndian: boolean, label: string): number => {
  const value = view.getBigInt64(offset, littleEndian)
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw limitExceeded(`NIfTI ${label} exceeds safe integers`)
  return Number(value)
}

const zeroTerminated = (bytes: Uint8Array): string => {
  const end = bytes.indexOf(0)
  return new TextDecoder('latin1').decode(end < 0 ? bytes : bytes.subarray(0, end)).trim()
}

const mapDatatype = (code: number, bitpix: number): RasterSampleType => {
  const mapping: Readonly<Record<number, readonly [RasterSampleType, number]>> = Object.freeze({
    2: ['uint8', 8],
    4: ['int16', 16],
    8: ['int32', 32],
    16: ['float32', 32],
    64: ['float64', 64],
    256: ['int8', 8],
    512: ['uint16', 16],
    768: ['uint32', 32],
    1280: ['uint64', 64],
  })
  const entry = mapping[code]
  if (entry === undefined) throw unsupportedOperation(`NIfTI datatype ${code} is unsupported`)
  if (entry[1] !== bitpix) throw invalidInput('NIfTI datatype and bitpix disagree')
  return entry[0]
}

const detectHeader = (
  bytes: Uint8Array,
): { readonly version: 1 | 2; readonly littleEndian: boolean } | undefined => {
  if (bytes.byteLength < 4) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (const littleEndian of [true, false]) {
    const size = view.getInt32(0, littleEndian)
    if (size === 348) return { version: 1, littleEndian }
    if (size === 540) return { version: 2, littleEndian }
  }
  return undefined
}

const parseNifti = (
  bytes: Uint8Array,
  sourceSize: number,
  limits: Readonly<NiftiReaderLimits>,
): ParsedNifti => {
  const detected = detectHeader(bytes)
  if (detected === undefined) throw invalidInput('NIfTI header size is invalid')
  const headerBytes = detected.version === 1 ? 348 : 540
  if (bytes.byteLength < headerBytes) throw invalidInput('NIfTI header is truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const le = detected.littleEndian
  const magic =
    detected.version === 1
      ? zeroTerminated(bytes.subarray(344, 348))
      : zeroTerminated(bytes.subarray(4, 12))
  if (
    (detected.version === 1 && magic !== 'n+1') ||
    (detected.version === 2 && !magic.startsWith('n+2'))
  ) {
    if (
      (detected.version === 1 && magic === 'ni1') ||
      (detected.version === 2 && magic.startsWith('ni2'))
    ) {
      throw unsupportedOperation('Paired NIfTI .hdr/.img files are unsupported')
    }
    throw invalidInput('NIfTI single-file magic is invalid')
  }
  const rank = detected.version === 1 ? view.getInt16(40, le) : int64(view, 16, le, 'rank')
  if (!Number.isSafeInteger(rank) || rank < 1 || rank > 7)
    throw unsupportedOperation(`NIfTI rank ${rank} is unsupported`)
  const shape: number[] = []
  for (let index = 0; index < rank; index += 1) {
    const value =
      detected.version === 1
        ? view.getInt16(42 + index * 2, le)
        : int64(view, 24 + index * 8, le, `dimension ${index}`)
    if (!Number.isSafeInteger(value) || value < 1)
      throw invalidInput(`NIfTI dimension ${index} is invalid`)
    shape.push(value)
  }
  let elements = 1
  for (const size of shape) {
    elements *= size
    if (!Number.isSafeInteger(elements) || elements > limits.maxElements)
      throw limitExceeded('NIfTI element limit exceeded')
  }
  const datatype = view.getInt16(detected.version === 1 ? 70 : 12, le)
  const bitpix = view.getInt16(detected.version === 1 ? 72 : 14, le)
  const type = mapDatatype(datatype, bitpix)
  const pixdim = Object.freeze(
    Array.from({ length: 8 }, (_, index) =>
      detected.version === 1
        ? view.getFloat32(76 + index * 4, le)
        : view.getFloat64(104 + index * 8, le),
    ),
  )
  const dataOffset =
    detected.version === 1 ? view.getFloat32(108, le) : int64(view, 168, le, 'vox_offset')
  if (!Number.isSafeInteger(dataOffset) || dataOffset < headerBytes)
    throw invalidInput('NIfTI vox_offset is invalid')
  const rawSlope = detected.version === 1 ? view.getFloat32(112, le) : view.getFloat64(176, le)
  const intercept = detected.version === 1 ? view.getFloat32(116, le) : view.getFloat64(184, le)
  if (!Number.isFinite(rawSlope) || !Number.isFinite(intercept))
    throw invalidInput('NIfTI scaling is not finite')
  const slope = rawSlope === 0 ? 1 : rawSlope
  if (type === 'uint64' && (slope !== 1 || intercept !== 0))
    throw unsupportedOperation('Scaled uint64 NIfTI data is unsupported')
  const xyztUnits = detected.version === 1 ? view.getUint8(123) : view.getInt32(500, le)
  const qformCode = detected.version === 1 ? view.getInt16(252, le) : view.getInt32(344, le)
  const sformCode = detected.version === 1 ? view.getInt16(254, le) : view.getInt32(348, le)
  const float = (offset1: number, offset2: number): number =>
    detected.version === 1 ? view.getFloat32(offset1, le) : view.getFloat64(offset2, le)
  const quaternion = Object.freeze([float(256, 352), float(260, 360), float(264, 368)])
  const qoffset = Object.freeze([float(268, 376), float(272, 384), float(276, 392)])
  const sform = Object.freeze(
    Array.from({ length: 12 }, (_, index) => float(280 + index * 4, 400 + index * 8)),
  )
  const description = zeroTerminated(
    bytes.subarray(detected.version === 1 ? 148 : 240, detected.version === 1 ? 228 : 320),
  )
  const payloadBytes = elements * rasterSampleBytes(type)
  if (!Number.isSafeInteger(payloadBytes) || dataOffset + payloadBytes !== sourceSize) {
    throw invalidInput('NIfTI payload size does not match its dimensions')
  }
  return Object.freeze({
    version: detected.version,
    littleEndian: le,
    shape: Object.freeze(shape),
    sampleType: type,
    dataOffset,
    slope,
    intercept,
    pixdim,
    xyztUnits,
    qformCode,
    sformCode,
    quaternion,
    qoffset,
    sform,
    description,
  })
}

const spaceUnit = (code: number): string | undefined => {
  const value = code & 0x07
  return value === 1 ? 'm' : value === 2 ? 'mm' : value === 3 ? 'µm' : undefined
}

const timeUnit = (code: number): string | undefined => {
  const value = code & 0x38
  return value === 8 ? 's' : value === 16 ? 'ms' : value === 24 ? 'µs' : undefined
}

const axisDetails = (
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

const axesFor = (parsed: ParsedNifti, resourceId: string): readonly ScientificAxisDescriptor[] =>
  Object.freeze(
    parsed.shape.map((length, index) => {
      const details = axisDetails(index)
      const rawStep = parsed.pixdim[index + 1]
      const step =
        rawStep === undefined || !Number.isFinite(rawStep) || rawStep === 0
          ? undefined
          : Math.abs(rawStep)
      const unit =
        details.kind === 'space'
          ? spaceUnit(parsed.xyztUnits)
          : details.kind === 'time'
            ? timeUnit(parsed.xyztUnits)
            : undefined
      const sformOrigin =
        index < 3 && parsed.sformCode > 0 ? parsed.sform[index * 4 + 3] : undefined
      return Object.freeze({
        ...details,
        length,
        ...(unit === undefined ? {} : { unit }),
        coordinates:
          step === undefined
            ? Object.freeze({ type: 'index' as const })
            : Object.freeze({ type: 'linear' as const, origin: sformOrigin ?? 0, step }),
        ...(step === undefined
          ? {}
          : {
              calibration: Object.freeze({
                kind: 'embedded' as const,
                resourceId,
                locator: `nifti:pixdim[${index + 1}]${parsed.sformCode > 0 ? ',sform' : ''}`,
                note:
                  parsed.sformCode > 0
                    ? 'The complete potentially rotated affine is preserved in metadata.'
                    : 'Voxel spacing is embedded; no world-space origin transform is declared.',
              }),
            }),
      })
    }),
  )

const partialGunzipHeader = async (
  input: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array | undefined> => {
  try {
    const reader = new Blob([Uint8Array.from(input)])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'))
      .getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (length < 540) {
      throwIfAborted(signal)
      const next = await reader.read()
      if (next.done) break
      chunks.push(next.value)
      length += next.value.byteLength
    }
    await reader.cancel().catch(() => undefined)
    if (length < 4) return undefined
    const output = new Uint8Array(Math.min(length, 540))
    let offset = 0
    for (const chunk of chunks) {
      const amount = Math.min(chunk.byteLength, output.byteLength - offset)
      output.set(chunk.subarray(0, amount), offset)
      offset += amount
      if (offset === output.byteLength) break
    }
    return output
  } catch {
    return undefined
  }
}

export const niftiReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/nifti',
  version: '1.0.0',
  format: 'NIfTI-1/2',
  extensions: Object.freeze(['nii', 'gz']),
  mediaTypes: Object.freeze(['application/x-nifti']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'single', axes: 'ranked' }),
})

export const createNiftiReader = (options: Readonly<NiftiReaderOptions> = {}): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: niftiReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        Math.min(context.primary.source.size, 16_384),
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const compressed = bytes[0] === gzipMagic[0] && bytes[1] === gzipMagic[1]
      const header = compressed ? await partialGunzipHeader(bytes, context.signal) : bytes
      const detected = header === undefined ? undefined : detectHeader(header)
      if (detected === undefined)
        return Object.freeze({ confidence: 0, reason: 'NIfTI header is absent' })
      const requiredBytes = detected.version === 1 ? 348 : 540
      if (header === undefined || header.byteLength < requiredBytes)
        return Object.freeze({ confidence: 0, reason: 'NIfTI header is truncated' })
      const magicText =
        detected.version === 1
          ? zeroTerminated(header.subarray(344, 348))
          : zeroTerminated(header.subarray(4, 12))
      if (!(detected.version === 1 ? magicText === 'n+1' : magicText.startsWith('n+2')))
        return Object.freeze({ confidence: 0, reason: 'NIfTI single-file magic is absent' })
      const hinted =
        resourceHasHint(
          context.primary,
          niftiReaderDescriptor.extensions,
          niftiReaderDescriptor.mediaTypes,
        ) || context.primary.name?.toLowerCase().endsWith('.nii.gz') === true
      return Object.freeze({
        confidence: hinted ? 1 : 0.99,
        reason: compressed ? 'Gzip-wrapped NIfTI header matches' : 'NIfTI header matches',
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      throwIfAborted(context.signal)
      if (context.primary.source.size > limits.maxInputBytes)
        throw limitExceeded('NIfTI input exceeds maxInputBytes')
      const prefix = await context.primary.source.read(
        0,
        2,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const compressed = prefix[0] === gzipMagic[0] && prefix[1] === gzipMagic[1]
      const source: ImageSource = compressed
        ? await boundedGzipSource(
            context.primary.source,
            limits.maxInputBytes,
            limits.maxDecodedBytes,
            context.signal,
          )
        : context.primary.source
      if (source.size > limits.maxDecodedBytes)
        throw limitExceeded('NIfTI decoded input exceeds maxDecodedBytes')
      const bytes = await readExactly(
        source,
        0,
        Math.min(source.size, 540),
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const parsed = parseNifti(bytes, source.size, limits)
      const scaled = parsed.slope !== 1 || parsed.intercept !== 0
      const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
        version: parsed.version,
        compressed,
        slope: parsed.slope,
        intercept: parsed.intercept,
        pixdim: parsed.pixdim,
        xyztUnits: parsed.xyztUnits,
        qformCode: parsed.qformCode,
        sformCode: parsed.sformCode,
        quaternion: parsed.quaternion,
        qoffset: parsed.qoffset,
        sform: parsed.sform,
        description: parsed.description,
      })
      const dataset = createContiguousArrayDataset({
        source,
        dataOffset: parsed.dataOffset,
        sourceSampleType: parsed.sampleType,
        sourceLittleEndian: parsed.littleEndian,
        axes: axesFor(parsed, context.primary.id),
        components: [Object.freeze({ id: 'value', name: 'Value', kind: 'scalar' })],
        metadata,
        ...(scaled ? { transform: { scale: parsed.slope, offset: parsed.intercept } } : {}),
        limits,
      })
      return singleDatasetDocument({
        context,
        reader: niftiReaderDescriptor,
        metadata,
        dataset,
        datasetId: 'volume',
        datasetName: parsed.description || 'NIfTI volume',
      })
    },
  })
}

export const niftiReader = createNiftiReader()
