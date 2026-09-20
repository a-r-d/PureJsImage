import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { hashM8Layer } from '../benchmark/jpegxl/m8-output-digest.ts'
import { type JpegXlNativeLayer, openJpegXlSequence } from '../src/jpegxl.ts'

it.each([
  ['patches', 2, 'e023624ad02f4287476e6c2b5495d55927a5ff69f7efe76dd0891029dfb5ce7a'],
  ['progressive', 3, 'a16c840b787824426ee3197ead2d690834ed85ab6f05ddaa902fd1bdca9d3631'],
  ['noise-upsampling', 1, '1e2ba59ae2fc78e0468318332ecbd01f58925b306c6ed2ccbd575b854e751c41'],
] as const)(
  'reconstructs independently qualified native layers for %s',
  async (name, count, expected) => {
    const sequence = await openJpegXlSequence(
      await readFile(new URL(`./fixtures/jpegxl/m8-static/${name}.jxl`, import.meta.url)),
    )
    let last: JpegXlNativeLayer | undefined,
      seen = 0
    try {
      for await (const layer of sequence.layers()) {
        last = layer
        seen++
      }
      expect(seen).toBe(count)
      if (!last) throw new Error('Missing native layer')
      const hash = createHash('sha256')
      hashM8Layer(hash, last)
      expect(hash.digest('hex')).toBe(expected)
    } finally {
      await sequence.close()
    }
  },
  30_000,
)
