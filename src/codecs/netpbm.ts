import type { ImageCodec, ImageMetadata } from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import type { PixelFormat } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { SourceCursor } from './source-cursor.ts'

const isNetpbm = (header: Uint8Array): boolean => {
  if (header[0] !== 0x50) return false
  const second = header[1]
  return (
    second === 0x31 ||
    second === 0x32 ||
    second === 0x33 ||
    second === 0x34 ||
    second === 0x35 ||
    second === 0x36 ||
    second === 0x37 ||
    second === 0x46 ||
    second === 0x66
  )
}
const maximumHeaderBytes = 65_536
const maximumTokenBytes = 64

export type NetpbmKind = 'pam' | 'pbm' | 'pfm' | 'pgm' | 'ppm'

type NetpbmMagic = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'PF' | 'Pf'

type PamTupleType =
  | 'BLACKANDWHITE'
  | 'BLACKANDWHITE_ALPHA'
  | 'GRAYSCALE'
  | 'GRAYSCALE_ALPHA'
  | 'RGB'
  | 'RGB_ALPHA'

export interface NetpbmDescription {
  readonly magic: NetpbmMagic
  readonly kind: NetpbmKind
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly maxValue: number | undefined
  readonly dataOffset: number
  readonly ascii: boolean
  readonly tupleType: PamTupleType | undefined
  readonly pixelFormat: PixelFormat
  readonly sourceChannels: number
  readonly outputChannels: 1 | 3 | 4
  readonly littleEndian: boolean | undefined
  readonly scale: number | undefined
}

const isWhitespace = (byte: number): boolean =>
  byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0b || byte === 0x0c || byte === 0x0d

export class NetpbmTokenReader {
  readonly cursor: SourceCursor
  readonly #maximumOffset: number | undefined

  constructor(source: ImageSource, offset = 0, signal?: AbortSignal, maximumOffset?: number) {
    this.cursor = new SourceCursor(source, offset, signal === undefined ? {} : { signal })
    this.#maximumOffset = maximumOffset
  }

  async #byte(message: string): Promise<number> {
    const byte = await this.cursor.byte(message)
    if (this.#maximumOffset !== undefined && this.cursor.offset > this.#maximumOffset) {
      throw invalidInput(`Netpbm header exceeds ${maximumHeaderBytes} bytes`)
    }
    return byte
  }

  async token(label: string, comments = true): Promise<string> {
    let byte = await this.#byte(`${label} is truncated`)
    for (;;) {
      while (isWhitespace(byte)) byte = await this.#byte(`${label} is truncated`)
      if (!comments || byte !== 0x23) break
      do {
        byte = await this.#byte(`${label} comment is truncated`)
      } while (byte !== 0x0a && byte !== 0x0d)
      byte = await this.#byte(`${label} is truncated`)
    }
    let value = ''
    while (!isWhitespace(byte) && (!comments || byte !== 0x23)) {
      if (byte < 0x21 || byte > 0x7e) throw invalidInput(`${label} contains a non-ASCII byte`)
      if (value.length >= maximumTokenBytes)
        throw invalidInput(`${label} exceeds ${maximumTokenBytes} bytes`)
      value += String.fromCharCode(byte)
      byte = await this.#byte(`${label} delimiter is truncated`)
    }
    if (value.length === 0) throw invalidInput(`${label} is empty`)
    if (byte === 0x0d && this.cursor.remaining > 0) {
      const next = await this.#byte(`${label} CRLF delimiter is truncated`)
      if (next !== 0x0a) this.cursor.seek(this.cursor.offset - 1)
    } else if (comments && byte === 0x23) {
      do {
        byte = await this.#byte(`${label} comment is truncated`)
      } while (byte !== 0x0a && byte !== 0x0d)
    }
    return value
  }

  async line(label: string): Promise<string> {
    let value = ''
    while (value.length <= 4096) {
      const byte = await this.#byte(`${label} is truncated`)
      if (byte === 0x0a) return value.endsWith('\r') ? value.slice(0, -1) : value
      value += String.fromCharCode(byte)
    }
    throw invalidInput(`${label} exceeds 4096 bytes`)
  }
}

const positiveInteger = (label: string, value: string): number => {
  if (!/^[1-9]\d*$/.test(value)) throw invalidInput(`${label} must be a positive decimal integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw invalidInput(`${label} exceeds safe integer range`)
  return parsed
}

const maxValue = (value: string): number => {
  const parsed = positiveInteger('Netpbm MAXVAL', value)
  if (parsed > 65_535) throw invalidInput('Netpbm MAXVAL exceeds 65535')
  return parsed
}

const pamTuple = (value: string): PamTupleType => {
  if (
    value === 'BLACKANDWHITE' ||
    value === 'BLACKANDWHITE_ALPHA' ||
    value === 'GRAYSCALE' ||
    value === 'GRAYSCALE_ALPHA' ||
    value === 'RGB' ||
    value === 'RGB_ALPHA'
  ) {
    return value
  }
  throw unsupportedOperation(`PAM tuple type ${value || '(empty)'} is unsupported`)
}

const pamDescription = async (
  source: ImageSource,
  limits: ImageLimits,
  reader: NetpbmTokenReader,
): Promise<NetpbmDescription> => {
  let width: number | undefined
  let height: number | undefined
  let depth: number | undefined
  let maximum: number | undefined
  const tupleParts: string[] = []
  while (reader.cursor.offset <= maximumHeaderBytes) {
    const rawLine = (await reader.line('PAM header line')).trim()
    if (rawLine.length === 0 || rawLine.startsWith('#')) continue
    const separator = rawLine.search(/\s/)
    const key = separator < 0 ? rawLine : rawLine.slice(0, separator)
    const value = separator < 0 ? '' : rawLine.slice(separator).trim()
    if (key === 'ENDHDR') {
      if (value.length !== 0) throw invalidInput('PAM ENDHDR line must not have a value')
      break
    }
    if (key === 'TUPLTYPE') {
      if (value.length === 0) throw invalidInput('PAM TUPLTYPE value is empty')
      tupleParts.push(value)
      continue
    }
    if (key !== 'WIDTH' && key !== 'HEIGHT' && key !== 'DEPTH' && key !== 'MAXVAL') {
      throw invalidInput(`PAM header field ${key} is unknown`)
    }
    const parsed = key === 'MAXVAL' ? maxValue(value) : positiveInteger(`PAM ${key}`, value)
    if (key === 'WIDTH') {
      if (width !== undefined) throw invalidInput('PAM WIDTH appears more than once')
      width = parsed
    } else if (key === 'HEIGHT') {
      if (height !== undefined) throw invalidInput('PAM HEIGHT appears more than once')
      height = parsed
    } else if (key === 'DEPTH') {
      if (depth !== undefined) throw invalidInput('PAM DEPTH appears more than once')
      depth = parsed
    } else {
      if (maximum !== undefined) throw invalidInput('PAM MAXVAL appears more than once')
      maximum = parsed
    }
  }
  if (reader.cursor.offset > maximumHeaderBytes) {
    throw invalidInput(`PAM header exceeds ${maximumHeaderBytes} bytes`)
  }
  if (width === undefined || height === undefined || depth === undefined || maximum === undefined) {
    throw invalidInput('PAM header is missing WIDTH, HEIGHT, DEPTH, or MAXVAL')
  }
  const tupleType = pamTuple(tupleParts.join(' '))
  const expectedDepth: Readonly<Record<PamTupleType, number>> = {
    BLACKANDWHITE: 1,
    BLACKANDWHITE_ALPHA: 2,
    GRAYSCALE: 1,
    GRAYSCALE_ALPHA: 2,
    RGB: 3,
    RGB_ALPHA: 4,
  }
  if (depth !== expectedDepth[tupleType]) {
    throw invalidInput(`PAM ${tupleType} requires DEPTH ${expectedDepth[tupleType]}`)
  }
  if ((tupleType === 'BLACKANDWHITE' || tupleType === 'BLACKANDWHITE_ALPHA') && maximum !== 1) {
    throw invalidInput(`PAM ${tupleType} requires MAXVAL 1`)
  }
  const outputChannels: 1 | 3 | 4 = tupleType.endsWith('_ALPHA') ? 4 : tupleType === 'RGB' ? 3 : 1
  const high = maximum > 255
  const pixelFormat: PixelFormat =
    outputChannels === 1
      ? high
        ? 'gray16'
        : 'gray8'
      : outputChannels === 3
        ? high
          ? 'rgb16'
          : 'rgb8'
        : high
          ? 'rgba16'
          : 'rgba8'
  validateImageDimensions(width, height, 1, limits, outputChannels * (high ? 2 : 1))
  const bytesPerSample = high ? 2 : 1
  const required =
    BigInt(reader.cursor.offset) + BigInt(width) * BigInt(height) * BigInt(depth * bytesPerSample)
  if (required > BigInt(source.size)) throw truncatedInput('PAM raster is truncated')
  return {
    magic: 'P7',
    kind: 'pam',
    width,
    height,
    depth,
    maxValue: maximum,
    dataOffset: reader.cursor.offset,
    ascii: false,
    tupleType,
    pixelFormat,
    sourceChannels: depth,
    outputChannels,
    littleEndian: undefined,
    scale: undefined,
  }
}

export const describeNetpbm = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<NetpbmDescription> => {
  if (source.size < 3) throw truncatedInput('Netpbm header is truncated')
  const reader = new NetpbmTokenReader(source, 0, undefined, maximumHeaderBytes)
  const magic = await reader.token('Netpbm magic', false)
  if (!['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'PF', 'Pf'].includes(magic)) {
    throw invalidInput('Netpbm magic is invalid')
  }
  if (magic === 'P7') return pamDescription(source, limits, reader)
  if (magic === 'PF' || magic === 'Pf') {
    const width = positiveInteger('PFM width', await reader.token('PFM width', false))
    const height = positiveInteger('PFM height', await reader.token('PFM height', false))
    const signedScale = Number(await reader.token('PFM scale', false))
    if (!Number.isFinite(signedScale) || signedScale === 0) {
      throw invalidInput('PFM scale must be finite and nonzero')
    }
    const depth = magic === 'PF' ? 3 : 1
    validateImageDimensions(width, height, 1, limits, depth * 4)
    const required =
      BigInt(reader.cursor.offset) + BigInt(width) * BigInt(height) * BigInt(depth * 4)
    if (required > BigInt(source.size)) throw truncatedInput('PFM raster is truncated')
    return {
      magic,
      kind: 'pfm',
      width,
      height,
      depth,
      maxValue: undefined,
      dataOffset: reader.cursor.offset,
      ascii: false,
      tupleType: undefined,
      pixelFormat: depth === 1 ? 'grayf32' : 'rgbf32',
      sourceChannels: depth,
      outputChannels: depth,
      littleEndian: signedScale < 0,
      scale: Math.abs(signedScale),
    }
  }

  const width = positiveInteger('Netpbm width', await reader.token('Netpbm width'))
  const height = positiveInteger('Netpbm height', await reader.token('Netpbm height'))
  const pbm = magic === 'P1' || magic === 'P4'
  const ppm = magic === 'P3' || magic === 'P6'
  const maximum = pbm ? 1 : maxValue(await reader.token('Netpbm MAXVAL'))
  const depth = ppm ? 3 : 1
  const high = maximum > 255
  const outputChannels = depth as 1 | 3
  const pixelFormat: PixelFormat =
    depth === 1 ? (high ? 'gray16' : 'gray8') : high ? 'rgb16' : 'rgb8'
  validateImageDimensions(width, height, 1, limits, depth * (high ? 2 : 1))
  const ascii = magic === 'P1' || magic === 'P2' || magic === 'P3'
  if (!ascii) {
    const rowBytes = pbm ? Math.ceil(width / 8) : width * depth * (high ? 2 : 1)
    const required = BigInt(reader.cursor.offset) + BigInt(rowBytes) * BigInt(height)
    if (required > BigInt(source.size))
      throw truncatedInput(`${pbm ? 'PBM' : ppm ? 'PPM' : 'PGM'} raster is truncated`)
  }
  return {
    magic: magic as NetpbmMagic,
    kind: pbm ? 'pbm' : ppm ? 'ppm' : 'pgm',
    width,
    height,
    depth,
    maxValue: maximum,
    dataOffset: reader.cursor.offset,
    ascii,
    tupleType: undefined,
    pixelFormat,
    sourceChannels: depth,
    outputChannels,
    littleEndian: undefined,
    scale: undefined,
  }
}

export const bytesPerSample = (format: PixelFormat): 1 | 2 | 4 =>
  format.endsWith('16') ? 2 : format.endsWith('f32') ? 4 : 1

const mimeType = (kind: NetpbmKind): string => {
  if (kind === 'pbm') return 'image/x-portable-bitmap'
  if (kind === 'pgm') return 'image/x-portable-graymap'
  if (kind === 'ppm') return 'image/x-portable-pixmap'
  if (kind === 'pam') return 'image/x-portable-arbitrarymap'
  return 'image/x-portable-floatmap'
}

const metadata = (description: NetpbmDescription): ImageMetadata => ({
  width: description.width,
  height: description.height,
  format: 'netpbm',
  mimeType: mimeType(description.kind),
  hasAlpha: description.outputChannels === 4,
  bitDepth:
    description.kind === 'pfm'
      ? 32
      : (description.maxValue ?? 255) > 255
        ? 16
        : description.kind === 'pbm'
          ? 1
          : 8,
  sampleFormat: description.kind === 'pfm' ? 'floating-point' : 'unsigned-integer',
  components: description.outputChannels,
  channels: description.outputChannels,
  frames: 1,
  lossless: true,
  variant: description.magic,
  ...(description.scale === undefined ? {} : { scale: description.scale }),
  ...(description.kind === 'pfm' ? { storageOrientation: 'bottom-to-top' } : {}),
})

export const netpbmCodec: ImageCodec = {
  format: 'netpbm',
  mimeTypes: [
    'image/x-portable-anymap',
    'image/x-portable-bitmap',
    'image/x-portable-graymap',
    'image/x-portable-pixmap',
    'image/x-portable-arbitrarymap',
    'image/x-portable-floatmap',
  ],
  minimumBytes: 2,
  encoderPixelFormats: ['gray8', 'gray16', 'grayf32', 'rgb8', 'rgb16', 'rgbf32', 'rgba8', 'rgba16'],
  detect: isNetpbm,
  metadata: async (source, limits) => metadata(await describeNetpbm(source, limits)),
  async createDecoder(source, limits) {
    const { createNetpbmDecoder } = await import('./netpbm-pixels.ts')
    return createNetpbmDecoder(source, limits)
  },
  async createEncoder(sink, request) {
    const { createNetpbmEncoder } = await import('./netpbm-pixels.ts')
    return createNetpbmEncoder(sink, request)
  },
}
