import { combineAbortSignals, throwIfAborted } from '../abort.ts'
import type { DecodeRequest, DecoderOptions, ImageDecoder, ImageMetadata } from '../codec.ts'
import type {
  PixelChromaticities,
  PixelColorPrimaries,
  PixelColorSemantics,
  PixelRenderingIntent,
  PixelTransferFunction,
} from '../color.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock, PixelFormat, PixelSampleDisplayRange } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import {
  createNclxHdrToneMap,
  inspectIccProfile,
  nclxHdrToLinear,
  writeNclxHdrToneMappedRgba,
  writeNclxHdrLinearToneMappedRgba,
} from './icc.ts'
import type { JpegXlEntropyCode } from './jpegxl-bitstream.ts'
import {
  JpegXlBitReader,
  JpegXlEntropySymbolReader,
  readJpegXlEntropyCode,
} from './jpegxl-bitstream.ts'
import { type JpegXlFrameFeatures, readJpegXlFrameFeatures } from './jpegxl-frame-features.ts'
import { readJpegXlIcc } from './jpegxl-icc.ts'
import { defaultJpegXlLimits, type JpegXlLimits } from './jpegxl-limits.ts'
import { applyJpegXlSplines } from './jpegxl-splines.ts'

type JpegXlIccLimits = Pick<JpegXlLimits, 'maxIccCompressedBytes' | 'maxIccBytes'>

interface DistributionValue {
  readonly value: number
}

interface DistributionBits {
  readonly bits: number
  readonly offset: number
}

type Distribution = DistributionValue | DistributionBits

const value = (number: number): DistributionValue => ({ value: number })
const bits = (count: number, offset = 0): DistributionBits => ({ bits: count, offset })
const JPEG_XL_QUANT_TABLES = 17

const readU32 = (
  reader: JpegXlBitReader,
  distributions: readonly [Distribution, Distribution, Distribution, Distribution],
): number => {
  const distribution = distributions[reader.readBits(2)]
  if (!distribution) throw invalidInput('JPEG XL integer distribution is invalid')
  if ('value' in distribution) return distribution.value
  return distribution.offset + reader.readBits(distribution.bits)
}

const readU64 = (reader: JpegXlBitReader): number => {
  const selector = reader.readBits(2)
  if (selector === 0) return 0
  if (selector === 1) return 1 + reader.readBits(4)
  if (selector === 2) return 17 + reader.readBits(8)
  let result = reader.readBits(12)
  let shift = 12
  while (shift < 64 && reader.readBits(1) !== 0) {
    const count = Math.min(8, 64 - shift)
    result += reader.readBits(count) * 2 ** shift
    if (!Number.isSafeInteger(result)) {
      throw invalidInput('JPEG XL 64-bit integer exceeds the safe range')
    }
    shift += count
  }
  return result
}

const requireValue = (
  actual: number | boolean,
  expected: number | boolean,
  feature: string,
): void => {
  if (actual !== expected) {
    throw unsupportedOperation(`JPEG XL ${feature} is outside the implemented decode subset`)
  }
}

const readF16 = (reader: JpegXlBitReader): number => {
  const encoded = reader.readBits(16)
  const sign = (encoded & 0x8000) === 0 ? 1 : -1
  const exponent = (encoded >>> 10) & 0x1f
  const mantissa = encoded & 0x03ff
  if (exponent === 0x1f) throw invalidInput('JPEG XL half-precision value is not finite')
  if (exponent === 0) return sign * mantissa * 2 ** -24
  return sign * (1 + mantissa / 1_024) * 2 ** (exponent - 15)
}

const alignWithZeroPadding = (reader: JpegXlBitReader): void => {
  const padding = (8 - (reader.bitPosition & 7)) & 7
  if (padding !== 0 && reader.readBits(padding) !== 0) {
    throw invalidInput('JPEG XL byte-alignment padding is nonzero')
  }
}

const permutationContext = (value: number): number =>
  Math.min(value === 0 ? 0 : Math.floor(Math.log2(value)) + 1, 7)

const readPermutation = (reader: JpegXlBitReader, size: number): Uint32Array => {
  const code = readJpegXlEntropyCode(reader, 8)
  const symbols = new JpegXlEntropySymbolReader(code, size + 1)
  const lehmer = new Uint32Array(size)
  const end = symbols.readHybridUint(permutationContext(size), reader)
  if (end > size) throw invalidInput('JPEG XL table-of-contents permutation size is invalid')
  let last = 0
  for (let index = 0; index < end; index += 1) {
    const value = symbols.readHybridUint(permutationContext(last), reader)
    if (value >= size - index) {
      throw invalidInput('JPEG XL table-of-contents Lehmer code is invalid')
    }
    lehmer[index] = value
    last = value
  }
  if (!symbols.hasValidFinalState()) {
    throw invalidInput('JPEG XL table-of-contents permutation ANS state is invalid')
  }

  const logSize = Math.ceil(Math.log2(size))
  const paddedSize = 2 ** logSize
  const fenwick = new Uint32Array(paddedSize)
  for (let index = 0; index < paddedSize; index += 1) {
    const oneBased = index + 1
    fenwick[index] = oneBased & -oneBased
  }
  const permutation = new Uint32Array(size)
  for (let index = 0; index < size; index += 1) {
    let rank = (lehmer[index] ?? 0) + 1
    let bit = paddedSize
    let selected = 0
    for (let level = 0; level <= logSize; level += 1) {
      const candidate = selected + bit
      bit >>>= 1
      const available = fenwick[candidate - 1] ?? 0
      if (available < rank) {
        selected = candidate
        rank -= available
      }
    }
    if (selected >= size) {
      throw invalidInput('JPEG XL table-of-contents permutation index is invalid')
    }
    permutation[index] = selected
    let position = selected + 1
    while (position <= paddedSize) {
      fenwick[position - 1] = (fenwick[position - 1] ?? 0) - 1
      position += position & -position
    }
  }
  return permutation
}

const readName = (reader: JpegXlBitReader): void => {
  const length = readU32(reader, [value(0), bits(4), bits(5, 16), bits(10, 48)])
  if (length > 1_071) throw invalidInput('JPEG XL name is too long')
  reader.skipBits(length * 8)
}

interface JpegXlBitDepth {
  readonly bits: number
  readonly exponentBits: number
  readonly sampleFormat: 'unsigned-integer' | 'floating-point'
}

const readBitDepth = (reader: JpegXlBitReader): JpegXlBitDepth => {
  const floatingPoint = reader.readBits(1) !== 0
  const depth = floatingPoint
    ? readU32(reader, [value(32), value(16), value(24), bits(6, 1)])
    : readU32(reader, [value(8), value(10), value(12), bits(6, 1)])
  if (!floatingPoint) {
    if (depth < 1 || depth > 16) {
      throw unsupportedOperation('JPEG XL integer sample depths above 16 bits are not supported')
    }
    return Object.freeze({ bits: depth, exponentBits: 0, sampleFormat: 'unsigned-integer' })
  }
  const exponentBits = reader.readBits(4) + 1
  const mantissaBits = depth - exponentBits - 1
  if (exponentBits < 2 || exponentBits > 8 || mantissaBits < 2 || mantissaBits > 23) {
    throw invalidInput('JPEG XL floating-point sample depth is invalid')
  }
  return Object.freeze({ bits: depth, exponentBits, sampleFormat: 'floating-point' })
}

const fixedAspectWidth = (height: number, ratio: number): number => {
  const ratios = [
    [1, 1],
    [12, 10],
    [4, 3],
    [3, 2],
    [16, 9],
    [5, 4],
    [2, 1],
  ] as const
  const selected = ratios[ratio - 1]
  if (!selected) throw invalidInput('JPEG XL fixed aspect ratio is invalid')
  return Math.floor((height * selected[0]) / selected[1])
}

interface JpegXlChromaticity {
  readonly x: number
  readonly y: number
}

interface JpegXlToneMapping {
  readonly intensityTarget: number
  readonly minNits: number
  readonly relativeToMaxDisplay: boolean
  readonly linearBelow: number
}

export interface JpegXlExtraChannel {
  readonly index: number
  readonly type: number
  readonly bitDepth: JpegXlBitDepth
  readonly dimShift: number
  readonly associatedAlpha: boolean
}

interface JpegXlColorEncoding {
  readonly colorChannels: 1 | 3
  readonly metadataColorSpace: string
  readonly primaries: PixelColorPrimaries
  readonly transfer: PixelTransferFunction
  readonly provenance: 'assumed-default' | 'container-signaled' | 'icc'
  readonly renderingIntent: PixelRenderingIntent
  readonly wantIcc: boolean
  readonly whitePoint?: JpegXlChromaticity
  readonly customPrimaries?: readonly [JpegXlChromaticity, JpegXlChromaticity, JpegXlChromaticity]
}

export interface JpegXlSection {
  readonly offset: number
  readonly length: number
}

export interface JpegXlFrameStructure {
  readonly width: number
  readonly height: number
  readonly codedWidth: number
  readonly codedHeight: number
  readonly bitDepth: number
  readonly exponentBits: number
  readonly sampleFormat: 'unsigned-integer' | 'floating-point'
  readonly alphaBitDepth: number | undefined
  readonly alphaAssociated: boolean
  readonly selectedAlphaChannel: number | undefined
  readonly extraChannels: readonly JpegXlExtraChannel[]
  readonly colorChannels: 1 | 3
  readonly channelCount: number
  readonly metadataColorSpace: JpegXlColorEncoding['metadataColorSpace']
  readonly colorSemanticsPrimaries: PixelColorPrimaries
  readonly colorSemanticsTransfer: PixelTransferFunction
  readonly chromaticities?: PixelChromaticities
  readonly colorProvenance: JpegXlColorEncoding['provenance']
  readonly renderingIntent: PixelRenderingIntent
  readonly orientation: number
  readonly intrinsicWidth: number | undefined
  readonly intrinsicHeight: number | undefined
  readonly toneMapping: JpegXlToneMapping
  readonly iccProfile: Uint8Array | undefined
  readonly encoding: 'modular' | 'vardct'
  readonly frameType: 'regular' | 'dc' | 'reference' | 'skip-progressive'
  readonly dcLevel: number
  readonly isLast: boolean
  readonly frameOriginX: number
  readonly frameOriginY: number
  readonly frameWidth: number
  readonly frameHeight: number
  readonly saveAsReference: 0 | 1 | 2 | 3
  readonly saveBeforeColorTransform: boolean
  readonly frameFlags: number
  readonly colorTransform: 'xyb' | 'none' | 'ycbcr'
  readonly chromaSubsampling: readonly [number, number, number]
  readonly upsampling: 1 | 2 | 4 | 8
  readonly extraChannelUpsampling: readonly (1 | 2 | 4 | 8)[]
  readonly xQuantizationScale: number
  readonly bQuantizationScale: number
  readonly passCount: number
  readonly passShifts: readonly number[]
  readonly gaborish: boolean
  readonly epfIterations: number
  readonly groupDimension: number
  readonly groupsAcross: number
  readonly groupsDown: number
  readonly dcGroupCount: number
  readonly sections: readonly JpegXlSection[]
  readonly codestreamEndOffset: number
}

type JpegXlHeader = JpegXlFrameStructure

const readSize = (reader: JpegXlBitReader): { readonly width: number; readonly height: number } => {
  const small = reader.readBits(1) !== 0
  const dimensionDistribution = [bits(9, 1), bits(13, 1), bits(18, 1), bits(30, 1)] as const
  const height = small ? (reader.readBits(5) + 1) * 8 : readU32(reader, dimensionDistribution)
  const ratio = reader.readBits(3)
  const width =
    ratio !== 0
      ? fixedAspectWidth(height, ratio)
      : small
        ? (reader.readBits(5) + 1) * 8
        : readU32(reader, dimensionDistribution)
  return Object.freeze({ width, height })
}

const readEnum = (reader: JpegXlBitReader): number =>
  readU32(reader, [value(0), value(1), bits(4, 2), bits(6, 18)])

const unpackSignedInteger = (packed: number): number => (packed >>> 1) ^ -(packed & 1)

const readChromaticity = (reader: JpegXlBitReader): JpegXlChromaticity => {
  const coordinate = (): number =>
    unpackSignedInteger(
      readU32(reader, [bits(19), bits(19, 524_288), bits(20, 1_048_576), bits(21, 2_097_152)]),
    ) / 1_000_000
  const x = coordinate()
  const y = coordinate()
  if (Math.abs(x) >= 4 || Math.abs(y) >= 4) {
    throw invalidInput('JPEG XL custom chromaticity is outside its bounded range')
  }
  return Object.freeze({ x, y })
}

const colorSpaceName = (
  colorSpace: 0 | 1,
  primaries: PixelColorPrimaries,
  transfer: PixelTransferFunction,
): string => {
  if (colorSpace === 1) {
    if (transfer.kind === 'srgb') return 'gray'
    if (transfer.kind === 'linear') return 'linear-gray'
  }
  const family = colorSpace === 1 ? 'gray' : primaries
  if (transfer.kind === 'srgb') return family === 'srgb' ? 'srgb' : `${family}-srgb`
  if (transfer.kind === 'linear' && family === 'srgb') return 'linear-rgb'
  if (transfer.kind === 'gamma') return `${family}-gamma-${transfer.exponent}`
  return `${transfer.kind}-${family}`
}

const readColorEncoding = (reader: JpegXlBitReader): JpegXlColorEncoding => {
  const allDefault = reader.readBits(1) !== 0
  if (allDefault) {
    return Object.freeze({
      colorChannels: 3,
      metadataColorSpace: 'srgb',
      primaries: 'srgb',
      transfer: Object.freeze({ kind: 'srgb' }),
      provenance: 'assumed-default',
      renderingIntent: 'relative',
      wantIcc: false,
    })
  }

  const wantIcc = reader.readBits(1) !== 0
  const colorSpace = readEnum(reader)
  if (colorSpace !== 0 && colorSpace !== 1) {
    throw unsupportedOperation('JPEG XL non-RGB/gray color encoding is not supported')
  }
  if (wantIcc) {
    return Object.freeze({
      colorChannels: colorSpace === 1 ? 1 : 3,
      metadataColorSpace: 'icc',
      primaries: 'source-profile',
      transfer: Object.freeze({ kind: 'source-profile' }),
      provenance: 'icc',
      renderingIntent: 'relative',
      wantIcc: true,
    })
  }

  const whitePointCode = readEnum(reader)
  if (
    whitePointCode !== 1 &&
    whitePointCode !== 2 &&
    whitePointCode !== 10 &&
    whitePointCode !== 11
  ) {
    throw invalidInput('JPEG XL white-point enum is invalid')
  }
  const whitePoint =
    whitePointCode === 2
      ? readChromaticity(reader)
      : whitePointCode === 10
        ? Object.freeze({ x: 1 / 3, y: 1 / 3 })
        : whitePointCode === 11
          ? Object.freeze({ x: 0.314, y: 0.351 })
          : undefined
  let primaries: PixelColorPrimaries = 'srgb'
  let customPrimaries: JpegXlColorEncoding['customPrimaries']
  if (colorSpace === 0) {
    const primariesCode = readEnum(reader)
    if (primariesCode === 1) primaries = 'srgb'
    else if (primariesCode === 9) primaries = 'rec2020'
    else if (primariesCode === 11) primaries = 'display-p3'
    else if (primariesCode === 2) {
      primaries = 'unspecified'
      customPrimaries = Object.freeze([
        readChromaticity(reader),
        readChromaticity(reader),
        readChromaticity(reader),
      ])
    } else throw invalidInput('JPEG XL primaries enum is invalid')
  }

  const haveGamma = reader.readBits(1) !== 0
  let transfer: PixelTransferFunction
  if (haveGamma) {
    const gamma = reader.readBits(24)
    if (gamma < Math.ceil(10_000_000 / 8_192) || gamma > 10_000_000) {
      throw invalidInput('JPEG XL custom gamma is outside its bounded range')
    }
    transfer = Object.freeze({ kind: 'gamma', exponent: 10_000_000 / gamma })
  } else {
    const transferFunction = readEnum(reader)
    if (transferFunction === 8) transfer = Object.freeze({ kind: 'linear' })
    else if (transferFunction === 13) transfer = Object.freeze({ kind: 'srgb' })
    else if (transferFunction === 16) transfer = Object.freeze({ kind: 'pq' })
    else if (transferFunction === 18) transfer = Object.freeze({ kind: 'hlg' })
    else if (transferFunction === 17) transfer = Object.freeze({ kind: 'gamma', exponent: 2.6 })
    else
      throw unsupportedOperation(`JPEG XL transfer function ${transferFunction} is not supported`)
  }
  const renderingIntent = readEnum(reader)
  if (renderingIntent > 3) throw invalidInput('JPEG XL rendering intent is invalid')
  const renderingIntents = ['perceptual', 'relative', 'saturation', 'absolute'] as const
  const parsedRenderingIntent = renderingIntents[renderingIntent]
  if (!parsedRenderingIntent) throw invalidInput('JPEG XL rendering intent is invalid')

  return Object.freeze({
    colorChannels: colorSpace === 1 ? 1 : 3,
    metadataColorSpace:
      colorSpaceName(colorSpace, primaries, transfer) +
      (whitePoint === undefined ? '' : '-custom-white'),
    primaries,
    transfer,
    provenance: 'container-signaled',
    renderingIntent: parsedRenderingIntent,
    wantIcc: false,
    ...(whitePoint === undefined ? {} : { whitePoint }),
    ...(customPrimaries === undefined ? {} : { customPrimaries }),
  })
}

const channelCountFor = (colorChannels: 1 | 3, extraChannels: number): number =>
  colorChannels + extraChannels

const defaultToneMapping: Readonly<JpegXlToneMapping> = Object.freeze({
  intensityTarget: 255,
  minNits: 0,
  relativeToMaxDisplay: false,
  linearBelow: 0,
})

const readToneMapping = (reader: JpegXlBitReader): JpegXlToneMapping => {
  if (reader.readBits(1) !== 0) return defaultToneMapping
  const intensityTarget = readF16(reader)
  const minNits = readF16(reader)
  const relativeToMaxDisplay = reader.readBits(1) !== 0
  const linearBelow = readF16(reader)
  if (
    intensityTarget <= 0 ||
    minNits < 0 ||
    minNits > intensityTarget ||
    linearBelow < 0 ||
    (relativeToMaxDisplay && linearBelow > 1)
  ) {
    throw invalidInput('JPEG XL tone-mapping metadata is invalid')
  }
  return Object.freeze({ intensityTarget, minNits, relativeToMaxDisplay, linearBelow })
}

const readHeader = (
  codestream: Uint8Array,
  codestreamBytes: number,
  limits: ImageLimits,
  allowVarDct = false,
  decoderOptions: Readonly<DecoderOptions> = {},
  previousFrame?: Readonly<JpegXlHeader>,
  iccLimits: Readonly<JpegXlIccLimits> = defaultJpegXlLimits,
): JpegXlHeader => {
  let reader: JpegXlBitReader
  let width: number
  let height: number
  let bitDepth: number
  let exponentBits: number
  let sampleFormat: JpegXlFrameStructure['sampleFormat']
  let alphaBitDepth: number | undefined
  let alphaAssociated: boolean
  let selectedAlphaChannel: number | undefined
  let parsedExtraChannels: readonly JpegXlExtraChannel[]
  let extraChannels: number
  let orientation: number
  let intrinsicWidth: number | undefined
  let intrinsicHeight: number | undefined
  let toneMapping: JpegXlToneMapping
  let iccProfile: Uint8Array | undefined
  let xybEncoded: boolean
  let colorEncoding: JpegXlColorEncoding
  let channelCount: number
  if (previousFrame) {
    reader = new JpegXlBitReader(codestream, previousFrame.codestreamEndOffset * 8)
    width = previousFrame.width
    height = previousFrame.height
    bitDepth = previousFrame.bitDepth
    exponentBits = previousFrame.exponentBits
    sampleFormat = previousFrame.sampleFormat
    alphaBitDepth = previousFrame.alphaBitDepth
    alphaAssociated = previousFrame.alphaAssociated
    selectedAlphaChannel = previousFrame.selectedAlphaChannel
    parsedExtraChannels = previousFrame.extraChannels
    extraChannels = parsedExtraChannels.length
    orientation = previousFrame.orientation
    intrinsicWidth = previousFrame.intrinsicWidth
    intrinsicHeight = previousFrame.intrinsicHeight
    toneMapping = previousFrame.toneMapping
    iccProfile = previousFrame.iccProfile
    xybEncoded = previousFrame.colorTransform === 'xyb'
    colorEncoding = Object.freeze({
      colorChannels: previousFrame.colorChannels,
      metadataColorSpace: previousFrame.metadataColorSpace,
      primaries: previousFrame.colorSemanticsPrimaries,
      transfer: previousFrame.colorSemanticsTransfer,
      provenance: previousFrame.colorProvenance,
      renderingIntent: previousFrame.renderingIntent,
      wantIcc: previousFrame.colorProvenance === 'icc',
      ...(previousFrame.chromaticities === undefined
        ? {}
        : {
            whitePoint: previousFrame.chromaticities.whitePoint,
            customPrimaries: previousFrame.chromaticities.primaries,
          }),
    })
    channelCount = previousFrame.channelCount
  } else {
    if (codestream[0] !== 0xff || codestream[1] !== 0x0a) {
      throw invalidInput('JPEG XL codestream signature is missing')
    }
    reader = new JpegXlBitReader(codestream, 16)
    ;({ width, height } = readSize(reader))
    validateImageDimensions(width, height, 1, limits)

    requireValue(reader.readBits(1) !== 0, false, 'default XYB metadata')
    const extraFields = reader.readBits(1) !== 0
    orientation = 1
    if (extraFields) {
      orientation = reader.readBits(3) + 1
      const haveIntrinsicSize = reader.readBits(1) !== 0
      if (haveIntrinsicSize) {
        const intrinsic = readSize(reader)
        intrinsicWidth = intrinsic.width
        intrinsicHeight = intrinsic.height
        validateImageDimensions(intrinsic.width, intrinsic.height, 1, limits)
      }
      const havePreview = reader.readBits(1) !== 0
      if (havePreview) throw unsupportedOperation('JPEG XL preview images are not supported')
      const haveAnimation = reader.readBits(1) !== 0
      if (haveAnimation) throw unsupportedOperation('JPEG XL animation is not supported')
    }
    const decodedBitDepth = readBitDepth(reader)
    bitDepth = decodedBitDepth.bits
    exponentBits = decodedBitDepth.exponentBits
    sampleFormat = decodedBitDepth.sampleFormat
    reader.readBits(1) // modular_16_bit_buffer_sufficient
    extraChannels = readU32(reader, [value(0), value(1), bits(4, 2), bits(12, 1)])
    if (extraChannels > 16) throw limitExceeded('JPEG XL extra-channel count exceeds 16')
    const extras: JpegXlExtraChannel[] = []
    // Extra-channel metadata precedes the color encoding that determines the color plane count.
    for (let index = 0; index < extraChannels; index += 1) {
      const defaultExtraChannel = reader.readBits(1) !== 0
      if (defaultExtraChannel) {
        extras.push(
          Object.freeze({
            index,
            type: 0,
            bitDepth: Object.freeze({
              bits: 8,
              exponentBits: 0,
              sampleFormat: 'unsigned-integer',
            }),
            dimShift: 0,
            associatedAlpha: false,
          }),
        )
      } else {
        const type = readU32(reader, [value(0), value(1), bits(4, 2), bits(6, 18)])
        const extraBitDepth = readBitDepth(reader)
        const dimShift = readU32(reader, [value(0), value(3), value(4), bits(3, 1)])
        readName(reader)
        const associatedAlpha = type === 0 && reader.readBits(1) !== 0
        if (type === 2) for (let component = 0; component < 4; component += 1) readF16(reader)
        if (type === 6) readU32(reader, [value(1), bits(2), bits(4, 3), bits(8, 19)])
        if (type !== 0) {
          throw unsupportedOperation(`JPEG XL extra-channel type ${type} is not supported`)
        }
        extras.push(
          Object.freeze({
            index,
            type,
            bitDepth: extraBitDepth,
            dimShift,
            associatedAlpha,
          }),
        )
      }
    }
    parsedExtraChannels = Object.freeze(extras)
    const alphaChannels = parsedExtraChannels.filter(({ type }) => type === 0)
    const requestedAlpha = decoderOptions.alphaChannel ?? 0
    if (!Number.isSafeInteger(requestedAlpha) || requestedAlpha < 0) {
      throw invalidInput('JPEG XL alphaChannel must be a nonnegative safe integer')
    }
    const selectedAlpha = alphaChannels[requestedAlpha]
    if (decoderOptions.alphaChannel !== undefined && !selectedAlpha) {
      throw invalidInput(
        `JPEG XL alphaChannel ${decoderOptions.alphaChannel} does not identify an alpha channel`,
      )
    }
    selectedAlphaChannel = selectedAlpha?.index
    alphaBitDepth = selectedAlpha?.bitDepth.bits
    alphaAssociated = selectedAlpha?.associatedAlpha ?? false
    xybEncoded = reader.readBits(1) !== 0
    if (xybEncoded && !allowVarDct) {
      throw unsupportedOperation(
        'JPEG XL XYB color encoding is outside the implemented decode subset',
      )
    }
    colorEncoding = readColorEncoding(reader)
    channelCount = channelCountFor(colorEncoding.colorChannels, extraChannels)
    toneMapping = extraFields ? readToneMapping(reader) : defaultToneMapping
    requireValue(readU64(reader), 0, 'image-metadata extensions')
    requireValue(reader.readBits(1) !== 0, true, 'custom transform weights')
    if (colorEncoding.wantIcc) {
      iccProfile = readJpegXlIcc(reader, iccLimits.maxIccCompressedBytes, iccLimits.maxIccBytes)
      inspectIccProfile(iccProfile)
      const profileSpace = String.fromCharCode(...iccProfile.subarray(16, 20))
      if (profileSpace !== (colorEncoding.colorChannels === 1 ? 'GRAY' : 'RGB ')) {
        throw invalidInput('JPEG XL ICC color space conflicts with its color channels')
      }
    }
    alignWithZeroPadding(reader)
  }

  const allDefaultFrameHeader = reader.readBits(1) !== 0
  let frameType: JpegXlFrameStructure['frameType'] = 'regular'
  let encoding: 'modular' | 'vardct' = 'vardct'
  let frameFlags = 0
  let colorTransform: 'xyb' | 'ycbcr' | 'none' = xybEncoded ? 'xyb' : 'none'
  const chromaSubsampling = [0, 0, 0] as [number, number, number]
  let upsampling: 1 | 2 | 4 | 8 = 1
  let extraChannelUpsampling: (1 | 2 | 4 | 8)[] = new Array(extraChannels).fill(1)
  let groupSizeShift = 1
  let xQuantizationScale = xybEncoded ? 3 : 2
  let bQuantizationScale = 2
  let passCount = 1
  let passShifts: number[] = [0]
  let dcLevel = 0
  let isLast = true
  let frameOriginX = 0
  let frameOriginY = 0
  let frameWidth = width
  let frameHeight = height
  let saveAsReference: 0 | 1 | 2 | 3 = 0
  let saveBeforeColorTransform = false
  let gaborish = true
  let epfIterations = 2
  if (!allDefaultFrameHeader) {
    const frameTypeCode = readU32(reader, [value(0), value(1), value(2), value(3)])
    frameType =
      frameTypeCode === 0
        ? 'regular'
        : frameTypeCode === 1
          ? 'dc'
          : frameTypeCode === 2
            ? 'reference'
            : 'skip-progressive'
    encoding = reader.readBits(1) !== 0 ? 'modular' : 'vardct'
    frameFlags = readU64(reader)
    if ((frameFlags & ~0xb3) !== 0) throw unsupportedOperation('JPEG XL frame uses reserved flags')
    colorTransform = xybEncoded ? 'xyb' : reader.readBits(1) !== 0 ? 'ycbcr' : 'none'
    if (colorTransform === 'ycbcr' && (frameFlags & 0x20) === 0) {
      for (let channel = 0; channel < 3; channel += 1) {
        chromaSubsampling[channel] = reader.readBits(2)
      }
    }
    if ((frameFlags & 0x20) === 0) {
      upsampling = readU32(reader, [value(1), value(2), value(4), value(8)]) as 1 | 2 | 4 | 8
      extraChannelUpsampling = []
      for (let index = 0; index < extraChannels; index += 1) {
        const extraUpsampling = readU32(reader, [value(1), value(2), value(4), value(8)]) as
          | 1
          | 2
          | 4
          | 8
        if (extraUpsampling * 2 ** (parsedExtraChannels[index]?.dimShift ?? 0) < upsampling) {
          throw invalidInput('JPEG XL extra-channel upsampling is smaller than color upsampling')
        }
        extraChannelUpsampling.push(extraUpsampling)
      }
    }
    groupSizeShift = encoding === 'modular' ? reader.readBits(2) : 1
    xQuantizationScale = 2
    if (encoding === 'vardct' && colorTransform === 'xyb') {
      xQuantizationScale = reader.readBits(3)
      bQuantizationScale = reader.readBits(3)
    }
    if (frameType !== 'reference') {
      passCount = readU32(reader, [value(1), value(2), value(3), bits(3, 4)])
      passShifts = new Array<number>(passCount).fill(0)
    }
    if (frameType !== 'reference' && passCount !== 1) {
      const downsampleCount = readU32(reader, [value(0), value(1), value(2), bits(1, 3)])
      if (downsampleCount > passCount)
        throw invalidInput('JPEG XL progressive downsample count exceeds its pass count')
      for (let index = 0; index < passCount - 1; index += 1) passShifts[index] = reader.readBits(2)
      let previousDownsample = 9
      for (let index = 0; index < downsampleCount; index += 1) {
        const downsample = readU32(reader, [value(1), value(2), value(4), value(8)])
        if (downsample >= previousDownsample)
          throw invalidInput('JPEG XL progressive downsample factors are not decreasing')
        previousDownsample = downsample
      }
      let previousPass = -1
      for (let index = 0; index < downsampleCount; index += 1) {
        const lastPass = readU32(reader, [value(0), value(1), value(2), bits(3)])
        if (lastPass <= previousPass || lastPass >= passCount)
          throw invalidInput('JPEG XL progressive pass boundary is invalid')
        previousPass = lastPass
      }
    }
    dcLevel = frameType === 'dc' ? readU32(reader, [value(1), value(2), value(3), value(4)]) : 0
    isLast = false
    if (frameType !== 'dc') {
      const customSizeOrOrigin = reader.readBits(1) !== 0
      if (customSizeOrOrigin) {
        const frameGeometry = [bits(8), bits(11, 256), bits(14, 2_304), bits(30, 18_688)] as const
        if (frameType === 'regular' || frameType === 'skip-progressive') {
          frameOriginX = unpackSigned(readU32(reader, frameGeometry))
          frameOriginY = unpackSigned(readU32(reader, frameGeometry))
        }
        frameWidth = readU32(reader, frameGeometry)
        frameHeight = readU32(reader, frameGeometry)
        if (frameWidth < 1 || frameHeight < 1) {
          throw invalidInput('JPEG XL custom frame dimensions are invalid')
        }
      }
    }
    if (frameType === 'regular' || frameType === 'skip-progressive') {
      requireValue(readU32(reader, [value(0), value(1), value(2), bits(2, 3)]), 0, 'frame blending')
      for (let index = 0; index < extraChannels; index += 1) {
        requireValue(
          readU32(reader, [value(0), value(1), value(2), bits(2, 3)]),
          0,
          'extra-channel blending',
        )
      }
      isLast = reader.readBits(1) !== 0
    }
    if (frameType !== 'dc' && !isLast) {
      saveAsReference = readU32(reader, [value(0), value(1), value(2), value(3)]) as 0 | 1 | 2 | 3
    }
    if (frameType === 'reference') {
      saveBeforeColorTransform = reader.readBits(1) !== 0
    } else if ((frameType === 'regular' || frameType === 'skip-progressive') && !isLast) {
      saveBeforeColorTransform = reader.readBits(1) !== 0
    }
    readName(reader)
    const defaultLoopFilter = reader.readBits(1) !== 0
    if (!defaultLoopFilter) {
      gaborish = reader.readBits(1) !== 0
      if (gaborish) requireValue(reader.readBits(1) !== 0, false, 'custom Gaborish filtering')
      epfIterations = reader.readBits(2)
      if (epfIterations > 0) {
        if (encoding === 'vardct')
          requireValue(reader.readBits(1) !== 0, false, 'custom EPF sharpness')
        requireValue(reader.readBits(1) !== 0, false, 'custom EPF weights')
        requireValue(reader.readBits(1) !== 0, false, 'custom EPF sigma')
        if (encoding === 'modular') {
          const modularSigma = readF16(reader)
          if (modularSigma < 1e-8) throw invalidInput('JPEG XL Modular EPF sigma is too small')
        }
      }
      requireValue(readU64(reader), 0, 'loop-filter extensions')
    }
    const frameExtensions = readU64(reader)
    if (frameExtensions !== 0)
      throw unsupportedOperation(
        `JPEG XL frame extensions ${frameExtensions} are outside the implemented decode subset`,
      )
  }

  if (encoding === 'vardct' && !allowVarDct) {
    throw unsupportedOperation('JPEG XL VarDCT frames are outside the implemented decode subset')
  }

  const frameScale = 2 ** (3 * dcLevel)
  const codedFrameWidth = Math.ceil(Math.ceil(frameWidth / frameScale) / upsampling)
  const codedFrameHeight = Math.ceil(Math.ceil(frameHeight / frameScale) / upsampling)
  const groupDimension = encoding === 'modular' ? 128 * 2 ** groupSizeShift : 256
  const groupsAcross = Math.ceil(codedFrameWidth / groupDimension)
  const groupsDown = Math.ceil(codedFrameHeight / groupDimension)
  const groupCount = groupsAcross * groupsDown
  const dcGroupDimension = groupDimension * 8
  const dcGroupCount =
    Math.ceil(codedFrameWidth / dcGroupDimension) * Math.ceil(codedFrameHeight / dcGroupDimension)
  if (encoding === 'modular') {
    const workingWidth =
      groupCount === 1 ? codedFrameWidth : Math.min(codedFrameWidth, groupDimension)
    const workingHeight =
      groupCount === 1 ? codedFrameHeight : Math.min(codedFrameHeight, groupDimension)
    const planeBytes = BigInt(workingWidth) * BigInt(workingHeight) * BigInt(channelCount) * 4n
    if (planeBytes > BigInt(limits.maxDecodedBytes)) {
      throw limitExceeded(
        `JPEG XL Modular working planes require ${planeBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
      )
    }
  }
  const sectionCount =
    groupCount === 1 && passCount === 1 ? 1 : 2 + dcGroupCount + groupCount * passCount
  if (sectionCount > 65_536) throw limitExceeded('JPEG XL frame has too many sections')
  const permutation = reader.readBits(1) !== 0 ? readPermutation(reader, sectionCount) : undefined
  alignWithZeroPadding(reader)
  const sectionLengths: number[] = []
  for (let index = 0; index < sectionCount; index += 1) {
    sectionLengths.push(
      readU32(reader, [bits(10), bits(14, 1_024), bits(22, 17_408), bits(30, 4_211_712)]),
    )
  }
  alignWithZeroPadding(reader)
  let sectionOffset = reader.bitPosition >>> 3
  const physicalSections: JpegXlSection[] = []
  for (const sectionLength of sectionLengths) {
    if (sectionOffset + sectionLength > codestreamBytes) {
      throw invalidInput('JPEG XL frame section extent is invalid')
    }
    physicalSections.push(Object.freeze({ offset: sectionOffset, length: sectionLength }))
    sectionOffset += sectionLength
  }
  const sections =
    permutation === undefined
      ? physicalSections
      : Array.from(permutation, (index) => {
          const section = physicalSections[index]
          if (!section) throw invalidInput('JPEG XL table-of-contents permutation is invalid')
          return section
        })
  if ((sections[0]?.length ?? 0) < 1) {
    throw invalidInput('JPEG XL frame global section is empty')
  }
  return Object.freeze({
    width,
    height,
    codedWidth: codedFrameWidth,
    codedHeight: codedFrameHeight,
    bitDepth,
    exponentBits,
    sampleFormat,
    alphaBitDepth,
    alphaAssociated,
    selectedAlphaChannel,
    extraChannels: parsedExtraChannels,
    colorChannels: colorEncoding.colorChannels,
    channelCount,
    metadataColorSpace: colorEncoding.metadataColorSpace,
    colorSemanticsPrimaries: colorEncoding.primaries,
    ...(colorEncoding.whitePoint === undefined && colorEncoding.customPrimaries === undefined
      ? {}
      : {
          chromaticities: Object.freeze({
            whitePoint: colorEncoding.whitePoint ?? Object.freeze({ x: 0.3127, y: 0.329 }),
            ...(colorEncoding.customPrimaries === undefined
              ? {}
              : { primaries: colorEncoding.customPrimaries }),
          }),
        }),
    colorSemanticsTransfer: colorEncoding.transfer,
    colorProvenance: colorEncoding.provenance,
    renderingIntent: colorEncoding.renderingIntent,
    orientation,
    intrinsicWidth,
    intrinsicHeight,
    toneMapping,
    iccProfile,
    encoding,
    frameType,
    dcLevel,
    isLast,
    frameOriginX,
    frameOriginY,
    frameWidth,
    frameHeight,
    saveAsReference,
    saveBeforeColorTransform,
    frameFlags,
    colorTransform,
    chromaSubsampling: Object.freeze(chromaSubsampling),
    upsampling,
    extraChannelUpsampling: Object.freeze(extraChannelUpsampling),
    xQuantizationScale,
    bQuantizationScale,
    passCount,
    passShifts: Object.freeze(passShifts),
    gaborish,
    epfIterations,
    groupDimension,
    groupsAcross,
    groupsDown,
    dcGroupCount,
    sections: Object.freeze(sections),
    codestreamEndOffset: sectionOffset,
  })
}

export interface JpegXlModularLeaf {
  readonly kind: 'leaf'
  readonly predictor: number
  readonly offset: number
  readonly multiplier: number
  readonly context: number
}

export interface JpegXlModularBranch {
  readonly kind: 'branch'
  readonly property: number
  readonly split: number
  readonly greater: number
  readonly lessOrEqual: number
}

export type JpegXlModularNode = JpegXlModularLeaf | JpegXlModularBranch
type ModularLeaf = JpegXlModularLeaf
type ModularNode = JpegXlModularNode

const unpackSigned = (packed: number): number => (packed >>> 1) ^ -(packed & 1)

const readTree = (
  reader: JpegXlBitReader,
): { readonly nodes: readonly ModularNode[]; readonly leaves: number } => {
  const code = readJpegXlEntropyCode(reader, 6)
  const symbols = new JpegXlEntropySymbolReader(code)
  const nodes: ModularNode[] = []
  let pending = 1
  let leaves = 0
  while (pending > 0) {
    pending -= 1
    if (nodes.length >= 4_096) throw invalidInput('JPEG XL Modular tree is too large')
    const propertyPlusOne = symbols.readHybridUint(1, reader)
    if (propertyPlusOne === 0) {
      const predictor = symbols.readHybridUint(2, reader)
      const offset = unpackSigned(symbols.readHybridUint(3, reader))
      const multiplierLog = symbols.readHybridUint(4, reader)
      const multiplierBits = symbols.readHybridUint(5, reader)
      if (
        predictor > 13 ||
        multiplierLog >= 31 ||
        multiplierBits >= 2 ** (31 - multiplierLog) - 1
      ) {
        throw invalidInput('JPEG XL Modular tree leaf is invalid')
      }
      nodes.push(
        Object.freeze({
          kind: 'leaf',
          predictor,
          offset,
          multiplier: (multiplierBits + 1) * 2 ** multiplierLog,
          context: leaves,
        }),
      )
      leaves += 1
      continue
    }
    const property = propertyPlusOne - 1
    if (property > 15) {
      throw unsupportedOperation(
        'JPEG XL previous-channel Modular tree properties are not supported',
      )
    }
    const split = unpackSigned(symbols.readHybridUint(0, reader))
    const greater = nodes.length + pending + 1
    nodes.push(
      Object.freeze({
        kind: 'branch',
        property,
        split,
        greater,
        lessOrEqual: greater + 1,
      }),
    )
    pending += 2
  }
  if (!symbols.hasValidFinalState()) throw invalidInput('JPEG XL Modular tree ANS state is invalid')
  return Object.freeze({ nodes: Object.freeze(nodes), leaves })
}

export const readJpegXlModularTree = readTree

export interface JpegXlModularChannelLayout {
  readonly width: number
  readonly height: number
}

type ModularChannelLayout = JpegXlModularChannelLayout

interface ModularRctTransform {
  readonly kind: 'rct'
  readonly beginChannel: number
  readonly type: number
}

interface ModularPaletteTransform {
  readonly kind: 'palette'
  readonly beginChannel: number
  readonly channelCount: number
  readonly colorCount: number
  readonly deltaCount: number
  readonly predictor: number
}

interface ModularSqueezeParameters {
  readonly horizontal: boolean
  readonly inPlace: boolean
  readonly beginChannel: number
  readonly channelCount: number
}

interface ModularSqueezeTransform {
  readonly kind: 'squeeze'
  readonly parameters: readonly ModularSqueezeParameters[]
}

type ModularTransform = ModularRctTransform | ModularPaletteTransform | ModularSqueezeTransform

interface WeightedPredictorParameters {
  readonly p1: number
  readonly p2: number
  readonly p3a: number
  readonly p3b: number
  readonly p3c: number
  readonly p3d: number
  readonly p3e: number
  readonly weights: readonly [number, number, number, number]
}

export const defaultJpegXlWeightedPredictor = Object.freeze({
  p1: 16,
  p2: 10,
  p3a: 7,
  p3b: 7,
  p3c: 7,
  p3d: 0,
  p3e: 0,
  weights: Object.freeze([13, 12, 12, 12] as const),
})

const readWeightedPredictor = (reader: JpegXlBitReader): WeightedPredictorParameters => {
  if (reader.readBits(1) !== 0) return defaultJpegXlWeightedPredictor
  return Object.freeze({
    p1: reader.readBits(5),
    p2: reader.readBits(5),
    p3a: reader.readBits(5),
    p3b: reader.readBits(5),
    p3c: reader.readBits(5),
    p3d: reader.readBits(5),
    p3e: reader.readBits(5),
    weights: Object.freeze([
      reader.readBits(4),
      reader.readBits(4),
      reader.readBits(4),
      reader.readBits(4),
    ] as [number, number, number, number]),
  })
}

interface ModularProgram {
  readonly frameFeatures?: JpegXlFrameFeatures
  readonly dcQuantization?: readonly [number, number, number]
  readonly nodes: readonly ModularNode[]
  readonly section: Uint8Array
  readonly residualBitPosition: number
  readonly pixelCode: JpegXlEntropyCode
  readonly weightedPredictor: WeightedPredictorParameters
  readonly usesWeightedPrediction: boolean
  readonly channelLayouts: readonly ModularChannelLayout[]
  readonly transforms: readonly ModularTransform[]
  readonly metaChannelCount: number
  readonly groupId: number
  readonly prefixPlanes: readonly Int32Array<ArrayBufferLike>[]
}

const sameLayout = (first: ModularChannelLayout, second: ModularChannelLayout): boolean =>
  first.width === second.width && first.height === second.height

const validateTransformRange = (
  layouts: readonly ModularChannelLayout[],
  metaChannelCount: number,
  beginChannel: number,
  channelCount: number,
  name: string,
): void => {
  const endChannel = beginChannel + channelCount - 1
  if (
    channelCount < 1 ||
    beginChannel < 0 ||
    endChannel >= layouts.length ||
    (beginChannel < metaChannelCount && endChannel >= metaChannelCount)
  ) {
    throw invalidInput(`JPEG XL ${name} channel range is invalid`)
  }
}

const defaultSqueezeParameters = (
  layouts: readonly ModularChannelLayout[],
  metaChannelCount: number,
): readonly ModularSqueezeParameters[] => {
  const normalChannelCount = layouts.length - metaChannelCount
  const first = layouts[metaChannelCount]
  if (!first || normalChannelCount < 1) {
    throw invalidInput('JPEG XL default Squeeze has no normal channels')
  }
  let width = first.width
  let height = first.height
  const parameters: ModularSqueezeParameters[] = []
  const second = layouts[metaChannelCount + 1]
  if (normalChannelCount > 2 && second && sameLayout(first, second)) {
    parameters.push(
      Object.freeze({
        horizontal: true,
        inPlace: false,
        beginChannel: metaChannelCount + 1,
        channelCount: 2,
      }),
      Object.freeze({
        horizontal: false,
        inPlace: false,
        beginChannel: metaChannelCount + 1,
        channelCount: 2,
      }),
    )
  }
  const wide = width > height
  if (!wide && height > 8) {
    parameters.push(
      Object.freeze({
        horizontal: false,
        inPlace: true,
        beginChannel: metaChannelCount,
        channelCount: normalChannelCount,
      }),
    )
    height = Math.ceil(height / 2)
  }
  while (width > 8 || height > 8) {
    if (width > 8) {
      parameters.push(
        Object.freeze({
          horizontal: true,
          inPlace: true,
          beginChannel: metaChannelCount,
          channelCount: normalChannelCount,
        }),
      )
      width = Math.ceil(width / 2)
    }
    if (height > 8) {
      parameters.push(
        Object.freeze({
          horizontal: false,
          inPlace: true,
          beginChannel: metaChannelCount,
          channelCount: normalChannelCount,
        }),
      )
      height = Math.ceil(height / 2)
    }
  }
  return Object.freeze(parameters)
}

const applySqueezeLayouts = (
  layouts: ModularChannelLayout[],
  initialMetaChannelCount: number,
  parameters: readonly ModularSqueezeParameters[],
): number => {
  let metaChannelCount = initialMetaChannelCount
  for (const parameter of parameters) {
    validateTransformRange(
      layouts,
      metaChannelCount,
      parameter.beginChannel,
      parameter.channelCount,
      'Squeeze',
    )
    const endChannel = parameter.beginChannel + parameter.channelCount - 1
    if (parameter.beginChannel < metaChannelCount) {
      if (!parameter.inPlace) {
        throw invalidInput('JPEG XL meta-channel Squeeze must store residuals in place')
      }
      metaChannelCount += parameter.channelCount
    }
    const residualOffset = parameter.inPlace ? endChannel + 1 : layouts.length
    for (let channel = parameter.beginChannel; channel <= endChannel; channel += 1) {
      const layout = layouts[channel]
      if (!layout || layout.width < 1 || layout.height < 1) {
        throw invalidInput('JPEG XL Squeeze channel dimensions are invalid')
      }
      const average = Object.freeze({
        width: parameter.horizontal ? Math.ceil(layout.width / 2) : layout.width,
        height: parameter.horizontal ? layout.height : Math.ceil(layout.height / 2),
      })
      const residual = Object.freeze({
        width: parameter.horizontal ? Math.floor(layout.width / 2) : layout.width,
        height: parameter.horizontal ? layout.height : Math.floor(layout.height / 2),
      })
      layouts[channel] = average
      layouts.splice(residualOffset + channel - parameter.beginChannel, 0, residual)
      if (layouts.length > 1_024) {
        throw limitExceeded('JPEG XL Modular transforms create too many channels')
      }
    }
  }
  return metaChannelCount
}

const readModularTransforms = (
  reader: JpegXlBitReader,
  channelLayouts: ModularChannelLayout[],
  initialMetaChannelCount: number,
): Readonly<{ transforms: readonly ModularTransform[]; metaChannelCount: number }> => {
  const transformCount = readU32(reader, [value(0), value(1), bits(4, 2), bits(8, 18)])
  if (transformCount > 256) {
    throw limitExceeded('JPEG XL Modular transform count exceeds 256')
  }
  const transforms: ModularTransform[] = []
  let metaChannelCount = initialMetaChannelCount
  for (let transformIndex = 0; transformIndex < transformCount; transformIndex += 1) {
    const transform = readU32(reader, [value(0), value(1), value(2), value(3)])
    if (transform === 0) {
      const beginChannel = readU32(reader, [bits(3), bits(6, 8), bits(10, 72), bits(13, 1_096)])
      const type = readU32(reader, [value(6), bits(2), bits(4, 2), bits(6, 10)])
      validateTransformRange(channelLayouts, metaChannelCount, beginChannel, 3, 'RCT')
      const firstLayout = channelLayouts[beginChannel]
      if (
        type >= 42 ||
        !firstLayout ||
        channelLayouts
          .slice(beginChannel, beginChannel + 3)
          .some((layout) => !sameLayout(firstLayout, layout))
      ) {
        throw invalidInput('JPEG XL RCT parameters are invalid')
      }
      transforms.push(Object.freeze({ kind: 'rct', beginChannel, type }))
    } else if (transform === 1) {
      const beginChannel = readU32(reader, [bits(3), bits(6, 8), bits(10, 72), bits(13, 1_096)])
      const paletteChannelCount = readU32(reader, [value(1), value(3), value(4), bits(13, 1)])
      const colorCount = readU32(reader, [bits(8), bits(10, 256), bits(12, 1_280), bits(16, 5_376)])
      const deltaCount = readU32(reader, [value(0), bits(8, 1), bits(10, 257), bits(16, 1_281)])
      const predictor = reader.readBits(4)
      if (predictor > 13 || colorCount + deltaCount < 1) {
        throw invalidInput('JPEG XL Palette transform is invalid')
      }
      validateTransformRange(
        channelLayouts,
        metaChannelCount,
        beginChannel,
        paletteChannelCount,
        'Palette',
      )
      const firstLayout = channelLayouts[beginChannel]
      if (
        !firstLayout ||
        channelLayouts
          .slice(beginChannel, beginChannel + paletteChannelCount)
          .some((layout) => !sameLayout(firstLayout, layout))
      ) {
        throw invalidInput('JPEG XL Palette channel dimensions do not match')
      }
      if (beginChannel >= metaChannelCount) metaChannelCount += 1
      else metaChannelCount += 2 - paletteChannelCount
      channelLayouts.splice(beginChannel + 1, paletteChannelCount - 1)
      channelLayouts.unshift({ width: colorCount + deltaCount, height: paletteChannelCount })
      transforms.push(
        Object.freeze({
          kind: 'palette',
          beginChannel,
          channelCount: paletteChannelCount,
          colorCount,
          deltaCount,
          predictor,
        }),
      )
    } else if (transform === 2) {
      const squeezeCount = readU32(reader, [value(0), bits(4, 1), bits(6, 9), bits(8, 41)])
      if (squeezeCount > 256) {
        throw limitExceeded('JPEG XL Squeeze parameter count exceeds 256')
      }
      const explicitParameters: ModularSqueezeParameters[] = []
      for (let index = 0; index < squeezeCount; index += 1) {
        explicitParameters.push(
          Object.freeze({
            horizontal: reader.readBits(1) !== 0,
            inPlace: reader.readBits(1) !== 0,
            beginChannel: readU32(reader, [bits(3), bits(6, 8), bits(10, 72), bits(13, 1_096)]),
            channelCount: readU32(reader, [value(1), value(2), value(3), bits(4, 4)]),
          }),
        )
      }
      const parameters =
        explicitParameters.length === 0
          ? defaultSqueezeParameters(channelLayouts, metaChannelCount)
          : Object.freeze(explicitParameters)
      metaChannelCount = applySqueezeLayouts(channelLayouts, metaChannelCount, parameters)
      transforms.push(Object.freeze({ kind: 'squeeze', parameters }))
    } else {
      throw invalidInput('JPEG XL Modular transform is invalid')
    }
  }
  return Object.freeze({ transforms: Object.freeze(transforms), metaChannelCount })
}

const readJpegXlModularProgram = (
  section: Uint8Array,
  channelCount: number,
  width: number,
  height: number,
  frameFlags = 0,
  extraChannelCount = 0,
): ModularProgram => {
  const frameFeatures = readJpegXlFrameFeatures(
    section,
    0,
    frameFlags,
    width,
    height,
    extraChannelCount,
  )
  const reader = new JpegXlBitReader(section, frameFeatures.endingBitPosition)
  const defaultDcQuantization = reader.readBits(1) !== 0
  const dcQuantization: [number, number, number] = [1 / 4_096, 1 / 512, 1 / 256]
  if (!defaultDcQuantization) {
    for (let channel = 0; channel < 3; channel += 1) {
      const quantization = readF16(reader) / 128
      if (quantization < 1e-8) throw invalidInput('JPEG XL DC quantization is too small')
      dcQuantization[channel] = quantization
    }
  }
  const hasGlobalTree = reader.readBits(1) !== 0
  const globalTree = hasGlobalTree ? readTree(reader) : undefined
  const globalPixelCode = globalTree ? readJpegXlEntropyCode(reader, globalTree.leaves) : undefined
  const useGlobalTree = reader.readBits(1) !== 0
  if (useGlobalTree && (!globalTree || !globalPixelCode)) {
    throw invalidInput('JPEG XL Modular group references a missing global tree')
  }
  const weightedPredictor = readWeightedPredictor(reader)
  const channelLayouts: ModularChannelLayout[] = Array.from({ length: channelCount }, () => ({
    width,
    height,
  }))
  const { transforms, metaChannelCount } = readModularTransforms(reader, channelLayouts, 0)
  const tree = useGlobalTree ? globalTree : readTree(reader)
  if (!tree) throw invalidInput('JPEG XL Modular tree is missing')
  const pixelCode = useGlobalTree ? globalPixelCode : readJpegXlEntropyCode(reader, tree.leaves)
  if (!pixelCode) throw invalidInput('JPEG XL Modular entropy code is missing')
  for (const node of tree.nodes) {
    if (node.kind === 'leaf' && node.predictor > 13) {
      throw unsupportedOperation(`JPEG XL Modular predictor ${node.predictor} is not supported`)
    }
  }
  const usesWeightedPrediction = tree.nodes.some(
    (node) =>
      (node.kind === 'leaf' && node.predictor === 6) ||
      (node.kind === 'branch' && node.property === 15),
  )
  return Object.freeze({
    frameFeatures,
    dcQuantization: Object.freeze(dcQuantization),
    nodes: tree.nodes,
    section,
    residualBitPosition: reader.bitPosition,
    pixelCode,
    weightedPredictor,
    usesWeightedPrediction,
    channelLayouts: Object.freeze(channelLayouts.map((layout) => Object.freeze(layout))),
    transforms: Object.freeze(transforms),
    metaChannelCount,
    prefixPlanes: Object.freeze([]),
    groupId: 0,
  })
}

export interface JpegXlStandaloneModularResult {
  readonly planes: readonly Int32Array<ArrayBufferLike>[]
  readonly endingBitPosition: number
}

export const readJpegXlStandaloneModularHeader = (
  section: Uint8Array,
  startingBitPosition: number,
  channelLayoutsInput: readonly Readonly<JpegXlModularChannelLayout>[],
): number => {
  const reader = new JpegXlBitReader(section, startingBitPosition)
  reader.readBits(1)
  readWeightedPredictor(reader)
  const channelLayouts = channelLayoutsInput.map(({ width, height }) => ({ width, height }))
  const { transforms, metaChannelCount } = readModularTransforms(reader, channelLayouts, 0)
  if (transforms.length !== 0 || metaChannelCount !== 0) {
    throw unsupportedOperation('Common VarDCT alpha Modular transforms are not supported yet')
  }
  return reader.bitPosition
}

export interface JpegXlModularGlobalCode {
  readonly nodes: readonly JpegXlModularNode[]
  readonly leaves: number
  readonly pixelCode: JpegXlEntropyCode
}

export const decodeJpegXlStandaloneModular = (
  section: Uint8Array,
  startingBitPosition: number,
  channelLayoutsInput: readonly Readonly<ModularChannelLayout>[],
  groupId: number,
  globalCode?: Readonly<JpegXlModularGlobalCode>,
): JpegXlStandaloneModularResult => {
  if (
    !Number.isSafeInteger(startingBitPosition) ||
    startingBitPosition < 0 ||
    startingBitPosition > section.byteLength * 8
  ) {
    throw invalidInput('JPEG XL Modular starting bit position is invalid')
  }
  if (!Number.isSafeInteger(groupId) || groupId < 0) {
    throw invalidInput('JPEG XL Modular group identifier is invalid')
  }
  if (
    channelLayoutsInput.length > 1_024 ||
    channelLayoutsInput.some(
      ({ width, height }) =>
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 0 ||
        height < 0 ||
        width * height > 67_108_864,
    )
  ) {
    throw limitExceeded('JPEG XL standalone Modular channel geometry is too large')
  }
  const reader = new JpegXlBitReader(section, startingBitPosition)
  const useGlobalTree = reader.readBits(1) !== 0
  if (useGlobalTree && !globalCode) {
    throw invalidInput('JPEG XL standalone Modular stream references a missing global tree')
  }
  const weightedPredictor = readWeightedPredictor(reader)
  const channelLayouts = channelLayoutsInput.map(({ width, height }) => ({ width, height }))
  const { transforms, metaChannelCount } = readModularTransforms(reader, channelLayouts, 0)
  const tree = useGlobalTree ? globalCode : readTree(reader)
  if (!tree) throw invalidInput('JPEG XL standalone Modular tree is missing')
  const pixelCode =
    useGlobalTree && globalCode ? globalCode.pixelCode : readJpegXlEntropyCode(reader, tree.leaves)
  const usesWeightedPrediction = tree.nodes.some(
    (node) =>
      (node.kind === 'leaf' && node.predictor === 6) ||
      (node.kind === 'branch' && node.property === 15),
  )
  const program = Object.freeze({
    nodes: tree.nodes,
    section,
    residualBitPosition: reader.bitPosition,
    pixelCode,
    weightedPredictor,
    usesWeightedPrediction,
    channelLayouts: Object.freeze(channelLayouts.map((layout) => Object.freeze(layout))),
    transforms,
    metaChannelCount,
    groupId,
    prefixPlanes: Object.freeze([]),
  })
  const decoded = decodeModularPlanesWithPosition(program, 0, undefined, false)
  return Object.freeze({
    planes: Object.freeze(inverseModularTransforms(decoded.planes, program, 8)),
    endingBitPosition: decoded.endingBitPosition,
  })
}

interface ModularGroup {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly program: ModularProgram
}

interface ModularGroupFoundation {
  readonly globalProgram: ModularProgram
  readonly firstGroupedChannel: number
  readonly groupedLayouts: readonly ModularChannelLayout[]
  readonly firstGroupSection: number
  readonly prefixPlanes: readonly Int32Array<ArrayBufferLike>[]
}

const readMultiGroupFoundation = (
  globalData: Uint8Array,
  header: JpegXlHeader,
): ModularGroupFoundation => {
  const expectedSections = 2 + header.dcGroupCount + header.groupsAcross * header.groupsDown
  if (header.sections.length !== expectedSections) {
    throw invalidInput('JPEG XL multi-group section count is inconsistent')
  }
  const globalSection = header.sections[0]
  if (!globalSection || globalData.byteLength !== globalSection.length) {
    throw invalidInput('JPEG XL global section data is missing')
  }
  const globalProgram = readJpegXlModularProgram(
    globalData,
    header.channelCount,
    header.width,
    header.height,
    header.frameFlags,
    header.extraChannels.length,
  )
  if (globalProgram.transforms.some((transform) => transform.kind !== 'rct')) {
    throw unsupportedOperation(
      'JPEG XL multi-group global Palette and Squeeze transforms are not supported',
    )
  }
  const firstGroupedChannel = globalProgram.channelLayouts.findIndex(
    (layout) => layout.width > header.groupDimension || layout.height > header.groupDimension,
  )
  if (firstGroupedChannel < 0) {
    throw unsupportedOperation('JPEG XL multi-group image has no group-sized Modular channels')
  }
  const groupedLayouts = globalProgram.channelLayouts.slice(firstGroupedChannel)
  if (
    groupedLayouts.some(
      (layout) => layout.width !== header.width || layout.height !== header.height,
    )
  ) {
    throw unsupportedOperation('JPEG XL shifted multi-group Modular channels are not supported')
  }
  const prefixProgram = Object.freeze({
    ...globalProgram,
    channelLayouts: Object.freeze(globalProgram.channelLayouts.slice(0, firstGroupedChannel)),
  })
  const prefixPlanes =
    firstGroupedChannel === 0
      ? Object.freeze([])
      : Object.freeze(decodeModularPlanes(prefixProgram, 0))
  const acGlobal = header.sections[1]
  if (acGlobal?.length !== 0) {
    throw unsupportedOperation('JPEG XL Modular AC global data is not supported')
  }
  for (let index = 0; index < header.dcGroupCount; index += 1) {
    if ((header.sections[2 + index]?.length ?? -1) !== 0) {
      throw unsupportedOperation('JPEG XL shifted Modular DC group channels are not supported')
    }
  }
  return Object.freeze({
    globalProgram,
    firstGroupedChannel,
    groupedLayouts: Object.freeze(groupedLayouts),
    firstGroupSection: 2 + header.dcGroupCount,
    prefixPlanes,
  })
}

const readModularGroup = (
  groupData: Uint8Array,
  header: JpegXlHeader,
  foundation: ModularGroupFoundation,
  groupId: number,
): ModularGroup => {
  const section = header.sections[foundation.firstGroupSection + groupId]
  if (!section || section.length < 1) {
    throw invalidInput(`JPEG XL Modular group ${groupId} section is empty`)
  }
  if (groupData.byteLength !== section.length) {
    throw invalidInput(`JPEG XL Modular group ${groupId} section data is missing`)
  }
  const reader = new JpegXlBitReader(groupData)
  const useGlobalTree = reader.readBits(1) !== 0
  const weightedPredictor = readWeightedPredictor(reader)
  const transformCount = readU32(reader, [value(0), value(1), bits(4, 2), bits(8, 18)])
  if (transformCount !== 0) {
    throw unsupportedOperation('JPEG XL group-local Modular transforms are not supported')
  }
  const tree = useGlobalTree ? foundation.globalProgram.nodes : readTree(reader).nodes
  const pixelCode = useGlobalTree
    ? foundation.globalProgram.pixelCode
    : readJpegXlEntropyCode(reader, (tree.length + 1) >> 1)
  for (const node of tree) {
    if (node.kind === 'leaf' && node.predictor > 13) {
      throw unsupportedOperation(`JPEG XL Modular predictor ${node.predictor} is not supported`)
    }
  }
  const usesWeightedPrediction = tree.some(
    (node) =>
      (node.kind === 'leaf' && node.predictor === 6) ||
      (node.kind === 'branch' && node.property === 15),
  )
  const groupX = groupId % header.groupsAcross
  const groupY = Math.floor(groupId / header.groupsAcross)
  const x = groupX * header.groupDimension
  const y = groupY * header.groupDimension
  const width = Math.min(header.groupDimension, header.width - x)
  const height = Math.min(header.groupDimension, header.height - y)
  const channelLayouts = Object.freeze([
    ...foundation.globalProgram.channelLayouts.slice(0, foundation.firstGroupedChannel),
    ...foundation.groupedLayouts.map(() => Object.freeze({ width, height })),
  ])
  return Object.freeze({
    x,
    y,
    width,
    height,
    program: Object.freeze({
      nodes: tree,
      section: groupData,
      residualBitPosition: reader.bitPosition,
      pixelCode,
      weightedPredictor,
      usesWeightedPrediction,
      channelLayouts,
      transforms: foundation.globalProgram.transforms,
      metaChannelCount: foundation.globalProgram.metaChannelCount,
      groupId: 1 + 3 * header.dcGroupCount + JPEG_XL_QUANT_TABLES + groupId,
      prefixPlanes: foundation.prefixPlanes,
    }),
  })
}

const readMultiGroupPrograms = (
  sectionData: readonly Uint8Array[],
  header: JpegXlHeader,
): readonly ModularGroup[] => {
  const globalSection = header.sections[0]
  if (!globalSection) throw invalidInput('JPEG XL global section is missing')
  const globalData = sectionData[0]
  if (!globalData || globalData.byteLength !== globalSection.length) {
    throw invalidInput('JPEG XL global section data is missing')
  }
  const foundation = readMultiGroupFoundation(globalData, header)
  return Object.freeze(
    Array.from({ length: header.groupsAcross * header.groupsDown }, (_, groupId) => {
      const groupData = sectionData[foundation.firstGroupSection + groupId]
      if (!groupData) throw invalidInput(`JPEG XL Modular group ${groupId} section data is missing`)
      return readModularGroup(groupData, header, foundation, groupId)
    }),
  )
}

const treeLeaf = (nodes: readonly ModularNode[], properties: Int32Array): ModularLeaf => {
  let index = 0
  for (let depth = 0; depth < 4_096; depth += 1) {
    const node = nodes[index]
    if (!node) throw invalidInput('JPEG XL Modular tree points outside its node table')
    if (node.kind === 'leaf') return node
    const property = properties[node.property]
    if (property === undefined) throw invalidInput('JPEG XL Modular property is invalid')
    index = property > node.split ? node.greater : node.lessOrEqual
  }
  throw invalidInput('JPEG XL Modular tree is too deep')
}

const clampedGradient = (left: number, top: number, topLeft: number): number => {
  const minimum = Math.min(left, top)
  const maximum = Math.max(left, top)
  if (topLeft < minimum) return maximum
  if (topLeft > maximum) return minimum
  return (left + top - topLeft) | 0
}

const weightedDivision = Uint32Array.from({ length: 64 }, (_, index) =>
  Math.floor(16_777_216 / (index + 1)),
)

export class JpegXlWeightedPredictor {
  readonly #predictions = new Int32Array(4)
  readonly #predictionErrors: readonly Uint32Array[]
  readonly #errors: Int32Array
  readonly #parameters: WeightedPredictorParameters
  readonly #rowLength: number
  #prediction = 0

  constructor(width: number, parameters: WeightedPredictorParameters) {
    this.#rowLength = width + 2
    this.#predictionErrors = Array.from({ length: 4 }, () => new Uint32Array(this.#rowLength * 2))
    this.#errors = new Int32Array(this.#rowLength * 2)
    this.#parameters = parameters
  }

  #errorWeight(error: number, maximumWeight: number): number {
    const shift = Math.max(0, Math.floor(Math.log2(error + 1)) - 5)
    const divisor = weightedDivision[Math.floor(error / 2 ** shift)]
    if (divisor === undefined) throw invalidInput('JPEG XL weighted predictor state is invalid')
    return 4 + Math.floor((maximumWeight * divisor) / 2 ** shift)
  }

  predict(
    x: number,
    y: number,
    width: number,
    top: number,
    left: number,
    topRight: number,
    topLeft: number,
    topTop: number,
    properties: Int32Array,
  ): number {
    const currentRow = (y & 1) !== 0 ? 0 : this.#rowLength
    const previousRow = (y & 1) !== 0 ? this.#rowLength : 0
    const topPosition = previousRow + x
    const topRightPosition = x < width - 1 ? topPosition + 1 : topPosition
    const topLeftPosition = x > 0 ? topPosition - 1 : topPosition
    const firstErrors = this.#predictionErrors[0]
    const secondErrors = this.#predictionErrors[1]
    const thirdErrors = this.#predictionErrors[2]
    const fourthErrors = this.#predictionErrors[3]
    if (!firstErrors || !secondErrors || !thirdErrors || !fourthErrors) {
      throw invalidInput('JPEG XL weighted predictor state is missing')
    }
    const firstWeight = this.#errorWeight(
      ((firstErrors[topPosition] ?? 0) +
        (firstErrors[topRightPosition] ?? 0) +
        (firstErrors[topLeftPosition] ?? 0)) >>>
        0,
      this.#parameters.weights[0],
    )
    const secondWeight = this.#errorWeight(
      ((secondErrors[topPosition] ?? 0) +
        (secondErrors[topRightPosition] ?? 0) +
        (secondErrors[topLeftPosition] ?? 0)) >>>
        0,
      this.#parameters.weights[1],
    )
    const thirdWeight = this.#errorWeight(
      ((thirdErrors[topPosition] ?? 0) +
        (thirdErrors[topRightPosition] ?? 0) +
        (thirdErrors[topLeftPosition] ?? 0)) >>>
        0,
      this.#parameters.weights[2],
    )
    const fourthWeight = this.#errorWeight(
      ((fourthErrors[topPosition] ?? 0) +
        (fourthErrors[topRightPosition] ?? 0) +
        (fourthErrors[topLeftPosition] ?? 0)) >>>
        0,
      this.#parameters.weights[3],
    )

    const scaledTop = top * 8
    const scaledLeft = left * 8
    const scaledTopRight = topRight * 8
    const scaledTopLeft = topLeft * 8
    const scaledTopTop = topTop * 8
    const leftError = x === 0 ? 0 : (this.#errors[currentRow + x - 1] ?? 0)
    const topError = this.#errors[topPosition] ?? 0
    const topLeftError = this.#errors[topLeftPosition] ?? 0
    const topRightError = this.#errors[topRightPosition] ?? 0
    const topAndLeftError = topError + leftError
    let errorProperty = leftError
    if (Math.abs(topError) > Math.abs(errorProperty)) errorProperty = topError
    if (Math.abs(topLeftError) > Math.abs(errorProperty)) errorProperty = topLeftError
    if (Math.abs(topRightError) > Math.abs(errorProperty)) errorProperty = topRightError
    properties[15] = errorProperty

    this.#predictions[0] = scaledLeft + scaledTopRight - scaledTop
    this.#predictions[1] =
      scaledTop - Math.floor(((topAndLeftError + topRightError) * this.#parameters.p1) / 32)
    this.#predictions[2] =
      scaledLeft - Math.floor(((topAndLeftError + topLeftError) * this.#parameters.p2) / 32)
    this.#predictions[3] =
      scaledTop -
      Math.floor(
        (topLeftError * this.#parameters.p3a +
          topError * this.#parameters.p3b +
          topRightError * this.#parameters.p3c +
          (scaledTopTop - scaledTop) * this.#parameters.p3d +
          (scaledTopLeft - scaledLeft) * this.#parameters.p3e) /
          32,
      )

    let weightSum = firstWeight + secondWeight + thirdWeight + fourthWeight
    const weightShift = Math.floor(Math.log2(weightSum)) - 4
    const firstScaledWeight = firstWeight >>> weightShift
    const secondScaledWeight = secondWeight >>> weightShift
    const thirdScaledWeight = thirdWeight >>> weightShift
    const fourthScaledWeight = fourthWeight >>> weightShift
    weightSum = firstScaledWeight + secondScaledWeight + thirdScaledWeight + fourthScaledWeight
    const weightedSum =
      (weightSum >>> 1) -
      1 +
      (this.#predictions[0] ?? 0) * firstScaledWeight +
      (this.#predictions[1] ?? 0) * secondScaledWeight +
      (this.#predictions[2] ?? 0) * thirdScaledWeight +
      (this.#predictions[3] ?? 0) * fourthScaledWeight
    const divisor = weightedDivision[weightSum - 1]
    if (divisor === undefined) throw invalidInput('JPEG XL weighted predictor sum is invalid')
    this.#prediction = Math.floor((weightedSum * divisor) / 16_777_216)

    if (((topError ^ leftError) | (topError ^ topLeftError)) <= 0) {
      const maximum = Math.max(scaledLeft, scaledTopRight, scaledTop)
      const minimum = Math.min(scaledLeft, scaledTopRight, scaledTop)
      this.#prediction = Math.max(minimum, Math.min(maximum, this.#prediction))
    }
    return (this.#prediction + 3) >> 3
  }

  update(sample: number, x: number, y: number): void {
    const currentRow = (y & 1) !== 0 ? 0 : this.#rowLength
    const previousRow = (y & 1) !== 0 ? this.#rowLength : 0
    const scaledSample = sample * 8
    const position = currentRow + x
    this.#errors[position] = this.#prediction - scaledSample
    for (let index = 0; index < 4; index += 1) {
      const errors = this.#predictionErrors[index]
      if (!errors) throw invalidInput('JPEG XL weighted predictor state is missing')
      const error = (Math.abs((this.#predictions[index] ?? 0) - scaledSample) + 3) >> 3
      errors[position] = error
      errors[previousRow + x + 1] = ((errors[previousRow + x + 1] ?? 0) + error) >>> 0
    }
  }
}

const modularPrediction = (
  predictor: number,
  left: number,
  top: number,
  topTop: number,
  topLeft: number,
  topRight: number,
  topRightRight: number,
  leftLeft: number,
  weightedPrediction: number,
): number => {
  switch (predictor) {
    case 0:
      return 0
    case 1:
      return left
    case 2:
      return top
    case 3:
      return Math.trunc((left + top) / 2)
    case 4: {
      const candidate = left + top - topLeft
      return Math.abs(candidate - left) < Math.abs(candidate - top) ? left : top
    }
    case 5:
      return clampedGradient(left, top, topLeft)
    case 6:
      return weightedPrediction
    case 7:
      return topRight
    case 8:
      return topLeft
    case 9:
      return leftLeft
    case 10:
      return Math.trunc((left + topLeft) / 2)
    case 11:
      return Math.trunc((topLeft + top) / 2)
    case 12:
      return Math.trunc((top + topRight) / 2)
    case 13:
      return Math.trunc(
        (6 * top - 2 * topTop + 7 * left + leftLeft + topRightRight + 3 * topRight + 8) / 16,
      )
    default:
      throw invalidInput(`JPEG XL Modular predictor ${predictor} is invalid`)
  }
}

const setModularProperties = (
  properties: Int32Array,
  channel: number,
  group: number,
  x: number,
  y: number,
  previousGradient: number,
  left: number,
  top: number,
  topTop: number,
  topLeft: number,
  topRight: number,
  leftLeft: number,
): number => {
  const gradient = left + top - topLeft
  properties[0] = channel
  properties[1] = group
  properties[2] = y
  properties[3] = x
  properties[4] = Math.abs(top)
  properties[5] = Math.abs(left)
  properties[6] = top
  properties[7] = left
  properties[8] = left - previousGradient
  properties[9] = gradient
  properties[10] = left - topLeft
  properties[11] = topLeft - top
  properties[12] = top - topRight
  properties[13] = top - topTop
  properties[14] = left - leftLeft
  return gradient
}

const requireZeroSectionPadding = (reader: JpegXlBitReader): void => {
  while (reader.remainingBits > 0) {
    const count = Math.min(32, reader.remainingBits)
    if (reader.readBits(count) !== 0) {
      throw invalidInput(
        `JPEG XL Modular section has nonzero trailing data with ${reader.remainingBits} bits unread`,
      )
    }
  }
}

interface DecodedModularPlanes {
  readonly planes: Int32Array<ArrayBufferLike>[]
  readonly endingBitPosition: number
}

const decodeModularPlanesWithPosition = (
  program: ModularProgram,
  firstChannel: number,
  signal?: AbortSignal,
  requirePadding = true,
): DecodedModularPlanes => {
  const decodedLayouts = program.channelLayouts.slice(firstChannel)
  const symbolCount = decodedLayouts.reduce((sum, layout) => sum + layout.width * layout.height, 0)
  const distanceMultiplier = decodedLayouts.reduce(
    (maximum, layout) => Math.max(maximum, layout.width),
    0,
  )
  const planes: Int32Array<ArrayBufferLike>[] = program.channelLayouts.map((layout, channel) => {
    const prefix = program.prefixPlanes[channel]
    return prefix ?? new Int32Array(layout.width * layout.height)
  })
  const reader = new JpegXlBitReader(program.section)
  reader.skipBits(program.residualBitPosition)
  const symbols = new JpegXlEntropySymbolReader(program.pixelCode, symbolCount, distanceMultiplier)
  const properties = new Int32Array(16)
  for (let channel = firstChannel; channel < program.channelLayouts.length; channel += 1) {
    const layout = program.channelLayouts[channel]
    if (!layout) throw invalidInput('JPEG XL channel layout is missing')
    const weightedPredictor = program.usesWeightedPrediction
      ? new JpegXlWeightedPredictor(layout.width, program.weightedPredictor)
      : undefined
    const plane = planes[channel]
    if (!plane) throw invalidInput('JPEG XL channel buffer is missing')
    for (let y = 0; y < layout.height; y += 1) {
      throwIfAborted(signal)
      let previousGradient = 0
      const row = y * layout.width
      const previous = row - layout.width
      const beforePrevious = previous - layout.width
      for (let x = 0; x < layout.width; x += 1) {
        const left = x > 0 ? (plane[row + x - 1] ?? 0) : y > 0 ? (plane[previous + x] ?? 0) : 0
        const top = y > 0 ? (plane[previous + x] ?? 0) : left
        const topLeft = x > 0 && y > 0 ? (plane[previous + x - 1] ?? 0) : left
        const topRight = x + 1 < layout.width && y > 0 ? (plane[previous + x + 1] ?? 0) : top
        const topRightRight =
          x + 2 < layout.width && y > 0 ? (plane[previous + x + 2] ?? 0) : topRight
        const topTop = y > 1 ? (plane[beforePrevious + x] ?? 0) : top
        const leftLeft = x > 1 ? (plane[row + x - 2] ?? 0) : left
        previousGradient = setModularProperties(
          properties,
          channel - firstChannel,
          program.groupId,
          x,
          y,
          previousGradient,
          left,
          top,
          topTop,
          topLeft,
          topRight,
          leftLeft,
        )
        const weightedPrediction =
          weightedPredictor?.predict(
            x,
            y,
            layout.width,
            top,
            left,
            topRight,
            topLeft,
            topTop,
            properties,
          ) ?? 0
        const leaf = treeLeaf(program.nodes, properties)
        const residual = unpackSigned(symbols.readHybridUint(leaf.context, reader))
        const reconstructed =
          modularPrediction(
            leaf.predictor,
            left,
            top,
            topTop,
            topLeft,
            topRight,
            topRightRight,
            leftLeft,
            weightedPrediction,
          ) +
          leaf.offset +
          residual * leaf.multiplier
        if (
          !Number.isSafeInteger(reconstructed) ||
          reconstructed < -2_147_483_648 ||
          reconstructed > 2_147_483_647
        ) {
          throw invalidInput('JPEG XL Modular sample is outside the signed 32-bit range')
        }
        plane[row + x] = reconstructed
        weightedPredictor?.update(reconstructed, x, y)
      }
    }
  }
  if (!symbols.hasValidFinalState()) {
    throw invalidInput('JPEG XL Modular residual ANS state is invalid')
  }
  if (requirePadding) requireZeroSectionPadding(reader)
  return Object.freeze({ planes, endingBitPosition: reader.bitPosition })
}

const decodeModularPlanes = (
  program: ModularProgram,
  firstChannel: number,
  signal?: AbortSignal,
): Int32Array<ArrayBufferLike>[] =>
  decodeModularPlanesWithPosition(program, firstChannel, signal).planes
const inverseRct = (
  firstInput: number,
  secondInput: number,
  thirdInput: number,
  type: number,
  output: Int32Array,
): void => {
  if (type === 0) {
    output[0] = firstInput
    output[1] = secondInput
    output[2] = thirdInput
    return
  }
  const permutation = Math.floor(type / 7)
  const transform = type % 7
  let first = firstInput
  let second = secondInput
  let third = thirdInput
  if (transform === 6) {
    const base = first - (third >> 1)
    const green = third + base
    const blue = base - (second >> 1)
    first = blue + second
    second = green
    third = blue
  } else {
    if ((transform & 1) !== 0) third += first
    const secondMode = transform >> 1
    if (secondMode === 1) second += first
    else if (secondMode === 2) second += (first + third) >> 1
  }
  output[permutation % 3] = first
  output[(permutation + 1 + Math.floor(permutation / 3)) % 3] = second
  output[(permutation + 2 - Math.floor(permutation / 3)) % 3] = third
}

const toByte = (sample: number, bitDepth: number): number => {
  const maximum = 2 ** bitDepth - 1
  return Math.round((Math.max(0, Math.min(maximum, sample)) * 255) / maximum)
}

const clampSample = (sample: number, maximum: number): number =>
  Math.max(0, Math.min(maximum, sample))

const writeUint16BigEndian = (output: Uint8Array, offset: number, sample: number): void => {
  output[offset] = sample >>> 8
  output[offset + 1] = sample
}

const implicitPaletteDeltas = new Int16Array([
  0, 0, 0, 4, 4, 4, 11, 0, 0, 0, 0, -13, 0, -12, 0, -10, -10, -10, -18, -18, -18, -27, -27, -27,
  -18, -18, 0, 0, 0, -32, -32, 0, 0, -37, -37, -37, 0, -32, -32, 24, 24, 45, 50, 50, 50, -45, -24,
  -24, -24, -45, -45, 0, -24, -24, -34, -34, 0, -24, 0, -24, -45, -45, -24, 64, 64, 64, -32, 0, -32,
  0, -32, 0, -32, 0, 32, -24, -45, -24, 45, 24, 45, 24, -24, -45, -45, -24, 24, 80, 80, 80, 64, 0,
  0, 0, 0, -64, 0, -64, -64, -24, -24, 45, 96, 96, 96, 64, 64, 0, 45, -24, -24, 34, -34, 0, 112,
  112, 112, 24, -45, -45, 45, 45, -24, 0, -32, 32, 24, -24, 45, 0, 96, 96, 45, -24, 24, 24, -45,
  -24, -24, -45, 24, 0, -64, 0, 96, 0, 0, 128, 128, 128, 64, 0, 64, 144, 144, 144, 96, 96, 0, -36,
  -36, 36, 45, -24, -45, 45, -45, -24, 0, 0, -96, 0, 128, 128, 0, 96, 0, 45, 24, -45, -128, 0, 0,
  24, -45, 24, -45, 24, -45, 64, 0, -64, 64, -64, -64, 96, 0, 96, 45, -45, 24, 24, 45, -45, 64, 64,
  -64, 128, 128, 0, 0, 0, -128, -24, 45, -45,
])

const paletteValue = (
  palette: Int32Array<ArrayBufferLike>,
  indexValue: number,
  channel: number,
  paletteWidth: number,
  bitDepth: number,
): number => {
  let index = indexValue
  if (index < 0) {
    if (channel >= 3) return 0
    index = -(index + 1)
    index %= 143
    const multiplier = (index & 1) === 0 ? -1 : 1
    const delta = implicitPaletteDeltas[((index + 1) >> 1) * 3 + channel] ?? 0
    return delta * multiplier * (bitDepth > 8 ? 2 ** (bitDepth - 8) : 1)
  }
  const maximum = 2 ** bitDepth - 1
  if (index >= paletteWidth && index < paletteWidth + 64) {
    if (channel >= 3) return 0
    index -= paletteWidth
    index >>>= channel * 2
    return (((index & 3) * maximum) >> 2) + 2 ** Math.max(0, bitDepth - 3)
  }
  if (index >= paletteWidth + 64) {
    if (channel >= 3) return 0
    index -= paletteWidth + 64
    if (channel === 1) index = Math.floor(index / 5)
    else if (channel === 2) index = Math.floor(index / 25)
    return ((index % 5) * maximum) >> 2
  }
  return palette[channel * paletteWidth + index] ?? 0
}

const inversePalette = (
  encodedPlanes: readonly Int32Array[],
  transform: ModularPaletteTransform,
  bitDepth: number,
  weightedPredictorParameters: WeightedPredictorParameters,
  width: number,
): Int32Array[] => {
  const palette = encodedPlanes[0]
  const indexPosition = transform.beginChannel + 1
  const indices = encodedPlanes[indexPosition]
  if (!palette || !indices) throw invalidInput('JPEG XL Palette channels are missing')
  const paletteWidth = transform.colorCount + transform.deltaCount
  const restored = encodedPlanes.slice(1)
  const channels: Int32Array[] = []
  for (let channel = 0; channel < transform.channelCount; channel += 1) {
    const output = new Int32Array(indices.length)
    const weightedPredictor =
      transform.predictor === 6
        ? new JpegXlWeightedPredictor(width, weightedPredictorParameters)
        : undefined
    const properties = new Int32Array(16)
    for (let position = 0; position < indices.length; position += 1) {
      const index = indices[position] ?? 0
      let sample = paletteValue(palette, index, channel, paletteWidth, bitDepth)
      if (index < transform.deltaCount) {
        const x = position % width
        const y = Math.floor(position / width)
        const row = y * width
        const previous = row - width
        const beforePrevious = previous - width
        const left = x > 0 ? (output[position - 1] ?? 0) : y > 0 ? (output[previous + x] ?? 0) : 0
        const top = y > 0 ? (output[previous + x] ?? 0) : left
        const topLeft = x > 0 && y > 0 ? (output[previous + x - 1] ?? 0) : left
        const topRight = x + 1 < width && y > 0 ? (output[previous + x + 1] ?? 0) : top
        const topRightRight = x + 2 < width && y > 0 ? (output[previous + x + 2] ?? 0) : topRight
        const topTop = y > 1 ? (output[beforePrevious + x] ?? 0) : top
        const leftLeft = x > 1 ? (output[position - 2] ?? 0) : left
        const weightedPrediction =
          weightedPredictor?.predict(
            x,
            y,
            width,
            top,
            left,
            topRight,
            topLeft,
            topTop,
            properties,
          ) ?? 0
        sample += modularPrediction(
          transform.predictor,
          left,
          top,
          topTop,
          topLeft,
          topRight,
          topRightRight,
          leftLeft,
          weightedPrediction,
        )
      }
      output[position] = requireModularSample(sample)
      weightedPredictor?.update(sample, position % width, Math.floor(position / width))
    }
    channels.push(output)
  }
  restored.splice(transform.beginChannel, 1, ...channels)
  return restored
}

const smoothSqueezeTendency = (previous: number, average: number, next: number): number => {
  let difference = 0
  if (previous >= average && average >= next) {
    difference = Math.trunc((4 * previous - 3 * next - average + 6) / 12)
    if (difference - (difference & 1) > 2 * (previous - average)) {
      difference = 2 * (previous - average) + 1
    }
    if (difference + (difference & 1) > 2 * (average - next)) {
      difference = 2 * (average - next)
    }
  } else if (previous <= average && average <= next) {
    difference = Math.trunc((4 * previous - 3 * next - average - 6) / 12)
    if (difference + (difference & 1) < 2 * (previous - average)) {
      difference = 2 * (previous - average) - 1
    }
    if (difference - (difference & 1) < 2 * (average - next)) {
      difference = 2 * (average - next)
    }
  }
  return difference
}

const requireModularSample = (sample: number): number => {
  if (!Number.isSafeInteger(sample) || sample < -2_147_483_648 || sample > 2_147_483_647) {
    throw invalidInput('JPEG XL inverse Modular transform exceeds the signed 32-bit range')
  }
  return sample
}

const inverseHorizontalSqueeze = (
  average: Int32Array<ArrayBufferLike>,
  averageLayout: ModularChannelLayout,
  residual: Int32Array<ArrayBufferLike>,
  residualLayout: ModularChannelLayout,
): { readonly plane: Int32Array; readonly layout: ModularChannelLayout } => {
  if (
    averageLayout.height !== residualLayout.height ||
    averageLayout.width < residualLayout.width ||
    averageLayout.width - residualLayout.width > 1 ||
    average.length !== averageLayout.width * averageLayout.height ||
    residual.length !== residualLayout.width * residualLayout.height
  ) {
    throw invalidInput('JPEG XL horizontal Squeeze channel geometry is invalid')
  }
  const outputWidth = averageLayout.width + residualLayout.width
  const output = new Int32Array(outputWidth * averageLayout.height)
  for (let y = 0; y < averageLayout.height; y += 1) {
    const averageRow = y * averageLayout.width
    const residualRow = y * residualLayout.width
    const outputRow = y * outputWidth
    for (let x = 0; x < residualLayout.width; x += 1) {
      const currentAverage = average[averageRow + x] ?? 0
      const nextAverage = average[averageRow + Math.min(x + 1, averageLayout.width - 1)] ?? 0
      const previous = x === 0 ? currentAverage : (output[outputRow + 2 * x - 1] ?? 0)
      const difference =
        (residual[residualRow + x] ?? 0) +
        smoothSqueezeTendency(previous, currentAverage, nextAverage)
      const first = requireModularSample(currentAverage + Math.trunc(difference / 2))
      output[outputRow + 2 * x] = first
      output[outputRow + 2 * x + 1] = requireModularSample(first - difference)
    }
    if ((outputWidth & 1) !== 0) {
      output[outputRow + outputWidth - 1] = average[averageRow + averageLayout.width - 1] ?? 0
    }
  }
  return Object.freeze({
    plane: output,
    layout: Object.freeze({ width: outputWidth, height: averageLayout.height }),
  })
}

const inverseVerticalSqueeze = (
  average: Int32Array<ArrayBufferLike>,
  averageLayout: ModularChannelLayout,
  residual: Int32Array<ArrayBufferLike>,
  residualLayout: ModularChannelLayout,
): { readonly plane: Int32Array; readonly layout: ModularChannelLayout } => {
  if (
    averageLayout.width !== residualLayout.width ||
    averageLayout.height < residualLayout.height ||
    averageLayout.height - residualLayout.height > 1 ||
    average.length !== averageLayout.width * averageLayout.height ||
    residual.length !== residualLayout.width * residualLayout.height
  ) {
    throw invalidInput('JPEG XL vertical Squeeze channel geometry is invalid')
  }
  const outputHeight = averageLayout.height + residualLayout.height
  const output = new Int32Array(averageLayout.width * outputHeight)
  for (let y = 0; y < residualLayout.height; y += 1) {
    const averageRow = y * averageLayout.width
    const nextAverageRow = Math.min(y + 1, averageLayout.height - 1) * averageLayout.width
    const residualRow = y * residualLayout.width
    const outputRow = 2 * y * averageLayout.width
    const nextOutputRow = outputRow + averageLayout.width
    const previousOutputRow = y === 0 ? -1 : outputRow - averageLayout.width
    for (let x = 0; x < averageLayout.width; x += 1) {
      const currentAverage = average[averageRow + x] ?? 0
      const nextAverage = average[nextAverageRow + x] ?? 0
      const previous = previousOutputRow < 0 ? currentAverage : (output[previousOutputRow + x] ?? 0)
      const difference =
        (residual[residualRow + x] ?? 0) +
        smoothSqueezeTendency(previous, currentAverage, nextAverage)
      const first = requireModularSample(currentAverage + Math.trunc(difference / 2))
      output[outputRow + x] = first
      output[nextOutputRow + x] = requireModularSample(first - difference)
    }
  }
  if ((outputHeight & 1) !== 0) {
    output.set(
      average.subarray((averageLayout.height - 1) * averageLayout.width),
      (outputHeight - 1) * averageLayout.width,
    )
  }
  return Object.freeze({
    plane: output,
    layout: Object.freeze({ width: averageLayout.width, height: outputHeight }),
  })
}

const inverseSqueeze = (
  planes: Int32Array<ArrayBufferLike>[],
  layouts: ModularChannelLayout[],
  initialMetaChannelCount: number,
  transform: ModularSqueezeTransform,
): number => {
  let metaChannelCount = initialMetaChannelCount
  for (let index = transform.parameters.length - 1; index >= 0; index -= 1) {
    const parameter = transform.parameters[index]
    if (!parameter) throw invalidInput('JPEG XL Squeeze parameter is missing')
    validateTransformRange(
      layouts,
      metaChannelCount,
      parameter.beginChannel,
      parameter.channelCount,
      'inverse Squeeze',
    )
    const endChannel = parameter.beginChannel + parameter.channelCount - 1
    const residualOffset = parameter.inPlace
      ? endChannel + 1
      : planes.length + parameter.beginChannel - endChannel - 1
    if (parameter.beginChannel < metaChannelCount) {
      metaChannelCount -= parameter.channelCount
    }
    for (let channel = parameter.beginChannel; channel <= endChannel; channel += 1) {
      const residualChannel = residualOffset + channel - parameter.beginChannel
      const average = planes[channel]
      const averageLayout = layouts[channel]
      const residual = planes[residualChannel]
      const residualLayout = layouts[residualChannel]
      if (!average || !averageLayout || !residual || !residualLayout) {
        throw invalidInput('JPEG XL Squeeze channel is missing')
      }
      const restored = parameter.horizontal
        ? inverseHorizontalSqueeze(average, averageLayout, residual, residualLayout)
        : inverseVerticalSqueeze(average, averageLayout, residual, residualLayout)
      planes[channel] = restored.plane
      layouts[channel] = restored.layout
    }
    planes.splice(residualOffset, parameter.channelCount)
    layouts.splice(residualOffset, parameter.channelCount)
  }
  return metaChannelCount
}

const inverseRctPlanes = (
  planes: Int32Array<ArrayBufferLike>[],
  layouts: readonly ModularChannelLayout[],
  transform: ModularRctTransform,
): void => {
  const first = planes[transform.beginChannel]
  const second = planes[transform.beginChannel + 1]
  const third = planes[transform.beginChannel + 2]
  const firstLayout = layouts[transform.beginChannel]
  if (
    !first ||
    !second ||
    !third ||
    !firstLayout ||
    !sameLayout(firstLayout, layouts[transform.beginChannel + 1] ?? { width: -1, height: -1 }) ||
    !sameLayout(firstLayout, layouts[transform.beginChannel + 2] ?? { width: -1, height: -1 })
  ) {
    throw invalidInput('JPEG XL inverse RCT channels are invalid')
  }
  const restored = new Int32Array(3)
  for (let position = 0; position < first.length; position += 1) {
    inverseRct(
      first[position] ?? 0,
      second[position] ?? 0,
      third[position] ?? 0,
      transform.type,
      restored,
    )
    first[position] = restored[0] ?? 0
    second[position] = restored[1] ?? 0
    third[position] = restored[2] ?? 0
  }
}

const inverseModularTransforms = (
  encodedPlanes: Int32Array<ArrayBufferLike>[],
  program: ModularProgram,
  bitDepth: number,
): Int32Array<ArrayBufferLike>[] => {
  let planes = encodedPlanes
  const layouts = program.channelLayouts.map((layout) => ({ ...layout }))
  let metaChannelCount = program.metaChannelCount
  for (let index = program.transforms.length - 1; index >= 0; index -= 1) {
    const transform = program.transforms[index]
    if (!transform) throw invalidInput('JPEG XL Modular transform is missing')
    if (transform.kind === 'rct') {
      inverseRctPlanes(planes, layouts, transform)
      continue
    }
    if (transform.kind === 'squeeze') {
      metaChannelCount = inverseSqueeze(planes, layouts, metaChannelCount, transform)
      continue
    }
    const indexLayout = layouts[transform.beginChannel + 1]
    if (!indexLayout || metaChannelCount < 1) {
      throw invalidInput('JPEG XL inverse Palette layout is invalid')
    }
    planes = inversePalette(
      planes,
      transform,
      bitDepth,
      program.weightedPredictor,
      indexLayout.width,
    )
    const restoredLayouts = layouts.slice(1)
    restoredLayouts.splice(
      transform.beginChannel,
      1,
      ...Array.from({ length: transform.channelCount }, () => ({ ...indexLayout })),
    )
    layouts.splice(0, layouts.length, ...restoredLayouts)
    const indexChannel = transform.beginChannel + 1
    metaChannelCount =
      indexChannel >= metaChannelCount
        ? metaChannelCount - 1
        : metaChannelCount - (2 - transform.channelCount)
  }
  if (metaChannelCount !== 0) {
    throw invalidInput('JPEG XL Modular transforms leave unresolved meta channels')
  }
  return planes
}

export const decodeJpegXlModularFrameSection = (
  section: Uint8Array,
  width: number,
  height: number,
  channelCount: 1 | 2 | 3 | 4,
  bitDepth: number,
  signal?: AbortSignal,
): readonly Int32Array<ArrayBufferLike>[] => {
  const program = readJpegXlModularProgram(section, channelCount, width, height)
  return Object.freeze(
    inverseModularTransforms(
      decodeModularPlanes(program, program.prefixPlanes.length, signal),
      program,
      bitDepth,
    ),
  )
}

export const decodeJpegXlModularDcFrameSection = (
  section: Uint8Array,
  width: number,
  height: number,
  signal?: AbortSignal,
): readonly [Float64Array, Float64Array, Float64Array] => {
  const program = readJpegXlModularProgram(section, 3, width, height)
  const encoded = inverseModularTransforms(
    decodeModularPlanes(program, program.prefixPlanes.length, signal),
    program,
    8,
  )
  const encodedY = encoded[0]
  const encodedX = encoded[1]
  const encodedB = encoded[2]
  const quantization = program.dcQuantization
  if (!encodedX || !encodedY || !encodedB || !quantization) {
    throw invalidInput('JPEG XL Modular DC frame channel is missing')
  }
  const outputX = new Float64Array(encodedX.length)
  const outputY = new Float64Array(encodedY.length)
  const outputB = new Float64Array(encodedB.length)
  for (let index = 0; index < encodedY.length; index += 1) {
    const y = encodedY[index] ?? 0
    outputX[index] = (encodedX[index] ?? 0) * quantization[0]
    outputY[index] = y * quantization[1]
    outputB[index] = ((encodedB[index] ?? 0) + y) * quantization[2]
  }
  return Object.freeze([outputX, outputY, outputB])
}

export const decodeJpegXlMultiGroupModularDcFrameSections = (
  sections: readonly Uint8Array[],
  frame: Readonly<JpegXlFrameStructure>,
  signal?: AbortSignal,
): readonly [Float64Array, Float64Array, Float64Array] => {
  if (frame.passCount !== 1) {
    throw unsupportedOperation('JPEG XL grouped progressive Modular DC frames are not supported')
  }
  const groups = readMultiGroupPrograms(sections, frame)
  const first = groups[0]
  if (!first || first.program.prefixPlanes.length !== 0) {
    throw unsupportedOperation('JPEG XL grouped Modular DC prefix channels are not supported')
  }
  const quantization = first.program.dcQuantization
  if (!quantization) throw invalidInput('JPEG XL grouped Modular DC quantization is missing')
  const encoded = [
    new Int32Array(frame.width * frame.height),
    new Int32Array(frame.width * frame.height),
    new Int32Array(frame.width * frame.height),
  ] as const
  for (const group of groups) {
    throwIfAborted(signal)
    const decoded = inverseModularTransforms(
      decodeModularPlanes(group.program, 0, signal),
      group.program,
      8,
    )
    if (decoded.length !== 3) {
      throw unsupportedOperation('JPEG XL grouped Modular DC channel layout is not supported')
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const source = decoded[channel]
      const destination = encoded[channel]
      if (!source || !destination || source.length !== group.width * group.height) {
        throw invalidInput('JPEG XL grouped Modular DC channel data is inconsistent')
      }
      for (let row = 0; row < group.height; row += 1) {
        destination.set(
          source.subarray(row * group.width, (row + 1) * group.width),
          (group.y + row) * frame.width + group.x,
        )
      }
    }
  }
  const encodedY = encoded[0]
  const encodedX = encoded[1]
  const encodedB = encoded[2]
  const outputX = new Float64Array(encodedX.length)
  const outputY = new Float64Array(encodedY.length)
  const outputB = new Float64Array(encodedB.length)
  for (let index = 0; index < encodedY.length; index += 1) {
    const y = encodedY[index] ?? 0
    outputX[index] = (encodedX[index] ?? 0) * quantization[0]
    outputY[index] = y * quantization[1]
    outputB[index] = ((encodedB[index] ?? 0) + y) * quantization[2]
  }
  return Object.freeze([outputX, outputY, outputB])
}

class JpegXlModularDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16'
  readonly colorSemantics: PixelColorSemantics
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #signal: AbortSignal | undefined
  readonly #header: JpegXlHeader
  readonly #program: ModularProgram
  readonly #displayRanges: readonly PixelSampleDisplayRange[] | undefined

  constructor(header: JpegXlHeader, program: ModularProgram, signal?: AbortSignal) {
    this.#signal = signal
    this.width = header.width
    this.height = header.height
    const highDepth =
      header.bitDepth > 8 || (header.alphaBitDepth !== undefined && header.alphaBitDepth > 8)
    this.pixelFormat =
      header.colorChannels === 1 && header.alphaBitDepth === undefined
        ? highDepth
          ? 'gray16'
          : 'gray8'
        : header.alphaBitDepth === undefined
          ? highDepth
            ? 'rgb16'
            : 'rgb8'
          : highDepth
            ? 'rgba16'
            : 'rgba8'
    this.colorSemantics = jpegXlPixelColorSemantics(header)
    this.#header = header
    this.#program = program
    const colorMaximum = 2 ** header.bitDepth - 1
    if (this.pixelFormat === 'gray8' || this.pixelFormat === 'gray16') {
      this.#displayRanges = Object.freeze([Object.freeze({ black: 0, white: colorMaximum })])
    } else {
      const alphaMaximum =
        header.alphaBitDepth === undefined ? 65_535 : 2 ** header.alphaBitDepth - 1
      const colorRanges = [
        Object.freeze({ black: 0, white: colorMaximum }),
        Object.freeze({ black: 0, white: colorMaximum }),
        Object.freeze({ black: 0, white: colorMaximum }),
      ]
      this.#displayRanges = Object.freeze(
        header.alphaBitDepth === undefined
          ? colorRanges
          : [...colorRanges, Object.freeze({ black: 0, white: alphaMaximum })],
      )
    }
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const signal = combineAbortSignals(this.#signal, request.signal)
    if (signal) request = { ...request, signal }
    throwIfAborted(request.signal)
    if ((request.scaleDenominator ?? 1) !== 1) {
      throw unsupportedOperation('JPEG XL subset decoder does not support scaled decode')
    }
    const regionX = request.x ?? 0
    const regionY = request.y ?? 0
    const regionWidth = request.width ?? this.width - regionX
    const regionHeight = request.height ?? this.height - regionY
    if (
      !Number.isSafeInteger(regionX) ||
      !Number.isSafeInteger(regionY) ||
      !Number.isSafeInteger(regionWidth) ||
      !Number.isSafeInteger(regionHeight) ||
      regionX < 0 ||
      regionY < 0 ||
      regionWidth < 1 ||
      regionHeight < 1 ||
      regionX + regionWidth > this.width ||
      regionY + regionHeight > this.height
    ) {
      throw invalidInput('JPEG XL decode region is invalid')
    }
    const planes = inverseModularTransforms(
      decodeModularPlanes(this.#program, this.#program.prefixPlanes.length, request.signal),
      this.#program,
      this.#header.bitDepth,
    )

    const splines = this.#program.frameFeatures?.splines ?? []
    if (splines.length > 0) {
      if (this.#header.colorChannels !== 3 || this.#header.colorTransform !== 'none') {
        throw unsupportedOperation('JPEG XL Modular splines require direct three-channel color')
      }
      const maximum = 2 ** this.#header.bitDepth - 1
      const splinePlanes = planes
        .slice(0, 3)
        .map((plane) => Float32Array.from(plane, (sample) => sample / maximum))
      applyJpegXlSplines(
        splinePlanes,
        this.width,
        this.width,
        this.height,
        splines,
        this.#program.frameFeatures?.splineQuantizationAdjustment ?? 0,
        { colorFactor: 84, baseCorrelationX: 0, baseCorrelationB: 1 },
      )
      for (let channel = 0; channel < 3; channel += 1) {
        const source = splinePlanes[channel]
        const destination = planes[channel]
        if (!source || !destination) throw invalidInput('JPEG XL spline color plane is missing')
        for (let index = 0; index < source.length; index += 1) {
          destination[index] = Math.round((source[index] ?? 0) * maximum)
        }
      }
    }

    const firstPlane = planes[0]
    if (!firstPlane) throw invalidInput('JPEG XL color channel buffer is missing')
    const colorMaximum = 2 ** this.#header.bitDepth - 1
    if (this.#header.colorChannels === 1 && this.#header.alphaBitDepth === undefined) {
      const highDepth = this.pixelFormat === 'gray16'
      for (let y = regionY; y < regionY + regionHeight; y += 1) {
        throwIfAborted(request.signal)
        const output = new Uint8Array(regionWidth * (highDepth ? 2 : 1))
        for (let localX = 0; localX < regionWidth; localX += 1) {
          const sample = firstPlane[y * this.width + regionX + localX] ?? 0
          if (highDepth) {
            writeUint16BigEndian(output, localX * 2, clampSample(sample, colorMaximum))
          } else {
            output[localX] = toByte(sample, this.#header.bitDepth)
          }
        }
        yield {
          x: 0,
          y: y - regionY,
          width: regionWidth,
          height: 1,
          stride: output.byteLength,
          format: highDepth ? 'gray16' : 'gray8',
          data: output,
          ...(this.#displayRanges === undefined ? {} : { displayRanges: this.#displayRanges }),
        }
      }
      return
    }

    const secondPlane = planes[1]
    const thirdPlane = planes[2]
    const alphaPlane =
      this.#header.selectedAlphaChannel === undefined
        ? undefined
        : planes[this.#header.colorChannels + this.#header.selectedAlphaChannel]
    const grayscaleWithAlpha = this.#header.colorChannels === 1
    if (!grayscaleWithAlpha && (!secondPlane || !thirdPlane)) {
      throw invalidInput('JPEG XL color channel buffer is missing')
    }
    const alphaMaximum =
      this.#header.alphaBitDepth === undefined ? 65_535 : 2 ** this.#header.alphaBitDepth - 1
    for (let y = regionY; y < regionY + regionHeight; y += 1) {
      throwIfAborted(request.signal)
      if (this.pixelFormat === 'rgb16' || this.pixelFormat === 'rgba16') {
        const hasAlpha = this.pixelFormat === 'rgba16'
        const bytesPerPixel = hasAlpha ? 8 : 6
        const output = new Uint8Array(regionWidth * bytesPerPixel)
        for (let localX = 0; localX < regionWidth; localX += 1) {
          const x = regionX + localX
          const position = y * this.width + x
          const red = firstPlane[position] ?? 0
          const green = grayscaleWithAlpha ? red : (secondPlane?.[position] ?? 0)
          const blue = grayscaleWithAlpha ? red : (thirdPlane?.[position] ?? 0)
          const alpha = alphaPlane?.[position] ?? 0
          const target = localX * bytesPerPixel
          writeUint16BigEndian(output, target, clampSample(red, colorMaximum))
          writeUint16BigEndian(output, target + 2, clampSample(green, colorMaximum))
          writeUint16BigEndian(output, target + 4, clampSample(blue, colorMaximum))
          if (hasAlpha) {
            writeUint16BigEndian(output, target + 6, clampSample(alpha, alphaMaximum))
          }
        }
        yield {
          x: 0,
          y: y - regionY,
          width: regionWidth,
          height: 1,
          stride: output.byteLength,
          format: this.pixelFormat,
          data: output,
          ...(this.#displayRanges === undefined ? {} : { displayRanges: this.#displayRanges }),
        }
        continue
      }
      const hasAlpha = this.pixelFormat === 'rgba8'
      const bytesPerPixel = hasAlpha ? 4 : 3
      const output = new Uint8Array(regionWidth * bytesPerPixel)
      for (let localX = 0; localX < regionWidth; localX += 1) {
        const x = regionX + localX
        const position = y * this.width + x
        const red = firstPlane[position] ?? 0
        const green = grayscaleWithAlpha ? red : (secondPlane?.[position] ?? 0)
        const blue = grayscaleWithAlpha ? red : (thirdPlane?.[position] ?? 0)
        const alpha = alphaPlane?.[position] ?? 0
        const target = localX * bytesPerPixel
        output[target] = toByte(red, this.#header.bitDepth)
        output[target + 1] = toByte(green, this.#header.bitDepth)
        output[target + 2] = toByte(blue, this.#header.bitDepth)
        if (hasAlpha) output[target + 3] = toByte(alpha, this.#header.alphaBitDepth ?? 8)
      }
      yield {
        x: 0,
        y: y - regionY,
        width: regionWidth,
        height: 1,
        stride: output.byteLength,
        format: this.pixelFormat,
        data: output,
        ...(this.#displayRanges === undefined ? {} : { displayRanges: this.#displayRanges }),
      }
    }
  }
}

const groupHeader = (header: JpegXlHeader, group: ModularGroup): JpegXlHeader =>
  Object.freeze({
    ...header,
    width: group.width,
    height: group.height,
  })

type ModularGroupLoader = (
  groupId: number,
  options?: Readonly<{ readonly signal?: AbortSignal }>,
) => Promise<ModularGroup>

class JpegXlMultiGroupModularDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16'
  readonly colorSemantics: PixelColorSemantics
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #signal: AbortSignal | undefined
  readonly #header: JpegXlHeader
  readonly #loadGroup: ModularGroupLoader
  readonly #limits: ImageLimits

  constructor(
    header: JpegXlHeader,
    loadGroup: ModularGroupLoader,
    limits: ImageLimits,
    signal?: AbortSignal,
  ) {
    this.#signal = signal
    this.width = header.width
    this.height = header.height
    const highDepth =
      header.bitDepth > 8 || (header.alphaBitDepth !== undefined && header.alphaBitDepth > 8)
    this.pixelFormat =
      header.colorChannels === 1 && header.alphaBitDepth === undefined
        ? highDepth
          ? 'gray16'
          : 'gray8'
        : header.alphaBitDepth === undefined
          ? highDepth
            ? 'rgb16'
            : 'rgb8'
          : highDepth
            ? 'rgba16'
            : 'rgba8'
    this.colorSemantics = jpegXlPixelColorSemantics(header)
    this.#header = header
    this.#loadGroup = loadGroup
    this.#limits = limits
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const signal = combineAbortSignals(this.#signal, request.signal)
    if (signal) request = { ...request, signal }
    throwIfAborted(request.signal)
    if ((request.scaleDenominator ?? 1) !== 1) {
      throw unsupportedOperation('JPEG XL subset decoder does not support scaled decode')
    }
    const regionX = request.x ?? 0
    const regionY = request.y ?? 0
    const regionWidth = request.width ?? this.width - regionX
    const regionHeight = request.height ?? this.height - regionY
    if (
      !Number.isSafeInteger(regionX) ||
      !Number.isSafeInteger(regionY) ||
      !Number.isSafeInteger(regionWidth) ||
      !Number.isSafeInteger(regionHeight) ||
      regionX < 0 ||
      regionY < 0 ||
      regionWidth < 1 ||
      regionHeight < 1 ||
      regionX + regionWidth > this.width ||
      regionY + regionHeight > this.height
    ) {
      throw invalidInput('JPEG XL decode region is invalid')
    }
    const regionRight = regionX + regionWidth
    const regionBottom = regionY + regionHeight
    const bytesPerPixel =
      this.pixelFormat === 'gray8'
        ? 1
        : this.pixelFormat === 'gray16'
          ? 2
          : this.pixelFormat === 'rgb8'
            ? 3
            : this.pixelFormat === 'rgb16'
              ? 6
              : this.pixelFormat === 'rgba8'
                ? 4
                : 8

    for (let bandY = 0; bandY < this.height; bandY += this.#header.groupDimension) {
      const bandBottom = Math.min(this.height, bandY + this.#header.groupDimension)
      if (bandBottom <= regionY || bandY >= regionBottom) continue
      const rowStart = Math.max(regionY, bandY)
      const rowEnd = Math.min(regionBottom, bandBottom)
      const groupY = Math.floor(bandY / this.#header.groupDimension)
      const firstGroupX = Math.floor(regionX / this.#header.groupDimension)
      const lastGroupX = Math.floor((regionRight - 1) / this.#header.groupDimension)
      const activeGroups: ModularGroup[] = []
      for (let groupX = firstGroupX; groupX <= lastGroupX; groupX += 1) {
        const groupId = groupY * this.#header.groupsAcross + groupX
        activeGroups.push(
          await this.#loadGroup(
            groupId,
            request.signal === undefined ? {} : { signal: request.signal },
          ),
        )
      }
      const prefixPlanes = activeGroups[0]?.program.prefixPlanes ?? []
      const workingBytes =
        prefixPlanes.reduce((sum, plane) => sum + BigInt(plane.byteLength), 0n) +
        activeGroups.reduce(
          (sum, group) =>
            sum +
            group.program.channelLayouts
              .slice(group.program.prefixPlanes.length)
              .reduce(
                (groupSum, layout) => groupSum + BigInt(layout.width) * BigInt(layout.height) * 4n,
                0n,
              ),
          0n,
        )
      if (workingBytes > BigInt(this.#limits.maxDecodedBytes)) {
        throw limitExceeded(
          `JPEG XL intersecting Modular groups require ${workingBytes} bytes; maxDecodedBytes is ${this.#limits.maxDecodedBytes}`,
        )
      }
      const active = activeGroups.map((group) => {
        const intersectionX = Math.max(regionX, group.x)
        const intersectionRight = Math.min(regionRight, group.x + group.width)
        const decoder = new JpegXlModularDecoder(groupHeader(this.#header, group), group.program)
        return {
          targetX: intersectionX - regionX,
          width: intersectionRight - intersectionX,
          iterator: decoder
            .decode({
              x: intersectionX - group.x,
              y: rowStart - group.y,
              width: intersectionRight - intersectionX,
              height: rowEnd - rowStart,
              ...(request.signal === undefined ? {} : { signal: request.signal }),
            })
            [Symbol.asyncIterator](),
        }
      })
      try {
        for (let y = rowStart; y < rowEnd; y += 1) {
          throwIfAborted(request.signal)
          const output = new Uint8Array(regionWidth * bytesPerPixel)
          let displayRanges: readonly PixelSampleDisplayRange[] | undefined
          for (const source of active) {
            const result = await source.iterator.next()
            if (result.done) {
              throw invalidInput('JPEG XL Modular group ended before its declared height')
            }
            const block = result.value
            if (
              block.x !== 0 ||
              block.y !== y - rowStart ||
              block.width !== source.width ||
              block.height !== 1 ||
              block.format !== this.pixelFormat
            ) {
              block.release?.()
              throw invalidInput('JPEG XL Modular group output geometry is inconsistent')
            }
            output.set(block.data, source.targetX * bytesPerPixel)
            displayRanges ??= block.displayRanges
            block.release?.()
          }
          yield {
            x: 0,
            y: y - regionY,
            width: regionWidth,
            height: 1,
            stride: output.byteLength,
            format: this.pixelFormat,
            data: output,
            ...(displayRanges === undefined ? {} : { displayRanges }),
          }
        }
      } finally {
        for (const source of active) await source.iterator.return?.(undefined)
      }
    }
  }
}

class JpegXlStraightAlphaDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly colorSemantics: PixelColorSemantics
  readonly capabilities: ImageDecoder['capabilities']
  readonly #source: ImageDecoder
  readonly #colorMaximum: number
  readonly #alphaMaximum: number

  constructor(source: ImageDecoder, header: Readonly<JpegXlHeader>) {
    if (
      source.pixelFormat !== 'rgba8' &&
      source.pixelFormat !== 'rgba16' &&
      source.pixelFormat !== 'rgbaf32'
    ) {
      throw unsupportedOperation('JPEG XL associated alpha requires RGBA output')
    }
    this.width = source.width
    this.height = source.height
    this.pixelFormat = source.pixelFormat
    this.capabilities = source.capabilities
    this.#source = source
    this.#colorMaximum = 2 ** header.bitDepth - 1
    this.#alphaMaximum = 2 ** (header.alphaBitDepth ?? header.bitDepth) - 1
    this.colorSemantics = Object.freeze({
      ...(source.colorSemantics ?? jpegXlPixelColorSemantics(header)),
      alpha: 'straight',
    })
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    for await (const block of this.#source.decode(request)) {
      const data = block.data
      if (block.format === 'rgba8') {
        for (let offset = 0; offset < data.byteLength; offset += 4) {
          const alpha = data[offset + 3] ?? 0
          for (let channel = 0; channel < 3; channel += 1) {
            const sample = data[offset + channel] ?? 0
            data[offset + channel] =
              alpha === 0 ? 0 : Math.min(255, Math.round((sample * 255) / alpha))
          }
        }
      } else if (block.format === 'rgbaf32') {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        for (let row = 0; row < block.height; row += 1)
          for (let x = 0; x < block.width; x += 1) {
            const offset = row * block.stride + x * 16
            const alpha = view.getFloat32(offset + 12, false)
            for (let channel = 0; channel < 3; channel += 1)
              view.setFloat32(
                offset + channel * 4,
                alpha === 0 ? 0 : view.getFloat32(offset + channel * 4, false) / alpha,
                false,
              )
          }
      } else if (block.format === 'rgba16') {
        for (let offset = 0; offset < data.byteLength; offset += 8) {
          const alpha = (data[offset + 6] ?? 0) * 256 + (data[offset + 7] ?? 0)
          for (let channel = 0; channel < 3; channel += 1) {
            const sampleOffset = offset + channel * 2
            const sample = (data[sampleOffset] ?? 0) * 256 + (data[sampleOffset + 1] ?? 0)
            const straight =
              alpha === 0
                ? 0
                : Math.min(this.#colorMaximum, Math.round((sample * this.#alphaMaximum) / alpha))
            data[sampleOffset] = straight >>> 8
            data[sampleOffset + 1] = straight & 255
          }
        }
      }
      yield Object.freeze({ ...block, data, colorSemantics: this.colorSemantics })
    }
  }
}

const alphaOutputDecoder = (
  decoder: ImageDecoder,
  header: Readonly<JpegXlHeader>,
  options: Readonly<DecoderOptions>,
): ImageDecoder => {
  if (
    options.alphaOutput !== undefined &&
    options.alphaOutput !== 'preserve' &&
    options.alphaOutput !== 'straight'
  ) {
    throw invalidInput('JPEG XL alphaOutput must be preserve or straight')
  }
  return header.alphaAssociated && options.alphaOutput === 'straight'
    ? new JpegXlStraightAlphaDecoder(decoder, header)
    : decoder
}

const primariesCode = (primaries: PixelColorPrimaries): 1 | 9 | 12 => {
  if (primaries === 'srgb') return 1
  if (primaries === 'rec2020') return 9
  if (primaries === 'display-p3') return 12
  throw unsupportedOperation('JPEG XL HDR output requires known RGB primaries')
}

const transferCode = (transfer: PixelTransferFunction): 16 | 18 => {
  if (transfer.kind === 'pq') return 16
  if (transfer.kind === 'hlg') return 18
  throw unsupportedOperation('JPEG XL HDR float output requires PQ or HLG transfer metadata')
}

const jpegXlHdrToneMap = (
  header: Readonly<JpegXlHeader>,
): ReturnType<typeof createNclxHdrToneMap> => {
  const base = createNclxHdrToneMap(
    primariesCode(header.colorSemanticsPrimaries),
    transferCode(header.colorSemanticsTransfer),
  )
  if (header.colorSemanticsTransfer.kind !== 'hlg') return base
  return {
    ...base,
    sourcePeak: header.toneMapping.intensityTarget / 203,
    hlgSystemGamma: 1.2 * 1.111 ** Math.log2(header.toneMapping.intensityTarget / 1000),
  }
}

class JpegXlHdrFloatDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'rgbf32' | 'rgbaf32'
  readonly colorSemantics: PixelColorSemantics
  readonly capabilities: ImageDecoder['capabilities']
  readonly #source: ImageDecoder
  readonly #maximum: number
  readonly #alphaMaximum: number
  readonly #channels: 3 | 4
  readonly #toneMap: ReturnType<typeof createNclxHdrToneMap>

  constructor(source: ImageDecoder, header: Readonly<JpegXlHeader>) {
    if (!['gray8', 'gray16', 'rgb8', 'rgb16', 'rgba8', 'rgba16'].includes(source.pixelFormat)) {
      throw unsupportedOperation(
        'JPEG XL HDR float output requires integer RGB or grayscale samples',
      )
    }
    this.width = source.width
    this.height = source.height
    this.#channels = header.alphaBitDepth === undefined ? 3 : 4
    this.#alphaMaximum = 2 ** (header.alphaBitDepth ?? header.bitDepth) - 1
    this.pixelFormat = this.#channels === 4 ? 'rgbaf32' : 'rgbf32'
    this.capabilities = source.capabilities
    this.#source = source
    this.#maximum = 2 ** header.bitDepth - 1
    this.#toneMap = jpegXlHdrToneMap(header)
    this.colorSemantics = Object.freeze({
      family: 'rgb',
      primaries: header.colorSemanticsPrimaries,
      transfer: Object.freeze({ kind: 'linear' }),
      matrix: 'identity',
      range: 'full',
      alpha: this.#channels === 4 ? 'straight' : 'none',
      provenance: 'decoder-converted',
      renderingIntent: header.renderingIntent,
    })
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    for await (const block of this.#source.decode(request)) {
      let output: PixelBlock
      try {
        throwIfAborted(request.signal)
        output = this.#convert(block)
      } finally {
        block.release?.()
      }
      yield output
    }
  }

  #convert(block: PixelBlock): PixelBlock {
    const bytesPerSample = block.format.endsWith('16') ? 2 : 1
    const sourceChannels = block.format.startsWith('gray') ? 1 : this.#channels
    const pixelCount = block.width * block.height
    const data = new Uint8Array(pixelCount * this.#channels * 4)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const offset =
          Math.floor(pixel / block.width) * block.stride +
          ((pixel % block.width) * sourceChannels + (sourceChannels === 1 ? 0 : channel)) *
            bytesPerSample
        const sample =
          bytesPerSample === 1
            ? (block.data[offset] ?? 0)
            : (block.data[offset] ?? 0) * 256 + (block.data[offset + 1] ?? 0)
        view.setFloat32(
          (pixel * this.#channels + channel) * 4,
          nclxHdrToLinear(this.#toneMap, sample / this.#maximum),
          false,
        )
      }
      if (this.#channels === 4) {
        const offset =
          Math.floor(pixel / block.width) * block.stride +
          ((pixel % block.width) * 4 + 3) * bytesPerSample
        const alpha =
          bytesPerSample === 1
            ? (block.data[offset] ?? 0)
            : (block.data[offset] ?? 0) * 256 + (block.data[offset + 1] ?? 0)
        view.setFloat32((pixel * 4 + 3) * 4, alpha / this.#alphaMaximum, false)
      }
      const luma = this.#toneMap.hlgLumaCoefficients
      if (luma) {
        const offset = pixel * this.#channels * 4
        const red = view.getFloat32(offset, false)
        const green = view.getFloat32(offset + 4, false)
        const blue = view.getFloat32(offset + 8, false)
        const luminance = Math.max(0, luma[0] * red + luma[1] * green + luma[2] * blue)
        const scale =
          luminance === 0
            ? 0
            : luminance ** ((this.#toneMap.hlgSystemGamma ?? 1.2) - 1) * this.#toneMap.sourcePeak
        view.setFloat32(offset, red * scale, false)
        view.setFloat32(offset + 4, green * scale, false)
        view.setFloat32(offset + 8, blue * scale, false)
      }
    }
    return Object.freeze({
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      stride: block.width * this.#channels * 4,
      format: this.pixelFormat,
      data,
      colorSemantics: this.colorSemantics,
      displayRanges: Object.freeze([
        Object.freeze({ black: 0, white: this.#toneMap.sourcePeak }),
        Object.freeze({ black: 0, white: this.#toneMap.sourcePeak }),
        Object.freeze({ black: 0, white: this.#toneMap.sourcePeak }),
        ...(this.#channels === 4 ? [Object.freeze({ black: 0, white: 1 })] : []),
      ]),
    })
  }
}

class JpegXlHdrSdrDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'rgb8' | 'rgba8'
  readonly colorSemantics: PixelColorSemantics
  readonly capabilities: ImageDecoder['capabilities']
  readonly #source: ImageDecoder
  readonly #maximum: number
  readonly #alphaMaximum: number
  readonly #channels: 3 | 4
  readonly #toneMap: ReturnType<typeof createNclxHdrToneMap>

  constructor(source: ImageDecoder, header: Readonly<JpegXlHeader>) {
    if (
      !['gray8', 'gray16', 'rgb8', 'rgb16', 'rgba8', 'rgba16', 'rgbf32', 'rgbaf32'].includes(
        source.pixelFormat,
      )
    ) {
      throw unsupportedOperation(
        'JPEG XL HDR SDR conversion requires integer RGB or grayscale samples',
      )
    }
    this.width = source.width
    this.height = source.height
    this.#channels = header.alphaBitDepth === undefined ? 3 : 4
    this.#alphaMaximum = 2 ** (header.alphaBitDepth ?? header.bitDepth) - 1
    this.pixelFormat = this.#channels === 4 ? 'rgba8' : 'rgb8'
    this.capabilities = source.capabilities
    this.#source = source
    this.#maximum = 2 ** header.bitDepth - 1
    const toneMap = jpegXlHdrToneMap(header)
    this.#toneMap = source.pixelFormat.endsWith('f32')
      ? {
          encodedToLinear: toneMap.encodedToLinear,
          linearToSrgb: toneMap.linearToSrgb,
          sourcePeak: toneMap.sourcePeak,
          sourceToSrgb: Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1),
        }
      : toneMap
    this.colorSemantics = Object.freeze({
      family: 'rgb',
      primaries: 'srgb',
      transfer: Object.freeze({ kind: 'srgb' }),
      matrix: 'identity',
      range: 'full',
      alpha: this.#channels === 4 ? 'straight' : 'none',
      provenance: 'decoder-converted',
      renderingIntent: header.renderingIntent,
    })
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    for await (const block of this.#source.decode(request)) {
      let output: PixelBlock
      try {
        throwIfAborted(request.signal)
        output = this.#convert(block)
      } finally {
        block.release?.()
      }
      yield output
    }
  }

  #convert(block: PixelBlock): PixelBlock {
    const bytesPerSample = block.format.endsWith('16') ? 2 : 1
    const sourceChannels = block.format.startsWith('gray') ? 1 : this.#channels
    const pixelCount = block.width * block.height
    const data = new Uint8Array(pixelCount * this.#channels)
    const rgba = new Uint8Array(4)
    if (block.format === 'rgbf32' || block.format === 'rgbaf32') {
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let y = 0; y < block.height; y += 1)
        for (let x = 0; x < block.width; x += 1) {
          const source = y * block.stride + x * this.#channels * 4
          const destination = (y * block.width + x) * this.#channels
          writeNclxHdrLinearToneMappedRgba(
            rgba,
            0,
            view.getFloat32(source, false),
            view.getFloat32(source + 4, false),
            view.getFloat32(source + 8, false),
            this.#toneMap,
          )
          data.set(rgba.subarray(0, this.#channels), destination)
          if (this.#channels === 4)
            data[destination + 3] = Math.round(
              Math.max(0, Math.min(1, view.getFloat32(source + 12, false))) * 255,
            )
        }
      return Object.freeze({
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        stride: block.width * this.#channels,
        format: this.pixelFormat,
        data,
        colorSemantics: this.colorSemantics,
      })
    }
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const offset =
        Math.floor(pixel / block.width) * block.stride +
        (pixel % block.width) * sourceChannels * bytesPerSample
      const red =
        bytesPerSample === 1
          ? (block.data[offset] ?? 0)
          : (block.data[offset] ?? 0) * 256 + (block.data[offset + 1] ?? 0)
      const greenOffset = offset + (sourceChannels === 1 ? 0 : bytesPerSample)
      const green =
        bytesPerSample === 1
          ? (block.data[greenOffset] ?? 0)
          : (block.data[greenOffset] ?? 0) * 256 + (block.data[greenOffset + 1] ?? 0)
      const blueOffset = greenOffset + (sourceChannels === 1 ? 0 : bytesPerSample)
      const blue =
        bytesPerSample === 1
          ? (block.data[blueOffset] ?? 0)
          : (block.data[blueOffset] ?? 0) * 256 + (block.data[blueOffset + 1] ?? 0)
      writeNclxHdrToneMappedRgba(
        rgba,
        0,
        red / this.#maximum,
        green / this.#maximum,
        blue / this.#maximum,
        this.#toneMap,
      )
      const outputOffset = pixel * this.#channels
      data[outputOffset] = rgba[0] ?? 0
      data[outputOffset + 1] = rgba[1] ?? 0
      data[outputOffset + 2] = rgba[2] ?? 0
      if (this.#channels === 4) {
        const alphaOffset = offset + 3 * bytesPerSample
        const alpha =
          bytesPerSample === 1
            ? (block.data[alphaOffset] ?? 0)
            : (block.data[alphaOffset] ?? 0) * 256 + (block.data[alphaOffset + 1] ?? 0)
        data[outputOffset + 3] = Math.round((alpha * 255) / this.#alphaMaximum)
      }
    }
    return Object.freeze({
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      stride: block.width * this.#channels,
      format: this.pixelFormat,
      data,
      colorSemantics: this.colorSemantics,
    })
  }
}

export const configureJpegXlDecoderOutput = (
  decoder: ImageDecoder,
  header: Readonly<JpegXlHeader>,
  options: Readonly<DecoderOptions>,
): ImageDecoder => {
  const alphaConfigured = alphaOutputDecoder(
    decoder,
    header,
    options.hdrOutput === 'linear-float' || options.hdrOutput === 'tone-map-srgb'
      ? { ...options, alphaOutput: 'straight' }
      : options,
  )
  if (options.hdrOutput === undefined || options.hdrOutput === 'encoded') return alphaConfigured
  if (options.hdrOutput === 'linear-float') {
    if (alphaConfigured.pixelFormat === 'rgbf32' || alphaConfigured.pixelFormat === 'rgbaf32')
      return alphaConfigured
    return new JpegXlHdrFloatDecoder(alphaConfigured, header)
  }
  if (options.hdrOutput === 'tone-map-srgb') {
    return new JpegXlHdrSdrDecoder(alphaConfigured, header)
  }
  throw invalidInput('JPEG XL hdrOutput is invalid')
}

export interface JpegXlDecodedDescription {
  readonly metadata: ImageMetadata
  readonly decoder: ImageDecoder
}

export const jpegXlXybOutputIsLinear = (header: Readonly<JpegXlFrameStructure>): boolean =>
  header.colorTransform === 'xyb' &&
  (header.colorSemanticsTransfer.kind === 'pq' ||
    header.colorSemanticsTransfer.kind === 'hlg' ||
    header.colorSemanticsTransfer.kind === 'linear' ||
    header.colorSemanticsPrimaries === 'display-p3' ||
    header.colorSemanticsPrimaries === 'rec2020' ||
    header.chromaticities !== undefined)

export const jpegXlPixelColorSemantics = (header: JpegXlFrameStructure): PixelColorSemantics => {
  const xybConverted = header.colorTransform === 'xyb'
  return Object.freeze({
    family: header.colorChannels === 1 && !jpegXlXybOutputIsLinear(header) ? 'gray' : 'rgb',
    primaries: xybConverted ? 'srgb' : header.colorSemanticsPrimaries,
    transfer: xybConverted
      ? Object.freeze({ kind: jpegXlXybOutputIsLinear(header) ? 'linear' : 'srgb' })
      : header.colorSemanticsTransfer,
    matrix: 'identity',
    range: 'full',
    alpha:
      header.alphaBitDepth === undefined
        ? 'none'
        : header.alphaAssociated
          ? 'premultiplied'
          : 'straight',
    ...(!xybConverted && header.chromaticities !== undefined
      ? { chromaticities: header.chromaticities }
      : {}),
    provenance: xybConverted ? 'decoder-converted' : header.colorProvenance,
    renderingIntent: header.renderingIntent,
    ...(header.colorProvenance === 'icc'
      ? {
          icc: Object.freeze({
            relevance: xybConverted ? ('source' as const) : ('emitted-pixels' as const),
          }),
        }
      : {}),
  })
}

const metadataForHeader = (header: JpegXlHeader): ImageMetadata =>
  Object.freeze({
    width: header.width,
    height: header.height,
    format: 'jpegxl',
    mimeType: 'image/jxl',
    hasAlpha: header.alphaBitDepth !== undefined,
    orientation: header.orientation,
    ...(header.intrinsicWidth === undefined
      ? {}
      : {
          intrinsicWidth: header.intrinsicWidth,
          ...(header.intrinsicHeight === undefined
            ? {}
            : { intrinsicHeight: header.intrinsicHeight }),
        }),
    colorSpace: header.metadataColorSpace,
    ...(header.iccProfile === undefined
      ? {}
      : {
          colorProfile: Object.freeze({
            kind: 'icc' as const,
            ...inspectIccProfile(header.iccProfile),
          }),
        }),
    colorSemantics: jpegXlPixelColorSemantics(header),
    bitDepth: header.bitDepth,
    sampleFormat: header.sampleFormat,
    frames: 1,
    components: header.channelCount,
    channels: header.channelCount,
    channelBitDepths: Object.freeze(
      header.colorChannels === 1
        ? header.alphaBitDepth === undefined
          ? [header.bitDepth]
          : [header.bitDepth, header.alphaBitDepth]
        : header.alphaBitDepth === undefined
          ? [header.bitDepth, header.bitDepth, header.bitDepth]
          : [header.bitDepth, header.bitDepth, header.bitDepth, header.alphaBitDepth],
    ),
    lossless: header.encoding === 'modular',
  })

export const readJpegXlCodestreamMetadata = (
  codestream: Uint8Array,
  limits: ImageLimits,
): ImageMetadata => metadataForHeader(readHeader(codestream, codestream.byteLength, limits))

const readHeaderFromSource = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  maximumHeaderBytes = 4_194_304,
  allowVarDct = false,
  iccLimits: Readonly<JpegXlIccLimits> = defaultJpegXlLimits,
): Promise<JpegXlHeader> => {
  if (!Number.isSafeInteger(maximumHeaderBytes) || maximumHeaderBytes < 1) {
    throw invalidInput('JPEG XL maximum header bytes is invalid')
  }
  const headerLimit = Math.min(source.size, maximumHeaderBytes)
  let headerBytes = Math.min(headerLimit, 4_096)
  while (true) {
    throwIfAborted(options.signal)
    const header = await readExactly(source, 0, headerBytes, options)
    try {
      return readHeader(header, source.size, limits, allowVarDct, options, undefined, iccLimits)
    } catch (error) {
      if (!(error instanceof ImageError) || error.code !== 'TRUNCATED_INPUT') throw error
      if (headerBytes >= headerLimit) {
        if (headerBytes < source.size) {
          throw limitExceeded(
            `JPEG XL header exceeds the bounded ${headerLimit}-byte inspection window`,
          )
        }
        throw error
      }
      headerBytes = Math.min(headerLimit, headerBytes * 2)
    }
  }
}

const readFrameSequenceFromSource = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions>,
  maximumHeaderBytes: number,
  iccLimits: Readonly<JpegXlIccLimits> = defaultJpegXlLimits,
): Promise<readonly JpegXlFrameStructure[]> => {
  if (!Number.isSafeInteger(maximumHeaderBytes) || maximumHeaderBytes < 1) {
    throw invalidInput('JPEG XL maximum header bytes is invalid')
  }
  const headerLimit = Math.min(source.size, maximumHeaderBytes)
  let headerBytes = Math.min(headerLimit, 4_096)
  while (true) {
    throwIfAborted(options.signal)
    const prefix = await readExactly(source, 0, headerBytes, options)
    try {
      const frames: JpegXlFrameStructure[] = []
      let previous: JpegXlFrameStructure | undefined
      do {
        if (frames.length >= 5) throw limitExceeded('JPEG XL internal frame count exceeds 5')
        const frame = readHeader(prefix, source.size, limits, true, options, previous, iccLimits)
        if (previous && frame.codestreamEndOffset <= previous.codestreamEndOffset) {
          throw invalidInput('JPEG XL internal frame extent does not advance')
        }
        frames.push(frame)
        previous = frame
      } while (!previous.isLast)
      return Object.freeze(frames)
    } catch (error) {
      if (!(error instanceof ImageError) || error.code !== 'TRUNCATED_INPUT') throw error
      if (headerBytes >= headerLimit) {
        if (headerBytes < source.size) {
          throw limitExceeded(
            `JPEG XL internal frame headers exceed the bounded ${headerLimit}-byte inspection window`,
          )
        }
        throw error
      }
      headerBytes = Math.min(headerLimit, headerBytes * 2)
    }
  }
}

export const readJpegXlSourceMetadata = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  maximumHeaderBytes = 4_194_304,
  iccLimits: Readonly<JpegXlIccLimits> = defaultJpegXlLimits,
): Promise<ImageMetadata> => {
  const frames = await readFrameSequenceFromSource(
    source,
    limits,
    options,
    maximumHeaderBytes,
    iccLimits,
  )
  const displayFrame = frames.at(-1)
  if (!displayFrame) throw invalidInput('JPEG XL display frame is missing')
  return metadataForHeader(displayFrame)
}

export interface JpegXlInspectionMetadata {
  readonly metadata: ImageMetadata
  readonly encoding: 'modular' | 'vardct'
  readonly progressivePasses: number
  readonly frame: JpegXlFrameStructure
}

export const readJpegXlSourceInspectionMetadata = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  maximumHeaderBytes = 4_194_304,
  iccLimits: Readonly<JpegXlIccLimits> = defaultJpegXlLimits,
): Promise<JpegXlInspectionMetadata> => {
  const frames = await readFrameSequenceFromSource(
    source,
    limits,
    options,
    maximumHeaderBytes,
    iccLimits,
  )
  const displayFrame = frames.at(-1)
  if (!displayFrame) throw invalidInput('JPEG XL display frame is missing')
  return Object.freeze({
    metadata: metadataForHeader(displayFrame),
    encoding: displayFrame.encoding,
    progressivePasses: displayFrame.passCount,
    frame: displayFrame,
  })
}

export const readJpegXlSourceFrameStructure = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  maximumHeaderBytes = 4_194_304,
  iccLimits: Readonly<JpegXlIccLimits> = defaultJpegXlLimits,
): Promise<JpegXlFrameStructure> =>
  readHeaderFromSource(source, limits, options, maximumHeaderBytes, true, iccLimits)

export const readJpegXlSourceFrameStructures = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  maximumHeaderBytes = 4_194_304,
  iccLimits: Readonly<JpegXlIccLimits> = defaultJpegXlLimits,
): Promise<readonly JpegXlFrameStructure[]> =>
  readFrameSequenceFromSource(source, limits, options, maximumHeaderBytes, iccLimits)

export const decodeJpegXlSource = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  maximumHeaderBytes = 4_194_304,
  iccLimits: Readonly<JpegXlIccLimits> = defaultJpegXlLimits,
): Promise<JpegXlDecodedDescription> => {
  const header = await readHeaderFromSource(
    source,
    limits,
    options,
    maximumHeaderBytes,
    false,
    iccLimits,
  )
  if (
    header.frameType !== 'regular' ||
    !header.isLast ||
    header.frameWidth !== header.width ||
    header.frameHeight !== header.height
  ) {
    throw unsupportedOperation('JPEG XL Modular frame composition is not supported')
  }
  if (header.sections.length === 1) {
    const section = header.sections[0]
    if (!section) throw invalidInput('JPEG XL frame section is missing')
    const data = await readExactly(source, section.offset, section.length, options)
    const program = readJpegXlModularProgram(
      data,
      header.channelCount,
      header.width,
      header.height,
      header.frameFlags,
      header.extraChannels.length,
    )
    if ((program.frameFeatures?.patches.length ?? 0) > 0) {
      throw unsupportedOperation('JPEG XL Modular patches are not supported')
    }
    return Object.freeze({
      metadata: metadataForHeader(header),
      decoder: new JpegXlModularDecoder(header, program, options.signal),
    })
  }
  const globalSection = header.sections[0]
  if (!globalSection) throw invalidInput('JPEG XL global section is missing')
  const globalData = await readExactly(source, globalSection.offset, globalSection.length, options)
  const foundation = readMultiGroupFoundation(globalData, header)
  const loadGroup: ModularGroupLoader = async (groupId, readOptions = {}) => {
    if (
      !Number.isSafeInteger(groupId) ||
      groupId < 0 ||
      groupId >= header.groupsAcross * header.groupsDown
    ) {
      throw invalidInput('JPEG XL Modular group index is invalid')
    }
    const section = header.sections[foundation.firstGroupSection + groupId]
    if (!section) throw invalidInput(`JPEG XL Modular group ${groupId} section is missing`)
    const signal = combineAbortSignals(options.signal, readOptions.signal)
    const data = await readExactly(
      source,
      section.offset,
      section.length,
      signal === undefined ? {} : { signal },
    )
    return readModularGroup(data, header, foundation, groupId)
  }
  return Object.freeze({
    metadata: metadataForHeader(header),
    decoder: new JpegXlMultiGroupModularDecoder(header, loadGroup, limits, options.signal),
  })
}

export const decodeJpegXlCodestream = (
  codestream: Uint8Array,
  limits: ImageLimits,
): JpegXlDecodedDescription => {
  const header = readHeader(codestream, codestream.byteLength, limits)
  if (header.sections.length === 1) {
    const section = header.sections[0]
    if (!section) throw invalidInput('JPEG XL frame section is missing')
    const sectionData = codestream.subarray(section.offset, section.offset + section.length)
    const program = readJpegXlModularProgram(
      sectionData,
      header.channelCount,
      header.width,
      header.height,
      header.frameFlags,
      header.extraChannels.length,
    )
    if ((program.frameFeatures?.patches.length ?? 0) > 0) {
      throw unsupportedOperation('JPEG XL Modular patches are not supported')
    }
    return Object.freeze({
      metadata: metadataForHeader(header),
      decoder: new JpegXlModularDecoder(header, program),
    })
  }
  const groups = readMultiGroupPrograms(
    header.sections.map((section) =>
      codestream.subarray(section.offset, section.offset + section.length),
    ),
    header,
  )
  const loadGroup: ModularGroupLoader = async (groupId, options = {}) => {
    throwIfAborted(options.signal)
    const group = groups[groupId]
    if (!group) throw invalidInput('JPEG XL Modular group index is invalid')
    return group
  }
  return Object.freeze({
    metadata: metadataForHeader(header),
    decoder: new JpegXlMultiGroupModularDecoder(header, loadGroup, limits),
  })
}
