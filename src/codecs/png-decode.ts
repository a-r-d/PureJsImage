import type { DecodeRequest, DecoderOptions, ImageDecoder } from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import { ImageError, invalidInput, limitExceeded, truncatedInput } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { type PixelBlock, type PixelFormat, resumePixelBlocks } from '../pixel.ts'
import { type ImageSource, readExactly } from '../source.ts'
import { updateCrc32 } from './crc32.ts'
import {
  ColorManagedDecoder,
  ColorManagedDecoder16,
  createPngColorTransform,
  createPngGrayTransform16,
  type DeepColorTransform,
  GrayColorManagedDecoder,
  parseGrayIccAsRgbTransform,
  parseGrayIccTransform16,
  parseRgbIccTransform16,
} from './icc.ts'
import { scanlineBlockRows, bytesPerPixel, paeth } from './png-common.ts'
import {
  sourceReadSize,
  type ChunkRange,
  type PngDescription,
  parsePng,
  isGrayProfile,
} from './png-metadata.ts'
import type { PngColorType, PngRegion, PngAcceleration } from './png.ts'

const idatType = Uint8Array.of(73, 68, 65, 84)
interface Adam7Pass {
  readonly startX: number
  readonly startY: number
  readonly stepX: number
  readonly stepY: number
}

interface Adam7RuntimePass extends Adam7Pass {
  readonly width: number
  readonly height: number
  readonly rowBytes: number
}

const adam7Passes: readonly Adam7Pass[] = Object.freeze([
  { startX: 0, startY: 0, stepX: 8, stepY: 8 },
  { startX: 4, startY: 0, stepX: 8, stepY: 8 },
  { startX: 0, startY: 4, stepX: 4, stepY: 8 },
  { startX: 2, startY: 0, stepX: 4, stepY: 4 },
  { startX: 0, startY: 2, stepX: 2, stepY: 4 },
  { startX: 1, startY: 0, stepX: 2, stepY: 2 },
  { startX: 0, startY: 1, stepX: 1, stepY: 2 },
])

const channelsForColorType = (colorType: PngColorType): number => {
  if (colorType === 0 || colorType === 3) return 1
  if (colorType === 2) return 3
  if (colorType === 4) return 2
  return 4
}

const outputFormat = (description: PngDescription): PixelFormat => {
  if (description.bitDepth === 16) {
    if (description.colorType === 0 && !description.hasAlpha) return 'gray16'
    if (description.colorType === 2 && !description.hasAlpha) return 'rgb16'
    return 'rgba16'
  }
  if (description.colorType === 0 && !description.hasAlpha) return 'gray8'
  if ((description.colorType === 2 || description.colorType === 3) && !description.hasAlpha) {
    return 'rgb8'
  }
  return 'rgba8'
}

const pngRenderingIntents = ['perceptual', 'relative', 'saturation', 'absolute'] as const

const pngRenderingIntent = (value: number): (typeof pngRenderingIntents)[number] => {
  const intent = pngRenderingIntents[value]
  if (intent === undefined) throw invalidInput('PNG sRGB rendering intent is invalid')
  return intent
}

const pngColorSemantics = (description: PngDescription): PixelColorSemantics => {
  const signal = description.colorSignal
  const common = {
    family: outputFormat(description).startsWith('gray') ? ('gray' as const) : ('rgb' as const),
    matrix: 'identity' as const,
    range: 'full' as const,
    alpha: description.hasAlpha ? ('straight' as const) : ('none' as const),
  }
  if (signal.kind === 'icc') {
    return Object.freeze({
      ...common,
      primaries: 'source-profile',
      transfer: Object.freeze({ kind: 'source-profile' as const }),
      provenance: 'icc',
      // This decoder emits unconverted samples; ColorManagedDecoder reports converted ones.
      icc: Object.freeze({ relevance: 'emitted-pixels' as const }),
    })
  }
  if (signal.kind === 'srgb') {
    return Object.freeze({
      ...common,
      primaries: 'srgb',
      transfer: Object.freeze({ kind: 'srgb' as const }),
      provenance: 'container-signaled',
      renderingIntent: pngRenderingIntent(signal.intent),
    })
  }
  if (signal.kind === 'gamma') {
    return Object.freeze({
      ...common,
      primaries: 'unspecified',
      transfer: Object.freeze({ kind: 'gamma' as const, exponent: 100_000 / signal.encoded }),
      provenance: 'container-signaled',
    })
  }
  if (signal.kind === 'chromaticities') {
    return Object.freeze({
      ...common,
      primaries: 'source-profile',
      transfer: Object.freeze({ kind: 'source-profile' as const }),
      provenance: 'container-signaled',
    })
  }
  if (signal.kind === 'unspecified') {
    return Object.freeze({
      ...common,
      primaries: 'unspecified',
      transfer: Object.freeze({ kind: 'unspecified' as const }),
      provenance: 'unspecified',
    })
  }
  const standardizedSrgbCicp =
    signal.value[1] === 13 &&
    signal.value[2] === 0 &&
    signal.value[3] === 1 &&
    (signal.value[0] === 1 || signal.value[0] === 12)
  const standardizedLinearSrgbCicp =
    signal.value[0] === 1 && signal.value[1] === 8 && signal.value[2] === 0 && signal.value[3] === 1
  return Object.freeze({
    ...common,
    primaries:
      standardizedSrgbCicp || standardizedLinearSrgbCicp
        ? signal.value[0] === 1
          ? 'srgb'
          : 'display-p3'
        : 'source-profile',
    transfer: standardizedSrgbCicp
      ? Object.freeze({ kind: 'srgb' as const })
      : standardizedLinearSrgbCicp
        ? Object.freeze({ kind: 'linear' as const })
        : Object.freeze({ kind: 'source-profile' as const }),
    provenance: 'container-signaled',
  })
}

const readCompressedChunks = async function* (
  source: ImageSource,
  chunks: readonly ChunkRange[],
): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) {
    let crc = updateCrc32(0xffffffff, idatType)
    let position = 0
    while (position < chunk.length) {
      const data = await readExactly(
        source,
        chunk.offset + position,
        Math.min(sourceReadSize, chunk.length - position),
      )
      crc = updateCrc32(crc, data)
      position += data.byteLength
      yield data
    }
    if ((crc ^ 0xffffffff) >>> 0 !== chunk.expectedCrc) {
      throw invalidInput('PNG IDAT checksum does not match its data')
    }
  }
}

// DecompressionStream may retain a chunk after writer.write() resolves. Take
// bounded ownership before the next ImageSource read is allowed to invalidate it.
const ownedArrayBufferView = (data: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(data)

const decompressedChunks = async function* (
  source: ImageSource,
  chunks: readonly ChunkRange[],
  maximumDecodedBytes: number,
): AsyncGenerator<Uint8Array> {
  const decompressor = new DecompressionStream('deflate')
  const writer = decompressor.writable.getWriter()
  const reader = decompressor.readable.getReader()
  let feedError: unknown
  const feeding = (async () => {
    try {
      for await (const chunk of readCompressedChunks(source, chunks)) {
        await writer.write(ownedArrayBufferView(chunk))
      }
      await writer.close()
    } catch (error) {
      feedError = error
      try {
        await writer.abort(error)
      } catch {
        // The stored feed error is reported after the readable side settles.
      }
    }
  })()
  let readError: unknown
  let completed = false
  let decodedBytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        completed = true
        break
      }
      if (next.value.byteLength > maximumDecodedBytes - decodedBytes) {
        readError = limitExceeded(
          `PNG decompressed data exceeds maxDecodedBytes ${maximumDecodedBytes}`,
        )
        try {
          await reader.cancel(readError)
        } catch {
          // The explicit limit error below is authoritative.
        }
        break
      }
      decodedBytes += next.value.byteLength
      yield next.value
    }
  } catch (error) {
    readError = error
  } finally {
    if (!completed && readError === undefined) {
      try {
        await reader.cancel()
      } catch {
        // The downstream consumer's error remains authoritative.
      }
    }
    reader.releaseLock()
    await feeding
  }
  if (readError instanceof ImageError) throw readError
  if (feedError instanceof ImageError) throw feedError
  if (feedError !== undefined || readError !== undefined) {
    throw invalidInput('PNG image data could not be decompressed')
  }
}

const unfilter = (
  scanline: Uint8Array,
  previous: Uint8Array,
  filterBytesPerPixel: number,
): void => {
  const filterType = scanline[0]
  if (filterType === undefined || filterType > 4)
    throw invalidInput(`PNG filter ${filterType ?? -1} is invalid`)
  if (filterType === 0) return
  if (filterType === 1) {
    for (let index = filterBytesPerPixel; index < previous.byteLength; index += 1) {
      scanline[index + 1] =
        ((scanline[index + 1] ?? 0) + (scanline[index + 1 - filterBytesPerPixel] ?? 0)) & 0xff
    }
    return
  }
  if (filterType === 2) {
    for (let index = 0; index < previous.byteLength; index += 1) {
      scanline[index + 1] = ((scanline[index + 1] ?? 0) + (previous[index] ?? 0)) & 0xff
    }
    return
  }
  for (let index = 0; index < filterBytesPerPixel; index += 1) {
    const encoded = scanline[index + 1] ?? 0
    const up = previous[index] ?? 0
    scanline[index + 1] = filterType === 3 ? (encoded + (up >>> 1)) & 0xff : (encoded + up) & 0xff
  }
  if (filterType === 3) {
    for (let index = filterBytesPerPixel; index < previous.byteLength; index += 1) {
      const left = scanline[index + 1 - filterBytesPerPixel] ?? 0
      const up = previous[index] ?? 0
      scanline[index + 1] = ((scanline[index + 1] ?? 0) + ((left + up) >>> 1)) & 0xff
    }
    return
  }
  for (let index = filterBytesPerPixel; index < previous.byteLength; index += 1) {
    const left = scanline[index + 1 - filterBytesPerPixel] ?? 0
    const up = previous[index] ?? 0
    const upperLeft = previous[index - filterBytesPerPixel] ?? 0
    scanline[index + 1] = ((scanline[index + 1] ?? 0) + paeth(left, up, upperLeft)) & 0xff
  }
}

const sample = (row: Uint8Array, sampleIndex: number, bitDepth: number): number => {
  if (bitDepth === 16) {
    const offset = sampleIndex * 2
    const high = row[offset]
    const low = row[offset + 1]
    if (high === undefined || low === undefined)
      throw truncatedInput('PNG scanline sample is truncated')
    return high * 256 + low
  }
  if (bitDepth === 8) {
    const value = row[sampleIndex]
    if (value === undefined) throw truncatedInput('PNG scanline sample is truncated')
    return value
  }
  const bitOffset = sampleIndex * bitDepth
  const packed = row[Math.floor(bitOffset / 8)]
  if (packed === undefined) throw truncatedInput('PNG packed scanline sample is truncated')
  return (packed >>> (8 - bitDepth - (bitOffset % 8))) & ((1 << bitDepth) - 1)
}

const sampleToByte = (value: number, bitDepth: number): number => {
  if (bitDepth === 16) return value >>> 8
  if (bitDepth === 8) return value
  return Math.round((value * 255) / ((1 << bitDepth) - 1))
}

const writeSample = (
  row: Uint8Array,
  sampleIndex: number,
  bitDepth: number,
  value: number,
): void => {
  if (bitDepth === 16) {
    const offset = sampleIndex * 2
    row[offset] = value >>> 8
    row[offset + 1] = value & 0xff
    return
  }
  if (bitDepth === 8) {
    row[sampleIndex] = value
    return
  }
  const bitOffset = sampleIndex * bitDepth
  const byteOffset = Math.floor(bitOffset / 8)
  const shift = 8 - bitDepth - (bitOffset % 8)
  const mask = ((1 << bitDepth) - 1) << shift
  row[byteOffset] = ((row[byteOffset] ?? 0) & ~mask) | (value << shift)
}

const passLength = (size: number, start: number, step: number): number =>
  start >= size ? 0 : Math.floor((size - start + step - 1) / step)

const adam7RuntimePasses = (
  width: number,
  height: number,
  bitsPerPixel: number,
): readonly Adam7RuntimePass[] => {
  const passes: Adam7RuntimePass[] = []
  for (const pass of adam7Passes) {
    const passWidth = passLength(width, pass.startX, pass.stepX)
    const passHeight = passLength(height, pass.startY, pass.stepY)
    if (passWidth === 0 || passHeight === 0) continue
    passes.push({
      ...pass,
      width: passWidth,
      height: passHeight,
      rowBytes: Math.ceil((passWidth * bitsPerPixel) / 8),
    })
  }
  return passes
}

const scatterAdam7Row = (
  passRow: Uint8Array,
  pass: Adam7RuntimePass,
  description: PngDescription,
  cropX: number,
  cropWidth: number,
  output: Uint8Array,
): void => {
  const channels = channelsForColorType(description.colorType)
  const cropEnd = cropX + cropWidth
  for (let passX = 0; passX < pass.width; passX += 1) {
    const sourceX = pass.startX + passX * pass.stepX
    if (sourceX < cropX || sourceX >= cropEnd) continue
    const outputX = sourceX - cropX
    for (let channel = 0; channel < channels; channel += 1) {
      writeSample(
        output,
        outputX * channels + channel,
        description.bitDepth,
        sample(passRow, passX * channels + channel, description.bitDepth),
      )
    }
  }
}

const uint16 = (data: Uint8Array, offset: number): number => {
  const high = data[offset]
  const low = data[offset + 1]
  if (high === undefined || low === undefined)
    throw invalidInput('PNG transparency data is truncated')
  return high * 256 + low
}

const convertRow = (
  row: Uint8Array,
  description: PngDescription,
  cropX: number,
  width: number,
  output: Uint8Array,
  outputOffset: number,
): void => {
  const { bitDepth, colorType, palette, transparency } = description
  if (bitDepth === 16) {
    if (colorType === 0 && transparency === undefined) {
      output.set(row.subarray(cropX * 2, (cropX + width) * 2), outputOffset)
      return
    }
    if (colorType === 2 && transparency === undefined) {
      output.set(row.subarray(cropX * 6, (cropX + width) * 6), outputOffset)
      return
    }
    if (colorType === 6) {
      output.set(row.subarray(cropX * 8, (cropX + width) * 8), outputOffset)
      return
    }
    let nativeTarget = outputOffset
    for (let x = cropX; x < cropX + width; x += 1) {
      if (colorType === 0) {
        const source = x * 2
        const gray = uint16(row, source)
        output[nativeTarget++] = row[source] ?? 0
        output[nativeTarget++] = row[source + 1] ?? 0
        output[nativeTarget++] = row[source] ?? 0
        output[nativeTarget++] = row[source + 1] ?? 0
        output[nativeTarget++] = row[source] ?? 0
        output[nativeTarget++] = row[source + 1] ?? 0
        const transparent = gray === uint16(transparency ?? new Uint8Array(), 0)
        output[nativeTarget++] = transparent ? 0 : 0xff
        output[nativeTarget++] = transparent ? 0 : 0xff
        continue
      }
      if (colorType === 2) {
        const source = x * 6
        output.set(row.subarray(source, source + 6), nativeTarget)
        nativeTarget += 6
        const transparent =
          uint16(row, source) === uint16(transparency ?? new Uint8Array(), 0) &&
          uint16(row, source + 2) === uint16(transparency ?? new Uint8Array(), 2) &&
          uint16(row, source + 4) === uint16(transparency ?? new Uint8Array(), 4)
        output[nativeTarget++] = transparent ? 0 : 0xff
        output[nativeTarget++] = transparent ? 0 : 0xff
        continue
      }
      if (colorType === 4) {
        const source = x * 4
        output[nativeTarget++] = row[source] ?? 0
        output[nativeTarget++] = row[source + 1] ?? 0
        output[nativeTarget++] = row[source] ?? 0
        output[nativeTarget++] = row[source + 1] ?? 0
        output[nativeTarget++] = row[source] ?? 0
        output[nativeTarget++] = row[source + 1] ?? 0
        output[nativeTarget++] = row[source + 2] ?? 0
        output[nativeTarget++] = row[source + 3] ?? 0
      }
    }
    return
  }
  if (bitDepth === 8 && colorType === 6 && transparency === undefined) {
    output.set(row.subarray(cropX * 4, (cropX + width) * 4), outputOffset)
    return
  }
  let target = outputOffset

  for (let x = cropX; x < cropX + width; x += 1) {
    if (colorType === 0) {
      const gray = sample(row, x, bitDepth)
      const byte = sampleToByte(gray, bitDepth)
      if (transparency === undefined) output[target++] = byte
      else {
        output[target++] = byte
        output[target++] = byte
        output[target++] = byte
        output[target++] = gray === uint16(transparency, 0) ? 0 : 255
      }
      continue
    }

    if (colorType === 2) {
      const source = x * 3
      const red = sample(row, source, bitDepth)
      const green = sample(row, source + 1, bitDepth)
      const blue = sample(row, source + 2, bitDepth)
      output[target++] = sampleToByte(red, bitDepth)
      output[target++] = sampleToByte(green, bitDepth)
      output[target++] = sampleToByte(blue, bitDepth)
      if (transparency !== undefined) {
        output[target++] =
          red === uint16(transparency, 0) &&
          green === uint16(transparency, 2) &&
          blue === uint16(transparency, 4)
            ? 0
            : 255
      }
      continue
    }

    if (colorType === 3) {
      const paletteIndex = sample(row, x, bitDepth)
      const paletteOffset = paletteIndex * 3
      const red = palette?.[paletteOffset]
      const green = palette?.[paletteOffset + 1]
      const blue = palette?.[paletteOffset + 2]
      if (red === undefined || green === undefined || blue === undefined)
        throw invalidInput(`PNG palette index ${paletteIndex} is out of range`)
      output[target++] = red
      output[target++] = green
      output[target++] = blue
      if (transparency !== undefined) output[target++] = transparency[paletteIndex] ?? 255
      continue
    }

    if (colorType === 4) {
      const source = x * 2
      const gray = sampleToByte(sample(row, source, bitDepth), bitDepth)
      output[target++] = gray
      output[target++] = gray
      output[target++] = gray
      output[target++] = sampleToByte(sample(row, source + 1, bitDepth), bitDepth)
      continue
    }

    const source = x * 4
    output[target++] = sampleToByte(sample(row, source, bitDepth), bitDepth)
    output[target++] = sampleToByte(sample(row, source + 1, bitDepth), bitDepth)
    output[target++] = sampleToByte(sample(row, source + 2, bitDepth), bitDepth)
    output[target++] = sampleToByte(sample(row, source + 3, bitDepth), bitDepth)
  }
}

const cropRegion = (width: number, height: number, request: DecodeRequest = {}): PngRegion => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const cropWidth = request.width ?? width - x
  const cropHeight = request.height ?? height - y
  for (const [name, value] of Object.entries({ x, y, width: cropWidth, height: cropHeight })) {
    const minimum = name === 'x' || name === 'y' ? 0 : 1
    if (!Number.isSafeInteger(value) || value < minimum)
      throw invalidInput(`Decode ${name} is invalid`)
  }
  if (x + cropWidth > width || y + cropHeight > height) {
    throw invalidInput(
      `Decode region ${x},${y} ${cropWidth}x${cropHeight} exceeds ${width}x${height}`,
    )
  }
  return { x, y, width: cropWidth, height: cropHeight }
}

class PngDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly colorSemantics: PixelColorSemantics
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #source: ImageSource
  readonly #description: PngDescription
  readonly #limits: ImageLimits
  readonly #accelerations: readonly PngAcceleration[]

  constructor(
    source: ImageSource,
    description: PngDescription,
    limits: ImageLimits,
    accelerations: readonly PngAcceleration[],
  ) {
    this.#source = source
    this.#description = description
    this.#limits = limits
    this.#accelerations = accelerations
    this.width = description.width
    this.height = description.height
    this.pixelFormat = outputFormat(description)
    this.colorSemantics = pngColorSemantics(description)
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = cropRegion(this.width, this.height, request)
    const sourceChannels = channelsForColorType(this.#description.colorType)
    const bitsPerPixel = sourceChannels * this.#description.bitDepth
    if (this.#description.interlace === 0) {
      const rowBytes = Math.ceil((this.width * bitsPerPixel) / 8)
      const inflatedBytes = BigInt(rowBytes + 1) * BigInt(this.height)
      if (inflatedBytes > BigInt(this.#limits.maxDecodedBytes)) {
        throw limitExceeded(
          `PNG scanlines require ${inflatedBytes} bytes; maxDecodedBytes is ${this.#limits.maxDecodedBytes}`,
        )
      }
    }
    for (const acceleration of this.#accelerations) {
      if (!acceleration.decode) continue
      let accelerated: AsyncIterable<PixelBlock> | undefined
      try {
        accelerated = await acceleration.decode({
          width: this.width,
          height: this.height,
          bitDepth: this.#description.bitDepth,
          colorType: this.#description.colorType,
          interlace: this.#description.interlace,
          frames: this.#description.frames,
          transparency: this.#description.transparency !== undefined,
          pixelFormat: this.pixelFormat,
          region,
          inflated: decompressedChunks(
            this.#source,
            this.#description.idat,
            this.#limits.maxDecodedBytes,
          ),
        })
      } catch {
        continue
      }
      if (!accelerated) continue

      const iterator = accelerated[Symbol.asyncIterator]()
      let firstOutputRow = 0
      while (true) {
        let result: IteratorResult<PixelBlock>
        try {
          result = await iterator.next()
        } catch {
          try {
            await iterator.return?.()
          } catch {}
          yield* resumePixelBlocks(this.#decodeTypeScript(region, bitsPerPixel), firstOutputRow)
          return
        }
        if (result.done) return
        const block = result.value
        firstOutputRow = Math.max(firstOutputRow, block.y + block.height)
        yield block
      }
    }
    yield* this.#decodeTypeScript(region, bitsPerPixel)
  }

  async *#decodeTypeScript(region: PngRegion, bitsPerPixel: number): AsyncGenerator<PixelBlock> {
    if (this.#description.interlace === 1) {
      yield* this.#decodeAdam7(region)
      return
    }
    const rowBytes = Math.ceil((this.width * bitsPerPixel) / 8)
    const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8))
    const scanline = new Uint8Array(rowBytes + 1)
    const previous = new Uint8Array(rowBytes)
    const outputChannels = bytesPerPixel(this.pixelFormat)
    const outputStride = region.width * outputChannels
    const rowsPerBlock = Math.min(scanlineBlockRows, region.height)
    let block = new Uint8Array(outputStride * rowsPerBlock)
    let blockHeight = 0
    let outputY = 0
    let filled = 0
    let row = 0

    for await (const chunk of decompressedChunks(
      this.#source,
      this.#description.idat,
      this.#limits.maxDecodedBytes,
    )) {
      let chunkOffset = 0
      while (chunkOffset < chunk.byteLength) {
        if (row >= this.height) throw invalidInput('PNG image data contains extra scanlines')
        const length = Math.min(scanline.byteLength - filled, chunk.byteLength - chunkOffset)
        scanline.set(chunk.subarray(chunkOffset, chunkOffset + length), filled)
        filled += length
        chunkOffset += length
        if (filled !== scanline.byteLength) continue

        unfilter(scanline, previous, filterBytesPerPixel)
        if (row >= region.y && row < region.y + region.height) {
          convertRow(
            scanline.subarray(1),
            this.#description,
            region.x,
            region.width,
            block,
            blockHeight * outputStride,
          )
          blockHeight += 1
          if (blockHeight === rowsPerBlock) {
            yield {
              x: 0,
              y: outputY,
              width: region.width,
              height: blockHeight,
              stride: outputStride,
              format: this.pixelFormat,
              data: block,
            }
            outputY += blockHeight
            blockHeight = 0
            const remainingRows = region.height - outputY
            if (remainingRows > 0)
              block = new Uint8Array(outputStride * Math.min(rowsPerBlock, remainingRows))
          }
        }
        previous.set(scanline.subarray(1))
        filled = 0
        row += 1
      }
    }

    if (filled !== 0 || row !== this.height)
      throw truncatedInput(`PNG ended after ${row} of ${this.height} scanlines`)
    if (blockHeight > 0) {
      yield {
        x: 0,
        y: outputY,
        width: region.width,
        height: blockHeight,
        stride: outputStride,
        format: this.pixelFormat,
        data: block.subarray(0, outputStride * blockHeight),
      }
    }
  }

  async *#decodeAdam7(region: PngRegion): AsyncGenerator<PixelBlock> {
    const sourceChannels = channelsForColorType(this.#description.colorType)
    const bitsPerPixel = sourceChannels * this.#description.bitDepth
    const passes = adam7RuntimePasses(this.width, this.height, bitsPerPixel)
    let inflatedBytes = 0n
    for (const pass of passes) {
      inflatedBytes += BigInt(pass.rowBytes + 1) * BigInt(pass.height)
    }
    if (inflatedBytes > BigInt(this.#limits.maxDecodedBytes)) {
      throw limitExceeded(
        `PNG Adam7 scanlines require ${inflatedBytes} bytes; maxDecodedBytes is ${this.#limits.maxDecodedBytes}`,
      )
    }

    const evenRowBytes = Math.ceil((region.width * bitsPerPixel) / 8)
    const regionEndY = region.y + region.height
    const firstEvenY = region.y % 2 === 0 ? region.y : region.y + 1
    const evenRowCount =
      firstEvenY < regionEndY ? Math.floor((regionEndY - 1 - firstEvenY) / 2) + 1 : 0
    const retainedBytes = BigInt(evenRowBytes) * BigInt(evenRowCount)
    if (retainedBytes > BigInt(this.#limits.maxDecodedBytes)) {
      throw limitExceeded(
        `PNG Adam7 retained rows require ${retainedBytes} bytes; maxDecodedBytes is ${this.#limits.maxDecodedBytes}`,
      )
    }
    const evenRows = new Uint8Array(Number(retainedBytes))

    const outputChannels = bytesPerPixel(this.pixelFormat)
    const outputStride = region.width * outputChannels
    const rowsPerBlock = Math.min(scanlineBlockRows, region.height)
    let block = new Uint8Array(outputStride * rowsPerBlock)
    let blockHeight = 0
    let outputY = 0
    let nextOutputSourceY = region.y

    const appendRow = (row: Uint8Array, cropX: number): PixelBlock | undefined => {
      convertRow(row, this.#description, cropX, region.width, block, blockHeight * outputStride)
      blockHeight += 1
      if (blockHeight !== rowsPerBlock) return undefined
      const completed: PixelBlock = {
        x: 0,
        y: outputY,
        width: region.width,
        height: blockHeight,
        stride: outputStride,
        format: this.pixelFormat,
        data: block,
      }
      outputY += blockHeight
      blockHeight = 0
      const remainingRows = region.height - outputY
      if (remainingRows > 0) {
        block = new Uint8Array(outputStride * Math.min(rowsPerBlock, remainingRows))
      }
      return completed
    }

    const appendEvenRow = (sourceY: number): PixelBlock | undefined => {
      const rowIndex = (sourceY - firstEvenY) / 2
      const offset = rowIndex * evenRowBytes
      return appendRow(evenRows.subarray(offset, offset + evenRowBytes), 0)
    }

    let passIndex = 0
    let pass = passes[passIndex]
    let passRow = 0
    let filled = 0
    let scanline = new Uint8Array((pass?.rowBytes ?? 0) + 1)
    let previous = new Uint8Array(pass?.rowBytes ?? 0)

    for await (const chunk of decompressedChunks(
      this.#source,
      this.#description.idat,
      this.#limits.maxDecodedBytes,
    )) {
      let chunkOffset = 0
      while (chunkOffset < chunk.byteLength) {
        if (pass === undefined) throw invalidInput('PNG Adam7 image data contains extra scanlines')
        const length = Math.min(scanline.byteLength - filled, chunk.byteLength - chunkOffset)
        scanline.set(chunk.subarray(chunkOffset, chunkOffset + length), filled)
        filled += length
        chunkOffset += length
        if (filled !== scanline.byteLength) continue

        unfilter(scanline, previous, Math.max(1, Math.ceil(bitsPerPixel / 8)))
        const sourceY = pass.startY + passRow * pass.stepY
        const isFinalPass =
          pass.startX === 0 && pass.startY === 1 && pass.stepX === 1 && pass.stepY === 2
        if (!isFinalPass) {
          if (sourceY >= region.y && sourceY < regionEndY) {
            const rowIndex = (sourceY - firstEvenY) / 2
            const offset = rowIndex * evenRowBytes
            scatterAdam7Row(
              scanline.subarray(1),
              pass,
              this.#description,
              region.x,
              region.width,
              evenRows.subarray(offset, offset + evenRowBytes),
            )
          }
        } else if (sourceY >= region.y && sourceY < regionEndY) {
          while (nextOutputSourceY < sourceY) {
            if (nextOutputSourceY % 2 !== 0) throw invalidInput('PNG Adam7 rows are not sequential')
            const completed = appendEvenRow(nextOutputSourceY)
            nextOutputSourceY += 1
            if (completed) yield completed
          }
          if (nextOutputSourceY === sourceY) {
            const completed = appendRow(scanline.subarray(1), region.x)
            nextOutputSourceY += 1
            if (completed) yield completed
          }
        }

        previous.set(scanline.subarray(1))
        passRow += 1
        filled = 0
        if (passRow === pass.height) {
          passIndex += 1
          pass = passes[passIndex]
          passRow = 0
          scanline = new Uint8Array((pass?.rowBytes ?? 0) + 1)
          previous = new Uint8Array(pass?.rowBytes ?? 0)
        }
      }
    }

    if (filled !== 0 || pass !== undefined)
      throw truncatedInput('PNG Adam7 image data is truncated')
    while (nextOutputSourceY < regionEndY) {
      if (nextOutputSourceY % 2 !== 0) throw truncatedInput('PNG Adam7 image data is missing a row')
      const completed = appendEvenRow(nextOutputSourceY)
      nextOutputSourceY += 1
      if (completed) yield completed
    }
    if (blockHeight > 0) {
      yield {
        x: 0,
        y: outputY,
        width: region.width,
        height: blockHeight,
        stride: outputStride,
        format: this.pixelFormat,
        data: block.subarray(0, outputStride * blockHeight),
      }
    }
  }
}

/**
 * 16-bit ICC profiles and cHRM plus gAMA convert to sRGB like 8-bit samples. 16-bit gAMA-only,
 * sRGB and cICP samples keep their native values and color signal.
 */
const deepPngColorTransform = (description: PngDescription): DeepColorTransform | undefined => {
  const gray = description.colorType === 0 && !description.hasAlpha
  const signal = description.colorSignal.kind
  if (signal === 'icc' && description.iccProfile)
    return gray
      ? { kind: 'gray', table: parseGrayIccTransform16(description.iccProfile) }
      : {
          kind: 'rgb',
          transform:
            (description.colorType === 0 || description.colorType === 4) &&
            isGrayProfile(description.iccProfile)
              ? parseGrayIccAsRgbTransform(description.iccProfile, 65_536)
              : parseRgbIccTransform16(description.iccProfile),
        }
  if (signal !== 'chromaticities' || description.gamma === undefined) return undefined
  return gray
    ? { kind: 'gray', table: createPngGrayTransform16(description.gamma) }
    : {
        kind: 'rgb',
        transform: createPngColorTransform(description.gamma, description.chromaticities, 65_536),
      }
}

export const createPngDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  accelerations: readonly PngAcceleration[] = [],
): Promise<ImageDecoder> => {
  const description = await parsePng(source, limits, true)
  const decoder = new PngDecoder(source, description, limits, accelerations)
  if (options.preserveIcc === true && description.iccProfile) return decoder
  if (description.bitDepth === 16) {
    const deep = deepPngColorTransform(description)
    return deep ? new ColorManagedDecoder16(decoder, deep) : decoder
  }
  if (description.colorTransform)
    return new ColorManagedDecoder(decoder, description.colorTransform)
  return description.grayTransform
    ? new GrayColorManagedDecoder(decoder, description.grayTransform)
    : decoder
}
