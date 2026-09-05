import { createImageLibrary } from 'purejsimage'
import { jpegxlCodec } from 'purejsimage/codecs/jpegxl'
import { pngCodec } from 'purejsimage/codecs/png'

const images = createImageLibrary([jpegxlCodec, pngCodec])

export async function sdrRgbToPng(sdrRgbJxl: Uint8Array): Promise<Uint8Array> {
  const display = await images.open(sdrRgbJxl, { colorOutput: 'srgb' })
  return display.autoOrient().convertPixelFormat({ format: 'rgb8' }).png().toUint8Array()
}

export async function sdrRgbaToPng(sdrRgbaJxl: Uint8Array): Promise<Uint8Array> {
  const display = await images.open(sdrRgbaJxl, {
    colorOutput: 'srgb',
    alphaOutput: 'straight',
  })
  return display.autoOrient().convertPixelFormat({ format: 'rgba8' }).png().toUint8Array()
}

export async function hdrRgbToPng(hdrRgbJxl: Uint8Array): Promise<Uint8Array> {
  const display = await images.open(hdrRgbJxl, {
    colorOutput: 'srgb',
    hdrOutput: 'tone-map-srgb',
  })
  return display.autoOrient().convertPixelFormat({ format: 'rgb8' }).png().toUint8Array()
}

export async function hdrRgbaToPng(hdrRgbaJxl: Uint8Array): Promise<Uint8Array> {
  const display = await images.open(hdrRgbaJxl, {
    colorOutput: 'srgb',
    hdrOutput: 'tone-map-srgb',
    alphaOutput: 'straight',
  })
  return display.autoOrient().convertPixelFormat({ format: 'rgba8' }).png().toUint8Array()
}
