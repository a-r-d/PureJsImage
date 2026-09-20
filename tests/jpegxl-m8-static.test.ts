import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

it.each([
  [
    'modular-ycbcr-noise',
    16,
    12,
    'rgb8',
    '01c588218d902ff274c8867a0e5ee8801098c25442a7ee739331f915e6b91177',
  ],
  [
    'modular-ycbcr-splines',
    16,
    12,
    'rgb8',
    '37c9702c19c87ef5254b5a52fbeb95adeda467878693e4cf2dec833d53f626bc',
  ],
  ['noise', 500, 606, 'rgb8', '50b76ffd2232cfa321d5c64bdee5d8a19dd7b8f8aaa26498825c00fa23ef69a1'],
  [
    'opsin-inverse',
    500,
    606,
    'rgb8',
    'b4b892161840e247ab148a3f84e4c0324838dc3c11af47c03bbde8a5eec28bef',
  ],
  [
    'custom-upsampling',
    800,
    600,
    'rgba8',
    '5f39191865cd4cc0aa0a689b563f16065f8c4014549b65d402e6b1df7d72b549',
  ],
  [
    'custom-filters-lossless',
    32,
    24,
    'rgb8',
    '0bd3c217c06147acf5c03fff3b9ed0a78ccf4a59fbf8b98567c677c65a1b16ea',
  ],
  [
    'custom-filters-lossy',
    32,
    24,
    'rgb8',
    'bdc8edd263adc2cd8507facabb75c281d049156d4275a43f7ebeba1c8ec2011b',
  ],
  [
    'modular-ycbcr-444',
    16,
    12,
    'rgb8',
    '158d281e29bd5ed150afc4f89702c75e2182acb89989b8ae0fb1a1878c4e9d40',
  ],
  [
    'modular-ycbcr-422',
    16,
    12,
    'rgb8',
    '531c5dd70e19bd35ab282dbcf34dd4a2008b4d61f5b4dce782e475cf459feb29',
  ],
  [
    'modular-ycbcr-420',
    16,
    12,
    'rgb8',
    '39597aa508ade00ab2f8d0ff8041c85c4cb33f99db03ea5d59853ea44b6119d8',
  ],
  [
    'noise-upsampling',
    32,
    24,
    'rgb8',
    'e6fa8f904479d21a2cd260d6670a300e3c1f0f9d9d49433ff256ce853f847fe0',
  ],
  [
    'modular-upsampling',
    64,
    64,
    'rgba8',
    'e1b6a61465dbf01691f3bd2eb7097b638fd7dd0220658e442267d3b1425cd195',
  ],
])(
  'preserves independently qualified %s reconstruction',
  async (name, width, height, format, expected) => {
    const input = await readFile(
      new URL(
        `./fixtures/jpegxl/${name === 'modular-upsampling' ? 'm8-native' : 'm8-static'}/${name}.jxl`,
        import.meta.url,
      ),
    )
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits, {
      colorOutput: 'srgb',
      frame: 0,
    })
    if (!decoder) throw new Error('JPEG XL decoder unavailable')
    expect([decoder.width, decoder.height, decoder.pixelFormat]).toEqual([width, height, format])
    const hash = createHash('sha256')
    for await (const block of decoder.decode()) {
      try {
        hash.update(block.data)
      } finally {
        block.release?.()
      }
    }
    expect(hash.digest('hex')).toBe(expected)
  },
)
