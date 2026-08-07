import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { Av1Frame } from './av1-frame.ts'
import type { Av1SequenceHeader } from './av1.ts'
import { Av1SymbolDecoder } from './av1-symbol.ts'

const cdf = (values: readonly number[]): Uint16Array => new Uint16Array(values)

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
  [
    128,
    [
      [27899, 28219, 28529, 32484, 32539, 32619, 32639, 32768, 0],
      [6607, 6990, 8268, 32060, 32219, 32338, 32371, 32768, 0],
      [5429, 6676, 7122, 32027, 32227, 32531, 32582, 32768, 0],
      [711, 966, 1172, 32448, 32538, 32617, 32664, 32768, 0],
    ],
  ],
])

const keyframeDcMode = [
  15588, 17027, 19338, 20218, 20682, 21110, 21825, 23244, 24189, 28165, 29093, 30466, 32768, 0,
] as const
const uvModeFromDc = [
  10407, 11208, 12900, 13181, 13823, 14175, 14899, 15656, 15986, 20086, 20995, 22455, 24212, 32768,
  0,
] as const
const skipDefaults = [
  [31671, 32768, 0],
  [16515, 32768, 0],
  [4576, 32768, 0],
] as const
const filterIntraDefaults = new Map<number, readonly number[]>([
  [4, [4621, 32768, 0]],
  [8, [7866, 32768, 0]],
  [16, [12551, 32768, 0]],
  [32, [22343, 32768, 0]],
])
const allZeroDefaults = [
  [31849, 32768, 0],
  [5892, 32768, 0],
  [12112, 32768, 0],
  [21935, 32768, 0],
  [20289, 32768, 0],
  [27473, 32768, 0],
  [32487, 32768, 0],
  [7654, 32768, 0],
  [19473, 32768, 0],
  [29984, 32768, 0],
  [9961, 32768, 0],
  [30242, 32768, 0],
  [32117, 32768, 0],
] as const

export interface Av1Yuv420Frame {
  readonly chromaHeight: number
  readonly chromaStride: number
  readonly chromaWidth: number
  readonly height: number
  readonly u: Uint8Array
  readonly v: Uint8Array
  readonly width: number
  readonly y: Uint8Array
  readonly yStride: number
}

interface Plane {
  readonly data: Uint8Array
  readonly height: number
  readonly stride: number
  readonly width: number
}

class RestrictedIntraTileDecoder {
  readonly #sequence: Av1SequenceHeader
  readonly #symbols: Av1SymbolDecoder
  readonly #miColumns: number
  readonly #miRows: number
  readonly #blockSizes: Uint8Array
  readonly #skips: Uint8Array
  readonly #planes: readonly [Plane, Plane, Plane]
  readonly #partitionCdfs = new Map<string, Uint16Array>()
  readonly #skipCdfs = skipDefaults.map(cdf)
  readonly #yModeCdf = cdf(keyframeDcMode)
  readonly #uvModeCdf = cdf(uvModeFromDc)
  readonly #filterCdfs = new Map<number, Uint16Array>()
  readonly #allZeroCdfs = allZeroDefaults.map(cdf)

  constructor(
    sequence: Av1SequenceHeader,
    frame: Av1Frame,
    planes: readonly [Plane, Plane, Plane],
  ) {
    const tile = frame.tiles[0]
    if (!tile || frame.tiles.length !== 1) {
      throw unsupportedOperation('Phase B2 restricted reconstruction supports one AV1 tile')
    }
    this.#sequence = sequence
    this.#symbols = new Av1SymbolDecoder(tile.data, !frame.header.disableCdfUpdate)
    this.#miColumns = 2 * ((frame.header.frameWidth + 7) >> 3)
    this.#miRows = 2 * ((frame.header.frameHeight + 7) >> 3)
    this.#blockSizes = new Uint8Array(this.#miColumns * this.#miRows)
    this.#skips = new Uint8Array(this.#miColumns * this.#miRows)
    this.#planes = planes
  }

  decode(): void {
    const superblockPixels = this.#sequence.use128x128Superblock ? 128 : 64
    const superblockMi = superblockPixels >> 2
    for (let row = 0; row < this.#miRows; row += superblockMi) {
      for (let column = 0; column < this.#miColumns; column += superblockMi) {
        this.#decodePartition(row, column, superblockPixels)
      }
    }
    this.#symbols.finish()
  }

  #decodePartition(row: number, column: number, size: number): void {
    if (row >= this.#miRows || column >= this.#miColumns) return
    const blockMi = size >> 2
    const halfMi = blockMi >> 1
    const hasRows = row + halfMi < this.#miRows
    const hasColumns = column + halfMi < this.#miColumns
    let partition = 0
    if (size >= 8 && hasRows && hasColumns) {
      const above = row > 0 && (this.#blockSizes[(row - 1) * this.#miColumns + column] ?? 0) < size
      const left = column > 0 && (this.#blockSizes[row * this.#miColumns + column - 1] ?? 0) < size
      const context = Number(left) * 2 + Number(above)
      const key = `${size}:${context}`
      let partitionCdf = this.#partitionCdfs.get(key)
      if (!partitionCdf) {
        const defaults = partitionDefaults.get(size)?.[context]
        if (!defaults) throw unsupportedOperation(`Unsupported AV1 partition size ${size}`)
        partitionCdf = cdf(defaults)
        this.#partitionCdfs.set(key, partitionCdf)
      }
      partition = this.#symbols.readSymbol(partitionCdf)
      if (partition !== 0 && partition !== 3) {
        throw unsupportedOperation('Phase B2 supports NONE and SPLIT AV1 partitions only')
      }
    } else if (size >= 8) {
      if (hasRows || hasColumns) {
        throw unsupportedOperation('Phase B2 does not yet support one-sided edge partitions')
      }
      partition = 3
    }

    if (partition === 0 || size === 4) {
      this.#decodeBlock(row, column, size)
      return
    }
    const half = size >> 1
    this.#decodePartition(row, column, half)
    this.#decodePartition(row, column + halfMi, half)
    this.#decodePartition(row + halfMi, column, half)
    this.#decodePartition(row + halfMi, column + halfMi, half)
  }

  #decodeBlock(row: number, column: number, size: number): void {
    const blockMi = size >> 2
    const aboveSkip = row > 0 ? (this.#skips[(row - 1) * this.#miColumns + column] ?? 0) : 0
    const leftSkip = column > 0 ? (this.#skips[row * this.#miColumns + column - 1] ?? 0) : 0
    const skipCdf = this.#skipCdfs[aboveSkip + leftSkip]
    if (!skipCdf) throw invalidInput('AV1 skip context is invalid')
    const skip = this.#symbols.readSymbol(skipCdf)
    const yMode = this.#symbols.readSymbol(this.#yModeCdf)
    if (yMode !== 0) throw unsupportedOperation('Phase B2 supports DC luma prediction only')

    const hasChroma = size > 4 || ((row & 1) === 1 && (column & 1) === 1)
    if (hasChroma && this.#symbols.readSymbol(this.#uvModeCdf) !== 0) {
      throw unsupportedOperation('Phase B2 supports DC chroma prediction only')
    }
    if (this.#sequence.enableFilterIntra && size <= 32) {
      let filterCdf = this.#filterCdfs.get(size)
      if (!filterCdf) {
        const defaults = filterIntraDefaults.get(size)
        if (!defaults) throw unsupportedOperation(`Unsupported AV1 filter-intra size ${size}`)
        filterCdf = cdf(defaults)
        this.#filterCdfs.set(size, filterCdf)
      }
      if (this.#symbols.readSymbol(filterCdf) !== 0) {
        throw unsupportedOperation('Phase B2 does not yet support filtered intra prediction')
      }
    }

    this.#decodePlane(0, row * 4, column * 4, size, size, skip === 1)
    if (hasChroma) {
      const chromaSize = Math.max(4, size >> 1)
      this.#decodePlane(1, (row >> 1) * 4, (column >> 1) * 4, chromaSize, chromaSize, skip === 1)
      this.#decodePlane(2, (row >> 1) * 4, (column >> 1) * 4, chromaSize, chromaSize, skip === 1)
    }

    for (let localRow = 0; localRow < blockMi; localRow += 1) {
      for (let localColumn = 0; localColumn < blockMi; localColumn += 1) {
        const target = (row + localRow) * this.#miColumns + column + localColumn
        if (row + localRow < this.#miRows && column + localColumn < this.#miColumns) {
          this.#blockSizes[target] = size
          this.#skips[target] = skip
        }
      }
    }
  }

  #decodePlane(
    planeIndex: 0 | 1 | 2,
    startY: number,
    startX: number,
    width: number,
    height: number,
    skip: boolean,
  ): void {
    const plane = this.#planes[planeIndex]
    const residualLargerThanTransform = width > 4 || height > 4
    const zeroContext =
      planeIndex === 0
        ? residualLargerThanTransform
          ? 1
          : 0
        : 7 + (residualLargerThanTransform ? 3 : 0)
    const zeroCdf = this.#allZeroCdfs[zeroContext]
    if (!zeroCdf) throw invalidInput('AV1 all-zero coefficient context is invalid')
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        this.#predictDc(plane, startX + x, startY + y, 4, 4)
        if (!skip && this.#symbols.readSymbol(zeroCdf) !== 1) {
          throw unsupportedOperation('Phase B2 does not yet support nonzero AV1 coefficients')
        }
      }
    }
  }

  #predictDc(plane: Plane, x: number, y: number, width: number, height: number): void {
    const haveAbove = y > 0
    const haveLeft = x > 0
    let prediction = 128
    if (haveAbove || haveLeft) {
      let sum = 0
      let count = 0
      if (haveAbove) {
        for (let index = 0; index < width; index += 1) {
          sum += plane.data[(y - 1) * plane.stride + Math.min(x + index, plane.width - 1)] ?? 128
          count += 1
        }
      }
      if (haveLeft) {
        for (let index = 0; index < height; index += 1) {
          sum += plane.data[Math.min(y + index, plane.height - 1) * plane.stride + x - 1] ?? 128
          count += 1
        }
      }
      prediction = Math.floor((sum + (count >> 1)) / count)
    }
    for (let localY = 0; localY < height && y + localY < plane.height; localY += 1) {
      plane.data.fill(
        prediction,
        (y + localY) * plane.stride + x,
        (y + localY) * plane.stride + Math.min(x + width, plane.width),
      )
    }
  }
}

export const decodeRestrictedAv1Intra = (
  sequence: Av1SequenceHeader,
  frame: Av1Frame,
): Av1Yuv420Frame => {
  if (
    sequence.profile !== 0 ||
    sequence.bitDepth !== 8 ||
    sequence.chromaSubsampling !== '420' ||
    sequence.monochrome
  ) {
    throw unsupportedOperation('Phase B2 supports 8-bit Main Profile YUV 4:2:0 AV1 only')
  }
  if (!frame.header.allLossless || frame.header.allowIntrabc) {
    throw unsupportedOperation('Phase B2 reconstruction currently requires lossless intra blocks')
  }
  if (frame.header.cdefBits !== 0 || frame.header.restorationTypes.some((type) => type !== 0)) {
    throw unsupportedOperation('Phase B2 reconstruction does not yet apply AV1 in-loop filters')
  }

  const miColumns = 2 * ((frame.header.frameWidth + 7) >> 3)
  const miRows = 2 * ((frame.header.frameHeight + 7) >> 3)
  const yStride = miColumns * 4
  const yHeight = miRows * 4
  const chromaStride = yStride >> 1
  const chromaHeight = yHeight >> 1
  const y: Plane = {
    data: new Uint8Array(yStride * yHeight),
    width: yStride,
    height: yHeight,
    stride: yStride,
  }
  const u: Plane = {
    data: new Uint8Array(chromaStride * chromaHeight),
    width: chromaStride,
    height: chromaHeight,
    stride: chromaStride,
  }
  const v: Plane = {
    data: new Uint8Array(chromaStride * chromaHeight),
    width: chromaStride,
    height: chromaHeight,
    stride: chromaStride,
  }
  new RestrictedIntraTileDecoder(sequence, frame, [y, u, v]).decode()
  return {
    width: frame.header.frameWidth,
    height: frame.header.frameHeight,
    chromaWidth: Math.ceil(frame.header.frameWidth / 2),
    chromaHeight: Math.ceil(frame.header.frameHeight / 2),
    yStride,
    chromaStride,
    y: y.data,
    u: u.data,
    v: v.data,
  }
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

export const yuv420ToRgba = (sequence: Av1SequenceHeader, frame: Av1Yuv420Frame): Uint8Array => {
  const output = new Uint8Array(frame.width * frame.height * 4)
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const luma = frame.y[y * frame.yStride + x] ?? 0
      const cb = (frame.u[(y >> 1) * frame.chromaStride + (x >> 1)] ?? 128) - 128
      const cr = (frame.v[(y >> 1) * frame.chromaStride + (x >> 1)] ?? 128) - 128
      const adjustedLuma = sequence.fullRange ? luma : 1.164_383 * (luma - 16)
      const chromaScale = sequence.fullRange ? 1 : 1.138_393
      const target = (y * frame.width + x) * 4
      output[target] = clampByte(adjustedLuma + 1.402 * chromaScale * cr)
      output[target + 1] = clampByte(
        adjustedLuma - 0.344_136 * chromaScale * cb - 0.714_136 * chromaScale * cr,
      )
      output[target + 2] = clampByte(adjustedLuma + 1.772 * chromaScale * cb)
      output[target + 3] = 255
    }
  }
  return output
}
