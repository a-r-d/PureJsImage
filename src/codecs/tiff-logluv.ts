import { invalidInput } from '../errors.ts'

export type LogLuvEncoding = 'logl16' | 'logluv24' | 'logluv32'

const uvSquareSize = Math.fround(0.0035)
const uvVStart = Math.fround(0.01694)
const neutralU = 0.210526316
const neutralV = 0.473684211
const uvDivisions = 16_289

// The SGILog24 interchange format defines a fixed 14-bit CIE u′v′ codebook.
const uvStarts = Float32Array.of(
  0.247663,
  0.243779,
  0.241684,
  0.237874,
  0.235906,
  0.232153,
  0.228352,
  0.226259,
  0.222371,
  0.22041,
  0.21471,
  0.212714,
  0.210721,
  0.204976,
  0.202986,
  0.199245,
  0.195525,
  0.19356,
  0.189878,
  0.186216,
  0.186216,
  0.182592,
  0.179003,
  0.175466,
  0.172001,
  0.172001,
  0.168612,
  0.168612,
  0.163575,
  0.158642,
  0.158642,
  0.158642,
  0.153815,
  0.153815,
  0.149097,
  0.149097,
  0.142746,
  0.142746,
  0.142746,
  0.13827,
  0.13827,
  0.13827,
  0.132166,
  0.132166,
  0.126204,
  0.126204,
  0.126204,
  0.120381,
  0.120381,
  0.120381,
  0.120381,
  0.112962,
  0.112962,
  0.112962,
  0.10745,
  0.10745,
  0.10745,
  0.10745,
  0.100343,
  0.100343,
  0.100343,
  0.095126,
  0.095126,
  0.095126,
  0.095126,
  0.088276,
  0.088276,
  0.088276,
  0.088276,
  0.081523,
  0.081523,
  0.081523,
  0.081523,
  0.074861,
  0.074861,
  0.074861,
  0.074861,
  0.06829,
  0.06829,
  0.06829,
  0.06829,
  0.063573,
  0.063573,
  0.063573,
  0.063573,
  0.057219,
  0.057219,
  0.057219,
  0.057219,
  0.050985,
  0.050985,
  0.050985,
  0.050985,
  0.050985,
  0.044859,
  0.044859,
  0.044859,
  0.044859,
  0.040571,
  0.040571,
  0.040571,
  0.040571,
  0.036339,
  0.036339,
  0.036339,
  0.036339,
  0.032139,
  0.032139,
  0.032139,
  0.032139,
  0.027947,
  0.027947,
  0.027947,
  0.023739,
  0.023739,
  0.023739,
  0.023739,
  0.019504,
  0.019504,
  0.019504,
  0.016976,
  0.016976,
  0.016976,
  0.016976,
  0.012639,
  0.012639,
  0.012639,
  0.009991,
  0.009991,
  0.009991,
  0.009016,
  0.009016,
  0.009016,
  0.006217,
  0.006217,
  0.005097,
  0.005097,
  0.005097,
  0.003909,
  0.003909,
  0.00234,
  0.002389,
  0.001068,
  0.001653,
  0.000717,
  0.001614,
  0.00027,
  0.000484,
  0.001103,
  0.001242,
  0.001188,
  0.001011,
  0.000709,
  0.000301,
  0.002416,
  0.003251,
  0.003246,
  0.004141,
  0.005963,
  0.008839,
  0.01049,
  0.016994,
  0.023659,
)
const uvCounts = Uint16Array.of(
  4,
  6,
  7,
  9,
  10,
  12,
  14,
  15,
  17,
  18,
  21,
  22,
  23,
  26,
  27,
  29,
  31,
  32,
  34,
  36,
  36,
  38,
  40,
  42,
  44,
  44,
  46,
  46,
  49,
  52,
  52,
  52,
  55,
  55,
  58,
  58,
  62,
  62,
  62,
  65,
  65,
  65,
  69,
  69,
  73,
  73,
  73,
  77,
  77,
  77,
  77,
  82,
  82,
  82,
  86,
  86,
  86,
  86,
  91,
  91,
  91,
  95,
  95,
  95,
  95,
  100,
  100,
  100,
  100,
  105,
  105,
  105,
  105,
  110,
  110,
  110,
  110,
  115,
  115,
  115,
  115,
  119,
  119,
  119,
  119,
  124,
  124,
  124,
  124,
  129,
  129,
  129,
  129,
  129,
  134,
  134,
  134,
  134,
  138,
  138,
  138,
  138,
  142,
  142,
  142,
  142,
  146,
  146,
  146,
  146,
  150,
  150,
  150,
  154,
  154,
  154,
  154,
  158,
  158,
  158,
  161,
  161,
  161,
  161,
  165,
  165,
  165,
  168,
  168,
  168,
  170,
  170,
  170,
  173,
  173,
  175,
  175,
  175,
  177,
  177,
  177,
  170,
  164,
  157,
  150,
  143,
  136,
  129,
  123,
  115,
  109,
  103,
  97,
  89,
  82,
  76,
  69,
  62,
  55,
  47,
  40,
  31,
  21,
)
const uvCumulative = (() => {
  const values = new Uint16Array(uvCounts.length)
  let total = 0
  for (let row = 0; row < uvCounts.length; row += 1) {
    values[row] = total
    total += uvCounts[row] ?? 0
  }
  return values
})()

const logL16ToY = (bits: number): number => {
  const logarithmic = bits & 0x7fff
  if (logarithmic === 0) return 0
  const magnitude = 2 ** ((logarithmic + 0.5) / 256 - 64)
  return (bits & 0x8000) === 0 ? magnitude : -magnitude
}

const logL10ToY = (bits: number): number => (bits === 0 ? 0 : 2 ** ((bits + 0.5) / 64 - 12))

const uvRowFor = (code: number): number => {
  if (code < 0 || code >= uvDivisions) return -1
  let lower = 0
  let upper = uvCumulative.length
  while (upper - lower > 1) {
    const row = (lower + upper) >>> 1
    if (code >= (uvCumulative[row] ?? 0)) lower = row
    else upper = row
  }
  return lower
}

const writeXyz = (
  view: DataView,
  offset: number,
  luminance: number,
  u: number,
  v: number,
): void => {
  if (luminance <= 0) {
    view.setFloat32(offset, 0, false)
    view.setFloat32(offset + 4, 0, false)
    view.setFloat32(offset + 8, 0, false)
    return
  }
  const scale = 1 / (6 * u - 16 * v + 12)
  const x = 9 * u * scale
  const y = 4 * v * scale
  view.setFloat32(offset, (x / y) * luminance, false)
  view.setFloat32(offset + 4, luminance, false)
  view.setFloat32(offset + 8, ((1 - x - y) / y) * luminance, false)
}

const decodeRlePlane = (
  encoded: Uint8Array,
  inputOffset: number,
  output: Uint8Array,
  outputOffset: number,
  pixels: number,
): number => {
  let input = inputOffset
  let written = 0
  while (written < pixels) {
    const control = encoded[input]
    if (control === undefined) throw invalidInput('TIFF SGILog row is truncated')
    input += 1
    if (control >= 128) {
      const count = control - 126
      const value = encoded[input]
      if (value === undefined) throw invalidInput('TIFF SGILog run is truncated')
      if (count > pixels - written) throw invalidInput('TIFF SGILog run exceeds its row')
      input += 1
      output.fill(value, outputOffset + written, outputOffset + written + count)
      written += count
    } else {
      const count = control
      if (count > pixels - written) throw invalidInput('TIFF SGILog literal exceeds its row')
      if (input + count > encoded.byteLength) throw invalidInput('TIFF SGILog literal is truncated')
      output.set(encoded.subarray(input, input + count), outputOffset + written)
      input += count
      written += count
    }
  }
  return input
}

export const decodeLogLuvSegment = (
  encoded: Uint8Array,
  width: number,
  rows: number,
  encoding: LogLuvEncoding,
): Uint8Array => {
  const channels = encoding === 'logl16' ? 1 : 3
  const output = new Uint8Array(width * rows * channels * 4)
  const view = new DataView(output.buffer)
  let input = 0
  if (encoding === 'logluv24') {
    const expected = width * rows * 3
    if (encoded.byteLength !== expected) {
      throw invalidInput(
        `TIFF SGILog24 segment has ${encoded.byteLength}, expected ${expected} bytes`,
      )
    }
    for (let pixel = 0; pixel < width * rows; pixel += 1) {
      const code =
        ((encoded[input] ?? 0) << 16) | ((encoded[input + 1] ?? 0) << 8) | (encoded[input + 2] ?? 0)
      const luminance = logL10ToY((code >>> 14) & 0x3ff)
      const chroma = code & 0x3fff
      const uvRow = uvRowFor(chroma)
      const u =
        uvRow < 0
          ? neutralU
          : (uvStarts[uvRow] ?? 0) + (chroma - (uvCumulative[uvRow] ?? 0) + 0.5) * uvSquareSize
      const v = uvRow < 0 ? neutralV : uvVStart + (uvRow + 0.5) * uvSquareSize
      writeXyz(view, pixel * 12, luminance, u, v)
      input += 3
    }
    return output
  }

  const bytePlanes = encoding === 'logl16' ? 2 : 4
  const row = new Uint8Array(width * bytePlanes)
  for (let y = 0; y < rows; y += 1) {
    for (let plane = 0; plane < bytePlanes; plane += 1) {
      input = decodeRlePlane(encoded, input, row, plane * width, width)
    }
    for (let x = 0; x < width; x += 1) {
      const high = row[x] ?? 0
      const next = row[width + x] ?? 0
      const luminance = logL16ToY((high << 8) | next)
      const target = (y * width + x) * channels * 4
      if (encoding === 'logl16') {
        view.setFloat32(target, luminance, false)
      } else {
        const u = ((row[width * 2 + x] ?? 0) + 0.5) / 410
        const v = ((row[width * 3 + x] ?? 0) + 0.5) / 410
        writeXyz(view, target, luminance, u, v)
      }
    }
  }
  if (input !== encoded.byteLength) throw invalidInput('TIFF SGILog segment has trailing data')
  return output
}
