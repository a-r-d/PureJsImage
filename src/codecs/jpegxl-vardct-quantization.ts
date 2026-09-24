const distanceBands = Object.freeze([
  Object.freeze([3150, 0, -0.4, -0.4, -0.4, -2]),
  Object.freeze([560, 0, -0.3, -0.3, -0.3, -0.3]),
  Object.freeze([512, -2, -1, 0, -1, -2]),
])

/** The format's default DCT8 weights, shared by the forward and inverse transforms. */
export const defaultJpegXlDct8Dequantization: readonly Float64Array[] = Object.freeze(
  distanceBands.map((parameters) => {
    const bands = [parameters[0] ?? 1]
    for (let index = 1; index < parameters.length; index++) {
      const value = parameters[index] ?? 0
      const multiplier = value > 0 ? 1 + value : 1 / (1 - value)
      bands.push((bands[index - 1] ?? 1) * multiplier)
    }
    const output = new Float64Array(64)
    const scale = 5 / (Math.SQRT2 + 1e-6)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const distance = Math.hypot((x * scale) / 7, (y * scale) / 7)
        const low = Math.min(4, Math.floor(distance))
        const fraction = Math.min(1, distance - low)
        const first = bands[low] ?? 1,
          second = bands[low + 1] ?? first
        output[y * 8 + x] = 1 / (first * (second / first) ** fraction)
      }
    }
    return output
  }),
)

export const jpegXlDistanceWeights = (
  rows: number,
  columns: number,
  parameters: readonly number[],
): Float64Array => {
  const bands = [parameters[0] ?? 1]
  for (let index = 1; index < parameters.length; index += 1) {
    const value = parameters[index] ?? 0
    bands.push((bands[index - 1] ?? 1) * (value > 0 ? 1 + value : 1 / (1 - value)))
  }
  const output = new Float64Array(rows * columns)
  const scale = (parameters.length - 1) / (Math.SQRT2 + 1e-6)
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const distance = Math.hypot(
        columns === 1 ? 0 : (x * scale) / (columns - 1),
        rows === 1 ? 0 : (y * scale) / (rows - 1),
      )
      const low = Math.min(parameters.length - 2, Math.floor(distance))
      const fraction = Math.min(1, distance - low)
      const first = bands[low] ?? 1
      const second = bands[low + 1] ?? first
      output[y * columns + x] = first * (second / first) ** fraction
    }
  }
  return output
}

const hornussWeights = Object.freeze([
  Object.freeze([280, 3160, 3160]),
  Object.freeze([60, 864, 864]),
  Object.freeze([18, 200, 200]),
])

const dct4x8Bands = Object.freeze([
  Object.freeze([
    2198.0505560163806, -0.9626962302074469, -0.7619425302666678, -0.6551140670773546,
  ]),
  Object.freeze([764.3655248643529, -0.9263020088836694, -0.9675229603596517, -0.2784529086916812]),
  Object.freeze([527.1075735875422, -1.4594385811273853, -1.4500820940978716, -1.5843722511996203]),
])

export const defaultJpegXlQuantizationBiases = Object.freeze([
  0.945349926692846, 0.9299455010825141, 0.9500648966626563,
])
export const defaultJpegXlHornussDequantization = Object.freeze(
  hornussWeights.map((parameters) => {
    const table = new Float64Array(64)
    table.fill(1 / (parameters[0] ?? 1))
    table[0] = 1
    table[1] = table[8] = 1 / (parameters[1] ?? 1)
    table[9] = 1 / (parameters[2] ?? 1)
    return table
  }),
)
export const defaultJpegXlDct16Dequantization: readonly Float64Array[] = Object.freeze(
  [
    [8996.873, -1.3000778, -0.4942453, -0.43909377, -0.6350102, -0.9017726, -1.6162099],
    [3191.4836, -0.67424583, -0.80745816, -0.4492584, -0.3586544, -0.3132239, -0.37615025],
    [1157.504, -2.0531423, -1.4, -0.5068713, -0.4270873, -1.4856834, -4.920914],
  ].map((bands) => Float64Array.from(jpegXlDistanceWeights(16, 16, bands), (weight) => 1 / weight)),
)

export const defaultJpegXlDct4x8Weights = Object.freeze(
  dct4x8Bands.map((bands) => jpegXlDistanceWeights(4, 8, bands)),
)
export const defaultJpegXlDct4x8Dequantization = Object.freeze(
  defaultJpegXlDct4x8Weights.map((weights) => {
    const table = new Float64Array(64)
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) table[y * 8 + x] = 1 / (weights[Math.floor(y / 2) * 8 + x] ?? 1)
    return table
  }),
)
