export const fineAllocationWidth = 2049
export const fineAllocationHeight = 2048

export const createFineAllocationPhoto = (): Uint8Array => {
  const width = fineAllocationWidth,
    height = fineAllocationHeight,
    pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      pixels[at] = (x + y) & 255
      pixels[at + 1] = (Math.floor(x / 3) + Math.floor(y / 5)) & 255
      pixels[at + 2] = (x ^ y) & 255
      pixels[at + 3] = 255
    }
  return pixels
}
