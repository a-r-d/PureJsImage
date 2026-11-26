import type { ImageCodecAccelerator } from '../../accelerator.ts'
import type { DecoderOptions, EncodeRequest, ImageCodec, ImageEncoder } from '../../codec.ts'
import { ascii } from '../../codecs/helpers.ts'
import {
  accelerateJpegCodec,
  type JpegAcceleration,
  type JpegAccelerationRequest,
  type JpegCoefficientAccelerationRequest,
} from '../../codecs/jpeg.ts'
import type { JpegCoefficientRenderImage, JpegIccChunk } from '../../codecs/jpeg-baseline.ts'
import { readUint16 } from '../../codecs/jpeg-codestream.ts'
import { invalidInput } from '../../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../../limits.ts'
import type { PixelBlock, PixelFormat } from '../../pixel.ts'
import type { ImageSink } from '../../sink.ts'
import { type ImageSource, readExactly } from '../../source.ts'

const abiVersion = 6
const components = 3
const blockValues = 64
const huffmanLengths = 16
const huffmanSymbols = 256
const wasmPageBytes = 65_536
const defaultMinimumPixels = 65_536
const defaultMinimumEncodePixels = 65_536
const decoderInputWindowBytes = 128 * 1024
const defaultMaximumInputBytes = 32 * 1024 * 1024
const maximumPlaneBytes = 1_048_576
const maximumOutputBytes = 1_048_576
const encoderAbiVersion = 1
const defaultMaximumEncoderRowBytes = 16 * 1024 * 1024

export interface WasmJpegAcceleratorOptions {
  /** Minimum full-resolution pixel count needed to amortize loading and the input copy. */
  readonly minimumPixels?: number
  /** Largest compressed JPEG eligible for accelerated decoding. */
  readonly maximumInputBytes?: number
  /** Minimum pixel count needed to amortize encoder module loading and row copies. */
  readonly minimumEncodePixels?: number
  /** Largest bounded encoder input MCU row stored in WASM. */
  readonly maximumEncoderRowBytes?: number
}

export type WasmJpegInstanceLoader = () => Promise<WebAssembly.Instance>
export interface WasmJpegInstanceLoaders {
  readonly decoder?: WasmJpegInstanceLoader
  readonly simdDecoder?: WasmJpegInstanceLoader
  readonly encoder?: WasmJpegInstanceLoader
  readonly simdEncoder?: WasmJpegInstanceLoader
}

type WasmNumberFunction = (...arguments_: readonly number[]) => number

interface DecoderSession {
  readonly memory: WebAssembly.Memory
  readonly next: WasmNumberFunction
  readonly colorCorrect?: (data: Uint8Array) => void
  refill(): Promise<void>
  readonly outputHeight: WasmNumberFunction
  readonly outputOffset: number
  readonly outputStride: WasmNumberFunction
  readonly outputY: WasmNumberFunction
  release(): void
}

type DecoderRequest = JpegAccelerationRequest | JpegCoefficientAccelerationRequest

interface JpegDecoderPool {
  acquireProgressive(): { run: RunProgressiveScan; release(): void } | undefined
  prepare(request: DecoderRequest): Promise<DecoderSession | undefined>
}

const numberFunction = (value: unknown, name: string): WasmNumberFunction => {
  if (typeof value !== 'function') throw new Error(`JPEG WASM export ${name} is missing`)
  return (...arguments_: readonly number[]): number => {
    const result: unknown = Reflect.apply(value, undefined, arguments_)
    if (typeof result !== 'number') throw new Error(`JPEG WASM export ${name} returned no number`)
    return result
  }
}

const pointer = (
  value: number,
  bytes: number,
  memory: WebAssembly.Memory,
  name: string,
): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value + bytes > memory.buffer.byteLength) {
    throw new Error(`JPEG WASM ${name} pointer is invalid`)
  }
  return value
}

const positiveInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`JPEG WASM ${name} must be a positive integer`)
  }
  return value
}

const createRows = (
  session: DecoderSession,
  width: number,
  imageHeight: number,
): AsyncIterable<PixelBlock> => ({
  async *[Symbol.asyncIterator](): AsyncGenerator<PixelBlock> {
    const recycled: Uint8Array[] = []
    let expectedY = 0
    try {
      while (true) {
        const status = session.next()
        if (status === 2) {
          await session.refill()
          continue
        }
        if (status === 1) {
          if (expectedY !== imageHeight) throw invalidInput('JPEG WASM output ended early')
          return
        }
        if (status !== 0) throw invalidInput(`JPEG WASM decode failed with status ${status}`)
        const y = session.outputY()
        const height = session.outputHeight()
        const stride = session.outputStride()
        const byteLength = height * stride
        if (
          !Number.isSafeInteger(y) ||
          !Number.isSafeInteger(height) ||
          !Number.isSafeInteger(stride) ||
          y !== expectedY ||
          height < 1 ||
          y + height > imageHeight ||
          stride !== width * 3 ||
          byteLength > maximumOutputBytes ||
          session.outputOffset + byteLength > session.memory.buffer.byteLength
        ) {
          throw invalidInput('JPEG WASM output metadata is invalid')
        }
        expectedY += height
        const previous = recycled.pop()
        const output =
          previous && previous.byteLength >= byteLength ? previous : new Uint8Array(byteLength)
        output.set(new Uint8Array(session.memory.buffer, session.outputOffset, byteLength), 0)
        session.colorCorrect?.(output.subarray(0, byteLength))
        let released = false
        yield {
          x: 0,
          y,
          width,
          height,
          stride,
          format: 'rgb8',
          data: output,
          release: () => {
            if (released) return
            released = true
            recycled.push(output)
          },
        }
      }
    } finally {
      session.release()
    }
  },
})

interface ScanPlane {
  readonly horizontalSampling: number
  readonly verticalSampling: number
  readonly blocksPerLineForMcu: number
  readonly blocksPerLine: number
  readonly blocksPerColumn: number
  readonly coefficients: Int16Array
}

interface ScanSelector {
  readonly component: ScanPlane
  readonly table?: {
    readonly counts: Uint8Array
    readonly symbols: Uint8Array
  }
}

interface ProgressiveScan {
  readonly selected: readonly ScanSelector[]
  readonly start: number
  readonly end: number
  readonly high: number
  readonly low: number
  readonly columns: number
  readonly rows: number
  readonly restartInterval: number
  readonly tolerant: boolean
}

// Headers and entropy share the unread suffix of this bounded source window.
class ProgressiveInput {
  readonly source: ImageSource
  position = 0
  #end = 0
  #bytes: Uint8Array = new Uint8Array()

  constructor(source: ImageSource) {
    this.source = source
  }

  async window(minimum: number): Promise<Uint8Array> {
    if (this.#end - this.position < minimum) {
      const size = Math.min(65_536, this.source.size - this.position)
      if (size < minimum) throw invalidInput('Progressive JPEG input ended early')
      this.#bytes = await readExactly(this.source, this.position, size)
      this.#end = this.position + size
    }
    return this.#bytes.subarray(this.#bytes.length - (this.#end - this.position))
  }

  async read(length: number): Promise<Uint8Array> {
    const bytes = await this.window(length)
    this.position += length
    return bytes.subarray(0, length)
  }
}

type RunProgressiveScan = (input: ProgressiveInput, scan: ProgressiveScan) => Promise<void>

const runProgressiveScan = (
  instance: WebAssembly.Instance,
  memory: WebAssembly.Memory,
  inputOffset: number,
): RunProgressiveScan => {
  const fn = (name: string): WasmNumberFunction => numberFunction(instance.exports[name], name)
  const start = fn('jpeg_progressive_scan')
  const batch = fn('jpeg_progressive_batch')
  const consumed = fn('jpeg_decoder_consumed')
  const hOffset = fn('jpeg_decoder_horizontal_sampling_ptr')()
  const vOffset = fn('jpeg_decoder_vertical_sampling_ptr')()
  const countsOffset = [
    fn('jpeg_decoder_dc_counts_ptr')(),
    fn('jpeg_decoder_ac_counts_ptr')(),
  ] as const
  const symbolsOffset = [
    fn('jpeg_decoder_dc_symbols_ptr')(),
    fn('jpeg_decoder_ac_symbols_ptr')(),
  ] as const
  const rowOffset = inputOffset + 65_536

  return async (input, scan) => {
    const { selected, start: ss, end, high, low, columns, rows, restartInterval, tolerant } = scan
    const ac = ss === 0 ? 0 : 1
    const single = selected.length === 1
    let rowValues = 0
    const planes = selected.map(({ component, table }, c) => {
      new Uint8Array(memory.buffer, hOffset, components)[c] = component.horizontalSampling
      new Uint8Array(memory.buffer, vOffset, components)[c] = component.verticalSampling
      if (table) {
        new Uint8Array(memory.buffer, countsOffset[ac] + c * 16, 16).set(table.counts)
        new Uint8Array(memory.buffer, symbolsOffset[ac] + c * 256, 256).set(table.symbols)
      } else if (ac || high === 0) throw invalidInput('Progressive JPEG Huffman table is missing')
      const lines = single ? 1 : component.verticalSampling
      const length = columns * (single ? 1 : component.horizontalSampling) * lines * 64
      const offset = rowValues
      rowValues += length
      return {
        component,
        stride: component.blocksPerLineForMcu * 64 * lines,
        length,
        offset,
      }
    })
    const required = rowOffset + rowValues * 2
    if (required > memory.buffer.byteLength) {
      memory.grow(Math.ceil((required - memory.buffer.byteLength) / wasmPageBytes))
    }
    if (start(ss, end, high, low, selected.length, restartInterval, tolerant ? 1 : 0) !== 0) {
      throw invalidInput('Invalid progressive JPEG scan')
    }
    const window = new Uint8Array(memory.buffer, inputOffset, 65_536)
    const tile = new Int16Array(memory.buffer, rowOffset, rowValues)
    let offset = 0
    let length = 0
    let final = false
    for (let y = 0; y < rows; y++) {
      for (const { component, stride, length: count, offset: target } of planes) {
        tile.set(component.coefficients.subarray(y * stride, y * stride + count), target)
      }
      let x = 0
      while (x < columns) {
        if (offset === length) {
          const available = Math.min(input.source.size - input.position, 65_536)
          if (available === 0) throw invalidInput('Progressive JPEG input is truncated')
          // Leave enough bytes for the largest stuffed MCU while reusing the
          // source window already fetched for the preceding marker or scan.
          const bytes = await input.window(Math.min(available, 8192))
          window.set(bytes)
          offset = 0
          length = bytes.length
          final = input.position + length === input.source.size
        }
        const count = batch(
          inputOffset + offset,
          length - offset,
          final ? 1 : 0,
          rowOffset,
          rowValues,
          columns,
          x,
        )
        if (!Number.isInteger(count) || count < 0 || count > columns - x) {
          throw invalidInput('Progressive JPEG entropy decoding failed')
        }
        const used = consumed()
        if (!Number.isInteger(used) || used < 0 || used > length - offset) {
          throw invalidInput('Progressive JPEG input position is invalid')
        }
        offset += used
        input.position += used
        x += count
        if (x < columns) {
          if (final || (used === 0 && length - offset === 65_536))
            throw invalidInput('Progressive JPEG scan stalled')
          offset = length
        }
      }
      for (const { component, stride, length: count, offset: target } of planes) {
        component.coefficients.set(tile.subarray(target, target + count), y * stride)
      }
    }
  }
}

interface ProgressivePlane extends ScanPlane {
  readonly id: number
  readonly quantizationId: number
  readonly successive: Int8Array
}

const progressiveLayout = (header: Uint8Array, limits: ImageLimits, minimumPixels: number) => {
  const width = readUint16(header, 3)
  const height = readUint16(header, 1)
  const count = header[5]
  if (
    header[0] !== 8 ||
    (count !== 1 && count !== 3) ||
    header.length !== 6 + 3 * count ||
    width * height < minimumPixels
  )
    return undefined
  validateImageDimensions(width, height, 1, limits)
  const specs = []
  let maximumHorizontalSampling = 1
  let maximumVerticalSampling = 1
  let blocks = 0
  for (let c = 0; c < count; c++) {
    const at = 6 + 3 * c
    const sampling = header[at + 1] ?? 0
    const horizontalSampling = sampling >> 4
    const verticalSampling = sampling & 15
    if (
      horizontalSampling < 1 ||
      horizontalSampling > 4 ||
      verticalSampling < 1 ||
      verticalSampling > 4
    )
      return undefined
    maximumHorizontalSampling = Math.max(maximumHorizontalSampling, horizontalSampling)
    maximumVerticalSampling = Math.max(maximumVerticalSampling, verticalSampling)
    blocks += horizontalSampling * verticalSampling
    specs.push({
      id: header[at] ?? 0,
      quantizationId: header[at + 2] ?? 0,
      horizontalSampling,
      verticalSampling,
    })
  }
  const mcusPerLine = Math.ceil(width / (8 * maximumHorizontalSampling))
  const mcusPerColumn = Math.ceil(height / (8 * maximumVerticalSampling))
  if (blocks > 10 || blocks * mcusPerLine * mcusPerColumn * 128 > limits.maxDecodedBytes)
    return undefined
  return {
    width,
    height,
    maximumHorizontalSampling,
    maximumVerticalSampling,
    mcusPerColumn,
    mcusPerLine,
    specs,
  }
}

const allocateProgressiveFrame = (layout: NonNullable<ReturnType<typeof progressiveLayout>>) => {
  const {
    width,
    height,
    maximumHorizontalSampling,
    maximumVerticalSampling,
    mcusPerColumn,
    mcusPerLine,
    specs,
  } = layout
  const components: ProgressivePlane[] = specs.map((spec) => {
    const blocksPerLineForMcu = spec.horizontalSampling * mcusPerLine
    return {
      ...spec,
      blocksPerLineForMcu,
      blocksPerLine: Math.ceil(
        (Math.ceil(width / 8) * spec.horizontalSampling) / maximumHorizontalSampling,
      ),
      blocksPerColumn: Math.ceil(
        (Math.ceil(height / 8) * spec.verticalSampling) / maximumVerticalSampling,
      ),
      coefficients: new Int16Array(
        blocksPerLineForMcu * mcusPerColumn * spec.verticalSampling * 64,
      ),
      successive: new Int8Array(64).fill(-1),
    }
  })
  return {
    width,
    height,
    maximumHorizontalSampling,
    maximumVerticalSampling,
    mcusPerColumn,
    mcusPerLine,
    components,
  }
}

const zigZag = Uint8Array.of(
  0,
  1,
  8,
  16,
  9,
  2,
  3,
  10,
  17,
  24,
  32,
  25,
  18,
  11,
  4,
  5,
  12,
  19,
  26,
  33,
  40,
  48,
  41,
  34,
  27,
  20,
  13,
  6,
  7,
  14,
  21,
  28,
  35,
  42,
  49,
  56,
  57,
  50,
  43,
  36,
  29,
  22,
  15,
  23,
  30,
  37,
  44,
  51,
  58,
  59,
  52,
  45,
  38,
  31,
  39,
  46,
  53,
  60,
  61,
  54,
  47,
  55,
  62,
  63,
)

const readProgressiveCoefficients = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions>,
  minimumPixels: number,
  acquire: () => Promise<{ run: RunProgressiveScan; release(): void } | undefined>,
): Promise<JpegCoefficientRenderImage | undefined> => {
  const { assembleJpegIccProfile, parseJpegIccChunk } = await import(
    '../../codecs/jpeg-baseline.ts'
  )
  const input = new ProgressiveInput(source)
  if (readUint16(await input.read(2), 0) !== 0xffd8) return undefined
  let frame: ReturnType<typeof allocateProgressiveFrame> | undefined
  let interval = 0
  let scans = 0
  let adobe: number | undefined
  let session: Awaited<ReturnType<typeof acquire>>
  const tables = new Map<number, { counts: Uint8Array; symbols: Uint8Array }>()
  const quantization = new Map<number, Int32Array>()
  const icc: JpegIccChunk[] = []
  try {
    while (input.position < source.size) {
      let marker = (await input.read(1))[0]
      if (marker !== 255) return undefined
      while (marker === 255) marker = (await input.read(1))[0]
      if (marker === undefined || marker === 0 || (marker >= 0xd0 && marker <= 0xd8))
        return undefined
      if (marker === 0xd9) break
      const length = readUint16(await input.read(2), 0)
      if (length < 2) return undefined
      const data = await input.read(length - 2)
      if (marker === 0xc2) {
        if (frame) return undefined
        const layout = progressiveLayout(data, limits, minimumPixels)
        if (!layout) return undefined
        session = await acquire()
        if (!session) return undefined
        frame = allocateProgressiveFrame(layout)
      } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4) {
        return undefined
      } else if (marker === 0xdb) {
        for (let i = 0; i < data.length; ) {
          const spec = data[i++] ?? 0
          const bytes = (spec >>> 4) + 1
          if (bytes > 2 || i + 64 * bytes > data.length) return undefined
          const quants = new Int32Array(64)
          for (const pos of zigZag) {
            quants[pos] = bytes === 1 ? (data[i] ?? 0) : readUint16(data, i)
            i += bytes
          }
          quantization.set(spec & 15, quants)
        }
      } else if (marker === 0xc4) {
        for (let i = 0; i < data.length; ) {
          const spec = data[i++] ?? 0
          if (spec > 31 || i + 16 > data.length) return undefined
          const counts = Uint8Array.from(data.subarray(i, i + 16))
          i += 16
          let total = 0
          let available = 1
          for (const count of counts) {
            available = available * 2 - count
            if (available < 0) return undefined
            total += count
          }
          if (total === 0 || total > 256 || i + total > data.length) return undefined
          tables.set(spec, {
            counts,
            symbols: Uint8Array.from(data.subarray(i, i + total)),
          })
          i += total
        }
      } else if (marker === 0xdd) {
        if (data.length !== 2) return undefined
        interval = readUint16(data, 0)
      } else if (marker === 0xe2) {
        const chunk = parseJpegIccChunk(data, 0, data.length)
        if (chunk && options.preserveIcc !== true)
          icc.push({ ...chunk, data: Uint8Array.from(chunk.data) })
      } else if (marker === 0xee && data.length >= 12 && ascii(data, 0, 6) === 'Adobe\0') {
        adobe = data[11]
      } else if (marker === 0xda) {
        const count = data[0] ?? 0
        scans += 1
        if (
          !frame ||
          count < 1 ||
          count > frame.components.length ||
          data.length !== 4 + 2 * count ||
          scans > 1024
        )
          return undefined
        const start = data[data.length - 3] ?? 0
        const end = data[data.length - 2] ?? 0
        const successive = data[data.length - 1] ?? 0
        const high = successive >> 4
        const low = successive & 15
        if (
          start > end ||
          end > 63 ||
          high > 13 ||
          low > 13 ||
          (high !== 0 && high !== low + 1) ||
          (start === 0 ? end !== 0 : count !== 1)
        )
          return undefined
        const selected: ScanSelector[] = []
        for (let i = 0; i < count; i++) {
          const component = frame.components.find((c) => c.id === data[1 + 2 * i])
          if (!component || selected.some((s) => s.component === component)) return undefined
          for (let k = start; k <= end; k++) {
            if (component.successive[k] !== (high === 0 ? -1 : high)) return undefined
            component.successive[k] = low
          }
          const ids = data[2 + 2 * i] ?? 0
          const table = tables.get(start === 0 ? ids >>> 4 : 16 + (ids & 15))
          selected.push({ component, ...(table ? { table } : {}) })
        }
        if (!session) return undefined
        const single = count === 1 ? selected[0]?.component : undefined
        await session.run(input, {
          selected,
          start,
          end,
          high,
          low,
          columns: single?.blocksPerLine ?? frame.mcusPerLine,
          rows: single?.blocksPerColumn ?? frame.mcusPerColumn,
          restartInterval: interval,
          tolerant: options.tolerantDecoding === true,
        })
      }
      if (input.position === source.size) return undefined
    }
    if (!frame || scans === 0) return undefined
    const gray = frame.components.length === 1
    if (!gray && adobe !== undefined && adobe > 1) return undefined
    const [red, green, blue] = frame.components
    const rgb =
      adobe === 0 || (adobe === undefined && red?.id === 82 && green?.id === 71 && blue?.id === 66)
    const profile = assembleJpegIccProfile(icc)
    let transform: JpegCoefficientRenderImage['iccTransform']
    if (profile) {
      const { parseGrayIccAsRgbTransform, parseJpegIccTransform } = await import(
        '../../codecs/icc.ts'
      )
      transform =
        gray && ascii(profile, 16, 4) === 'GRAY'
          ? parseGrayIccAsRgbTransform(profile)
          : parseJpegIccTransform(profile)
    }
    if (transform && transform.kind !== 'rgb') return undefined
    return {
      ...frame,
      colorTransform: gray ? 'gray' : rgb ? 'rgb' : 'ycbcr',
      ...(transform ? { iccTransform: transform } : {}),
      components: frame.components.map((c) => {
        const table = quantization.get(c.quantizationId)
        if (!table) throw invalidInput('Progressive JPEG quantization table is missing')
        return { ...c, quantization: table }
      }),
    }
  } finally {
    session?.release()
  }
}

const createDecoderPool = (
  instance: WebAssembly.Instance,
  maximumInputBytes: number,
  expectSimd = false,
): JpegDecoderPool => {
  const memoryExport: unknown = instance.exports.memory
  if (!(memoryExport instanceof WebAssembly.Memory)) {
    throw new Error('JPEG WASM memory export is missing')
  }
  const version = numberFunction(
    instance.exports.jpeg_decoder_abi_version,
    'jpeg_decoder_abi_version',
  )
  if (version() !== abiVersion) throw new Error('JPEG WASM ABI version is unsupported')
  const simd = numberFunction(instance.exports.jpeg_decoder_simd, 'jpeg_decoder_simd')
  if (simd() !== (expectSimd ? 1 : 0)) {
    throw new Error('JPEG WASM SIMD contract is unsupported')
  }

  const quantizationPointer = numberFunction(
    instance.exports.jpeg_decoder_quantization_ptr,
    'jpeg_decoder_quantization_ptr',
  )
  const dcCountsPointer = numberFunction(
    instance.exports.jpeg_decoder_dc_counts_ptr,
    'jpeg_decoder_dc_counts_ptr',
  )
  const dcSymbolsPointer = numberFunction(
    instance.exports.jpeg_decoder_dc_symbols_ptr,
    'jpeg_decoder_dc_symbols_ptr',
  )
  const acCountsPointer = numberFunction(
    instance.exports.jpeg_decoder_ac_counts_ptr,
    'jpeg_decoder_ac_counts_ptr',
  )
  const acSymbolsPointer = numberFunction(
    instance.exports.jpeg_decoder_ac_symbols_ptr,
    'jpeg_decoder_ac_symbols_ptr',
  )
  const horizontalSamplingPointer = numberFunction(
    instance.exports.jpeg_decoder_horizontal_sampling_ptr,
    'jpeg_decoder_horizontal_sampling_ptr',
  )
  const verticalSamplingPointer = numberFunction(
    instance.exports.jpeg_decoder_vertical_sampling_ptr,
    'jpeg_decoder_vertical_sampling_ptr',
  )
  const planeCapacity = numberFunction(
    instance.exports.jpeg_decoder_plane_capacity,
    'jpeg_decoder_plane_capacity',
  )
  const outputCapacity = numberFunction(
    instance.exports.jpeg_decoder_output_capacity,
    'jpeg_decoder_output_capacity',
  )
  const start = numberFunction(instance.exports.jpeg_decoder_start, 'jpeg_decoder_start')
  const needsXMap = numberFunction(
    instance.exports.jpeg_decoder_needs_x_map,
    'jpeg_decoder_needs_x_map',
  )
  const crop444 = numberFunction(instance.exports.jpeg_decoder_crop_444, 'jpeg_decoder_crop_444')
  const next = numberFunction(instance.exports.jpeg_decoder_next, 'jpeg_decoder_next')
  const consumedBytes = numberFunction(
    instance.exports.jpeg_decoder_consumed,
    'jpeg_decoder_consumed',
  )
  const refill = numberFunction(instance.exports.jpeg_decoder_refill, 'jpeg_decoder_refill')
  const outputY = numberFunction(instance.exports.jpeg_decoder_output_y, 'jpeg_decoder_output_y')
  const outputHeight = numberFunction(
    instance.exports.jpeg_decoder_output_height,
    'jpeg_decoder_output_height',
  )
  const outputStride = numberFunction(
    instance.exports.jpeg_decoder_output_stride,
    'jpeg_decoder_output_stride',
  )
  if (planeCapacity() !== maximumPlaneBytes || outputCapacity() !== maximumOutputBytes) {
    throw new Error('JPEG WASM scratch capacity is unsupported')
  }

  const initialMemoryBytes = memoryExport.buffer.byteLength
  const inputOffset = initialMemoryBytes
  let inUse = false
  let progressive: RunProgressiveScan | undefined

  return Object.freeze({
    acquireProgressive() {
      if (inUse) return undefined
      progressive ??= runProgressiveScan(instance, memoryExport, inputOffset)
      inUse = true
      return {
        run: progressive,
        release() {
          inUse = false
        },
      }
    },
    async prepare(request: DecoderRequest): Promise<DecoderSession | undefined> {
      if (inUse) return undefined
      inUse = true
      let releaseNeeded = true
      try {
        const { jpeg } = request
        const entropy = 'scanOffset' in jpeg ? jpeg : undefined
        const coefficients = 'scanOffset' in jpeg ? undefined : jpeg.components
        const inputLength = entropy?.data?.byteLength ?? entropy?.source?.size ?? 0
        if (entropy && (inputLength > maximumInputBytes || entropy.scanOffset >= inputLength))
          return undefined
        const { region, scaleDenominator } = request
        const blockSize = 8 / scaleDenominator
        const scaledWidth = Math.ceil(jpeg.width / scaleDenominator)
        const scaledHeight = Math.ceil(jpeg.height / scaleDenominator)
        const cropped = region.width !== scaledWidth || region.height !== scaledHeight
        let readOffset = entropy?.scanOffset ?? 0
        let initialMcu = 0
        let restartIndex = 0
        if (cropped && entropy?.source) {
          const { indexJpegEntropy } = await import('../../codecs/jpeg-source.ts')
          const firstRow = Math.max(0, Math.floor(region.y / blockSize) - 1)
          const firstColumn = Math.max(0, Math.floor(region.x / blockSize) - 1)
          const { restart } = await indexJpegEntropy(
            entropy.source,
            entropy.scanOffset,
            entropy.restartInterval,
            entropy.restartInterval
              ? Math.ceil(
                  (entropy.mcusPerLine * entropy.mcusPerColumn - 1) / entropy.restartInterval,
                )
              : 0,
            firstRow * entropy.mcusPerLine + firstColumn,
            'tolerantDecoding' in request && request.tolerantDecoding,
          )
          if (restart) {
            if (restart.mcu % entropy.mcusPerLine !== 0) return undefined
            initialMcu = restart.mcu
            restartIndex = restart.marker - 0xd0 + 1
            readOffset = restart.offset
          }
        }
        const transform = jpeg.iccTransform
        const applyRgbIcc =
          transform?.kind === 'rgb' ? (await import('../../codecs/icc.ts')).applyRgbIcc : undefined
        const quantizationOffset = pointer(
          quantizationPointer(),
          components * blockValues * Int32Array.BYTES_PER_ELEMENT,
          memoryExport,
          'quantization',
        )
        const dcCountsOffset = pointer(
          dcCountsPointer(),
          components * huffmanLengths,
          memoryExport,
          'DC counts',
        )
        const dcSymbolsOffset = pointer(
          dcSymbolsPointer(),
          components * huffmanSymbols,
          memoryExport,
          'DC symbols',
        )
        const acCountsOffset = pointer(
          acCountsPointer(),
          components * huffmanLengths,
          memoryExport,
          'AC counts',
        )
        const acSymbolsOffset = pointer(
          acSymbolsPointer(),
          components * huffmanSymbols,
          memoryExport,
          'AC symbols',
        )
        const horizontalSamplingOffset = pointer(
          horizontalSamplingPointer(),
          components,
          memoryExport,
          'horizontal sampling',
        )
        const verticalSamplingOffset = pointer(
          verticalSamplingPointer(),
          components,
          memoryExport,
          'vertical sampling',
        )
        const wasmQuantization = new Int32Array(
          memoryExport.buffer,
          quantizationOffset,
          components * blockValues,
        )
        const wasmDcCounts = new Uint8Array(
          memoryExport.buffer,
          dcCountsOffset,
          components * huffmanLengths,
        )
        const wasmDcSymbols = new Uint8Array(
          memoryExport.buffer,
          dcSymbolsOffset,
          components * huffmanSymbols,
        )
        const wasmAcCounts = new Uint8Array(
          memoryExport.buffer,
          acCountsOffset,
          components * huffmanLengths,
        )
        const wasmAcSymbols = new Uint8Array(
          memoryExport.buffer,
          acSymbolsOffset,
          components * huffmanSymbols,
        )
        const wasmHorizontalSampling = new Uint8Array(
          memoryExport.buffer,
          horizontalSamplingOffset,
          components,
        )
        const wasmVerticalSampling = new Uint8Array(
          memoryExport.buffer,
          verticalSamplingOffset,
          components,
        )
        wasmDcSymbols.fill(0)
        wasmAcSymbols.fill(0)
        for (let componentIndex = 0; componentIndex < components; componentIndex += 1) {
          const component = jpeg.components[componentIndex]
          if (!component) return undefined
          wasmQuantization.set(component.quantization, componentIndex * blockValues)
          if ('dcTable' in component) {
            wasmDcCounts.set(component.dcTable.counts, componentIndex * huffmanLengths)
            wasmDcSymbols.set(component.dcTable.symbols, componentIndex * huffmanSymbols)
            wasmAcCounts.set(component.acTable.counts, componentIndex * huffmanLengths)
            wasmAcSymbols.set(component.acTable.symbols, componentIndex * huffmanSymbols)
          }
          wasmHorizontalSampling[componentIndex] = component.horizontalSampling
          wasmVerticalSampling[componentIndex] = component.verticalSampling
        }
        // Match the reference reader's lookahead on crops, which can end before EOI.
        const capacity = coefficients
          ? coefficients.reduce((n, c) => n + c.blocksPerLineForMcu * c.verticalSampling * 128, 0)
          : Math.min(cropped ? 65_536 : decoderInputWindowBytes, inputLength - readOffset)
        const xMapOffset = Math.ceil((inputOffset + capacity) / 4) * 4
        const xMapBytes = needsXMap() ? scaledWidth * components * 10 : 0
        const planesOffset = xMapOffset + xMapBytes
        const planeBufferBytes = estimatedPlaneBytes(jpeg, blockSize)
        const planesBytes = planeBufferBytes * 2
        const outputOffset = planesOffset + planesBytes
        const outputBytes = scaledWidth * jpeg.maximumVerticalSampling * blockSize * 3
        const requiredBytes = outputOffset + outputBytes
        if (requiredBytes > memoryExport.buffer.byteLength) {
          const pages = Math.ceil((requiredBytes - memoryExport.buffer.byteLength) / wasmPageBytes)
          memoryExport.grow(pages)
        }

        const window = new Uint8Array(memoryExport.buffer, inputOffset, capacity)
        // The established full-resolution path issues one source read. Keep its
        // compressed view in JS and transfer only the current window to WASM.
        const sourceStart = readOffset
        const sourceBytes =
          !entropy?.data && scaleDenominator === 1 && entropy?.source
            ? await readExactly(entropy.source, sourceStart, inputLength - sourceStart)
            : undefined
        let valid = 0
        const fillWindow = async (consumed: number): Promise<void> => {
          if (!Number.isSafeInteger(consumed) || consumed < 0 || consumed > valid) {
            throw invalidInput('JPEG WASM input position is invalid')
          }
          const retained = valid - consumed
          const count = Math.min(capacity - retained, inputLength - readOffset)
          if (count < 1) throw invalidInput('JPEG WASM input window cannot advance')
          const bytes =
            entropy?.data?.subarray(readOffset, readOffset + count) ??
            sourceBytes?.subarray(readOffset - sourceStart, readOffset - sourceStart + count) ??
            (entropy?.source ? await readExactly(entropy.source, readOffset, count) : undefined)
          if (!bytes) throw invalidInput('JPEG entropy source is missing')
          window.copyWithin(0, consumed, valid)
          window.set(bytes, retained)
          valid = retained + count
          readOffset += count
        }
        if (entropy) await fillWindow(0)
        let coefficientRow = 0
        const status = start(
          inputOffset,
          capacity,
          xMapOffset,
          xMapBytes,
          planesOffset,
          planesBytes,
          outputOffset,
          outputBytes,
          entropy && readOffset === inputLength ? 1 : 0,
          scaledWidth,
          scaledHeight,
          jpeg.maximumHorizontalSampling,
          jpeg.maximumVerticalSampling,
          jpeg.mcusPerLine,
          jpeg.mcusPerColumn,
          entropy?.restartInterval ?? 0,
          'tolerantDecoding' in request && request.tolerantDecoding ? 1 : 0,
          blockSize,
          coefficients ? 1 : 0,
        )
        if (status !== 0) return undefined
        if (
          cropped &&
          crop444(region.x, region.y, region.width, region.height, initialMcu, restartIndex) !== 0
        )
          return undefined
        releaseNeeded = false
        return Object.freeze({
          memory: memoryExport,
          ...(applyRgbIcc && transform?.kind === 'rgb'
            ? {
                colorCorrect: (data: Uint8Array) => applyRgbIcc(data, transform),
              }
            : {}),
          next,
          async refill(): Promise<void> {
            if (coefficients) {
              if (coefficientRow >= jpeg.mcusPerColumn)
                throw invalidInput('Unexpected JPEG coefficient row request')
              const tile = new Int16Array(window.buffer, window.byteOffset, capacity / 2)
              let target = 0
              for (const c of coefficients) {
                const count = c.blocksPerLineForMcu * c.verticalSampling * 64
                const from = coefficientRow * count
                tile.set(c.coefficients.subarray(from, from + count), target)
                target += count
              }
              coefficientRow++
              if (refill(capacity, 0) !== 0)
                throw invalidInput('JPEG WASM coefficient refill failed')
              return
            }
            await fillWindow(consumedBytes())
            if (refill(valid, readOffset === inputLength ? 1 : 0) !== 0) {
              throw invalidInput('JPEG WASM input refill failed')
            }
          },
          outputHeight,
          outputOffset,
          outputStride,
          outputY,
          release(): void {
            inUse = false
          },
        })
      } catch {
        return undefined
      } finally {
        if (releaseNeeded) inUse = false
      }
    },
  })
}

const estimatedPlaneBytes = (jpeg: DecoderRequest['jpeg'], blockSize: number): number =>
  jpeg.components.reduce(
    (total, component) =>
      total +
      jpeg.mcusPerLine *
        component.horizontalSampling *
        blockSize *
        (component.verticalSampling * blockSize + 2),
    0,
  )

const shouldAccelerate = (
  request: JpegAccelerationRequest,
  minimumPixels: number,
  maximumInputBytes: number,
): boolean => {
  const { jpeg, region, scaleDenominator } = request
  const inputBytes = jpeg.data?.byteLength ?? jpeg.source?.size
  if (
    scaleDenominator === 8 ||
    ((region.width !== Math.ceil(jpeg.width / scaleDenominator) ||
      region.height !== Math.ceil(jpeg.height / scaleDenominator)) &&
      (scaleDenominator === 1 ||
        jpeg.maximumHorizontalSampling !== 1 ||
        jpeg.maximumVerticalSampling !== 1)) ||
    jpeg.width * jpeg.height < minimumPixels ||
    inputBytes === undefined ||
    inputBytes > maximumInputBytes ||
    jpeg.colorTransform !== 'ycbcr' ||
    jpeg.components.length !== components ||
    (jpeg.iccTransform !== undefined &&
      (scaleDenominator === 1 || jpeg.iccTransform.kind !== 'rgb'))
  ) {
    return false
  }
  const blockSize = 8 / scaleDenominator
  const planeBytes = estimatedPlaneBytes(jpeg, blockSize)
  const outputBytes =
    Math.ceil(jpeg.width / scaleDenominator) * jpeg.maximumVerticalSampling * blockSize * 3
  return planeBytes <= maximumPlaneBytes && outputBytes <= maximumOutputBytes
}
interface EncoderConfiguration {
  readonly background: number
  readonly channels: 1 | 3 | 4
  readonly quality: number
  readonly restartInterval: number
  readonly rowHeight: 8 | 16
  readonly sampling: 1 | 2 | 3
}

interface EncoderExports {
  readonly abort: WasmNumberFunction
  readonly finish: WasmNumberFunction
  readonly memory: WebAssembly.Memory
  readonly outputLength: WasmNumberFunction
  readonly start: WasmNumberFunction
  readonly write: WasmNumberFunction
}

interface JpegEncoderPool {
  prepare(
    sink: ImageSink,
    request: EncodeRequest,
    configuration: EncoderConfiguration,
  ): Promise<ImageEncoder | undefined>
}

interface RawEncoderOptions {
  readonly background?: unknown
  readonly chromaSubsampling?: unknown
  readonly progressive?: unknown
  readonly quality?: unknown
  readonly restartInterval?: unknown
}

const encoderChannels = (format: PixelFormat): 1 | 3 | 4 | undefined => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  return undefined
}

const encoderConfiguration = (request: EncodeRequest): EncoderConfiguration | undefined => {
  if (
    request.metadata !== undefined ||
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1 ||
    request.width > 65_535 ||
    request.height > 65_535 ||
    typeof request.options !== 'object' ||
    request.options === null
  ) {
    return undefined
  }
  const channels = encoderChannels(request.pixelFormat)
  if (!channels) return undefined
  const rawOptions = request.options as RawEncoderOptions
  const quality = rawOptions.quality ?? 80
  const progressive = rawOptions.progressive ?? false
  const chromaSubsampling = rawOptions.chromaSubsampling ?? '420'
  const restartInterval = rawOptions.restartInterval ?? 0
  const background = rawOptions.background
  if (
    typeof quality !== 'number' ||
    !Number.isInteger(quality) ||
    quality < 1 ||
    quality > 100 ||
    progressive !== false ||
    (chromaSubsampling !== '420' && chromaSubsampling !== '422' && chromaSubsampling !== '444') ||
    typeof restartInterval !== 'number' ||
    !Number.isInteger(restartInterval) ||
    restartInterval < 0 ||
    restartInterval > 65_535
  ) {
    return undefined
  }
  let backgroundValue = 0xff_ff_ff
  if (background !== undefined && background !== 'transparent') {
    if (typeof background !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(background)) {
      return undefined
    }
    backgroundValue = Number.parseInt(background.slice(1, 7), 16)
  }
  const sampling = chromaSubsampling === '420' ? 1 : chromaSubsampling === '422' ? 2 : 3
  return {
    background: backgroundValue,
    channels,
    quality,
    restartInterval,
    rowHeight: channels === 1 || chromaSubsampling !== '420' ? 8 : 16,
    sampling,
  }
}

class WasmJpegEncoder implements ImageEncoder {
  readonly #configuration: EncoderConfiguration
  readonly #exports: EncoderExports
  readonly #height: number
  readonly #inputOffset: number
  readonly #inputRows: Uint8Array
  readonly #outputCapacity: number
  readonly #outputOffset: number
  readonly #pixelFormat: PixelFormat
  readonly #release: () => void
  readonly #sink: ImageSink
  readonly #width: number
  #bufferedRows = 0
  #finished = false
  #receivedRows = 0

  constructor(
    exports_: EncoderExports,
    sink: ImageSink,
    request: EncodeRequest,
    configuration: EncoderConfiguration,
    inputOffset: number,
    outputOffset: number,
    outputCapacity: number,
    release: () => void,
  ) {
    this.#configuration = configuration
    this.#exports = exports_
    this.#height = request.height
    this.#inputOffset = inputOffset
    this.#inputRows = new Uint8Array(
      exports_.memory.buffer,
      inputOffset,
      request.width * configuration.rowHeight * configuration.channels,
    )
    this.#outputCapacity = outputCapacity
    this.#outputOffset = outputOffset
    this.#pixelFormat = request.pixelFormat
    this.#release = release
    this.#sink = sink
    this.#width = request.width
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished JPEG encoder')
    if (
      block.x !== 0 ||
      block.y !== this.#receivedRows ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.y + block.height > this.#height ||
      block.format !== this.#pixelFormat
    ) {
      throw invalidInput('JPEG encoder requires ordered, full-width pixel blocks')
    }
    const sourceRowBytes = this.#width * this.#configuration.channels
    if (
      block.stride < sourceRowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + sourceRowBytes
    ) {
      throw invalidInput('JPEG encoder pixel block data is truncated')
    }
    try {
      for (let row = 0; row < block.height; row += 1) {
        this.#inputRows.set(
          block.data.subarray(row * block.stride, row * block.stride + sourceRowBytes),
          this.#bufferedRows * sourceRowBytes,
        )
        this.#bufferedRows += 1
        this.#receivedRows += 1
        if (this.#bufferedRows === this.#configuration.rowHeight) await this.#encodeRows()
      }
    } catch (error) {
      this.#abort()
      throw error
    }
  }

  async #encodeRows(): Promise<void> {
    const status = this.#exports.write(
      this.#inputOffset,
      this.#inputRows.byteLength,
      this.#width * this.#configuration.channels,
      this.#configuration.rowHeight,
    )
    if (status !== 0) throw new Error(`JPEG WASM encoder write failed with status ${status}`)
    await this.#writeOutput()
    this.#bufferedRows = 0
  }

  async #writeOutput(): Promise<void> {
    const length = this.#exports.outputLength()
    if (!Number.isInteger(length) || length < 0 || length > this.#outputCapacity) {
      throw new Error('JPEG WASM encoder returned an invalid output length')
    }
    if (length === 0) return
    await this.#sink.write(
      new Uint8Array(this.#exports.memory.buffer, this.#outputOffset, length).slice(),
    )
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('JPEG encoder is already finished')
    this.#finished = true
    try {
      if (this.#receivedRows !== this.#height) {
        throw invalidInput(`JPEG encoder received ${this.#receivedRows} of ${this.#height} rows`)
      }
      if (this.#bufferedRows > 0) {
        const rowBytes = this.#width * this.#configuration.channels
        const lastOffset = (this.#bufferedRows - 1) * rowBytes
        while (this.#bufferedRows < this.#configuration.rowHeight) {
          this.#inputRows.copyWithin(
            this.#bufferedRows * rowBytes,
            lastOffset,
            lastOffset + rowBytes,
          )
          this.#bufferedRows += 1
        }
        await this.#encodeRows()
      }
      const status = this.#exports.finish()
      if (status !== 1) throw new Error(`JPEG WASM encoder finish failed with status ${status}`)
      await this.#writeOutput()
      this.#release()
    } catch (error) {
      this.#abort()
      throw error
    }
  }

  async abort(): Promise<void> {
    this.#abort()
  }

  #abort(): void {
    if (!this.#finished) this.#finished = true
    this.#exports.abort()
    this.#release()
  }
}

const createEncoderPool = (
  instance: WebAssembly.Instance,
  expectSimd: boolean,
): JpegEncoderPool => {
  const memoryExport: unknown = instance.exports.memory
  if (!(memoryExport instanceof WebAssembly.Memory)) {
    throw new Error('JPEG encoder WASM memory export is missing')
  }
  const version = numberFunction(
    instance.exports.jpeg_encoder_abi_version,
    'jpeg_encoder_abi_version',
  )
  const simd = numberFunction(instance.exports.jpeg_encoder_simd, 'jpeg_encoder_simd')
  if (version() !== encoderAbiVersion || simd() !== (expectSimd ? 1 : 0)) {
    throw new Error('JPEG encoder WASM ABI is unsupported')
  }
  const exports_: EncoderExports = Object.freeze({
    abort: numberFunction(instance.exports.jpeg_encoder_abort, 'jpeg_encoder_abort'),
    finish: numberFunction(instance.exports.jpeg_encoder_finish, 'jpeg_encoder_finish'),
    memory: memoryExport,
    outputLength: numberFunction(
      instance.exports.jpeg_encoder_output_length,
      'jpeg_encoder_output_length',
    ),
    start: numberFunction(instance.exports.jpeg_encoder_start, 'jpeg_encoder_start'),
    write: numberFunction(instance.exports.jpeg_encoder_write, 'jpeg_encoder_write'),
  })
  const initialMemoryBytes = memoryExport.buffer.byteLength
  let inUse = false
  return Object.freeze({
    async prepare(
      sink: ImageSink,
      request: EncodeRequest,
      configuration: EncoderConfiguration,
    ): Promise<ImageEncoder | undefined> {
      if (inUse) return undefined
      inUse = true
      let releaseNeeded = true
      let outputCommitted = false
      try {
        const inputBytes = request.width * configuration.rowHeight * configuration.channels
        const inputOffset = initialMemoryBytes
        const outputOffset = inputOffset + inputBytes
        const outputCapacity = request.width * configuration.rowHeight * 12 + 16_384
        const requiredBytes = outputOffset + outputCapacity
        if (!Number.isSafeInteger(requiredBytes)) return undefined
        if (requiredBytes > memoryExport.buffer.byteLength) {
          memoryExport.grow(
            Math.ceil((requiredBytes - memoryExport.buffer.byteLength) / wasmPageBytes),
          )
        }
        pointer(inputOffset, inputBytes, memoryExport, 'encoder input')
        pointer(outputOffset, outputCapacity, memoryExport, 'encoder output')
        const status = exports_.start(
          request.width,
          request.height,
          configuration.channels,
          configuration.quality,
          configuration.sampling,
          configuration.restartInterval,
          configuration.background,
          outputOffset,
          outputCapacity,
        )
        if (status !== 0) return undefined
        const headerLength = exports_.outputLength()
        if (!Number.isInteger(headerLength) || headerLength < 1 || headerLength > outputCapacity) {
          return undefined
        }
        outputCommitted = true
        await sink.write(new Uint8Array(memoryExport.buffer, outputOffset, headerLength).slice())
        const release = (): void => {
          if (!inUse) return
          inUse = false
        }
        const encoder = new WasmJpegEncoder(
          exports_,
          sink,
          request,
          configuration,
          inputOffset,
          outputOffset,
          outputCapacity,
          release,
        )
        releaseNeeded = false
        return encoder
      } catch (error) {
        if (outputCommitted) {
          exports_.abort()
          throw error
        }
        return undefined
      } finally {
        if (releaseNeeded) inUse = false
      }
    },
  })
}

const shouldAccelerateEncode = (
  request: EncodeRequest,
  configuration: EncoderConfiguration,
  minimumPixels: number,
  maximumRowBytes: number,
): boolean =>
  request.width * request.height >= minimumPixels &&
  request.width * configuration.rowHeight * configuration.channels <= maximumRowBytes

export const createWasmJpegAcceleratorWithLoaders = (
  loaders: WasmJpegInstanceLoaders,
  options: WasmJpegAcceleratorOptions = {},
): ImageCodecAccelerator => {
  const minimumPixels = positiveInteger(
    'minimumPixels',
    options.minimumPixels ?? defaultMinimumPixels,
  )
  const minimumEncodePixels = positiveInteger(
    'minimumEncodePixels',
    options.minimumEncodePixels ?? defaultMinimumEncodePixels,
  )
  const maximumInputBytes = positiveInteger(
    'maximumInputBytes',
    options.maximumInputBytes ?? defaultMaximumInputBytes,
  )
  const maximumEncoderRowBytes = positiveInteger(
    'maximumEncoderRowBytes',
    options.maximumEncoderRowBytes ?? defaultMaximumEncoderRowBytes,
  )
  let decoderPoolPromise: Promise<JpegDecoderPool | undefined> | undefined
  let encoderPoolPromise: Promise<JpegEncoderPool | undefined> | undefined
  const decoderPool = (): Promise<JpegDecoderPool | undefined> => {
    decoderPoolPromise ??= (async (): Promise<JpegDecoderPool | undefined> => {
      if (loaders.simdDecoder) {
        try {
          return createDecoderPool(await loaders.simdDecoder(), maximumInputBytes, true)
        } catch {
          if (!loaders.decoder) return undefined
        }
      }
      if (!loaders.decoder) return undefined
      try {
        return createDecoderPool(await loaders.decoder(), maximumInputBytes)
      } catch {
        return undefined
      }
    })()
    return decoderPoolPromise
  }
  const acceleration: JpegAcceleration = {
    async renderCoefficients(request) {
      const { jpeg, region, scaleDenominator: scale } = request
      const size = 8 / scale
      if (
        jpeg.colorTransform !== 'ycbcr' ||
        jpeg.components.length !== components ||
        scale === 8 ||
        region.width !== Math.ceil(jpeg.width / scale) ||
        region.height !== Math.ceil(jpeg.height / scale) ||
        estimatedPlaneBytes(jpeg, size) > maximumPlaneBytes ||
        region.width * jpeg.maximumVerticalSampling * size * 3 > maximumOutputBytes
      )
        return undefined
      const session = await (await decoderPool())?.prepare(request)
      return session ? createRows(session, region.width, region.height) : undefined
    },
    async progressiveCoefficients(source, limits, options) {
      if (
        (!loaders.decoder && !loaders.simdDecoder) ||
        typeof WebAssembly !== 'object' ||
        source.size > maximumInputBytes
      )
        return undefined
      return readProgressiveCoefficients(source, limits, options, minimumPixels, async () =>
        (await decoderPool())?.acquireProgressive(),
      )
    },
    async decode(request: JpegAccelerationRequest): Promise<AsyncIterable<PixelBlock> | undefined> {
      if (
        (!loaders.decoder && !loaders.simdDecoder) ||
        !shouldAccelerate(request, minimumPixels, maximumInputBytes) ||
        typeof WebAssembly !== 'object'
      ) {
        return undefined
      }
      const session = await (await decoderPool())?.prepare(request)
      return session ? createRows(session, request.region.width, request.region.height) : undefined
    },
    async encode(sink: ImageSink, request: EncodeRequest): Promise<ImageEncoder | undefined> {
      const configuration = encoderConfiguration(request)
      if (
        !configuration ||
        (!loaders.encoder && !loaders.simdEncoder) ||
        !shouldAccelerateEncode(
          request,
          configuration,
          minimumEncodePixels,
          maximumEncoderRowBytes,
        ) ||
        typeof WebAssembly !== 'object'
      ) {
        return undefined
      }
      encoderPoolPromise ??= (async (): Promise<JpegEncoderPool | undefined> => {
        if (loaders.simdEncoder) {
          try {
            return createEncoderPool(await loaders.simdEncoder(), true)
          } catch {}
        }
        if (!loaders.encoder) return undefined
        try {
          return createEncoderPool(await loaders.encoder(), false)
        } catch {
          return undefined
        }
      })()
      return (await encoderPoolPromise)?.prepare(sink, request, configuration)
    },
  }
  return Object.freeze({
    format: 'jpeg',
    id: 'rust-wasm-jpeg',
    kind: 'wasm',
    accelerate(reference: ImageCodec): ImageCodec {
      return accelerateJpegCodec(reference, acceleration)
    },
  })
}

export const createWasmJpegAcceleratorWithLoader = (
  loadInstance: WasmJpegInstanceLoader,
  options: WasmJpegAcceleratorOptions = {},
): ImageCodecAccelerator => createWasmJpegAcceleratorWithLoaders({ decoder: loadInstance }, options)
