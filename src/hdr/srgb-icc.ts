const ascii = (target: Uint8Array, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index)
  }
}

const fixed = (view: DataView, offset: number, value: number): void => {
  view.setInt32(offset, Math.round(value * 65_536), false)
}

const xyz = (values: readonly [number, number, number]): Uint8Array => {
  const output = new Uint8Array(20)
  const view = new DataView(output.buffer)
  ascii(output, 0, 'XYZ ')
  fixed(view, 8, values[0])
  fixed(view, 12, values[1])
  fixed(view, 16, values[2])
  return output
}

const multiLocalizedUnicode = (value: string): Uint8Array => {
  const encodedLength = value.length * 2
  const output = new Uint8Array(28 + encodedLength)
  const view = new DataView(output.buffer)
  ascii(output, 0, 'mluc')
  view.setUint32(8, 1, false)
  view.setUint32(12, 12, false)
  ascii(output, 16, 'enUS')
  view.setUint32(20, encodedLength, false)
  view.setUint32(24, 28, false)
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(28 + index * 2, value.charCodeAt(index), false)
  }
  return output
}

const chromaticAdaptation = (): Uint8Array => {
  const output = new Uint8Array(44)
  const view = new DataView(output.buffer)
  ascii(output, 0, 'sf32')
  const values = [
    1.0478112, 0.0228866, -0.050127, 0.0295424, 0.9904844, -0.0170491, -0.0092345, 0.0150436,
    0.7521316,
  ] as const
  for (let index = 0; index < values.length; index += 1) {
    fixed(view, 8 + index * 4, values[index] ?? 0)
  }
  return output
}

const transferCurve = (): Uint8Array => {
  const output = new Uint8Array(40)
  const view = new DataView(output.buffer)
  ascii(output, 0, 'para')
  view.setUint16(8, 4, false)
  const parameters = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045, 0, 0]
  for (let index = 0; index < parameters.length; index += 1) {
    fixed(view, 12 + index * 4, parameters[index] ?? 0)
  }
  return output
}

const decodeHex = (value: string): Uint8Array => {
  const output = new Uint8Array(value.length / 2)
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return output
}

export const PUREJSIMAGE_SRGB_ICC_PROFILE_ID = '3b1a5e27decd22cd7e4cf5e72976be35'

/**
 * Deterministic first-party ICC v4.3 matrix-shaper sRGB display profile.
 *
 * The colorants and Bradford adaptation use the ICC sRGB D50 values. The
 * parametric curve is the IEC 61966-2-1 sRGB transfer function.
 */
export const createPureJsImageSrgbIcc = (): Uint8Array => {
  const curve = transferCurve()
  const tags = [
    ['desc', multiLocalizedUnicode('PureJsImage sRGB')],
    ['cprt', multiLocalizedUnicode('Copyright 2026 PureJsImage. MIT License.')],
    ['wtpt', xyz([0.9642, 1, 0.8249])],
    ['chad', chromaticAdaptation()],
    ['rXYZ', xyz([0.4360747, 0.2225045, 0.0139322])],
    ['gXYZ', xyz([0.3850649, 0.7168786, 0.0971045])],
    ['bXYZ', xyz([0.1430804, 0.0606169, 0.7141733])],
  ] as const
  const tagCount = tags.length + 3
  const dataStart = 128 + 4 + tagCount * 12
  const dataBytes = tags.reduce((total, [, data]) => total + data.byteLength, 0) + curve.byteLength
  const output = new Uint8Array(dataStart + dataBytes)
  const view = new DataView(output.buffer)
  view.setUint32(0, output.byteLength, false)
  view.setUint32(8, 0x0430_0000, false)
  ascii(output, 12, 'mntr')
  ascii(output, 16, 'RGB ')
  ascii(output, 20, 'XYZ ')
  for (const [index, value] of [2026, 8, 30, 0, 0, 0].entries()) {
    view.setUint16(24 + index * 2, value, false)
  }
  ascii(output, 36, 'acsp')
  view.setUint32(64, 1, false)
  fixed(view, 68, 0.9642)
  fixed(view, 72, 1)
  fixed(view, 76, 0.8249)
  output.set(decodeHex(PUREJSIMAGE_SRGB_ICC_PROFILE_ID), 84)
  view.setUint32(128, tagCount, false)

  let entry = 132
  let dataOffset = dataStart
  for (const [signature, data] of tags) {
    ascii(output, entry, signature)
    view.setUint32(entry + 4, dataOffset, false)
    view.setUint32(entry + 8, data.byteLength, false)
    output.set(data, dataOffset)
    entry += 12
    dataOffset += data.byteLength
  }
  for (const signature of ['rTRC', 'gTRC', 'bTRC']) {
    ascii(output, entry, signature)
    view.setUint32(entry + 4, dataOffset, false)
    view.setUint32(entry + 8, curve.byteLength, false)
    entry += 12
  }
  output.set(curve, dataOffset)
  return output
}

export const PUREJSIMAGE_SRGB_ICC_SHA256 =
  '3101ea6d31a871d6611a7fd840aee348c654d46705603d1f2b78aa6f56d2d881'
