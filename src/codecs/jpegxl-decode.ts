import { throwIfAborted } from '../abort.ts'
import type { DecodeRequest, ImageDecoder, ImageMetadata } from '../codec.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
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

interface JpegXlHeader {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly alphaBitDepth: number
  readonly orientation: number
  readonly sectionOffset: number
  readonly sectionLength: number
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

const readHeader = (codestream: Uint8Array, limits: ImageLimits): JpegXlHeader => {
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
  requireValue(extraChannels, 1, 'extra-channel layout')
  requireValue(reader.readBits(1) !== 0, false, 'default extra-channel metadata')
  requireValue(
    readU32(reader, [value(0), value(1), bits(4, 2), bits(6, 18)]),
    0,
    'non-alpha extra channels',
  )
  const alphaBitDepth = readIntegerBitDepth(reader)
  requireValue(readU32(reader, [value(0), value(3), value(4), bits(3, 1)]), 0, 'downsampled alpha')
  readName(reader)
  requireValue(reader.readBits(1) !== 0, false, 'premultiplied alpha')
  requireValue(reader.readBits(1) !== 0, false, 'XYB color encoding')
  requireValue(reader.readBits(1) !== 0, true, 'custom color encoding')
  requireValue(readU64(reader), 0, 'image-metadata extensions')
  requireValue(reader.readBits(1) !== 0, true, 'custom transform weights')
  alignWithZeroPadding(reader)

  requireValue(reader.readBits(1) !== 0, false, 'default VarDCT frame header')
  requireValue(readU32(reader, [value(0), value(1), value(2), value(3)]), 0, 'non-regular frames')
  requireValue(reader.readBits(1) !== 0, true, 'VarDCT frames')
  requireValue(readU64(reader), 0, 'frame flags')
  requireValue(reader.readBits(1) !== 0, false, 'YCbCr color transform')
  requireValue(readU32(reader, [value(1), value(2), value(4), value(8)]), 1, 'color upsampling')
  requireValue(readU32(reader, [value(1), value(2), value(4), value(8)]), 1, 'alpha upsampling')
  const groupSizeShift = reader.readBits(2)
  requireValue(readU32(reader, [value(1), value(2), value(3), bits(3, 4)]), 1, 'progressive passes')
  requireValue(reader.readBits(1) !== 0, false, 'partial frames')
  requireValue(readU32(reader, [value(0), value(1), value(2), bits(2, 3)]), 0, 'frame blending')
  requireValue(readU32(reader, [value(0), value(1), value(2), bits(2, 3)]), 0, 'alpha blending')
  requireValue(reader.readBits(1) !== 0, true, 'multiple frames')
  readName(reader)
  requireValue(reader.readBits(1) !== 0, false, 'default loop filtering')
  requireValue(reader.readBits(1) !== 0, false, 'Gaborish filtering')
  requireValue(reader.readBits(2), 0, 'edge-preserving filtering')
  requireValue(readU64(reader), 0, 'loop-filter extensions')
  requireValue(readU64(reader), 0, 'frame extensions')

  const groupDimension = 128 * 2 ** groupSizeShift
  if (width > groupDimension || height > groupDimension) {
    throw unsupportedOperation('JPEG XL multi-group Modular images are not supported')
  }
  requireValue(reader.readBits(1), 0, 'permuted table-of-contents entries')
  alignWithZeroPadding(reader)
  const sectionLength = readU32(reader, [
    bits(10),
    bits(14, 1_024),
    bits(22, 17_408),
    bits(30, 4_211_712),
  ])
  alignWithZeroPadding(reader)
  const sectionOffset = reader.bitPosition >>> 3
  if (sectionLength < 1 || sectionOffset + sectionLength > codestream.byteLength) {
    throw invalidInput('JPEG XL frame section extent is invalid')
  }
  return Object.freeze({
    width,
    height,
    bitDepth,
    alphaBitDepth,
    orientation: 1,
    sectionOffset,
    sectionLength,
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
      if (predictor > 13 || multiplierLog >= 31) {
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
    if (property > 3) {
      throw unsupportedOperation('JPEG XL adaptive Modular tree properties are not supported')
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

interface ModularProgram {
  readonly nodes: readonly ModularNode[]
  readonly rctBegin: number
  readonly rctType: number
}

const readModularProgram = (section: Uint8Array): ModularProgram => {
  const reader = new JpegXlBitReader(section)
  requireValue(reader.readBits(1) !== 0, true, 'custom DC quantization')
  requireValue(reader.readBits(1) !== 0, true, 'missing global Modular tree')
  const tree = readTree(reader)
  const pixelCode = readJpegXlEntropyCode(reader, tree.leaves)
  requireValue(pixelCode.lz77.enabled, false, 'LZ77-coded Modular residuals')
  if (!pixelCode.huffmanCodes) {
    throw unsupportedOperation('JPEG XL ANS-coded Modular residuals are not supported')
  }
  requireValue(reader.readBits(1) !== 0, true, 'local Modular trees')
  requireValue(reader.readBits(1) !== 0, true, 'custom weighted predictor parameters')
  requireValue(
    readU32(reader, [value(0), value(1), bits(4, 2), bits(8, 18)]),
    1,
    'Modular transform count',
  )
  requireValue(
    readU32(reader, [value(0), value(1), value(2), value(3)]),
    0,
    'non-RCT Modular transforms',
  )
  const rctBegin = readU32(reader, [bits(3), bits(6, 8), bits(10, 72), bits(13, 1_096)])
  const rctType = readU32(reader, [value(6), bits(2), bits(4, 2), bits(6, 10)])
  if (rctBegin + 2 >= 4 || rctType >= 42) throw invalidInput('JPEG XL RCT parameters are invalid')

  const pixelSymbols = new JpegXlEntropySymbolReader(pixelCode)
  for (let context = 0; context < tree.leaves; context += 1) {
    const before = reader.bitPosition
    if (pixelSymbols.readHybridUint(context, reader) !== 0 || reader.bitPosition !== before) {
      throw unsupportedOperation('JPEG XL nonzero Modular residuals are not supported')
    }
  }
  if (!pixelSymbols.hasValidFinalState()) {
    throw invalidInput('JPEG XL Modular residual ANS state is invalid')
  }
  if (reader.remainingBits > 0 && reader.readBits(reader.remainingBits) !== 0) {
    throw invalidInput('JPEG XL Modular section padding is nonzero')
  }
  for (const node of tree.nodes) {
    if (node.kind === 'leaf' && (node.predictor > 2 || node.multiplier !== 1)) {
      throw unsupportedOperation('JPEG XL Modular predictor is not supported')
    }
  }
  return Object.freeze({ nodes: tree.nodes, rctBegin, rctType })
}

const treeLeaf = (
  nodes: readonly ModularNode[],
  channel: number,
  x: number,
  y: number,
): ModularLeaf => {
  const properties = [channel, 0, y, x]
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

const inverseRct = (
  firstInput: number,
  secondInput: number,
  thirdInput: number,
  type: number,
): readonly [number, number, number] => {
  if (type === 0) return [firstInput, secondInput, thirdInput]
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
  const output = [0, 0, 0]
  output[permutation % 3] = first
  output[(permutation + 1 + Math.floor(permutation / 3)) % 3] = second
  output[(permutation + 2 - Math.floor(permutation / 3)) % 3] = third
  return [output[0] ?? 0, output[1] ?? 0, output[2] ?? 0]
}

const toByte = (sample: number, bitDepth: number): number => {
  const maximum = 2 ** bitDepth - 1
  return Math.round((Math.max(0, Math.min(maximum, sample)) * 255) / maximum)
}

class JpegXlModularDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #header: JpegXlHeader
  readonly #program: ModularProgram

  constructor(header: JpegXlHeader, program: ModularProgram) {
    this.width = header.width
    this.height = header.height
    this.#header = header
    this.#program = program
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
    let previous = Array.from({ length: 4 }, () => new Int32Array(this.width))
    let current = Array.from({ length: 4 }, () => new Int32Array(this.width))
    for (let y = 0; y < regionY + regionHeight; y += 1) {
      throwIfAborted(request.signal)
      for (let channel = 0; channel < 4; channel += 1) {
        const row = current[channel]
        const top = previous[channel]
        if (!row || !top) throw invalidInput('JPEG XL channel buffer is missing')
        for (let x = 0; x < this.width; x += 1) {
          const leaf = treeLeaf(this.#program.nodes, channel, x, y)
          const prediction =
            leaf.predictor === 1 ? (row[x - 1] ?? 0) : leaf.predictor === 2 ? (top[x] ?? 0) : 0
          row[x] = prediction + leaf.offset
        }
      }
      const output = new Uint8Array(regionWidth * 4)
      const alpha = current[3]
      if (!alpha) throw invalidInput('JPEG XL alpha channel is missing')
      for (let localX = 0; localX < regionWidth; localX += 1) {
        const x = regionX + localX
        const transformed = inverseRct(
          current[0]?.[x] ?? 0,
          current[1]?.[x] ?? 0,
          current[2]?.[x] ?? 0,
          this.#program.rctType,
        )
        const target = localX * 4
        output[target] = toByte(transformed[0], this.#header.bitDepth)
        output[target + 1] = toByte(transformed[1], this.#header.bitDepth)
        output[target + 2] = toByte(transformed[2], this.#header.bitDepth)
        output[target + 3] = toByte(alpha[x] ?? 0, this.#header.alphaBitDepth)
      }
      if (y >= regionY) {
        yield {
          x: 0,
          y: y - regionY,
          width: regionWidth,
          height: 1,
          stride: output.byteLength,
          format: 'rgba8',
          data: output,
        }
      }
      const swap = previous
      previous = current
      current = swap
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
    hasAlpha: true,
    orientation: header.orientation,
    colorSpace: 'srgb',
    bitDepth: header.bitDepth,
    sampleFormat: 'unsigned-integer',
    frames: 1,
    components: 4,
    channels: 4,
    channelBitDepths: Object.freeze([
      header.bitDepth,
      header.bitDepth,
      header.bitDepth,
      header.alphaBitDepth,
    ]),
    lossless: true,
  })

export const readJpegXlCodestreamMetadata = (
  codestream: Uint8Array,
  limits: ImageLimits,
): ImageMetadata => metadataForHeader(readHeader(codestream, limits))

export const decodeJpegXlCodestream = (
  codestream: Uint8Array,
  limits: ImageLimits,
): JpegXlDecodedDescription => {
  const header = readHeader(codestream, limits)
  const section = codestream.subarray(
    header.sectionOffset,
    header.sectionOffset + header.sectionLength,
  )
  const program = readModularProgram(section)
  return Object.freeze({
    metadata: metadataForHeader(header),
    decoder: new JpegXlModularDecoder(header, program),
  })
}
