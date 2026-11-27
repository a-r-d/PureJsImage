import { readFile } from 'node:fs/promises'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  createWasmWebpAccelerator,
  wasmWebpAccelerator,
} from '../src/accelerator-entries/wasm-webp-node.ts'
import type {
  WasmWebpAcceleratorDiagnostics,
  WasmWebpKernelOperation,
} from '../src/accelerators/wasm/webp.ts'
import { createWasmWebpAcceleratorWithLoaders } from '../src/accelerators/wasm/webp.ts'
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
// Synthetic gradients, two disks, and noise, written by libwebp 1.5.0 with
// `cwebp -q 50 -nostrong -f 60 -metadata none`. It uses the simple loop filter at level 16.
const simpleFilterFixtureUrl = new URL(
  './fixtures/webp/simple-filter-256x160.webp',
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

const decodedPixels = async (
  decoder: Pick<ImageDecoder, 'width' | 'height' | 'decode'>,
): Promise<Uint8Array> => {
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

const createRgbaFixture = (width = 17, height = 13): RgbaFixture => {
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

// Opaque gradients with seeded noise, so every macroblock carries many coefficient tokens.
const createNoisyFixture = (width: number, height: number): RgbaFixture => {
  const data = new Uint8Array(width * height * 4)
  let seed = 1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0
      const noise = (seed >>> 24) - 128
      data[offset] = (x + noise) & 0xff
      data[offset + 1] = (y * 3 + noise) & 0xff
      data[offset + 2] = (x + y - noise) & 0xff
      data[offset + 3] = 255
    }
  }
  return { data, height, width }
}

const encode = async (
  codec: ImageCodec,
  input: RgbaFixture,
  lossless: boolean,
  effort?: number,
  quality = 80,
): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await codec.createEncoder?.(sink, {
    height: input.height,
    metadata: {},
    options: lossless
      ? { lossless: true, ...(effort === undefined ? {} : { effort }) }
      : { quality },
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
    'matches libwebp across flat and textured VP8 blocks through $kind',
    async ({ kind, url }) => {
      const { data, width, height } = createNoisyFixture(193, 83)
      for (let y = 0; y < height; y++) {
        const start = y * width * 4
        data.fill(255, start, start + 65 * 4)
      }
      const encoded = await sharp(data, { raw: { width, height, channels: 4 } })
        .webp({ quality: 85 })
        .toBuffer()
      const expected = await sharp(encoded).ensureAlpha().raw().toBuffer()
      let rows = 0
      const accelerated = codecWithArtifact(kind, url, {
        kernelOperation(operation, succeeded) {
          if (operation === 'vp8-row' && succeeded) rows++
        },
      })
      expect(expected.equals(await decode(webpCodec, encoded))).toBe(true)
      expect(expected.equals(await decode(accelerated, encoded))).toBe(true)
      expect(rows).toBe(Math.ceil(height / 16))
    },
  )

  it.each(artifacts)(
    'batches VP8 rows with the simple luma filter through $kind',
    async ({ kind, url }) => {
      const input = await readFile(simpleFilterFixtureUrl)
      let rows = 0
      const accelerated = codecWithArtifact(kind, url, {
        kernelOperation(operation, succeeded) {
          if (operation === 'vp8-row' && succeeded) rows++
        },
      })
      expect(
        Buffer.from(await decode(accelerated, input)).equals(await decode(webpCodec, input)),
      ).toBe(true)
      expect(rows).toBe(Math.ceil(160 / 16))
    },
  )

  it.each(artifacts)(
    'preserves outstanding $kind VP8 bands across late and repeated releases',
    async ({ kind, url }) => {
      const input = await encode(webpCodec, createNoisyFixture(160, 96), false)
      const decoder = await codecWithArtifact(kind, url).createDecoder?.(
        new MemorySource(input),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('Missing WebP decoder')
      const iterator = decoder.decode()[Symbol.asyncIterator]()
      const next = async () => {
        const result = await iterator.next()
        if (result.done) throw new Error('Missing VP8 band')
        return result.value
      }
      try {
        const first = await next()
        const firstBytes = Buffer.from(first.data)
        const second = await next()
        const secondBytes = Buffer.from(second.data)
        expect(Buffer.from(first.data).equals(firstBytes)).toBe(true)
        first.release?.()
        const third = await next()
        const thirdBytes = Buffer.from(third.data)
        // A stale release must not return the third band's buffer to the decoder.
        first.release?.()
        const fourth = await next()
        expect(Buffer.from(third.data).equals(thirdBytes)).toBe(true)
        expect(Buffer.from(second.data).equals(secondBytes)).toBe(true)
        second.release?.()
        third.release?.()
        fourth.release?.()
      } finally {
        await iterator.return?.()
      }
    },
  )

  it.each(artifacts)(
    'accelerates composited and selected animation frames through the $kind decoder',
    async ({ kind, url }) => {
      // Three lossy libwebp frames. The row kernel needs frames at least 8 macroblocks wide.
      const width = 160
      const height = 64
      const page = createNoisyFixture(width, height).data
      const strip = new Uint8Array(page.length * 3)
      for (let frame = 0; frame < 3; frame += 1) {
        const start = frame * page.length
        strip.set(page, start)
        // Later frames add a white band at a new height, so libwebp writes partial frames.
        for (let y = frame * 8; frame > 0 && y < frame * 8 + 24; y += 1) {
          strip.fill(255, start + (y * width + 8) * 4, start + (y * width + 152) * 4)
        }
      }
      const input = await sharp(Buffer.from(strip), {
        raw: { width, height: height * 3, channels: 4, pageHeight: height },
      })
        .webp({ quality: 75 })
        .toBuffer()
      let rows = 0
      const accelerated = codecWithArtifact(kind, url, {
        kernelOperation(operation, succeeded) {
          if (operation === 'vp8-row' && succeeded) rows++
        },
      })
      const selected = async (codec: ImageCodec) => {
        const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits, {
          frame: 1,
        })
        if (!decoder) throw new Error('Missing WebP decoder')
        return decodedPixels(decoder)
      }
      const reference = await selected(webpCodec)
      expect(Buffer.from(await selected(accelerated)).equals(reference)).toBe(true)
      expect(rows).toBeGreaterThan(0)
      rows = 0
      const animation = await accelerated.createAnimationDecoder?.(
        new MemorySource(input),
        defaultImageLimits,
      )
      if (!animation) throw new Error('Missing WebP animation decoder')
      let compared = false
      for await (const frame of animation.frames()) {
        if (frame.index === 1) {
          const pixels = await decodedPixels({
            width: animation.width,
            height: animation.height,
            decode: frame.decode,
          })
          expect(Buffer.from(pixels).equals(reference)).toBe(true)
          compared = true
          break
        }
      }
      expect(compared).toBe(true)
      expect(rows).toBeGreaterThan(0)
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

  for (const operation of [
    'webp_vp8_coefficients',
    'webp_predict_tile',
    'webp_vp8_filter_plane',
    'webp_vp8_yuv_to_rgba',
    'webp_vp8l_entropy_band',
  ] as const) {
    it.each(artifacts)(
      `resumes $kind decoding after a failed ${operation} call`,
      async ({ kind, url }) => {
        // Four VP8 bands with separate compressed alpha and the normal loop filter.
        const input =
          operation === 'webp_vp8l_entropy_band'
            ? await encode(webpCodec, createRgbaFixture(130, 129), true, 0)
            : Buffer.from(
                'UklGRsgAAABXRUJQVlA4WAoAAAAQAAAAPwAAPwAAQUxQSBAAAAABB1DAiAgACeH/ey2i/6kfVlA4IJIAAAAwBgCdASpAAEAAPm00l0ikIqIhIgmYgA2JZAE6ArzN5/IPxu4acwC//QDp+1KOZWVPach092wtfongAP7xWZpw6//0J3nye3//EY/EY+4pvnvKojdAwTZYvEo/+gJaGj8ZSA79NGRrSRc/PGbnlE04a9o8+uYPyDCV3HzloG7n+Ow52b6e/ubSnudgAKe9fAAAAA==',
                'base64',
              )
        const instance = await instantiateArtifact(url)
        const original = instance.exports[operation]
        if (typeof original !== 'function') throw new Error('Missing WebP kernel')
        let successful = 0
        let failed = 0
        let rows = 0
        let callsAfterOutput = 0
        const load = async (): Promise<WebAssembly.Instance> => ({
          exports: {
            ...instance.exports,
            [operation]: (...args: readonly number[]) => {
              // For the filter, fail on chroma after luma has been processed.
              if (
                rows > 0 &&
                ++callsAfterOutput === (operation === 'webp_vp8_filter_plane' ? 2 : 1)
              ) {
                failed += 1
                const memory = instance.exports.memory
                if (operation === 'webp_predict_tile' && memory instanceof WebAssembly.Memory)
                  memory.grow(1)
                throw new Error('simulated kernel failure after output')
              }
              successful += 1
              return Reflect.apply(original, undefined, args)
            },
          },
        })
        const codec = createWasmWebpAcceleratorWithLoaders(
          kind === 'simd' ? { simdDecoder: load } : { decoder: load },
          { minimumPixels: 1 },
        ).accelerate(webpCodec)
        const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits)
        if (!decoder) throw new Error('Missing WebP decoder')
        const pixels = new Uint8Array(decoder.width * decoder.height * 4)
        for await (const block of decoder.decode()) {
          expect(block.y).toBe(rows)
          pixels.set(block.data, rows * block.stride)
          rows += block.height
          block.release?.()
        }
        expect(rows).toBe(decoder.height)
        expect(successful).toBeGreaterThan(0)
        expect(failed).toBe(1)
        expect(pixels).toEqual(await decode(webpCodec, input))
      },
    )
  }

  it.each(artifacts)(
    'shares the $kind scratch space between active decoders',
    async ({ kind, url }) => {
      const operations = new Set<WasmWebpKernelOperation>()
      const accelerated = codecWithArtifact(kind, url, {
        kernelOperation(operation, succeeded) {
          expect(succeeded).toBe(true)
          operations.add(operation)
        },
      })
      const fixtures = await Promise.all([
        encode(webpCodec, createRgbaFixture(65, 127), false),
        encode(webpCodec, createRgbaFixture(130, 129), true, 0),
      ])
      const reference = await Promise.all(fixtures.map((input) => decode(webpCodec, input)))
      const actual = await Promise.all(fixtures.map((input) => decode(accelerated, input)))
      expect(actual).toEqual(reference)
      expect(operations.has('vp8-coefficients')).toBe(true)
      expect(operations.has('vp8-predict')).toBe(true)
      expect(operations.has('vp8l-entropy')).toBe(true)
    },
  )

  it.each(artifacts)(
    'replays an uncommitted $kind VP8 row after a token refill fails',
    async ({ kind, url }) => {
      // Noise at quality 100 gives each 64-macroblock row more tokens than one 16 KiB window.
      const input = await encode(webpCodec, createNoisyFixture(1024, 48), false, undefined, 100)
      const instance = await instantiateArtifact(url)
      const original = instance.exports.webp_vp8_row
      if (typeof original !== 'function') throw new Error('Missing VP8 row kernel')
      let rows = 0
      let failures = 0
      const load = async (): Promise<WebAssembly.Instance> => ({
        exports: {
          ...instance.exports,
          webp_vp8_row: (...args: readonly number[]) => {
            const result: unknown = Reflect.apply(original, undefined, args)
            // The first window already changed private pixels and entropy state.
            if (rows > 0 && (args[7] ?? 0) > 0) {
              failures++
              const memory = instance.exports.memory
              if (memory instanceof WebAssembly.Memory) memory.grow(1)
              throw new Error('simulated row refill failure')
            }
            return result
          },
        },
      })
      const codec = createWasmWebpAcceleratorWithLoaders(
        kind === 'simd' ? { simdDecoder: load } : { decoder: load },
        { minimumPixels: 1 },
      ).accelerate(webpCodec)
      const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits)
      if (!decoder) throw new Error('Missing WebP decoder')
      const reference = await decode(webpCodec, input)
      for await (const block of decoder.decode()) {
        expect(block.y).toBe(rows)
        const offset = rows * block.stride
        expect(
          Buffer.from(block.data).equals(reference.subarray(offset, offset + block.data.length)),
        ).toBe(true)
        rows += block.height
        block.release?.()
      }
      expect(rows).toBe(decoder.height)
      expect(failures).toBe(1)
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
    const row = instance.exports.webp_vp8_row
    if (typeof row !== 'function') throw new Error('Missing VP8 row kernel')
    // An in-bounds input and tables cannot authorize a row workspace past memory.
    const memory = instance.exports.memory
    if (!(memory instanceof WebAssembly.Memory)) throw new Error('Missing WebP WASM memory')
    const table = memory.buffer.byteLength - 4096
    expect(row(table, 0, 0, table, 0xffff_fff0, 8, 1, 0, table, 0, 0, table, 128, 0, 0)).toBe(1)
  })
})
