import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import type { DecoderOptions, DecodeRequest, ImageCodec, ImageDecoder } from '../src/codec.ts'
import { createWasmJpegAccelerator } from '../src/accelerator-entries/wasm-jpeg-node.ts'
import { decodeBaselineJpeg } from '../src/codecs/jpeg-baseline.ts'
import { accelerateJpegCodec, type JpegDecodeAcceleration, jpegCodec } from '../src/codecs/jpeg.ts'
import {
  createWasmJpegAcceleratorWithLoader,
  createWasmJpegAcceleratorWithLoaders,
} from '../src/accelerators/wasm/jpeg.ts'
import { defaultImageLimits } from '../src/limits.ts'
import type { PixelFormat } from '../src/pixel.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { type ImageSource, MemorySource } from '../src/source.ts'

const artifactUrl = new URL('../src/accelerator-entries/jpeg-decoder.wasm', import.meta.url)
const simdDecoderArtifactUrl = new URL(
  '../src/accelerator-entries/jpeg-decoder-simd.wasm',
  import.meta.url,
)
const scalarEncoderArtifactUrl = new URL(
  '../src/accelerator-entries/jpeg-encoder.wasm',
  import.meta.url,
)
const simdEncoderArtifactUrl = new URL(
  '../src/accelerator-entries/jpeg-encoder-simd.wasm',
  import.meta.url,
)
const fixtureUrl = new URL(
  '../benchmark/corpus/files/jpeg-reference/generated-sof1-8bit.jpg',
  import.meta.url,
)

const instantiate = async (): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(artifactUrl))
  return result.instance
}
const instantiateArtifact = async (url: URL): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(url))
  return result.instance
}

type WasmNumberFunction = (...arguments_: readonly number[]) => number

const numberExport = (instance: WebAssembly.Instance, name: string): WasmNumberFunction => {
  const value: unknown = instance.exports[name]
  if (typeof value !== 'function') throw new Error(`Missing WASM export ${name}`)
  return (...arguments_: readonly number[]): number => {
    const result: unknown = Reflect.apply(value, undefined, arguments_)
    if (typeof result !== 'number') throw new Error(`WASM export ${name} returned no number`)
    return result
  }
}

const memoryExport = (instance: WebAssembly.Instance): WebAssembly.Memory => {
  const value: unknown = instance.exports.memory
  if (!(value instanceof WebAssembly.Memory)) throw new Error('Missing WASM memory export')
  return value
}

const decoderPixels = async (
  decoder: ImageDecoder,
  request: DecodeRequest = {},
): Promise<Uint8Array> => {
  const scale = request.scaleDenominator ?? 1
  const width = request.width ?? Math.ceil(decoder.width / scale) - (request.x ?? 0)
  const height = request.height ?? Math.ceil(decoder.height / scale) - (request.y ?? 0)
  const output = new Uint8Array(width * height * 3)
  for await (const block of decoder.decode(request)) {
    expect(block.format).toBe('rgb8')
    for (let row = 0; row < block.height; row += 1) {
      output.set(
        block.data.subarray(row * block.stride, row * block.stride + block.width * 3),
        ((block.y + row) * width + block.x) * 3,
      )
    }
    block.release?.()
  }
  return output
}
const decodeInput = async (
  codec: ImageCodec,
  input: Uint8Array,
  request: DecodeRequest = {},
  options: DecoderOptions = {},
): Promise<Uint8Array> => {
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits, options)
  if (!decoder) throw new Error('JPEG decoder is unavailable')
  return decoderPixels(decoder, request)
}

const decode = async (codec: ImageCodec, request: DecodeRequest = {}): Promise<Uint8Array> =>
  decodeInput(codec, await readFile(fixtureUrl), request)

const decodeFile = async (codec: ImageCodec, url: URL): Promise<Uint8Array> => {
  const input = await readFile(url)
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('JPEG decoder is unavailable')
  return decoderPixels(decoder)
}
const encodePixels = async (
  codec: ImageCodec,
  format: PixelFormat,
  chromaSubsampling: '420' | '422' | '444',
  restartInterval: number,
  width = 35,
  height = 27,
): Promise<{ readonly input: Uint8Array; readonly output: Uint8Array }> => {
  const channels = format === 'gray8' ? 1 : format === 'rgb8' ? 3 : 4
  const input = new Uint8Array(width * height * channels)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels
      input[offset] = (x * 7 + y * 3) & 255
      if (channels > 1) {
        input[offset + 1] = (x * 2 + y * 11) & 255
        input[offset + 2] = (x * 13 + y * 5) & 255
      }
      if (channels === 4) input[offset + 3] = 255
    }
  }
  const sink = new Uint8ArraySink()
  const encoder = await codec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: format,
    options: { quality: 86, chromaSubsampling, restartInterval },
  })
  if (!encoder) throw new Error('JPEG encoder is unavailable')
  await encoder.write({
    data: input,
    format,
    height,
    stride: width * channels,
    width,
    x: 0,
    y: 0,
  })
  await encoder.finish()
  return { input, output: sink.toUint8Array() }
}

const decodedPsnr = async (
  encoded: Uint8Array,
  input: Uint8Array,
  format: PixelFormat,
): Promise<number> => {
  const decoded = await decodeInput(jpegCodec, encoded)
  const channels = format === 'gray8' ? 1 : format === 'rgb8' ? 3 : 4
  let error = 0
  for (let pixel = 0; pixel < decoded.byteLength / 3; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const expected =
        format === 'gray8' ? (input[pixel] ?? 0) : (input[pixel * channels + channel] ?? 0)
      const difference = (decoded[pixel * 3 + channel] ?? 0) - expected
      error += difference * difference
    }
  }
  const meanSquaredError = error / decoded.byteLength
  return meanSquaredError === 0
    ? Number.POSITIVE_INFINITY
    : 10 * Math.log10((255 * 255) / meanSquaredError)
}

describe('Rust/WASM JPEG accelerator', () => {
  it.each([
    ['decoder scalar', artifactUrl] as const,
    ['decoder SIMD', simdDecoderArtifactUrl] as const,
    ['encoder scalar', scalarEncoderArtifactUrl] as const,
    ['encoder SIMD', simdEncoderArtifactUrl] as const,
  ])('keeps the initial %s memory within four WASM pages', async (_kind, url) => {
    const instance = await instantiateArtifact(url)
    expect(memoryExport(instance).buffer.byteLength).toBeLessThanOrEqual(4 * 65_536)
  })

  it('rejects decoder input that aliases its static scratch storage', async () => {
    const instance = await instantiate()
    const scratchPointer = numberExport(instance, 'jpeg_decoder_quantization_ptr')()
    const start = numberExport(instance, 'jpeg_decoder_start')

    expect(start(scratchPointer, 1, 0, 30, 0, 1, 0, 3, 0, 1, 1, 1, 1, 1, 1, 0, 0)).toBe(10)
  })

  it('rejects out-of-bounds and overlapping encoder buffers without trapping', async () => {
    const instance = await instantiateArtifact(scalarEncoderArtifactUrl)
    const memory = memoryExport(instance)
    const start = numberExport(instance, 'jpeg_encoder_start')
    const write = numberExport(instance, 'jpeg_encoder_write')
    const initialBytes = memory.buffer.byteLength

    expect(start(16, 16, 3, 80, 1, 0, 0xff_ff_ff, initialBytes - 8, 1024)).toBe(10)

    memory.grow(1)
    expect(start(16, 16, 3, 80, 1, 0, 0xff_ff_ff, initialBytes, 4096)).toBe(0)
    expect(write(memory.buffer.byteLength - 4, 768, 48, 16)).toBe(11)
    expect(write(initialBytes, 768, 48, 16)).toBe(11)
  })

  it('keeps multiple JPEG providers in explicit registration order', async () => {
    const calls: string[] = []
    const unavailable = (name: string): JpegDecodeAcceleration => ({
      async decode() {
        calls.push(name)
        return undefined
      },
    })
    const first = accelerateJpegCodec(jpegCodec, unavailable('first'))
    const second = accelerateJpegCodec(first, unavailable('second'))

    await expect(decode(second)).resolves.toEqual(await decode(jpegCodec))
    expect(calls).toEqual(['first', 'second'])
  })

  it('loads the checked-in artifact through the public Node entry', async () => {
    const accelerated = createWasmJpegAccelerator({ minimumPixels: 1 }).accelerate(jpegCodec)
    await expect(decode(accelerated)).resolves.toEqual(await decode(jpegCodec))
  })

  it('matches the complete TypeScript baseline decode exactly and reuses one warm instance', async () => {
    let loads = 0
    const accelerator = createWasmJpegAcceleratorWithLoader(
      async () => {
        loads += 1
        return instantiate()
      },
      { minimumPixels: 1 },
    )
    const accelerated = accelerator.accelerate(jpegCodec)
    const expected = await decode(jpegCodec)

    await expect(decode(accelerated)).resolves.toEqual(expected)
    await expect(decode(accelerated, { x: 3, y: 2, width: 29, height: 17 })).resolves.toEqual(
      await decode(jpegCodec, { x: 3, y: 2, width: 29, height: 17 }),
    )
    expect(loads).toBe(1)
  })
  it('matches the TypeScript decoder exactly through the SIMD artifact', async () => {
    let loads = 0
    const accelerator = createWasmJpegAcceleratorWithLoaders(
      {
        simdDecoder: async () => {
          loads += 1
          return instantiateArtifact(simdDecoderArtifactUrl)
        },
      },
      { minimumPixels: 1 },
    )
    const accelerated = accelerator.accelerate(jpegCodec)
    await expect(decode(accelerated)).resolves.toEqual(await decode(jpegCodec))
    expect(loads).toBe(1)
  })

  it.each(['generated-yuv440.jpg', 'generated-yuv411.jpg'])(
    'matches the TypeScript decoder for %s',
    async (file) => {
      const accelerator = createWasmJpegAcceleratorWithLoader(instantiate, { minimumPixels: 1 })
      const accelerated = accelerator.accelerate(jpegCodec)
      const url = new URL(`../benchmark/corpus/files/jpeg-reference/${file}`, import.meta.url)
      await expect(decodeFile(accelerated, url)).resolves.toEqual(await decodeFile(jpegCodec, url))
    },
  )

  it('matches full-resolution progressive reconstruction exactly', async () => {
    const accelerator = createWasmJpegAcceleratorWithLoader(instantiate, { minimumPixels: 1 })
    const accelerated = accelerator.accelerate(jpegCodec)
    const progressiveUrl = new URL(
      '../benchmark/corpus/files/jpeg-reference/generated-progressive.jpg',
      import.meta.url,
    )

    await expect(decodeFile(accelerated, progressiveUrl)).resolves.toEqual(
      await decodeFile(jpegCodec, progressiveUrl),
    )
  })

  it('keeps tolerant restart decoding on the Rust/WASM path with strict opt-out', async () => {
    const { output } = await encodePixels(jpegCodec, 'rgb8', '420', 3, 128, 64)
    let restartMarkers = 0
    let secondMarkerOffset = -1
    for (let offset = 0; offset + 1 < output.byteLength; offset += 1) {
      const marker = output[offset + 1] ?? 0
      if (output[offset] !== 0xff || marker < 0xd0 || marker > 0xd7) continue
      restartMarkers += 1
      if (restartMarkers === 2) {
        secondMarkerOffset = offset
        break
      }
    }
    expect(secondMarkerOffset).toBeGreaterThan(0)

    const wrongSequence = Uint8Array.from(output)
    wrongSequence[secondMarkerOffset + 1] = 0xd7
    const extraBytes = new Uint8Array(output.byteLength + 3)
    extraBytes.set(output.subarray(0, secondMarkerOffset))
    extraBytes.set([0x12, 0x34, 0x56], secondMarkerOffset)
    extraBytes.set(output.subarray(secondMarkerOffset), secondMarkerOffset + 3)
    const prematureEnd = Uint8Array.from(output)
    prematureEnd[secondMarkerOffset + 1] = 0xd9
    let scanOffset = -1
    for (let offset = 0; offset + 3 < output.byteLength; offset += 1) {
      if (output[offset] !== 0xff || output[offset + 1] !== 0xda) continue
      const scanLength = ((output[offset + 2] ?? 0) << 8) | (output[offset + 3] ?? 0)
      scanOffset = offset + 2 + scanLength
      break
    }
    expect(scanOffset).toBeGreaterThan(0)
    const unexpectedOffset =
      output[scanOffset] === 0xff && output[scanOffset + 1] === 0 ? scanOffset + 2 : scanOffset + 1
    const unexpectedMarker = new Uint8Array(output.byteLength + 2)
    unexpectedMarker.set(output.subarray(0, unexpectedOffset))
    unexpectedMarker.set([0xff, 0xd7], unexpectedOffset)
    unexpectedMarker.set(output.subarray(unexpectedOffset), unexpectedOffset + 2)

    const accelerator = createWasmJpegAcceleratorWithLoader(instantiate, { minimumPixels: 1 })
    const accelerated = accelerator.accelerate(jpegCodec)
    for (const corrupted of [wrongSequence, extraBytes, prematureEnd, unexpectedMarker]) {
      let reads = 0
      const source: ImageSource = {
        size: corrupted.byteLength,
        async read(offset, length) {
          reads += 1
          if (reads > 2) throw new Error('TypeScript JPEG fallback was reached')
          return corrupted.subarray(offset, Math.min(offset + length, corrupted.byteLength))
        },
      }
      const decoder = await accelerated.createDecoder?.(source, defaultImageLimits, {
        tolerantDecoding: true,
      })
      if (!decoder) throw new Error('Accelerated JPEG decoder is unavailable')

      const expected = await decodeInput(jpegCodec, corrupted, {}, { tolerantDecoding: true })
      await expect(decoderPixels(decoder)).resolves.toEqual(expected)
      expect(reads).toBe(2)
    }
    await expect(
      decodeInput(accelerated, wrongSequence, {}, { tolerantDecoding: false }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('falls back to TypeScript when an accelerator fails before or during output', async () => {
    const { output } = await encodePixels(jpegCodec, 'rgb8', '420', 0, 128, 64)
    const expected = await decodeInput(jpegCodec, output)
    const unavailable: JpegDecodeAcceleration = {
      async decode() {
        throw new Error('accelerator setup failed')
      },
    }
    await expect(decodeInput(accelerateJpegCodec(jpegCodec, unavailable), output)).resolves.toEqual(
      expected,
    )

    const midstreamFailure: JpegDecodeAcceleration = {
      async decode(request) {
        return {
          async *[Symbol.asyncIterator]() {
            for await (const block of decodeBaselineJpeg(
              request.jpeg,
              request.region,
              request.scaleDenominator,
              undefined,
              request.tolerantDecoding,
            )) {
              yield block
              throw new Error('accelerator failed after yielding rows')
            }
          },
        }
      },
    }
    await expect(
      decodeInput(accelerateJpegCodec(jpegCodec, midstreamFailure), output),
    ).resolves.toEqual(expected)
  })

  it('falls back under concurrent use and releases the WASM lease after failure', async () => {
    const accelerator = createWasmJpegAcceleratorWithLoader(instantiate, { minimumPixels: 1 })
    const accelerated = accelerator.accelerate(jpegCodec)
    const expected = await decode(jpegCodec)
    const concurrent = await Promise.all([decode(accelerated), decode(accelerated)])
    expect(concurrent).toEqual([expected, expected])

    const corrupt = Uint8Array.from(await readFile(fixtureUrl))
    let mutated = false
    for (let offset = 0; offset + 1 < corrupt.byteLength; offset += 1) {
      if (corrupt[offset] === 0xff && corrupt[offset + 1] === 0) {
        corrupt[offset + 1] = 0xe0
        mutated = true
        break
      }
    }
    expect(mutated).toBe(true)
    await expect(decodeInput(accelerated, corrupt)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(decode(accelerated)).resolves.toEqual(expected)
  })

  it('does not initialize WASM below the work threshold or for reduced IDCT', async () => {
    let loads = 0
    const accelerator = createWasmJpegAcceleratorWithLoader(async () => {
      loads += 1
      return instantiate()
    })
    const accelerated = accelerator.accelerate(jpegCodec)

    await expect(decode(accelerated)).resolves.toEqual(await decode(jpegCodec))
    await expect(decode(accelerated, { scaleDenominator: 2 })).resolves.toEqual(
      await decode(jpegCodec, { scaleDenominator: 2 }),
    )
    expect(loads).toBe(0)
  })

  it('does not initialize WASM for crops, progressive JPEG, or RGB JPEG', async () => {
    let loads = 0
    const accelerator = createWasmJpegAcceleratorWithLoader(
      async () => {
        loads += 1
        return instantiate()
      },
      { minimumPixels: 1 },
    )
    const accelerated = accelerator.accelerate(jpegCodec)
    const progressiveUrl = new URL(
      '../benchmark/corpus/files/jpeg-reference/generated-progressive.jpg',
      import.meta.url,
    )
    const rgbUrl = new URL(
      '../benchmark/corpus/files/jpeg-reference/generated-adobe-rgb.jpg',
      import.meta.url,
    )

    await expect(decode(accelerated, { x: 3, y: 2, width: 29, height: 17 })).resolves.toEqual(
      await decode(jpegCodec, { x: 3, y: 2, width: 29, height: 17 }),
    )
    await expect(decodeFile(accelerated, progressiveUrl)).resolves.toEqual(
      await decodeFile(jpegCodec, progressiveUrl),
    )
    await expect(decodeFile(accelerated, rgbUrl)).resolves.toEqual(
      await decodeFile(jpegCodec, rgbUrl),
    )
    expect(loads).toBe(0)
  })

  it('falls back to the TypeScript codec when the optional module cannot load', async () => {
    let loads = 0
    const accelerator = createWasmJpegAcceleratorWithLoader(
      async () => {
        loads += 1
        throw new Error('simulated unavailable WASM module')
      },
      { minimumPixels: 1 },
    )
    const accelerated = accelerator.accelerate(jpegCodec)

    await expect(decode(accelerated)).resolves.toEqual(await decode(jpegCodec))
    await expect(decode(accelerated)).resolves.toEqual(await decode(jpegCodec))
    expect(loads).toBe(1)
  })

  it('falls back when a loaded module does not implement the JPEG ABI', async () => {
    const emptyModule = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0))
    const accelerator = createWasmJpegAcceleratorWithLoader(
      async () => new WebAssembly.Instance(emptyModule),
      { minimumPixels: 1 },
    )

    await expect(decode(accelerator.accelerate(jpegCodec))).resolves.toEqual(
      await decode(jpegCodec),
    )
  })

  it.each([
    ['scalar', scalarEncoderArtifactUrl] as const,
    ['simd', simdEncoderArtifactUrl] as const,
  ])('encodes provider-neutral baseline vectors with the %s artifact', async (kind, url) => {
    let loads = 0
    const loader = async (): Promise<WebAssembly.Instance> => {
      loads += 1
      return instantiateArtifact(url)
    }
    const accelerator = createWasmJpegAcceleratorWithLoaders(
      kind === 'simd' ? { simdEncoder: loader } : { encoder: loader },
      { minimumEncodePixels: 1 },
    )
    const codec = accelerator.accelerate(jpegCodec)
    for (const [format, sampling] of [
      ['gray8', '444'],
      ['rgb8', '420'],
      ['rgb8', '422'],
      ['rgba8', '444'],
    ] as const) {
      const { input, output } = await encodePixels(codec, format, sampling, 3)
      const reference = await encodePixels(jpegCodec, format, sampling, 3)
      expect(output).toEqual(reference.output)
      expect(output[0]).toBe(0xff)
      expect(output[1]).toBe(0xd8)
      expect(output.at(-2)).toBe(0xff)
      expect(output.at(-1)).toBe(0xd9)
      const metadata = await jpegCodec.metadata(new MemorySource(output), defaultImageLimits)
      expect(metadata).toMatchObject({
        chromaSubsampling: format === 'gray8' ? '400' : sampling,
        height: 27,
        width: 35,
      })
      expect(await decodedPsnr(output, input, format)).toBeGreaterThan(sampling === '420' ? 20 : 22)
      let hasRestartMarker = false
      for (let index = 0; index + 1 < output.byteLength; index += 1) {
        const marker = output[index + 1] ?? 0
        if (output[index] === 0xff && marker >= 0xd0 && marker <= 0xd7) {
          hasRestartMarker = true
          break
        }
      }
      expect(hasRestartMarker).toBe(true)
    }
    expect(loads).toBe(1)
  })

  it('selects the measured default decoder threshold at 256x256', async () => {
    const vector = await encodePixels(jpegCodec, 'rgb8', '420', 0, 256, 256)
    let loads = 0
    const accelerator = createWasmJpegAcceleratorWithLoaders({
      decoder: async () => {
        loads += 1
        return instantiate()
      },
    }).accelerate(jpegCodec)
    await expect(decodeInput(accelerator, vector.output)).resolves.toEqual(
      await decodeInput(jpegCodec, vector.output),
    )
    expect(loads).toBe(1)
  })

  it('uses the public Node entry for baseline encoding and falls back before loading unsupported modes', async () => {
    const accelerated = createWasmJpegAccelerator({ minimumEncodePixels: 1 }).accelerate(jpegCodec)
    const acceleratedOutput = await encodePixels(accelerated, 'rgb8', '420', 0)
    expect(
      await decodedPsnr(acceleratedOutput.output, acceleratedOutput.input, 'rgb8'),
    ).toBeGreaterThan(20)

    let loads = 0
    const fallback = createWasmJpegAcceleratorWithLoaders(
      {
        encoder: async () => {
          loads += 1
          return instantiateArtifact(scalarEncoderArtifactUrl)
        },
      },
      { minimumEncodePixels: 1 },
    ).accelerate(jpegCodec)
    const sink = new Uint8ArraySink()
    const encoder = await fallback.createEncoder?.(sink, {
      width: 8,
      height: 8,
      pixelFormat: 'rgb8',
      options: { progressive: true, quality: 80 },
    })
    if (!encoder) throw new Error('JPEG fallback encoder is unavailable')
    await encoder.write({
      data: new Uint8Array(8 * 8 * 3),
      format: 'rgb8',
      height: 8,
      stride: 24,
      width: 8,
      x: 0,
      y: 0,
    })
    await encoder.finish()
    expect(loads).toBe(0)
    expect(
      (await jpegCodec.metadata(new MemorySource(sink.toUint8Array()), defaultImageLimits)).width,
    ).toBe(8)
  })

  it('rejects invalid selection thresholds before registration', () => {
    expect(() => createWasmJpegAcceleratorWithLoader(instantiate, { minimumPixels: 0 })).toThrow(
      'JPEG WASM minimumPixels must be a positive integer',
    )
    expect(() =>
      createWasmJpegAcceleratorWithLoader(instantiate, { maximumInputBytes: 0 }),
    ).toThrow('JPEG WASM maximumInputBytes must be a positive integer')
    expect(() =>
      createWasmJpegAcceleratorWithLoaders(
        { encoder: () => instantiateArtifact(scalarEncoderArtifactUrl) },
        { minimumEncodePixels: 0 },
      ),
    ).toThrow('JPEG WASM minimumEncodePixels must be a positive integer')
  })
})
