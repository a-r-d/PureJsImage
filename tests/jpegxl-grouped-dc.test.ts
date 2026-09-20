import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { openJpegXlSession } from '../src/jpegxl.ts'
import manifest from './fixtures/jpegxl/m6-grouped-dc/manifest.json' with { type: 'json' }

it('reconstructs grouped progressive Modular DC dependencies against independent native stages', async () => {
  const bytes = new Uint8Array(readFileSync('tests/fixtures/jpegxl/m6-grouped-dc/progressive.jxl'))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.inputSha256)
  const session = await openJpegXlSession(bytes)
  for (const stage of manifest.stages) {
    const scale = stage.scale
    if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8)
      throw new Error('Invalid native scale')
    const expected = new Uint8Array(
      readFileSync(`tests/fixtures/jpegxl/m6-grouped-dc/${stage.file}`),
    )
    expect(createHash('sha256').update(expected).digest('hex')).toBe(stage.sha256)
    let offset = 0,
      maximum = 0
    for await (const event of session.decode({
      region: stage.region,
      scaleDenominator: scale,
      until: stage.stage === 0 ? 'dc' : stage.stage === 3 ? 'final' : stage.stage,
    })) {
      if (event.type !== 'block') continue
      for (const value of event.block.data)
        maximum = Math.max(maximum, Math.abs(value - (expected[offset++] ?? 0)))
      event.block.release?.()
    }
    expect(offset).toBe(expected.length)
    expect(maximum).toBeLessThanOrEqual(1)
  }
  await session.close()
}, 30_000)
