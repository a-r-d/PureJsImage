import { throwIfAborted } from '../abort.ts'
import type { DecodeRequest, ImageDecoder, ImageMetadata } from '../codec.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import {
  JpegXlBitReader,
  JpegXlEntropySymbolReader,
  readJpegXlEntropyCode,
} from './jpegxl-bitstream.ts'
import type { JpegXlEntropyCode } from './jpegxl-bitstream.ts'

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
  readonly alphaBitDepth: number | undefined
  readonly channelCount: 3 | 4
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
  if (extraChannels > 1) {
    throw unsupportedOperation('JPEG XL multiple extra channels are not supported')
  }
  const channelCount = extraChannels === 0 ? 3 : 4
  const planeBytes = BigInt(width) * BigInt(height) * BigInt(channelCount) * 4n
  if (planeBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `JPEG XL Modular working planes require ${planeBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }
  let alphaBitDepth: number | undefined
  if (extraChannels === 1) {
    requireValue(reader.readBits(1) !== 0, false, 'default extra-channel metadata')
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
    channelCount,
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
    if (property > 14) {
      throw unsupportedOperation(
        'JPEG XL weighted or previous-channel Modular tree properties are not supported',
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

interface ModularProgram {
  readonly nodes: readonly ModularNode[]
  readonly rctBegin: number
  readonly rctType: number
  readonly section: Uint8Array
  readonly residualBitPosition: number
  readonly pixelCode: JpegXlEntropyCode
}

const readModularProgram = (section: Uint8Array, channelCount: 3 | 4): ModularProgram => {
  const reader = new JpegXlBitReader(section)
  requireValue(reader.readBits(1) !== 0, true, 'custom DC quantization')
  const hasGlobalTree = reader.readBits(1) !== 0
  const globalTree = hasGlobalTree ? readTree(reader) : undefined
  const globalPixelCode = globalTree ? readJpegXlEntropyCode(reader, globalTree.leaves) : undefined
  const useGlobalTree = reader.readBits(1) !== 0
  if (useGlobalTree && (!globalTree || !globalPixelCode)) {
    throw invalidInput('JPEG XL Modular group references a missing global tree')
  }
  requireValue(reader.readBits(1) !== 0, true, 'custom weighted predictor parameters')
  const transformCount = readU32(reader, [value(0), value(1), bits(4, 2), bits(8, 18)])
  if (transformCount > 1) {
    throw unsupportedOperation('JPEG XL multiple Modular transforms are not supported')
  }
  let rctBegin = 0
  let rctType = 0
  if (transformCount === 1) {
    requireValue(
      readU32(reader, [value(0), value(1), value(2), value(3)]),
      0,
      'non-RCT Modular transforms',
    )
    rctBegin = readU32(reader, [bits(3), bits(6, 8), bits(10, 72), bits(13, 1_096)])
    rctType = readU32(reader, [value(6), bits(2), bits(4, 2), bits(6, 10)])
    if (rctBegin + 2 >= channelCount || rctType >= 42) {
      throw invalidInput('JPEG XL RCT parameters are invalid')
    }
  }
  const tree = useGlobalTree ? globalTree : readTree(reader)
  if (!tree) throw invalidInput('JPEG XL Modular tree is missing')
  const pixelCode = useGlobalTree ? globalPixelCode : readJpegXlEntropyCode(reader, tree.leaves)
  if (!pixelCode) throw invalidInput('JPEG XL Modular entropy code is missing')
  for (const node of tree.nodes) {
    if (
      node.kind === 'leaf' &&
      node.predictor !== 0 &&
      node.predictor !== 1 &&
      node.predictor !== 2 &&
      node.predictor !== 5 &&
      node.predictor !== 7 &&
      node.predictor !== 8
    ) {
      throw unsupportedOperation('JPEG XL Modular predictor is not supported')
    }
  }
  return Object.freeze({
    nodes: tree.nodes,
    rctBegin,
    rctType,
    section,
    residualBitPosition: reader.bitPosition,
    pixelCode,
  })
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

const modularPrediction = (
  predictor: number,
  left: number,
  top: number,
  topLeft: number,
  topRight: number,
): number => {
  switch (predictor) {
    case 0:
      return 0
    case 1:
      return left
    case 2:
      return top
    case 5:
      return clampedGradient(left, top, topLeft)
    case 7:
      return topRight
    case 8:
      return topLeft
    default:
      throw invalidInput('JPEG XL Modular predictor is invalid')
  }
}

const setModularProperties = (
  properties: Int32Array,
  channel: number,
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
  properties[1] = 0
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
    const pixelCount = this.width * this.height
    const planes = Array.from(
      { length: this.#header.channelCount },
      () => new Int32Array(pixelCount),
    )
    const reader = new JpegXlBitReader(this.#program.section)
    reader.skipBits(this.#program.residualBitPosition)
    const symbols = new JpegXlEntropySymbolReader(
      this.#program.pixelCode,
      pixelCount * this.#header.channelCount,
    )
    const properties = new Int32Array(15)
    for (let channel = 0; channel < this.#header.channelCount; channel += 1) {
      const plane = planes[channel]
      if (!plane) throw invalidInput('JPEG XL channel buffer is missing')
      for (let y = 0; y < this.height; y += 1) {
        throwIfAborted(request.signal)
        let previousGradient = 0
        const row = y * this.width
        const previous = row - this.width
        const beforePrevious = previous - this.width
        for (let x = 0; x < this.width; x += 1) {
          const left = x > 0 ? (plane[row + x - 1] ?? 0) : y > 0 ? (plane[previous + x] ?? 0) : 0
          const top = y > 0 ? (plane[previous + x] ?? 0) : left
          const topLeft = x > 0 && y > 0 ? (plane[previous + x - 1] ?? 0) : left
          const topRight = x + 1 < this.width && y > 0 ? (plane[previous + x + 1] ?? 0) : top
          const topTop = y > 1 ? (plane[beforePrevious + x] ?? 0) : top
          const leftLeft = x > 1 ? (plane[row + x - 2] ?? 0) : left
          previousGradient = setModularProperties(
            properties,
            channel,
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
          const leaf = treeLeaf(this.#program.nodes, properties)
          const residual = unpackSigned(symbols.readHybridUint(leaf.context, reader))
          const reconstructed =
            modularPrediction(leaf.predictor, left, top, topLeft, topRight) +
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
        }
      }
    }
    if (!symbols.hasValidFinalState()) {
      throw invalidInput('JPEG XL Modular residual ANS state is invalid')
    }
    requireZeroSectionPadding(reader)

    const firstPlane = planes[0]
    const secondPlane = planes[1]
    const thirdPlane = planes[2]
    const alphaPlane = planes[3]
    if (!firstPlane || !secondPlane || !thirdPlane) {
      throw invalidInput('JPEG XL color channel buffer is missing')
    }
    const transformed = new Int32Array(3)
    for (let y = regionY; y < regionY + regionHeight; y += 1) {
      throwIfAborted(request.signal)
      const output = new Uint8Array(regionWidth * 4)
      for (let localX = 0; localX < regionWidth; localX += 1) {
        const x = regionX + localX
        const position = y * this.width + x
        inverseRct(
          planes[this.#program.rctBegin]?.[position] ?? 0,
          planes[this.#program.rctBegin + 1]?.[position] ?? 0,
          planes[this.#program.rctBegin + 2]?.[position] ?? 0,
          this.#program.rctType,
          transformed,
        )
        let red = firstPlane[position] ?? 0
        let green = secondPlane[position] ?? 0
        let blue = thirdPlane[position] ?? 0
        let alpha = alphaPlane?.[position] ?? 0
        if (this.#program.rctBegin === 0) {
          red = transformed[0] ?? 0
          green = transformed[1] ?? 0
          blue = transformed[2] ?? 0
        } else {
          green = transformed[0] ?? 0
          blue = transformed[1] ?? 0
          alpha = transformed[2] ?? 0
        }
        const target = localX * 4
        output[target] = toByte(red, this.#header.bitDepth)
        output[target + 1] = toByte(green, this.#header.bitDepth)
        output[target + 2] = toByte(blue, this.#header.bitDepth)
        output[target + 3] =
          this.#header.alphaBitDepth === undefined ? 255 : toByte(alpha, this.#header.alphaBitDepth)
      }
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
    colorSpace: 'srgb',
    bitDepth: header.bitDepth,
    sampleFormat: 'unsigned-integer',
    frames: 1,
    components: header.channelCount,
    channels: header.channelCount,
    channelBitDepths: Object.freeze(
      header.alphaBitDepth === undefined
        ? [header.bitDepth, header.bitDepth, header.bitDepth]
        : [header.bitDepth, header.bitDepth, header.bitDepth, header.alphaBitDepth],
    ),
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
  const program = readModularProgram(section, header.channelCount)
  return Object.freeze({
    metadata: metadataForHeader(header),
    decoder: new JpegXlModularDecoder(header, program),
  })
}
