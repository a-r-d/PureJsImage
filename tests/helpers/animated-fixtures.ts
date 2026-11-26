import { GifWriter } from 'omggif'
import { PNG } from 'pngjs'

// Deterministic generators so tests run from a clean checkout without the benchmark corpus.

/**
 * A 48x40, 12-frame GIF written by the independent omggif encoder: a full first frame, then small
 * rectangles with transparency and a mix of keep and restore-to-background disposal.
 */
export const syntheticAnimatedGif = (): Uint8Array => {
  const width = 48
  const height = 40
  const palette = [0x000000, 0xffffff, 0xe03030, 0x30c040, 0x3050e0, 0xf0d020, 0xd040c0, 0x20c0d0]
  const buffer = new Uint8Array(64 * 1024)
  const writer = new GifWriter(buffer, width, height, { palette, loop: 0 })
  const background = new Array<number>(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) background[y * width + x] = y < 6 ? 4 : 1
  }
  writer.addFrame(0, 0, width, height, background, { delay: 8 })
  for (let frame = 1; frame < 12; frame += 1) {
    const size = 10
    const pixels = new Array<number>(size * size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // Corners use the transparent index 0 so the canvas shows through.
        const corner = (x < 2 || x > 7) && (y < 2 || y > 7)
        pixels[y * size + x] = corner ? 0 : 2 + (frame % 6)
      }
    }
    writer.addFrame(frame * 3, 8 + (frame % 3) * 8, size, size, pixels, {
      delay: 5 + frame,
      disposal: frame % 3 === 0 ? 2 : 1,
      transparent: 0,
    })
  }
  return buffer.slice(0, writer.end())
}

const random = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

/** A photo-like RGB image with smooth gradients, a soft disc, and mild sensor noise. */
export const syntheticPhotoPng = (width: number, height: number): Buffer => {
  const image = new PNG({ width, height })
  const next = random(7)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - width * 0.6
      const dy = y - height * 0.4
      const disc = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / (width * 0.3))
      const noise = (next() - 0.5) * 10
      const offset = (y * width + x) * 4
      image.data[offset] = Math.max(
        0,
        Math.min(255, Math.round(40 + (x / width) * 150 + disc * 60 + noise)),
      )
      image.data[offset + 1] = Math.max(
        0,
        Math.min(255, Math.round(70 + (y / height) * 120 + Math.sin(x / 9) * 20 + noise)),
      )
      image.data[offset + 2] = Math.max(0, Math.min(255, Math.round(160 - disc * 120 + noise)))
      image.data[offset + 3] = 255
    }
  }
  return PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 })
}

/** A wide transparent logo: an anti-aliased ellipse with a vertical gradient. */
export const syntheticLogoPng = (width: number, height: number): Buffer => {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5 - width / 2) / (width * 0.45)
      const dy = (y + 0.5 - height / 2) / (height * 0.4)
      const distance = Math.sqrt(dx * dx + dy * dy)
      const alpha = Math.max(0, Math.min(1, (1 - distance) * 12))
      image.data.set(
        [30, Math.round(90 + (y / height) * 120), 200, Math.round(alpha * 255)],
        (y * width + x) * 4,
      )
    }
  }
  return PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 })
}
