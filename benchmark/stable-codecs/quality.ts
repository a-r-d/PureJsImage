import sharp from 'sharp'

export interface IndependentQualityResult {
  readonly exact: boolean
  readonly oracle: string
  readonly psnrDb: number | 'exact'
}

export const measureIndependentQuality = async (
  input: Uint8Array,
  output: Uint8Array,
): Promise<IndependentQualityResult> => {
  const source = await sharp(Buffer.from(input)).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  })
  const actual = await sharp(Buffer.from(output)).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  })
  if (source.info.width !== actual.info.width || source.info.height !== actual.info.height) {
    throw new Error(
      `Independent quality dimensions differ: ${source.info.width}x${source.info.height} versus ${actual.info.width}x${actual.info.height}`,
    )
  }
  let squaredError = 0
  for (let index = 0; index < source.data.byteLength; index += 1) {
    const difference = (source.data[index] ?? 0) - (actual.data[index] ?? 0)
    squaredError += difference * difference
  }
  return {
    exact: squaredError === 0,
    oracle: `sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}`,
    psnrDb:
      squaredError === 0
        ? 'exact'
        : 10 * Math.log10((255 * 255) / (squaredError / source.data.byteLength)),
  }
}
