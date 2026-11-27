import { PNG } from 'pngjs'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { createWasmWebpAccelerator } from '../src/accelerator-entries/wasm-webp-node.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { webpCodec } from '../src/codecs/webp.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'

const reference = createNodeImageLibrary([pngCodec, webpCodec])
const accelerated = createNodeImageLibrary([
  pngCodec,
  createWasmWebpAccelerator({ minimumPixels: 1, minimumEncodePixels: 1 }).accelerate(webpCodec),
])

it('resets the frame model between tiny, sparse and dense interleaved encodes', async () => {
  const cases = [
    { width: 1, height: 17, quality: 100 },
    { width: 159, height: 73, quality: 1 },
    { width: 341, height: 255, quality: 90 },
  ]
  await Promise.all(
    cases.map(async ({ width, height, quality }) => {
      const png = new PNG({ width, height })
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          const texture = width > 160 || x < width / 4 ? (x * y + 19 * x + 23 * y) & 255 : 40
          png.data[i] = texture
          png.data[i + 1] = (5 * texture) & 255
          png.data[i + 2] = (3 * texture) & 255
          png.data[i + 3] = x < width / 3 ? 127 : 255
        }
      }
      const input = PNG.sync.write(png)
      const encoded = await (await reference.open(input)).webp({ quality }).toBuffer()
      const wasm = await (await accelerated.open(input)).webp({ quality }).toBuffer()
      expect(Buffer.compare(encoded, wasm)).toBe(0)
      const oracle = await sharp(encoded).ensureAlpha().raw().toBuffer()
      for (const lib of [reference, accelerated]) {
        const decoded = PNG.sync.read(await (await lib.open(encoded)).png().toBuffer())
        expect(Buffer.compare(oracle, decoded.data)).toBe(0)
      }
    }),
  )
})
