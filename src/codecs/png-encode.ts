import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { DeflateEncoder, DeflateOptions, ImageRuntime } from '../runtime.ts'
import type { ImageSink } from '../sink.ts'
import { crc32 } from './crc32.ts'
import { signature, scanlineBlockRows, bytesPerPixel } from './png-common.ts'
import type { PngAcceleration, PngRowFilter } from './png.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

interface PngEncoderOptions {
  readonly level: number
  readonly palette: boolean
}

const encoderOptions = (options: unknown): PngEncoderOptions => {
  if (!isRecord(options)) throw invalidInput('PNG encoder options must be an object')
  const level = options.compressionLevel ?? 6
  if (!Number.isInteger(level) || typeof level !== 'number' || level < 0 || level > 9) {
    throw invalidInput('PNG compressionLevel must be an integer from 0 to 9')
  }
  const palette = options.palette ?? true
  if (typeof palette !== 'boolean') throw invalidInput('PNG palette must be a boolean')
  return { level, palette }
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

type ChunkWriter = Pick<ImageSink, 'write'>

const writeChunk = async (sink: ChunkWriter, type: string, data: Uint8Array): Promise<void> => {
  const encodedType = typeBytes(type)
  await sink.write(uint32Bytes(data.byteLength))
  await sink.write(encodedType)
  await sink.write(data)
  await sink.write(uint32Bytes(crc32(encodedType, data)))
}

interface PngChunk {
  readonly type: string
  readonly data: Uint8Array
}

interface PngColorSignal extends PngChunk {
  readonly type: 'gAMA' | 'sRGB' | 'cICP'
}

const writeHeader = async (
  sink: ChunkWriter,
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  ancillary: readonly PngChunk[],
): Promise<void> => {
  await sink.write(signature)
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = bitDepth
  header[9] = colorType
  await writeChunk(sink, 'IHDR', header)
  for (const chunk of ancillary) await writeChunk(sink, chunk.type, chunk.data)
}

const pngRenderingIntentCode = (intent: PixelColorSemantics['renderingIntent']): number => {
  if (intent === undefined || intent === 'perceptual') return 0
  if (intent === 'relative') return 1
  if (intent === 'saturation') return 2
  return 3
}

const nativePngColorSignal = (
  semantics: PixelColorSemantics | undefined,
): PngColorSignal | undefined => {
  if (semantics === undefined) return undefined
  if (semantics.primaries === 'srgb' && semantics.transfer.kind === 'srgb') {
    return {
      type: 'sRGB',
      data: Uint8Array.of(pngRenderingIntentCode(semantics.renderingIntent)),
    }
  }
  if (
    (semantics.family === 'rgb' || semantics.family === 'gray') &&
    semantics.primaries === 'srgb' &&
    semantics.transfer.kind === 'linear' &&
    semantics.matrix === 'identity' &&
    semantics.range === 'full' &&
    semantics.renderingIntent === undefined
  ) {
    return { type: 'cICP', data: Uint8Array.of(1, 8, 0, 1) }
  }
  if (
    semantics.family === 'rgb' &&
    semantics.primaries === 'display-p3' &&
    semantics.transfer.kind === 'srgb' &&
    semantics.renderingIntent === undefined
  ) {
    return { type: 'cICP', data: Uint8Array.of(12, 13, 0, 1) }
  }
  if (
    semantics.primaries === 'unspecified' &&
    semantics.transfer.kind === 'gamma' &&
    semantics.renderingIntent === undefined
  ) {
    const encoded = Math.round(100_000 / semantics.transfer.exponent)
    if (
      encoded < 1 ||
      encoded > 0xffffffff ||
      !Number.isSafeInteger(encoded) ||
      100_000 / encoded !== semantics.transfer.exponent
    ) {
      throw unsupportedOperation('PNG cannot represent the exact pixel gamma exponent')
    }
    const data = new Uint8Array(4)
    new DataView(data.buffer).setUint32(0, encoded)
    return { type: 'gAMA', data }
  }
  if (
    semantics.primaries === 'unspecified' &&
    semantics.transfer.kind === 'unspecified' &&
    semantics.renderingIntent === undefined
  ) {
    return undefined
  }
  throw unsupportedOperation('PNG cannot represent the native pixel color semantics exactly')
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
): 0 | 1 | 2 | 3 | 4 => {
  let filter: 0 | 1 | 2 | 3 = 0
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

// The residual is reduced modulo 256, so one byte holds any Paeth offset.
// Index by the two neighbor differences, each in [-255, 255].
const paethOffsets = new Uint8Array(512 * 511)
const aboveOffsets = Uint8Array.from({ length: 511 }, (_, index) => index - 255)
for (let left = -255; left <= 255; left += 1) {
  const origin = (left + 255) * 512 + 255
  paethOffsets.set(aboveOffsets, origin - 255)
  // Relative to a zero corner, Paeth compares |above|, |left| and |left + above|.
  // Corner wins strictly between -2*left and -left/2. Left wins from -left/2
  // through left, including ties. Elsewhere the predictor is above.
  const middle = Math.trunc(-left / 2)
  const other = -2 * left
  const cornerStart = Math.max(-255, Math.min(other, middle) + 1)
  const cornerEnd = Math.min(256, Math.max(other, middle))
  paethOffsets.fill(0, origin + cornerStart, origin + cornerEnd)
  paethOffsets.fill(left, origin + Math.min(middle, left), origin + Math.max(middle, left) + 1)
}

const encodePaeth = (left: number, above: number, corner: number): number =>
  corner + (paethOffsets[(left - corner + 255) * 512 + above - corner + 255] ?? 0)

const applyFilterScanline = (
  source: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
  output: Uint8Array,
  filter: 0 | 1 | 2 | 3,
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
    const above = previous[index] ?? 0
    output[index + 1] = ((source[index] ?? 0) - (above >>> 1)) & 0xff
  }
  for (let index = bytesPerPixel; index < source.byteLength; index += 1) {
    const left = source[index - bytesPerPixel] ?? 0
    const above = previous[index] ?? 0
    output[index + 1] = ((source[index] ?? 0) - ((left + above) >>> 1)) & 0xff
  }
}

// A nonzero word may include up to three zero bytes. Scoring those bytes is exact.
const zeroPrefix = (row: DataView, limit: number): number => {
  let index = 0
  for (; index + 4 <= limit; index += 4) {
    if (row.getUint32(index) !== 0) return index
  }
  while (index < limit && row.getUint8(index) === 0) index += 1
  return index
}

const filterScanline = (
  source: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
  output: Uint8Array,
  adaptive: boolean,
  predictAverage: boolean,
): 0 | 1 | 2 | 3 | 4 | undefined => {
  let filter: 0 | 1 | 2 | 3 | 4 = 0
  // An all-zero row gives None the lowest possible score and it wins all ties.
  if (adaptive) {
    const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength)
    const prefix = zeroPrefix(sourceView, source.byteLength)
    if (prefix === source.byteLength) return undefined
    const previousView = new DataView(previous.buffer, previous.byteOffset, previous.byteLength)
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
      output[index + 1] = predictAverage ? value - (above >>> 1) : residual
      paethScore += filteredMagnitude(residual)
    }
    // Beyond the last nonzero byte, Left and the Paeth corner can still
    // contribute for one more pixel.
    const start = Math.max(bytesPerPixel, zeroPrefix(previousView, prefix))
    let end = length
    while (
      end - 4 >= start &&
      (sourceView.getUint32(end - 4) | previousView.getUint32(end - 4)) === 0
    ) {
      end -= 4
    }
    end = Math.min(length, end + bytesPerPixel)
    output.fill(0, bytesPerPixel + 1, start + 1)
    output.fill(0, end + 1)
    for (let index = start; index < end; index += 1) {
      const value = sourceView.getUint8(index)
      const left = sourceView.getUint8(index - bytesPerPixel)
      const above = previousView.getUint8(index)
      const upperLeft = previousView.getUint8(index - bytesPerPixel)
      none += filteredMagnitude(value)
      sub += filteredMagnitude((value - left) & 0xff)
      up += filteredMagnitude((value - above) & 0xff)
      const averageResidual = (value - ((left + above) >>> 1)) & 0xff
      average += filteredMagnitude(averageResidual)
      const residual = (value - encodePaeth(left, above, upperLeft)) & 0xff
      output[index + 1] = predictAverage ? averageResidual : residual
      paethScore += filteredMagnitude(residual)
    }
    filter = chooseAdaptiveFilter(none, sub, up, average, paethScore)
    // Keep the residuals already written while scoring when the prediction was right.
    if (filter === (predictAverage ? 3 : 4)) {
      output[0] = filter
      return filter
    }
    if (filter === 4) {
      output[0] = 4
      for (let index = 0; index < end; index += 1) {
        const left = index < bytesPerPixel ? 0 : sourceView.getUint8(index - bytesPerPixel)
        const corner = index < bytesPerPixel ? 0 : previousView.getUint8(index - bytesPerPixel)
        output[index + 1] =
          sourceView.getUint8(index) - encodePaeth(left, previousView.getUint8(index), corner)
      }
      return filter
    }
  }
  applyFilterScanline(source, previous, bytesPerPixel, output, filter)
  return filter
}

class PngEncoder implements ImageEncoder {
  readonly #sink: ChunkWriter
  readonly #deflater: DeflateEncoder
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #channels: number
  readonly #adaptiveFiltering: boolean
  readonly #previousRow: Uint8Array
  #acceleratedFilter: PngRowFilter | undefined
  #lastFilter = 4
  #expectedY = 0
  #finished = false

  constructor(
    sink: ChunkWriter,
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
          const length = (rowBytes + 1) * rows
          scanlines = this.#deflater.inputBuffer?.(length) ?? new Uint8Array(length)
          for (let row = 0; row < rows; row += 1) {
            const sourceOffset = (firstRow + row) * block.stride
            const source = block.data.subarray(sourceOffset, sourceOffset + rowBytes)
            const output = scanlines.subarray(row * (rowBytes + 1), (row + 1) * (rowBytes + 1))
            const filter = filterScanline(
              source,
              this.#previousRow,
              this.#channels,
              output,
              this.#adaptiveFiltering,
              this.#lastFilter === 3,
            )
            if (filter === undefined) output.fill(0)
            this.#lastFilter = filter ?? 0
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

// Holds encoded bytes until the palette encoder knows whether it needs them.
class StagedOutput implements ChunkWriter {
  readonly #target: ChunkWriter
  #chunks: Uint8Array[] = []
  #state: 'staging' | 'passing' | 'discarded' = 'staging'
  #stagedBytes = 0

  constructor(target: ChunkWriter) {
    this.#target = target
  }

  get stagedBytes(): number {
    return this.#stagedBytes
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.#state === 'passing') return this.#target.write(chunk)
    if (this.#state === 'discarded') return
    this.#chunks.push(chunk.slice())
    this.#stagedBytes += chunk.byteLength
  }

  // Deflate output can arrive while earlier chunks flush, so flush until nothing is left.
  async release(): Promise<void> {
    while (this.#chunks.length > 0) {
      const chunks = this.#chunks
      this.#chunks = []
      for (const chunk of chunks) await this.#target.write(chunk)
    }
    this.#state = 'passing'
  }

  discard(): void {
    this.#chunks = []
    this.#state = 'discarded'
  }
}

const paletteSlots = 1024

// Encodes the RGB or RGBA stream as usual and an 8-bit palette-index stream beside it. Both are
// held as compressed bytes until the image needs a 257th color, when the index stream stops and
// the held RGB or RGBA output is released. At the end, the smaller complete file is written.
class PngPaletteEncoder implements ImageEncoder {
  readonly #sink: ChunkWriter
  readonly #staged: StagedOutput
  readonly #truecolor: PngEncoder
  readonly #width: number
  readonly #height: number
  readonly #rgba: boolean
  readonly #ancillary: readonly PngChunk[]
  readonly #keys = new Int32Array(paletteSlots)
  // Palette index plus one; zero marks an empty slot.
  readonly #slots = new Uint16Array(paletteSlots)
  readonly #paletteKeys = new Int32Array(256)
  readonly #runtime: ImageRuntime
  readonly #level: number
  #indexing = true
  // Index rows collect here across blocks, since some decoders write one row at a time.
  #pendingRows: Uint8Array | undefined
  #pendingCount = 0
  // Created after the first 32 rows fit in the palette, so most photos never open a second stream.
  #indexDeflater: DeflateEncoder | undefined
  // One batch compresses while the next is indexed, so decoding does not wait for each batch.
  #indexWrite: Promise<void> | undefined
  #indexChunks: Uint8Array[] = []
  #indexBytes = 0
  #colors = 0

  constructor(
    sink: ChunkWriter,
    staged: StagedOutput,
    truecolor: PngEncoder,
    runtime: ImageRuntime,
    level: number,
    width: number,
    height: number,
    rgba: boolean,
    ancillary: readonly PngChunk[],
  ) {
    this.#sink = sink
    this.#staged = staged
    this.#truecolor = truecolor
    this.#width = width
    this.#height = height
    this.#rgba = rgba
    this.#ancillary = ancillary
    this.#runtime = runtime
    this.#level = level
  }

  async write(block: PixelBlock): Promise<void> {
    // The RGB or RGBA encoder validates the block before its pixels are indexed.
    await this.#truecolor.write(block)
    if (!this.#indexing) return
    const rowBytes = this.#width + 1
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let row = 0; row < block.height; row += 1) {
      this.#pendingRows ??= new Uint8Array(rowBytes * scanlineBlockRows)
      const scanlines = this.#pendingRows
      const output = this.#pendingCount * rowBytes + 1
      const indexed = this.#rgba
        ? this.#indexRgbaRow(view, row * block.stride, scanlines, output)
        : this.#indexRgbRow(view, row * block.stride, scanlines, output)
      if (!indexed) {
        await this.#stopIndexing()
        return
      }
      this.#pendingCount += 1
      if (this.#pendingCount === scanlineBlockRows) await this.#writePendingRows()
    }
  }

  async #writePendingRows(): Promise<void> {
    const scanlines = this.#pendingRows
    if (!scanlines) return
    const length = this.#pendingCount * (this.#width + 1)
    this.#pendingRows = undefined
    this.#pendingCount = 0
    this.#indexDeflater ??= this.#runtime.createDeflateEncoder(
      { level: this.#level, strategy: 'default' },
      async (chunk) => {
        this.#indexChunks.push(chunk.slice())
        this.#indexBytes += chunk.byteLength
      },
    )
    await this.#indexWrite
    const write = this.#indexDeflater.write(scanlines.subarray(0, length))
    // A failed write is reported by the next await of #indexWrite, or dropped on abort.
    write.catch(() => undefined)
    this.#indexWrite = write
  }

  async finish(): Promise<void> {
    await this.#truecolor.finish()
    if (!this.#indexing) return
    await this.#writePendingRows()
    await this.#indexWrite
    this.#indexWrite = undefined
    this.#indexing = false
    const deflater = this.#indexDeflater
    this.#indexDeflater = undefined
    if (!deflater) {
      await this.#staged.release()
      return
    }
    await deflater.finish()

    const colors = this.#colors
    let transparent = 0
    if (this.#rgba) {
      for (let index = 0; index < colors; index += 1) {
        if (((this.#paletteKeys[index] ?? 0) & 0xff) !== 0xff) transparent = index + 1
      }
    }
    let paletteBytes = signature.byteLength + 25 + 12 + colors * 3 + 12
    if (transparent > 0) paletteBytes += 12 + transparent
    for (const chunk of this.#ancillary) paletteBytes += 12 + chunk.data.byteLength
    paletteBytes += this.#indexChunks.length * 12 + this.#indexBytes
    if (paletteBytes >= this.#staged.stagedBytes) {
      this.#indexChunks = []
      await this.#staged.release()
      return
    }

    this.#staged.discard()
    const palette = new Uint8Array(colors * 3)
    const alpha = new Uint8Array(transparent)
    const shift = this.#rgba ? 8 : 0
    for (let index = 0; index < colors; index += 1) {
      const key = this.#paletteKeys[index] ?? 0
      palette[index * 3] = (key >>> (16 + shift)) & 0xff
      palette[index * 3 + 1] = (key >>> (8 + shift)) & 0xff
      palette[index * 3 + 2] = (key >>> shift) & 0xff
      if (index < transparent) alpha[index] = key & 0xff
    }
    await writeHeader(this.#sink, this.#width, this.#height, 8, 3, this.#ancillary)
    await writeChunk(this.#sink, 'PLTE', palette)
    if (transparent > 0) await writeChunk(this.#sink, 'tRNS', alpha)
    const chunks = this.#indexChunks
    this.#indexChunks = []
    for (const chunk of chunks) await writeChunk(this.#sink, 'IDAT', chunk)
    await writeChunk(this.#sink, 'IEND', new Uint8Array())
  }

  async abort(reason: unknown): Promise<void> {
    this.#indexing = false
    this.#pendingRows = undefined
    this.#indexWrite = undefined
    const deflater = this.#indexDeflater
    this.#indexDeflater = undefined
    this.#indexChunks = []
    this.#staged.discard()
    try {
      await this.#truecolor.abort(reason)
    } finally {
      await deflater?.abort(reason)
    }
  }

  async #stopIndexing(): Promise<void> {
    this.#indexing = false
    this.#pendingRows = undefined
    this.#indexWrite = undefined
    const deflater = this.#indexDeflater
    this.#indexDeflater = undefined
    this.#indexChunks = []
    if (deflater) await deflater.abort(new Error('PNG output has more than 256 colors'))
    await this.#staged.release()
  }

  // DataView reads keep the color key a small integer and measured 2.5x faster than byte reads.
  #indexRgbaRow(view: DataView, offset: number, output: Uint8Array, outputOffset: number): boolean {
    let lastKey = view.getInt32(offset)
    let lastIndex = this.#paletteIndex(lastKey)
    if (lastIndex < 0) return false
    output[outputOffset] = lastIndex
    const end = outputOffset + this.#width
    for (let x = outputOffset + 1, index = offset + 4; x < end; x += 1, index += 4) {
      const key = view.getInt32(index)
      if (key !== lastKey) {
        lastIndex = this.#paletteIndex(key)
        if (lastIndex < 0) return false
        lastKey = key
      }
      output[x] = lastIndex
    }
    return true
  }

  #indexRgbRow(view: DataView, offset: number, output: Uint8Array, outputOffset: number): boolean {
    let lastKey = (view.getUint16(offset) << 8) | view.getUint8(offset + 2)
    let lastIndex = this.#paletteIndex(lastKey)
    if (lastIndex < 0) return false
    output[outputOffset] = lastIndex
    const end = outputOffset + this.#width
    for (let x = outputOffset + 1, index = offset + 3; x < end; x += 1, index += 3) {
      const key = (view.getUint16(index) << 8) | view.getUint8(index + 2)
      if (key !== lastKey) {
        lastIndex = this.#paletteIndex(key)
        if (lastIndex < 0) return false
        lastKey = key
      }
      output[x] = lastIndex
    }
    return true
  }

  // Returns the color's palette index, adding it when there is room, or -1 for a 257th color.
  #paletteIndex(key: number): number {
    const keys = this.#keys
    const slots = this.#slots
    let slot = Math.imul(key, 0x9e3779b1) >>> 22
    let entry = slots[slot] ?? 0
    while (entry !== 0) {
      if (keys[slot] === key) return entry - 1
      slot = (slot + 1) & (paletteSlots - 1)
      entry = slots[slot] ?? 0
    }
    const index = this.#colors
    if (index === 256) return -1
    this.#colors = index + 1
    keys[slot] = key
    slots[slot] = index + 1
    this.#paletteKeys[index] = key
    return index
  }
}

export const createPngEncoder = async (
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
  const { level, palette } = encoderOptions(request.options)
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
  const nativeColorSignal =
    request.metadata?.icc === undefined ? nativePngColorSignal(semantics) : undefined
  const ancillary: PngChunk[] = []
  const icc = request.metadata?.icc
  if (icc) {
    const colorSpace = iccColorSpace(icc)
    if (
      colorSpace === 'other' ||
      ((request.pixelFormat === 'gray8' || request.pixelFormat === 'gray16') &&
        colorSpace !== 'gray') ||
      (request.pixelFormat !== 'gray8' && request.pixelFormat !== 'gray16' && colorSpace !== 'rgb')
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
    const compressed = await runtime.deflate(icc, {
      level: 6,
      strategy: 'default',
    })
    const payload = new Uint8Array(name.byteLength + compressed.byteLength)
    payload.set(name)
    payload.set(compressed, name.byteLength)
    ancillary.push({ type: 'iCCP', data: payload })
  } else if (nativeColorSignal !== undefined) {
    ancillary.push(nativeColorSignal)
  }
  if (request.metadata?.exif) ancillary.push({ type: 'eXIf', data: request.metadata.exif })

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
    const indexed = palette && (request.pixelFormat === 'rgb8' || request.pixelFormat === 'rgba8')
    const staged = indexed ? new StagedOutput(sink) : undefined
    const output = staged ?? sink
    const bitDepth = request.pixelFormat.endsWith('16') ? 16 : 8
    const storageChannels =
      request.pixelFormat === 'gray8' || request.pixelFormat === 'gray16'
        ? 1
        : request.pixelFormat === 'rgb8' || request.pixelFormat === 'rgb16'
          ? 3
          : 4
    const colorType = storageChannels === 1 ? 0 : storageChannels === 3 ? 2 : 6
    await writeHeader(output, request.width, request.height, bitDepth, colorType, ancillary)
    const options: DeflateOptions = {
      level,
      strategy: request.pixelFormat === 'rgb8' ? 'rle' : 'default',
    }
    const onData = (chunk: Uint8Array): Promise<void> => writeChunk(output, 'IDAT', chunk)
    const scanlineBytes = 1 + request.width * bytesPerPixel(request.pixelFormat)
    const parallel =
      request.threads === undefined
        ? undefined
        : await runtime.createParallelDeflateEncoder?.(
            options,
            onData,
            request.threads,
            scanlineBytes * request.height,
          )
    const inputBlockBytes =
      !acceleratedFilter || acceleratedFilter.transfersOutput
        ? scanlineBytes * Math.min(scanlineBlockRows, request.height)
        : undefined
    const truecolor = new PngEncoder(
      output,
      parallel ?? runtime.createDeflateEncoder(options, onData, inputBlockBytes),
      request.width,
      request.height,
      request.pixelFormat,
      level !== 0,
      acceleratedFilter,
    )
    if (!staged) return truecolor
    return new PngPaletteEncoder(
      sink,
      staged,
      truecolor,
      runtime,
      level,
      request.width,
      request.height,
      request.pixelFormat === 'rgba8',
      ancillary,
    )
  } catch (error) {
    acceleratedFilter?.release()
    throw error
  }
}
