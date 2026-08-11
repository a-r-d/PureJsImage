import { throwIfAborted } from '../abort.ts'
import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { AvifEncodeOptions, Background } from '../pipeline.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { Av1CoefficientEncoder } from './av1-coeff-encode.ts'
import { Av1SymbolEncoder } from './av1-symbol-encode.ts'

const probabilityTop = 1 << 15
const maximumTileWidth = 4096
const maximumTileArea = 4096 * 2304
const yModeDcDefaults = [
  15588, 17027, 19338, 20218, 20682, 21110, 21825, 23244, 24189, 28165, 29093, 30466, 32768, 0,
] as const
const uvModeDcDefaults = [
  10407, 11208, 12900, 13181, 13823, 14175, 14899, 15656, 15986, 20086, 20995, 22455, 24212, 32768,
  0,
] as const
const skipDefaults = [31671, 32768, 0] as const
const allZeroQ0Defaults = [
  31849, 5892, 12112, 21935, 20289, 27473, 32487, 7654, 19473, 29984, 9961, 30242, 32117,
] as const
const partitionDefaults = new Map<number, readonly (readonly number[])[]>([
  [
    8,
    [
      [19132, 25510, 30392, 32768, 0],
      [13928, 19855, 28540, 32768, 0],
      [12522, 23679, 28629, 32768, 0],
      [9896, 18783, 25853, 32768, 0],
    ],
  ],
  [
    16,
    [
      [15597, 20929, 24571, 26706, 27664, 28821, 29601, 30571, 31902, 32768, 0],
      [7925, 11043, 16785, 22470, 23971, 25043, 26651, 28701, 29834, 32768, 0],
      [5414, 13269, 15111, 20488, 22360, 24500, 25537, 26336, 32117, 32768, 0],
      [2662, 6362, 8614, 20860, 23053, 24778, 26436, 27829, 31171, 32768, 0],
    ],
  ],
  [
    32,
    [
      [18462, 20920, 23124, 27647, 28227, 29049, 29519, 30178, 31544, 32768, 0],
      [7689, 9060, 12056, 24992, 25660, 26182, 26951, 28041, 29052, 32768, 0],
      [6015, 9009, 10062, 24544, 25409, 26545, 27071, 27526, 32047, 32768, 0],
      [1394, 2208, 2796, 28614, 29061, 29466, 29840, 30185, 31899, 32768, 0],
    ],
  ],
  [
    64,
    [
      [20137, 21547, 23078, 29566, 29837, 30261, 30524, 30892, 31724, 32768, 0],
      [6732, 7490, 9497, 27944, 28250, 28515, 28969, 29630, 30104, 32768, 0],
      [5945, 7663, 8348, 28683, 29117, 29749, 30064, 30298, 32238, 32768, 0],
      [870, 1212, 1487, 31198, 31394, 31574, 31743, 31881, 32332, 32768, 0],
    ],
  ],
])

class BitWriter {
  #bytes = new Uint8Array(32)
  #position = 0

  write(value: number, bits: number): void {
    if (!Number.isSafeInteger(bits) || bits < 0 || bits > 32) {
      throw invalidInput(`Invalid AV1 bit width: ${bits}`)
    }
    if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** bits) {
      throw invalidInput(`AV1 value does not fit in ${bits} bits`)
    }
    this.#ensure(this.#position + bits)
    for (let bit = bits - 1; bit >= 0; bit -= 1) {
      const position = this.#position
      if (((value / 2 ** bit) & 1) !== 0) {
        this.#bytes[position >>> 3] =
          (this.#bytes[position >>> 3] ?? 0) | (1 << (7 - (position & 7)))
      }
      this.#position += 1
    }
  }

  trailingBits(): void {
    this.write(1, 1)
    this.align()
  }

  align(): void {
    const remainder = this.#position & 7
    if (remainder !== 0) this.write(0, 8 - remainder)
  }

  finish(): Uint8Array {
    if ((this.#position & 7) !== 0) throw invalidInput('AV1 bit writer is not byte-aligned')
    return this.#bytes.slice(0, this.#position >>> 3)
  }

  #ensure(bits: number): void {
    const bytes = Math.ceil(bits / 8)
    if (bytes <= this.#bytes.length) return
    let length = this.#bytes.length
    while (length < bytes) length *= 2
    const grown = new Uint8Array(length)
    grown.set(this.#bytes)
    this.#bytes = grown
  }
}

const cdf = (values: readonly number[]): Uint16Array => new Uint16Array(values)
const bytes32 = (value: number): Uint8Array =>
  Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255)
const ascii = (value: string): Uint8Array =>
  Uint8Array.from(value, (character) => character.charCodeAt(0))

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  let length = 0
  for (const part of parts) length += part.byteLength
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const box = (type: string, ...payloads: readonly Uint8Array[]): Uint8Array => {
  let payloadLength = 0
  for (const payload of payloads) payloadLength += payload.byteLength
  const size = payloadLength + 8
  if (size > 0xffff_ffff) throw limitExceeded(`AVIF ${type} box exceeds 32-bit size`)
  return concatenate([bytes32(size), ascii(type), ...payloads])
}

const fullBox = (type: string, payload: Uint8Array, version = 0, flags = 0): Uint8Array =>
  box(type, Uint8Array.of(version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255), payload)

const leb128 = (value: number): Uint8Array => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw invalidInput('AV1 OBU length is invalid')
  }
  const bytes: number[] = []
  let remaining = value
  do {
    const next = remaining % 128
    remaining = Math.floor(remaining / 128)
    bytes.push(next | (remaining > 0 ? 0x80 : 0))
  } while (remaining > 0)
  return Uint8Array.from(bytes)
}

const obu = (type: number, payload: Uint8Array): Uint8Array =>
  concatenate([Uint8Array.of((type << 3) | 2), leb128(payload.byteLength), payload])

const bitWidth = (value: number): number => Math.max(1, Math.ceil(Math.log2(value)))

const sequenceHeader = (width: number, height: number): Uint8Array => {
  const writer = new BitWriter()
  const widthBits = bitWidth(width)
  const heightBits = bitWidth(height)
  writer.write(0, 3)
  writer.write(1, 1)
  writer.write(1, 1)
  writer.write(0, 5)
  writer.write(widthBits - 1, 4)
  writer.write(heightBits - 1, 4)
  writer.write(width - 1, widthBits)
  writer.write(height - 1, heightBits)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(1, 1)
  writer.write(1, 8)
  writer.write(13, 8)
  writer.write(1, 8)
  writer.write(1, 1)
  writer.write(0, 2)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.trailingBits()
  return writer.finish()
}

const frameHeader = (width: number, height: number): Uint8Array => {
  const writer = new BitWriter()
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  const superblockColumns = Math.ceil(width / 64)
  const superblockRows = Math.ceil(height / 64)
  writer.write(1, 1)
  if (superblockColumns > 1) writer.write(0, 1)
  if (superblockRows > 1) writer.write(0, 1)
  writer.write(0, 8)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.write(0, 1)
  writer.align()
  return writer.finish()
}

const edgePartitionCdf = (
  partitionCdf: Uint16Array,
  size: number,
  direction: 'horizontal' | 'vertical',
): Uint16Array => {
  const probability = (symbol: number): number =>
    (partitionCdf[symbol] ?? 0) - (partitionCdf[symbol - 1] ?? 0)
  const splitProbability =
    direction === 'horizontal'
      ? probability(2) +
        probability(3) +
        probability(4) +
        probability(6) +
        probability(7) +
        (size === 128 ? 0 : probability(9))
      : probability(1) +
        probability(3) +
        probability(4) +
        probability(5) +
        probability(6) +
        (size === 128 ? 0 : probability(8))
  return cdf([probabilityTop - splitProbability, probabilityTop, 0])
}

const inverseWht4 = (
  input: Int32Array,
  inputOffset: number,
  inputStride: number,
  output: Int32Array,
  outputOffset: number,
  outputStride: number,
): void => {
  let a = input[inputOffset] ?? 0
  let c = input[inputOffset + inputStride] ?? 0
  let d = input[inputOffset + inputStride * 2] ?? 0
  let b = input[inputOffset + inputStride * 3] ?? 0
  a += c
  d -= b
  const e = (a - d) >> 1
  b = e - b
  c = e - c
  a -= b
  d += c
  output[outputOffset] = a
  output[outputOffset + outputStride] = b
  output[outputOffset + outputStride * 2] = c
  output[outputOffset + outputStride * 3] = d
}

const forwardLossless4x4 = (
  residual: Int32Array,
  intermediate: Int32Array,
  output: Int32Array,
): void => {
  for (let row = 0; row < 4; row += 1) {
    inverseWht4(residual, row * 4, 1, intermediate, row * 4, 1)
  }
  for (let column = 0; column < 4; column += 1) {
    inverseWht4(intermediate, column, 4, output, column, 4)
  }
}

interface Av1Planes {
  readonly y: Uint8Array
  readonly u: Uint8Array
  readonly v: Uint8Array
  readonly yStride: number
  readonly yHeight: number
  readonly chromaStride: number
  readonly chromaHeight: number
}

class ConstrainedAv1Encoder {
  readonly #target: Av1Planes
  readonly #reconstruction: Av1Planes
  readonly #miColumns: number
  readonly #miRows: number
  readonly #symbols = new Av1SymbolEncoder()
  readonly #coefficients = new Av1CoefficientEncoder(this.#symbols, 0)
  readonly #partitionCdfs = new Map<string, Uint16Array>()
  readonly #skipCdf = cdf(skipDefaults)
  readonly #yModeCdf = cdf(yModeDcDefaults)
  readonly #uvModeCdf = cdf(uvModeDcDefaults)
  readonly #allZeroCdfs = allZeroQ0Defaults.map((probability) =>
    cdf([probability, probabilityTop, 0]),
  )
  readonly #blockWidths: Uint8Array
  readonly #blockHeights: Uint8Array
  readonly #lumaLevels: Uint8Array
  readonly #lumaDc: Uint8Array
  readonly #chromaLevels: readonly [Uint8Array, Uint8Array]
  readonly #chromaDc: readonly [Uint8Array, Uint8Array]
  readonly #residual = new Int32Array(16)
  readonly #transformIntermediate = new Int32Array(16)
  readonly #transformCoefficients = new Int32Array(16)

  constructor(target: Av1Planes) {
    this.#target = target
    this.#reconstruction = {
      y: new Uint8Array(target.y.byteLength),
      u: new Uint8Array(target.u.byteLength),
      v: new Uint8Array(target.v.byteLength),
      yStride: target.yStride,
      yHeight: target.yHeight,
      chromaStride: target.chromaStride,
      chromaHeight: target.chromaHeight,
    }
    this.#miColumns = target.yStride >> 2
    this.#miRows = target.yHeight >> 2
    const lumaContexts = this.#miColumns * this.#miRows
    const chromaContexts = (this.#miColumns >> 1) * (this.#miRows >> 1)
    this.#blockWidths = new Uint8Array(lumaContexts)
    this.#blockHeights = new Uint8Array(lumaContexts)
    this.#lumaLevels = new Uint8Array(lumaContexts)
    this.#lumaDc = new Uint8Array(lumaContexts)
    this.#chromaLevels = [new Uint8Array(chromaContexts), new Uint8Array(chromaContexts)]
    this.#chromaDc = [new Uint8Array(chromaContexts), new Uint8Array(chromaContexts)]
  }

  finish(width: number, height: number): Uint8Array {
    for (let row = 0; row < this.#miRows; row += 16) {
      for (let column = 0; column < this.#miColumns; column += 16) {
        this.#encodePartition(row, column, 64)
      }
    }
    const tile = this.#symbols.finish()
    const frame = concatenate([frameHeader(width, height), tile])
    return concatenate([obu(1, sequenceHeader(width, height)), obu(6, frame)])
  }

  #encodePartition(row: number, column: number, size: number): void {
    if (row >= this.#miRows || column >= this.#miColumns) return
    const halfMi = size >> 3
    const hasRows = row + halfMi < this.#miRows
    const hasColumns = column + halfMi < this.#miColumns
    if (size >= 8) {
      const above = row > 0 && (this.#blockWidths[(row - 1) * this.#miColumns + column] ?? 0) < size
      const left =
        column > 0 && (this.#blockHeights[row * this.#miColumns + column - 1] ?? 0) < size
      const context = Number(left) * 2 + Number(above)
      const key = `${size}:${context}`
      let partitionCdf = this.#partitionCdfs.get(key)
      if (!partitionCdf) {
        const defaults = partitionDefaults.get(size)?.[context]
        if (!defaults) throw unsupportedOperation(`Unsupported AV1 partition size ${size}`)
        partitionCdf = cdf(defaults)
        this.#partitionCdfs.set(key, partitionCdf)
      }
      if (hasRows && hasColumns) this.#symbols.writeSymbol(partitionCdf, 3)
      else if (hasColumns) {
        this.#symbols.writeSymbol(edgePartitionCdf(partitionCdf, size, 'horizontal'), 1)
      } else if (hasRows) {
        this.#symbols.writeSymbol(edgePartitionCdf(partitionCdf, size, 'vertical'), 1)
      }
    }
    if (size === 8) {
      this.#encodeBlock(row, column)
      this.#encodeBlock(row, column + 1)
      this.#encodeBlock(row + 1, column)
      this.#encodeBlock(row + 1, column + 1)
      return
    }
    const half = size >> 1
    this.#encodePartition(row, column, half)
    this.#encodePartition(row, column + halfMi, half)
    this.#encodePartition(row + halfMi, column, half)
    this.#encodePartition(row + halfMi, column + halfMi, half)
  }

  #encodeBlock(row: number, column: number): void {
    if (row >= this.#miRows || column >= this.#miColumns) return
    this.#symbols.writeSymbol(this.#skipCdf, 0)
    this.#symbols.writeSymbol(this.#yModeCdf, 0)
    const hasChroma = (row & 1) === 1 && (column & 1) === 1
    if (hasChroma) this.#symbols.writeSymbol(this.#uvModeCdf, 0)
    this.#encodePlane(0, row, column)
    if (hasChroma) {
      this.#encodePlane(1, row >> 1, column >> 1)
      this.#encodePlane(2, row >> 1, column >> 1)
    }
    const context = row * this.#miColumns + column
    this.#blockWidths[context] = 4
    this.#blockHeights[context] = 4
  }

  #encodePlane(plane: 0 | 1 | 2, row: number, column: number): void {
    const target = plane === 0 ? this.#target.y : plane === 1 ? this.#target.u : this.#target.v
    const reconstructed =
      plane === 0
        ? this.#reconstruction.y
        : plane === 1
          ? this.#reconstruction.u
          : this.#reconstruction.v
    const stride = plane === 0 ? this.#target.yStride : this.#target.chromaStride
    const rows = plane === 0 ? this.#miRows : this.#miRows >> 1
    const columns = plane === 0 ? this.#miColumns : this.#miColumns >> 1
    const levels =
      plane === 0 ? this.#lumaLevels : plane === 1 ? this.#chromaLevels[0] : this.#chromaLevels[1]
    const dc = plane === 0 ? this.#lumaDc : plane === 1 ? this.#chromaDc[0] : this.#chromaDc[1]
    const x = column * 4
    const y = row * 4
    let prediction = 128
    if (row > 0 || column > 0) {
      let sum = 0
      let count = 0
      if (row > 0) {
        const above = (y - 1) * stride + x
        for (let local = 0; local < 4; local += 1) sum += reconstructed[above + local] ?? 128
        count += 4
      }
      if (column > 0) {
        for (let local = 0; local < 4; local += 1) {
          sum += reconstructed[(y + local) * stride + x - 1] ?? 128
        }
        count += 4
      }
      prediction = Math.floor((sum + (count >> 1)) / count)
    }
    const residual = this.#residual
    let nonzero = false
    for (let localY = 0; localY < 4; localY += 1) {
      for (let localX = 0; localX < 4; localX += 1) {
        const targetIndex = (y + localY) * stride + x + localX
        const value = target[targetIndex] ?? 0
        const difference = value - prediction
        residual[localY * 4 + localX] = difference
        if (difference !== 0) nonzero = true
        reconstructed[targetIndex] = value
      }
    }
    let aboveLevel = 0
    let leftLevel = 0
    let dcSign = 0
    if (row > 0) {
      const context = (row - 1) * columns + column
      aboveLevel = levels[context] ?? 0
      const category = dc[context] ?? 0
      dcSign += category === 1 ? -1 : category === 2 ? 1 : 0
    }
    if (column > 0) {
      const context = row * columns + column - 1
      leftLevel = levels[context] ?? 0
      const category = dc[context] ?? 0
      dcSign += category === 1 ? -1 : category === 2 ? 1 : 0
    }
    const zeroContext = plane === 0 ? 0 : 7 + Number(aboveLevel !== 0) + Number(leftLevel !== 0)
    const zeroCdf = this.#allZeroCdfs[zeroContext]
    if (!zeroCdf) throw invalidInput('AV1 all-zero coefficient context is invalid')
    this.#symbols.writeSymbol(zeroCdf, nonzero ? 0 : 1)
    const context = row * columns + column
    if (!nonzero) {
      levels[context] = 0
      dc[context] = 0
      return
    }
    forwardLossless4x4(residual, this.#transformIntermediate, this.#transformCoefficients)
    const result = this.#coefficients.write(
      plane,
      4,
      4,
      0,
      this.#transformCoefficients,
      dcSign < 0 ? 1 : dcSign > 0 ? 2 : 0,
    )
    levels[context] = result.levelContext
    dc[context] = result.dcCategory
    if (row >= rows || column >= columns) throw invalidInput('AV1 coefficient context overflow')
  }
}

const parseBackground = (background: Background | undefined): readonly [number, number, number] => {
  if (background === undefined) return [255, 255, 255]
  if (background === 'transparent') {
    throw invalidInput('AVIF opaque output requires a solid #RRGGBB or #RRGGBBAA background')
  }
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(background)
  if (!match?.[1]) throw invalidInput('AVIF background must be #RRGGBB or #RRGGBBAA')
  const value = Number.parseInt(match[1], 16)
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255]
}

const isBackground = (value: string): value is Background =>
  value === 'transparent' || /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)

const resolveOptions = (value: unknown): Readonly<AvifEncodeOptions> => {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidInput('AVIF encoder options must be an object')
  }
  const background = 'background' in value ? value.background : undefined
  if (background !== undefined && typeof background !== 'string') {
    throw invalidInput('AVIF background must be a string')
  }
  if (background === undefined) return {}
  if (isBackground(background)) return { background }
  throw invalidInput('AVIF background must be transparent, #RRGGBB, or #RRGGBBAA')
}

const channelsFor = (format: PixelFormat): 1 | 3 | 4 => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  throw unsupportedOperation(`AVIF encoding does not support ${format} pixels`)
}

const avifMetadata = (
  width: number,
  height: number,
  itemOffset: number,
  itemLength: number,
): Uint8Array => {
  const handler = fullBox(
    'hdlr',
    concatenate([
      bytes32(0),
      ascii('pict'),
      new Uint8Array(12),
      ascii('PureJsImage'),
      Uint8Array.of(0),
    ]),
  )
  const primaryItem = fullBox('pitm', Uint8Array.of(0, 1))
  const itemInfoEntry = fullBox(
    'infe',
    concatenate([Uint8Array.of(0, 1, 0, 0), ascii('av01'), ascii('Color'), Uint8Array.of(0)]),
    2,
  )
  const itemInfo = fullBox('iinf', concatenate([Uint8Array.of(0, 1), itemInfoEntry]))
  const location = fullBox(
    'iloc',
    concatenate([
      Uint8Array.of(0x44, 0, 0, 1, 0, 1, 0, 0, 0, 1),
      bytes32(itemOffset),
      bytes32(itemLength),
    ]),
  )
  const properties = box(
    'iprp',
    box(
      'ipco',
      fullBox('ispe', concatenate([bytes32(width), bytes32(height)])),
      fullBox('pixi', Uint8Array.of(3, 8, 8, 8)),
      box('av1C', Uint8Array.of(0x81, 0, 0x0c, 0)),
      box('colr', concatenate([ascii('nclx'), Uint8Array.of(0, 1, 0, 13, 0, 1, 0x80)])),
    ),
    fullBox('ipma', concatenate([bytes32(1), Uint8Array.of(0, 1, 4, 1, 2, 3, 4)])),
  )
  return fullBox('meta', concatenate([handler, primaryItem, location, itemInfo, properties]))
}

const fileType = box(
  'ftyp',
  concatenate([
    ascii('avif'),
    bytes32(0),
    ascii('avif'),
    ascii('mif1'),
    ascii('miaf'),
    ascii('MA1B'),
  ]),
)

class AvifEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #channels: 1 | 3 | 4
  readonly #background: readonly [number, number, number]
  readonly #signal: AbortSignal | undefined
  readonly #planes: Av1Planes
  readonly #chromaSumU: Float64Array
  readonly #chromaSumV: Float64Array
  readonly #chromaCounts: Uint8Array
  #receivedRows = 0
  #chromaRows = 0
  #finished = false

  constructor(sink: ImageSink, request: EncodeRequest, options: Readonly<AvifEncodeOptions>) {
    this.#sink = sink
    this.#width = request.width
    this.#height = request.height
    this.#format = request.pixelFormat
    this.#channels = channelsFor(request.pixelFormat)
    this.#background = parseBackground(options.background)
    this.#signal = request.signal
    const paddedTileArea = Math.ceil(request.width / 64) * Math.ceil(request.height / 64) * 64 * 64
    if (request.width > maximumTileWidth || paddedTileArea > maximumTileArea) {
      throw unsupportedOperation(
        `Constrained AVIF encoding supports one tile up to ${maximumTileWidth}px wide and ${maximumTileArea} padded pixels`,
      )
    }
    const yStride = Math.ceil(request.width / 8) * 8
    const yHeight = Math.ceil(request.height / 8) * 8
    const chromaStride = yStride >> 1
    const chromaHeight = yHeight >> 1
    const workingBytes = yStride * yHeight * 2 + chromaStride * chromaHeight * 4
    if (request.limits && workingBytes > request.limits.maxDecodedBytes) {
      throw limitExceeded(
        `AVIF encoder working set is ${workingBytes} bytes; maxDecodedBytes is ${request.limits.maxDecodedBytes}`,
      )
    }
    this.#planes = {
      y: new Uint8Array(yStride * yHeight),
      u: new Uint8Array(chromaStride * chromaHeight),
      v: new Uint8Array(chromaStride * chromaHeight),
      yStride,
      yHeight,
      chromaStride,
      chromaHeight,
    }
    this.#chromaSumU = new Float64Array(chromaStride)
    this.#chromaSumV = new Float64Array(chromaStride)
    this.#chromaCounts = new Uint8Array(chromaStride)
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished AVIF encoder')
    throwIfAborted(this.#signal)
    if (
      block.x !== 0 ||
      block.y !== this.#receivedRows ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.y + block.height > this.#height ||
      block.format !== this.#format
    ) {
      throw invalidInput('AVIF encoder requires ordered, full-width pixel blocks')
    }
    const rowBytes = this.#width * this.#channels
    if (
      block.stride < rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + rowBytes
    ) {
      throw invalidInput('AVIF encoder pixel block data is truncated')
    }
    for (let localRow = 0; localRow < block.height; localRow += 1) {
      this.#appendRow(block.data, localRow * block.stride)
      this.#receivedRows += 1
    }
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('AVIF encoder is already finished')
    this.#finished = true
    throwIfAborted(this.#signal)
    if (this.#receivedRows !== this.#height) {
      throw invalidInput(`AVIF encoder received ${this.#receivedRows} of ${this.#height} rows`)
    }
    if ((this.#height & 1) === 1) this.#flushChromaRow()
    this.#padPlanes()
    const av1 = new ConstrainedAv1Encoder(this.#planes).finish(this.#width, this.#height)
    const provisionalMetadata = avifMetadata(this.#width, this.#height, 0, av1.byteLength)
    const itemOffset = fileType.byteLength + provisionalMetadata.byteLength + 8
    const metadata = avifMetadata(this.#width, this.#height, itemOffset, av1.byteLength)
    await this.#sink.write(fileType)
    await this.#sink.write(metadata)
    await this.#sink.write(concatenate([bytes32(av1.byteLength + 8), ascii('mdat')]))
    await this.#sink.write(av1)
  }

  async abort(): Promise<void> {
    this.#finished = true
  }

  #appendRow(source: Uint8Array, sourceOffset: number): void {
    const yOffset = this.#receivedRows * this.#planes.yStride
    for (let x = 0; x < this.#width; x += 1) {
      const pixel = sourceOffset + x * this.#channels
      let red: number
      let green: number
      let blue: number
      if (this.#format === 'gray8') {
        red = source[pixel] ?? 0
        green = red
        blue = red
      } else {
        red = source[pixel] ?? 0
        green = source[pixel + 1] ?? 0
        blue = source[pixel + 2] ?? 0
        if (this.#format === 'rgba8') {
          const alpha = source[pixel + 3] ?? 0
          const inverse = 255 - alpha
          red = Math.round((red * alpha + this.#background[0] * inverse) / 255)
          green = Math.round((green * alpha + this.#background[1] * inverse) / 255)
          blue = Math.round((blue * alpha + this.#background[2] * inverse) / 255)
        }
      }
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
      this.#planes.y[yOffset + x] = Math.max(0, Math.min(255, Math.round(luma)))
      const chroma = x >> 1
      this.#chromaSumU[chroma] = (this.#chromaSumU[chroma] ?? 0) + 128 + (blue - luma) / 1.8556
      this.#chromaSumV[chroma] = (this.#chromaSumV[chroma] ?? 0) + 128 + (red - luma) / 1.5748
      this.#chromaCounts[chroma] = (this.#chromaCounts[chroma] ?? 0) + 1
    }
    const last = this.#planes.y[yOffset + this.#width - 1] ?? 0
    this.#planes.y.fill(last, yOffset + this.#width, yOffset + this.#planes.yStride)
    if ((this.#receivedRows & 1) === 1) this.#flushChromaRow()
  }

  #flushChromaRow(): void {
    const offset = this.#chromaRows * this.#planes.chromaStride
    const width = Math.ceil(this.#width / 2)
    for (let x = 0; x < width; x += 1) {
      const count = this.#chromaCounts[x] ?? 0
      if (count === 0) throw invalidInput('AVIF chroma accumulator is empty')
      this.#planes.u[offset + x] = Math.max(
        0,
        Math.min(255, Math.round((this.#chromaSumU[x] ?? 0) / count)),
      )
      this.#planes.v[offset + x] = Math.max(
        0,
        Math.min(255, Math.round((this.#chromaSumV[x] ?? 0) / count)),
      )
    }
    const lastU = this.#planes.u[offset + width - 1] ?? 128
    const lastV = this.#planes.v[offset + width - 1] ?? 128
    this.#planes.u.fill(lastU, offset + width, offset + this.#planes.chromaStride)
    this.#planes.v.fill(lastV, offset + width, offset + this.#planes.chromaStride)
    this.#chromaSumU.fill(0)
    this.#chromaSumV.fill(0)
    this.#chromaCounts.fill(0)
    this.#chromaRows += 1
  }

  #padPlanes(): void {
    const lastY = (this.#height - 1) * this.#planes.yStride
    for (let row = this.#height; row < this.#planes.yHeight; row += 1) {
      this.#planes.y.set(
        this.#planes.y.subarray(lastY, lastY + this.#planes.yStride),
        row * this.#planes.yStride,
      )
    }
    const lastChroma = (this.#chromaRows - 1) * this.#planes.chromaStride
    for (let row = this.#chromaRows; row < this.#planes.chromaHeight; row += 1) {
      const target = row * this.#planes.chromaStride
      this.#planes.u.set(
        this.#planes.u.subarray(lastChroma, lastChroma + this.#planes.chromaStride),
        target,
      )
      this.#planes.v.set(
        this.#planes.v.subarray(lastChroma, lastChroma + this.#planes.chromaStride),
        target,
      )
    }
  }
}

export const createAvifEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => new AvifEncoder(sink, request, resolveOptions(request.options))
