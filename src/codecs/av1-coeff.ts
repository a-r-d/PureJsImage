import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { Av1SymbolDecoder } from './av1-symbol.ts'
import { coefficientQ2Defaults } from './av1-coeff-q2.ts'
import { av1LargeScans } from './av1-scans.ts'

const defaultScan4x4 = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15] as const
const defaultScan8x8 = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
] as const
const defaultScan4x8 = [
  0, 1, 4, 2, 5, 8, 3, 6, 9, 12, 7, 10, 13, 16, 11, 14, 17, 20, 15, 18, 21, 24, 19, 22, 25, 28, 23,
  26, 29, 27, 30, 31,
] as const
const defaultScan8x4 = [
  0, 8, 1, 16, 9, 2, 24, 17, 10, 3, 25, 18, 11, 4, 26, 19, 12, 5, 27, 20, 13, 6, 28, 21, 14, 7, 29,
  22, 15, 30, 23, 31,
] as const
const significantOffsets = [
  [0, 1],
  [1, 0],
  [1, 1],
  [0, 2],
  [2, 0],
] as const
const magnitudeOffsets = [
  [0, 1],
  [1, 0],
  [1, 1],
] as const
const significantOffsetsByClass = [
  significantOffsets,
  [
    [0, 1],
    [1, 0],
    [0, 2],
    [0, 3],
    [0, 4],
  ],
  [
    [0, 1],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ],
] as const
const magnitudeOffsetsByClass = [
  magnitudeOffsets,
  [
    [0, 1],
    [1, 0],
    [0, 2],
  ],
  [
    [0, 1],
    [1, 0],
    [2, 0],
  ],
] as const
const coefficientContextOffsets = [
  [0, 1, 6, 6, 21],
  [1, 6, 6, 21, 21],
  [6, 6, 21, 21, 21],
  [6, 21, 21, 21, 21],
  [21, 21, 21, 21, 21],
] as const

const eobPointClassDefaults = {
  eob4: [
    [
      [6708, 8958, 14746, 22133, 32768, 0],
      [1222, 2074, 4783, 15410, 32768, 0],
    ],
    [
      [19575, 21766, 26044, 29709, 32768, 0],
      [7297, 10767, 19273, 28194, 32768, 0],
    ],
  ],
  eob4x8: [
    [
      [4617, 5709, 8446, 13584, 23135, 32768, 0],
      [1156, 1702, 3675, 9274, 20539, 32768, 0],
    ],
    [
      [22086, 24282, 27010, 29770, 31743, 32768, 0],
      [7699, 10897, 20891, 26926, 31628, 32768, 0],
    ],
  ],
  eob8: [
    [
      [6307, 7541, 12060, 16358, 22553, 27865, 32768, 0],
      [1289, 2320, 3971, 7926, 14153, 24291, 32768, 0],
    ],
    [
      [24212, 25708, 28268, 30035, 31307, 32049, 32768, 0],
      [8726, 12378, 19409, 26450, 30038, 32462, 32768, 0],
    ],
  ],
  eob8x16: [
    [
      [3472, 4885, 7489, 12481, 18517, 24536, 29635, 32768, 0],
      [886, 1731, 3271, 8469, 15569, 22126, 28383, 32768, 0],
    ],
    [
      [24313, 26062, 28385, 30107, 31217, 31898, 32345, 32768, 0],
      [9165, 13282, 21150, 30286, 31894, 32571, 32712, 32768, 0],
    ],
  ],
} as const
const eobExtraDefaults = [
  [20177, 20789, 20262],
  [21416, 20855, 23410],
] as const
const eobExtra8x8Defaults = [
  [20238, 21057, 19159, 22337, 20159, 16384, 16384, 16384, 16384],
  [20125, 20559, 21707, 22296, 17333, 16384, 16384, 16384, 16384],
] as const
const dcSignDefaults = [
  [16000, 13056, 18816],
  [15232, 12928, 17280],
] as const
const coefficientBaseEobDefaults = [
  [
    [22497, 31198, 32768, 0],
    [31715, 32495, 32768, 0],
    [31606, 32337, 32768, 0],
    [30388, 31990, 32768, 0],
  ],
  [
    [27877, 31584, 32768, 0],
    [32170, 32728, 32768, 0],
    [32155, 32688, 32768, 0],
    [32219, 32702, 32768, 0],
  ],
] as const
const coefficientBaseEob8x8Defaults = [
  [
    [21457, 31043, 32768, 0],
    [31951, 32483, 32768, 0],
    [32153, 32562, 32768, 0],
    [31473, 32215, 32768, 0],
  ],
  [
    [27558, 31151, 32768, 0],
    [32020, 32640, 32768, 0],
    [32097, 32575, 32768, 0],
    [32242, 32719, 32768, 0],
  ],
] as const
const coefficientBaseDefaults = [
  [
    [7062, 16472, 22319, 32768, 0],
    [24538, 32261, 32674, 32768, 0],
    [13675, 28041, 31779, 32768, 0],
    [8590, 20674, 27631, 32768, 0],
    [5685, 14675, 22013, 32768, 0],
    [3655, 9898, 15731, 32768, 0],
    [26493, 32418, 32658, 32768, 0],
    [16376, 29342, 32090, 32768, 0],
    [10594, 22649, 28970, 32768, 0],
    [8176, 17170, 24303, 32768, 0],
    [5605, 12694, 19139, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [23888, 31902, 32542, 32768, 0],
    [18612, 29687, 31987, 32768, 0],
    [16245, 24852, 29249, 32768, 0],
    [15765, 22608, 27559, 32768, 0],
    [19895, 24699, 27510, 32768, 0],
    [28401, 32212, 32457, 32768, 0],
    [15274, 27825, 30980, 32768, 0],
    [9364, 18128, 24332, 32768, 0],
    [2283, 8193, 15082, 32768, 0],
    [1228, 3972, 7881, 32768, 0],
    [29455, 32469, 32620, 32768, 0],
    [17981, 28245, 31388, 32768, 0],
    [10921, 20098, 26240, 32768, 0],
    [3743, 11829, 18657, 32768, 0],
    [2374, 9593, 15715, 32768, 0],
    [31068, 32466, 32635, 32768, 0],
    [20321, 29572, 31971, 32768, 0],
    [10771, 20255, 27119, 32768, 0],
    [2795, 10410, 17361, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
  ],
  [
    [9320, 22102, 27840, 32768, 0],
    [27057, 32464, 32724, 32768, 0],
    [16331, 30268, 32309, 32768, 0],
    [10319, 23935, 29720, 32768, 0],
    [6189, 16448, 24106, 32768, 0],
    [3589, 10884, 18808, 32768, 0],
    [29026, 32624, 32748, 32768, 0],
    [19226, 31507, 32587, 32768, 0],
    [12692, 26921, 31203, 32768, 0],
    [7049, 19532, 27635, 32768, 0],
    [7727, 15669, 23252, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [28056, 32625, 32748, 32768, 0],
    [22383, 32075, 32669, 32768, 0],
    [15417, 27098, 31749, 32768, 0],
    [18127, 26493, 27190, 32768, 0],
    [5461, 16384, 21845, 32768, 0],
    [27982, 32091, 32584, 32768, 0],
    [19045, 29868, 31972, 32768, 0],
    [10397, 22266, 27932, 32768, 0],
    [5990, 13697, 21500, 32768, 0],
    [1792, 6912, 15104, 32768, 0],
    [28198, 32501, 32718, 32768, 0],
    [21534, 31521, 32569, 32768, 0],
    [11109, 25217, 30017, 32768, 0],
    [5671, 15124, 26151, 32768, 0],
    [4681, 14043, 18725, 32768, 0],
    [28688, 32580, 32741, 32768, 0],
    [22576, 32079, 32661, 32768, 0],
    [10627, 22141, 28340, 32768, 0],
    [9362, 14043, 28087, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
  ],
] as const
const coefficientRangeDefaults = [
  [
    [18315, 24289, 27551, 32768, 0],
    [16854, 24068, 27835, 32768, 0],
    [10140, 17927, 23173, 32768, 0],
    [6722, 12982, 18267, 32768, 0],
    [4661, 9826, 14706, 32768, 0],
    [3832, 8165, 12294, 32768, 0],
    [2795, 6098, 9245, 32768, 0],
    [17145, 23326, 26672, 32768, 0],
    [20733, 27680, 30308, 32768, 0],
    [16032, 24461, 28546, 32768, 0],
    [11653, 20093, 25081, 32768, 0],
    [9290, 16429, 22086, 32768, 0],
    [7796, 14598, 19982, 32768, 0],
    [6502, 12378, 17441, 32768, 0],
    [21681, 27732, 30320, 32768, 0],
    [22389, 29044, 31261, 32768, 0],
    [19027, 26731, 30087, 32768, 0],
    [14739, 23755, 28624, 32768, 0],
    [11358, 20778, 25511, 32768, 0],
    [10995, 18073, 24190, 32768, 0],
    [9162, 14990, 20617, 32768, 0],
  ],
  [
    [21425, 27952, 30388, 32768, 0],
    [18062, 25838, 29034, 32768, 0],
    [11956, 19881, 24808, 32768, 0],
    [7718, 15000, 20980, 32768, 0],
    [5702, 11254, 16143, 32768, 0],
    [4898, 9088, 16864, 32768, 0],
    [3679, 6776, 11907, 32768, 0],
    [23294, 30160, 31663, 32768, 0],
    [24397, 29896, 31836, 32768, 0],
    [19245, 27128, 30593, 32768, 0],
    [13202, 19825, 26404, 32768, 0],
    [11578, 19297, 23957, 32768, 0],
    [8073, 13297, 21370, 32768, 0],
    [5461, 10923, 19745, 32768, 0],
    [27367, 30521, 31934, 32768, 0],
    [24904, 30671, 31940, 32768, 0],
    [23075, 28460, 31299, 32768, 0],
    [14400, 23658, 30417, 32768, 0],
    [13885, 23882, 28325, 32768, 0],
    [14746, 22938, 27853, 32768, 0],
    [5461, 16384, 27307, 32768, 0],
  ],
] as const
const coefficientBase8x8Defaults = [
  [
    [7754, 16948, 22142, 32768, 0],
    [25670, 32330, 32691, 32768, 0],
    [15663, 29225, 31994, 32768, 0],
    [9878, 23288, 29158, 32768, 0],
    [6419, 17088, 24336, 32768, 0],
    [3859, 11003, 17039, 32768, 0],
    [27562, 32595, 32725, 32768, 0],
    [17575, 30588, 32399, 32768, 0],
    [10819, 24838, 30309, 32768, 0],
    [7124, 18686, 25916, 32768, 0],
    [4479, 12688, 19340, 32768, 0],
    [28385, 32476, 32673, 32768, 0],
    [15306, 29005, 31938, 32768, 0],
    [8937, 21615, 28322, 32768, 0],
    [5982, 15603, 22786, 32768, 0],
    [3620, 10267, 16136, 32768, 0],
    [27280, 32464, 32667, 32768, 0],
    [15607, 29160, 32004, 32768, 0],
    [9091, 22135, 28740, 32768, 0],
    [6232, 16632, 24020, 32768, 0],
    [4047, 11377, 17672, 32768, 0],
    [29220, 32630, 32718, 32768, 0],
    [19650, 31220, 32462, 32768, 0],
    [13050, 26312, 30827, 32768, 0],
    [9228, 20870, 27468, 32768, 0],
    [6146, 15149, 21971, 32768, 0],
    [30169, 32481, 32623, 32768, 0],
    [17212, 29311, 31554, 32768, 0],
    [9911, 21311, 26882, 32768, 0],
    [4487, 13314, 20372, 32768, 0],
    [2570, 7772, 12889, 32768, 0],
    [30924, 32613, 32708, 32768, 0],
    [19490, 30206, 32107, 32768, 0],
    [11232, 23998, 29276, 32768, 0],
    [6769, 17955, 25035, 32768, 0],
    [4398, 12623, 19214, 32768, 0],
    [30609, 32627, 32722, 32768, 0],
    [19370, 30582, 32287, 32768, 0],
    [10457, 23619, 29409, 32768, 0],
    [6443, 17637, 24834, 32768, 0],
    [4645, 13236, 20106, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
  ],
  [
    [8626, 20271, 26216, 32768, 0],
    [26707, 32406, 32711, 32768, 0],
    [16999, 30329, 32286, 32768, 0],
    [11445, 25123, 30286, 32768, 0],
    [6411, 18828, 25601, 32768, 0],
    [6801, 12458, 20248, 32768, 0],
    [29918, 32682, 32748, 32768, 0],
    [20649, 31739, 32618, 32768, 0],
    [12879, 27773, 31581, 32768, 0],
    [7896, 21751, 28244, 32768, 0],
    [5260, 14870, 23698, 32768, 0],
    [29252, 32593, 32731, 32768, 0],
    [17072, 30460, 32294, 32768, 0],
    [10653, 24143, 29365, 32768, 0],
    [6536, 17490, 23983, 32768, 0],
    [4929, 13170, 20085, 32768, 0],
    [28137, 32518, 32715, 32768, 0],
    [18171, 30784, 32407, 32768, 0],
    [11437, 25436, 30459, 32768, 0],
    [7252, 18534, 26176, 32768, 0],
    [4126, 13353, 20978, 32768, 0],
    [31162, 32726, 32748, 32768, 0],
    [23017, 32222, 32701, 32768, 0],
    [15629, 29233, 32046, 32768, 0],
    [9387, 22621, 29480, 32768, 0],
    [6922, 17616, 25010, 32768, 0],
    [28838, 32265, 32614, 32768, 0],
    [19701, 30206, 31920, 32768, 0],
    [11214, 22410, 27933, 32768, 0],
    [5320, 14177, 23034, 32768, 0],
    [5049, 12881, 17827, 32768, 0],
    [27484, 32471, 32734, 32768, 0],
    [21076, 31526, 32561, 32768, 0],
    [12707, 26303, 31211, 32768, 0],
    [8169, 21722, 28219, 32768, 0],
    [6045, 19406, 27042, 32768, 0],
    [27753, 32572, 32745, 32768, 0],
    [20832, 31878, 32653, 32768, 0],
    [13250, 27356, 31674, 32768, 0],
    [7718, 21508, 29858, 32768, 0],
    [7209, 18350, 25559, 32768, 0],
    [8192, 16384, 24576, 32768, 0],
  ],
] as const
const coefficientRange8x8Defaults = [
  [
    [18274, 24813, 27890, 32768, 0],
    [15537, 23149, 27003, 32768, 0],
    [9449, 16740, 21827, 32768, 0],
    [6700, 12498, 17261, 32768, 0],
    [4988, 9866, 14198, 32768, 0],
    [4236, 8147, 11902, 32768, 0],
    [2867, 5860, 8654, 32768, 0],
    [17124, 23171, 26101, 32768, 0],
    [20396, 27477, 30148, 32768, 0],
    [16573, 24629, 28492, 32768, 0],
    [12749, 20846, 25674, 32768, 0],
    [10233, 17878, 22818, 32768, 0],
    [8525, 15332, 20363, 32768, 0],
    [6283, 11632, 16255, 32768, 0],
    [20466, 26511, 29286, 32768, 0],
    [23059, 29174, 31191, 32768, 0],
    [19481, 27263, 30241, 32768, 0],
    [15458, 23631, 28137, 32768, 0],
    [12416, 20608, 25693, 32768, 0],
    [10261, 18011, 23261, 32768, 0],
    [8016, 14655, 19666, 32768, 0],
  ],
  [
    [17616, 24586, 28112, 32768, 0],
    [15809, 23299, 27155, 32768, 0],
    [10767, 18890, 23793, 32768, 0],
    [7727, 14255, 18865, 32768, 0],
    [6129, 11926, 16882, 32768, 0],
    [4482, 9704, 14861, 32768, 0],
    [3277, 7452, 11522, 32768, 0],
    [22956, 28551, 30730, 32768, 0],
    [22724, 28937, 30961, 32768, 0],
    [18467, 26324, 29580, 32768, 0],
    [13234, 20713, 25649, 32768, 0],
    [11181, 17592, 22481, 32768, 0],
    [8291, 18358, 24576, 32768, 0],
    [7568, 11881, 14984, 32768, 0],
    [24948, 29001, 31147, 32768, 0],
    [25674, 30619, 32151, 32768, 0],
    [20841, 26793, 29603, 32768, 0],
    [14669, 24356, 28666, 32768, 0],
    [11334, 23593, 28219, 32768, 0],
    [8922, 14762, 22873, 32768, 0],
    [8301, 13544, 20535, 32768, 0],
  ],
] as const

const makeCdf = (values: readonly number[]): Uint16Array => new Uint16Array(values)
const transformClass = (transformType: number): 0 | 1 | 2 => {
  if (transformType === 11 || transformType === 13 || transformType === 15) return 1
  if (transformType === 10 || transformType === 12 || transformType === 14) return 2
  return 0
}

const transformSizeContext = (width: CoefficientDimension, height: CoefficientDimension): number =>
  (Math.log2(width >> 2) + Math.log2(height >> 2) + 1) >> 1

type CoefficientDimension = 4 | 8 | 16 | 32 | 64
const generatedScans = new Map<number, Uint16Array>()

const generatedScan = (
  width: CoefficientDimension,
  height: CoefficientDimension,
  txClass: 1 | 2,
): Uint16Array => {
  const key = width * 1024 + height * 4 + txClass
  const cached = generatedScans.get(key)
  if (cached) return cached
  const scan = new Uint16Array(width * height)
  if (txClass === 1) {
    for (let index = 0; index < scan.length; index += 1) {
      scan[index] = (index % height) * width + Math.floor(index / height)
    }
  } else {
    for (let index = 0; index < scan.length; index += 1) scan[index] = index
  }
  generatedScans.set(key, scan)
  return scan
}

const scanFor = (
  width: CoefficientDimension,
  height: CoefficientDimension,
  transformType: number,
): ArrayLike<number> => {
  const txClass = transformClass(transformType)
  if (txClass === 1 || txClass === 2) return generatedScan(width, height, txClass)
  if (width === 4 && height === 4) return defaultScan4x4
  if (width === 8 && height === 8) return defaultScan8x8
  if (width === 4 && height === 8) return defaultScan4x8
  if (width === 8 && height === 4) return defaultScan8x4
  if (width === 4 && height === 16) return av1LargeScans.default4x16
  if (width === 16 && height === 4) return av1LargeScans.default16x4
  if (width === 8 && height === 16) return av1LargeScans.default8x16
  if (width === 16 && height === 8) return av1LargeScans.default16x8
  if (width === 16 && height === 16) return av1LargeScans.default16x16
  if (width === 8 && height === 32) return av1LargeScans.default8x32
  if (width === 32 && height === 8) return av1LargeScans.default32x8
  if (width === 16 && height === 32) return av1LargeScans.default16x32
  if (width === 32 && height === 16) return av1LargeScans.default32x16
  if (width === 32 && height === 32) return av1LargeScans.default32x32
  throw unsupportedOperation(`AV1 ${width}x${height} coefficient scan`)
}

export interface Av1CoefficientBlock {
  readonly coefficients: Int32Array
  readonly dcCategory: number
  readonly eob: number
  readonly levelContext: number
}

export class Av1CoefficientDecoder {
  readonly #symbols: Av1SymbolDecoder
  readonly #quantizerContext: number
  readonly #eobPoint4x4: readonly (readonly Uint16Array[])[]
  readonly #eobPoint4x8: readonly (readonly Uint16Array[])[]
  readonly #eobPoint8x8: readonly (readonly Uint16Array[])[]
  readonly #eobPoint8x16: readonly (readonly Uint16Array[])[]
  readonly #eobPoint16x16: readonly (readonly Uint16Array[])[]
  readonly #eobPoint16x32: readonly (readonly Uint16Array[])[]
  readonly #eobPoint32x32: readonly (readonly Uint16Array[])[]
  readonly #eobExtra4x4: readonly (readonly Uint16Array[])[]
  readonly #eobExtra8x8: readonly (readonly Uint16Array[])[]
  readonly #eobExtra16x16: readonly (readonly Uint16Array[])[]
  readonly #eobExtra32x32: readonly (readonly Uint16Array[])[]
  readonly #eobExtra64x64: readonly (readonly Uint16Array[])[]
  readonly #dcSign = dcSignDefaults.map((plane) => plane.map((value) => makeCdf([value, 32768, 0])))
  readonly #baseEob4x4: readonly (readonly Uint16Array[])[]
  readonly #baseEob8x8: readonly (readonly Uint16Array[])[]
  readonly #baseEob16x16: readonly (readonly Uint16Array[])[]
  readonly #baseEob32x32: readonly (readonly Uint16Array[])[]
  readonly #baseEob64x64: readonly (readonly Uint16Array[])[]
  readonly #base4x4: readonly (readonly Uint16Array[])[]
  readonly #base8x8: readonly (readonly Uint16Array[])[]
  readonly #base16x16: readonly (readonly Uint16Array[])[]
  readonly #base32x32: readonly (readonly Uint16Array[])[]
  readonly #base64x64: readonly (readonly Uint16Array[])[]
  readonly #range4x4: readonly (readonly Uint16Array[])[]
  readonly #range8x8: readonly (readonly Uint16Array[])[]
  readonly #range16x16: readonly (readonly Uint16Array[])[]
  readonly #range32x32: readonly (readonly Uint16Array[])[]
  constructor(symbols: Av1SymbolDecoder, quantizerContext: number) {
    this.#symbols = symbols
    this.#quantizerContext = quantizerContext
    const defaults =
      quantizerContext === 2
        ? {
            eob4: coefficientQ2Defaults.eob4,
            eob4x8: coefficientQ2Defaults.eob4x8,
            eob8: coefficientQ2Defaults.eob8,
            eob8x16: coefficientQ2Defaults.eob8x16,
            eob16: coefficientQ2Defaults.eob16,
            extra4: coefficientQ2Defaults.extra4,
            extra8: coefficientQ2Defaults.extra8,
            baseEob4: coefficientQ2Defaults.baseEob4,
            baseEob8: coefficientQ2Defaults.baseEob8,
            base4: coefficientQ2Defaults.base4,
            base8: coefficientQ2Defaults.base8,
            range4: coefficientQ2Defaults.range4,
            range8: coefficientQ2Defaults.range8,
          }
        : {
            eob4: eobPointClassDefaults.eob4,
            eob4x8: eobPointClassDefaults.eob4x8,
            eob8: eobPointClassDefaults.eob8,
            eob8x16: eobPointClassDefaults.eob8x16,
            eob16: coefficientQ2Defaults.eob16,
            extra4: eobExtraDefaults.map((plane) =>
              plane.map((value) => [value, 32768, 0] as const),
            ),
            extra8: eobExtra8x8Defaults.map((plane) =>
              plane.map((value) => [value, 32768, 0] as const),
            ),
            baseEob4: coefficientBaseEobDefaults,
            baseEob8: coefficientBaseEob8x8Defaults,
            base4: coefficientBaseDefaults,
            base8: coefficientBase8x8Defaults,
            range4: coefficientRangeDefaults,
            range8: coefficientRange8x8Defaults,
          }
    this.#eobPoint4x4 = defaults.eob4.map((plane) => plane.map(makeCdf))
    this.#eobPoint4x8 = defaults.eob4x8.map((plane) => plane.map(makeCdf))
    this.#eobPoint8x8 = defaults.eob8.map((plane) => plane.map(makeCdf))
    this.#eobPoint8x16 = defaults.eob8x16.map((plane) => plane.map(makeCdf))
    this.#eobPoint16x16 = defaults.eob16.map((plane) => plane.map(makeCdf))
    this.#eobPoint16x32 = coefficientQ2Defaults.eob16x32.map((plane) => [makeCdf(plane)])
    this.#eobPoint32x32 = coefficientQ2Defaults.eob32.map((plane) => [makeCdf(plane)])
    this.#eobExtra4x4 = defaults.extra4.map((plane) => plane.map(makeCdf))
    this.#eobExtra8x8 = defaults.extra8.map((plane) => plane.map(makeCdf))
    this.#eobExtra16x16 = coefficientQ2Defaults.extra16.map((plane) => plane.map(makeCdf))
    this.#eobExtra32x32 = coefficientQ2Defaults.extra32.map((plane) => plane.map(makeCdf))
    this.#eobExtra64x64 = coefficientQ2Defaults.extra64.map((plane) => plane.map(makeCdf))
    this.#baseEob4x4 = defaults.baseEob4.map((plane) => plane.map(makeCdf))
    this.#baseEob8x8 = defaults.baseEob8.map((plane) => plane.map(makeCdf))
    this.#baseEob16x16 = coefficientQ2Defaults.baseEob16.map((plane) => plane.map(makeCdf))
    this.#baseEob32x32 = coefficientQ2Defaults.baseEob32.map((plane) => plane.map(makeCdf))
    this.#baseEob64x64 = coefficientQ2Defaults.baseEob64.map((plane) => plane.map(makeCdf))
    this.#base4x4 = defaults.base4.map((plane) => plane.map(makeCdf))
    this.#base8x8 = defaults.base8.map((plane) => plane.map(makeCdf))
    this.#base16x16 = coefficientQ2Defaults.base16.map((plane) => plane.map(makeCdf))
    this.#base32x32 = coefficientQ2Defaults.base32.map((plane) => plane.map(makeCdf))
    this.#base64x64 = coefficientQ2Defaults.base64.map((plane) => plane.map(makeCdf))
    this.#range4x4 = defaults.range4.map((plane) => plane.map(makeCdf))
    this.#range8x8 = defaults.range8.map((plane) => plane.map(makeCdf))
    this.#range16x16 = coefficientQ2Defaults.range16.map((plane) => plane.map(makeCdf))
    this.#range32x32 = coefficientQ2Defaults.range32.map((plane) => plane.map(makeCdf))
  }

  read(
    plane: 0 | 1 | 2,
    width: CoefficientDimension,
    height: CoefficientDimension,
    transformType: number,
    dcSignContext = 0,
  ): Av1CoefficientBlock {
    if (this.#quantizerContext !== 2 && this.#quantizerContext !== 3) {
      throw unsupportedOperation(
        `AV1 nonzero coefficients for quantizer context ${this.#quantizerContext}`,
      )
    }
    if (this.#quantizerContext !== 2 && (width >= 16 || height >= 16)) {
      throw unsupportedOperation('AV1 large coefficients outside quantizer context 2')
    }
    if (transformType < 0 || transformType > 15) {
      throw unsupportedOperation(`Phase B2 does not support AV1 transform type ${transformType}`)
    }
    const planeType = plane === 0 ? 0 : 1
    const adjustedWidth = Math.min(width, 32) as 4 | 8 | 16 | 32
    const adjustedHeight = Math.min(height, 32) as 4 | 8 | 16 | 32
    const scan = scanFor(adjustedWidth, adjustedHeight, transformType)
    const area = adjustedWidth * adjustedHeight
    const classContext = transformClass(transformType) === 0 ? 0 : 1
    const eobPoints =
      area === 16
        ? this.#eobPoint4x4
        : area === 32
          ? this.#eobPoint4x8
          : area === 64
            ? this.#eobPoint8x8
            : area === 128
              ? this.#eobPoint8x16
              : area === 256
                ? this.#eobPoint16x16
                : area === 512
                  ? this.#eobPoint16x32
                  : this.#eobPoint32x32
    const eobCdf = eobPoints[planeType]?.[area >= 512 ? 0 : classContext]
    const sizeContext = transformSizeContext(width, height)
    const eobExtra =
      sizeContext === 0
        ? this.#eobExtra4x4
        : sizeContext === 1
          ? this.#eobExtra8x8
          : sizeContext === 2
            ? this.#eobExtra16x16
            : sizeContext === 3
              ? this.#eobExtra32x32
              : this.#eobExtra64x64
    const baseEob =
      sizeContext === 0
        ? this.#baseEob4x4
        : sizeContext === 1
          ? this.#baseEob8x8
          : sizeContext === 2
            ? this.#baseEob16x16
            : sizeContext === 3
              ? this.#baseEob32x32
              : this.#baseEob64x64
    const base =
      sizeContext === 0
        ? this.#base4x4
        : sizeContext === 1
          ? this.#base8x8
          : sizeContext === 2
            ? this.#base16x16
            : sizeContext === 3
              ? this.#base32x32
              : this.#base64x64
    const range =
      sizeContext === 0
        ? this.#range4x4
        : sizeContext === 1
          ? this.#range8x8
          : sizeContext === 2
            ? this.#range16x16
            : this.#range32x32
    if (!eobCdf) throw invalidInput('AV1 EOB CDF is missing')
    const eobPoint = this.#symbols.readSymbol(eobCdf) + 1
    let eob = eobPoint < 2 ? eobPoint : 2 ** (eobPoint - 2) + 1
    if (eobPoint >= 3) {
      const extraCdf = eobExtra[planeType]?.[eobPoint - 3]
      if (!extraCdf) throw invalidInput('AV1 EOB extra CDF is missing')
      const highBit = this.#symbols.readSymbol(extraCdf)
      if (highBit === 1) eob += 2 ** (eobPoint - 3)
      for (let index = 1; index < eobPoint - 2; index += 1) {
        const shift = eobPoint - 3 - index
        const bit = this.#symbols.readBoolean()
        eob += bit * 2 ** shift
      }
    }
    if (eob < 1 || eob > area) throw invalidInput(`Invalid AV1 ${width}x${height} EOB: ${eob}`)

    const coefficients = new Int32Array(area)
    for (let scanIndex = eob - 1; scanIndex >= 0; scanIndex -= 1) {
      const position = scan[scanIndex]
      if (position === undefined) throw invalidInput('AV1 coefficient scan is invalid')
      let level: number
      let coefficientContext: number
      if (scanIndex === eob - 1) {
        coefficientContext =
          scanIndex === 0 ? 0 : scanIndex <= area / 8 ? 1 : scanIndex <= area / 4 ? 2 : 3
        const baseEobCdf = baseEob[planeType]?.[coefficientContext]
        if (!baseEobCdf) throw invalidInput('AV1 coefficient EOB base CDF is missing')
        level = this.#symbols.readSymbol(baseEobCdf) + 1
      } else {
        coefficientContext = this.#baseContext(
          coefficients,
          position,
          adjustedWidth,
          adjustedHeight,
          transformType,
          Math.sign(width - height),
        )
        const baseCdf = base[planeType]?.[coefficientContext]
        if (!baseCdf)
          throw invalidInput(`AV1 coefficient base context ${coefficientContext} is missing`)
        level = this.#symbols.readSymbol(baseCdf)
      }
      if (level > 2) {
        for (let index = 0; index < 4; index += 1) {
          const context = this.#rangeContext(
            coefficients,
            position,
            adjustedWidth,
            adjustedHeight,
            transformType,
          )
          const rangeCdf = range[planeType]?.[context]
          if (!rangeCdf) throw invalidInput(`AV1 coefficient range context ${context} is missing`)
          const extra = this.#symbols.readSymbol(rangeCdf)
          level += extra
          if (extra < 3) break
        }
      }
      coefficients[position] = level
    }

    let dcCategory = 0
    let levelContext = 0
    for (let scanIndex = 0; scanIndex < eob; scanIndex += 1) {
      const position = scan[scanIndex]
      if (position === undefined) throw invalidInput('AV1 coefficient scan is invalid')
      let magnitude = coefficients[position] ?? 0
      if (magnitude === 0) continue
      let sign: number
      if (scanIndex === 0) {
        const signCdf = this.#dcSign[planeType]?.[dcSignContext]
        if (!signCdf) throw invalidInput('AV1 DC sign CDF is missing')
        sign = this.#symbols.readSymbol(signCdf)
      } else sign = this.#symbols.readBoolean()
      if (magnitude > 14) {
        let length = 0
        do {
          length += 1
          if (length > 20) throw invalidInput('AV1 coefficient magnitude exceeds 20 bits')
        } while (this.#symbols.readBoolean() === 0)
        let value = 1
        for (let index = length - 2; index >= 0; index -= 1) {
          value = value * 2 + this.#symbols.readBoolean()
        }
        magnitude = value + 14
      }
      levelContext += magnitude
      if (position === 0) dcCategory = sign === 1 ? 1 : 2
      coefficients[position] = sign === 1 ? -magnitude : magnitude
    }
    if (adjustedWidth === width && adjustedHeight === height) {
      return { coefficients, dcCategory, eob, levelContext: Math.min(63, levelContext) }
    }
    const expanded = new Int32Array(width * height)
    for (let row = 0; row < adjustedHeight; row += 1) {
      expanded.set(
        coefficients.subarray(row * adjustedWidth, row * adjustedWidth + adjustedWidth),
        row * width,
      )
    }
    return { coefficients: expanded, dcCategory, eob, levelContext: Math.min(63, levelContext) }
  }

  #baseContext(
    coefficients: Int32Array,
    position: number,
    width: CoefficientDimension,
    height: CoefficientDimension,
    transformType: number,
    rectangularDirection: number,
  ): number {
    const row = Math.floor(position / width)
    const column = position % width
    const txClass = transformClass(transformType)
    let magnitude = 0
    for (const [rowOffset, columnOffset] of significantOffsetsByClass[txClass]) {
      const referenceRow = row + rowOffset
      const referenceColumn = column + columnOffset
      if (referenceRow < height && referenceColumn < width) {
        magnitude += Math.min(
          Math.abs(coefficients[referenceRow * width + referenceColumn] ?? 0),
          3,
        )
      }
    }
    const base = Math.min((magnitude + 1) >> 1, 4)
    if (txClass !== 0) {
      const index = txClass === 1 ? column : row
      const offset = [26, 31, 36][Math.min(index, 2)]
      if (offset === undefined) throw invalidInput('AV1 coefficient position context is invalid')
      return base + offset
    }
    if (position === 0) return 0
    const offsets =
      rectangularDirection < 0
        ? [
            [0, 11, 11, 11, width === 4 ? 0 : 11],
            [11, 11, 11, 11, width === 4 ? 0 : 11],
            [6, 6, 21, 21, width === 4 ? 0 : 21],
            [6, 21, 21, 21, width === 4 ? 0 : 21],
            [21, 21, 21, 21, width === 4 ? 0 : 21],
          ]
        : rectangularDirection > 0
          ? [
              [0, 16, 6, 6, 21],
              [16, 16, 6, 21, 21],
              [16, 16, 21, 21, 21],
              [16, 16, 21, 21, 21],
              height === 4 ? [0, 0, 0, 0, 0] : [16, 16, 21, 21, 21],
            ]
          : coefficientContextOffsets
    return base + (offsets[Math.min(row, 4)]?.[Math.min(column, 4)] ?? 0)
  }

  #rangeContext(
    coefficients: Int32Array,
    position: number,
    width: CoefficientDimension,
    height: CoefficientDimension,
    transformType: number,
  ): number {
    const row = Math.floor(position / width)
    const column = position % width
    const txClass = transformClass(transformType)
    let magnitude = 0
    for (const [rowOffset, columnOffset] of magnitudeOffsetsByClass[txClass]) {
      const referenceRow = row + rowOffset
      const referenceColumn = column + columnOffset
      if (referenceRow < height && referenceColumn < width) {
        magnitude += Math.min(
          Math.abs(coefficients[referenceRow * width + referenceColumn] ?? 0),
          15,
        )
      }
    }
    const base = Math.min((magnitude + 1) >> 1, 6)
    if (position === 0) return base
    if (txClass === 0) return base + (row < 2 && column < 2 ? 7 : 14)
    if (txClass === 1) return base + (column === 0 ? 7 : 14)
    return base + (row === 0 ? 7 : 14)
  }
}
