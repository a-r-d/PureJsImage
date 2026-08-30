import type {
  DecodeRequest,
  DecoderOptions,
  EncodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageEncoder,
  ImageMetadata,
  PreservedMetadata,
} from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import {
  ImageError,
  invalidInput,
  limitExceeded,
  truncatedInput,
  unsupportedOperation,
} from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import { iccColorSpace } from '../metadata.ts'
import { type PixelBlock, type PixelFormat, resumePixelBlocks } from '../pixel.ts'
import type { DeflateEncoder } from '../runtime.ts'
import type { ImageSink } from '../sink.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import { crc32, updateCrc32 } from './crc32.ts'
import { ascii, uint32BigEndian } from './helpers.ts'
import {
  ColorManagedDecoder,
  createDisplayP3Transform,
  createPngColorTransform,
  createPngGrayTransform,
  GrayColorManagedDecoder,
  MAX_ICC_PROFILE_BYTES,
  parseRgbIccTransform,
  type RgbChromaticities,
  type RgbIccTransform,
} from './icc.ts'

const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const idatType = Uint8Array.of(73, 68, 65, 84)
const scanlineBlockRows = 32
const sourceReadSize = 65_536

export type PngColorType = 0 | 2 | 3 | 4 | 6

interface ChunkRange {
  readonly offset: number
  readonly length: number
  readonly expectedCrc: number
}

interface PngDescription {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colorType: PngColorType
  readonly interlace: 0 | 1
  readonly hasAlpha: boolean
  readonly frames: number
  readonly palette: Uint8Array | undefined
  readonly transparency: Uint8Array | undefined
  readonly idat: readonly ChunkRange[]
  readonly colorTransform: RgbIccTransform | undefined
  readonly grayTransform: Uint8Array | undefined
  readonly iccProfile: Uint8Array | undefined
  readonly exif: Uint8Array | undefined
}

export interface PngRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PngAccelerationRequest {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colorType: PngColorType
  readonly interlace: 0 | 1
  readonly frames: number
  readonly transparency: boolean
  readonly pixelFormat: PixelFormat
  readonly region: PngRegion
  readonly inflated: AsyncIterable<Uint8Array>
}

export interface PngRowFilter {
  filter(data: Uint8Array, stride: number, rows: number): Uint8Array
  release(): void
}

export interface PngEncodeAccelerationRequest {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly adaptiveFiltering: boolean
}

export interface PngAcceleration {
  decode?(request: PngAccelerationRequest): Promise<AsyncIterable<PixelBlock> | undefined>
  encode?(request: PngEncodeAccelerationRequest): Promise<PngRowFilter | undefined>
}

export interface PngDecodeAcceleration extends PngAcceleration {
  decode(request: PngAccelerationRequest): Promise<AsyncIterable<PixelBlock> | undefined>
}

export interface PngEncodeAcceleration extends PngAcceleration {
  encode(request: PngEncodeAccelerationRequest): Promise<PngRowFilter | undefined>
}

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

const isPng = (header: Uint8Array): boolean =>
  signature.every((byte, index) => header[index] === byte)

const isColorType = (value: number): value is PngColorType =>
  value === 0 || value === 2 || value === 3 || value === 4 || value === 6

const validBitDepth = (colorType: PngColorType, bitDepth: number): boolean => {
  if (colorType === 0)
    return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16
  if (colorType === 3) return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8
  return bitDepth === 8 || bitDepth === 16
}

const colorSpace = (colorType: PngColorType): string => {
  if (colorType === 0 || colorType === 4) return 'gray'
  if (colorType === 3) return 'indexed'
  return 'srgb'
}

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

const bytesPerPixel = (format: PixelFormat): number => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  if (format === 'gray16') return 2
  if (format === 'rgb16') return 6
  if (format === 'rgba16') return 8
  throw invalidInput(`PNG does not support ${format} encoder input`)
}

const pngColorSemantics = (description: PngDescription): PixelColorSemantics =>
  Object.freeze({
    family: outputFormat(description).startsWith('gray') ? 'gray' : 'rgb',
    primaries:
      description.colorTransform !== undefined || description.iccProfile !== undefined
        ? 'source-profile'
        : 'unspecified',
    transfer: Object.freeze({
      kind:
        description.colorTransform !== undefined || description.grayTransform !== undefined
          ? 'source-profile'
          : 'unspecified',
    }),
    matrix: 'identity',
    range: 'full',
    alpha: description.hasAlpha ? 'straight' : 'none',
    provenance:
      description.iccProfile !== undefined
        ? 'icc'
        : description.colorTransform !== undefined || description.grayTransform !== undefined
          ? 'container-signaled'
          : 'unspecified',
    ...(description.iccProfile === undefined
      ? {}
      : { icc: Object.freeze({ relevance: 'source' as const }) }),
  })

const checkedChunkEnd = (offset: number, length: number, size: number, type: string): number => {
  const end = offset + length + 12
  if (!Number.isSafeInteger(end) || end > size)
    throw truncatedInput(`PNG ${type} chunk is truncated`)
  return end
}

const validChunkType = (type: Uint8Array): boolean => {
  if (type.byteLength !== 4) return false
  for (const byte of type) {
    if (!((byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122))) return false
  }
  return ((type[2] ?? 0) & 0x20) === 0
}

const validateChunkCrc = async (
  source: ImageSource,
  type: string,
  typeBytes: Uint8Array,
  dataOffset: number,
  length: number,
): Promise<void> => {
  let crc = updateCrc32(0xffffffff, typeBytes)
  let position = 0
  while (position < length) {
    const data = await readExactly(
      source,
      dataOffset + position,
      Math.min(sourceReadSize, length - position),
    )
    crc = updateCrc32(crc, data)
    position += data.byteLength
  }
  const expected = uint32BigEndian(await readExactly(source, dataOffset + length, 4), 0)
  if ((crc ^ 0xffffffff) >>> 0 !== expected) {
    throw invalidInput(`PNG ${type} checksum does not match its data`)
  }
}

const inflateIccProfile = async (compressed: Uint8Array): Promise<Uint8Array> => {
  if (compressed.byteLength === 0) throw invalidInput('PNG iCCP profile data is empty')
  if (compressed.byteLength > MAX_ICC_PROFILE_BYTES) {
    throw limitExceeded('PNG compressed ICC profile exceeds 16 MiB')
  }
  const chunks: Uint8Array[] = []
  let bytes = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const stream = new Blob([compressed.slice()])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    reader = stream.getReader()
    while (true) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > MAX_ICC_PROFILE_BYTES) {
        await reader.cancel()
        throw limitExceeded('PNG decompressed ICC profile exceeds 16 MiB')
      }
      chunks.push(result.value)
    }
  } catch (error) {
    if (error instanceof ImageError) throw error
    throw invalidInput('PNG iCCP profile could not be decompressed')
  } finally {
    reader?.releaseLock()
  }
  const profile = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    profile.set(chunk, offset)
    offset += chunk.byteLength
  }
  return profile
}

const parseIccChunk = (data: Uint8Array): Uint8Array => {
  let separator = -1
  for (let index = 0; index < Math.min(data.byteLength, 80); index += 1) {
    if (data[index] === 0) {
      separator = index
      break
    }
  }
  if (separator < 1 || separator > 79 || separator + 2 > data.byteLength) {
    throw invalidInput('PNG iCCP profile name or compression header is invalid')
  }
  let previousSpace = false
  for (let index = 0; index < separator; index += 1) {
    const value = data[index] ?? 0
    const space = value === 0x20
    if (
      !((value >= 0x20 && value <= 0x7e) || value >= 0xa1) ||
      (space && (index === 0 || index === separator - 1 || previousSpace))
    ) {
      throw invalidInput('PNG iCCP profile name is invalid')
    }
    previousSpace = space
  }
  if (data[separator + 1] !== 0) {
    throw unsupportedOperation('PNG iCCP compression method is unsupported')
  }
  return data.slice(separator + 2)
}

const parseChromaticities = (data: Uint8Array): RgbChromaticities => {
  if (data.byteLength !== 32) throw invalidInput('PNG cHRM chunk must contain 32 bytes')
  const value = (offset: number): number => uint32BigEndian(data, offset) / 100_000
  const chromaticities: RgbChromaticities = {
    whiteX: value(0),
    whiteY: value(4),
    redX: value(8),
    redY: value(12),
    greenX: value(16),
    greenY: value(20),
    blueX: value(24),
    blueY: value(28),
  }
  const pairs = [
    [chromaticities.whiteX, chromaticities.whiteY],
    [chromaticities.redX, chromaticities.redY],
    [chromaticities.greenX, chromaticities.greenY],
    [chromaticities.blueX, chromaticities.blueY],
  ] as const
  if (pairs.some(([x, y]) => y <= 0 || x + y > 1)) {
    throw invalidInput('PNG cHRM contains an invalid chromaticity')
  }
  return chromaticities
}

type PngCicp = readonly [primaries: number, transfer: number, matrix: number, fullRange: number]

const parseCicp = (data: Uint8Array): PngCicp => {
  if (data.byteLength !== 4) throw invalidInput('PNG cICP chunk must contain four bytes')
  const primaries = data[0] ?? 0
  const transfer = data[1] ?? 0
  const matrix = data[2] ?? 0
  const fullRange = data[3] ?? 0
  if (matrix !== 0) throw invalidInput('PNG cICP matrix coefficients must be zero')
  if (fullRange !== 0 && fullRange !== 1) {
    throw invalidInput('PNG cICP full-range flag must be zero or one')
  }
  return [primaries, transfer, matrix, fullRange]
}

const cicpColorTransform = (
  cicp: PngCicp,
  colorType: PngColorType,
): RgbIccTransform | undefined => {
  const [primaries, transfer, , fullRange] = cicp
  if (colorType === 0 || colorType === 4) {
    throw unsupportedOperation('PNG cICP color management for grayscale pixels is not implemented')
  }
  if (fullRange !== 1) {
    throw unsupportedOperation('PNG cICP narrow-range color management is not implemented')
  }
  if (transfer === 13 && primaries === 1) return undefined
  if (transfer === 13 && primaries === 12) return createDisplayP3Transform()
  throw unsupportedOperation(
    `PNG cICP primaries ${primaries} and transfer ${transfer} are not implemented`,
  )
}

const parsePng = async (
  source: ImageSource,
  limits: ImageLimits,
  requireImageData: boolean,
): Promise<PngDescription> => {
  const header = await readExactly(source, 0, 33)
  if (!isPng(header) || ascii(header, 12, 4) !== 'IHDR' || uint32BigEndian(header, 8) !== 13) {
    throw invalidInput('PNG is missing a valid IHDR chunk')
  }
  if (crc32(header.subarray(12, 16), header.subarray(16, 29)) !== uint32BigEndian(header, 29)) {
    throw invalidInput('PNG IHDR checksum does not match its data')
  }

  const width = uint32BigEndian(header, 16)
  const height = uint32BigEndian(header, 20)
  const bitDepth = header[24]
  const rawColorType = header[25]
  const compression = header[26]
  const filter = header[27]
  const interlace = header[28]
  if (
    bitDepth === undefined ||
    rawColorType === undefined ||
    !isColorType(rawColorType) ||
    !validBitDepth(rawColorType, bitDepth)
  ) {
    throw invalidInput('PNG has unsupported or invalid color metadata')
  }
  if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) {
    throw invalidInput('PNG uses unsupported compression, filtering, or interlace metadata')
  }

  validateImageDimensions(width, height, 1, limits)

  let frames = 1
  let hasAlpha = rawColorType === 4 || rawColorType === 6
  let palette: Uint8Array | undefined
  let transparency: Uint8Array | undefined
  const idat: ChunkRange[] = []
  let offset = 33
  let chunks = 0
  let foundEnd = false
  let foundPalette = false
  let foundTransparency = false
  let foundAnimation = false
  let foundIcc = false
  let foundGamma = false
  let foundChromaticities = false
  let foundSrgb = false
  let foundCicp = false
  let compressedIcc: Uint8Array | undefined
  let exif: Uint8Array | undefined
  let gamma: number | undefined
  let chromaticities: RgbChromaticities | undefined
  let cicp: PngCicp | undefined
  let imageDataState: 'before' | 'inside' | 'after' = 'before'

  while (offset + 12 <= source.size && chunks < 10_000) {
    const chunkHeader = await readExactly(source, offset, 8)
    const length = uint32BigEndian(chunkHeader, 0)
    const type = ascii(chunkHeader, 4, 4)
    const typeBytes = chunkHeader.subarray(4, 8)
    if (!validChunkType(typeBytes)) throw invalidInput(`PNG chunk type ${type} is invalid`)
    const end = checkedChunkEnd(offset, length, source.size, type)
    const dataOffset = offset + 8
    if (type !== 'IDAT') await validateChunkCrc(source, type, typeBytes, dataOffset, length)
    if (type !== 'IDAT' && imageDataState === 'inside') imageDataState = 'after'

    if (type === 'iCCP') {
      if (foundIcc) throw invalidInput('PNG contains multiple iCCP chunks')
      if (imageDataState !== 'before' || foundPalette)
        throw invalidInput('PNG iCCP must precede the palette and image data')
      compressedIcc = parseIccChunk(await readExactly(source, dataOffset, length))
      foundIcc = true
    } else if (type === 'eXIf') {
      if (exif) throw invalidInput('PNG contains multiple eXIf chunks')
      if (length > 16 * 1024 * 1024) throw limitExceeded('PNG EXIF data exceeds 16 MiB')
      exif = Uint8Array.from(await readExactly(source, dataOffset, length))
    } else if (type === 'gAMA') {
      if (foundGamma) throw invalidInput('PNG contains multiple gAMA chunks')
      if (imageDataState !== 'before' || foundPalette)
        throw invalidInput('PNG gAMA must precede the palette and image data')
      if (length !== 4) throw invalidInput('PNG gAMA chunk must contain four bytes')
      const encodedGamma = uint32BigEndian(await readExactly(source, dataOffset, length), 0)
      if (encodedGamma === 0) throw invalidInput('PNG gAMA value must be positive')
      gamma = encodedGamma / 100_000
      foundGamma = true
    } else if (type === 'cHRM') {
      if (foundChromaticities) throw invalidInput('PNG contains multiple cHRM chunks')
      if (imageDataState !== 'before' || foundPalette)
        throw invalidInput('PNG cHRM must precede the palette and image data')
      chromaticities = parseChromaticities(await readExactly(source, dataOffset, length))
      foundChromaticities = true
    } else if (type === 'sRGB') {
      if (foundSrgb) throw invalidInput('PNG contains multiple sRGB chunks')
      if (imageDataState !== 'before' || foundPalette)
        throw invalidInput('PNG sRGB must precede the palette and image data')
      const intent = await readExactly(source, dataOffset, length)
      if (length !== 1 || (intent[0] ?? 4) > 3)
        throw invalidInput('PNG sRGB rendering intent is invalid')
      foundSrgb = true
    } else if (type === 'cICP') {
      if (foundCicp) throw invalidInput('PNG contains multiple cICP chunks')
      if (imageDataState !== 'before' || foundPalette)
        throw invalidInput('PNG cICP must precede the palette and image data')
      cicp = parseCicp(await readExactly(source, dataOffset, length))
      foundCicp = true
    } else if (type === 'PLTE') {
      if (foundPalette) throw invalidInput('PNG contains multiple PLTE chunks')
      if (imageDataState !== 'before') throw invalidInput('PNG PLTE must precede image data')
      if (foundTransparency) throw invalidInput('PNG PLTE must precede tRNS')
      if (rawColorType === 0 || rawColorType === 4)
        throw invalidInput('PNG grayscale images cannot contain a palette')
      if (length < 3 || length > 768 || length % 3 !== 0)
        throw invalidInput('PNG palette is invalid')
      if (rawColorType === 3 && length / 3 > 1 << bitDepth)
        throw invalidInput('PNG palette exceeds its indexed bit depth')
      palette = (await readExactly(source, dataOffset, length)).slice()
      foundPalette = true
    } else if (type === 'tRNS') {
      if (foundTransparency) throw invalidInput('PNG contains multiple tRNS chunks')
      if (imageDataState !== 'before') throw invalidInput('PNG tRNS must precede image data')
      if (rawColorType === 4 || rawColorType === 6)
        throw invalidInput('PNG tRNS is invalid for an alpha color type')
      if (rawColorType === 3 && !foundPalette)
        throw invalidInput('PNG indexed transparency requires a preceding palette')
      transparency = (await readExactly(source, dataOffset, length)).slice()
      hasAlpha = true
      foundTransparency = true
    } else if (type === 'acTL') {
      if (foundAnimation) throw invalidInput('PNG contains multiple acTL chunks')
      if (imageDataState !== 'before') throw invalidInput('PNG acTL must precede image data')
      if (length !== 8) throw invalidInput('PNG acTL chunk is invalid')
      const animation = await readExactly(source, dataOffset, length)
      frames = uint32BigEndian(animation, 0)
      if (frames < 1) throw invalidInput('PNG animation has no frames')
      validateImageDimensions(width, height, frames, limits)
      foundAnimation = true
    } else if (type === 'IDAT') {
      if (imageDataState === 'after') throw invalidInput('PNG IDAT chunks must be consecutive')
      if (rawColorType === 3 && !foundPalette)
        throw invalidInput('Indexed PNG image data requires a preceding palette')
      imageDataState = 'inside'
      const crcBytes = await readExactly(source, dataOffset + length, 4)
      idat.push({ offset: dataOffset, length, expectedCrc: uint32BigEndian(crcBytes, 0) })
      if (!requireImageData) break
    } else if (type === 'IEND') {
      if (length !== 0) throw invalidInput('PNG IEND chunk is invalid')
      foundEnd = true
      break
    } else {
      const typeByte = chunkHeader[4]
      if (typeByte !== undefined && (typeByte & 0x20) === 0) {
        throw invalidInput(`PNG contains unsupported critical chunk ${type}`)
      }
    }

    offset = end
    chunks += 1
  }

  if (chunks >= 10_000) throw invalidInput('PNG contains too many chunks')
  if (requireImageData) {
    if (idat.length === 0) throw invalidInput('PNG is missing image data')
    if (!foundEnd) throw truncatedInput('PNG is missing its IEND chunk')
    if (rawColorType === 3 && palette === undefined)
      throw invalidInput('Indexed PNG is missing its palette')
    if (rawColorType === 3 && transparency !== undefined && transparency.byteLength === 0) {
      throw invalidInput('Indexed PNG transparency is empty')
    }
    if (rawColorType === 0 && transparency !== undefined && transparency.byteLength !== 2) {
      throw invalidInput('Grayscale PNG transparency is invalid')
    }
    if (rawColorType === 2 && transparency !== undefined && transparency.byteLength !== 6) {
      throw invalidInput('Truecolor PNG transparency is invalid')
    }
    if (
      rawColorType === 3 &&
      transparency !== undefined &&
      transparency.byteLength > (palette?.byteLength ?? 0) / 3
    ) {
      throw invalidInput('Indexed PNG transparency exceeds its palette')
    }
  }

  let colorTransform: RgbIccTransform | undefined
  let grayTransform: Uint8Array | undefined
  let iccProfile: Uint8Array | undefined
  if (compressedIcc) iccProfile = await inflateIccProfile(compressedIcc)
  if (cicp) {
    colorTransform = cicpColorTransform(cicp, rawColorType)
  } else if (iccProfile) {
    colorTransform = parseRgbIccTransform(iccProfile)
  } else if (!foundSrgb && gamma !== undefined) {
    if (rawColorType === 0 && !hasAlpha) {
      grayTransform = createPngGrayTransform(gamma)
    } else {
      colorTransform = createPngColorTransform(gamma, chromaticities)
    }
  }

  return {
    width,
    height,
    bitDepth,
    colorType: rawColorType,
    interlace,
    hasAlpha,
    frames,
    palette,
    transparency,
    idat,
    colorTransform,
    grayTransform,
    iccProfile,
    exif,
  }
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

const paeth = (left: number, up: number, upperLeft: number): number => {
  const prediction = left + up - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const upDistance = Math.abs(prediction - up)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  return upDistance <= upperLeftDistance ? up : upperLeft
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const compressionLevel = (options: unknown): number => {
  if (!isRecord(options)) throw invalidInput('PNG encoder options must be an object')
  const value = options.compressionLevel ?? 6
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value > 9) {
    throw invalidInput('PNG compressionLevel must be an integer from 0 to 9')
  }
  return value
}

const typeBytes = (type: string): Uint8Array => {
  if (type.length !== 4) throw new Error('PNG chunk types contain four bytes')
  return Uint8Array.from(type, (character) => character.charCodeAt(0))
}

const uint32Bytes = (value: number): Uint8Array => {
  const output = new Uint8Array(4)
  new DataView(output.buffer).setUint32(0, value)
  return output
}

const writeChunk = async (sink: ImageSink, type: string, data: Uint8Array): Promise<void> => {
  const encodedType = typeBytes(type)
  await sink.write(uint32Bytes(data.byteLength))
  await sink.write(encodedType)
  await sink.write(data)
  await sink.write(uint32Bytes(crc32(encodedType, data)))
}

const filteredMagnitudeTable = Uint8Array.from({ length: 256 }, (_entry, value) =>
  Math.min(value, 256 - value),
)

const filteredMagnitude = (value: number): number => filteredMagnitudeTable[value] ?? 0

const chooseAdaptiveFilter = (
  none: number,
  sub: number,
  up: number,
  average: number,
  paethScore: number,
): number => {
  let filter = 0
  let score = none
  if (sub < score) {
    filter = 1
    score = sub
  }
  if (up < score) {
    filter = 2
    score = up
  }
  if (average < score) {
    filter = 3
    score = average
  }
  if (paethScore < score) return 4
  return filter
}

const applyFilterScanline = (
  source: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
  output: Uint8Array,
  filter: number,
): void => {
  output[0] = filter
  if (filter === 0) {
    output.set(source, 1)
    return
  }
  if (filter === 1) {
    output.set(source.subarray(0, bytesPerPixel), 1)
    for (let index = bytesPerPixel; index < source.byteLength; index += 1) {
      output[index + 1] = ((source[index] ?? 0) - (source[index - bytesPerPixel] ?? 0)) & 0xff
    }
    return
  }
  if (filter === 2) {
    for (let index = 0; index < source.byteLength; index += 1) {
      output[index + 1] = ((source[index] ?? 0) - (previous[index] ?? 0)) & 0xff
    }
    return
  }
  for (let index = 0; index < bytesPerPixel; index += 1) {
    const value = source[index] ?? 0
    const above = previous[index] ?? 0
    output[index + 1] = filter === 3 ? (value - (above >>> 1)) & 0xff : (value - above) & 0xff
  }
  if (filter === 3) {
    for (let index = bytesPerPixel; index < source.byteLength; index += 1) {
      const left = source[index - bytesPerPixel] ?? 0
      const above = previous[index] ?? 0
      output[index + 1] = ((source[index] ?? 0) - ((left + above) >>> 1)) & 0xff
    }
    return
  }
  for (let index = bytesPerPixel; index < source.byteLength; index += 1) {
    const left = source[index - bytesPerPixel] ?? 0
    const above = previous[index] ?? 0
    const upperLeft = previous[index - bytesPerPixel] ?? 0
    output[index + 1] = ((source[index] ?? 0) - paeth(left, above, upperLeft)) & 0xff
  }
}

const filterScanline = (
  source: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
  output: Uint8Array,
  adaptive: boolean,
): void => {
  let filter = 0
  if (adaptive) {
    let none = 0
    let sub = 0
    let up = 0
    let average = 0
    let paethScore = 0
    const length = source.byteLength
    for (let index = 0; index < bytesPerPixel && index < length; index += 1) {
      const value = source[index] ?? 0
      const above = previous[index] ?? 0
      const residual = (value - above) & 0xff
      none += filteredMagnitude(value)
      sub += filteredMagnitude(value)
      up += filteredMagnitude(residual)
      average += filteredMagnitude((value - Math.floor(above / 2)) & 0xff)
      paethScore += filteredMagnitude(residual)
    }
    for (let index = bytesPerPixel; index < length; index += 1) {
      const value = source[index] ?? 0
      const left = source[index - bytesPerPixel] ?? 0
      const above = previous[index] ?? 0
      const upperLeft = previous[index - bytesPerPixel] ?? 0
      none += filteredMagnitude(value)
      sub += filteredMagnitude((value - left) & 0xff)
      up += filteredMagnitude((value - above) & 0xff)
      average += filteredMagnitude((value - Math.floor((left + above) / 2)) & 0xff)
      paethScore += filteredMagnitude((value - paeth(left, above, upperLeft)) & 0xff)
    }
    filter = chooseAdaptiveFilter(none, sub, up, average, paethScore)
  }
  applyFilterScanline(source, previous, bytesPerPixel, output, filter)
}

class PngEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #deflater: DeflateEncoder
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #channels: number
  readonly #adaptiveFiltering: boolean
  readonly #previousRow: Uint8Array
  #acceleratedFilter: PngRowFilter | undefined
  #expectedY = 0
  #finished = false

  constructor(
    sink: ImageSink,
    deflater: DeflateEncoder,
    width: number,
    height: number,
    format: PixelFormat,
    adaptiveFiltering: boolean,
    acceleratedFilter: PngRowFilter | undefined,
  ) {
    this.#sink = sink
    this.#deflater = deflater
    this.#width = width
    this.#height = height
    this.#format = format
    this.#channels = bytesPerPixel(format)
    this.#adaptiveFiltering = adaptiveFiltering
    this.#previousRow = new Uint8Array(width * this.#channels)
    this.#acceleratedFilter = acceleratedFilter
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished PNG encoder')
    try {
      if (
        block.x !== 0 ||
        block.y !== this.#expectedY ||
        block.width !== this.#width ||
        block.height < 1 ||
        block.y + block.height > this.#height ||
        block.format !== this.#format
      ) {
        throw invalidInput('PNG encoder requires ordered, full-width pixel blocks')
      }
      const rowBytes = this.#width * this.#channels
      if (
        block.stride < rowBytes ||
        block.data.byteLength < block.stride * (block.height - 1) + rowBytes
      ) {
        throw invalidInput('PNG encoder pixel block data is truncated')
      }

      for (let firstRow = 0; firstRow < block.height; firstRow += scanlineBlockRows) {
        const rows = Math.min(scanlineBlockRows, block.height - firstRow)
        let scanlines: Uint8Array
        if (this.#acceleratedFilter) {
          scanlines = this.#acceleratedFilter.filter(
            block.data.subarray(firstRow * block.stride),
            block.stride,
            rows,
          )
        } else {
          scanlines = new Uint8Array((rowBytes + 1) * rows)
          for (let row = 0; row < rows; row += 1) {
            const sourceOffset = (firstRow + row) * block.stride
            const source = block.data.subarray(sourceOffset, sourceOffset + rowBytes)
            filterScanline(
              source,
              this.#previousRow,
              this.#channels,
              scanlines.subarray(row * (rowBytes + 1), (row + 1) * (rowBytes + 1)),
              this.#adaptiveFiltering,
            )
            this.#previousRow.set(source)
          }
        }
        await this.#deflater.write(scanlines)
      }
      this.#expectedY += block.height
    } catch (error) {
      if (this.#acceleratedFilter) {
        this.#finished = true
        this.#releaseFilter()
      }
      throw error
    }
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('PNG encoder is already finished')
    this.#finished = true
    try {
      if (this.#expectedY !== this.#height) {
        throw invalidInput(`PNG encoder received ${this.#expectedY} of ${this.#height} rows`)
      }
      await this.#deflater.finish()
      await writeChunk(this.#sink, 'IEND', new Uint8Array())
    } finally {
      this.#releaseFilter()
    }
  }

  async abort(reason: unknown): Promise<void> {
    this.#finished = true
    try {
      await this.#deflater.abort(reason)
    } finally {
      this.#releaseFilter()
    }
  }

  #releaseFilter(): void {
    this.#acceleratedFilter?.release()
    this.#acceleratedFilter = undefined
  }
}

const createPngEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
  accelerations: readonly PngAcceleration[] = [],
): Promise<ImageEncoder> => {
  if (
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1 ||
    request.width > 0xffffffff ||
    request.height > 0xffffffff
  ) {
    throw invalidInput(`Invalid PNG output dimensions: ${request.width}x${request.height}`)
  }
  bytesPerPixel(request.pixelFormat)
  const level = compressionLevel(request.options)
  const runtime = request.runtime
  if (!runtime) throw unsupportedOperation('PNG encoding requires a runtime compression provider')
  const semantics = request.colorSemantics
  const sourceProfilePixels =
    semantics?.primaries === 'source-profile' || semantics?.transfer.kind === 'source-profile'
  if (sourceProfilePixels && (semantics.provenance !== 'icc' || !request.metadata?.icc)) {
    throw unsupportedOperation(
      'PNG source-profile pixels require an explicitly preserved ICC profile',
    )
  }
  if (semantics?.provenance === 'icc' && !request.metadata?.icc) {
    throw unsupportedOperation(
      'PNG ICC pixel semantics require an explicitly preserved ICC profile',
    )
  }

  let acceleratedFilter: PngRowFilter | undefined
  for (const acceleration of accelerations) {
    if (!acceleration.encode) continue
    acceleratedFilter = await acceleration.encode({
      width: request.width,
      height: request.height,
      pixelFormat: request.pixelFormat,
      adaptiveFiltering: level !== 0,
    })
    if (acceleratedFilter) break
  }

  try {
    await sink.write(signature)
    const header = new Uint8Array(13)
    const view = new DataView(header.buffer)
    view.setUint32(0, request.width)
    view.setUint32(4, request.height)
    const bitDepth = request.pixelFormat.endsWith('16') ? 16 : 8
    const storageChannels =
      request.pixelFormat === 'gray8' || request.pixelFormat === 'gray16'
        ? 1
        : request.pixelFormat === 'rgb8' || request.pixelFormat === 'rgb16'
          ? 3
          : 4
    header[8] = bitDepth
    header[9] = storageChannels === 1 ? 0 : storageChannels === 3 ? 2 : 6
    await writeChunk(sink, 'IHDR', header)

    const icc = request.metadata?.icc
    if (icc) {
      const colorSpace = iccColorSpace(icc)
      if (
        colorSpace === 'other' ||
        ((request.pixelFormat === 'gray8' || request.pixelFormat === 'gray16') &&
          colorSpace !== 'gray') ||
        (request.pixelFormat !== 'gray8' &&
          request.pixelFormat !== 'gray16' &&
          colorSpace !== 'rgb')
      ) {
        throw invalidInput('Preserved ICC profile does not match PNG output pixels')
      }
      const name = Uint8Array.of(
        0x50,
        0x75,
        0x72,
        0x65,
        0x4a,
        0x73,
        0x49,
        0x6d,
        0x61,
        0x67,
        0x65,
        0,
        0,
      )
      const compressed = await runtime.deflate(icc, { level: 6, strategy: 'default' })
      const payload = new Uint8Array(name.byteLength + compressed.byteLength)
      payload.set(name)
      payload.set(compressed, name.byteLength)
      await writeChunk(sink, 'iCCP', payload)
    }
    if (request.metadata?.exif) await writeChunk(sink, 'eXIf', request.metadata.exif)
    return new PngEncoder(
      sink,
      runtime.createDeflateEncoder(
        {
          level,
          strategy: request.pixelFormat === 'rgb8' ? 'rle' : 'default',
        },
        (chunk) => writeChunk(sink, 'IDAT', chunk),
      ),
      request.width,
      request.height,
      request.pixelFormat,
      level !== 0,
      acceleratedFilter,
    )
  } catch (error) {
    acceleratedFilter?.release()
    throw error
  }
}

const decodePng = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  accelerations: readonly PngAcceleration[] = [],
): Promise<ImageDecoder> => {
  const description = await parsePng(source, limits, true)
  const decoder = new PngDecoder(source, description, limits, accelerations)
  if (options.preserveIcc === true && description.iccProfile) return decoder
  if (description.bitDepth === 16) return decoder
  if (description.colorTransform)
    return new ColorManagedDecoder(decoder, description.colorTransform)
  return description.grayTransform
    ? new GrayColorManagedDecoder(decoder, description.grayTransform)
    : decoder
}

export const pngCodec: ImageCodec = {
  format: 'png',
  mimeTypes: ['image/png'],
  minimumBytes: signature.length,
  encoderPixelFormats: ['gray8', 'rgb8', 'rgba8', 'gray16', 'rgb16', 'rgba16'],
  acceptsColorSemantics: (semantics) =>
    (semantics.family === 'gray' || semantics.family === 'rgb') &&
    semantics.matrix === 'identity' &&
    semantics.range === 'full' &&
    (semantics.alpha === 'none' || semantics.alpha === 'straight'),
  detect: isPng,
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    const description = await parsePng(source, limits, false)
    return {
      width: description.width,
      height: description.height,
      format: 'png',
      mimeType: 'image/png',
      hasAlpha: description.hasAlpha,
      colorSpace: colorSpace(description.colorType),
      bitDepth: description.bitDepth,
      frames: description.frames,
    }
  },
  async preservedMetadata(source: ImageSource, limits: ImageLimits): Promise<PreservedMetadata> {
    const description = await parsePng(source, limits, true)
    return {
      ...(description.exif ? { exif: Uint8Array.from(description.exif) } : {}),
      ...(description.iccProfile ? { icc: Uint8Array.from(description.iccProfile) } : {}),
    }
  },
  createDecoder: decodePng,
  createEncoder: createPngEncoder,
}

const acceleratedPngCodecs = new WeakMap<ImageCodec, readonly PngAcceleration[]>()

const registeredPngAccelerations = (codec: ImageCodec): readonly PngAcceleration[] | undefined => {
  if (codec === pngCodec) return []
  return acceleratedPngCodecs.get(codec)
}

export const acceleratePngCodec = (
  reference: ImageCodec,
  acceleration: PngAcceleration,
): ImageCodec => {
  const registered = registeredPngAccelerations(reference)
  if (!registered) {
    throw new Error('PNG acceleration requires the PureJsImage reference PNG codec')
  }
  const accelerations = Object.freeze([...registered, acceleration])
  const accelerated: ImageCodec = Object.freeze({
    ...reference,
    createDecoder: (
      source: ImageSource,
      limits: ImageLimits,
      options?: Readonly<DecoderOptions>,
    ): Promise<ImageDecoder> => decodePng(source, limits, options, accelerations),
    createEncoder: (sink: ImageSink, request: EncodeRequest): Promise<ImageEncoder> =>
      createPngEncoder(sink, request, accelerations),
  })
  acceleratedPngCodecs.set(accelerated, accelerations)
  return accelerated
}
