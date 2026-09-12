import { writeFile } from 'node:fs/promises'
import { readJpegXlSourceFrameStructure } from '../../src/codecs/jpegxl-decode.ts'
import { encodeJpegXlNative } from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

// The fixed bit offsets are the small 32x32 native writer header. The edits
// double canvas dimensions and signal color/extra upsampling by two.
for (const dimShift of [2, 3] as const) {
  const color = { data: new Uint8Array(32 * 32).fill(128), bitDepth: 8 }
  const alpha = {
    data: Uint8Array.from(
      { length: dimShift === 2 ? 64 : 16 },
      (_, i) => i * (dimShift === 2 ? 4 : 17),
    ),
    bitDepth: 8,
    type: 0 as const,
    dimShift,
    name: 'coverage',
  }
  const bytes = await encodeJpegXlNative({
    width: 32,
    height: 32,
    color: [color, color, color],
    extraChannels: [alpha],
  })
  const header = await readJpegXlSourceFrameStructure(new MemorySource(bytes), defaultImageLimits)
  const setBits = (start: number, count: number, value: number) => {
    for (let i = 0; i < count; i++) {
      const bit = start + i,
        index = bit >>> 3
      bytes[index] = ((bytes[index] ?? 0) & ~(1 << (bit & 7))) | (((value >>> i) & 1) << (bit & 7))
    }
  }
  setBits(19, 9, 63)
  setBits(33, 9, 63)
  setBits(header.frameHeaderOffset * 8 + 7, 2, 1)
  setBits(header.frameHeaderOffset * 8 + 9, 2, 1)
  await writeFile(
    `tests/fixtures/jpegxl/m8-native/${dimShift === 2 ? 'modular-upsampling' : 'invalid-combined-shift16'}.jxl`,
    bytes,
  )
}
