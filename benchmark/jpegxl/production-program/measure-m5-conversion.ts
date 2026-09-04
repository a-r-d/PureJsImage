import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { convertPixelBlocks as after } from '../../../src/convert.ts'
import type { PixelBlock } from '../../../src/pixel.ts'

const data = new Uint8Array(1024 * 1024 * 8)
const view = new DataView(data.buffer)
const expected = new Uint8Array(1024 * 1024 * 4)
for (let i = 0; i < expected.length; i++) {
  const maximum = i % 4 === 3 ? 65535 : 4095
  const sample = (i * 31) & maximum
  view.setUint16(i * 2, sample)
  expected[i] = Math.round((sample / maximum) * 255)
}
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const expectedHash = hash(expected)
async function* input(): AsyncGenerator<PixelBlock> {
  yield { x: 0, y: 0, width: 1024, height: 1024, stride: 8192, format: 'rgba16', data }
}
const results: { name: string; milliseconds: number; megapixelsPerSecond: number; hash: string }[] =
  []
for (let trial = 0; trial < 4; trial++) {
  for (const [name, convert] of [['current', after]] as const) {
    globalThis.gc?.()
    const start = performance.now()
    let output: Uint8Array | undefined
    for await (const block of convert(input(), 'rgba16', { format: 'rgba8' }, {}, [12, 12, 12, 16]))
      output = block.data
    const elapsed = performance.now() - start
    if (!output || hash(output) !== expectedHash)
      throw new Error('Independent conversion pixels differ')
    results.push({
      name,
      milliseconds: elapsed,
      megapixelsPerSecond: 1.048576 / (elapsed / 1000),
      hash: expectedHash,
    })
  }
}
console.log(
  JSON.stringify(
    {
      methodology:
        'One-megapixel 12-bit RGB / 16-bit alpha ramp, explicit rgba8 conversion. First trial is warmup; three following trials each start with explicit GC. Pixel hash matches independently scaled samples. Timing includes conversion only; process RSS includes the fixture and reference arrays.',
      results,
      processPeakRss: process.resourceUsage().maxRSS * 1024,
    },
    null,
    2,
  ),
)
