export interface Matrix10ReferenceSample {
  readonly pixel: number
  readonly rgb: readonly [number, number, number]
}

// Rec. 2020 linear RGB to sRGB linear RGB, derived independently from the published
// Rec. 2020 and IEC 61966-2-1 chromaticities and their shared D65 white point.
const rec2020ToSrgb = [
  1.660_491_002_108_434_5, -0.587_641_138_788_549_5, -0.072_849_863_319_884_8,
  -0.124_550_474_521_590_7, 1.132_899_897_125_960_3, -0.008_349_422_604_369_5,
  -0.018_150_763_354_905_2, -0.100_578_898_008_007_4, 1.118_729_661_362_912_5,
] as const

const pqToLinear203 = (encoded: number): number => {
  const m1 = 2610 / 16_384
  const m2 = 2523 / 32
  const c1 = 3424 / 4096
  const c2 = 2413 / 128
  const c3 = 2392 / 128
  const signal = Math.max(encoded, 0) ** (1 / m2)
  const numerator = Math.max(signal - c1, 0)
  const denominator = c2 - c3 * signal
  return denominator <= 0 ? 10_000 / 203 : ((numerator / denominator) ** (1 / m1) * 10_000) / 203
}

const encodeSrgb = (linear: number): number =>
  Math.max(
    0,
    Math.min(
      255,
      Math.round(
        (linear <= 0.003_130_8 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055) * 255,
      ),
    ),
  )

const findY4mPayload = (
  input: Uint8Array,
  width: number,
  height: number,
): { readonly offset: number; readonly view: DataView } => {
  const headerEnd = input.indexOf(0x0a)
  if (headerEnd < 0) throw new Error('Matrix 10 oracle Y4M header is truncated')
  const header = new TextDecoder().decode(input.subarray(0, headerEnd))
  if (
    !header.startsWith(`YUV4MPEG2 W${width} H${height} `) ||
    !header.includes(' C420p10') ||
    !header.includes(' XCOLORRANGE=FULL')
  ) {
    throw new Error(`Matrix 10 oracle Y4M format is unsupported: ${header}`)
  }
  const marker = 'FRAME\n'
  const markerOffset = headerEnd + 1
  if (
    new TextDecoder().decode(input.subarray(markerOffset, markerOffset + marker.length)) !== marker
  ) {
    throw new Error('Matrix 10 oracle Y4M frame marker is missing')
  }
  const offset = markerOffset + marker.length
  const chromaWidth = Math.ceil(width / 2)
  const chromaHeight = Math.ceil(height / 2)
  const requiredBytes = (width * height + 2 * chromaWidth * chromaHeight) * 2
  if (input.byteLength - offset < requiredBytes) {
    throw new Error('Matrix 10 oracle Y4M frame is truncated')
  }
  return {
    offset,
    view: new DataView(input.buffer, input.byteOffset + offset, requiredBytes),
  }
}

// This development oracle starts from libavif/dav1d's native 10-bit YUV output. The
// constant-luminance inverse below follows Colour's YcCbcCrc_to_RGB implementation,
// which cites ITU-R BT.2020 and uses the normative 1.9404/1.5816 and 1.7184/0.9936
// branches. It intentionally does not import the production conversion helpers.
export const matrix10PqReferenceSamples = (
  y4m: Uint8Array,
  width: number,
  sourceHeight: number,
  cropY: number,
  outputHeight: number,
  pixels: readonly number[],
): readonly Matrix10ReferenceSample[] => {
  const { view } = findY4mPayload(y4m, width, sourceHeight)
  const chromaWidth = Math.ceil(width / 2)
  const chromaHeight = Math.ceil(sourceHeight / 2)
  const uOffset = width * sourceHeight * 2
  const vOffset = uOffset + chromaWidth * chromaHeight * 2
  const sourcePeak = 10_000 / 203
  const readChroma = (offset: number, x: number, y: number): number => {
    const left = (x - 1) >> 1
    const top = (y - 1) >> 1
    const rightWeight = (x & 1) === 1 ? 1 : 3
    const bottomWeight = (y & 1) === 1 ? 1 : 3
    const leftX = Math.max(0, Math.min(chromaWidth - 1, left))
    const rightX = Math.max(0, Math.min(chromaWidth - 1, left + 1))
    const topY = Math.max(0, Math.min(chromaHeight - 1, top))
    const bottomY = Math.max(0, Math.min(chromaHeight - 1, top + 1))
    const read = (sampleX: number, sampleY: number): number =>
      view.getUint16(offset + (sampleY * chromaWidth + sampleX) * 2, true)
    const topSample = read(leftX, topY) * (4 - rightWeight) + read(rightX, topY) * rightWeight
    const bottomSample =
      read(leftX, bottomY) * (4 - rightWeight) + read(rightX, bottomY) * rightWeight
    return (topSample * (4 - bottomWeight) + bottomSample * bottomWeight) / 16
  }

  return pixels.map((pixel) => {
    if (!Number.isSafeInteger(pixel) || pixel < 0 || pixel >= width * outputHeight) {
      throw new Error(`Matrix 10 oracle pixel ${pixel} is outside the displayed image`)
    }
    const x = pixel % width
    const sourceY = Math.floor(pixel / width) + cropY
    const encodedY = view.getUint16((sourceY * width + x) * 2, true) / 1023
    const cb = (readChroma(uOffset, x, sourceY) - 512) / 1023
    const cr = (readChroma(vOffset, x, sourceY) - 512) / 1023
    const encodedRed = encodedY + cr * (cr <= 0 ? 1.7184 : 0.9936)
    const encodedBlue = encodedY + cb * (cb <= 0 ? 1.9404 : 1.5816)
    const sourceRed = pqToLinear203(encodedRed)
    const sourceBlue = pqToLinear203(encodedBlue)
    const sourceGreen = (pqToLinear203(encodedY) - 0.2627 * sourceRed - 0.0593 * sourceBlue) / 0.678
    const signal = Math.max(sourceRed, sourceGreen, sourceBlue, 1e-6)
    const mappedSignal = (signal / (signal + 1)) * ((sourcePeak + 1) / sourcePeak)
    const scale = mappedSignal / signal
    const red =
      (rec2020ToSrgb[0] * sourceRed +
        rec2020ToSrgb[1] * sourceGreen +
        rec2020ToSrgb[2] * sourceBlue) *
      scale
    const green =
      (rec2020ToSrgb[3] * sourceRed +
        rec2020ToSrgb[4] * sourceGreen +
        rec2020ToSrgb[5] * sourceBlue) *
      scale
    const blue =
      (rec2020ToSrgb[6] * sourceRed +
        rec2020ToSrgb[7] * sourceGreen +
        rec2020ToSrgb[8] * sourceBlue) *
      scale
    return { pixel, rgb: [encodeSrgb(red), encodeSrgb(green), encodeSrgb(blue)] }
  })
}
