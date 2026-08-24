import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  createWasmWebpAccelerator,
  wasmWebpAccelerator,
} from '../src/accelerator-entries/wasm-webp-node.ts'
import { createWasmWebpAcceleratorWithLoaders } from '../src/accelerators/wasm/webp.ts'
import type {
  WasmWebpAcceleratorDiagnostics,
  WasmWebpKernelOperation,
} from '../src/accelerators/wasm/webp.ts'
import type { ImageCodec, ImageDecoder } from '../src/codec.ts'
import { webpCodec } from '../src/codecs/webp.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

const scalarArtifactUrl = new URL('../src/accelerator-entries/webp-codec.wasm', import.meta.url)
const simdArtifactUrl = new URL('../src/accelerator-entries/webp-codec-simd.wasm', import.meta.url)
const losslessFixtureUrl = new URL(
  '../benchmark/corpus/files/webp-lossless-tux-386x395.webp',
  import.meta.url,
)

const artifacts = [
  { kind: 'scalar', url: scalarArtifactUrl },
  { kind: 'simd', url: simdArtifactUrl },
] as const

const instantiateArtifact = async (url: URL): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(url))
  return result.instance
}

const decodedPixels = async (decoder: ImageDecoder): Promise<Uint8Array> => {
  const output = new Uint8Array(decoder.width * decoder.height * 4)
  for await (const block of decoder.decode()) {
    expect(block.format).toBe('rgba8')
    for (let row = 0; row < block.height; row += 1) {
      output.set(
        block.data.subarray(row * block.stride, row * block.stride + block.width * 4),
        ((block.y + row) * decoder.width + block.x) * 4,
      )
    }
    block.release?.()
  }
  return output
}

const decode = async (codec: ImageCodec, input: Uint8Array): Promise<Uint8Array> => {
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('WebP decoder is unavailable')
  return decodedPixels(decoder)
}

interface RgbaFixture {
  data: Uint8Array
  height: number
  width: number
}

const createRgbaFixture = (): RgbaFixture => {
  const width = 17
  const height = 13
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      data[offset] = (x * 17 + y * 3) & 0xff
      data[offset + 1] = (x * 5 + y * 19) & 0xff
      data[offset + 2] = (x * 11 + y * 7) & 0xff
      data[offset + 3] = (x * 13 + y * 23) & 0xff
    }
  }
  return { data, height, width }
}

const encode = async (
  codec: ImageCodec,
  input: RgbaFixture,
  lossless: boolean,
): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await codec.createEncoder?.(sink, {
    height: input.height,
    metadata: {},
    options: lossless ? { lossless: true } : { quality: 80 },
    pixelFormat: 'rgba8',
    width: input.width,
  })
  if (!encoder) throw new Error('WebP encoder is unavailable')
  await encoder.write({
    data: input.data,
    format: 'rgba8',
    height: input.height,
    stride: input.width * 4,
    width: input.width,
    x: 0,
    y: 0,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

const codecWithArtifact = (
  kind: 'scalar' | 'simd',
  url: URL,
  diagnostics?: WasmWebpAcceleratorDiagnostics,
): ImageCodec =>
  createWasmWebpAcceleratorWithLoaders(
    kind === 'simd'
      ? {
          simdDecoder: () => instantiateArtifact(url),
          simdEncoder: () => instantiateArtifact(url),
        }
      : {
          decoder: () => instantiateArtifact(url),
          encoder: () => instantiateArtifact(url),
        },
    { minimumEncodePixels: 1, minimumPixels: 1 },
    diagnostics,
  ).accelerate(webpCodec)

describe('Rust/WASM WebP accelerator', { timeout: 30_000 }, () => {
  it.each(artifacts)(
    'exports a bounded $kind module with the expected mode',
    async ({ kind, url }) => {
      const instance = await instantiateArtifact(url)
      const memory: unknown = instance.exports.memory
      expect(memory).toBeInstanceOf(WebAssembly.Memory)
      if (!(memory instanceof WebAssembly.Memory)) throw new Error('Missing WebP WASM memory')
      expect(memory.buffer.byteLength).toBeLessThanOrEqual(4 * 65_536)
      const modeExport: unknown = instance.exports.webp_codec_simd
      if (typeof modeExport !== 'function') throw new Error('Missing WebP SIMD mode export')
      const mode: unknown = Reflect.apply(modeExport, undefined, [])
      expect(mode).toBe(kind === 'simd' ? 1 : 0)
    },
  )

  it.each(artifacts)(
    'decodes lossy VP8 and lossless VP8L exactly through the $kind artifact',
    async ({ kind, url }) => {
      const accelerated = codecWithArtifact(kind, url)
      const fixtures = [
        await encode(webpCodec, createRgbaFixture(), false),
        await readFile(losslessFixtureUrl),
      ]
      for (const input of fixtures) {
        expect(await decode(accelerated, input)).toEqual(await decode(webpCodec, input))
      }
    },
  )

  it.each(artifacts)(
    'encodes exact lossy and lossless bitstreams through the $kind artifact',
    async ({ kind, url }) => {
      const accelerated = codecWithArtifact(kind, url)
      const input = createRgbaFixture()
      for (const lossless of [false, true]) {
        const expected = await encode(webpCodec, input, lossless)
        const actual = await encode(accelerated, input, lossless)
        expect(actual).toEqual(expected)
        expect(await decode(webpCodec, actual)).toEqual(await decode(webpCodec, expected))
      }
    },
  )

  it.each(artifacts)(
    'fuses common VP8L row transforms through the $kind artifact',
    async ({ kind, url }) => {
      const operations: WasmWebpKernelOperation[] = []
      const accelerated = codecWithArtifact(kind, url, {
        kernelOperation(operation, succeeded) {
          expect(succeeded).toBe(true)
          operations.push(operation)
        },
      })
      await decode(accelerated, await readFile(losslessFixtureUrl))
      expect(operations.filter((operation) => operation === 'vp8l-inverse-row').length).toBe(395)
      expect(operations).not.toContain('vp8l-inverse-color')
      expect(operations).not.toContain('vp8l-inverse-predictor')
      expect(operations).not.toContain('vp8l-inverse-subtract-green')
    },
  )

  it('loads checked-in SIMD and scalar artifacts through the public Node entry', async () => {
    const input = await readFile(losslessFixtureUrl)
    const codec = createWasmWebpAccelerator({ minimumPixels: 1 }).accelerate(webpCodec)
    expect(await decode(codec, input)).toEqual(await decode(webpCodec, input))
    expect(wasmWebpAccelerator.accelerate).toBeTypeOf('function')
  })

  it('falls back to TypeScript when both module variants fail to load', async () => {
    const input = await encode(webpCodec, createRgbaFixture(), false)
    let loads = 0
    const reject = (): Promise<WebAssembly.Instance> => {
      loads += 1
      return Promise.reject(new Error('simulated WebP WASM load failure'))
    }
    const codec = createWasmWebpAcceleratorWithLoaders(
      { decoder: reject, simdDecoder: reject },
      { minimumPixels: 1 },
    ).accelerate(webpCodec)
    expect(await decode(codec, input)).toEqual(await decode(webpCodec, input))
    expect(loads).toBe(2)
  })

  it.each(artifacts)('rejects out-of-bounds memory through the $kind ABI', async ({ url }) => {
    const instance = await instantiateArtifact(url)
    const operation: unknown = instance.exports.webp_vp8l_inverse_subtract_green
    if (typeof operation !== 'function') throw new Error('Missing WebP green transform export')
    const status: unknown = Reflect.apply(operation, undefined, [0xffff_fff0, 64])
    expect(status).toBe(1)
  })
})
