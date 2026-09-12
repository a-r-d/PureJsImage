import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { hashM8Frame } from '../benchmark/jpegxl/m8-output-digest.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { openJpegXlSequence } from '../src/codecs/jpegxl-sequence.ts'
import type { JpegXlAnimationInputFrame } from '../src/codecs/jpegxl-sequence-encode.ts'
import { encodeJpegXlAnimation } from '../src/codecs/jpegxl-sequence-encode.ts'
import type { PixelColorSemantics } from '../src/color.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import icos from './fixtures/jpegxl/m8-sequence/icos4d.frames.json' with { type: 'json' }
import newtons from './fixtures/jpegxl/m8-sequence/newtons-cradle.frames.json' with { type: 'json' }
import spline from './fixtures/jpegxl/m8-sequence/spline.frames.json' with { type: 'json' }

const fixture = async (name: string) =>
  new Uint8Array(
    await readFile(new URL(`./fixtures/jpegxl/m8-sequence/${name}.jxl`, import.meta.url)),
  )
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const rgba = (planes: readonly Float64Array[], width: number, height: number): Uint8Array => {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++)
    for (let c = 0; c < 4; c++)
      data[i * 4 + c] = Math.round(Math.max(0, Math.min(1, planes[c]?.[i] ?? 1)) * 255)
  return data
}
const semantics: PixelColorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'straight',
  provenance: 'container-signaled',
  renderingIntent: 'relative',
}
const animation = {
  ticksPerSecondNumerator: 30000,
  ticksPerSecondDenominator: 1001,
  loops: 3,
  haveTimecodes: true,
}
const collect = async (source: AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of source) {
    chunks.push(chunk)
    size += chunk.length
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
const inputFrames = async function* (): AsyncGenerator<JpegXlAnimationInputFrame> {
  yield {
    width: 8,
    height: 8,
    data: new Uint8Array(8 * 8 * 4).fill(255),
    durationTicks: 2,
    timecode: 17,
  }
  yield {
    width: 2,
    height: 3,
    x: 2,
    y: 1,
    source: 1,
    data: new Uint8Array(2 * 3 * 4),
    durationTicks: 7,
    timecode: 19,
  }
}
const options = {
  width: 8,
  height: 8,
  pixelFormat: 'rgba8' as const,
  colorSemantics: semantics,
  animation,
}

describe('M8 animation sequence', () => {
  it.each([
    ['newtons-cradle', newtons],
    ['icos4d', icos],
    ['spline', spline],
  ] as const)(
    'reproduces every independently qualified frame of %s',
    async (name, expected) => {
      const sequence = await openJpegXlSequence(await fixture(name))
      let count = 0
      try {
        for await (const frame of sequence.frames()) {
          const reference = expected[count]
          expect(reference).toBeDefined()
          expect(frame.index).toBe(count)
          expect(frame.startTicks.toString()).toBe(reference?.startTicks)
          expect(frame.durationTicks).toBe(reference?.durationTicks)
          expect(digest(rgba(frame.planes, frame.width, frame.height))).toBe(reference?.sha256)
          expect(reference?.maxError).toBeLessThanOrEqual(name === 'newtons-cradle' ? 0 : 1)
          count++
        }
        expect(count).toBe(expected.length)
      } finally {
        await sequence.close()
      }
    },
    120000,
  )
  it('replays frame dependencies and isolates caller-owned output from reference slots', async () => {
    const sequence = await openJpegXlSequence(await fixture('newtons-cradle'))
    const iterator = sequence.frames()[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done) throw new Error('Missing frame')
    first.value.planes[0]?.fill(0)
    const second = await iterator.next()
    if (second.done) throw new Error('Missing second frame')
    expect(digest(rgba(second.value.planes, 480, 360))).toBe(newtons[1]?.sha256)
    await iterator.return?.()
    expect(digest(rgba((await sequence.frame(1)).planes, 480, 360))).toBe(newtons[1]?.sha256)
    await sequence.close()
    await expect(sequence.frame(0)).rejects.toBeDefined()
  })
  it('enforces frame and working-memory limits and cancellation', async () => {
    const data = await fixture('newtons-cradle')
    const bounded = await openJpegXlSequence(data, { limits: { maxFrames: 1 } })
    await expect(bounded.frame(1)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await bounded.close()
    const memory = await openJpegXlSequence(data, { limits: { maxDecodedBytes: 1000000 } })
    await expect(memory.frame(0)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await memory.close()
    const sequence = await openJpegXlSequence(data)
    const controller = new AbortController()
    const iterator = sequence.frames(controller.signal)[Symbol.asyncIterator]()
    await iterator.next()
    controller.abort()
    await expect(iterator.next()).rejects.toBeDefined()
    await sequence.close()
  })
  it.each(['lossless', 'lossy'])(
    'writes %s rectangle frames with exact rational timing',
    async (mode) => {
      const encoded = await collect(
        encodeJpegXlAnimation(inputFrames(), { ...options, encoding: { mode } }),
      )
      const sequence = await openJpegXlSequence(encoded)
      const first = await sequence.frame(0)
      const second = await sequence.frame(1)
      expect(first.header.animation).toEqual(animation)
      expect(second.startTicks).toBe('2')
      expect((await sequence.frameAtTicks('3')).index).toBe(1)
      await expect(sequence.frameAtTicks('9')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
      expect(second.durationTicks).toBe(7)
      expect(first.header.timecode).toBe(17)
      expect(second.header.timecode).toBe(19)
      expect(second.planes[3]?.[0]).toBe(1)
      expect(second.planes[3]?.[1 * 8 + 2]).toBe(0)
      if (mode === 'lossless') {
        expect(second.planes[0]?.[0]).toBe(1)
        expect(second.planes[0]?.[1 * 8 + 2]).toBe(0)
      }
      await sequence.close()
    },
  )
  it('pulls one lookahead and returns the input iterator on early output cancellation', async () => {
    let pulled = 0,
      returned = false
    async function* source() {
      try {
        for (let i = 0; i < 20; i++) {
          pulled++
          yield { width: 8, height: 8, data: new Uint8Array(256), durationTicks: 1 }
        }
      } finally {
        returned = true
      }
    }
    const iterator = encodeJpegXlAnimation(source(), options)
    await iterator.next()
    expect(pulled).toBe(2)
    await iterator.return(undefined)
    expect(returned).toBe(true)
    expect(pulled).toBe(2)
  })
  it('rejects empty inputs, invalid timing and output overflow', async () => {
    async function* empty(): AsyncGenerator<JpegXlAnimationInputFrame> {
      yield* []
    }
    await expect(collect(encodeJpegXlAnimation(empty(), options))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(
      collect(
        encodeJpegXlAnimation(inputFrames(), {
          ...options,
          animation: { ...animation, ticksPerSecondDenominator: 0 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      collect(encodeJpegXlAnimation(inputFrames(), { ...options, maxOutputBytes: 4 })),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})

it.each(['weighted-patches', 'weighted-patches-lossy'])(
  'matches native float samples for all eight patch blend modes in %s',
  async (name) => {
    const base = new URL('./fixtures/jpegxl/m8-static/', import.meta.url)
    const sequence = await openJpegXlSequence(await readFile(new URL(`${name}.jxl`, base)))
    const native = await readFile(new URL(`${name}.reference.f32`, base))
    let offset = 0
    try {
      for await (const frame of sequence.frames()) {
        for (let i = 0; i < frame.width * frame.height; i++)
          for (let c = 0; c < 4; c++) {
            expect(
              Math.abs((frame.planes[c]?.[i] ?? NaN) - native.readFloatLE(offset)),
            ).toBeLessThan(0.00001)
            offset += 4
          }
      }
      expect(offset).toBe(native.length)
    } finally {
      await sequence.close()
    }
  },
)

it('enforces cumulative encoding and decoding work independently of frame count', async () => {
  await expect(
    collect(encodeJpegXlAnimation(inputFrames(), { ...options, maxEncodedPixels: 64 })),
  ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  const bytes = await collect(encodeJpegXlAnimation(inputFrames(), options))
  const sequence = await openJpegXlSequence(bytes, { maxDecodedPixels: 64 })
  try {
    await expect(sequence.frame(1)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  } finally {
    await sequence.close()
  }
})

it('rejects illegal pre-transform reference requests and oversized timing fields', async () => {
  for (const invalid of [
    { durationTicks: 2 ** 32 },
    { timecode: -1 },
    { saveBeforeColorTransform: true },
  ]) {
    async function* frames() {
      yield { width: 8, height: 8, data: new Uint8Array(256), durationTicks: 1, ...invalid }
    }
    await expect(collect(encodeJpegXlAnimation(frames(), options))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  }
})

it('does not reuse emitted writer buffers', async () => {
  const expected = await collect(encodeJpegXlAnimation(inputFrames(), options))
  const copies: Uint8Array[] = []
  for await (const part of encodeJpegXlAnimation(inputFrames(), options)) {
    copies.push(part.slice())
    part.fill(0)
  }
  expect(Buffer.concat(copies)).toEqual(Buffer.from(expected))
})

it('requires explicit displayed-frame selection through the ordinary still API', async () => {
  const bytes = await fixture('newtons-cradle')
  await expect(
    jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits),
  ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, {
    frame: 1,
  })
  if (!decoder) throw new Error('Missing decoder')
  const hash = createHash('sha256')
  for await (const block of decoder.decode()) {
    try {
      hash.update(block.data)
    } finally {
      block.release?.()
    }
  }
  expect(hash.digest('hex')).toBe(newtons[1]?.sha256)
})

it('labels wide-gamut XYB sequence reconstruction with its emitted sRGB transfer', async () => {
  const input = await readFile(
    new URL('./fixtures/jpegxl/m8-static/wide-gamut.jxl', import.meta.url),
  )
  const sequence = await openJpegXlSequence(input)
  try {
    const frame = await sequence.frame(0)
    const hash = createHash('sha256')
    hashM8Frame(hash, frame)
    expect(hash.digest('hex')).toBe(
      'a15cc7f3089ba7fd3ee5d06de8683f2ec70211a38ca604a4c0b883e9d21400f8',
    )
    expect(frame.header.colorSemanticsPrimaries).toBe('display-p3')
    expect(frame.colorSemantics.primaries).toBe('srgb')
    expect(frame.colorSemantics.transfer).toEqual({ kind: 'srgb' })
    expect(frame.colorSemantics.provenance).toBe('decoder-converted')
  } finally {
    await sequence.close()
  }
})

it('keeps large duration ticks exact through replay and JSON serialization', async () => {
  async function* frames() {
    for (let i = 0; i < 3; i++)
      yield {
        width: 1,
        height: 1,
        data: new Uint8Array([12, 34, 56, 255]),
        durationTicks: 0xffffffff,
      }
  }
  const bytes = await collect(encodeJpegXlAnimation(frames(), { ...options, width: 1, height: 1 }))
  const sequence = await openJpegXlSequence(bytes)
  try {
    const selected = await sequence.frame(2)
    expect(selected.startTicks).toBe('8589934590')
    expect(selected.durationTicks).toBe(0xffffffff)
    expect(JSON.parse(JSON.stringify(selected))).toMatchObject({
      startTicks: '8589934590',
      durationTicks: 0xffffffff,
    })
    expect((await sequence.frameAtTicks(8589934591n)).index).toBe(2)
  } finally {
    await sequence.close()
  }
})
