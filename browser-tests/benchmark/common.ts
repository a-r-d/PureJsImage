export const imageDataFromInput = async (input: ArrayBuffer): Promise<ImageData> => {
  const bitmap = await createImageBitmap(new Blob([input]))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D OffscreenCanvas context is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

export const pixelChecksum = (pixels: Uint8Array | Uint8ClampedArray): string => {
  if (pixels.byteLength === 0) throw new Error('Decoded benchmark output has no pixels')
  let hash = 2_166_136_261
  let minimum = 255
  let maximum = 0
  for (let offset = 0; offset < pixels.byteLength; offset += 1) {
    const value = pixels[offset]
    if (value === undefined) throw new Error('Decoded benchmark pixel data is truncated')
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
    hash = Math.imul(hash ^ value, 16_777_619) >>> 0
  }
  if (minimum === maximum) throw new Error('Decoded benchmark output is a flat image')
  return hash.toString(16).padStart(8, '0')
}

export const verifyEncodedImage = async (
  output: ArrayBuffer | Blob | undefined,
  width: number,
  height: number,
): Promise<string> => {
  if (output === undefined) throw new Error('Benchmark produced no output')
  const blob = output instanceof Blob ? output : new Blob([output])
  const bitmap = await createImageBitmap(blob)
  const actual = `${bitmap.width}x${bitmap.height}`
  if (actual !== `${width}x${height}`) {
    bitmap.close()
    throw new Error(`Benchmark output was ${actual}, expected ${width}x${height}`)
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D OffscreenCanvas context is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const checksum = pixelChecksum(context.getImageData(0, 0, canvas.width, canvas.height).data)
  return `decoded output ${actual}; pixel checksum ${checksum}`
}
