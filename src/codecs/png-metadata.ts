import type { ImageMetadata, PreservedMetadata } from '../codec.ts'
import {
  ImageError,
  invalidInput,
  limitExceeded,
  truncatedInput,
  unsupportedOperation,
} from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import { type ImageSource, readExactly } from '../source.ts'
import { crc32, updateCrc32 } from './crc32.ts'
import { ascii, uint32BigEndian } from './helpers.ts'
import {
  createDisplayP3Transform,
  createPngColorTransform,
  createPngGrayTransform,
  MAX_ICC_PROFILE_BYTES,
  parseGrayIccAsRgbTransform,
  parseGrayIccTransform,
  parseRgbIccTransform,
  type RgbChromaticities,
  type RgbIccTransform,
} from './icc.ts'
import { isPng } from './png-common.ts'
import type { PngColorType } from './png.ts'
export const sourceReadSize = 65_536

export interface ChunkRange {
  readonly offset: number
  readonly length: number
  readonly expectedCrc: number
}

export interface PngDescription {
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
  readonly colorSignal: PngEffectiveColorSignal
  readonly iccProfile: Uint8Array | undefined
  readonly gamma: number | undefined
  readonly chromaticities: RgbChromaticities | undefined
  readonly exif: Uint8Array | undefined
}

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

type PngEffectiveColorSignal =
  | { readonly kind: 'cicp'; readonly value: PngCicp }
  | { readonly kind: 'icc' }
  | { readonly kind: 'srgb'; readonly intent: number }
  | { readonly kind: 'chromaticities' }
  | { readonly kind: 'gamma'; readonly encoded: number }
  | { readonly kind: 'unspecified' }

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

const effectivePngColorSignal = (
  cicp: PngCicp | undefined,
  iccProfile: Uint8Array | undefined,
  srgbIntent: number | undefined,
  chromaticities: RgbChromaticities | undefined,
  encodedGamma: number | undefined,
): PngEffectiveColorSignal => {
  if (cicp !== undefined) return { kind: 'cicp', value: cicp }
  if (iccProfile !== undefined) return { kind: 'icc' }
  if (srgbIntent !== undefined) return { kind: 'srgb', intent: srgbIntent }
  if (chromaticities !== undefined) return { kind: 'chromaticities' }
  if (encodedGamma !== undefined) return { kind: 'gamma', encoded: encodedGamma }
  return { kind: 'unspecified' }
}

const cicpColorTransform = (
  cicp: PngCicp,
  colorType: PngColorType,
): RgbIccTransform | undefined => {
  const [primaries, transfer, , fullRange] = cicp
  if (fullRange !== 1) {
    throw unsupportedOperation('PNG cICP narrow-range color management is not implemented')
  }
  if (primaries === 1 && (transfer === 8 || transfer === 13)) return undefined
  if (colorType === 0 || colorType === 4) {
    throw unsupportedOperation('PNG cICP color management for grayscale pixels is not implemented')
  }
  if (transfer === 13 && primaries === 12) return createDisplayP3Transform()
  throw unsupportedOperation(
    `PNG cICP primaries ${primaries} and transfer ${transfer} are not implemented`,
  )
}

export const parsePng = async (
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
  let encodedGamma: number | undefined
  let chromaticities: RgbChromaticities | undefined
  let srgbIntent: number | undefined
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
      encodedGamma = uint32BigEndian(await readExactly(source, dataOffset, length), 0)
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
      srgbIntent = intent[0]
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
  // H.273 value 2 means unspecified. A full-range cICP with unspecified primaries and transfer
  // signals nothing, so the other chunks apply; partly specified values keep their explicit checks.
  const signaledCicp = cicp && !(cicp[0] === 2 && cicp[1] === 2 && cicp[3] === 1) ? cicp : undefined
  const colorSignal = effectivePngColorSignal(
    signaledCicp,
    iccProfile,
    srgbIntent,
    chromaticities,
    encodedGamma,
  )
  if (signaledCicp) {
    colorTransform = cicpColorTransform(signaledCicp, rawColorType)
  } else if (iccProfile) {
    if (rawColorType === 0 && !hasAlpha) grayTransform = parseGrayIccTransform(iccProfile)
    // Gray with alpha or tRNS decodes to RGBA with equal color samples. A GRAY profile applies its
    // curve to them. An RGB profile, which libpng warns about and browsers accept, converts them
    // as RGB.
    else if ((rawColorType === 0 || rawColorType === 4) && isGrayProfile(iccProfile))
      colorTransform = parseGrayIccAsRgbTransform(iccProfile)
    else colorTransform = parseRgbIccTransform(iccProfile)
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
    colorSignal,
    iccProfile,
    gamma,
    chromaticities,
    exif,
  }
}

export const isGrayProfile = (profile: Uint8Array): boolean =>
  String.fromCharCode(...profile.subarray(16, 20)) === 'GRAY'

export const readPngMetadata = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageMetadata> => {
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
}

export const preservePngMetadata = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<PreservedMetadata> => {
  const description = await parsePng(source, limits, true)
  return {
    ...(description.exif ? { exif: Uint8Array.from(description.exif) } : {}),
    ...(description.iccProfile ? { icc: Uint8Array.from(description.iccProfile) } : {}),
  }
}
