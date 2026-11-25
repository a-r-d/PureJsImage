import type { DecodeRequest, ImageDecoder } from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import { type ImageSource, readExactly } from '../source.ts'
import {
  type DibDescription,
  EntrySource,
  parseDirectory,
  parseDib,
  channel,
  selectedMetadata,
} from './ico.ts'
import { pngCodec } from './png.ts'
const dibBlockRows = 32

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const regionFor = (width: number, height: number, request: DecodeRequest): Region => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const regionWidth = request.width ?? width - x
  const regionHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(regionWidth) ||
    !Number.isSafeInteger(regionHeight) ||
    x < 0 ||
    y < 0 ||
    regionWidth < 1 ||
    regionHeight < 1 ||
    x + regionWidth > width ||
    y + regionHeight > height
  ) {
    throw invalidInput('ICO decode region is invalid')
  }
  return { x, y, width: regionWidth, height: regionHeight }
}

class DibDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #source: ImageSource
  readonly #description: DibDescription

  constructor(source: ImageSource, description: DibDescription) {
    this.#source = source
    this.#description = description
    this.width = description.width
    this.height = description.height
  }

  async #hasMeaningfulBgraAlpha(): Promise<boolean> {
    if (!this.#description.rawBgra) return this.#description.alpha !== undefined
    for (let row = 0; row < this.height; row += 1) {
      const encoded = await readExactly(
        this.#source,
        this.#description.pixelOffset + row * this.#description.xorStride,
        this.#description.width * 4,
      )
      for (let offset = 3; offset < encoded.byteLength; offset += 4) {
        if ((encoded[offset] ?? 0) !== 0) return true
      }
    }
    return false
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = regionFor(this.width, this.height, request)
    const meaningfulAlpha = await this.#hasMeaningfulBgraAlpha()
    const outputStride = region.width * 4
    for (let outputY = 0; outputY < region.height; outputY += dibBlockRows) {
      const height = Math.min(dibBlockRows, region.height - outputY)
      const firstImageY = region.y + outputY
      const firstStoredRow = this.height - (firstImageY + height)
      const xorRows = await readExactly(
        this.#source,
        this.#description.pixelOffset + firstStoredRow * this.#description.xorStride,
        height * this.#description.xorStride,
      )
      const andRows = await readExactly(
        this.#source,
        this.#description.andOffset + firstStoredRow * this.#description.andStride,
        height * this.#description.andStride,
      )
      const output = new Uint8Array(outputStride * height)
      for (let localY = 0; localY < height; localY += 1) {
        const storedLocalY = height - 1 - localY
        const xor = xorRows.subarray(
          storedLocalY * this.#description.xorStride,
          (storedLocalY + 1) * this.#description.xorStride,
        )
        const and = andRows.subarray(
          storedLocalY * this.#description.andStride,
          (storedLocalY + 1) * this.#description.andStride,
        )
        let target = localY * outputStride
        for (let localX = 0; localX < region.width; localX += 1) {
          const x = region.x + localX
          const masked = (((and[x >>> 3] ?? 0) >>> (7 - (x & 7))) & 1) !== 0
          let red = 0
          let green = 0
          let blue = 0
          let alpha = masked ? 0 : 255
          if (this.#description.bitDepth <= 8) {
            const packed = xor[Math.floor((x * this.#description.bitDepth) / 8)]
            if (packed === undefined) throw truncatedInput('ICO DIB packed pixel is truncated')
            const shift = 8 - this.#description.bitDepth - ((x * this.#description.bitDepth) & 7)
            const paletteIndex = (packed >>> shift) & ((1 << this.#description.bitDepth) - 1)
            const paletteOffset = paletteIndex * 3
            const palette = this.#description.palette
            red = palette?.[paletteOffset] ?? -1
            green = palette?.[paletteOffset + 1] ?? -1
            blue = palette?.[paletteOffset + 2] ?? -1
            if (red < 0 || green < 0 || blue < 0) {
              throw invalidInput(`ICO DIB palette index ${paletteIndex} is out of range`)
            }
          } else if (this.#description.bitDepth === 24) {
            const source = x * 3
            blue = xor[source] ?? 0
            green = xor[source + 1] ?? 0
            red = xor[source + 2] ?? 0
          } else if (this.#description.rawBgra) {
            const source = x * 4
            blue = xor[source] ?? 0
            green = xor[source + 1] ?? 0
            red = xor[source + 2] ?? 0
            if (meaningfulAlpha && !masked) alpha = xor[source + 3] ?? 0
          } else {
            const bytes = this.#description.bitDepth >>> 3
            const source = x * bytes
            const first = xor[source]
            const second = xor[source + 1]
            if (first === undefined || second === undefined) {
              throw truncatedInput('ICO DIB bitfield pixel is truncated')
            }
            let value = first + second * 256
            if (bytes === 4) {
              const third = xor[source + 2]
              const fourth = xor[source + 3]
              if (third === undefined || fourth === undefined) {
                throw truncatedInput('ICO DIB bitfield pixel is truncated')
              }
              value = (value + third * 65_536 + fourth * 16_777_216) >>> 0
            }
            red = channel(value, this.#description.red)
            green = channel(value, this.#description.green)
            blue = channel(value, this.#description.blue)
            if (this.#description.alpha && !masked) alpha = channel(value, this.#description.alpha)
          }
          output[target] = red
          output[target + 1] = green
          output[target + 2] = blue
          output[target + 3] = alpha
          target += 4
        }
      }
      yield {
        x: 0,
        y: outputY,
        width: region.width,
        height,
        stride: outputStride,
        format: 'rgba8',
        data: output,
      }
    }
  }
}

export const createIcoDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageDecoder> => {
  const directory = await parseDirectory(source, limits)
  const entry = directory.selected
  const entrySource = new EntrySource(source, entry)
  if (entry.png) {
    const metadata = await selectedMetadata(source, directory, limits)
    const decoder = await pngCodec.createDecoder?.(entrySource, limits)
    if (!decoder) throw unsupportedOperation('Embedded PNG decoding is unavailable')
    if (decoder.width !== metadata.width || decoder.height !== metadata.height) {
      throw invalidInput('ICO embedded PNG dimensions changed during decode')
    }
    return decoder
  }
  return new DibDecoder(entrySource, await parseDib(entrySource, entry, limits))
}
