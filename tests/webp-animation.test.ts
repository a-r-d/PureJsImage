import { PNG } from 'pngjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { encodeWebpAnimation, openWebpAnimation } from '../src/codec-entries/webp.ts'
import { syntheticAnimatedGif } from './helpers/animated-fixtures.ts'
import { Image } from './image-library.ts'

/** Every composited frame from Sharp/libwebp, the independent decoder. */
const libwebpFrames = async (bytes: Uint8Array): Promise<Uint8Array[]> => {
  const { data, info } = await sharp(bytes, { animated: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pageHeight = info.pageHeight ?? info.height
  const pageBytes = info.width * pageHeight * 4
  return Array.from({ length: info.height / pageHeight }, (_, index) =>
    Uint8Array.from(data.subarray(index * pageBytes, (index + 1) * pageBytes)),
  )
}

const ourFrames = async (bytes: Uint8Array) => {
  const animation = await openWebpAnimation(bytes)
  const frames: Uint8Array[] = []
  const durations: number[] = []
  for await (const frame of animation.frames()) {
    frames.push(frame.data.slice())
    durations.push(frame.durationMs)
  }
  return { animation, frames, durations }
}

const psnr = (reference: Uint8Array, actual: Uint8Array): number => {
  let error = 0
  for (let index = 0; index < reference.byteLength; index += 1) {
    const difference = (reference[index] ?? 0) - (actual[index] ?? 0)
    error += difference * difference
  }
  return error === 0
    ? Number.POSITIVE_INFINITY
    : 10 * Math.log10((255 * 255) / (error / reference.byteLength))
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b))

// Frames with a moving square, a soft half-transparent band, and transparent background.
const syntheticFrames = (width: number, height: number, count: number) =>
  Array.from({ length: count }, (_, frame) => {
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        if (y >= 20 && y < 26) data.set([40, 160, 220, 64 + x * 2], offset)
        const inside = x >= frame * 6 && x < frame * 6 + 12 && y >= 4 && y < 16
        if (inside) data.set([230, 60 + frame * 25, 30, 255], offset)
      }
    }
    return { data, durationMs: 40 + frame * 10 }
  })

describe('Animated WebP decoding', () => {
  it('matches libwebp exactly for lossless frames, including partial-alpha blending', async () => {
    const frames = syntheticFrames(64, 32, 6)
    const strip = Buffer.concat(frames.map((frame) => Buffer.from(frame.data)))
    const input = await sharp(strip, {
      raw: { width: 64, height: 32 * 6, channels: 4, pageHeight: 32 },
    })
      .webp({ lossless: true, loop: 2, delay: frames.map((frame) => frame.durationMs) })
      .toBuffer()
    const reference = await libwebpFrames(input)
    const decoded = await ourFrames(input)

    expect(decoded.animation.loop).toBe(2)
    expect(decoded.durations).toEqual(frames.map((frame) => frame.durationMs))
    expect(decoded.frames).toHaveLength(reference.length)
    for (const [index, frame] of reference.entries()) {
      expect(same(decoded.frames[index] ?? new Uint8Array(), frame)).toBe(true)
    }
  })

  it('stays within the lossy WebP tolerance for lossy frames', async () => {
    const input = await sharp(Buffer.from(syntheticAnimatedGif()), { animated: true })
      .webp({ quality: 75 })
      .toBuffer()
    const reference = await libwebpFrames(input)
    const decoded = await ourFrames(input)
    expect(decoded.frames).toHaveLength(12)
    for (const [index, frame] of reference.entries()) {
      expect(psnr(frame, decoded.frames[index] ?? new Uint8Array())).toBeGreaterThan(30)
    }
  })

  it('selects one composited frame and keeps animation requests explicit', async () => {
    const frames = syntheticFrames(64, 32, 12)
    const strip = Buffer.concat(frames.map((frame) => Buffer.from(frame.data)))
    const input = await sharp(strip, {
      raw: { width: 64, height: 32 * 12, channels: 4, pageHeight: 32 },
    })
      .webp({ lossless: true })
      .toBuffer()
    const reference = await libwebpFrames(input)
    const tenth = await (await Image.open(input, { frame: 10 })).png().toBuffer()
    expect(same(PNG.sync.read(tenth).data, reference[10] ?? new Uint8Array())).toBe(true)

    await expect((await Image.open(input)).png().toBuffer()).rejects.toThrow(/animated: true/)
    await expect((await Image.open(input, { frame: 12 })).png().toBuffer()).rejects.toThrow(
      /does not exist/,
    )
    await expect((await Image.open(input, { animated: true })).png().toBuffer()).rejects.toThrow(
      /png animation encoding is not implemented/,
    )
  })

  it('treats a still WebP as one frame', async () => {
    const still = await sharp({
      create: { width: 9, height: 7, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 1 } },
    })
      .webp({ lossless: true })
      .toBuffer()
    const png = await (await Image.open(still, { animated: true })).png().toBuffer()
    expect(PNG.sync.read(png).width).toBe(9)
    const webp = await (await Image.open(still, { animated: true }))
      .webp({ lossless: true })
      .toBuffer()
    const decoded = await ourFrames(webp)
    expect(decoded.frames).toHaveLength(1)
  })
})

describe('Animated WebP encoding', () => {
  it('writes lossless frames that libwebp decodes exactly', async () => {
    const frames = syntheticFrames(64, 32, 6)
    const chunks: Uint8Array[] = []
    for await (const chunk of encodeWebpAnimation(frames, {
      width: 64,
      height: 32,
      lossless: true,
      loop: 3,
    })) {
      chunks.push(chunk)
    }
    const output = Buffer.concat(chunks)
    const reference = await libwebpFrames(output)
    expect(reference).toHaveLength(6)
    for (const [index, frame] of frames.entries()) {
      expect(same(reference[index] ?? new Uint8Array(), frame.data)).toBe(true)
    }
    const decoded = await ourFrames(output)
    expect(decoded.animation.loop).toBe(3)
    expect(decoded.durations).toEqual(frames.map((frame) => frame.durationMs))
  })

  it('converts an animated GIF to lossy WebP and back', async () => {
    const input = syntheticAnimatedGif()
    const webp = await (await Image.open(input, { animated: true }))
      .webp({ quality: 85 })
      .toBuffer()
    const source = await libwebpFrames(input)
    const reference = await libwebpFrames(webp)
    expect(reference).toHaveLength(12)
    for (const [index, frame] of source.entries()) {
      // Lossy VP8 subsamples chroma, which costs most on saturated flat-color edges.
      expect(psnr(frame, reference[index] ?? new Uint8Array())).toBeGreaterThan(26)
    }
    const gif = await (await Image.open(webp, { animated: true }))
      .resize({ width: 50 })
      .gif()
      .toBuffer()
    const metadata = await (await Image.open(gif)).metadata()
    expect({ frames: metadata.frames, width: metadata.width }).toEqual({ frames: 12, width: 50 })
  })

  it('rejects frames of the wrong size and invalid loop counts', async () => {
    const encode = async (data: Uint8Array) => {
      for await (const _chunk of encodeWebpAnimation([{ data, durationMs: 10 }], {
        width: 4,
        height: 4,
      })) {
        // Drain the generator.
      }
    }
    await expect(encode(new Uint8Array(10))).rejects.toThrow(/RGBA8 bytes/)
    const image = await Image.open(syntheticAnimatedGif(), { animated: true })
    expect(() => image.webp({ loop: -1 })).toThrow(/loop/)
  })
})
