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

const description = (): Uint8Array => {
  const label = 'PureJsImage sRGB\0'
  const output = new Uint8Array(90 + label.length)
  const view = new DataView(output.buffer)
  ascii(output, 0, 'desc')
  view.setUint32(8, label.length, false)
  ascii(output, 12, label)
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

/**
 * Deterministic first-party matrix-shaper sRGB display profile.
 *
 * The colorants use the ICC sRGB D50 matrix, and the parametric curve is the
 * IEC 61966-2-1 sRGB transfer function. No third-party profile bytes are used.
 */
export const createPureJsImageSrgbIcc = (): Uint8Array => {
  const tags = [
    ['desc', description()],
    ['wtpt', xyz([0.9642, 1, 0.8249])],
    ['rXYZ', xyz([0.4360747, 0.2225045, 0.0139322])],
    ['gXYZ', xyz([0.3850649, 0.7168786, 0.0971045])],
    ['bXYZ', xyz([0.1430804, 0.0606169, 0.7141733])],
  ] as const
  const curve = transferCurve()
  const tagCount = tags.length + 3
  const dataStart = 128 + 4 + tagCount * 12
  const dataBytes = tags.reduce((total, [, data]) => total + data.byteLength, 0) + curve.byteLength
  const output = new Uint8Array(dataStart + dataBytes)
  const view = new DataView(output.buffer)
  view.setUint32(0, output.byteLength, false)
  ascii(output, 4, 'PJSI')
  view.setUint32(8, 0x0210_0000, false)
  ascii(output, 12, 'mntr')
  ascii(output, 16, 'RGB ')
  ascii(output, 20, 'XYZ ')
  for (const [index, value] of [2026, 8, 30, 0, 0, 0].entries()) {
    view.setUint16(24 + index * 2, value, false)
  }
  ascii(output, 36, 'acsp')
  ascii(output, 40, 'PJSI')
  fixed(view, 68, 0.9642)
  fixed(view, 72, 1)
  fixed(view, 76, 0.8249)
  ascii(output, 80, 'PJSI')
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
  '85f1616e233eb429b3517a97ed4151b4ae74a79eca58fd5c7c22bf44c24610a9'
