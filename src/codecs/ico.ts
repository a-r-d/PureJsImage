import type { DecodeRequest, ImageCodec, ImageDecoder, ImageMetadata } from '../codec.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import { pngCodec } from './png.ts'

const iconDirectoryBytes = 6
const iconEntryBytes = 16
const dibBlockRows = 32
const bitmapCoreHeaderBytes = 12
const bitmapInfoHeaderBytes = 40
const bitmapV2HeaderBytes = 52
const bitmapV3HeaderBytes = 56
const bitmapV4HeaderBytes = 108
const bitmapV5HeaderBytes = 124
const rgbCompression = 0
const bitfieldsCompression = 3
const alphaBitfieldsCompression = 6
const pngSignature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

interface IcoEntry {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly colorCount: number
  readonly planes: number
  readonly bitDepth: number
  readonly length: number
  readonly offset: number
  readonly png: boolean
}

interface IcoDirectory {
  readonly entries: readonly IcoEntry[]
  readonly selected: IcoEntry
}

interface ChannelMask {
  readonly mask: number
  readonly shift: number
  readonly maximum: number
}

interface DibDescription {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly pixelOffset: number
  readonly xorStride: number
  readonly andOffset: number
  readonly andStride: number
  readonly palette: Uint8Array | undefined
  readonly red: ChannelMask | undefined
  readonly green: ChannelMask | undefined
  readonly blue: ChannelMask | undefined
  readonly alpha: ChannelMask | undefined
  readonly rawBgra: boolean
}

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const isIco = (header: Uint8Array): boolean =>
  header[0] === 0 && header[1] === 0 && header[2] === 1 && header[3] === 0

const uint16 = (data: Uint8Array, offset: number, label: string): number => {
  const low = data[offset]
  const high = data[offset + 1]
  if (low === undefined || high === undefined) throw truncatedInput(`ICO ${label} is truncated`)
  return low + high * 256
}

const uint32 = (data: Uint8Array, offset: number, label: string): number => {
  const first = data[offset]
  const second = data[offset + 1]
  const third = data[offset + 2]
  const fourth = data[offset + 3]
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    throw truncatedInput(`ICO ${label} is truncated`)
  }
  return (first + second * 256 + third * 65_536 + fourth * 16_777_216) >>> 0
}

const int32 = (data: Uint8Array, offset: number, label: string): number => {
  const value = uint32(data, offset, label)
  return value >= 0x80000000 ? value - 0x100000000 : value
}

const startsWithPng = (data: Uint8Array): boolean =>
  pngSignature.every((byte, index) => data[index] === byte)

class EntrySource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  readonly #offset: number

  constructor(source: ImageSource, entry: IcoEntry) {
    this.#source = source
    this.#offset = entry.offset
    this.size = entry.length
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw invalidInput('ICO entry read offset must be non-negative')
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidInput('ICO entry read length must be non-negative')
    }
    if (offset >= this.size) return new Uint8Array()
    return this.#source.read(this.#offset + offset, Math.min(length, this.size - offset))
  }
}

const betterEntry = (candidate: IcoEntry, current: IcoEntry): boolean => {
  const candidateArea = candidate.width * candidate.height
  const currentArea = current.width * current.height
  if (candidateArea !== currentArea) return candidateArea > currentArea
  const candidateDepth = Math.min(candidate.bitDepth || (candidate.png ? 32 : 0), 32)
  const currentDepth = Math.min(current.bitDepth || (current.png ? 32 : 0), 32)
  if (candidateDepth !== currentDepth) return candidateDepth > currentDepth
  if (candidate.png !== current.png) return candidate.png
  return false
}

const parseDirectory = async (source: ImageSource, limits: ImageLimits): Promise<IcoDirectory> => {
  if (source.size < iconDirectoryBytes) throw truncatedInput('ICO directory header is truncated')
  const header = await readExactly(source, 0, iconDirectoryBytes)
  const reserved = uint16(header, 0, 'reserved field')
  const type = uint16(header, 2, 'type')
  const count = uint16(header, 4, 'image count')
  if (reserved !== 0) throw invalidInput('ICO reserved field must be zero')
  if (type !== 1) {
    if (type === 2) throw unsupportedOperation('Windows cursor decoding is not implemented')
    throw invalidInput(`ICO type must be 1, received ${type}`)
  }
  if (count < 1) throw invalidInput('ICO image count must be positive')
  if (count > limits.maxFrames) {
    throw limitExceeded(`ICO image count ${count} exceeds maxFrames ${limits.maxFrames}`)
  }
  const directoryBytes = iconDirectoryBytes + count * iconEntryBytes
  if (!Number.isSafeInteger(directoryBytes) || directoryBytes > source.size) {
    throw truncatedInput('ICO image directory is truncated')
  }
  const encoded = await readExactly(source, iconDirectoryBytes, count * iconEntryBytes)
  const entries: IcoEntry[] = []
  for (let index = 0; index < count; index += 1) {
    const base = index * iconEntryBytes
    const width = encoded[base] === 0 ? 256 : (encoded[base] ?? 0)
    const height = encoded[base + 1] === 0 ? 256 : (encoded[base + 1] ?? 0)
    const colorCount = encoded[base + 2] ?? 0
    const entryReserved = encoded[base + 3] ?? 0
    const planes = uint16(encoded, base + 4, `entry ${index} planes`)
    const bitDepth = uint16(encoded, base + 6, `entry ${index} bit depth`)
    const length = uint32(encoded, base + 8, `entry ${index} byte length`)
    const offset = uint32(encoded, base + 12, `entry ${index} offset`)
    if (entryReserved !== 0) throw invalidInput(`ICO entry ${index} reserved field must be zero`)
    if (width < 1 || height < 1) throw invalidInput(`ICO entry ${index} dimensions are invalid`)
    if (planes !== 0 && planes !== 1) {
      throw invalidInput(`ICO entry ${index} plane count must be zero or one`)
    }
    if (![0, 1, 4, 8, 16, 24, 32].includes(bitDepth)) {
      throw invalidInput(`ICO entry ${index} bit depth ${bitDepth} is invalid`)
    }
    validateImageDimensions(width, height, 1, limits)
    if (length < 1) throw invalidInput(`ICO entry ${index} is empty`)
    const end = offset + length
    if (!Number.isSafeInteger(end) || offset < directoryBytes || end > source.size) {
      throw truncatedInput(`ICO entry ${index} payload exceeds the input`)
    }
    const signature = await readExactly(source, offset, Math.min(pngSignature.byteLength, length))
    entries.push({
      index,
      width,
      height,
      colorCount,
      planes,
      bitDepth,
      length,
      offset,
      png: signature.byteLength === pngSignature.byteLength && startsWithPng(signature),
    })
  }

  const byOffset = [...entries].sort((left, right) => left.offset - right.offset)
  for (let index = 1; index < byOffset.length; index += 1) {
    const previous = byOffset[index - 1]
    const current = byOffset[index]
    if (!previous || !current) continue
    const previousEnd = previous.offset + previous.length
    if (current.offset < previousEnd) {
      const identical = current.offset === previous.offset && current.length === previous.length
      if (!identical) throw invalidInput('ICO image payloads overlap')
    }
  }

  let selected = entries[0]
  if (!selected) throw invalidInput('ICO image directory is empty')
  for (let index = 1; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry && betterEntry(entry, selected)) selected = entry
  }
  return { entries, selected }
}

const mask = (value: number, name: string): ChannelMask => {
  const normalized = value >>> 0
  if (normalized === 0) throw invalidInput(`ICO DIB ${name} mask is empty`)
  let shift = 0
  while (((normalized >>> shift) & 1) === 0) shift += 1
  const maximum = normalized >>> shift
  if ((maximum & (maximum + 1)) !== 0) {
    throw invalidInput(`ICO DIB ${name} mask is not contiguous`)
  }
  return { mask: normalized, shift, maximum }
}

const validateMasks = (masks: readonly ChannelMask[]): void => {
  for (let left = 0; left < masks.length; left += 1) {
    for (let right = left + 1; right < masks.length; right += 1) {
      const first = masks[left]
      const second = masks[right]
      if (first && second && (first.mask & second.mask) !== 0) {
        throw invalidInput('ICO DIB channel masks overlap')
      }
    }
  }
}

const parseDib = async (
  source: ImageSource,
  entry: IcoEntry,
  limits: ImageLimits,
): Promise<DibDescription> => {
  if (source.size < bitmapCoreHeaderBytes) throw truncatedInput('ICO DIB header is truncated')
  const prefix = await readExactly(source, 0, Math.min(source.size, bitmapV5HeaderBytes))
  const headerSize = uint32(prefix, 0, 'DIB header size')
  if (
    headerSize !== bitmapCoreHeaderBytes &&
    headerSize !== bitmapInfoHeaderBytes &&
    headerSize !== bitmapV2HeaderBytes &&
    headerSize !== bitmapV3HeaderBytes &&
    headerSize !== bitmapV4HeaderBytes &&
    headerSize !== bitmapV5HeaderBytes
  ) {
    throw unsupportedOperation(`ICO DIB header size ${headerSize} is unsupported`)
  }
  if (headerSize > source.size) throw truncatedInput('ICO DIB header exceeds its entry')
  const header =
    prefix.byteLength >= headerSize
      ? prefix.subarray(0, headerSize)
      : await readExactly(source, 0, headerSize)
  const core = headerSize === bitmapCoreHeaderBytes
  const width = core ? uint16(header, 4, 'DIB width') : int32(header, 4, 'DIB width')
  const storedHeight = core
    ? uint16(header, 6, 'DIB stored height')
    : int32(header, 8, 'DIB stored height')
  const planes = core ? uint16(header, 8, 'DIB planes') : uint16(header, 12, 'DIB planes')
  const bitDepth = core ? uint16(header, 10, 'DIB bit depth') : uint16(header, 14, 'DIB bit depth')
  const compression = core ? rgbCompression : uint32(header, 16, 'DIB compression')
  const colorsUsed =
    headerSize >= bitmapInfoHeaderBytes ? uint32(header, 32, 'DIB palette size') : 0
  if (width < 1 || storedHeight < 1 || (storedHeight & 1) !== 0) {
    throw invalidInput(`ICO DIB dimensions ${width}x${storedHeight} are invalid`)
  }
  const height = storedHeight / 2
  validateImageDimensions(width, height, 1, limits)
  if (width !== entry.width || height !== entry.height) {
    throw invalidInput(
      `ICO entry ${entry.index} directory dimensions ${entry.width}x${entry.height} do not match its DIB ${width}x${height}`,
    )
  }
  if (planes !== 1 || (entry.planes !== 0 && entry.planes !== planes)) {
    throw invalidInput(`ICO entry ${entry.index} DIB plane count is invalid`)
  }
  if (![1, 4, 8, 16, 24, 32].includes(bitDepth)) {
    throw unsupportedOperation(`ICO DIB bit depth ${bitDepth} is unsupported`)
  }
  if (entry.bitDepth !== 0 && entry.bitDepth !== bitDepth) {
    throw invalidInput(`ICO entry ${entry.index} bit depth contradicts its DIB payload`)
  }
  if (
    compression !== rgbCompression &&
    compression !== bitfieldsCompression &&
    compression !== alphaBitfieldsCompression
  ) {
    throw unsupportedOperation(`ICO DIB compression method ${compression} is unsupported`)
  }
  if (
    (compression === bitfieldsCompression || compression === alphaBitfieldsCompression) &&
    bitDepth !== 16 &&
    bitDepth !== 32
  ) {
    throw invalidInput('ICO DIB bitfields require 16-bit or 32-bit pixels')
  }

  let bytesAfterHeader = 0
  let redValue = bitDepth === 16 ? 0x7c00 : 0x00ff0000
  let greenValue = bitDepth === 16 ? 0x03e0 : 0x0000ff00
  let blueValue = bitDepth === 16 ? 0x001f : 0x000000ff
  let alphaValue = 0
  if (compression === bitfieldsCompression || compression === alphaBitfieldsCompression) {
    if (headerSize >= bitmapV2HeaderBytes) {
      redValue = uint32(header, 40, 'DIB red mask')
      greenValue = uint32(header, 44, 'DIB green mask')
      blueValue = uint32(header, 48, 'DIB blue mask')
      if (headerSize >= bitmapV3HeaderBytes) alphaValue = uint32(header, 52, 'DIB alpha mask')
    } else {
      bytesAfterHeader = compression === alphaBitfieldsCompression ? 16 : 12
      const encodedMasks = await readExactly(source, headerSize, bytesAfterHeader)
      redValue = uint32(encodedMasks, 0, 'DIB red mask')
      greenValue = uint32(encodedMasks, 4, 'DIB green mask')
      blueValue = uint32(encodedMasks, 8, 'DIB blue mask')
      if (bytesAfterHeader === 16) alphaValue = uint32(encodedMasks, 12, 'DIB alpha mask')
    }
  }
  if (compression === alphaBitfieldsCompression && alphaValue === 0) {
    throw invalidInput('ICO DIB alpha bitfields require an alpha mask')
  }
  const red =
    bitDepth >= 16 && !(bitDepth === 32 && compression === rgbCompression)
      ? mask(redValue, 'red')
      : undefined
  const green =
    bitDepth >= 16 && !(bitDepth === 32 && compression === rgbCompression)
      ? mask(greenValue, 'green')
      : undefined
  const blue =
    bitDepth >= 16 && !(bitDepth === 32 && compression === rgbCompression)
      ? mask(blueValue, 'blue')
      : undefined
  const alpha = alphaValue === 0 ? undefined : mask(alphaValue, 'alpha')
  if (red && green && blue) validateMasks(alpha ? [red, green, blue, alpha] : [red, green, blue])

  let palette: Uint8Array | undefined
  let paletteBytes = 0
  if (bitDepth <= 8) {
    const maximumColors = 1 << bitDepth
    const paletteColors = colorsUsed || entry.colorCount || maximumColors
    if (paletteColors < 1 || paletteColors > maximumColors) {
      throw invalidInput(
        `ICO DIB palette contains ${paletteColors} colors for ${bitDepth}-bit pixels`,
      )
    }
    const entryBytes = core ? 3 : 4
    paletteBytes = paletteColors * entryBytes
    const encodedPalette = await readExactly(source, headerSize + bytesAfterHeader, paletteBytes)
    palette = new Uint8Array(paletteColors * 3)
    for (let index = 0; index < paletteColors; index += 1) {
      const input = index * entryBytes
      const output = index * 3
      palette[output] = encodedPalette[input + 2] ?? 0
      palette[output + 1] = encodedPalette[input + 1] ?? 0
      palette[output + 2] = encodedPalette[input] ?? 0
    }
  }

  const pixelOffset = headerSize + bytesAfterHeader + paletteBytes
  const xorStride = Math.floor((width * bitDepth + 31) / 32) * 4
  const andStride = Math.floor((width + 31) / 32) * 4
  const andOffset = pixelOffset + xorStride * height
  const requiredBytes = BigInt(andOffset) + BigInt(andStride) * BigInt(height)
  if (requiredBytes > BigInt(source.size)) throw truncatedInput('ICO DIB pixel data is truncated')
  return {
    width,
    height,
    bitDepth,
    pixelOffset,
    xorStride,
    andOffset,
    andStride,
    palette,
    red,
    green,
    blue,
    alpha,
    rawBgra: bitDepth === 32 && compression === rgbCompression,
  }
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

const channel = (value: number, description: ChannelMask | undefined): number => {
  if (!description) return 255
  const sample = (value & description.mask) >>> description.shift
  return Math.round((sample * 255) / description.maximum)
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

const selectedMetadata = async (
  source: ImageSource,
  directory: IcoDirectory,
  limits: ImageLimits,
): Promise<ImageMetadata> => {
  const entry = directory.selected
  const entrySource = new EntrySource(source, entry)
  if (entry.png) {
    const metadata = await pngCodec.metadata(entrySource, limits)
    if (metadata.frames !== undefined && metadata.frames !== 1) {
      throw unsupportedOperation('Animated PNG entries in ICO files are unsupported')
    }
    if (metadata.width !== entry.width || metadata.height !== entry.height) {
      throw invalidInput(
        `ICO entry ${entry.index} directory dimensions ${entry.width}x${entry.height} do not match its PNG ${metadata.width}x${metadata.height}`,
      )
    }
    return {
      ...metadata,
      format: 'ico',
      mimeType: 'image/x-icon',
      frames: directory.entries.length,
    }
  }
  const dib = await parseDib(entrySource, entry, limits)
  return {
    width: dib.width,
    height: dib.height,
    format: 'ico',
    mimeType: 'image/x-icon',
    hasAlpha: true,
    colorSpace: 'srgb',
    bitDepth: dib.bitDepth,
    frames: directory.entries.length,
  }
}

export const icoCodec: ImageCodec = {
  format: 'ico',
  mimeTypes: ['image/x-icon', 'image/vnd.microsoft.icon'],
  minimumBytes: iconDirectoryBytes,
  detect: isIco,
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    const directory = await parseDirectory(source, limits)
    return selectedMetadata(source, directory, limits)
  },
  async createDecoder(source: ImageSource, limits: ImageLimits): Promise<ImageDecoder> {
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
  },
}
