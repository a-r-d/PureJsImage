import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { Av1Frame } from './av1-frame.ts'
import type { Av1SequenceHeader } from './av1.ts'
import { Av1CoefficientDecoder } from './av1-coeff.ts'
import {
  applyAv1PostFilters,
  type Av1PostFilterState,
  type Av1RestorationPlaneState,
} from './av1-post-filter.ts'
import { Av1SymbolDecoder } from './av1-symbol.ts'
import { inverseTransform } from './av1-transform.ts'

const cdf = (values: readonly number[]): Uint16Array => new Uint16Array(values)

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
  return cdf([32768 - splitProbability, 32768, 0])
}

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
const uvModeDefaults = [
  [
    10407, 11208, 12900, 13181, 13823, 14175, 14899, 15656, 15986, 20086, 20995, 22455, 24212,
    32768, 0,
  ],
  [
    4532, 19780, 20057, 20215, 20428, 21071, 21199, 21451, 22099, 24228, 24693, 27032, 29472, 32768,
    0,
  ],
  [
    5273, 5379, 20177, 20270, 20385, 20439, 20949, 21695, 21774, 23138, 24256, 24703, 26679, 32768,
    0,
  ],
  [
    6740, 7167, 7662, 14152, 14536, 14785, 15034, 16741, 18371, 21520, 22206, 23389, 24182, 32768,
    0,
  ],
  [4987, 5368, 5928, 6068, 19114, 20315, 21857, 22253, 22411, 24911, 25380, 26027, 26376, 32768, 0],
  [5370, 6889, 7247, 7393, 9498, 21114, 21402, 21753, 21981, 24780, 25386, 26517, 27176, 32768, 0],
  [4816, 4961, 7204, 7326, 8765, 8930, 20169, 20682, 20803, 23188, 23763, 24455, 24940, 32768, 0],
  [6608, 6740, 8529, 9049, 9257, 9356, 9735, 18827, 19059, 22336, 23204, 23964, 24793, 32768, 0],
  [5998, 7419, 7781, 8933, 9255, 9549, 9753, 10417, 18898, 22494, 23139, 24764, 25989, 32768, 0],
  [
    10660, 11298, 12550, 12957, 13322, 13624, 14040, 15004, 15534, 20714, 21789, 23443, 24861,
    32768, 0,
  ],
  [
    10522, 11530, 12552, 12963, 13378, 13779, 14245, 15235, 15902, 20102, 22696, 23774, 25838,
    32768, 0,
  ],
  [
    10099, 10691, 12639, 13049, 13386, 13665, 14125, 15163, 15636, 19676, 20474, 23519, 25208,
    32768, 0,
  ],
  [3144, 5087, 7382, 7504, 7593, 7690, 7801, 8064, 8232, 9248, 9875, 10521, 29048, 32768, 0],
] as const
const uvModeNoCflDefaults = [
  [22631, 24152, 25378, 25661, 25986, 26520, 27055, 27923, 28244, 30059, 30941, 31961, 32768, 0],
  [9513, 26881, 26973, 27046, 27118, 27664, 27739, 27824, 28359, 29505, 29800, 31796, 32768, 0],
  [9845, 9915, 28663, 28704, 28757, 28780, 29198, 29822, 29854, 30764, 31777, 32029, 32768, 0],
  [13639, 13897, 14171, 25331, 25606, 25727, 25953, 27148, 28577, 30612, 31355, 32493, 32768, 0],
  [9764, 9835, 9930, 9954, 25386, 27053, 27958, 28148, 28243, 31101, 31744, 32363, 32768, 0],
  [11825, 13589, 13677, 13720, 15048, 29213, 29301, 29458, 29711, 31161, 31441, 32550, 32768, 0],
  [14175, 14399, 16608, 16821, 17718, 17775, 28551, 30200, 30245, 31837, 32342, 32667, 32768, 0],
  [12885, 13038, 14978, 15590, 15673, 15748, 16176, 29128, 29267, 30643, 31961, 32461, 32768, 0],
  [12026, 13661, 13874, 15305, 15490, 15726, 15995, 16273, 28443, 30388, 30767, 32416, 32768, 0],
  [19052, 19840, 20579, 20916, 21150, 21467, 21885, 22719, 23174, 28861, 30379, 32175, 32768, 0],
  [18627, 19649, 20974, 21219, 21492, 21816, 22199, 23119, 23527, 27053, 31397, 32148, 32768, 0],
  [17026, 19004, 19997, 20339, 20586, 21103, 21349, 21907, 22482, 25896, 26541, 31819, 32768, 0],
  [12124, 13759, 14959, 14992, 15007, 15051, 15078, 15166, 15255, 15753, 16039, 16606, 32768, 0],
] as const
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
const intraTxType16x16Defaults = [
  [1127, 12814, 22772, 27483, 32768, 0],
  [145, 6761, 11980, 26667, 32768, 0],
  [362, 5887, 11678, 16725, 32768, 0],
  [385, 15213, 18587, 30693, 32768, 0],
  [25, 2914, 23134, 27903, 32768, 0],
  [60, 4470, 11749, 23991, 32768, 0],
  [37, 3332, 14511, 21448, 32768, 0],
  [157, 6320, 13036, 17439, 32768, 0],
  [119, 6719, 12906, 29396, 32768, 0],
  [47, 5537, 12576, 21499, 32768, 0],
  [269, 6076, 11258, 23115, 32768, 0],
  [83, 5615, 12001, 17228, 32768, 0],
  [1968, 5556, 12023, 18547, 32768, 0],
] as const
const intraTxTypes = [9, 0, 10, 11, 3, 1, 2] as const
const intraTxTypes16x16 = [9, 0, 3, 1, 2] as const
const modeToTransform = [0, 1, 2, 0, 3, 1, 2, 2, 1, 3, 1, 2, 3, 0] as const
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
  [
    [-10, 16, 0, 0, 0, 10, 0],
    [-6, 0, 16, 0, 0, 6, 0],
    [-4, 0, 0, 16, 0, 4, 0],
    [-2, 0, 0, 0, 16, 2, 0],
    [-10, 16, 0, 0, 0, 0, 10],
    [-6, 0, 16, 0, 0, 0, 6],
    [-4, 0, 0, 16, 0, 0, 4],
    [-2, 0, 0, 0, 16, 0, 2],
  ],
  [
    [-8, 8, 0, 0, 0, 16, 0],
    [-8, 0, 8, 0, 0, 16, 0],
    [-8, 0, 0, 8, 0, 16, 0],
    [-8, 0, 0, 0, 8, 16, 0],
    [-4, 4, 0, 0, 0, 0, 16],
    [-4, 0, 4, 0, 0, 0, 16],
    [-4, 0, 0, 4, 0, 0, 16],
    [-4, 0, 0, 0, 4, 0, 16],
  ],
  [
    [-2, 8, 0, 0, 0, 10, 0],
    [-1, 3, 8, 0, 0, 6, 0],
    [-1, 2, 3, 8, 0, 4, 0],
    [0, 1, 2, 3, 8, 2, 0],
    [-1, 4, 0, 0, 0, 3, 10],
    [-1, 3, 4, 0, 0, 4, 6],
    [-1, 2, 3, 4, 0, 4, 4],
    [-1, 2, 2, 3, 4, 3, 3],
  ],
  [
    [-12, 14, 0, 0, 0, 14, 0],
    [-10, 0, 14, 0, 0, 12, 0],
    [-9, 0, 0, 14, 0, 11, 0],
    [-8, 0, 0, 0, 14, 10, 0],
    [-10, 12, 0, 0, 0, 0, 14],
    [-9, 1, 12, 0, 0, 0, 12],
    [-8, 0, 0, 12, 0, 1, 11],
    [-7, 0, 0, 1, 12, 1, 9],
  ],
] as const
const modeToAngle = [0, 90, 180, 45, 135, 113, 157, 203, 67] as const
const directionalDerivatives = [
  0, 0, 0, 1023, 0, 0, 547, 0, 0, 372, 0, 0, 0, 0, 273, 0, 0, 215, 0, 0, 178, 0, 0, 151, 0, 0, 132,
  0, 0, 116, 0, 0, 102, 0, 0, 0, 90, 0, 0, 80, 0, 0, 71, 0, 0, 64, 0, 0, 57, 0, 0, 51, 0, 0, 45, 0,
  0, 0, 40, 0, 0, 35, 0, 0, 31, 0, 0, 27, 0, 0, 23, 0, 0, 19, 0, 0, 15, 0, 0, 0, 0, 11, 0, 0, 7, 0,
  0, 3, 0, 0,
] as const
const intraEdgeKernels = [
  [0, 4, 8, 4, 0],
  [0, 5, 6, 5, 0],
  [2, 4, 4, 4, 2],
] as const

const intraEdgeStrength = (size: number, delta: number, smooth: boolean): number => {
  const distance = Math.abs(delta)
  if (smooth) {
    if (size <= 8) return distance >= 64 ? 2 : distance >= 40 ? 1 : 0
    if (size <= 16) return distance >= 48 ? 2 : distance >= 20 ? 1 : 0
    if (size <= 24) return distance >= 4 ? 3 : 0
    return 3
  }
  if (size <= 8) return distance >= 56 ? 1 : 0
  if (size <= 16) return distance >= 40 ? 1 : 0
  if (size <= 24) return distance >= 32 ? 3 : distance >= 16 ? 2 : distance >= 8 ? 1 : 0
  if (size <= 32) return distance >= 32 ? 3 : distance >= 4 ? 2 : 1
  return 3
}

const filterIntraEdge = (
  samples: Uint8Array,
  corner: number,
  count: number,
  strength: number,
): void => {
  const kernel = intraEdgeKernels[strength - 1]
  if (!kernel || count < 1) return
  const length = Math.min(count, samples.length)
  const source = new Uint8Array(length + 1)
  source[0] = corner
  source.set(samples.subarray(0, length), 1)
  for (let index = 1; index <= length; index += 1) {
    let sum = 0
    for (let tap = 0; tap < kernel.length; tap += 1) {
      const sourceIndex = Math.max(0, Math.min(length, index - 2 + tap))
      sum += (source[sourceIndex] ?? corner) * (kernel[tap] ?? 0)
    }
    samples[index - 1] = (sum + 8) >> 4
  }
}

interface UpsampledIntraEdge {
  readonly offset: number
  readonly samples: Uint8Array
}

const upsampleIntraEdge = (samples: Uint8Array, corner: number): UpsampledIntraEdge => {
  const source = new Uint8Array(samples.length + 3)
  source[0] = corner
  source[1] = corner
  source.set(samples, 2)
  source[source.length - 1] = samples[samples.length - 1] ?? corner
  const output = new Uint8Array(samples.length * 2 + 1)
  output[0] = corner
  for (let index = 0; index < samples.length; index += 1) {
    const value =
      -(source[index] ?? corner) +
      9 * (source[index + 1] ?? corner) +
      9 * (source[index + 2] ?? corner) -
      (source[index + 3] ?? corner)
    output[index * 2 + 1] = Math.max(0, Math.min(255, (value + 8) >> 4))
    output[index * 2 + 2] = samples[index] ?? corner
  }
  return { samples: output, offset: 2 }
}
const smoothWeights = new Map<number, readonly number[]>([
  [4, [255, 149, 85, 64]],
  [8, [255, 197, 146, 105, 73, 50, 37, 32]],
  [16, [255, 225, 196, 170, 145, 123, 102, 84, 68, 54, 43, 33, 26, 20, 17, 16]],
  [
    32,
    [
      255, 240, 225, 210, 196, 182, 169, 157, 145, 133, 122, 111, 101, 92, 83, 74, 66, 59, 52, 45,
      39, 34, 29, 25, 21, 17, 14, 12, 10, 9, 8, 8,
    ],
  ],
  [
    64,
    [
      255, 248, 240, 233, 225, 218, 210, 203, 196, 189, 182, 176, 169, 163, 156, 150, 144, 138, 133,
      127, 121, 116, 111, 106, 101, 96, 91, 86, 82, 77, 73, 69, 65, 61, 57, 54, 50, 47, 44, 41, 38,
      35, 32, 29, 27, 25, 22, 20, 18, 16, 15, 13, 12, 10, 9, 8, 7, 6, 6, 5, 5, 4, 4, 4,
    ],
  ],
])
const transformDepthDefaults = new Map<number, readonly (readonly number[])[]>([
  [
    8,
    [
      [19968, 32768, 0],
      [19968, 32768, 0],
      [24320, 32768, 0],
    ],
  ],
  [
    16,
    [
      [12272, 30172, 32768, 0],
      [12272, 30172, 32768, 0],
      [18677, 30848, 32768, 0],
    ],
  ],
  [
    32,
    [
      [12986, 15180, 32768, 0],
      [12986, 15180, 32768, 0],
      [24302, 25602, 32768, 0],
    ],
  ],
  [
    64,
    [
      [5782, 11475, 32768, 0],
      [5782, 11475, 32768, 0],
      [16803, 22759, 32768, 0],
    ],
  ],
])
const cflSignDefault = [1418, 2123, 13340, 18405, 26972, 28343, 32294, 32768, 0] as const
const cflAlphaDefaults = [
  [
    7637, 20719, 31401, 32481, 32657, 32688, 32692, 32696, 32700, 32704, 32708, 32712, 32716, 32720,
    32724, 32768, 0,
  ],
  [
    14365, 23603, 28135, 31168, 32167, 32395, 32487, 32573, 32620, 32647, 32668, 32672, 32676,
    32680, 32684, 32768, 0,
  ],
  [
    11532, 22380, 28445, 31360, 32349, 32523, 32584, 32649, 32673, 32677, 32681, 32685, 32689,
    32693, 32697, 32768, 0,
  ],
  [
    26990, 31402, 32282, 32571, 32692, 32696, 32700, 32704, 32708, 32712, 32716, 32720, 32724,
    32728, 32732, 32768, 0,
  ],
  [
    17248, 26058, 28904, 30608, 31305, 31877, 32126, 32321, 32394, 32464, 32516, 32560, 32576,
    32593, 32622, 32768, 0,
  ],
  [
    14738, 21678, 25779, 27901, 29024, 30302, 30980, 31843, 32144, 32413, 32520, 32594, 32622,
    32656, 32660, 32768, 0,
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
const allZero16x16Defaults = [
  [29957, 5391, 18039, 23566, 22431, 25822, 32197, 3778, 15336, 28981, 16384, 16384, 16384],
  [31901, 10311, 18047, 24806, 23288, 27914, 32296, 4215, 15756, 28341, 16384, 16384, 16384],
  [32363, 10692, 19090, 24357, 24442, 28312, 32169, 3648, 15690, 26815, 16384, 16384, 16384],
  [32510, 8430, 17318, 24154, 23674, 28789, 32139, 3440, 13117, 22702, 16384, 16384, 16384],
] as const
const allZero32x32Defaults = [
  [17920, 1818, 7282, 25273, 10923, 31554, 32624, 1366, 15628, 30462, 146, 5132, 31657],
  [26726, 1045, 11703, 20590, 18554, 25970, 31938, 5583, 21313, 29390, 641, 22265, 31452],
  [30669, 3832, 11663, 18889, 19782, 23313, 31330, 5124, 18719, 28468, 3082, 20982, 29443],
  [31671, 2056, 11746, 16852, 18635, 24715, 31484, 4656, 16074, 24704, 1806, 14645, 25336],
] as const
const allZero64x64Defaults = [
  [6308, 117, 1638, 2161, 16384, 10923, 30247, 16384, 16384, 16384, 16384, 16384, 16384],
  [26584, 188, 8847, 24519, 22938, 30583, 32608, 16384, 16384, 16384, 16384, 16384, 16384],
  [28573, 3183, 17802, 25977, 26677, 27832, 32387, 16384, 16384, 16384, 16384, 16384, 16384],
  [31539, 8433, 20576, 27904, 27852, 30026, 32441, 16384, 16384, 16384, 16384, 16384, 16384],
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

type TransformDimension = 4 | 8 | 16 | 32 | 64
type CoefficientDimension = 4 | 8 | 16 | 32 | 64

const coefficientDimension = (value: TransformDimension): CoefficientDimension | undefined =>
  value === 4 || value === 8 || value === 16 || value === 32 || value === 64 ? value : undefined

const transformSizeContext = (width: TransformDimension, height: TransformDimension): number =>
  (Math.log2(width >> 2) + Math.log2(height >> 2) + 1) >> 1

interface TransformShape {
  readonly height: TransformDimension
  readonly width: TransformDimension
}

interface IntraEdgeNode {
  readonly horizontal: readonly [number, number]
  readonly horizontal4: number
  readonly none: number
  readonly split: readonly IntraEdgeNode[]
  readonly tipSplit: readonly [number, number, number]
  readonly vertical: readonly [number, number]
  readonly vertical4: number
}

const EDGE_LUMA_TOP_RIGHT = 1
const EDGE_CHROMA_TOP_RIGHT = 4
const EDGE_LUMA_BOTTOM_LEFT = 8
const EDGE_CHROMA_BOTTOM_LEFT = 32
const EDGE_ALL_TOP_RIGHT = 7
const EDGE_ALL_BOTTOM_LEFT = 56

const createEdgeNode = (size: number, flags: number): IntraEdgeNode => {
  const tipSplit: readonly [number, number, number] =
    size === 8
      ? [
          flags & EDGE_ALL_TOP_RIGHT,
          flags | 1,
          flags & (EDGE_CHROMA_TOP_RIGHT | EDGE_CHROMA_BOTTOM_LEFT | 16),
        ]
      : [0, 0, 0]
  return {
    none: flags,
    horizontal: [
      flags | EDGE_ALL_BOTTOM_LEFT,
      size === 8
        ? flags & (EDGE_ALL_BOTTOM_LEFT | EDGE_CHROMA_TOP_RIGHT)
        : flags & EDGE_ALL_BOTTOM_LEFT,
    ],
    vertical: [
      flags | EDGE_ALL_TOP_RIGHT,
      size === 8
        ? flags & (EDGE_ALL_TOP_RIGHT | EDGE_CHROMA_BOTTOM_LEFT | 16)
        : flags & EDGE_ALL_TOP_RIGHT,
    ],
    horizontal4: EDGE_ALL_BOTTOM_LEFT | (size === 16 ? flags & EDGE_CHROMA_TOP_RIGHT : 0),
    vertical4: EDGE_ALL_TOP_RIGHT | (size === 16 ? flags & (EDGE_CHROMA_BOTTOM_LEFT | 16) : 0),
    tipSplit,
    split: [],
  }
}

const createModeNode = (
  size: number,
  topRightAvailable: boolean,
  bottomLeftAvailable: boolean,
): IntraEdgeNode => {
  const flags =
    (topRightAvailable ? EDGE_ALL_TOP_RIGHT : 0) | (bottomLeftAvailable ? EDGE_ALL_BOTTOM_LEFT : 0)
  const base = createEdgeNode(size, flags)
  if (size <= 8) return base
  const childSize = size >> 1
  const split: IntraEdgeNode[] = []
  for (let index = 0; index < 4; index += 1) {
    const childTopRight = !(index === 3 || (index === 1 && !topRightAvailable))
    const childBottomLeft = index === 0 || (index === 2 && bottomLeftAvailable)
    split.push(
      childSize === 8
        ? createEdgeNode(
            childSize,
            (childTopRight ? EDGE_ALL_TOP_RIGHT : 0) | (childBottomLeft ? EDGE_ALL_BOTTOM_LEFT : 0),
          )
        : createModeNode(childSize, childTopRight, childBottomLeft),
    )
  }
  return { ...base, split }
}

const intraEdgeRoots = new Map([
  [64, createModeNode(64, true, false)],
  [128, createModeNode(128, true, false)],
])
const intraEdgeRightRoots = new Map([
  [64, createModeNode(64, false, false)],
  [128, createModeNode(128, false, false)],
])

interface RestorationReference {
  readonly horizontal: Int32Array
  readonly sgr: Int32Array
  readonly vertical: Int32Array
}

const createRestorationReference = (): RestorationReference => ({
  horizontal: Int32Array.from([3, -7, 15]),
  sgr: Int32Array.from([-32, 31]),
  vertical: Int32Array.from([3, -7, 15]),
})

const countRestorationUnits = (unitSize: number, frameSize: number): number =>
  Math.max(Math.floor((frameSize + (unitSize >> 1)) / unitSize), 1)

const createRestorationPlaneState = (frame: Av1Frame, plane: number): Av1RestorationPlaneState => {
  const sub = plane === 0 ? 0 : 1
  const unitSize = frame.header.restorationUnitSizes[plane] ?? 256
  const rows = countRestorationUnits(unitSize, Math.ceil(frame.header.frameHeight / 2 ** sub))
  const columns = countRestorationUnits(unitSize, Math.ceil(frame.header.upscaledWidth / 2 ** sub))
  const units = rows * columns
  return {
    unitSize,
    rows,
    columns,
    types: new Uint8Array(units),
    wiener: new Int8Array(units * 6),
    sgrSets: new Uint8Array(units),
    sgrXqd: new Int16Array(units * 2),
  }
}

const inverseRecenter = (reference: number, value: number): number => {
  if (value > 2 * reference) return value
  return (value & 1) === 1 ? reference - ((value + 1) >> 1) : reference + (value >> 1)
}

class RestrictedIntraTileDecoder {
  readonly #sequence: Av1SequenceHeader
  readonly #frame: Av1Frame
  readonly #symbols: Av1SymbolDecoder
  readonly #coefficients: Av1CoefficientDecoder
  readonly #miColumns: number
  readonly #miRows: number
  readonly #chromaMiColumns: number
  readonly #blockWidths: Uint8Array
  readonly #blockHeights: Uint8Array
  readonly #skips: Uint8Array
  readonly #yModes: Uint8Array
  readonly #uvModes: Uint8Array
  readonly #transformWidths: readonly [Uint8Array, Uint8Array, Uint8Array]
  readonly #transformHeights: readonly [Uint8Array, Uint8Array, Uint8Array]
  readonly #cdefColumns: number
  readonly #cdefIndices: Uint16Array
  readonly #planes: readonly [Plane, Plane, Plane]
  readonly #levelContexts: readonly [Uint8Array, Uint8Array, Uint8Array]
  readonly #dcContexts: readonly [Uint8Array, Uint8Array, Uint8Array]
  readonly #reconstructedContexts: readonly [Uint8Array, Uint8Array, Uint8Array]
  readonly #partitionCdfs = new Map<string, Uint16Array>()
  readonly #skipCdfs = skipDefaults.map(cdf)
  readonly #yModeCdfs = new Map<string, Uint16Array>()
  readonly #uvModeCdfs = new Map<string, Uint16Array>()
  readonly #angleDeltaCdfs = angleDeltaDefaults.map(cdf)
  readonly #transformDepthCdfs = new Map<string, Uint16Array>()
  readonly #cflSignCdf = cdf(cflSignDefault)
  readonly #cflAlphaCdfs = cflAlphaDefaults.map(cdf)
  readonly #filterCdfs = new Map<number, Uint16Array>()
  readonly #filterModeCdf = cdf(filterIntraModeDefault)
  readonly #deltaQCdf = cdf([28160, 32120, 32677, 32768, 0])
  readonly #restorationWienerCdf = cdf([11570, 32768, 0])
  readonly #restorationSgrCdf = cdf([16855, 32768, 0])
  readonly #restorationSwitchableCdf = cdf([9413, 22581, 32768, 0])
  readonly #restorationReferences: readonly RestorationReference[] = [
    createRestorationReference(),
    createRestorationReference(),
    createRestorationReference(),
  ]
  readonly #restoration: readonly [
    Av1RestorationPlaneState,
    Av1RestorationPlaneState,
    Av1RestorationPlaneState,
  ]
  readonly #intraTxTypeCdfs = new Map<string, Uint16Array>()
  readonly #allZero4x4Cdfs: readonly Uint16Array[]
  readonly #allZero8x8Cdfs: readonly Uint16Array[]
  readonly #allZero16x16Cdfs: readonly Uint16Array[]
  readonly #allZero32x32Cdfs: readonly Uint16Array[]
  readonly #allZero64x64Cdfs: readonly Uint16Array[]
  #currentQuantizer: number
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
    this.#currentQuantizer = frame.header.baseQuantizer
    this.#symbols = new Av1SymbolDecoder(tile.data, !frame.header.disableCdfUpdate)
    this.#miColumns = 2 * ((frame.header.frameWidth + 7) >> 3)
    this.#miRows = 2 * ((frame.header.frameHeight + 7) >> 3)
    this.#chromaMiColumns = this.#miColumns >> 1
    this.#blockWidths = new Uint8Array(this.#miColumns * this.#miRows)
    this.#blockHeights = new Uint8Array(this.#miColumns * this.#miRows)
    this.#skips = new Uint8Array(this.#miColumns * this.#miRows)
    this.#yModes = new Uint8Array(this.#miColumns * this.#miRows)
    this.#uvModes = new Uint8Array(this.#chromaMiColumns * (this.#miRows >> 1))
    const transformContextLength = (plane: Plane): number =>
      (plane.width >> 2) * (plane.height >> 2)
    this.#transformWidths = [
      new Uint8Array(transformContextLength(planes[0])),
      new Uint8Array(transformContextLength(planes[1])),
      new Uint8Array(transformContextLength(planes[2])),
    ]
    this.#transformHeights = [
      new Uint8Array(transformContextLength(planes[0])),
      new Uint8Array(transformContextLength(planes[1])),
      new Uint8Array(transformContextLength(planes[2])),
    ]
    this.#cdefColumns = Math.ceil(this.#miColumns / 16)
    this.#cdefIndices = new Uint16Array(this.#cdefColumns * Math.ceil(this.#miRows / 16))
    this.#planes = planes
    this.#restoration = [
      createRestorationPlaneState(frame, 0),
      createRestorationPlaneState(frame, 1),
      createRestorationPlaneState(frame, 2),
    ]
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
    this.#reconstructedContexts = [
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
    const defaults16x16 = allZero16x16Defaults[qContext]
    const defaults32x32 = allZero32x32Defaults[qContext]
    const defaults64x64 = allZero64x64Defaults[qContext]
    if (!defaults || !defaults8x8 || !defaults16x16 || !defaults32x32 || !defaults64x64)
      throw invalidInput('AV1 coefficient quantizer context is invalid')
    this.#allZero4x4Cdfs = defaults.map((probability) => cdf([probability, 32768, 0]))
    this.#allZero8x8Cdfs = defaults8x8.map((probability) => cdf([probability, 32768, 0]))
    this.#allZero16x16Cdfs = defaults16x16.map((probability) => cdf([probability, 32768, 0]))
    this.#allZero32x32Cdfs = defaults32x32.map((probability) => cdf([probability, 32768, 0]))
    this.#allZero64x64Cdfs = defaults64x64.map((probability) => cdf([probability, 32768, 0]))
    this.#coefficients = new Av1CoefficientDecoder(this.#symbols, qContext)
  }

  decode(): void {
    const superblockPixels = this.#sequence.use128x128Superblock ? 128 : 64
    const superblockMi = superblockPixels >> 2
    for (let row = 0; row < this.#miRows; row += superblockMi) {
      for (let column = 0; column < this.#miColumns; column += superblockMi) {
        const roots = column + superblockMi < this.#miColumns ? intraEdgeRoots : intraEdgeRightRoots
        const edgeRoot = roots.get(superblockPixels)
        if (!edgeRoot) throw invalidInput('AV1 intra edge root is missing')
        this.#readRestorationForSuperblock(row, column)
        this.#decodePartition(row, column, superblockPixels, edgeRoot)
      }
    }
    this.#symbols.finish()
  }

  postFilterState(): Av1PostFilterState {
    return {
      miColumns: this.#miColumns,
      miRows: this.#miRows,
      skips: this.#skips,
      transformWidths: this.#transformWidths,
      transformHeights: this.#transformHeights,
      cdefColumns: this.#cdefColumns,
      cdefIndices: this.#cdefIndices,
      restoration: this.#restoration,
    }
  }

  #readRestorationForSuperblock(row: number, column: number): void {
    if (this.#frame.header.restorationTypes.every((type) => type === 0)) return
    if (this.#frame.header.frameWidth !== this.#frame.header.upscaledWidth) {
      throw unsupportedOperation('AV1 restoration with super-resolution')
    }
    for (let plane = 0; plane < 3; plane += 1) {
      const frameType = this.#frame.header.restorationTypes[plane] ?? 0
      if (frameType === 0) continue
      const subsampling = plane === 0 ? 0 : 1
      const unitSize = this.#frame.header.restorationUnitSizes[plane]
      if (unitSize === undefined || unitSize < 32 || (unitSize & (unitSize - 1)) !== 0) {
        throw invalidInput('AV1 restoration unit size is invalid')
      }
      const planeState = this.#restoration[plane]
      if (!planeState) throw invalidInput('AV1 restoration plane state is invalid')
      const superblockMi = this.#sequence.use128x128Superblock ? 32 : 16
      const numerator = 4 >> subsampling
      const unitRowStart = Math.floor((row * numerator + unitSize - 1) / unitSize)
      const unitRowEnd = Math.min(
        planeState.rows,
        Math.floor(((row + superblockMi) * numerator + unitSize - 1) / unitSize),
      )
      const unitColumnStart = Math.floor((column * numerator + unitSize - 1) / unitSize)
      const unitColumnEnd = Math.min(
        planeState.columns,
        Math.floor(((column + superblockMi) * numerator + unitSize - 1) / unitSize),
      )
      for (let unitRow = unitRowStart; unitRow < unitRowEnd; unitRow += 1) {
        for (let unitColumn = unitColumnStart; unitColumn < unitColumnEnd; unitColumn += 1) {
          this.#readRestorationUnit(plane, frameType, unitRow, unitColumn)
        }
      }
    }
  }

  #readRestorationUnit(
    plane: number,
    frameType: number,
    unitRow: number,
    unitColumn: number,
  ): void {
    let type: number
    if (frameType === 3) type = this.#symbols.readSymbol(this.#restorationSwitchableCdf)
    else {
      const enabled = this.#symbols.readSymbol(
        frameType === 1 ? this.#restorationWienerCdf : this.#restorationSgrCdf,
      )
      type = enabled === 1 ? frameType : 0
    }
    const reference = this.#restorationReferences[plane]
    const planeState = this.#restoration[plane]
    if (!reference || !planeState) throw invalidInput('AV1 restoration plane is invalid')
    const unitIndex = unitRow * planeState.columns + unitColumn
    if (unitIndex < 0 || unitIndex >= planeState.types.length) {
      throw invalidInput('AV1 restoration unit index is invalid')
    }
    planeState.types[unitIndex] = type
    if (type === 1) {
      let pass = 0
      for (const target of [reference.vertical, reference.horizontal]) {
        if (plane === 0) target[0] = this.#readRestorationSubexp((target[0] ?? 0) + 5, 16, 1) - 5
        else target[0] = 0
        target[1] = this.#readRestorationSubexp((target[1] ?? 0) + 23, 32, 2) - 23
        target[2] = this.#readRestorationSubexp((target[2] ?? 0) + 17, 64, 3) - 17
        const targetOffset = unitIndex * 6 + pass * 3
        planeState.wiener.set(target, targetOffset)
        pass += 1
      }
    } else if (type === 2) {
      const set = this.#symbols.readLiteral(4)
      const firstRadius = set < 10 || set >= 14
      const secondRadius = set < 14
      reference.sgr[0] = firstRadius
        ? this.#readRestorationSubexp((reference.sgr[0] ?? 0) + 96, 128, 4) - 96
        : 0
      reference.sgr[1] = secondRadius
        ? this.#readRestorationSubexp((reference.sgr[1] ?? 0) + 32, 128, 4) - 32
        : Math.max(-32, Math.min(95, 128 - (reference.sgr[0] ?? 0)))
      planeState.sgrSets[unitIndex] = set
      planeState.sgrXqd[unitIndex * 2] = reference.sgr[0] ?? 0
      planeState.sgrXqd[unitIndex * 2 + 1] = reference.sgr[1] ?? 0
    }
  }

  #readRestorationSubexp(reference: number, maximum: number, bits: number): number {
    let offset = 0
    let width = bits
    if (this.#symbols.readBoolean() === 1) {
      if (this.#symbols.readBoolean() === 1) width += this.#symbols.readBoolean() + 1
      offset = 1 << width
    }
    const value = this.#symbols.readLiteral(width) + offset
    return reference * 2 <= maximum
      ? inverseRecenter(reference, value)
      : maximum - 1 - inverseRecenter(maximum - 1 - reference, value)
  }

  #decodePartition(row: number, column: number, size: number, edges: IntraEdgeNode): void {
    if (row >= this.#miRows || column >= this.#miColumns) return
    const blockMi = size >> 2
    const halfMi = blockMi >> 1
    const hasRows = row + halfMi < this.#miRows
    const hasColumns = column + halfMi < this.#miColumns
    let partition = 0
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
      if (hasRows && hasColumns) {
        partition = this.#symbols.readSymbol(partitionCdf)
      } else if (hasColumns) {
        partition = this.#symbols.readSymbol(edgePartitionCdf(partitionCdf, size, 'horizontal'))
          ? 3
          : 1
      } else if (hasRows) {
        partition = this.#symbols.readSymbol(edgePartitionCdf(partitionCdf, size, 'vertical'))
          ? 3
          : 2
      } else {
        partition = 3
      }
    }

    if (partition === 0 || size === 4) {
      this.#decodeBlock(row, column, size, size, edges.none)
      return
    }
    const half = size >> 1
    if (partition === 1) {
      this.#decodeBlock(row, column, size, half, edges.horizontal[0])
      if (hasRows) this.#decodeBlock(row + halfMi, column, size, half, edges.horizontal[1])
    } else if (partition === 2) {
      this.#decodeBlock(row, column, half, size, edges.vertical[0])
      if (hasColumns) this.#decodeBlock(row, column + halfMi, half, size, edges.vertical[1])
    } else if (partition === 3) {
      if (size === 8) {
        this.#decodeBlock(row, column, 4, 4, 63)
        this.#decodeBlock(row, column + 1, 4, 4, edges.tipSplit[0])
        this.#decodeBlock(row + 1, column, 4, 4, edges.tipSplit[1])
        this.#decodeBlock(row + 1, column + 1, 4, 4, edges.tipSplit[2])
      } else {
        const [topLeft, topRight, bottomLeft, bottomRight] = edges.split
        if (!topLeft || !topRight || !bottomLeft || !bottomRight) {
          throw invalidInput('AV1 intra edge split node is missing')
        }
        this.#decodePartition(row, column, half, topLeft)
        this.#decodePartition(row, column + halfMi, half, topRight)
        this.#decodePartition(row + halfMi, column, half, bottomLeft)
        this.#decodePartition(row + halfMi, column + halfMi, half, bottomRight)
      }
    } else if (partition === 4) {
      this.#decodeBlock(row, column, half, half, 63)
      this.#decodeBlock(row, column + halfMi, half, half, edges.vertical[1])
      this.#decodeBlock(row + halfMi, column, size, half, edges.horizontal[1])
    } else if (partition === 5) {
      this.#decodeBlock(row, column, size, half, edges.horizontal[0])
      this.#decodeBlock(row + halfMi, column, half, half, edges.vertical[0])
      this.#decodeBlock(row + halfMi, column + halfMi, half, half, 0)
    } else if (partition === 6) {
      this.#decodeBlock(row, column, half, half, 63)
      this.#decodeBlock(row + halfMi, column, half, half, edges.horizontal[1])
      this.#decodeBlock(row, column + halfMi, half, size, edges.vertical[1])
    } else if (partition === 7) {
      this.#decodeBlock(row, column, half, size, edges.vertical[0])
      this.#decodeBlock(row, column + halfMi, half, half, edges.horizontal[0])
      this.#decodeBlock(row + halfMi, column + halfMi, half, half, 0)
    } else if (partition === 8 || partition === 9) {
      const quarter = size >> 2
      const quarterMi = quarter >> 2
      for (let index = 0; index < 4; index += 1) {
        const childRow = row + (partition === 8 ? index * quarterMi : 0)
        const childColumn = column + (partition === 9 ? index * quarterMi : 0)
        if (childRow < this.#miRows && childColumn < this.#miColumns) {
          this.#decodeBlock(
            childRow,
            childColumn,
            partition === 8 ? size : quarter,
            partition === 8 ? quarter : size,
            partition === 8
              ? ([edges.horizontal[0], edges.horizontal4, 56, edges.horizontal[1]][index] ?? 0)
              : ([edges.vertical[0], edges.vertical4, 7, edges.vertical[1]][index] ?? 0),
          )
        }
      }
    } else throw invalidInput(`Invalid AV1 partition ${partition}`)
  }

  #decodeBlock(
    row: number,
    column: number,
    width: number,
    height: number,
    intraEdgeFlags: number,
  ): void {
    if (row >= this.#miRows || column >= this.#miColumns) return
    const blockColumns = width >> 2
    const blockRows = height >> 2
    const aboveSkip = row > 0 ? (this.#skips[(row - 1) * this.#miColumns + column] ?? 0) : 0
    const leftSkip = column > 0 ? (this.#skips[row * this.#miColumns + column - 1] ?? 0) : 0
    const skipCdf = this.#skipCdfs[aboveSkip + leftSkip]
    if (!skipCdf) throw invalidInput('AV1 skip context is invalid')
    const skip = this.#symbols.readSymbol(skipCdf)
    this.#readCdefIndex(row, column, width, height, skip === 1)
    this.#readDeltaQuantizer(row, column, width, height, skip === 1)
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
    if (yMode > 12) throw invalidInput(`Invalid AV1 luma intra mode ${yMode}`)
    const yAngleDelta = this.#readAngleDelta(yMode, width, height)
    const yEdgeSmooth = (aboveMode >= 9 && aboveMode <= 11) || (leftMode >= 9 && leftMode <= 11)

    const hasChroma = !(height === 4 && (row & 1) === 0) && !(width === 4 && (column & 1) === 0)
    let uvMode = 0
    let cflAlphaU = 0
    let cflAlphaV = 0
    if (hasChroma) {
      const cflAllowed = Math.max(width, height) <= 32
      const uvModeKey = `${Number(cflAllowed)}:${yMode}`
      let uvModeCdf = this.#uvModeCdfs.get(uvModeKey)
      if (!uvModeCdf) {
        const defaults = (cflAllowed ? uvModeDefaults : uvModeNoCflDefaults)[yMode]
        if (!defaults) throw invalidInput('AV1 chroma mode CDF is missing')
        uvModeCdf = cdf(defaults)
        this.#uvModeCdfs.set(uvModeKey, uvModeCdf)
      }
      uvMode = this.#symbols.readSymbol(uvModeCdf)
      if (uvMode > 13) throw invalidInput(`Invalid AV1 chroma intra mode ${uvMode}`)
      if (uvMode === 13) {
        const alphas = this.#readCflAlphas()
        cflAlphaU = alphas[0]
        cflAlphaV = alphas[1]
      }
    }
    const uvAngleDelta = this.#readAngleDelta(uvMode, width, height)
    const chromaRow = row >> 1
    const chromaColumn = column >> 1
    const aboveUvMode =
      chromaRow > 0
        ? (this.#uvModes[(chromaRow - 1) * this.#chromaMiColumns + chromaColumn] ?? 0)
        : 0
    const leftUvMode =
      chromaColumn > 0
        ? (this.#uvModes[chromaRow * this.#chromaMiColumns + chromaColumn - 1] ?? 0)
        : 0
    const uvEdgeSmooth =
      (aboveUvMode >= 9 && aboveUvMode <= 11) || (leftUvMode >= 9 && leftUvMode <= 11)
    let filterMode: number | undefined
    if (yMode === 0 && this.#sequence.enableFilterIntra && width <= 32 && height <= 32) {
      const filterKey = width * 256 + height
      let filterCdf = this.#filterCdfs.get(filterKey)
      if (!filterCdf) {
        const probability =
          width === 4 && height === 4
            ? 4621
            : width === 4 && height === 16
              ? 12770
              : width === 16 && height === 4
                ? 10368
                : width === 4 && height === 8
                  ? 6743
                  : width === 8 && height === 4
                    ? 5893
                    : width === 8 && height === 8
                      ? 7866
                      : width === 8 && height === 16
                        ? 12551
                        : width === 16 && height === 8
                          ? 9394
                          : width === 16 && height === 16
                            ? 12408
                            : width === 16 && height === 32
                              ? 14301
                              : width === 32 && height === 16
                                ? 12756
                                : width === 32 && height === 32
                                  ? 22343
                                  : width === 8 && height === 32
                                    ? 20229
                                    : width === 32 && height === 8
                                      ? 18101
                                      : undefined
        if (probability === undefined) {
          throw unsupportedOperation(`Unsupported AV1 filter-intra size ${width}x${height}`)
        }
        const defaults = [probability, 32768, 0]
        filterCdf = cdf(defaults)
        this.#filterCdfs.set(filterKey, filterCdf)
      }
      if (this.#symbols.readSymbol(filterCdf) !== 0) {
        filterMode = this.#symbols.readSymbol(this.#filterModeCdf)
        if (filterMode > 4) throw invalidInput(`Invalid AV1 filter-intra mode ${filterMode}`)
      }
    }

    const lumaTransform = this.#transformShape(row, column, width, height, skip === 1)
    const codedWidth = Math.min(width, (this.#miColumns - column) * 4)
    const codedHeight = Math.min(height, (this.#miRows - row) * 4)
    const chromaWidth = Math.max(4, width >> 1)
    const chromaHeight = Math.max(4, height >> 1)
    const codedChromaWidth = Math.min(chromaWidth, (((codedWidth >> 2) + 1) >> 1) * 4)
    const codedChromaHeight = Math.min(chromaHeight, (((codedHeight >> 2) + 1) >> 1) * 4)
    const chromaTransform: TransformShape = {
      width: Math.min(chromaWidth, 32) as TransformDimension,
      height: Math.min(chromaHeight, 32) as TransformDimension,
    }
    for (let chunkY = 0; chunkY < codedHeight; chunkY += 64) {
      for (let chunkX = 0; chunkX < codedWidth; chunkX += 64) {
        const chunkWidth = Math.min(64, codedWidth - chunkX)
        const chunkHeight = Math.min(64, codedHeight - chunkY)
        this.#decodePlane(
          0,
          row * 4 + chunkY,
          column * 4 + chunkX,
          chunkWidth,
          chunkHeight,
          lumaTransform,
          skip === 1,
          yMode,
          yAngleDelta,
          yEdgeSmooth,
          this.#transformEdgeFlags(
            chunkX,
            chunkY,
            codedWidth,
            codedHeight,
            chunkWidth,
            chunkHeight,
            (intraEdgeFlags & EDGE_LUMA_TOP_RIGHT) !== 0,
            (intraEdgeFlags & EDGE_LUMA_BOTTOM_LEFT) !== 0,
          ),
          filterMode,
        )
        if (hasChroma) {
          const chromaChunkX = chunkX >> 1
          const chromaChunkY = chunkY >> 1
          const chromaChunkWidth = chunkWidth >> 1
          const chromaChunkHeight = chunkHeight >> 1
          this.#decodePlane(
            1,
            (row >> 1) * 4 + chromaChunkY,
            (column >> 1) * 4 + chromaChunkX,
            chromaChunkWidth,
            chromaChunkHeight,
            chromaTransform,
            skip === 1,
            uvMode,
            uvAngleDelta,
            uvEdgeSmooth,
            this.#transformEdgeFlags(
              chromaChunkX,
              chromaChunkY,
              codedChromaWidth,
              codedChromaHeight,
              chromaChunkWidth,
              chromaChunkHeight,
              (intraEdgeFlags & EDGE_CHROMA_TOP_RIGHT) !== 0,
              (intraEdgeFlags & EDGE_CHROMA_BOTTOM_LEFT) !== 0,
            ),
            undefined,
            cflAlphaU,
            column * 4 + codedWidth,
            row * 4 + codedHeight,
          )
          this.#decodePlane(
            2,
            (row >> 1) * 4 + chromaChunkY,
            (column >> 1) * 4 + chromaChunkX,
            chromaChunkWidth,
            chromaChunkHeight,
            chromaTransform,
            skip === 1,
            uvMode,
            uvAngleDelta,
            uvEdgeSmooth,
            this.#transformEdgeFlags(
              chromaChunkX,
              chromaChunkY,
              codedChromaWidth,
              codedChromaHeight,
              chromaChunkWidth,
              chromaChunkHeight,
              (intraEdgeFlags & EDGE_CHROMA_TOP_RIGHT) !== 0,
              (intraEdgeFlags & EDGE_CHROMA_BOTTOM_LEFT) !== 0,
            ),
            undefined,
            cflAlphaV,
            column * 4 + codedWidth,
            row * 4 + codedHeight,
          )
        }
      }
    }
    for (let localRow = 0; localRow < blockRows; localRow += 1) {
      for (let localColumn = 0; localColumn < blockColumns; localColumn += 1) {
        const target = (row + localRow) * this.#miColumns + column + localColumn
        if (row + localRow < this.#miRows && column + localColumn < this.#miColumns) {
          this.#blockWidths[target] = width
          this.#blockHeights[target] = height
          this.#skips[target] = skip
          this.#yModes[target] = yMode
          this.#transformWidths[0][target] = lumaTransform.width
          this.#transformHeights[0][target] = lumaTransform.height
        }
      }
    }
    if (hasChroma) {
      const chromaRows = codedChromaHeight >> 2
      const chromaColumns = codedChromaWidth >> 2
      for (let localRow = 0; localRow < chromaRows; localRow += 1) {
        for (let localColumn = 0; localColumn < chromaColumns; localColumn += 1) {
          const contextRow = chromaRow + localRow
          const contextColumn = chromaColumn + localColumn
          const target = contextRow * this.#chromaMiColumns + contextColumn
          if (contextRow < this.#miRows >> 1 && contextColumn < this.#chromaMiColumns) {
            this.#uvModes[target] = uvMode
          }
        }
      }
    }
  }

  #transformEdgeFlags(
    chunkX: number,
    chunkY: number,
    blockWidth: number,
    blockHeight: number,
    chunkWidth: number,
    chunkHeight: number,
    blockTopRight: boolean,
    blockBottomLeft: boolean,
  ): number {
    const topRight = chunkX + chunkWidth < blockWidth || (chunkY === 0 && blockTopRight)
    const bottomLeft = chunkX === 0 && (chunkY + chunkHeight < blockHeight || blockBottomLeft)
    return (topRight ? EDGE_LUMA_TOP_RIGHT : 0) | (bottomLeft ? EDGE_LUMA_BOTTOM_LEFT : 0)
  }

  #readCdefIndex(row: number, column: number, width: number, height: number, skip: boolean): void {
    if (skip || this.#frame.header.codedLossless || !this.#sequence.enableCdef) return
    const unitRow = row >> 4
    const unitColumn = column >> 4
    const index = unitRow * this.#cdefColumns + unitColumn
    if ((this.#cdefIndices[index] ?? 0) !== 0) return
    const cdefIndex = this.#symbols.readLiteral(this.#frame.header.cdefBits)
    const blockRows = height >> 2
    const blockColumns = width >> 2
    for (let targetRow = row; targetRow < row + blockRows; targetRow += 16) {
      for (let targetColumn = column; targetColumn < column + blockColumns; targetColumn += 16) {
        const target = (targetRow >> 4) * this.#cdefColumns + (targetColumn >> 4)
        if (target < this.#cdefIndices.length) this.#cdefIndices[target] = cdefIndex + 1
      }
    }
  }

  #readAngleDelta(mode: number, width: number, height: number): number {
    if (width * height < 64 || mode < 1 || mode > 8) return 0
    const angleCdf = this.#angleDeltaCdfs[mode - 1]
    if (!angleCdf) throw invalidInput('AV1 angle-delta CDF is missing')
    return this.#symbols.readSymbol(angleCdf) - 3
  }

  #readCflAlphas(): readonly [number, number] {
    const signs = this.#symbols.readSymbol(this.#cflSignCdf)
    const signU = Math.floor((signs + 1) / 3)
    const signV = (signs + 1) % 3
    const readAlpha = (sign: number, otherSign: number): number => {
      if (sign === 0) return 0
      const context = (sign - 1) * 3 + otherSign
      const alphaCdf = this.#cflAlphaCdfs[context]
      if (!alphaCdf) throw invalidInput('AV1 chroma-from-luma alpha context is invalid')
      const magnitude = this.#symbols.readSymbol(alphaCdf) + 1
      return sign === 1 ? -magnitude : magnitude
    }
    return [readAlpha(signU, signV), readAlpha(signV, signU)]
  }

  #transformShape(
    row: number,
    column: number,
    blockWidth: number,
    blockHeight: number,
    skip: boolean,
  ): TransformShape {
    if (Math.max(blockWidth, blockHeight) <= 4 || this.#frame.header.transformMode === '4x4') {
      return { width: 4, height: 4 }
    }
    let width = Math.min(blockWidth, 64) as TransformDimension
    let height = Math.min(blockHeight, 64) as TransformDimension
    if (this.#frame.header.transformMode !== 'select' || skip) return { width, height }
    const category = Math.max(width, height) as 8 | 16 | 32 | 64
    const above =
      row > 0 ? (this.#transformWidths[0][(row - 1) * this.#miColumns + column] ?? 0) : 0
    const left =
      column > 0 ? (this.#transformHeights[0][row * this.#miColumns + column - 1] ?? 0) : 0
    const context = Number(above >= width) + Number(left >= height)
    const key = `${category}:${context}`
    let transformDepthCdf = this.#transformDepthCdfs.get(key)
    if (!transformDepthCdf) {
      const defaults = transformDepthDefaults.get(category)?.[context]
      if (!defaults) throw invalidInput('AV1 transform-depth CDF is missing')
      transformDepthCdf = cdf(defaults)
      this.#transformDepthCdfs.set(key, transformDepthCdf)
    }
    const depth = this.#symbols.readSymbol(transformDepthCdf)
    for (let index = 0; index < depth; index += 1) {
      if (width === height) {
        width = Math.max(4, width >> 1) as TransformDimension
        height = Math.max(4, height >> 1) as TransformDimension
      } else if (width > height) width = Math.max(4, width >> 1) as TransformDimension
      else height = Math.max(4, height >> 1) as TransformDimension
    }
    return { width, height }
  }

  #decodePlane(
    planeIndex: 0 | 1 | 2,
    startY: number,
    startX: number,
    width: number,
    height: number,
    transform: TransformShape,
    skip: boolean,
    mode: number,
    angleDelta: number,
    smoothEdge: boolean,
    chunkEdgeFlags: number,
    filterMode?: number,
    cflAlpha = 0,
    cflLumaEndX = 0,
    cflLumaEndY = 0,
  ): void {
    const plane = this.#planes[planeIndex]
    for (let y = 0; y < height; y += transform.height) {
      for (let x = 0; x < width; x += transform.width) {
        const topRightAvailable = !(
          (y > 0 || (chunkEdgeFlags & EDGE_LUMA_TOP_RIGHT) === 0) &&
          x + transform.width >= width
        )
        const bottomLeftAvailable = !(
          x > 0 ||
          ((chunkEdgeFlags & EDGE_LUMA_BOTTOM_LEFT) === 0 && y + transform.height >= height)
        )
        this.#predictIntra(
          planeIndex,
          plane,
          startX + x,
          startY + y,
          transform.width,
          transform.height,
          mode === 13 ? 0 : mode,
          angleDelta,
          smoothEdge,
          topRightAvailable,
          bottomLeftAvailable,
          filterMode,
        )
        if (planeIndex !== 0 && mode === 13) {
          this.#predictChromaFromLuma(
            plane,
            startX + x,
            startY + y,
            transform.width,
            transform.height,
            cflAlpha,
            cflLumaEndX,
            cflLumaEndY,
          )
        }
        const blockX = (startX + x) >> 2
        const blockY = (startY + y) >> 2
        const contextWidth = plane.width >> 2
        const contextHeight = plane.height >> 2
        const levelContexts = this.#levelContexts[planeIndex]
        const dcContexts = this.#dcContexts[planeIndex]
        const contextRows = transform.height >> 2
        const contextColumns = transform.width >> 2
        let aboveLevel = 0
        let leftLevel = 0
        let aboveCombined = 0
        let leftCombined = 0
        let dcSign = 0
        if (blockY > 0) {
          const aboveOffset = (blockY - 1) * contextWidth + blockX
          for (let contextX = 0; contextX < contextColumns; contextX += 1) {
            if (blockX + contextX >= contextWidth) break
            const level = levelContexts[aboveOffset + contextX] ?? 0
            const dc = dcContexts[aboveOffset + contextX] ?? 0
            aboveLevel = Math.max(aboveLevel, level)
            aboveCombined |= level | dc
            dcSign += dc === 1 ? -1 : dc === 2 ? 1 : 0
          }
        }
        if (blockX > 0) {
          for (let contextY = 0; contextY < contextRows; contextY += 1) {
            if (blockY + contextY >= contextHeight) break
            const index = (blockY + contextY) * contextWidth + blockX - 1
            const level = levelContexts[index] ?? 0
            const dc = dcContexts[index] ?? 0
            leftLevel = Math.max(leftLevel, level)
            leftCombined |= level | dc
            dcSign += dc === 1 ? -1 : dc === 2 ? 1 : 0
          }
        }
        const residualLargerThanTransform = width > transform.width || height > transform.height
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
            Number(aboveCombined !== 0) +
            Number(leftCombined !== 0) +
            (residualLargerThanTransform ? 3 : 0)
        }
        const coefficientWidth = coefficientDimension(transform.width)
        const coefficientHeight = coefficientDimension(transform.height)
        const coefficientTransformSupported =
          coefficientWidth !== undefined && coefficientHeight !== undefined
        if (!skip && !coefficientTransformSupported) {
          throw unsupportedOperation(
            `AV1 ${transform.width}x${transform.height} coefficient transforms`,
          )
        }
        const sizeContext = transformSizeContext(transform.width, transform.height)
        const allZeroCdfs =
          sizeContext === 0
            ? this.#allZero4x4Cdfs
            : sizeContext === 1
              ? this.#allZero8x8Cdfs
              : sizeContext === 2
                ? this.#allZero16x16Cdfs
                : sizeContext === 3
                  ? this.#allZero32x32Cdfs
                  : this.#allZero64x64Cdfs
        const zeroCdf = allZeroCdfs[zeroContext]
        if (!zeroCdf) throw invalidInput('AV1 all-zero coefficient context is invalid')
        let levelContext = 0
        let dcCategory = 0
        const allZero = skip ? 1 : this.#symbols.readSymbol(zeroCdf)
        if (!skip && allZero !== 1) {
          if (!coefficientTransformSupported) {
            throw invalidInput('AV1 coefficient transform size is missing')
          }
          const intraDirection =
            filterMode === undefined ? mode : (filterModeToDirection[filterMode] ?? mode)
          const transformCategory = Math.min(transform.width, transform.height)
          let txType: number | undefined =
            Math.max(transform.width, transform.height) >= 32 ? 0 : modeToTransform[mode]
          if (planeIndex === 0) {
            if (Math.max(transform.width, transform.height) >= 32) txType = 0
            else {
              const txTypeKey = `${transformCategory}:${intraDirection}`
              let txTypeCdf = this.#intraTxTypeCdfs.get(txTypeKey)
              if (!txTypeCdf) {
                const defaults =
                  transformCategory === 4
                    ? intraTxTypeDefaults[intraDirection]
                    : transformCategory === 8
                      ? intraTxType8x8Defaults[intraDirection]
                      : intraTxType16x16Defaults[intraDirection]
                if (!defaults) throw invalidInput('AV1 intra transform CDF is missing')
                txTypeCdf = cdf(defaults)
                this.#intraTxTypeCdfs.set(txTypeKey, txTypeCdf)
              }
              txType = (transformCategory === 16 ? intraTxTypes16x16 : intraTxTypes)[
                this.#symbols.readSymbol(txTypeCdf)
              ]
            }
          }
          if (txType === undefined) throw invalidInput('AV1 transform type is invalid')
          const block = this.#coefficients.read(
            planeIndex,
            coefficientWidth,
            coefficientHeight,
            txType,
            dcSign < 0 ? 1 : dcSign > 0 ? 2 : 0,
          )
          levelContext = block.levelContext
          dcCategory = block.dcCategory
          const residual = inverseTransform(
            block.coefficients,
            coefficientWidth,
            coefficientHeight,
            txType,
            planeIndex,
            this.#frame.header,
            this.#currentQuantizer,
          )
          for (
            let localY = 0;
            localY < transform.height && startY + y + localY < plane.height;
            localY += 1
          ) {
            for (
              let localX = 0;
              localX < transform.width && startX + x + localX < plane.width;
              localX += 1
            ) {
              const target = (startY + y + localY) * plane.stride + startX + x + localX
              plane.data[target] = Math.max(
                0,
                Math.min(
                  255,
                  (plane.data[target] ?? 0) + (residual[localY * transform.width + localX] ?? 0),
                ),
              )
            }
          }
        }
        for (let contextY = 0; contextY < contextRows; contextY += 1) {
          for (let contextX = 0; contextX < contextColumns; contextX += 1) {
            if (blockY + contextY >= contextHeight || blockX + contextX >= contextWidth) continue
            const contextIndex = (blockY + contextY) * contextWidth + blockX + contextX
            levelContexts[contextIndex] = levelContext
            dcContexts[contextIndex] = dcCategory
            this.#reconstructedContexts[planeIndex][contextIndex] = 1
            this.#transformWidths[planeIndex][contextIndex] = transform.width
            this.#transformHeights[planeIndex][contextIndex] = transform.height
          }
        }
      }
    }
  }

  #readDeltaQuantizer(
    row: number,
    column: number,
    width: number,
    height: number,
    skip: boolean,
  ): void {
    if (!this.#frame.header.deltaQPresent) return
    const superblockSize = this.#sequence.use128x128Superblock ? 128 : 64
    const superblockMi = superblockSize >> 2
    if (((row | column) & (superblockMi - 1)) !== 0) return
    if (width === superblockSize && height === superblockSize && skip) return

    let delta = this.#symbols.readSymbol(this.#deltaQCdf)
    if (delta === 3) {
      const bits = 1 + this.#symbols.readLiteral(3)
      delta = this.#symbols.readLiteral(bits) + 1 + 2 ** bits
    }
    if (delta !== 0 && this.#symbols.readBoolean() === 1) delta = -delta
    delta *= 2 ** this.#frame.header.deltaQResolution
    this.#currentQuantizer = Math.max(1, Math.min(255, this.#currentQuantizer + delta))
  }

  #predictIntra(
    planeIndex: 0 | 1 | 2,
    plane: Plane,
    x: number,
    y: number,
    width: number,
    height: number,
    mode: number,
    angleDelta: number,
    smoothEdge: boolean,
    topRightAvailable: boolean,
    bottomLeftAvailable: boolean,
    filterMode?: number,
  ): void {
    const reconstructed = this.#reconstructedContexts[planeIndex]
    const contextWidth = plane.width >> 2
    const isReconstructed = (sampleX: number, sampleY: number): boolean => {
      if (sampleX < 0 || sampleY < 0 || sampleX >= plane.width || sampleY >= plane.height) {
        return false
      }
      return (reconstructed[(sampleY >> 2) * contextWidth + (sampleX >> 2)] ?? 0) !== 0
    }
    const haveAbove = y > 0
    const haveLeft = x > 0
    if (filterMode !== undefined) {
      this.#predictFiltered(plane, x, y, width, height, filterMode)
      return
    }
    const edgeLength = width + height
    const extraEdgeLength = Math.min(width, height)
    const aboveAvailableLength = width + (topRightAvailable ? extraEdgeLength : 0)
    const leftAvailableLength = height + (bottomLeftAvailable ? extraEdgeLength : 0)
    const above = new Uint8Array(edgeLength)
    const left = new Uint8Array(edgeLength)
    let topLeft =
      haveAbove && haveLeft
        ? (plane.data[(y - 1) * plane.stride + x - 1] ?? 128)
        : haveAbove
          ? (plane.data[(y - 1) * plane.stride + x] ?? 128)
          : haveLeft
            ? (plane.data[y * plane.stride + x - 1] ?? 128)
            : 128
    for (let index = 0; index < edgeLength; index += 1) {
      const aboveX = Math.min(x + index, plane.width - 1)
      const leftY = Math.min(y + index, plane.height - 1)
      above[index] =
        haveAbove &&
        (index < width ||
          (index < aboveAvailableLength && (planeIndex === 0 || isReconstructed(aboveX, y - 1))))
          ? (plane.data[(y - 1) * plane.stride + aboveX] ?? 128)
          : index > 0
            ? (above[index - 1] ?? 128)
            : haveLeft
              ? (plane.data[y * plane.stride + x - 1] ?? 128)
              : 127
      left[index] =
        haveLeft &&
        (index < height ||
          (index < leftAvailableLength && (planeIndex === 0 || isReconstructed(x - 1, leftY))))
          ? (plane.data[leftY * plane.stride + x - 1] ?? 128)
          : index > 0
            ? (left[index - 1] ?? 128)
            : haveAbove
              ? (plane.data[(y - 1) * plane.stride + x] ?? 128)
              : 129
    }
    let dc = 128
    if (mode === 0 && (haveAbove || haveLeft)) {
      let sum = 0
      if (haveAbove) for (let index = 0; index < width; index += 1) sum += above[index] ?? 128
      if (haveLeft) for (let index = 0; index < height; index += 1) sum += left[index] ?? 128
      const count = (haveAbove ? width : 0) + (haveLeft ? height : 0)
      dc = Math.floor((sum + (count >> 1)) / count)
    }
    const angle = mode >= 1 && mode <= 8 ? (modeToAngle[mode] ?? 0) + angleDelta * 3 : 0
    let upsampleAbove = false
    let upsampleLeft = false
    if (mode >= 1 && mode <= 8 && this.#sequence.enableIntraEdgeFilter) {
      if (angle > 90 && angle < 180 && width + height >= 24) {
        topLeft = ((left[0] ?? topLeft) * 5 + topLeft * 6 + (above[0] ?? topLeft) * 5 + 8) >> 4
      }
      if (angle !== 90 && angle !== 180) {
        const aboveStrength = intraEdgeStrength(width + height, angle - 90, smoothEdge)
        const aboveCount = Math.min(width, plane.width - x) + (angle < 90 ? height : 0)
        filterIntraEdge(above, topLeft, aboveCount, aboveStrength)
        const leftStrength = intraEdgeStrength(width + height, angle - 180, smoothEdge)
        const leftCount = Math.min(height, plane.height - y) + (angle > 180 ? width : 0)
        filterIntraEdge(left, topLeft, leftCount, leftStrength)
      }
      const upsampleLimit = smoothEdge ? 8 : 16
      const aboveDistance = Math.abs(angle - 90)
      const leftDistance = Math.abs(angle - 180)
      upsampleAbove = aboveDistance > 0 && aboveDistance < 40 && width + height <= upsampleLimit
      upsampleLeft = leftDistance > 0 && leftDistance < 40 && width + height <= upsampleLimit
    }
    const aboveUpsampleCount = width + (angle < 90 ? height : 0)
    const leftUpsampleCount = height + (angle > 180 ? width : 0)
    const expandedAbove = upsampleAbove
      ? upsampleIntraEdge(above.subarray(0, aboveUpsampleCount), topLeft)
      : undefined
    const expandedLeft = upsampleLeft
      ? upsampleIntraEdge(left.subarray(0, leftUpsampleCount), topLeft)
      : undefined
    const directionalSample = (
      samples: Uint8Array,
      expanded: UpsampledIntraEdge | undefined,
      index: number,
    ): number => {
      if (!expanded) {
        if (index < 0) return topLeft
        return samples[Math.min(index, samples.length - 1)] ?? 128
      }
      const sampleIndex = Math.max(
        0,
        Math.min(expanded.samples.length - 1, index + expanded.offset),
      )
      return expanded.samples[sampleIndex] ?? 128
    }
    const aboveSample = (index: number): number => directionalSample(above, expandedAbove, index)
    const leftSample = (index: number): number => directionalSample(left, expandedLeft, index)
    const dx =
      angle < 90
        ? (directionalDerivatives[angle] ?? 0)
        : angle < 180
          ? (directionalDerivatives[180 - angle] ?? 0)
          : 0
    const dy =
      angle > 90 && angle < 180
        ? (directionalDerivatives[angle - 90] ?? 0)
        : angle > 180
          ? (directionalDerivatives[270 - angle] ?? 0)
          : 0
    const weightsX = smoothWeights.get(width)
    const weightsY = smoothWeights.get(height)
    for (let localY = 0; localY < height && y + localY < plane.height; localY += 1) {
      for (let localX = 0; localX < width && x + localX < plane.width; localX += 1) {
        let prediction: number
        if (mode === 0) prediction = dc
        else if (mode === 12) {
          const base = (above[localX] ?? 128) + (left[localY] ?? 128) - topLeft
          const distanceLeft = Math.abs(base - (left[localY] ?? 128))
          const distanceAbove = Math.abs(base - (above[localX] ?? 128))
          const distanceCorner = Math.abs(base - topLeft)
          prediction =
            distanceLeft <= distanceAbove && distanceLeft <= distanceCorner
              ? (left[localY] ?? 128)
              : distanceAbove <= distanceCorner
                ? (above[localX] ?? 128)
                : topLeft
        } else if (mode >= 9 && mode <= 11) {
          if (!weightsX || !weightsY)
            throw unsupportedOperation(`Smooth AV1 prediction size ${width}x${height}`)
          const weightX = weightsX[localX] ?? 0
          const weightY = weightsY[localY] ?? 0
          if (mode === 9) {
            prediction = Math.floor(
              (weightY * (above[localX] ?? 128) +
                (256 - weightY) * (left[height - 1] ?? 128) +
                weightX * (left[localY] ?? 128) +
                (256 - weightX) * (above[width - 1] ?? 128) +
                256) /
                512,
            )
          } else if (mode === 10) {
            prediction = Math.floor(
              (weightY * (above[localX] ?? 128) +
                (256 - weightY) * (left[height - 1] ?? 128) +
                128) /
                256,
            )
          } else {
            prediction = Math.floor(
              (weightX * (left[localY] ?? 128) +
                (256 - weightX) * (above[width - 1] ?? 128) +
                128) /
                256,
            )
          }
        } else if (angle < 90) {
          const index = (localY + 1) * dx
          const base = (index >> (upsampleAbove ? 5 : 6)) + (localX << Number(upsampleAbove))
          const shift = ((index << Number(upsampleAbove)) >> 1) & 31
          prediction = Math.floor(
            (aboveSample(base) * (32 - shift) + aboveSample(base + 1) * shift + 16) / 32,
          )
        } else if (angle > 90 && angle < 180) {
          const index = (localX << 6) - (localY + 1) * dx
          const base = index >> (upsampleAbove ? 5 : 6)
          const shift = ((index << Number(upsampleAbove)) >> 1) & 31
          if (base >= -(1 << Number(upsampleAbove))) {
            prediction = Math.floor(
              (aboveSample(base) * (32 - shift) + aboveSample(base + 1) * shift + 16) / 32,
            )
          } else {
            const leftIndex = (localY << 6) - (localX + 1) * dy
            const leftBase = leftIndex >> (upsampleLeft ? 5 : 6)
            const leftShift = ((leftIndex << Number(upsampleLeft)) >> 1) & 31
            prediction = Math.floor(
              (leftSample(leftBase) * (32 - leftShift) +
                leftSample(leftBase + 1) * leftShift +
                16) /
                32,
            )
          }
        } else if (angle > 180) {
          const index = (localX + 1) * dy
          const base = (index >> (upsampleLeft ? 5 : 6)) + (localY << Number(upsampleLeft))
          const shift = ((index << Number(upsampleLeft)) >> 1) & 31
          prediction = Math.floor(
            (leftSample(base) * (32 - shift) + leftSample(base + 1) * shift + 16) / 32,
          )
        } else if (angle === 90) prediction = above[localX] ?? 128
        else if (angle === 180) prediction = left[localY] ?? 128
        else throw invalidInput(`Invalid AV1 intra prediction mode ${mode}`)
        plane.data[(y + localY) * plane.stride + x + localX] = prediction
      }
    }
  }

  #predictChromaFromLuma(
    plane: Plane,
    x: number,
    y: number,
    width: number,
    height: number,
    alpha: number,
    lumaEndX: number,
    lumaEndY: number,
  ): void {
    const luma = this.#planes[0]
    const samples = new Uint16Array(width * height)
    let sum = 0
    for (let localY = 0; localY < height; localY += 1) {
      for (let localX = 0; localX < width; localX += 1) {
        const lumaX = Math.min((x + localX) * 2, lumaEndX - 2)
        const lumaY = Math.min((y + localY) * 2, lumaEndY - 2)
        const value =
          ((luma.data[lumaY * luma.stride + lumaX] ?? 0) +
            (luma.data[lumaY * luma.stride + lumaX + 1] ?? 0) +
            (luma.data[(lumaY + 1) * luma.stride + lumaX] ?? 0) +
            (luma.data[(lumaY + 1) * luma.stride + lumaX + 1] ?? 0)) *
          2
        samples[localY * width + localX] = value
        sum += value
      }
    }
    const average = Math.floor((sum + (width * height) / 2) / (width * height))
    for (let localY = 0; localY < height && y + localY < plane.height; localY += 1) {
      for (let localX = 0; localX < width && x + localX < plane.width; localX += 1) {
        const difference = alpha * ((samples[localY * width + localX] ?? average) - average)
        const scaled = Math.sign(difference) * Math.floor((Math.abs(difference) + 32) / 64)
        const target = (y + localY) * plane.stride + x + localX
        plane.data[target] = Math.max(0, Math.min(255, (plane.data[target] ?? 128) + scaled))
      }
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
    const corner =
      haveAbove && haveLeft
        ? (plane.data[(y - 1) * plane.stride + x - 1] ?? 128)
        : haveAbove
          ? (plane.data[(y - 1) * plane.stride + Math.min(x, plane.width - 1)] ?? 128)
          : haveLeft
            ? (plane.data[y * plane.stride + x - 1] ?? 128)
            : 128
    const edgeLength = width + height
    const above = new Uint8Array(edgeLength)
    const left = new Uint8Array(edgeLength)
    const defaultAbove = haveLeft ? (plane.data[y * plane.stride + x - 1] ?? 127) : 127
    const defaultLeft = haveAbove ? (plane.data[(y - 1) * plane.stride + x] ?? 129) : 129
    for (let index = 0; index < edgeLength; index += 1) {
      above[index] = haveAbove
        ? (plane.data[(y - 1) * plane.stride + Math.min(x + index, plane.width - 1)] ?? 127)
        : defaultAbove
      left[index] = haveLeft
        ? (plane.data[Math.min(y + index, plane.height - 1) * plane.stride + x - 1] ?? 129)
        : defaultLeft
    }
    const neighbors = new Uint8Array(7)
    for (let rowPair = 0; rowPair < height / 2; rowPair += 1) {
      for (let columnGroup = 0; columnGroup < width / 4; columnGroup += 1) {
        for (let index = 0; index < 7; index += 1) {
          if (index < 5) {
            if (rowPair === 0) {
              const aboveIndex = columnGroup * 4 + index - 1
              neighbors[index] = aboveIndex < 0 ? corner : (above[aboveIndex] ?? 127)
            } else if (columnGroup === 0 && index === 0) {
              neighbors[index] = left[rowPair * 2 - 1] ?? 129
            } else {
              neighbors[index] =
                plane.data[
                  (y + rowPair * 2 - 1) * plane.stride + x + columnGroup * 4 + index - 1
                ] ?? 128
            }
          } else if (columnGroup === 0) {
            neighbors[index] = left[rowPair * 2 + index - 5] ?? 129
          } else {
            neighbors[index] =
              plane.data[(y + rowPair * 2 + index - 5) * plane.stride + x + columnGroup * 4 - 1] ??
              128
          }
        }
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
  if (frame.header.frameWidth !== frame.header.upscaledWidth) {
    throw unsupportedOperation('Phase B2 reconstruction does not support AV1 super-resolution')
  }
  if (frame.header.segmentationEnabled) {
    throw unsupportedOperation('Phase B2 reconstruction does not support AV1 segmentation maps')
  }
  if (frame.header.deltaLfPresent) {
    throw unsupportedOperation('Phase B2 reconstruction does not support AV1 loop-filter deltas')
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
  const decoder = new RestrictedIntraTileDecoder(sequence, frame, [y, u, v])
  decoder.decode()
  const filtered = applyAv1PostFilters([y, u, v], frame.header, decoder.postFilterState())
  return {
    width: frame.header.frameWidth,
    height: frame.header.frameHeight,
    chromaWidth: Math.ceil(frame.header.frameWidth / 2),
    chromaHeight: Math.ceil(frame.header.frameHeight / 2),
    yStride,
    chromaStride,
    y: filtered[0].data,
    u: filtered[1].data,
    v: filtered[2].data,
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
