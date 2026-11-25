import { invalidInput } from '../errors.ts'
import { decodeBaselineJpegNative, parseBaselineJpeg } from './jpeg-baseline.ts'

export const decodeTiffJpegRaster = async (
  encoded: Uint8Array,
  width: number,
  rows: number,
  samplesPerPixel: number,
): Promise<Uint8Array> => {
  const jpeg = parseBaselineJpeg(encoded, false, samplesPerPixel >= 4)
  if (!jpeg) {
    throw invalidInput('TIFF JPEG raster segment is not a supported baseline stream')
  }
  if (jpeg.components.length !== samplesPerPixel) {
    throw invalidInput(
      `TIFF JPEG raster segment has ${jpeg.components.length} components, expected ${samplesPerPixel}`,
    )
  }
  if (jpeg.width !== width || jpeg.height < rows) {
    throw invalidInput(
      `TIFF JPEG raster segment dimensions ${jpeg.width}x${jpeg.height} do not match ${width}x${rows}`,
    )
  }
  const decoded = await decodeBaselineJpegNative(jpeg, {
    x: 0,
    y: 0,
    width,
    height: rows,
  })
  const expectedBytes = width * rows * samplesPerPixel
  if (decoded.byteLength !== expectedBytes) {
    throw invalidInput(
      `TIFF JPEG raster decoder produced ${decoded.byteLength}, expected ${expectedBytes} bytes`,
    )
  }
  return decoded
}
