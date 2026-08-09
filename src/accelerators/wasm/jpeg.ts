import type { ImageCodecAccelerator } from '../../accelerator.ts'
import type { ImageCodec } from '../../codec.ts'
import { invalidInput } from '../../errors.ts'
import type { PixelBlock } from '../../pixel.ts'
import { readExactly } from '../../source.ts'
import {
  accelerateJpegCodec,
  type JpegAccelerationRequest,
  type JpegDecodeAcceleration,
} from '../../codecs/jpeg.ts'

const abiVersion = 3
const components = 3
const blockValues = 64
const huffmanLengths = 16
const huffmanSymbols = 256
const wasmPageBytes = 65_536
const defaultMinimumPixels = 1_000_000
const defaultMaximumInputBytes = 32 * 1024 * 1024
const maximumPlaneBytes = 1_048_576
const maximumOutputBytes = 1_048_576

export interface WasmJpegAcceleratorOptions {
  /** Minimum full-resolution pixel count needed to amortize loading and the input copy. */
  readonly minimumPixels?: number
  /** Largest compressed JPEG copied into the cached WASM instance. */
  readonly maximumInputBytes?: number
}

export type WasmJpegInstanceLoader = () => Promise<WebAssembly.Instance>

type WasmNumberFunction = (...arguments_: readonly number[]) => number

interface DecoderSession {
  readonly memory: WebAssembly.Memory
  readonly next: WasmNumberFunction
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
        const output = recycled.pop() ?? new Uint8Array(byteLength)
        output.set(new Uint8Array(session.memory.buffer, session.outputOffset, byteLength), 0)
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
  const next = numberFunction(instance.exports.jpeg_decoder_next, 'jpeg_decoder_next')
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
        let input: Uint8Array | undefined
        try {
          input =
            jpeg.data ??
            (jpeg.source ? await readExactly(jpeg.source, 0, jpeg.source.size) : undefined)
        } catch (error) {
          inUse = false
          releaseNeeded = false
          throw error
        }
        if (!input || input.byteLength > maximumInputBytes) return undefined
        const xMapOffset = Math.ceil((inputOffset + input.byteLength) / 4) * 4
        const xMapBytes = jpeg.width * components * 10
        const planesOffset = xMapOffset + xMapBytes
        const planeBufferBytes = estimatedPlaneBytes(jpeg)
        const planesBytes = planeBufferBytes * 2
        const outputOffset = planesOffset + planesBytes
        const outputBytes = estimatedOutputBytes(jpeg)
        const requiredBytes = outputOffset + outputBytes
        if (requiredBytes > memoryExport.buffer.byteLength) {
          const pages = Math.ceil((requiredBytes - memoryExport.buffer.byteLength) / wasmPageBytes)
          memoryExport.grow(pages)
        }

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
        new Uint8Array(memoryExport.buffer, inputOffset, input.byteLength).set(input)
        const status = start(
          inputOffset,
          input.byteLength,
          xMapOffset,
          xMapBytes,
          planesOffset,
          planesBytes,
          outputOffset,
          outputBytes,
          jpeg.scanOffset,
          jpeg.width,
          jpeg.height,
          jpeg.maximumHorizontalSampling,
          jpeg.maximumVerticalSampling,
          jpeg.mcusPerLine,
          jpeg.mcusPerColumn,
          jpeg.restartInterval,
        )
        if (status !== 0) return undefined
        releaseNeeded = false
        return Object.freeze({
          memory: memoryExport,
          next,
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

const estimatedPlaneBytes = (jpeg: JpegAccelerationRequest['jpeg']): number =>
  jpeg.components.reduce(
    (total, component) =>
      total +
      jpeg.mcusPerLine * component.horizontalSampling * 8 * (component.verticalSampling * 8 + 2),
    0,
  )

const estimatedOutputBytes = (jpeg: JpegAccelerationRequest['jpeg']): number =>
  jpeg.width * jpeg.maximumVerticalSampling * 8 * 3

const shouldAccelerate = (
  request: JpegAccelerationRequest,
  minimumPixels: number,
  maximumInputBytes: number,
): boolean => {
  const { jpeg, region, scaleDenominator } = request
  const inputBytes = jpeg.data?.byteLength ?? jpeg.source?.size
  if (
    scaleDenominator !== 1 ||
    region.x !== 0 ||
    region.y !== 0 ||
    region.width !== jpeg.width ||
    region.height !== jpeg.height ||
    jpeg.width * jpeg.height < minimumPixels ||
    inputBytes === undefined ||
    inputBytes > maximumInputBytes ||
    jpeg.colorTransform !== 'ycbcr' ||
    jpeg.components.length !== components ||
    jpeg.iccTransform !== undefined
  ) {
    return false
  }
  const planeBytes = estimatedPlaneBytes(jpeg)
  const outputBytes = estimatedOutputBytes(jpeg)
  return planeBytes <= maximumPlaneBytes && outputBytes <= maximumOutputBytes
}

export const createWasmJpegAcceleratorWithLoader = (
  loadInstance: WasmJpegInstanceLoader,
  options: WasmJpegAcceleratorOptions = {},
): ImageCodecAccelerator => {
  const minimumPixels = positiveInteger(
    'minimumPixels',
    options.minimumPixels ?? defaultMinimumPixels,
  )
  const maximumInputBytes = positiveInteger(
    'maximumInputBytes',
    options.maximumInputBytes ?? defaultMaximumInputBytes,
  )
  let poolPromise: Promise<JpegDecoderPool | undefined> | undefined
  const acceleration: JpegDecodeAcceleration = {
    async decode(request: JpegAccelerationRequest): Promise<AsyncIterable<PixelBlock> | undefined> {
      if (!shouldAccelerate(request, minimumPixels, maximumInputBytes)) return undefined
      if (typeof WebAssembly !== 'object') return undefined
      poolPromise ??= loadInstance()
        .then((instance) => createDecoderPool(instance, maximumInputBytes))
        .catch(() => undefined)
      const session = await (await poolPromise)?.prepare(request)
      return session ? createRows(session, request.jpeg.width, request.jpeg.height) : undefined
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
