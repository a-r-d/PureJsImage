import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import type { DecodeRequest, ImageCodec, ImageDecoder } from '../src/codec.ts'
import { createWasmJpegAccelerator } from '../src/accelerator-entries/wasm-jpeg-node.ts'
import { accelerateJpegCodec, type JpegDecodeAcceleration, jpegCodec } from '../src/codecs/jpeg.ts'
import { createWasmJpegAcceleratorWithLoader } from '../src/accelerators/wasm/jpeg.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const artifactUrl = new URL('../src/accelerator-entries/jpeg-decoder.wasm', import.meta.url)
const fixtureUrl = new URL(
  '../benchmark/corpus/files/jpeg-reference/generated-sof1-8bit.jpg',
  import.meta.url,
)

const instantiate = async (): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(artifactUrl))
  return result.instance
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
): Promise<Uint8Array> => {
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits)
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

describe('Rust/WASM JPEG accelerator', () => {
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

  it('rejects invalid selection thresholds before registration', () => {
    expect(() => createWasmJpegAcceleratorWithLoader(instantiate, { minimumPixels: 0 })).toThrow(
      'JPEG WASM minimumPixels must be a positive integer',
    )
    expect(() =>
      createWasmJpegAcceleratorWithLoader(instantiate, { maximumInputBytes: 0 }),
    ).toThrow('JPEG WASM maximumInputBytes must be a positive integer')
  })
})
