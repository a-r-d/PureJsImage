import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { Av1Frame } from './av1-frame.ts'
import type { Av1SequenceHeader } from './av1.ts'
import { Av1CoefficientDecoder } from './av1-coeff.ts'
import { Av1SymbolDecoder } from './av1-symbol.ts'
import { inverseTransformSquare } from './av1-transform.ts'

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

const keyframeModeDefaults = [
  [
    [15588, 17027, 19338, 20218, 20682, 21110, 21825, 23244, 24189, 28165, 29093, 30466, 32768, 0],
    [12016, 18066, 19516, 20303, 20719, 21444, 21888, 23032, 24434, 28658, 30172, 31409, 32768, 0],
    [10052, 10771, 22296, 22788, 23055, 23239, 24133, 25620, 26160, 29336, 29929, 31567, 32768, 0],
    [14091, 15406, 16442, 18808, 19136, 19546, 19998, 22096, 24746, 29585, 30958, 32462, 32768, 0],
    [12122, 13265, 15603, 16501, 18609, 20033, 22391, 25583, 26437, 30261, 31073, 32475, 32768, 0],
  ],
  [
    [10023, 19585, 20848, 21440, 21832, 22760, 23089, 24023, 25381, 29014, 30482, 31436, 32768, 0],
    [5983, 24099, 24560, 24886, 25066, 25795, 25913, 26423, 27610, 29905, 31276, 31794, 32768, 0],
    [7444, 12781, 20177, 20728, 21077, 21607, 22170, 23405, 24469, 27915, 29090, 30492, 32768, 0],
    [8537, 14689, 15432, 17087, 17408, 18172, 18408, 19825, 24649, 29153, 31096, 32210, 32768, 0],
    [7543, 14231, 15496, 16195, 17905, 20717, 21984, 24516, 26001, 29675, 30981, 31994, 32768, 0],
  ],
  [
    [12613, 13591, 21383, 22004, 22312, 22577, 23401, 25055, 25729, 29538, 30305, 32077, 32768, 0],
    [9687, 13470, 18506, 19230, 19604, 20147, 20695, 22062, 23219, 27743, 29211, 30907, 32768, 0],
    [6183, 6505, 26024, 26252, 26366, 26434, 27082, 28354, 28555, 30467, 30794, 32086, 32768, 0],
    [10718, 11734, 14954, 17224, 17565, 17924, 18561, 21523, 23878, 28975, 30287, 32252, 32768, 0],
    [9194, 9858, 16501, 17263, 18424, 19171, 21563, 25961, 26561, 30072, 30737, 32463, 32768, 0],
  ],
  [
    [12602, 14399, 15488, 18381, 18778, 19315, 19724, 21419, 25060, 29696, 30917, 32409, 32768, 0],
    [8203, 13821, 14524, 17105, 17439, 18131, 18404, 19468, 25225, 29485, 31158, 32342, 32768, 0],
    [8451, 9731, 15004, 17643, 18012, 18425, 19070, 21538, 24605, 29118, 30078, 32018, 32768, 0],
    [7714, 9048, 9516, 16667, 16817, 16994, 17153, 18767, 26743, 30389, 31536, 32528, 32768, 0],
    [8843, 10280, 11496, 15317, 16652, 17943, 19108, 22718, 25769, 29953, 30983, 32485, 32768, 0],
  ],
  [
    [12578, 13671, 15979, 16834, 19075, 20913, 22989, 25449, 26219, 30214, 31150, 32477, 32768, 0],
    [9563, 13626, 15080, 15892, 17756, 20863, 22207, 24236, 25380, 29653, 31143, 32277, 32768, 0],
    [8356, 8901, 17616, 18256, 19350, 20106, 22598, 25947, 26466, 29900, 30523, 32261, 32768, 0],
    [10835, 11815, 13124, 16042, 17018, 18039, 18947, 22753, 24615, 29489, 30883, 32482, 32768, 0],
    [7618, 8288, 9859, 10509, 15386, 18657, 22903, 28776, 29180, 31355, 31802, 32593, 32768, 0],
  ],
] as const
const intraModeContexts = [0, 1, 2, 3, 4, 4, 4, 4, 3, 0, 1, 2, 0] as const
const uvModeDefaults = new Map<number, readonly number[]>([
  [
    0,
    [
      10407, 11208, 12900, 13181, 13823, 14175, 14899, 15656, 15986, 20086, 20995, 22455, 24212,
      32768, 0,
    ],
  ],
  [
    2,
    [
      5273, 5379, 20177, 20270, 20385, 20439, 20949, 21695, 21774, 23138, 24256, 24703, 26679,
      32768, 0,
    ],
  ],
])
const angleDeltaDefaults = [
  [2180, 5032, 7567, 22776, 26989, 30217, 32768, 0],
  [2301, 5608, 8801, 23487, 26974, 30330, 32768, 0],
  [3780, 11018, 13699, 19354, 23083, 31286, 32768, 0],
  [4581, 11226, 15147, 17138, 21834, 28397, 32768, 0],
  [1737, 10927, 14509, 19588, 22745, 28823, 32768, 0],
  [2664, 10176, 12485, 17650, 21600, 30495, 32768, 0],
  [2240, 11096, 15453, 20341, 22561, 28917, 32768, 0],
  [3605, 10428, 12459, 17676, 21244, 30655, 32768, 0],
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
const filterIntraModeDefault = [8949, 12776, 17211, 29558, 32768, 0] as const
const intraTxTypeDefaults = [
  [1535, 8035, 9461, 12751, 23467, 27825, 32768, 0],
  [564, 3335, 9709, 10870, 18143, 28094, 32768, 0],
  [672, 3247, 3676, 11982, 19415, 23127, 32768, 0],
  [5279, 13885, 15487, 18044, 23527, 30252, 32768, 0],
  [4423, 6074, 7985, 10416, 25693, 29298, 32768, 0],
  [1486, 4241, 9460, 10662, 16456, 27694, 32768, 0],
  [439, 2838, 3522, 6737, 18058, 23754, 32768, 0],
  [1190, 4233, 4855, 11670, 20281, 24377, 32768, 0],
  [1045, 4312, 8647, 10159, 18644, 29335, 32768, 0],
  [202, 3734, 4747, 7298, 17127, 24016, 32768, 0],
  [447, 4312, 6819, 8884, 16010, 23858, 32768, 0],
  [277, 4369, 5255, 8905, 16465, 22271, 32768, 0],
  [3409, 5436, 10599, 15599, 19687, 24040, 32768, 0],
] as const
const intraTxType8x8Defaults = [
  [1870, 13742, 14530, 16498, 23770, 27698, 32768, 0],
  [326, 8796, 14632, 15079, 19272, 27486, 32768, 0],
  [484, 7576, 7712, 14443, 19159, 22591, 32768, 0],
  [1126, 15340, 15895, 17023, 20896, 30279, 32768, 0],
  [655, 4854, 5249, 5913, 22099, 27138, 32768, 0],
  [1299, 6458, 8885, 9290, 14851, 25497, 32768, 0],
  [311, 5295, 5552, 6885, 16107, 22672, 32768, 0],
  [883, 8059, 8270, 11258, 17289, 21549, 32768, 0],
  [741, 7580, 9318, 10345, 16688, 29046, 32768, 0],
  [110, 7406, 7915, 9195, 16041, 23329, 32768, 0],
  [363, 7974, 9357, 10673, 15629, 24474, 32768, 0],
  [153, 7647, 8112, 9936, 15307, 19996, 32768, 0],
  [3511, 6332, 11165, 15335, 19323, 23594, 32768, 0],
] as const
const intraTxTypes = [9, 0, 12, 13, 3, 1, 2] as const
const modeToTransform = [0, 1, 2, 0, 3, 1, 2, 2, 1, 3, 1, 2, 0] as const
const filterModeToDirection = [0, 1, 2, 6, 0] as const
const filterIntraTaps = [
  [
    [-6, 10, 0, 0, 0, 12, 0],
    [-5, 2, 10, 0, 0, 9, 0],
    [-3, 1, 1, 10, 0, 7, 0],
    [-3, 1, 1, 2, 10, 5, 0],
    [-4, 6, 0, 0, 0, 2, 12],
    [-3, 2, 6, 0, 0, 2, 9],
    [-3, 2, 2, 6, 0, 2, 7],
    [-3, 1, 2, 2, 6, 3, 5],
  ],
] as const
const allZeroDefaults = [
  [31849, 5892, 12112, 21935, 20289, 27473, 32487, 7654, 19473, 29984, 9961, 30242, 32117],
  [30371, 7570, 13155, 20751, 20969, 27067, 32013, 5495, 17942, 28280, 16384, 16384, 16384],
  [29614, 9068, 12924, 19538, 17737, 24619, 30642, 4119, 16026, 25657, 16384, 16384, 16384],
  [26887, 6729, 10361, 17442, 15045, 22478, 29072, 2713, 11861, 20773, 16384, 16384, 16384],
] as const
const allZero8x8Defaults = [
  [31548, 1549, 10130, 16656, 18591, 26308, 32537, 5403, 18096, 30003, 16384, 16384, 16384],
  [31782, 1836, 10689, 17604, 21622, 27518, 32399, 4419, 16294, 28345, 16384, 16384, 16384],
  [31957, 3230, 11153, 18123, 20143, 26536, 31986, 3050, 14603, 25155, 16384, 16384, 16384],
  [31903, 2044, 7528, 14618, 16182, 24168, 31037, 2786, 11194, 20155, 16384, 16384, 16384],
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
  readonly #frame: Av1Frame
  readonly #symbols: Av1SymbolDecoder
  readonly #coefficients: Av1CoefficientDecoder
  readonly #miColumns: number
  readonly #miRows: number
  readonly #blockSizes: Uint8Array
  readonly #skips: Uint8Array
  readonly #yModes: Uint8Array
  readonly #planes: readonly [Plane, Plane, Plane]
  readonly #levelContexts: readonly [Uint8Array, Uint8Array, Uint8Array]
  readonly #dcContexts: readonly [Uint8Array, Uint8Array, Uint8Array]
  readonly #partitionCdfs = new Map<string, Uint16Array>()
  readonly #skipCdfs = skipDefaults.map(cdf)
  readonly #yModeCdfs = new Map<string, Uint16Array>()
  readonly #uvModeCdfs = new Map<number, Uint16Array>()
  readonly #angleDeltaCdfs = angleDeltaDefaults.map(cdf)
  readonly #filterCdfs = new Map<number, Uint16Array>()
  readonly #filterModeCdf = cdf(filterIntraModeDefault)
  readonly #intraTxTypeCdfs = new Map<string, Uint16Array>()
  readonly #allZero4x4Cdfs: readonly Uint16Array[]
  readonly #allZero8x8Cdfs: readonly Uint16Array[]

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
    this.#frame = frame
    this.#symbols = new Av1SymbolDecoder(tile.data, !frame.header.disableCdfUpdate)
    this.#miColumns = 2 * ((frame.header.frameWidth + 7) >> 3)
    this.#miRows = 2 * ((frame.header.frameHeight + 7) >> 3)
    this.#blockSizes = new Uint8Array(this.#miColumns * this.#miRows)
    this.#skips = new Uint8Array(this.#miColumns * this.#miRows)
    this.#yModes = new Uint8Array(this.#miColumns * this.#miRows)
    this.#planes = planes
    const contextLength = (plane: Plane): number => (plane.width >> 2) * (plane.height >> 2)
    this.#levelContexts = [
      new Uint8Array(contextLength(planes[0])),
      new Uint8Array(contextLength(planes[1])),
      new Uint8Array(contextLength(planes[2])),
    ]
    this.#dcContexts = [
      new Uint8Array(contextLength(planes[0])),
      new Uint8Array(contextLength(planes[1])),
      new Uint8Array(contextLength(planes[2])),
    ]
    const qContext =
      frame.header.baseQuantizer <= 20
        ? 0
        : frame.header.baseQuantizer <= 60
          ? 1
          : frame.header.baseQuantizer <= 120
            ? 2
            : 3
    const defaults = allZeroDefaults[qContext]
    const defaults8x8 = allZero8x8Defaults[qContext]
    if (!defaults || !defaults8x8)
      throw invalidInput('AV1 coefficient quantizer context is invalid')
    this.#allZero4x4Cdfs = defaults.map((probability) => cdf([probability, 32768, 0]))
    this.#allZero8x8Cdfs = defaults8x8.map((probability) => cdf([probability, 32768, 0]))
    this.#coefficients = new Av1CoefficientDecoder(this.#symbols, qContext)
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
    const aboveMode = row > 0 ? (this.#yModes[(row - 1) * this.#miColumns + column] ?? 0) : 0
    const leftMode = column > 0 ? (this.#yModes[row * this.#miColumns + column - 1] ?? 0) : 0
    const aboveContext = intraModeContexts[aboveMode]
    const leftContext = intraModeContexts[leftMode]
    if (aboveContext === undefined || leftContext === undefined) {
      throw invalidInput('AV1 intra mode context is invalid')
    }
    const yModeKey = `${aboveContext}:${leftContext}`
    let yModeCdf = this.#yModeCdfs.get(yModeKey)
    if (!yModeCdf) {
      const defaults = keyframeModeDefaults[aboveContext]?.[leftContext]
      if (!defaults) throw invalidInput('AV1 keyframe mode CDF is missing')
      yModeCdf = cdf(defaults)
      this.#yModeCdfs.set(yModeKey, yModeCdf)
    }
    const yMode = this.#symbols.readSymbol(yModeCdf)
    if (yMode !== 0 && yMode !== 2) {
      throw unsupportedOperation(`Phase B2 does not yet support luma intra mode ${yMode}`)
    }
    this.#readAngleDelta(yMode, 'luma')

    const hasChroma = size > 4 || ((row & 1) === 1 && (column & 1) === 1)
    let uvMode = 0
    if (hasChroma) {
      let uvModeCdf = this.#uvModeCdfs.get(yMode)
      if (!uvModeCdf) {
        const defaults = uvModeDefaults.get(yMode)
        if (!defaults) {
          throw unsupportedOperation(`Phase B2 lacks the chroma CDF for luma mode ${yMode}`)
        }
        uvModeCdf = cdf(defaults)
        this.#uvModeCdfs.set(yMode, uvModeCdf)
      }
      uvMode = this.#symbols.readSymbol(uvModeCdf)
      if (uvMode !== 0 && uvMode !== 2) {
        throw unsupportedOperation(`Phase B2 does not yet support chroma intra mode ${uvMode}`)
      }
      this.#readAngleDelta(uvMode, 'chroma')
    }
    let filterMode: number | undefined
    if (yMode === 0 && this.#sequence.enableFilterIntra && size <= 32) {
      let filterCdf = this.#filterCdfs.get(size)
      if (!filterCdf) {
        const defaults = filterIntraDefaults.get(size)
        if (!defaults) throw unsupportedOperation(`Unsupported AV1 filter-intra size ${size}`)
        filterCdf = cdf(defaults)
        this.#filterCdfs.set(size, filterCdf)
      }
      if (this.#symbols.readSymbol(filterCdf) !== 0) {
        filterMode = this.#symbols.readSymbol(this.#filterModeCdf)
        if (filterMode !== 0) {
          throw unsupportedOperation(
            `Phase B2 does not yet support filtered intra prediction mode ${filterMode}`,
          )
        }
      }
    }

    const lumaTransformSize = this.#transformSize(size)
    this.#decodePlane(
      0,
      row * 4,
      column * 4,
      size,
      size,
      lumaTransformSize,
      skip === 1,
      yMode,
      filterMode,
    )
    if (hasChroma) {
      const chromaSize = Math.max(4, size >> 1)
      const chromaTransformSize = this.#transformSize(chromaSize)
      this.#decodePlane(
        1,
        (row >> 1) * 4,
        (column >> 1) * 4,
        chromaSize,
        chromaSize,
        chromaTransformSize,
        skip === 1,
        uvMode,
      )
      this.#decodePlane(
        2,
        (row >> 1) * 4,
        (column >> 1) * 4,
        chromaSize,
        chromaSize,
        chromaTransformSize,
        skip === 1,
        uvMode,
      )
    }

    for (let localRow = 0; localRow < blockMi; localRow += 1) {
      for (let localColumn = 0; localColumn < blockMi; localColumn += 1) {
        const target = (row + localRow) * this.#miColumns + column + localColumn
        if (row + localRow < this.#miRows && column + localColumn < this.#miColumns) {
          this.#blockSizes[target] = size
          this.#skips[target] = skip
          this.#yModes[target] = yMode
        }
      }
    }
  }

  #readAngleDelta(mode: number, plane: 'chroma' | 'luma'): void {
    if (mode < 1 || mode > 8) return
    const angleCdf = this.#angleDeltaCdfs[mode - 1]
    if (!angleCdf) throw invalidInput('AV1 angle-delta CDF is missing')
    const delta = this.#symbols.readSymbol(angleCdf) - 3
    if (delta !== 0) {
      throw unsupportedOperation(`Phase B2 does not yet support ${plane} angle delta ${delta}`)
    }
  }

  #transformSize(blockSize: number): 4 | 8 {
    if (blockSize <= 4 || this.#frame.header.transformMode === '4x4') return 4
    if (this.#frame.header.transformMode === 'select') {
      throw unsupportedOperation('Phase B2 does not yet decode selected AV1 transform sizes')
    }
    if (blockSize === 8) return 8
    throw unsupportedOperation(
      `Phase B2 does not yet reconstruct ${blockSize}x${blockSize} transforms`,
    )
  }

  #decodePlane(
    planeIndex: 0 | 1 | 2,
    startY: number,
    startX: number,
    width: number,
    height: number,
    transformSize: 4 | 8,
    skip: boolean,
    mode: number,
    filterMode?: number,
  ): void {
    const plane = this.#planes[planeIndex]
    for (let y = 0; y < height; y += transformSize) {
      for (let x = 0; x < width; x += transformSize) {
        this.#predictIntra(
          plane,
          startX + x,
          startY + y,
          transformSize,
          transformSize,
          mode,
          filterMode,
        )
        const blockX = (startX + x) >> 2
        const blockY = (startY + y) >> 2
        const contextWidth = plane.width >> 2
        const levelContexts = this.#levelContexts[planeIndex]
        const dcContexts = this.#dcContexts[planeIndex]
        const aboveIndex = blockY > 0 ? (blockY - 1) * contextWidth + blockX : -1
        const leftIndex = blockX > 0 ? blockY * contextWidth + blockX - 1 : -1
        const aboveLevel = aboveIndex >= 0 ? (levelContexts[aboveIndex] ?? 0) : 0
        const leftLevel = leftIndex >= 0 ? (levelContexts[leftIndex] ?? 0) : 0
        const aboveDc = aboveIndex >= 0 ? (dcContexts[aboveIndex] ?? 0) : 0
        const leftDc = leftIndex >= 0 ? (dcContexts[leftIndex] ?? 0) : 0
        const residualLargerThanTransform = width > transformSize || height > transformSize
        let zeroContext: number
        if (planeIndex === 0) {
          if (!residualLargerThanTransform) zeroContext = 0
          else if (aboveLevel === 0 && leftLevel === 0) zeroContext = 1
          else if (aboveLevel === 0 || leftLevel === 0) {
            zeroContext = 2 + Number(Math.max(aboveLevel, leftLevel) > 3)
          } else if (Math.max(aboveLevel, leftLevel) <= 3) zeroContext = 4
          else zeroContext = Math.min(aboveLevel, leftLevel) <= 3 ? 5 : 6
        } else {
          zeroContext =
            7 +
            Number(aboveLevel !== 0 || aboveDc !== 0) +
            Number(leftLevel !== 0 || leftDc !== 0) +
            (residualLargerThanTransform ? 3 : 0)
        }
        const allZeroCdfs = transformSize === 4 ? this.#allZero4x4Cdfs : this.#allZero8x8Cdfs
        const zeroCdf = allZeroCdfs[zeroContext]
        if (!zeroCdf) throw invalidInput('AV1 all-zero coefficient context is invalid')
        let levelContext = 0
        let dcCategory = 0
        const allZero = skip ? 1 : this.#symbols.readSymbol(zeroCdf)
        if (!skip && allZero !== 1) {
          const intraDirection =
            filterMode === undefined ? mode : (filterModeToDirection[filterMode] ?? mode)
          const txTypeKey = `${transformSize}:${intraDirection}`
          let txTypeCdf = this.#intraTxTypeCdfs.get(txTypeKey)
          if (!txTypeCdf) {
            const defaults =
              transformSize === 4
                ? intraTxTypeDefaults[intraDirection]
                : intraTxType8x8Defaults[intraDirection]
            if (!defaults) throw invalidInput('AV1 intra transform CDF is missing')
            txTypeCdf = cdf(defaults)
            this.#intraTxTypeCdfs.set(txTypeKey, txTypeCdf)
          }
          const txType =
            planeIndex === 0
              ? intraTxTypes[this.#symbols.readSymbol(txTypeCdf)]
              : modeToTransform[mode]
          if (txType === undefined) throw invalidInput('AV1 transform type is invalid')
          const dcSign =
            (aboveDc === 1 ? -1 : aboveDc === 2 ? 1 : 0) +
            (leftDc === 1 ? -1 : leftDc === 2 ? 1 : 0)
          const block = this.#coefficients.readSquare(
            planeIndex,
            transformSize,
            txType,
            dcSign < 0 ? 1 : dcSign > 0 ? 2 : 0,
          )
          levelContext = block.levelContext
          dcCategory = block.dcCategory
          const residual = inverseTransformSquare(
            block.coefficients,
            transformSize,
            txType,
            planeIndex,
            this.#frame.header,
          )
          for (
            let localY = 0;
            localY < transformSize && startY + y + localY < plane.height;
            localY += 1
          ) {
            for (
              let localX = 0;
              localX < transformSize && startX + x + localX < plane.width;
              localX += 1
            ) {
              const target = (startY + y + localY) * plane.stride + startX + x + localX
              plane.data[target] = Math.max(
                0,
                Math.min(
                  255,
                  (plane.data[target] ?? 0) + (residual[localY * transformSize + localX] ?? 0),
                ),
              )
            }
          }
        }
        const contextUnits = transformSize >> 2
        for (let contextY = 0; contextY < contextUnits; contextY += 1) {
          for (let contextX = 0; contextX < contextUnits; contextX += 1) {
            const contextIndex = (blockY + contextY) * contextWidth + blockX + contextX
            levelContexts[contextIndex] = levelContext
            dcContexts[contextIndex] = dcCategory
          }
        }
      }
    }
  }

  #predictIntra(
    plane: Plane,
    x: number,
    y: number,
    width: number,
    height: number,
    mode: number,
    filterMode?: number,
  ): void {
    const haveAbove = y > 0
    const haveLeft = x > 0
    if (filterMode !== undefined) {
      this.#predictFiltered(plane, x, y, width, height, filterMode)
      return
    }
    if (mode === 2) {
      for (let localY = 0; localY < height && y + localY < plane.height; localY += 1) {
        const prediction = haveLeft ? (plane.data[(y + localY) * plane.stride + x - 1] ?? 129) : 129
        plane.data.fill(
          prediction,
          (y + localY) * plane.stride + x,
          (y + localY) * plane.stride + Math.min(x + width, plane.width),
        )
      }
      return
    }
    if (mode !== 0) throw unsupportedOperation(`Phase B2 does not yet predict intra mode ${mode}`)
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

  #predictFiltered(
    plane: Plane,
    x: number,
    y: number,
    width: number,
    height: number,
    filterMode: number,
  ): void {
    const taps = filterIntraTaps[filterMode]
    if (!taps) throw unsupportedOperation(`Unsupported AV1 filter-intra mode ${filterMode}`)
    const haveAbove = y > 0
    const haveLeft = x > 0
    const corner = haveAbove
      ? (plane.data[(y - 1) * plane.stride + Math.min(x, plane.width - 1)] ?? 128)
      : haveLeft
        ? (plane.data[y * plane.stride + x - 1] ?? 128)
        : 128
    const above = Array.from({ length: width + height }, (_, index) =>
      haveAbove
        ? (plane.data[(y - 1) * plane.stride + Math.min(x + index, plane.width - 1)] ?? 127)
        : haveLeft
          ? (plane.data[y * plane.stride + x - 1] ?? 127)
          : 127,
    )
    const left = Array.from({ length: width + height }, (_, index) =>
      haveLeft
        ? (plane.data[Math.min(y + index, plane.height - 1) * plane.stride + x - 1] ?? 129)
        : haveAbove
          ? (plane.data[(y - 1) * plane.stride + x] ?? 129)
          : 129,
    )
    for (let rowPair = 0; rowPair < height / 2; rowPair += 1) {
      for (let columnGroup = 0; columnGroup < width / 4; columnGroup += 1) {
        const neighbors = Array.from({ length: 7 }, (_, index) => {
          if (index < 5) {
            if (rowPair === 0) {
              const aboveIndex = columnGroup * 4 + index - 1
              return aboveIndex < 0 ? corner : (above[aboveIndex] ?? 127)
            }
            if (columnGroup === 0 && index === 0) return left[rowPair * 2 - 1] ?? 129
            return (
              plane.data[(y + rowPair * 2 - 1) * plane.stride + x + columnGroup * 4 + index - 1] ??
              128
            )
          }
          if (columnGroup === 0) return left[rowPair * 2 + index - 5] ?? 129
          return (
            plane.data[(y + rowPair * 2 + index - 5) * plane.stride + x + columnGroup * 4 - 1] ??
            128
          )
        })
        for (let localY = 0; localY < 2; localY += 1) {
          for (let localX = 0; localX < 4; localX += 1) {
            const coefficients = taps[localY * 4 + localX]
            if (!coefficients) throw invalidInput('AV1 filter-intra taps are invalid')
            let sum = 0
            for (let index = 0; index < 7; index += 1) {
              sum += (coefficients[index] ?? 0) * (neighbors[index] ?? 128)
            }
            const targetY = y + rowPair * 2 + localY
            const targetX = x + columnGroup * 4 + localX
            if (targetY < plane.height && targetX < plane.width) {
              plane.data[targetY * plane.stride + targetX] = Math.max(
                0,
                Math.min(255, Math.floor((sum + 8) / 16)),
              )
            }
          }
        }
      }
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
  if (frame.header.allowIntrabc) {
    throw unsupportedOperation('Phase B2 reconstruction does not support intra block copy')
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

const sampleChroma = (
  plane: Uint8Array,
  stride: number,
  width: number,
  height: number,
  x: number,
  y: number,
): number => {
  const left = (x - 1) >> 1
  const top = (y - 1) >> 1
  const rightWeight = (x & 1) === 1 ? 1 : 3
  const bottomWeight = (y & 1) === 1 ? 1 : 3
  const leftX = Math.max(0, Math.min(width - 1, left))
  const rightX = Math.max(0, Math.min(width - 1, left + 1))
  const topY = Math.max(0, Math.min(height - 1, top))
  const bottomY = Math.max(0, Math.min(height - 1, top + 1))
  const topLeft = plane[topY * stride + leftX] ?? 128
  const topRight = plane[topY * stride + rightX] ?? 128
  const bottomLeft = plane[bottomY * stride + leftX] ?? 128
  const bottomRight = plane[bottomY * stride + rightX] ?? 128
  const topSample = topLeft * (4 - rightWeight) + topRight * rightWeight
  const bottomSample = bottomLeft * (4 - rightWeight) + bottomRight * rightWeight
  return (topSample * (4 - bottomWeight) + bottomSample * bottomWeight) / 16
}

export const yuv420ToRgba = (sequence: Av1SequenceHeader, frame: Av1Yuv420Frame): Uint8Array => {
  const output = new Uint8Array(frame.width * frame.height * 4)
  const redWeight =
    sequence.matrixCoefficients === 1 ? 0.2126 : sequence.matrixCoefficients === 9 ? 0.2627 : 0.299
  const blueWeight =
    sequence.matrixCoefficients === 1 ? 0.0722 : sequence.matrixCoefficients === 9 ? 0.0593 : 0.114
  const greenWeight = 1 - redWeight - blueWeight
  const redChroma = 2 * (1 - redWeight)
  const blueChroma = 2 * (1 - blueWeight)
  const redGreenChroma = (2 * redWeight * (1 - redWeight)) / greenWeight
  const blueGreenChroma = (2 * blueWeight * (1 - blueWeight)) / greenWeight
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const luma = frame.y[y * frame.yStride + x] ?? 0
      const cb =
        sampleChroma(frame.u, frame.chromaStride, frame.chromaWidth, frame.chromaHeight, x, y) - 128
      const cr =
        sampleChroma(frame.v, frame.chromaStride, frame.chromaWidth, frame.chromaHeight, x, y) - 128
      const adjustedLuma = sequence.fullRange ? luma / 255 : (luma - 16) / 219
      const adjustedCb = cb / (sequence.fullRange ? 255 : 224)
      const adjustedCr = cr / (sequence.fullRange ? 255 : 224)
      const target = (y * frame.width + x) * 4
      output[target] = clampByte((adjustedLuma + redChroma * adjustedCr) * 255)
      output[target + 1] = clampByte(
        (adjustedLuma - redGreenChroma * adjustedCr - blueGreenChroma * adjustedCb) * 255,
      )
      output[target + 2] = clampByte((adjustedLuma + blueChroma * adjustedCb) * 255)
      output[target + 3] = 255
    }
  }
  return output
}
