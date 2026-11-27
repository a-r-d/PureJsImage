import { describe, expect, it } from 'vitest'
import type { ImageResizeAccelerator } from '../src/accelerator.ts'
import { createWasmResizeAccelerator } from '../src/accelerator-entries/wasm-resize-node.ts'
import { createWasmResizeAcceleratorWithLoader } from '../src/accelerators/wasm/resize.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'
import type { ResizeOptions } from '../src/pipeline.ts'
import type { PixelBlock } from '../src/pixel.ts'
import { createResizeTransform } from '../src/resize.ts'

type Format = 'rgb8' | 'rgba8'
const run = async (
  format: Format,
  width: number,
  height: number,
  options: ResizeOptions,
  opaque: boolean,
  accelerator?: ImageResizeAccelerator,
): Promise<Uint8Array[]> => {
  const channels = format === 'rgb8' ? 3 : 4
  const stride = width * channels + 5
  async function* input(): AsyncGenerator<PixelBlock> {
    for (let y = 0; y < height; y += 7) {
      const rows = Math.min(7, height - y)
      const data = new Uint8Array(rows * stride)
      for (let j = 0; j < rows; j++) {
        for (let x = 0; x < width; x++) {
          const i = j * stride + x * channels
          for (let c = 0; c < 3; c++)
            data[i + c] = ((y + j) * 97 + x * 59 + c * 67 + ((x * (y + j)) >>> 3)) & 255
          if (channels === 4)
            data[i + 3] =
              opaque || (y + j) % 7 === 0
                ? 255
                : (y + j) % 5 === 0 || x < 5 || x > width - 5
                  ? 0
                  : (x * 23 + j * 17) & 255
        }
      }
      yield { x: 0, y, width, height: rows, stride, format, data }
    }
  }
  const transform = createResizeTransform(
    width,
    height,
    format,
    options,
    undefined,
    undefined,
    opaque,
    accelerator,
  )
  const blocks: Uint8Array[] = []
  for await (const block of transform.apply(input())) blocks.push(block.data)
  return blocks
}

describe.each(['scalar', 'simd'] as const)('WASM resize %s', (variant) => {
  const wasm = createWasmResizeAccelerator({ variant })
  it('matches every fit with odd sizes, downscales, upscales and alpha', async () => {
    for (const format of ['rgb8', 'rgba8'] as const) {
      for (const opaque of format === 'rgba8' ? [true, false] : [false]) {
        for (const fit of ['inside', 'outside', 'fill', 'contain', 'cover'] as const) {
          for (const width of [18, 65]) {
            let calls = 0
            const counted: ImageResizeAccelerator = {
              ...wasm,
              async createFilter(request) {
                const session = await wasm.createFilter(request)
                if (!session) throw new Error('Expected WASM filter')
                return {
                  ...session,
                  vertical(...args) {
                    session.vertical(...args)
                    calls++
                  },
                }
              },
            }
            const options: ResizeOptions = {
              width,
              height: width + 7,
              fit,
              background: '#a5894a73',
            }
            expect(await run(format, 43, 39, options, opaque, counted)).toEqual(
              await run(format, 43, 39, options, opaque),
            )
            expect(calls).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('matches repeated translucent bands when a filter footprint or a reused session changes', async () => {
    const width = 201
    const height = 123
    const options = { width: 134, height: 82, fit: 'fill' } as const
    let completed = 0
    const counted: ImageResizeAccelerator = {
      ...wasm,
      async createFilter(request) {
        const filter = await wasm.createFilter(request)
        if (!filter) throw new Error('Expected WASM RGBA filter')
        return {
          ...filter,
          vertical(...args) {
            filter.vertical(...args)
            completed++
          },
        }
      },
    }
    const render = async (seed: number, accelerator?: ImageResizeAccelerator) => {
      async function* input(): AsyncGenerator<PixelBlock> {
        const stride = width * 4
        const data = new Uint8Array(stride)
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const at = x * 4
            data[at] = x + seed
            data[at + 1] = x === 48 || x === 144 ? y * seed : 97
            data[at + 2] = y < 20 ? 33 : 57
            data[at + 3] = y === 36 ? 255 : y < 9 || y > 103 || x < 9 || x > 167 ? 0 : 201
          }
          yield { x: 0, y, width, height: 1, stride, format: 'rgba8', data }
        }
      }
      const resize = createResizeTransform(
        width,
        height,
        'rgba8',
        options,
        undefined,
        undefined,
        false,
        accelerator,
      )
      const output: Uint8Array[] = []
      for await (const block of resize.apply(input())) output.push(block.data)
      return output
    }
    for (const seed of [3, 17]) {
      expect(await render(seed, counted)).toEqual(await render(seed))
    }
    expect(completed).toBe(2 * options.height)
  })

  it('updates WASM views when a pooled filter needs a wider source footprint', async () => {
    const width = 4096
    const outputWidth = 65
    const source = Uint8Array.from({ length: width * 4 }, (_, i) => (i * 17 + (i >>> 7)) & 255)
    for (let i = 3; i < source.length; i += 4) source[i] = 255
    const vertical = {
      offsets: Uint32Array.of(0, 1),
      indices: Uint32Array.of(0),
      weights: Float64Array.of(1),
    }
    for (const wide of [false, true, false]) {
      const indices = Uint32Array.from({ length: outputWidth }, (_, x) =>
        wide && x % 2 === 0 ? width - x - 1 : x,
      )
      const filter = await wasm.createFilter({
        sourceWidth: width,
        format: 'rgba8',
        outputChannels: 4,
        opaque: false,
        capacity: 1,
        horizontal: {
          offsets: Uint32Array.from({ length: outputWidth + 1 }, (_, i) => i),
          indices,
          weights: new Float64Array(outputWidth).fill(1),
        },
      })
      if (!filter) throw new Error('Expected WASM RGBA filter')
      filter.horizontal(source, 0)
      const output = new Uint8Array(outputWidth * 4)
      filter.vertical(vertical, 0, 1, output, 0)
      const expected = new Uint8Array(output.length)
      for (const [x, index] of indices.entries()) {
        expected.set(source.subarray(index * 4, index * 4 + 4), x * 4)
      }
      expect(output).toEqual(expected)
      filter.release?.()
    }
  })

  it.each(['horizontal', 'vertical'] as const)(
    'recovers after a late %s failure',
    async (phase) => {
      let completed = 0
      let faults = 0
      let releases = 0
      const failing: ImageResizeAccelerator = {
        ...wasm,
        async createFilter(request) {
          const s = await wasm.createFilter(request)
          if (!s) return undefined
          return {
            ...s,
            release() {
              s.release?.()
              releases++
            },
            horizontal(...args) {
              s.horizontal(...args)
              if (phase === 'horizontal' && completed >= 32) {
                faults++
                throw new Error('injected')
              }
            },
            vertical(...args) {
              if (phase === 'vertical' && completed >= 32) {
                faults++
                throw new Error('injected')
              }
              s.vertical(...args)
              completed++
            },
          }
        },
      }
      const options = { width: 61, height: 99, fit: 'fill' } as const
      expect(await run('rgba8', 83, 101, options, false, failing)).toEqual(
        await run('rgba8', 83, 101, options, false),
      )
      expect(faults).toBe(1)
      expect(releases).toBe(1)
    },
  )
})

it('preserves output when loading fails and leaves unsupported kernels to TypeScript', async () => {
  let attempts = 0
  const unavailable = createWasmResizeAcceleratorWithLoader(async () => {
    attempts++
    throw new Error('offline')
  })
  for (const kernel of ['nearest', 'bilinear', 'lanczos3'] as const) {
    const options = { width: 19, kernel }
    expect(await run('rgb8', 31, 37, options, false, unavailable)).toEqual(
      await run('rgb8', 31, 37, options, false),
    )
    expect(attempts).toBe(kernel === 'lanczos3' ? 2 : 0)
  }
})

it('rejects duplicate accelerator IDs and ambiguous resize registrations', () => {
  const accelerator = createWasmResizeAccelerator()
  for (const second of [accelerator, { ...accelerator, id: 'other' }]) {
    expect(() =>
      createNodeImageLibrary({ codecs: [], accelerators: [accelerator, second] }),
    ).toThrow(/already registered/)
  }
})

it('isolates simultaneous pipelines and registers the filter on the public library', async () => {
  const { pngCodec } = await import('../src/codec-entries/png.ts')
  const { PNG } = await import('pngjs')
  const wasm = createWasmResizeAccelerator()
  let sessions = 0
  const accelerator: ImageResizeAccelerator = {
    ...wasm,
    async createFilter(request) {
      const session = await wasm.createFilter(request)
      if (session) sessions++
      return session
    },
  }
  const input = new PNG({ width: 79, height: 87 })
  for (let i = 0; i < input.data.length; i++) input.data[i] = (i * 97 + (i >>> 5)) & 255
  const bytes = PNG.sync.write(input)
  const library = createNodeImageLibrary({ codecs: [pngCodec], accelerators: [accelerator] })
  const reference = createNodeImageLibrary([pngCodec])
  const render = async (lib: typeof library, width: number) =>
    (await lib.open(bytes))
      .crop({ x: 3, y: 5, width: 71, height: 79 })
      .resize({ width })
      .png()
      .toBuffer()
  expect(await Promise.all([render(library, 33), render(library, 49)])).toEqual(
    await Promise.all([render(reference, 33), render(reference, 49)]),
  )
  expect(sessions).toBe(2)
})

describe.each(['scalar', 'simd'] as const)('box shrink %s', (variant) => {
  const wasm = createWasmResizeAccelerator({ variant })
  it('matches full and partial box stages including one-axis groups', async () => {
    for (const format of ['rgba8', 'rgb8'] as const) {
      for (const [width, height] of [
        [16, 40],
        [23, 59],
        [64, 40],
        [16, 160],
      ] as const) {
        let adds = 0
        let writes = 0
        const counted: ImageResizeAccelerator = {
          ...wasm,
          async createBox(...args) {
            const box = await wasm.createBox?.(...args)
            if (!box) return undefined
            return {
              get sums() {
                return box.sums
              },
              add(...args) {
                box.add(...args)
                adds++
              },
              write(...args) {
                box.write(...args)
                writes++
              },
            }
          },
        }
        const options = { width, height, fit: 'fill' } as const
        expect(await run(format, 64, 160, options, false, counted)).toEqual(
          await run(format, 64, 160, options, false),
        )
        expect(adds).toBe(160)
        expect(writes).toBeGreaterThan(0)
      }
    }
  })

  it.each(['add', 'write'] as const)(
    'resumes an incomplete group after a late %s failure',
    async (phase) => {
      let adds = 0
      let writes = 0
      let faults = 0
      let releases = 0
      const failing: ImageResizeAccelerator = {
        ...wasm,
        async createBox(...args) {
          const b = await wasm.createBox?.(...args)
          if (!b) return undefined
          return {
            release() {
              b.release?.()
              releases++
            },
            get sums() {
              return b.sums
            },
            add(...args) {
              if (phase === 'add' && ++adds === 134) {
                faults++
                throw new Error('injected')
              }
              b.add(...args)
            },
            write(...args) {
              if (phase === 'write' && ++writes === 34) {
                faults++
                throw new Error('injected')
              }
              b.write(...args)
            },
          }
        },
      }
      const options = { width: 16, height: 40, fit: 'fill' } as const
      expect(await run('rgba8', 64, 160, options, false, failing)).toEqual(
        await run('rgba8', 64, 160, options, false),
      )
      expect(faults).toBe(1)
      expect(releases).toBe(1)
    },
  )
})

it.each(['scalar', 'simd'] as const)(
  'rounds just below half a byte down in %s',
  async (variant) => {
    const accelerator = createWasmResizeAccelerator({ variant })
    const box = await accelerator.createBox?.(2, 'rgba8', 2)
    if (!box) throw new Error('Expected WASM box shrink')
    box.add(Uint8Array.of(0, 0, 0, 49, 1, 1, 1, 49), true)
    const output = new Uint8Array(4)
    box.write(1, output, 0)
    expect(output).toEqual(Uint8Array.of(0, 0, 0, 49))
  },
)

it.each(['simd', 'scalar'] as const)(
  'matches the reference vertical sum on both sides of byte rounding boundaries in %s',
  async (variant) => {
    const accelerator = createWasmResizeAccelerator({ variant })
    const width = 21
    const capacity = 11
    const session = await accelerator.createFilter({
      sourceWidth: width,
      format: 'rgb8',
      outputChannels: 3,
      opaque: false,
      capacity,
      horizontal: {
        offsets: Uint32Array.from({ length: width + 1 }, (_, i) => i),
        indices: Uint32Array.from({ length: width }, (_, i) => i),
        weights: new Float64Array(width).fill(1),
      },
    })
    if (!session) throw new Error('Expected an RGB filter')
    const indices = Uint32Array.from({ length: capacity }, (_, i) => i)
    const weights = Float64Array.from(indices, (i) => Math.sin(i + 1) / 5)
    weights[capacity - 1] = 1
    const axis = { indices, weights, offsets: Uint32Array.of(0, capacity) }
    const output = new Uint8Array(width * 3)
    const expected = new Uint8Array(output.length)
    const last = session.rows[capacity - 1]
    if (!last) throw new Error('Missing final row')
    for (const magnitude of [160, 700]) {
      for (let c = 0; c < output.length; c++) {
        let sum = 0
        for (let i = 0; i < capacity - 1; i++) {
          const row = session.rows[i]
          if (!row) throw new Error('Missing filter row')
          row[c] = Math.cos(i + 2 * c) * magnitude
          sum = Math.fround(sum + (row[c] ?? 0) * (weights[i] ?? 0))
        }
        const target = ((c * 59) % 260) - 2 + 0.5
        last[c] = target + ((c % 3) - 1) * 0.000007 - sum
        expected[c] = Math.min(255, Math.max(0, Math.round(Math.fround(sum + (last[c] ?? 0)))))
      }
      session.vertical(axis, 0, capacity, output, 0)
      expect(output).toEqual(expected)
    }
    session.release?.()
  },
)

it('declines scratch above the working-set limit', async () => {
  const wasm = createWasmResizeAccelerator()
  expect(await wasm.createBox?.(1_000_000, 'rgba8', 1)).toBeUndefined()
  expect(
    await wasm.createFilter({
      sourceWidth: 1,
      format: 'rgb8',
      outputChannels: 3,
      opaque: false,
      capacity: 300,
      horizontal: {
        offsets: Uint32Array.of(0, 1),
        indices: Uint32Array.of(0),
        weights: Float64Array.of(1),
      },
    }),
  ).toBeUndefined()
})

it('declines an RGBA block with invalid geometry through the reference validation', async () => {
  const transform = createResizeTransform(
    5,
    6,
    'rgba8',
    { width: 4 },
    undefined,
    undefined,
    false,
    createWasmResizeAccelerator(),
  )
  async function* invalid(): AsyncGenerator<PixelBlock> {
    yield { x: 0, y: 0, width: 5, height: 6, format: 'rgba8', stride: 20, data: new Uint8Array(7) }
  }
  await expect(transform.apply(invalid())[Symbol.asyncIterator]().next()).rejects.toThrow(
    'ordered, full-width',
  )
})

it('resumes on a fresh lease after cancelling a streamed resize', async () => {
  const wasm = createWasmResizeAccelerator()
  const reference = await run('rgb8', 91, 83, { width: 79 }, false)
  const data = new Uint8Array(91 * 83 * 3).fill(128)
  let released = 0
  const source = async function* (): AsyncGenerator<PixelBlock> {
    yield {
      x: 0,
      y: 0,
      width: 91,
      height: 83,
      stride: 91 * 3,
      format: 'rgb8',
      data,
      release: () => {
        released++
      },
    }
  }
  const transform = createResizeTransform(
    91,
    83,
    'rgb8',
    { width: 79 },
    undefined,
    undefined,
    false,
    wasm,
  )
  const iter = transform.apply(source())[Symbol.asyncIterator]()
  expect((await iter.next()).done).toBe(false)
  await iter.return?.()
  expect(released).toBe(1)
  expect(await run('rgb8', 91, 83, { width: 79 }, false, wasm)).toEqual(reference)
})

it('keeps grayscale and linear-light work on the reference path', async () => {
  let attempted = 0
  const unused: ImageResizeAccelerator = {
    transform: 'resize',
    kind: 'runtime',
    id: 'unused',
    async createFilter() {
      attempted++
      return undefined
    },
    async createBox() {
      attempted++
      return undefined
    },
  }
  for (const format of ['gray8', 'gray16'] as const) {
    const stride = format === 'gray8' ? 16 : 32
    async function* blocks(): AsyncGenerator<PixelBlock> {
      yield { x: 0, y: 0, width: 16, height: 8, format, stride, data: new Uint8Array(stride * 8) }
    }
    const resize = createResizeTransform(
      16,
      8,
      format,
      { width: 4 },
      undefined,
      undefined,
      false,
      unused,
    )
    for await (const b of resize.apply(blocks())) expect(b.width).toBe(4)
  }
  async function* rgb(): AsyncGenerator<PixelBlock> {
    yield {
      x: 0,
      y: 0,
      width: 9,
      height: 7,
      format: 'rgb8',
      stride: 27,
      data: new Uint8Array(189).fill(123),
    }
  }
  const linear = createResizeTransform(
    9,
    7,
    'rgb8',
    { width: 5, colorSpace: 'linear-light' },
    {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'none',
      provenance: 'container-signaled',
    },
    undefined,
    false,
    unused,
  )
  for await (const b of linear.apply(rgb())) expect(b.data.every((v) => v === 123)).toBe(true)
  expect(attempted).toBe(0)
})

it.each(['scalar', 'simd'] as const)(
  'matches narrow and asymmetric resize grids in %s',
  async (variant) => {
    const wasm = createWasmResizeAccelerator({ variant })
    const dimensions = [
      [1, 43, 19, 7],
      [47, 1, 11, 21],
      [1, 1, 9, 17],
      [48, 33, 3, 19],
      [51, 64, 29, 4],
      [17, 23, 17, 23],
      [127, 13, 1, 5],
      [5, 119, 7, 1],
      [64, 48, 8, 6],
      [63, 47, 8, 6],
      [15, 15, 64, 64],
    ] as const
    for (const [w, h, width, height] of dimensions) {
      for (const format of ['rgb8', 'rgba8'] as const) {
        for (const fit of ['cover', 'contain', 'fill'] as const) {
          const options: ResizeOptions = {
            width,
            height,
            fit,
            ...(fit === 'contain' ? { withoutEnlargement: true } : {}),
          }
          expect(await run(format, w, h, options, false, wasm)).toEqual(
            await run(format, w, h, options, false),
          )
        }
      }
    }
  },
)

it('loads scalar on SIMD compilation failure and declines a mismatched forced build', async () => {
  const { readFile } = await import('node:fs/promises')
  const scalar = await WebAssembly.compile(
    await readFile(new URL('../src/accelerator-entries/resize.wasm', import.meta.url)),
  )
  const loads: string[] = []
  const automatic = createWasmResizeAcceleratorWithLoader(async (variant) => {
    loads.push(variant)
    if (variant === 'simd') throw new Error('Unsupported SIMD')
    return scalar
  })
  expect(await automatic.createBox?.(4, 'rgba8', 2)).toBeDefined()
  expect(loads).toEqual(['simd', 'scalar'])
  const wrong = createWasmResizeAcceleratorWithLoader(async () => scalar, { variant: 'simd' })
  expect(await wrong.createBox?.(4, 'rgba8', 2)).toBeUndefined()
})

it('reuses only released full box blocks and preserves a retained block', async () => {
  const width = 8
  const height = 400
  const data = Uint8Array.from({ length: width * height * 3 }, (_, i) => (i + (i >>> 5)) & 255)
  async function* input(): AsyncGenerator<PixelBlock> {
    yield { x: 0, y: 0, width, height, format: 'rgb8', stride: width * 3, data }
  }
  const resize = (accelerator?: ImageResizeAccelerator) =>
    createResizeTransform(
      width,
      height,
      'rgb8',
      { width: 2 },
      undefined,
      undefined,
      false,
      accelerator,
    ).apply(input())
  const expected: Uint8Array[] = []
  for await (const b of resize()) expected.push(b.data.slice())
  const blocks: PixelBlock[] = []
  for await (const b of resize(createWasmResizeAccelerator())) {
    expect(b.data).toEqual(expected[blocks.length])
    blocks.push(b)
    if (blocks.length === 2) b.release?.()
    if (blocks.length === 3) blocks[0]?.release?.()
  }
  expect(blocks.map((b) => b.height)).toEqual([32, 32, 32, 4])
  expect(blocks[0]?.data).toEqual(expected[0])
  expect(blocks[0]?.data).not.toBe(blocks[1]?.data)
  expect(blocks[1]?.data).toBe(blocks[2]?.data)
  expect(blocks[3]?.data.byteLength).toBe(4 * 2 * 3)
})
