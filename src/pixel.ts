import type { AbortOptions } from './abort.ts'
import { throwIfAborted } from './abort.ts'
import { invalidInput } from './errors.ts'

export type PixelFormat =
  | 'gray8'
  | 'gray16'
  | 'gray32'
  | 'gray64'
  | 'grayi8'
  | 'grayi16'
  | 'grayf16'
  | 'grayf32'
  | 'grayf64'
  | 'yf32'
  | 'xyzf32'
  | 'rgb8'
  | 'rgba8'
  | 'rgb16'
  | 'rgba16'
  | 'rgb32'
  | 'rgb64'
  | 'rgbi8'
  | 'rgbi16'
  | 'rgbf16'
  | 'rgbf32'
  | 'rgbf64'
  | 'yuv420p8'
  | 'yuv420p10'

export interface PixelSampleDisplayRange {
  readonly black: number
  readonly white: number
}

export interface PixelBlock {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly stride: number
  readonly format: PixelFormat
  readonly data: Uint8Array
  readonly displayRanges?: readonly PixelSampleDisplayRange[]
  readonly release?: () => void
}
export const resumePixelBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  firstOutputRow: number,
): AsyncGenerator<PixelBlock> {
  for await (const block of blocks) {
    const blockEnd = block.y + block.height
    if (blockEnd <= firstOutputRow) {
      block.release?.()
      continue
    }
    if (block.y < firstOutputRow) {
      const skippedRows = firstOutputRow - block.y
      yield {
        ...block,
        y: firstOutputRow,
        height: block.height - skippedRows,
        data: block.data.subarray(skippedRows * block.stride),
      }
      continue
    }
    yield block
  }
}
const normalizedFormat = (format: PixelFormat): PixelFormat => {
  if (
    format === 'gray16' ||
    format === 'gray32' ||
    format === 'gray64' ||
    format === 'grayi8' ||
    format === 'grayi16' ||
    format === 'grayf16' ||
    format === 'grayf32' ||
    format === 'grayf64'
  ) {
    return 'gray8'
  }
  if (
    format === 'rgb16' ||
    format === 'rgb32' ||
    format === 'rgb64' ||
    format === 'rgbi8' ||
    format === 'rgbi16' ||
    format === 'rgbf16' ||
    format === 'rgbf32' ||
    format === 'rgbf64'
  ) {
    return 'rgb8'
  }
  if (format === 'yf32') return 'gray8'
  if (format === 'xyzf32') return 'rgb8'
  if (format === 'rgba16') return 'rgba8'
  return format
}

export const normalizedPixelFormat = (format: PixelFormat): PixelFormat => normalizedFormat(format)

interface NumericFormat {
  readonly channels: 1 | 3 | 4
  readonly bytesPerSample: 1 | 2 | 4 | 8
  readonly read: (data: Uint8Array, view: DataView, offset: number) => number
}

const halfFloat = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

const numericFormat = (format: PixelFormat): NumericFormat | undefined => {
  if (format === 'gray8') {
    return {
      channels: 1,
      bytesPerSample: 1,
      read: (data, _view, offset) => data[offset] ?? 0,
    }
  }
  if (format === 'gray16' || format === 'rgb16' || format === 'rgba16') {
    return {
      channels: format === 'gray16' ? 1 : format === 'rgb16' ? 3 : 4,
      bytesPerSample: 2,
      read: (data, _view, offset) => ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0),
    }
  }
  if (format === 'gray32' || format === 'rgb32') {
    return {
      channels: format === 'gray32' ? 1 : 3,
      bytesPerSample: 4,
      read: (_data, view, offset) => view.getUint32(offset, false),
    }
  }
  if (format === 'gray64' || format === 'rgb64') {
    return {
      channels: format === 'gray64' ? 1 : 3,
      bytesPerSample: 8,
      read: (_data, view, offset) =>
        view.getUint32(offset, false) * 4_294_967_296 + view.getUint32(offset + 4, false),
    }
  }
  const channels = format.startsWith('gray') ? 1 : format.startsWith('rgb') ? 3 : undefined
  if (channels === undefined) return undefined
  if (format === 'grayi8' || format === 'rgbi8') {
    return {
      channels,
      bytesPerSample: 1,
      read: (data, _view, offset) => ((data[offset] ?? 0) << 24) >> 24,
    }
  }
  if (format === 'grayi16' || format === 'rgbi16') {
    return {
      channels,
      bytesPerSample: 2,
      read: (data, _view, offset) =>
        ((((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)) << 16) >> 16,
    }
  }
  if (format === 'grayf16' || format === 'rgbf16') {
    return {
      channels,
      bytesPerSample: 2,
      read: (data, _view, offset) =>
        halfFloat(((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)),
    }
  }
  if (format === 'grayf32' || format === 'rgbf32') {
    return {
      channels,
      bytesPerSample: 4,
      read: (_data, view, offset) => view.getFloat32(offset, false),
    }
  }
  if (format === 'grayf64' || format === 'rgbf64') {
    return {
      channels,
      bytesPerSample: 8,
      read: (_data, view, offset) => view.getFloat64(offset, false),
    }
  }
  return undefined
}

const defaultDisplayRange = (format: PixelFormat): PixelSampleDisplayRange => {
  if (format === 'gray8') return { black: 0, white: 255 }
  if (format === 'gray32' || format === 'rgb32') {
    return { black: 0, white: 4_294_967_295 }
  }
  if (format === 'gray64' || format === 'rgb64') {
    return { black: 0, white: 2 ** 64 }
  }
  if (format === 'grayi8' || format === 'rgbi8') return { black: -128, white: 127 }
  if (format === 'grayi16' || format === 'rgbi16') return { black: -32_768, white: 32_767 }
  if (
    format === 'grayf16' ||
    format === 'rgbf16' ||
    format === 'grayf32' ||
    format === 'rgbf32' ||
    format === 'grayf64' ||
    format === 'rgbf64'
  ) {
    return { black: 0, white: 1 }
  }
  return { black: 0, white: 65_535 }
}

type DisplayRounding = 'nearest' | 'quantum' | 'floor'

const displayByte = (
  value: number,
  range: PixelSampleDisplayRange,
  rounding: DisplayRounding,
): number => {
  if (Number.isNaN(value)) return 0
  const scaled = (value - range.black) / (range.white - range.black)
  if (scaled <= 0) return 0
  if (scaled >= 1) return 255
  if (rounding === 'nearest') return Math.round(scaled * 255)
  if (rounding === 'floor') return Math.floor(scaled * 255)
  return Math.floor(Math.round(scaled * 65_535) / 257)
}

const xyzDisplayByte = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 255
  return Math.floor(256 * Math.sqrt(value))
}

const normalizeYF32Blocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  options: Readonly<AbortOptions>,
): AsyncGenerator<PixelBlock> {
  const bytesPerPixel = 4
  for await (const block of blocks) {
    throwIfAborted(options.signal)
    const rowBytes = block.width * bytesPerPixel
    if (
      block.format !== 'yf32' ||
      block.height < 1 ||
      block.stride < rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + rowBytes ||
      block.displayRanges !== undefined
    ) {
      block.release?.()
      throw invalidInput('CIE Y normalization received an invalid pixel block')
    }
    const outputStride = block.width
    const output = new Uint8Array(outputStride * block.height)
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let row = 0; row < block.height; row += 1) {
      throwIfAborted(options.signal)
      let source = row * block.stride
      let target = row * outputStride
      const end = source + rowBytes
      while (source < end) {
        output[target] = xyzDisplayByte(view.getFloat32(source, false))
        source += bytesPerPixel
        target += 1
      }
    }
    block.release?.()
    yield {
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      stride: outputStride,
      format: 'gray8',
      data: output,
    }
  }
}

const normalizeXyzF32Blocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  options: Readonly<AbortOptions>,
): AsyncGenerator<PixelBlock> {
  const bytesPerPixel = 12
  for await (const block of blocks) {
    throwIfAborted(options.signal)
    const rowBytes = block.width * bytesPerPixel
    if (
      block.format !== 'xyzf32' ||
      block.height < 1 ||
      block.stride < rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + rowBytes ||
      block.displayRanges !== undefined
    ) {
      block.release?.()
      throw invalidInput('XYZ normalization received an invalid pixel block')
    }
    const outputStride = block.width * 3
    const output = new Uint8Array(outputStride * block.height)
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let row = 0; row < block.height; row += 1) {
      throwIfAborted(options.signal)
      let source = row * block.stride
      let target = row * outputStride
      const end = source + rowBytes
      while (source < end) {
        const x = view.getFloat32(source, false)
        const y = view.getFloat32(source + 4, false)
        const z = view.getFloat32(source + 8, false)
        output[target] = xyzDisplayByte(2.69 * x - 1.276 * y - 0.414 * z)
        output[target + 1] = xyzDisplayByte(-1.022 * x + 1.978 * y + 0.044 * z)
        output[target + 2] = xyzDisplayByte(0.061 * x - 0.224 * y + 1.163 * z)
        source += bytesPerPixel
        target += 3
      }
    }
    block.release?.()
    yield {
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      stride: outputStride,
      format: 'rgb8',
      data: output,
    }
  }
}

export interface NormalizePixelOptions extends AbortOptions {
  readonly displayRanges?: readonly PixelSampleDisplayRange[]
}

export const normalizePixelBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  format: PixelFormat,
  options: Readonly<NormalizePixelOptions> = {},
): AsyncGenerator<PixelBlock> {
  const normalized = normalizedFormat(format)
  if (normalized === format && options.displayRanges === undefined) {
    yield* blocks
    return
  }
  if (format === 'yf32') {
    yield* normalizeYF32Blocks(blocks, options)
    return
  }
  if (format === 'xyzf32') {
    yield* normalizeXyzF32Blocks(blocks, options)
    return
  }
  const numeric = numericFormat(format)
  if (!numeric) throw invalidInput(`Normalization does not support ${format} pixels`)
  if (
    options.displayRanges !== undefined &&
    (options.displayRanges.length !== numeric.channels ||
      options.displayRanges.some(
        (range) =>
          !Number.isFinite(range.black) ||
          !Number.isFinite(range.white) ||
          range.black === range.white,
      ))
  ) {
    throw invalidInput('Numeric normalization display ranges are invalid')
  }
  const sourceRowBytes = (width: number): number =>
    width * numeric.channels * numeric.bytesPerSample
  const fallbackRange = defaultDisplayRange(format)
  const rounding: DisplayRounding =
    format === 'gray16' || format === 'rgb16' || format === 'rgba16'
      ? 'nearest'
      : format === 'gray32' || format === 'gray64' || format === 'rgb32' || format === 'rgb64'
        ? 'floor'
        : 'quantum'
  for await (const block of blocks) {
    throwIfAborted(options.signal)
    const rowBytes = sourceRowBytes(block.width)
    if (
      block.format !== format ||
      block.height < 1 ||
      block.stride < rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + rowBytes ||
      (block.displayRanges !== undefined &&
        (block.displayRanges.length !== numeric.channels ||
          block.displayRanges.some(
            (range) =>
              !Number.isFinite(range.black) ||
              !Number.isFinite(range.white) ||
              range.black === range.white,
          )))
    ) {
      block.release?.()
      throw invalidInput('Numeric normalization received an invalid pixel block')
    }
    const outputStride = block.width * numeric.channels
    const output = new Uint8Array(outputStride * block.height)
    const sourceView = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let row = 0; row < block.height; row += 1) {
      throwIfAborted(options.signal)
      let source = row * block.stride
      let target = row * outputStride
      const end = source + rowBytes
      let channel = 0
      while (source < end) {
        const range =
          options.displayRanges?.[channel] ?? block.displayRanges?.[channel] ?? fallbackRange
        output[target] = displayByte(numeric.read(block.data, sourceView, source), range, rounding)
        source += numeric.bytesPerSample
        target += 1
        channel = (channel + 1) % numeric.channels
      }
    }
    block.release?.()
    yield {
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      stride: outputStride,
      format: normalized,
      data: output,
    }
  }
}

const defaultSizeClasses = [65_536, 262_144, 1_048_576, 4_194_304] as const

export class BufferPool {
  readonly #classes: readonly number[]
  readonly #buffers = new Map<number, Uint8Array[]>()
  readonly #maxPerClass: number

  constructor(options: { sizeClasses?: readonly number[]; maxPerClass?: number } = {}) {
    this.#classes = [...(options.sizeClasses ?? defaultSizeClasses)].sort(
      (left, right) => left - right,
    )
    this.#maxPerClass = options.maxPerClass ?? 2
    if (this.#classes.some((size) => !Number.isSafeInteger(size) || size < 1)) {
      throw invalidInput('Buffer pool size classes must be positive safe integers')
    }
    if (!Number.isSafeInteger(this.#maxPerClass) || this.#maxPerClass < 0) {
      throw invalidInput('maxPerClass must be a non-negative safe integer')
    }
  }

  acquire(minimumBytes: number): Uint8Array {
    if (!Number.isSafeInteger(minimumBytes) || minimumBytes < 0) {
      throw invalidInput('Buffer size must be a non-negative safe integer')
    }
    const size = this.#classes.find((candidate) => candidate >= minimumBytes) ?? minimumBytes
    return this.#buffers.get(size)?.pop() ?? new Uint8Array(size)
  }

  release(buffer: Uint8Array): void {
    if (!this.#classes.includes(buffer.byteLength)) return
    const buffers = this.#buffers.get(buffer.byteLength) ?? []
    if (buffers.length >= this.#maxPerClass) return
    buffers.push(buffer)
    this.#buffers.set(buffer.byteLength, buffers)
  }

  clear(): void {
    this.#buffers.clear()
  }
}
