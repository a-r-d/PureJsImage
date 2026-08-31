import { combineAbortSignals, throwIfAborted } from '../abort.ts'
import type { DecodeRequest, DecoderOptions, ImageDecoder, ImageMetadata } from '../codec.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock, PixelSampleDisplayRange } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import type { JpegXlEntropyCode } from './jpegxl-bitstream.ts'
import {
  JpegXlBitReader,
  JpegXlEntropySymbolReader,
  readJpegXlEntropyCode,
} from './jpegxl-bitstream.ts'

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

const readIntegerBitDepth = (reader: JpegXlBitReader): number => {
  requireValue(reader.readBits(1) !== 0, false, 'floating-point samples')
  const depth = readU32(reader, [value(8), value(10), value(12), bits(6, 1)])
  if (depth < 1 || depth > 16) {
    throw unsupportedOperation('JPEG XL sample depths above 16 bits are not supported')
  }
  return depth
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

type JpegXlChannelCount = 1 | 2 | 3 | 4

interface JpegXlColorEncoding {
  readonly colorChannels: 1 | 3
  readonly metadataColorSpace: 'gray' | 'linear-gray' | 'srgb' | 'linear-rgb'
}

interface JpegXlSection {
  readonly offset: number
  readonly length: number
}

interface JpegXlHeader {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly alphaBitDepth: number | undefined
  readonly colorChannels: 1 | 3
  readonly channelCount: JpegXlChannelCount
  readonly metadataColorSpace: JpegXlColorEncoding['metadataColorSpace']
  readonly orientation: number
  readonly groupDimension: number
  readonly groupsAcross: number
  readonly groupsDown: number
  readonly dcGroupCount: number
  readonly sections: readonly JpegXlSection[]
}

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

const readColorEncoding = (reader: JpegXlBitReader): JpegXlColorEncoding => {
  const allDefault = reader.readBits(1) !== 0
  if (allDefault) return Object.freeze({ colorChannels: 3, metadataColorSpace: 'srgb' })

  requireValue(reader.readBits(1) !== 0, false, 'embedded ICC color encoding')
  const colorSpace = readEnum(reader)
  if (colorSpace !== 0 && colorSpace !== 1) {
    throw unsupportedOperation('JPEG XL non-RGB/gray color encoding is not supported')
  }
  requireValue(readEnum(reader), 1, 'non-D65 white point')
  if (colorSpace === 0) requireValue(readEnum(reader), 1, 'non-sRGB primaries')

  requireValue(reader.readBits(1) !== 0, false, 'custom gamma transfer function')
  const transferFunction = readEnum(reader)
  if (transferFunction !== 8 && transferFunction !== 13) {
    throw unsupportedOperation('JPEG XL transfer function is not supported')
  }
  const renderingIntent = readEnum(reader)
  if (renderingIntent > 3) throw invalidInput('JPEG XL rendering intent is invalid')

  if (colorSpace === 1) {
    return Object.freeze({
      colorChannels: 1,
      metadataColorSpace: transferFunction === 8 ? 'linear-gray' : 'gray',
    })
  }
  return Object.freeze({
    colorChannels: 3,
    metadataColorSpace: transferFunction === 8 ? 'linear-rgb' : 'srgb',
  })
}

const channelCountFor = (colorChannels: 1 | 3, extraChannels: number): JpegXlChannelCount => {
  if (colorChannels === 1) return extraChannels === 0 ? 1 : 2
  return extraChannels === 0 ? 3 : 4
}

const readHeader = (
  codestream: Uint8Array,
  codestreamBytes: number,
  limits: ImageLimits,
): JpegXlHeader => {
  if (codestream[0] !== 0xff || codestream[1] !== 0x0a) {
    throw invalidInput('JPEG XL codestream signature is missing')
  }
  const reader = new JpegXlBitReader(codestream, 16)
  const { width, height } = readSize(reader)
  validateImageDimensions(width, height, 1, limits)

  requireValue(reader.readBits(1) !== 0, false, 'default XYB metadata')
  const extraFields = reader.readBits(1) !== 0
  requireValue(extraFields, false, 'orientation, preview, animation, or tone-mapping metadata')
  const bitDepth = readIntegerBitDepth(reader)
  reader.readBits(1) // modular_16_bit_buffer_sufficient
  const extraChannels = readU32(reader, [value(0), value(1), bits(4, 2), bits(12, 1)])
  if (extraChannels > 1) {
    throw unsupportedOperation('JPEG XL multiple extra channels are not supported')
  }
  let alphaBitDepth: number | undefined
  // Extra-channel metadata precedes the color encoding that determines the color plane count.
  if (extraChannels === 1) {
    const defaultExtraChannel = reader.readBits(1) !== 0
    if (defaultExtraChannel) {
      alphaBitDepth = 8
    } else {
      requireValue(
        readU32(reader, [value(0), value(1), bits(4, 2), bits(6, 18)]),
        0,
        'non-alpha extra channels',
      )
      alphaBitDepth = readIntegerBitDepth(reader)
      requireValue(
        readU32(reader, [value(0), value(3), value(4), bits(3, 1)]),
        0,
        'downsampled alpha',
      )
      readName(reader)
      requireValue(reader.readBits(1) !== 0, false, 'premultiplied alpha')
    }
  }
  requireValue(reader.readBits(1) !== 0, false, 'XYB color encoding')
  const colorEncoding = readColorEncoding(reader)
  const channelCount = channelCountFor(colorEncoding.colorChannels, extraChannels)
  requireValue(readU64(reader), 0, 'image-metadata extensions')
  requireValue(reader.readBits(1) !== 0, true, 'custom transform weights')
  alignWithZeroPadding(reader)

  requireValue(reader.readBits(1) !== 0, false, 'default VarDCT frame header')
  requireValue(readU32(reader, [value(0), value(1), value(2), value(3)]), 0, 'non-regular frames')
  requireValue(reader.readBits(1) !== 0, true, 'VarDCT frames')
  requireValue(readU64(reader), 0, 'frame flags')
  requireValue(reader.readBits(1) !== 0, false, 'YCbCr color transform')
  requireValue(readU32(reader, [value(1), value(2), value(4), value(8)]), 1, 'color upsampling')
  for (let index = 0; index < extraChannels; index += 1) {
    requireValue(
      readU32(reader, [value(1), value(2), value(4), value(8)]),
      1,
      'extra-channel upsampling',
    )
  }
  const groupSizeShift = reader.readBits(2)
  requireValue(readU32(reader, [value(1), value(2), value(3), bits(3, 4)]), 1, 'progressive passes')
  requireValue(reader.readBits(1) !== 0, false, 'partial frames')
  requireValue(readU32(reader, [value(0), value(1), value(2), bits(2, 3)]), 0, 'frame blending')
  for (let index = 0; index < extraChannels; index += 1) {
    requireValue(
      readU32(reader, [value(0), value(1), value(2), bits(2, 3)]),
      0,
      'extra-channel blending',
    )
  }
  requireValue(reader.readBits(1) !== 0, true, 'multiple frames')
  readName(reader)
  requireValue(reader.readBits(1) !== 0, false, 'default loop filtering')
  requireValue(reader.readBits(1) !== 0, false, 'Gaborish filtering')
  requireValue(reader.readBits(2), 0, 'edge-preserving filtering')
  requireValue(readU64(reader), 0, 'loop-filter extensions')
  requireValue(readU64(reader), 0, 'frame extensions')

  const groupDimension = 128 * 2 ** groupSizeShift
  const groupsAcross = Math.ceil(width / groupDimension)
  const groupsDown = Math.ceil(height / groupDimension)
  const groupCount = groupsAcross * groupsDown
  const dcGroupDimension = groupDimension * 8
  const dcGroupCount = Math.ceil(width / dcGroupDimension) * Math.ceil(height / dcGroupDimension)
  const workingWidth = groupCount === 1 ? width : Math.min(width, groupDimension)
  const workingHeight = groupCount === 1 ? height : Math.min(height, groupDimension)
  const planeBytes = BigInt(workingWidth) * BigInt(workingHeight) * BigInt(channelCount) * 4n
  if (planeBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `JPEG XL Modular working planes require ${planeBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }
  const sectionCount = groupCount === 1 ? 1 : 2 + dcGroupCount + groupCount
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
    bitDepth,
    alphaBitDepth,
    colorChannels: colorEncoding.colorChannels,
    channelCount,
    metadataColorSpace: colorEncoding.metadataColorSpace,
    orientation: 1,
    groupDimension,
    groupsAcross,
    groupsDown,
    dcGroupCount,
    sections: Object.freeze(sections),
  })
}

interface ModularLeaf {
  readonly kind: 'leaf'
  readonly predictor: number
  readonly offset: number
  readonly multiplier: number
  readonly context: number
}

interface ModularBranch {
  readonly kind: 'branch'
  readonly property: number
  readonly split: number
  readonly greater: number
  readonly lessOrEqual: number
}

type ModularNode = ModularLeaf | ModularBranch

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

interface ModularChannelLayout {
  readonly width: number
  readonly height: number
}

interface ModularPaletteTransform {
  readonly beginChannel: number
  readonly channelCount: number
  readonly colorCount: number
  readonly deltaCount: number
  readonly predictor: number
}

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

const defaultWeightedPredictor = Object.freeze({
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
  if (reader.readBits(1) !== 0) return defaultWeightedPredictor
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
  readonly nodes: readonly ModularNode[]
  readonly rctBegin: number
  readonly rctType: number
  readonly section: Uint8Array
  readonly residualBitPosition: number
  readonly pixelCode: JpegXlEntropyCode
  readonly weightedPredictor: WeightedPredictorParameters
  readonly usesWeightedPrediction: boolean
  readonly channelLayouts: readonly ModularChannelLayout[]
  readonly palette: ModularPaletteTransform | undefined
  readonly groupId: number
  readonly prefixPlanes: readonly Int32Array<ArrayBufferLike>[]
}

const readModularProgram = (
  section: Uint8Array,
  channelCount: JpegXlChannelCount,
  width: number,
  height: number,
): ModularProgram => {
  const reader = new JpegXlBitReader(section)
  requireValue(reader.readBits(1) !== 0, true, 'custom DC quantization')
  const hasGlobalTree = reader.readBits(1) !== 0
  const globalTree = hasGlobalTree ? readTree(reader) : undefined
  const globalPixelCode = globalTree ? readJpegXlEntropyCode(reader, globalTree.leaves) : undefined
  const useGlobalTree = reader.readBits(1) !== 0
  if (useGlobalTree && (!globalTree || !globalPixelCode)) {
    throw invalidInput('JPEG XL Modular group references a missing global tree')
  }
  const weightedPredictor = readWeightedPredictor(reader)
  const transformCount = readU32(reader, [value(0), value(1), bits(4, 2), bits(8, 18)])
  if (transformCount > 1) {
    throw unsupportedOperation('JPEG XL multiple Modular transforms are not supported')
  }
  let rctBegin = 0
  let rctType = 0
  const channelLayouts: ModularChannelLayout[] = Array.from({ length: channelCount }, () => ({
    width,
    height,
  }))
  let palette: ModularPaletteTransform | undefined
  if (transformCount === 1) {
    const transform = readU32(reader, [value(0), value(1), value(2), value(3)])
    if (transform === 0) {
      rctBegin = readU32(reader, [bits(3), bits(6, 8), bits(10, 72), bits(13, 1_096)])
      rctType = readU32(reader, [value(6), bits(2), bits(4, 2), bits(6, 10)])
      if (rctBegin + 2 >= channelCount || rctType >= 42) {
        throw invalidInput('JPEG XL RCT parameters are invalid')
      }
    } else if (transform === 1) {
      const beginChannel = readU32(reader, [bits(3), bits(6, 8), bits(10, 72), bits(13, 1_096)])
      const paletteChannelCount = readU32(reader, [value(1), value(3), value(4), bits(13, 1)])
      const colorCount = readU32(reader, [bits(8), bits(10, 256), bits(12, 1_280), bits(16, 5_376)])
      const deltaCount = readU32(reader, [value(0), bits(8, 1), bits(10, 257), bits(16, 1_281)])
      const predictor = reader.readBits(4)
      if (
        predictor > 13 ||
        paletteChannelCount < 1 ||
        beginChannel + paletteChannelCount > channelLayouts.length ||
        colorCount < 1
      ) {
        throw invalidInput('JPEG XL Palette transform is invalid')
      }
      const firstLayout = channelLayouts[beginChannel]
      if (
        !firstLayout ||
        channelLayouts
          .slice(beginChannel, beginChannel + paletteChannelCount)
          .some(
            (layout) => layout.width !== firstLayout.width || layout.height !== firstLayout.height,
          )
      ) {
        throw invalidInput('JPEG XL Palette channel dimensions do not match')
      }
      channelLayouts.splice(beginChannel + 1, paletteChannelCount - 1)
      channelLayouts.unshift({ width: colorCount + deltaCount, height: paletteChannelCount })
      palette = Object.freeze({
        beginChannel,
        channelCount: paletteChannelCount,
        colorCount,
        deltaCount,
        predictor,
      })
    } else if (transform === 2) {
      const squeezeCount = readU32(reader, [value(0), bits(4, 1), bits(6, 9), bits(8, 41)])
      if (squeezeCount !== 0 || width > 8 || height > 8) {
        throw unsupportedOperation('JPEG XL Squeeze Modular transforms are not supported')
      }
    } else {
      throw invalidInput('JPEG XL Modular transform is invalid')
    }
  }
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
    nodes: tree.nodes,
    rctBegin,
    rctType,
    section,
    residualBitPosition: reader.bitPosition,
    pixelCode,
    weightedPredictor,
    usesWeightedPrediction,
    channelLayouts: Object.freeze(channelLayouts.map((layout) => Object.freeze(layout))),
    palette,
    prefixPlanes: Object.freeze([]),
    groupId: 0,
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
  const globalProgram = readModularProgram(
    globalData,
    header.channelCount,
    header.width,
    header.height,
  )
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
      rctBegin: foundation.globalProgram.rctBegin,
      rctType: foundation.globalProgram.rctType,
      section: groupData,
      residualBitPosition: reader.bitPosition,
      pixelCode,
      weightedPredictor,
      usesWeightedPrediction,
      channelLayouts,
      palette: foundation.globalProgram.palette,
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

class JpegXlWeightedPredictor {
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
    properties[15] = Math.max(
      Math.abs(leftError),
      Math.abs(topError),
      Math.abs(topLeftError),
      Math.abs(topRightError),
    )

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
      throw invalidInput('JPEG XL Modular section padding is nonzero')
    }
  }
}

const decodeModularPlanes = (
  program: ModularProgram,
  firstChannel: number,
  signal?: AbortSignal,
): Int32Array<ArrayBufferLike>[] => {
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
  requireZeroSectionPadding(reader)
  return planes
}
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

const inversePalette = (
  encodedPlanes: readonly Int32Array[],
  transform: ModularPaletteTransform,
  bitDepth: number,
): Int32Array[] => {
  if (transform.deltaCount !== 0 || transform.predictor !== 0) {
    throw unsupportedOperation('JPEG XL delta Palette transforms are not supported')
  }
  const palette = encodedPlanes[0]
  const indexPosition = transform.beginChannel + 1
  const indices = encodedPlanes[indexPosition]
  if (!palette || !indices) throw invalidInput('JPEG XL Palette channels are missing')
  const paletteWidth = transform.colorCount + transform.deltaCount
  const restored = encodedPlanes.slice(1)
  const channels: Int32Array[] = []
  for (let channel = 0; channel < transform.channelCount; channel += 1) {
    const output = new Int32Array(indices.length)
    const paletteRow = channel * paletteWidth
    for (let position = 0; position < indices.length; position += 1) {
      const index = indices[position] ?? 0
      let sample: number
      if (index < 0) {
        throw unsupportedOperation(`JPEG XL negative Palette index ${index} is not supported`)
      }
      if (index < transform.colorCount) {
        sample = palette[paletteRow + index] ?? 0
      } else if (index < transform.colorCount + 64) {
        const component = (index - transform.colorCount) >>> (channel * 2)
        sample =
          Math.floor(((component & 3) * (2 ** bitDepth - 1)) / 4) + 2 ** Math.max(0, bitDepth - 3)
      } else {
        const component = Math.floor((index - transform.colorCount - 64) / 5 ** channel)
        sample = Math.floor(((component % 5) * (2 ** bitDepth - 1)) / 4)
      }
      output[position] = sample
    }
    channels.push(output)
  }
  restored.splice(transform.beginChannel, 1, ...channels)
  return restored
}

class JpegXlModularDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16'
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #header: JpegXlHeader
  readonly #program: ModularProgram
  readonly #displayRanges: readonly PixelSampleDisplayRange[] | undefined

  constructor(header: JpegXlHeader, program: ModularProgram) {
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
    let planes = decodeModularPlanes(
      this.#program,
      this.#program.prefixPlanes.length,
      request.signal,
    )
    if (this.#program.palette) {
      planes = inversePalette(planes, this.#program.palette, this.#header.bitDepth)
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
    const alphaPlane = planes[this.#header.colorChannels]
    const grayscaleWithAlpha = this.#header.colorChannels === 1
    if (!grayscaleWithAlpha && (!secondPlane || !thirdPlane)) {
      throw invalidInput('JPEG XL color channel buffer is missing')
    }
    const transformed = new Int32Array(3)
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
          if (!grayscaleWithAlpha) {
            inverseRct(
              planes[this.#program.rctBegin]?.[position] ?? 0,
              planes[this.#program.rctBegin + 1]?.[position] ?? 0,
              planes[this.#program.rctBegin + 2]?.[position] ?? 0,
              this.#program.rctType,
              transformed,
            )
          }
          let red = firstPlane[position] ?? 0
          let green = grayscaleWithAlpha ? red : (secondPlane?.[position] ?? 0)
          let blue = grayscaleWithAlpha ? red : (thirdPlane?.[position] ?? 0)
          let alpha = alphaPlane?.[position] ?? 0
          if (!grayscaleWithAlpha && this.#program.rctBegin === 0) {
            red = transformed[0] ?? 0
            green = transformed[1] ?? 0
            blue = transformed[2] ?? 0
          } else if (!grayscaleWithAlpha) {
            green = transformed[0] ?? 0
            blue = transformed[1] ?? 0
            alpha = transformed[2] ?? 0
          }
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
        if (!grayscaleWithAlpha) {
          inverseRct(
            planes[this.#program.rctBegin]?.[position] ?? 0,
            planes[this.#program.rctBegin + 1]?.[position] ?? 0,
            planes[this.#program.rctBegin + 2]?.[position] ?? 0,
            this.#program.rctType,
            transformed,
          )
        }
        let red = firstPlane[position] ?? 0
        let green = grayscaleWithAlpha ? red : (secondPlane?.[position] ?? 0)
        let blue = grayscaleWithAlpha ? red : (thirdPlane?.[position] ?? 0)
        let alpha = alphaPlane?.[position] ?? 0
        if (!grayscaleWithAlpha && this.#program.rctBegin === 0) {
          red = transformed[0] ?? 0
          green = transformed[1] ?? 0
          blue = transformed[2] ?? 0
        } else if (!grayscaleWithAlpha) {
          green = transformed[0] ?? 0
          blue = transformed[1] ?? 0
          alpha = transformed[2] ?? 0
        }
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
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #header: JpegXlHeader
  readonly #loadGroup: ModularGroupLoader
  readonly #limits: ImageLimits

  constructor(header: JpegXlHeader, loadGroup: ModularGroupLoader, limits: ImageLimits) {
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
    this.#header = header
    this.#loadGroup = loadGroup
    this.#limits = limits
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
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

export interface JpegXlDecodedDescription {
  readonly metadata: ImageMetadata
  readonly decoder: ImageDecoder
}

const metadataForHeader = (header: JpegXlHeader): ImageMetadata =>
  Object.freeze({
    width: header.width,
    height: header.height,
    format: 'jpegxl',
    mimeType: 'image/jxl',
    hasAlpha: header.alphaBitDepth !== undefined,
    orientation: header.orientation,
    colorSpace: header.metadataColorSpace,
    bitDepth: header.bitDepth,
    sampleFormat: 'unsigned-integer',
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
    lossless: true,
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
): Promise<JpegXlHeader> => {
  if (!Number.isSafeInteger(maximumHeaderBytes) || maximumHeaderBytes < 1) {
    throw invalidInput('JPEG XL maximum header bytes is invalid')
  }
  const headerLimit = Math.min(source.size, maximumHeaderBytes)
  let headerBytes = Math.min(source.size, 4_096)
  while (true) {
    throwIfAborted(options.signal)
    const header = await readExactly(source, 0, headerBytes, options)
    try {
      return readHeader(header, source.size, limits)
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

export const readJpegXlSourceMetadata = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  maximumHeaderBytes = 4_194_304,
): Promise<ImageMetadata> =>
  metadataForHeader(await readHeaderFromSource(source, limits, options, maximumHeaderBytes))

export const decodeJpegXlSource = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  maximumHeaderBytes = 4_194_304,
): Promise<JpegXlDecodedDescription> => {
  const header = await readHeaderFromSource(source, limits, options, maximumHeaderBytes)
  if (header.sections.length === 1) {
    const section = header.sections[0]
    if (!section) throw invalidInput('JPEG XL frame section is missing')
    const data = await readExactly(source, section.offset, section.length, options)
    const program = readModularProgram(data, header.channelCount, header.width, header.height)
    return Object.freeze({
      metadata: metadataForHeader(header),
      decoder: new JpegXlModularDecoder(header, program),
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
    decoder: new JpegXlMultiGroupModularDecoder(header, loadGroup, limits),
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
    const program = readModularProgram(
      sectionData,
      header.channelCount,
      header.width,
      header.height,
    )
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
