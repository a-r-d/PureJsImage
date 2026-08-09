import type { ImageCodecAccelerator } from '../../accelerator.ts'
import type { ImageCodec } from '../../codec.ts'
import { invalidInput, truncatedInput } from '../../errors.ts'
import type { PixelBlock, PixelFormat } from '../../pixel.ts'
import {
  acceleratePngCodec,
  type PngAcceleration,
  type PngAccelerationRequest,
  type PngEncodeAccelerationRequest,
  type PngRowFilter,
} from '../../codecs/png.ts'

const abiVersion = 1
const wasmPageBytes = 65_536
const batchRows = 32
const defaultMinimumPixels = 65_536
const defaultMinimumEncodePixels = 65_536
const defaultMaximumRowBytes = 16 * 1024 * 1024

export interface WasmPngAcceleratorOptions {
  /** Minimum full-image pixel count needed to amortize module loading and row copies. */
  readonly minimumPixels?: number
  /** Minimum encode pixel count needed to amortize module loading and row copies. */
  readonly minimumEncodePixels?: number
  /** Largest unfiltered row accepted by the cached WASM instances. */
  readonly maximumRowBytes?: number
}

export type WasmPngInstanceLoader = () => Promise<WebAssembly.Instance>

export interface WasmPngInstanceLoaders {
  readonly decoder?: WasmPngInstanceLoader
  readonly simdDecoder?: WasmPngInstanceLoader
  readonly encoder?: WasmPngInstanceLoader
  readonly simdEncoder?: WasmPngInstanceLoader
}

type WasmNumberFunction = (...arguments_: readonly number[]) => number

interface MemoryLayout {
  readonly input: number
  readonly inputBytes: number
  readonly output: number
  readonly outputBytes: number
  readonly previous: number
  readonly requiredBytes: number
}

interface PngKernelLease {
  unfilter(filtered: Uint8Array, rowBytes: number, bytesPerPixel: number, rows: number): Uint8Array
  filter(
    data: Uint8Array,
    stride: number,
    rowBytes: number,
    bytesPerPixel: number,
    rows: number,
  ): Uint8Array
  release(): void
}

interface PngKernelPool {
  prepare(rowBytes: number): PngKernelLease | undefined
}

const numberFunction = (value: unknown, name: string): WasmNumberFunction => {
  if (typeof value !== 'function') throw new Error(`PNG WASM export ${name} is missing`)
  return (...arguments_: readonly number[]): number => {
    const result: unknown = Reflect.apply(value, undefined, arguments_)
    if (typeof result !== 'number') throw new Error(`PNG WASM export ${name} returned no number`)
    return result
  }
}

const positiveInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PNG WASM ${name} must be a positive integer`)
  }
  return value
}

const aligned = (value: number): number => Math.ceil(value / 8) * 8

const createKernelPool = (instance: WebAssembly.Instance, expectSimd: boolean): PngKernelPool => {
  const memoryExport = instance.exports.memory
  if (!(memoryExport instanceof WebAssembly.Memory)) {
    throw new Error('PNG WASM memory export is missing')
  }
  const version = numberFunction(instance.exports.png_codec_abi_version, 'png_codec_abi_version')
  const simd = numberFunction(instance.exports.png_codec_simd, 'png_codec_simd')
  const unfilterRows = numberFunction(instance.exports.png_unfilter_rows, 'png_unfilter_rows')
  const filterRows = numberFunction(instance.exports.png_filter_rows, 'png_filter_rows')
  if (version() !== abiVersion) throw new Error('PNG WASM ABI version is unsupported')
  if (simd() !== (expectSimd ? 1 : 0))
    throw new Error('PNG WASM SIMD mode does not match its loader')

  const memory = memoryExport
  const base = aligned(memory.buffer.byteLength)
  let inUse = false

  const layout = (rowBytes: number, decode: boolean): MemoryLayout => {
    const inputBytes = (rowBytes + (decode ? 1 : 0)) * batchRows
    const outputBytes = (rowBytes + (decode ? 0 : 1)) * batchRows
    const input = base
    const output = aligned(input + inputBytes)
    const previous = aligned(output + outputBytes)
    const requiredBytes = previous + rowBytes
    if (
      !Number.isSafeInteger(requiredBytes) ||
      requiredBytes > 0xffff_ffff ||
      inputBytes < 1 ||
      outputBytes < 1
    ) {
      throw new Error('PNG WASM row storage exceeds linear-memory addressing')
    }
    return { input, inputBytes, output, outputBytes, previous, requiredBytes }
  }

  const ensureMemory = (target: MemoryLayout): void => {
    const missing = target.requiredBytes - memory.buffer.byteLength
    if (missing > 0) memory.grow(Math.ceil(missing / wasmPageBytes))
  }

  return Object.freeze({
    prepare(rowBytes: number): PngKernelLease | undefined {
      if (inUse) return undefined
      inUse = true
      let released = false
      try {
        const decodeLayout = layout(rowBytes, true)
        const encodeLayout = layout(rowBytes, false)
        ensureMemory(
          decodeLayout.requiredBytes >= encodeLayout.requiredBytes ? decodeLayout : encodeLayout,
        )
        new Uint8Array(memory.buffer, decodeLayout.previous, rowBytes).fill(0)

        const release = (): void => {
          if (released) return
          released = true
          inUse = false
        }

        return Object.freeze({
          unfilter(
            filtered: Uint8Array,
            requestedRowBytes: number,
            bytesPerPixel: number,
            rows: number,
          ): Uint8Array {
            if (
              released ||
              requestedRowBytes !== rowBytes ||
              rows < 1 ||
              rows > batchRows ||
              filtered.byteLength !== (rowBytes + 1) * rows
            ) {
              throw invalidInput('PNG WASM received invalid filtered scanline bounds')
            }
            const inputBytes = filtered.byteLength
            const outputBytes = rowBytes * rows
            const memoryBytes = new Uint8Array(memory.buffer)
            memoryBytes.set(filtered, decodeLayout.input)
            const status = unfilterRows(
              decodeLayout.input,
              inputBytes,
              rowBytes + 1,
              decodeLayout.output,
              outputBytes,
              rowBytes,
              decodeLayout.previous,
              rowBytes,
              rowBytes,
              bytesPerPixel,
              rows,
            )
            if (status === 2) throw invalidInput('PNG filter is invalid')
            if (status !== 0) throw invalidInput('PNG WASM rejected the filtered scanline batch')
            return Uint8Array.from(new Uint8Array(memory.buffer, decodeLayout.output, outputBytes))
          },
          filter(
            data: Uint8Array,
            stride: number,
            requestedRowBytes: number,
            bytesPerPixel: number,
            rows: number,
          ): Uint8Array {
            if (
              released ||
              requestedRowBytes !== rowBytes ||
              rows < 1 ||
              rows > batchRows ||
              stride < rowBytes ||
              data.byteLength < stride * (rows - 1) + rowBytes
            ) {
              throw invalidInput('PNG WASM received invalid encoder row bounds')
            }
            const inputBytes = rowBytes * rows
            const outputBytes = (rowBytes + 1) * rows
            const memoryBytes = new Uint8Array(memory.buffer)
            for (let row = 0; row < rows; row += 1) {
              memoryBytes.set(
                data.subarray(row * stride, row * stride + rowBytes),
                encodeLayout.input + row * rowBytes,
              )
            }
            const status = filterRows(
              encodeLayout.input,
              inputBytes,
              rowBytes,
              encodeLayout.output,
              outputBytes,
              rowBytes + 1,
              encodeLayout.previous,
              rowBytes,
              rowBytes,
              bytesPerPixel,
              rows,
              1,
            )
            if (status !== 0) throw invalidInput('PNG WASM rejected the encoder row batch')
            return Uint8Array.from(new Uint8Array(memory.buffer, encodeLayout.output, outputBytes))
          },
          release,
        })
      } catch {
        inUse = false
        return undefined
      }
    },
  })
}

const formatChannels = (format: PixelFormat): 1 | 3 | 4 | undefined => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  return undefined
}

const shouldAccelerateDecode = (
  request: PngAccelerationRequest,
  minimumPixels: number,
  maximumRowBytes: number,
): boolean => {
  const channels = formatChannels(request.pixelFormat)
  return (
    channels !== undefined &&
    BigInt(request.width) * BigInt(request.height) >= BigInt(minimumPixels) &&
    request.region.x === 0 &&
    request.region.y === 0 &&
    request.region.width === request.width &&
    request.region.height === request.height &&
    request.bitDepth === 8 &&
    (request.colorType === 0 || request.colorType === 2 || request.colorType === 6) &&
    request.interlace === 0 &&
    request.frames === 1 &&
    !request.transparency &&
    request.width * channels <= maximumRowBytes
  )
}

const createDecodedRows = (
  lease: PngKernelLease,
  request: PngAccelerationRequest,
): AsyncIterable<PixelBlock> => ({
  async *[Symbol.asyncIterator](): AsyncGenerator<PixelBlock> {
    const channels = formatChannels(request.pixelFormat)
    if (channels === undefined) {
      lease.release()
      throw invalidInput('PNG WASM received an unsupported pixel format')
    }
    const rowBytes = request.width * channels
    const scanlineBytes = rowBytes + 1
    let filtered = new Uint8Array(scanlineBytes * batchRows)
    let filled = 0
    let bufferedRows = 0
    let outputY = 0
    try {
      for await (const chunk of request.inflated) {
        let chunkOffset = 0
        while (chunkOffset < chunk.byteLength) {
          if (outputY + bufferedRows >= request.height) {
            throw invalidInput('PNG image data contains extra scanlines')
          }
          const rowOffset = bufferedRows * scanlineBytes
          const length = Math.min(scanlineBytes - filled, chunk.byteLength - chunkOffset)
          filtered.set(chunk.subarray(chunkOffset, chunkOffset + length), rowOffset + filled)
          filled += length
          chunkOffset += length
          if (filled !== scanlineBytes) continue
          const filter = filtered[rowOffset]
          if (filter === undefined || filter > 4) {
            throw invalidInput(`PNG filter ${filter ?? -1} is invalid`)
          }
          filled = 0
          bufferedRows += 1
          if (bufferedRows !== batchRows) continue
          const data = lease.unfilter(filtered, rowBytes, channels, bufferedRows)
          yield {
            x: 0,
            y: outputY,
            width: request.width,
            height: bufferedRows,
            stride: rowBytes,
            format: request.pixelFormat,
            data,
          }
          outputY += bufferedRows
          bufferedRows = 0
          const remainingRows = request.height - outputY
          if (remainingRows > 0) {
            filtered = new Uint8Array(scanlineBytes * Math.min(batchRows, remainingRows))
          }
        }
      }
      if (filled !== 0 || outputY + bufferedRows !== request.height) {
        throw truncatedInput(
          `PNG ended after ${outputY + bufferedRows} of ${request.height} scanlines`,
        )
      }
      if (bufferedRows > 0) {
        const batch = filtered.subarray(0, scanlineBytes * bufferedRows)
        const data = lease.unfilter(batch, rowBytes, channels, bufferedRows)
        yield {
          x: 0,
          y: outputY,
          width: request.width,
          height: bufferedRows,
          stride: rowBytes,
          format: request.pixelFormat,
          data,
        }
      }
    } finally {
      lease.release()
    }
  },
})

const createAcceleratedFilter = (
  lease: PngKernelLease,
  request: PngEncodeAccelerationRequest,
): PngRowFilter => {
  const channels = formatChannels(request.pixelFormat)
  if (channels === undefined) {
    lease.release()
    throw invalidInput('PNG WASM received an unsupported encoder pixel format')
  }
  const rowBytes = request.width * channels
  return Object.freeze({
    filter(data: Uint8Array, stride: number, rows: number): Uint8Array {
      return lease.filter(data, stride, rowBytes, channels, rows)
    },
    release(): void {
      lease.release()
    },
  })
}

const loadPool = async (
  scalar: WasmPngInstanceLoader | undefined,
  simd: WasmPngInstanceLoader | undefined,
): Promise<PngKernelPool | undefined> => {
  if (simd) {
    try {
      return createKernelPool(await simd(), true)
    } catch {
      if (!scalar) return undefined
    }
  }
  if (!scalar) return undefined
  try {
    return createKernelPool(await scalar(), false)
  } catch {
    return undefined
  }
}

export const createWasmPngAcceleratorWithLoaders = (
  loaders: WasmPngInstanceLoaders,
  options: WasmPngAcceleratorOptions = {},
): ImageCodecAccelerator => {
  const minimumPixels = positiveInteger(
    'minimumPixels',
    options.minimumPixels ?? defaultMinimumPixels,
  )
  const minimumEncodePixels = positiveInteger(
    'minimumEncodePixels',
    options.minimumEncodePixels ?? defaultMinimumEncodePixels,
  )
  const maximumRowBytes = positiveInteger(
    'maximumRowBytes',
    options.maximumRowBytes ?? defaultMaximumRowBytes,
  )
  let decoderPoolPromise: Promise<PngKernelPool | undefined> | undefined
  let encoderPoolPromise: Promise<PngKernelPool | undefined> | undefined

  const acceleration: PngAcceleration = {
    async decode(request: PngAccelerationRequest): Promise<AsyncIterable<PixelBlock> | undefined> {
      const channels = formatChannels(request.pixelFormat)
      if (
        channels === undefined ||
        (!loaders.decoder && !loaders.simdDecoder) ||
        typeof WebAssembly !== 'object' ||
        !shouldAccelerateDecode(request, minimumPixels, maximumRowBytes)
      ) {
        return undefined
      }
      decoderPoolPromise ??= loadPool(loaders.decoder, loaders.simdDecoder)
      const lease = (await decoderPoolPromise)?.prepare(request.width * channels)
      return lease ? createDecodedRows(lease, request) : undefined
    },
    async encode(request: PngEncodeAccelerationRequest): Promise<PngRowFilter | undefined> {
      const channels = formatChannels(request.pixelFormat)
      if (
        channels === undefined ||
        (!loaders.encoder && !loaders.simdEncoder) ||
        typeof WebAssembly !== 'object' ||
        !request.adaptiveFiltering ||
        BigInt(request.width) * BigInt(request.height) < BigInt(minimumEncodePixels) ||
        request.width * channels > maximumRowBytes
      ) {
        return undefined
      }
      encoderPoolPromise ??= loadPool(loaders.encoder, loaders.simdEncoder)
      const lease = (await encoderPoolPromise)?.prepare(request.width * channels)
      return lease ? createAcceleratedFilter(lease, request) : undefined
    },
  }

  return Object.freeze({
    format: 'png',
    id: 'rust-wasm-png',
    kind: 'wasm',
    accelerate(reference: ImageCodec): ImageCodec {
      return acceleratePngCodec(reference, acceleration)
    },
  })
}

export const createWasmPngAcceleratorWithLoader = (
  loadInstance: WasmPngInstanceLoader,
  options: WasmPngAcceleratorOptions = {},
): ImageCodecAccelerator => createWasmPngAcceleratorWithLoaders({ decoder: loadInstance }, options)
