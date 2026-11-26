import { GifReader, GifWriter } from 'omggif'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { encodeGifAnimation, openGifAnimation } from '../src/codec-entries/gif.ts'
import { syntheticAnimatedGif, syntheticPhotoPng } from './helpers/animated-fixtures.ts'
import { Image } from './image-library.ts'

const rgbaPng = (width: number, height: number, color: (x: number, y: number) => number[]) => {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      image.data.set(color(x, y), (y * width + x) * 4)
    }
  }
  return PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 })
}

/** Composites every frame with the independent omggif decoder, clearing disposal-2 frames. */
const composite = (bytes: Uint8Array) => {
  const reader = new GifReader(Buffer.from(bytes))
  const canvas = new Uint8Array(reader.width * reader.height * 4)
  const frames: Uint8Array[] = []
  for (let index = 0; index < reader.numFrames(); index += 1) {
    const info = reader.frameInfo(index)
    const saved = info.disposal === 3 ? canvas.slice() : undefined
    reader.decodeAndBlitFrameRGBA(index, canvas)
    frames.push(canvas.slice())
    if (info.disposal === 2) {
      for (let y = info.y; y < info.y + info.height; y += 1) {
        const start = (y * reader.width + info.x) * 4
        canvas.fill(0, start, start + info.width * 4)
      }
    }
    if (saved) canvas.set(saved)
  }
  return {
    width: reader.width,
    height: reader.height,
    loop: reader.loopCount(),
    delays: Array.from({ length: reader.numFrames() }, (_, index) => reader.frameInfo(index).delay),
    frames,
  }
}

const psnr = (reference: Uint8Array, actual: Uint8Array): number => {
  let error = 0
  let samples = 0
  for (let index = 0; index < reference.byteLength; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = (reference[index + channel] ?? 0) - (actual[index + channel] ?? 0)
      error += difference * difference
      samples += 1
    }
  }
  return 10 * Math.log10((255 * 255) / (error / samples))
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b))

/** RGB PSNR over pixels the reference shows as opaque; GIF transparency must agree everywhere. */
const opaquePsnr = (reference: Uint8Array, actual: Uint8Array): number => {
  let error = 0
  let samples = 0
  for (let index = 0; index < reference.byteLength; index += 4) {
    const opaque = (reference[index + 3] ?? 0) >= 128
    expect((actual[index + 3] ?? 0) >= 128).toBe(opaque)
    if (!opaque) continue
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = (reference[index + channel] ?? 0) - (actual[index + channel] ?? 0)
      error += difference * difference
      samples += 1
    }
  }
  return error === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / (error / samples))
}

describe('GIF encoding', () => {
  it('writes an exact palette with transparency when the image has few colors', async () => {
    const colors = [
      [12, 80, 160, 255],
      [240, 180, 20, 255],
      [30, 30, 30, 255],
      [0, 0, 0, 0],
    ]
    const input = rgbaPng(37, 21, (x, y) => colors[((x >> 2) + (y >> 1)) % colors.length] ?? [])
    const output = await (await Image.open(input)).gif().toBuffer()
    const decoded = composite(output)

    expect(decoded.frames).toHaveLength(1)
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 37, height: 21 })
    expect(same(decoded.frames[0] ?? new Uint8Array(), PNG.sync.read(input).data)).toBe(true)
  })

  it('quantizes a photo to 256 colors with and without dithering', async () => {
    const photo = syntheticPhotoPng(300, 300)
    const reference = PNG.sync.read(photo).data
    for (const dither of [0, 1]) {
      const output = await (await Image.open(photo)).gif({ dither }).toBuffer()
      const decoded = composite(output)
      expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 300, height: 300 })
      // The synthetic photo carries five levels of noise, which no 256-color palette keeps.
      expect(psnr(reference, decoded.frames[0] ?? new Uint8Array())).toBeGreaterThan(
        dither === 0 ? 34 : 33,
      )
    }
  })

  it('writes gray input as gray palette entries', async () => {
    const gray = new PNG({ width: 64, height: 8, colorType: 0, inputColorType: 0, bitDepth: 8 })
    for (let index = 0; index < 64 * 8; index += 1) gray.data[index] = (index * 3) & 0xff
    const input = PNG.sync.write(gray, { colorType: 0, inputColorType: 0, bitDepth: 8 })
    const decoded = composite(await (await Image.open(input)).gif().toBuffer())
    const pixels = decoded.frames[0] ?? new Uint8Array()
    for (let index = 0; index < 64 * 8; index += 1) {
      const value = (index * 3) & 0xff
      expect([pixels[index * 4], pixels[index * 4 + 1], pixels[index * 4 + 2]]).toEqual([
        value,
        value,
        value,
      ])
    }
  })

  it('rejects invalid GIF options', async () => {
    const image = await Image.open(rgbaPng(2, 2, () => [1, 2, 3, 255]))
    expect(() => image.gif({ dither: 2 })).toThrow(/dither/)
    expect(() => image.gif({ loop: -1 })).toThrow(/loop/)
    expect(() => image.gif({ loop: 1.5 })).toThrow(/loop/)
  })
})

describe('Animated GIF', () => {
  it('round-trips every composited frame, delay and loop count', async () => {
    const input = syntheticAnimatedGif()
    const source = composite(input)
    const output = await (await Image.open(input, { animated: true })).gif().toBuffer()
    const decoded = composite(output)

    expect(decoded.frames).toHaveLength(12)
    expect(decoded.loop).toBe(source.loop)
    expect(decoded.delays).toEqual(source.delays)
    for (const [index, frame] of source.frames.entries()) {
      expect(same(decoded.frames[index] ?? new Uint8Array(), frame)).toBe(true)
    }
  })

  it('resizes every frame', async () => {
    const input = syntheticAnimatedGif()
    const output = await (await Image.open(input, { animated: true }))
      .resize({ width: 96 })
      .gif()
      .toBuffer()
    const decoded = composite(output)
    expect(decoded.frames).toHaveLength(12)
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 96, height: 80 })
    for (const index of [0, 6, 11]) {
      const single = await (await Image.open(input, { frame: index }))
        .resize({ width: 96 })
        .png()
        .toBuffer()
      // Disposal clears holes in this animation, so compare color only where pixels are opaque.
      const reference = PNG.sync.read(single).data
      const frame = decoded.frames[index] ?? new Uint8Array()
      expect(opaquePsnr(reference, frame)).toBeGreaterThan(35)
    }
  })

  it('clears pixels that later frames make transparent', async () => {
    const width = 40
    const height = 24
    const frames = Array.from({ length: 6 }, (_, frame) => {
      const data = new Uint8Array(width * height * 4)
      for (let y = 6; y < 18; y += 1) {
        for (let x = frame * 5; x < frame * 5 + 10; x += 1) {
          data.set([200, 40 + frame * 30, 90, 255], (y * width + x) * 4)
        }
      }
      return { data, durationMs: 50 + frame * 10 }
    })
    const chunks: Uint8Array[] = []
    for await (const chunk of encodeGifAnimation(frames, { width, height, loop: 3 })) {
      chunks.push(chunk)
    }
    const decoded = composite(Buffer.concat(chunks))
    expect(decoded.loop).toBe(3)
    expect(decoded.delays).toEqual([5, 6, 7, 8, 9, 10])
    for (const [index, frame] of frames.entries()) {
      expect(same(decoded.frames[index] ?? new Uint8Array(), frame.data)).toBe(true)
    }
  })

  it('keeps opaque black opaque when a later frame reuses a palette with transparency', async () => {
    const width = 8
    const height = 4
    // Row 0 is black and red, row 1 is transparent; the second frame turns part of row 2 black.
    const first = new Uint8Array(width * height * 4)
    for (let x = 0; x < 4; x += 1) first.set([0, 0, 0, 255], x * 4)
    for (let x = 4; x < 8; x += 1) first.set([250, 10, 10, 255], x * 4)
    for (let y = 2; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) first.set([250, 10, 10, 255], (y * width + x) * 4)
    }
    // Columns 4 and 5 stay red, so the changed rectangle also holds kept, transparent pixels.
    const second = first.slice()
    for (const x of [0, 1, 2, 3, 6]) second.set([0, 0, 0, 255], (2 * width + x) * 4)
    const frames = [
      { data: first, durationMs: 100 },
      { data: second, durationMs: 100 },
    ]
    const chunks: Uint8Array[] = []
    for await (const chunk of encodeGifAnimation(frames, { width, height })) chunks.push(chunk)
    const decoded = composite(Buffer.concat(chunks))
    for (const [index, frame] of frames.entries()) {
      expect(same(decoded.frames[index] ?? new Uint8Array(), frame.data)).toBe(true)
    }
  })

  it('decodes restore-to-previous disposal written by an independent encoder', async () => {
    const buffer = new Uint8Array(1024)
    const writer = new GifWriter(buffer, 4, 4, {
      palette: [0x000000, 0xff0000, 0x00ff00, 0x0000ff],
    })
    writer.addFrame(0, 0, 4, 4, new Array(16).fill(1), { delay: 10 })
    writer.addFrame(1, 1, 2, 2, [2, 2, 2, 2], { delay: 20, disposal: 3 })
    writer.addFrame(0, 0, 1, 1, [3], { delay: 30 })
    const bytes = buffer.subarray(0, writer.end())
    const expected = composite(bytes)

    const animation = openGifAnimation(bytes)
    const frames: Uint8Array[] = []
    const durations: number[] = []
    for await (const frame of animation.frames()) {
      frames.push(frame.data.slice())
      durations.push(frame.durationMs)
    }
    expect(durations).toEqual([100, 200, 300])
    for (const [index, frame] of expected.frames.entries()) {
      expect(same(frames[index] ?? new Uint8Array(), frame)).toBe(true)
    }
    const third = await (await Image.open(bytes, { frame: 2 })).png().toBuffer()
    expect(same(PNG.sync.read(third).data, expected.frames[2] ?? new Uint8Array())).toBe(true)
  })

  it('keeps animation requests explicit', async () => {
    const input = syntheticAnimatedGif()
    await expect((await Image.open(input)).png().toBuffer()).rejects.toThrow(/animated: true/)
    await expect((await Image.open(input, { animated: true })).png().toBuffer()).rejects.toThrow(
      /png animation encoding is not implemented/,
    )
    await expect(Image.open(input, { animated: true, frame: 0 })).rejects.toThrow(/combined/)
    await expect(
      Image.open(input, { frame: 12 }).then((image) => image.png().toBuffer()),
    ).rejects.toThrow(/does not exist/)
    const still = rgbaPng(3, 2, () => [9, 9, 9, 255])
    const png = await (await Image.open(still, { animated: true })).png().toBuffer()
    expect(PNG.sync.read(png).width).toBe(3)
  })
})
