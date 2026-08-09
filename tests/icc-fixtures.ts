const writeSignature = (data: Uint8Array, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    data[offset + index] = value.charCodeAt(index)
  }
}

const writeUint16 = (view: DataView, offset: number, value: number): void => {
  view.setUint16(offset, value, false)
}

const writeUint32 = (view: DataView, offset: number, value: number): void => {
  view.setUint32(offset, value, false)
}

const writeFixed = (view: DataView, offset: number, value: number): void => {
  view.setInt32(offset, Math.round(value * 65_536), false)
}

type Xyz = readonly [x: number, y: number, z: number]

const matrixRgbProfile = (red: Xyz, green: Xyz, blue: Xyz): Uint8Array => {
  const tagTableBytes = 4 + 6 * 12
  const redOffset = 128 + tagTableBytes
  const greenOffset = redOffset + 20
  const blueOffset = greenOffset + 20
  const curveOffset = blueOffset + 20
  const curveBytes = 12 + 256 * 2
  const profile = new Uint8Array(curveOffset + curveBytes)
  const view = new DataView(profile.buffer)
  writeUint32(view, 0, profile.byteLength)
  writeSignature(profile, 12, 'mntr')
  writeSignature(profile, 16, 'RGB ')
  writeSignature(profile, 20, 'XYZ ')
  writeSignature(profile, 36, 'acsp')
  writeUint32(view, 128, 6)
  const tag = (index: number, name: string, offset: number, size: number): void => {
    const entry = 132 + index * 12
    writeSignature(profile, entry, name)
    writeUint32(view, entry + 4, offset)
    writeUint32(view, entry + 8, size)
  }
  tag(0, 'rXYZ', redOffset, 20)
  tag(1, 'gXYZ', greenOffset, 20)
  tag(2, 'bXYZ', blueOffset, 20)
  tag(3, 'rTRC', curveOffset, curveBytes)
  tag(4, 'gTRC', curveOffset, curveBytes)
  tag(5, 'bTRC', curveOffset, curveBytes)
  const xyz = (offset: number, x: number, y: number, z: number): void => {
    writeSignature(profile, offset, 'XYZ ')
    writeFixed(view, offset + 8, x)
    writeFixed(view, offset + 12, y)
    writeFixed(view, offset + 16, z)
  }
  xyz(redOffset, ...red)
  xyz(greenOffset, ...green)
  xyz(blueOffset, ...blue)
  writeSignature(profile, curveOffset, 'curv')
  writeUint32(view, curveOffset + 8, 256)
  for (let value = 0; value < 256; value += 1) {
    const encoded = value / 255
    const linear = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
    writeUint16(view, curveOffset + 12 + value * 2, Math.round(linear * 65_535))
  }
  return profile
}

export const channelSwappingRgbProfile = (): Uint8Array =>
  matrixRgbProfile(
    [0.1430804, 0.0606169, 0.7141733],
    [0.3850649, 0.7168786, 0.0971045],
    [0.4360747, 0.2225045, 0.0139322],
  )

export const displayP3RgbProfile = (): Uint8Array =>
  matrixRgbProfile(
    [0.515075, 0.24117, -0.001049],
    [0.29194, 0.692236, 0.041884],
    [0.157179, 0.06659, 0.784546],
  )

export const rgbLutOnlyProfile = (
  offsets: readonly [first: number, second: number, third: number] = [0, 0, 0],
): Uint8Array => {
  const tagOffset = 144
  const outputCurveOffset = 32
  const matrixOffset = 68
  const middleCurveOffset = 116
  const clutOffset = 152
  const inputCurveOffset = 220
  const sampledCurveBytes = 12 + 256 * 2
  const tagBytes = inputCurveOffset + sampledCurveBytes * 3
  const profile = new Uint8Array(tagOffset + tagBytes)
  const view = new DataView(profile.buffer)
  writeUint32(view, 0, profile.byteLength)
  profile[8] = 4
  writeSignature(profile, 12, 'mntr')
  writeSignature(profile, 16, 'RGB ')
  writeSignature(profile, 20, 'XYZ ')
  writeSignature(profile, 36, 'acsp')
  writeUint32(view, 128, 1)
  writeSignature(profile, 132, 'A2B0')
  writeUint32(view, 136, tagOffset)
  writeUint32(view, 140, tagBytes)

  writeSignature(profile, tagOffset, 'mAB ')
  profile[tagOffset + 8] = 3
  profile[tagOffset + 9] = 3
  writeUint32(view, tagOffset + 12, outputCurveOffset)
  writeUint32(view, tagOffset + 16, matrixOffset)
  writeUint32(view, tagOffset + 20, middleCurveOffset)
  writeUint32(view, tagOffset + 24, clutOffset)
  writeUint32(view, tagOffset + 28, inputCurveOffset)

  const writeIdentityCurve = (offset: number): void => {
    writeSignature(profile, offset, 'curv')
    writeUint32(view, offset + 8, 0)
  }
  for (let channel = 0; channel < 3; channel += 1) {
    writeIdentityCurve(tagOffset + outputCurveOffset + channel * 12)
    writeIdentityCurve(tagOffset + middleCurveOffset + channel * 12)
  }
  const matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, offsets[0], offsets[1], offsets[2]]
  for (let index = 0; index < matrix.length; index += 1) {
    writeFixed(view, tagOffset + matrixOffset + index * 4, matrix[index] ?? 0)
  }

  const clut = tagOffset + clutOffset
  profile.set([2, 2, 2], clut)
  profile[clut + 16] = 2
  const red = [0.4360747, 0.2225045, 0.0139322] as const
  const green = [0.3850649, 0.7168786, 0.0971045] as const
  const blue = [0.1430804, 0.0606169, 0.7141733] as const
  let clutValue = clut + 20
  for (let redIndex = 0; redIndex < 2; redIndex += 1) {
    for (let greenIndex = 0; greenIndex < 2; greenIndex += 1) {
      for (let blueIndex = 0; blueIndex < 2; blueIndex += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          const xyz =
            redIndex * (red[channel] ?? 0) +
            greenIndex * (green[channel] ?? 0) +
            blueIndex * (blue[channel] ?? 0)
          writeUint16(view, clutValue, Math.round(xyz * 32_768))
          clutValue += 2
        }
      }
    }
  }

  for (let channel = 0; channel < 3; channel += 1) {
    const offset = tagOffset + inputCurveOffset + channel * sampledCurveBytes
    writeSignature(profile, offset, 'curv')
    writeUint32(view, offset + 8, 256)
    for (let value = 0; value < 256; value += 1) {
      const encoded = value / 255
      const linear = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
      writeUint16(view, offset + 12 + value * 2, Math.round(linear * 65_535))
    }
  }
  return profile
}
