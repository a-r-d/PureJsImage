import { writeFile } from 'node:fs/promises'
import { encodeJpegXlAnimation } from '../../src/jpegxl.ts'

const width = 16,
  height = 12
const data = Uint8Array.from(
  { length: width * height * 3 },
  (_, i) => (i * 19 + (i % 3) * 61) & 255,
)
async function* frames() {
  yield { width, height, data, durationTicks: 7 }
}
const chunks: Uint8Array[] = []
for await (const chunk of encodeJpegXlAnimation(frames(), {
  width,
  height,
  pixelFormat: 'rgb8',
  animation: {
    ticksPerSecondNumerator: 100,
    ticksPerSecondDenominator: 1,
    loops: 0,
    haveTimecodes: false,
  },
  colorSemantics: {
    family: 'rgb',
    primaries: 'display-p3',
    transfer: { kind: 'srgb' },
    matrix: 'identity',
    range: 'full',
    alpha: 'none',
    provenance: 'container-signaled',
    renderingIntent: 'relative',
  },
  encoding: { mode: 'lossy', effort: 1, distance: 1 },
}))
  chunks.push(chunk)
await writeFile('tests/fixtures/jpegxl/m8-static/wide-gamut.jxl', Buffer.concat(chunks))
