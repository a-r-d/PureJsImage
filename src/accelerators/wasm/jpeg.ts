import type { ImageCodecAccelerator } from '../../accelerator.ts'
import type { EncodeRequest, ImageCodec, ImageEncoder } from '../../codec.ts'
import { invalidInput } from '../../errors.ts'
import type { PixelBlock, PixelFormat } from '../../pixel.ts'
import type { ImageSink } from '../../sink.ts'
import { readExactly } from '../../source.ts'
import {
  accelerateJpegCodec,
  type JpegAccelerationRequest,
  type JpegAcceleration,
} from '../../codecs/jpeg.ts'

const abiVersion = 5
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

interface JpegDecoderPool {
  prepare(request: JpegAccelerationRequest): Promise<DecoderSession | undefined>
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

  return Object.freeze({
    async prepare(request: JpegAccelerationRequest): Promise<DecoderSession | undefined> {
      if (inUse) return undefined
      inUse = true
      let releaseNeeded = true
      try {
        const { jpeg } = request
        const inputLength = jpeg.data?.byteLength ?? jpeg.source?.size
        if (
          inputLength === undefined ||
          inputLength > maximumInputBytes ||
          jpeg.scanOffset >= inputLength
        ) {
          return undefined
        }
        const { region, scaleDenominator } = request
        const blockSize = 8 / scaleDenominator
        const scaledWidth = Math.ceil(jpeg.width / scaleDenominator)
        const scaledHeight = Math.ceil(jpeg.height / scaleDenominator)
        const cropped = region.width !== scaledWidth || region.height !== scaledHeight
        let readOffset = jpeg.scanOffset
        let initialMcu = 0
        let restartIndex = 0
        if (cropped && jpeg.source) {
          const { indexJpegEntropy } = await import('../../codecs/jpeg-source.ts')
          const firstRow = Math.max(0, Math.floor(region.y / blockSize) - 1)
          const firstColumn = Math.max(0, Math.floor(region.x / blockSize) - 1)
          const { restart } = await indexJpegEntropy(
            jpeg.source,
            jpeg.scanOffset,
            jpeg.restartInterval,
            jpeg.restartInterval
              ? Math.ceil((jpeg.mcusPerLine * jpeg.mcusPerColumn - 1) / jpeg.restartInterval)
              : 0,
            firstRow * jpeg.mcusPerLine + firstColumn,
            request.tolerantDecoding,
          )
          if (restart) {
            if (restart.mcu % jpeg.mcusPerLine !== 0) return undefined
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
          wasmDcCounts.set(component.dcTable.counts, componentIndex * huffmanLengths)
          wasmDcSymbols.set(component.dcTable.symbols, componentIndex * huffmanSymbols)
          wasmAcCounts.set(component.acTable.counts, componentIndex * huffmanLengths)
          wasmAcSymbols.set(component.acTable.symbols, componentIndex * huffmanSymbols)
          wasmHorizontalSampling[componentIndex] = component.horizontalSampling
          wasmVerticalSampling[componentIndex] = component.verticalSampling
        }
        // Match the reference reader's lookahead on crops, which can end before EOI.
        const capacity = Math.min(
          cropped ? 65_536 : decoderInputWindowBytes,
          inputLength - readOffset,
        )
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
          !jpeg.data && scaleDenominator === 1 && jpeg.source
            ? await readExactly(jpeg.source, sourceStart, inputLength - sourceStart)
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
            jpeg.data?.subarray(readOffset, readOffset + count) ??
            sourceBytes?.subarray(readOffset - sourceStart, readOffset - sourceStart + count) ??
            (jpeg.source ? await readExactly(jpeg.source, readOffset, count) : undefined)
          if (!bytes) throw invalidInput('JPEG entropy source is missing')
          window.copyWithin(0, consumed, valid)
          window.set(bytes, retained)
          valid = retained + count
          readOffset += count
        }
        await fillWindow(0)
        const status = start(
          inputOffset,
          capacity,
          xMapOffset,
          xMapBytes,
          planesOffset,
          planesBytes,
          outputOffset,
          outputBytes,
          readOffset === inputLength ? 1 : 0,
          scaledWidth,
          scaledHeight,
          jpeg.maximumHorizontalSampling,
          jpeg.maximumVerticalSampling,
          jpeg.mcusPerLine,
          jpeg.mcusPerColumn,
          jpeg.restartInterval,
          request.tolerantDecoding ? 1 : 0,
          blockSize,
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
            ? { colorCorrect: (data: Uint8Array) => applyRgbIcc(data, transform) }
            : {}),
          next,
          async refill(): Promise<void> {
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

const estimatedPlaneBytes = (jpeg: JpegAccelerationRequest['jpeg'], blockSize: number): number =>
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
  const acceleration: JpegAcceleration = {
    async decode(request: JpegAccelerationRequest): Promise<AsyncIterable<PixelBlock> | undefined> {
      if (
        (!loaders.decoder && !loaders.simdDecoder) ||
        !shouldAccelerate(request, minimumPixels, maximumInputBytes) ||
        typeof WebAssembly !== 'object'
      ) {
        return undefined
      }
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
      const session = await (await decoderPoolPromise)?.prepare(request)
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
