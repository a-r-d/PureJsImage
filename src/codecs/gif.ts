import type { DecodeRequest, ImageCodec, ImageDecoder, ImageMetadata } from '../codec.ts'
import { invalidInput, truncatedInput } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { SourceReader, readExactly } from '../source.ts'
import { ascii, uint16LittleEndian } from './helpers.ts'

const isGif = (header: Uint8Array): boolean => {
  const version = header.byteLength >= 6 ? ascii(header, 0, 6) : ''
  return version === 'GIF87a' || version === 'GIF89a'
}

const colorTableBytes = (packed: number): number => 3 * 2 ** ((packed & 0x07) + 1)
const blockRows = 32

interface GifFrame {
  readonly screenWidth: number
  readonly screenHeight: number
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly interlaced: boolean
  readonly palette: Uint8Array
  readonly transparentIndex: number | undefined
  readonly minimumCodeSize: number
  readonly chunks: readonly Uint8Array[]
}

interface GifRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const byte = (data: Uint8Array, offset: number): number => {
  const value = data[offset]
  if (value === undefined) throw truncatedInput(`GIF is truncated at offset ${offset}`)
  return value
}

const littleEndian = (data: Uint8Array, offset: number): number =>
  byte(data, offset) | (byte(data, offset + 1) << 8)

const tableAt = (
  data: Uint8Array,
  offset: number,
  packed: number,
): { readonly table: Uint8Array; readonly next: number } => {
  const length = colorTableBytes(packed)
  if (offset + length > data.byteLength) throw truncatedInput('GIF color table is truncated')
  return { table: data.subarray(offset, offset + length), next: offset + length }
}

const subBlocksAt = (
  data: Uint8Array,
  start: number,
  collect: boolean,
): { readonly chunks: readonly Uint8Array[]; readonly next: number } => {
  const chunks: Uint8Array[] = []
  let offset = start
  for (let blocks = 0; blocks < 1_000_000; blocks += 1) {
    const length = byte(data, offset)
    offset += 1
    if (length === 0) return { chunks, next: offset }
    if (offset + length > data.byteLength) throw truncatedInput('GIF data sub-block is truncated')
    if (collect) chunks.push(data.subarray(offset, offset + length))
    offset += length
  }
  throw invalidInput('GIF contains too many data sub-blocks')
}

const parseFirstFrame = (data: Uint8Array, limits: ImageLimits): GifFrame => {
  if (data.byteLength < 13 || !isGif(data)) throw invalidInput('GIF header is invalid')
  const screenWidth = littleEndian(data, 6)
  const screenHeight = littleEndian(data, 8)
  validateImageDimensions(screenWidth, screenHeight, 1, limits)
  const screenPacked = byte(data, 10)
  let offset = 13
  let globalPalette: Uint8Array | undefined
  if ((screenPacked & 0x80) !== 0) {
    const colorTable = tableAt(data, offset, screenPacked)
    globalPalette = colorTable.table
    offset = colorTable.next
  }
  let transparentIndex: number | undefined

  for (let blocks = 0; offset < data.byteLength && blocks < 1_000_000; blocks += 1) {
    const marker = byte(data, offset)
    offset += 1
    if (marker === 0x3b) break
    if (marker === 0x21) {
      const label = byte(data, offset)
      offset += 1
      if (label === 0xf9) {
        if (byte(data, offset) !== 4)
          throw invalidInput('GIF graphics control extension is invalid')
        const packed = byte(data, offset + 1)
        transparentIndex = (packed & 1) === 0 ? undefined : byte(data, offset + 4)
        if (byte(data, offset + 5) !== 0) throw invalidInput('GIF extension terminator is missing')
        offset += 6
      } else {
        offset = subBlocksAt(data, offset, false).next
      }
      continue
    }
    if (marker !== 0x2c) {
      throw invalidInput(`GIF contains an unknown block marker: 0x${marker.toString(16)}`)
    }

    const left = littleEndian(data, offset)
    const top = littleEndian(data, offset + 2)
    const width = littleEndian(data, offset + 4)
    const height = littleEndian(data, offset + 6)
    const imagePacked = byte(data, offset + 8)
    offset += 9
    if (width < 1 || height < 1 || left + width > screenWidth || top + height > screenHeight) {
      throw invalidInput(
        `GIF frame ${left},${top} ${width}x${height} exceeds ${screenWidth}x${screenHeight}`,
      )
    }
    let palette = globalPalette
    if ((imagePacked & 0x80) !== 0) {
      const colorTable = tableAt(data, offset, imagePacked)
      palette = colorTable.table
      offset = colorTable.next
    }
    if (!palette) throw invalidInput('GIF frame has no color table')
    const minimumCodeSize = byte(data, offset)
    offset += 1
    if (minimumCodeSize < 2 || minimumCodeSize > 8) {
      throw invalidInput(`GIF LZW minimum code size ${minimumCodeSize} is invalid`)
    }
    const imageData = subBlocksAt(data, offset, true)
    return {
      screenWidth,
      screenHeight,
      left,
      top,
      width,
      height,
      interlaced: (imagePacked & 0x40) !== 0,
      palette,
      transparentIndex,
      minimumCodeSize,
      chunks: imageData.chunks,
    }
  }
  throw invalidInput('GIF contains no image frames')
}

class GifBitReader {
  readonly #chunks: readonly Uint8Array[]
  #chunk = 0
  #offset = 0
  #bits = 0
  #bitCount = 0

  constructor(chunks: readonly Uint8Array[]) {
    this.#chunks = chunks
  }

  read(length: number): number {
    while (this.#bitCount < length) {
      while (this.#chunk < this.#chunks.length) {
        const chunk = this.#chunks[this.#chunk]
        const next = chunk?.[this.#offset]
        if (next !== undefined) {
          this.#bits |= next << this.#bitCount
          this.#bitCount += 8
          this.#offset += 1
          break
        }
        this.#chunk += 1
        this.#offset = 0
      }
      if (this.#bitCount < length && this.#chunk >= this.#chunks.length) {
        throw truncatedInput('GIF LZW data ended before its end code')
      }
    }
    const value = this.#bits & ((1 << length) - 1)
    this.#bits >>>= length
    this.#bitCount -= length
    return value
  }
}

const decodeIndices = (frame: GifFrame): Uint8Array => {
  const expected = frame.width * frame.height
  const output = new Uint8Array(expected)
  const prefix = new Int16Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4096)
  const clearCode = 1 << frame.minimumCodeSize
  const endCode = clearCode + 1
  for (let code = 0; code < clearCode; code += 1) suffix[code] = code
  const reader = new GifBitReader(frame.chunks)
  let codeSize = frame.minimumCodeSize + 1
  let available = endCode + 1
  let previous = -1
  let first = 0
  let written = 0
  let ended = false

  for (let codes = 0; codes < expected * 2 + 4096; codes += 1) {
    let code = reader.read(codeSize)
    if (code === clearCode) {
      codeSize = frame.minimumCodeSize + 1
      available = endCode + 1
      previous = -1
      continue
    }
    if (code === endCode) {
      ended = true
      break
    }
    if (previous < 0) {
      if (code >= clearCode) throw invalidInput('GIF LZW stream starts with an invalid code')
      if (written >= expected) throw invalidInput('GIF LZW stream contains too many pixels')
      output[written] = code
      written += 1
      first = code
      previous = code
      continue
    }

    const inputCode = code
    let stackLength = 0
    if (code === available) {
      stack[stackLength] = first
      stackLength += 1
      code = previous
    } else if (code > available) {
      throw invalidInput('GIF LZW stream references an unavailable code')
    }
    while (code >= clearCode) {
      if (code >= available || stackLength >= stack.length) {
        throw invalidInput('GIF LZW dictionary chain is invalid')
      }
      stack[stackLength] = suffix[code] ?? 0
      stackLength += 1
      code = prefix[code] ?? -1
      if (code < 0) throw invalidInput('GIF LZW dictionary prefix is invalid')
    }
    first = suffix[code] ?? 0
    stack[stackLength] = first
    stackLength += 1
    while (stackLength > 0) {
      if (written >= expected) throw invalidInput('GIF LZW stream contains too many pixels')
      stackLength -= 1
      output[written] = stack[stackLength] ?? 0
      written += 1
    }
    if (available < 4096) {
      prefix[available] = previous
      suffix[available] = first
      available += 1
      if (available === 1 << codeSize && codeSize < 12) codeSize += 1
    }
    previous = inputCode
  }
  if (!ended) throw invalidInput('GIF LZW stream did not reach an end code')
  if (written !== expected) {
    throw truncatedInput(`GIF frame decoded ${written} of ${expected} pixels`)
  }
  for (const index of output) {
    if (index !== frame.transparentIndex && index * 3 + 2 >= frame.palette.byteLength) {
      throw invalidInput(`GIF palette index ${index} is outside its color table`)
    }
  }
  return output
}

const rowsByDisplayOrder = (height: number, interlaced: boolean): Int32Array => {
  const rows = new Int32Array(height)
  if (!interlaced) {
    for (let row = 0; row < height; row += 1) rows[row] = row
    return rows
  }
  let storageRow = 0
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const) {
    for (let row = start; row < height; row += step) {
      rows[row] = storageRow
      storageRow += 1
    }
  }
  return rows
}

const region = (width: number, height: number, request: DecodeRequest = {}): GifRegion => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const outputWidth = request.width ?? width - x
  const outputHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    x < 0 ||
    y < 0 ||
    outputWidth < 1 ||
    outputHeight < 1 ||
    x + outputWidth > width ||
    y + outputHeight > height
  ) {
    throw invalidInput(`GIF decode region ${x},${y} ${outputWidth}x${outputHeight} is invalid`)
  }
  return { x, y, width: outputWidth, height: outputHeight }
}

class GifDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #frame: GifFrame

  constructor(frame: GifFrame) {
    this.width = frame.screenWidth
    this.height = frame.screenHeight
    this.#frame = frame
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const output = region(this.width, this.height, request)
    const indices = decodeIndices(this.#frame)
    const rows = rowsByDisplayOrder(this.#frame.height, this.#frame.interlaced)
    const stride = output.width * 4
    for (let outputY = 0; outputY < output.height; outputY += blockRows) {
      const height = Math.min(blockRows, output.height - outputY)
      const data = new Uint8Array(stride * height)
      for (let row = 0; row < height; row += 1) {
        const screenY = output.y + outputY + row
        const frameY = screenY - this.#frame.top
        if (frameY < 0 || frameY >= this.#frame.height) continue
        const storageRow = rows[frameY] ?? 0
        for (let x = 0; x < output.width; x += 1) {
          const frameX = output.x + x - this.#frame.left
          if (frameX < 0 || frameX >= this.#frame.width) continue
          const index = indices[storageRow * this.#frame.width + frameX] ?? 0
          if (index === this.#frame.transparentIndex) continue
          const palette = index * 3
          const target = row * stride + x * 4
          data[target] = this.#frame.palette[palette] ?? 0
          data[target + 1] = this.#frame.palette[palette + 1] ?? 0
          data[target + 2] = this.#frame.palette[palette + 2] ?? 0
          data[target + 3] = 255
        }
      }
      yield {
        x: 0,
        y: outputY,
        width: output.width,
        height,
        stride,
        format: 'rgba8',
        data,
      }
    }
  }
}

const decodeGif = async (source: ImageSource, limits: ImageLimits): Promise<ImageDecoder> => {
  const data = await readExactly(source, 0, source.size)
  return new GifDecoder(parseFirstFrame(data, limits))
}

const skipSubBlocks = async (reader: SourceReader): Promise<void> => {
  for (let blocks = 0; blocks < 1_000_000; blocks += 1) {
    const length = await reader.readByte()
    if (length === 0) return
    reader.skip(length)
  }
  throw invalidInput('GIF contains too many data sub-blocks')
}

export const gifCodec: ImageCodec = {
  format: 'gif',
  mimeTypes: ['image/gif'],
  minimumBytes: 6,
  detect: isGif,
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    const header = await readExactly(source, 0, 13)
    if (!isGif(header)) throw invalidInput('GIF header is invalid')

    const width = uint16LittleEndian(header, 6)
    const height = uint16LittleEndian(header, 8)
    const packed = header[10]
    if (packed === undefined) throw invalidInput('GIF logical screen descriptor is truncated')

    const reader = new SourceReader(source, 13)
    if ((packed & 0x80) !== 0) reader.skip(colorTableBytes(packed))

    let frames = 0
    let hasAlpha = false
    for (let blocks = 0; reader.position < source.size && blocks < 1_000_000; blocks += 1) {
      const marker = await reader.readByte()
      if (marker === 0x3b) break

      if (marker === 0x21) {
        const label = await reader.readByte()
        if (label === 0xf9) {
          const length = await reader.readByte()
          if (length !== 4) throw invalidInput('GIF graphics control extension is invalid')
          const control = await reader.read(4)
          hasAlpha ||= ((control[0] ?? 0) & 0x01) !== 0
          if ((await reader.readByte()) !== 0)
            throw invalidInput('GIF extension terminator is missing')
        } else {
          await skipSubBlocks(reader)
        }
        continue
      }

      if (marker === 0x2c) {
        const descriptor = await reader.read(9)
        const imagePacked = descriptor[8]
        if (imagePacked === undefined) throw invalidInput('GIF image descriptor is truncated')
        if ((imagePacked & 0x80) !== 0) reader.skip(colorTableBytes(imagePacked))
        await reader.readByte()
        await skipSubBlocks(reader)
        frames += 1
        if (frames > limits.maxFrames) validateImageDimensions(width, height, frames, limits)
        continue
      }

      throw invalidInput(`GIF contains an unknown block marker: 0x${marker.toString(16)}`)
    }

    if (frames < 1) throw invalidInput('GIF contains no image frames')
    validateImageDimensions(width, height, frames, limits)
    return {
      width,
      height,
      format: 'gif',
      mimeType: 'image/gif',
      hasAlpha,
      colorSpace: 'indexed',
      bitDepth: (packed & 0x07) + 1,
      frames,
    }
  },
  createDecoder: decodeGif,
}
