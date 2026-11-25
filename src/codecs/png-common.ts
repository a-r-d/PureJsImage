import { invalidInput } from '../errors.ts'
import type { PixelFormat } from '../pixel.ts'

export const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
export const scanlineBlockRows = 32
export const isPng = (header: Uint8Array): boolean =>
  signature.every((byte, index) => header[index] === byte)

export const bytesPerPixel = (format: PixelFormat): number => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  if (format === 'gray16') return 2
  if (format === 'rgb16') return 6
  if (format === 'rgba16') return 8
  throw invalidInput(`PNG does not support ${format} encoder input`)
}

export const paeth = (left: number, up: number, upperLeft: number): number => {
  const prediction = left + up - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const upDistance = Math.abs(prediction - up)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  return upDistance <= upperLeftDistance ? up : upperLeft
}
