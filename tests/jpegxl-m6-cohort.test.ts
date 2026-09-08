import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import cohort from '../benchmark/jpegxl/production-program/m6-functional-cases.json' with {
  type: 'json',
}
import native from '../benchmark/jpegxl/generated-vardct-manifest.json' with { type: 'json' }
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { openJpegXlSession } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
describe('M6 frozen functional cohort', () => {
  expect(cohort.cases).toHaveLength(30)
  for (const entry of cohort.cases)
    it(`preserves the established final output for ${entry.path}`, async () => {
      const input = new Uint8Array(readFileSync(entry.path))
      expect(hash(input)).toBe(entry.sha256)
      const expected = createHash('sha256')
      const actual = createHash('sha256')
      let expectedBytes = 0
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(input),
        defaultImageLimits,
        { colorOutput: 'preserve' },
      )
      if (!decoder) throw new Error('Missing JPEG XL reference decoder')
      for await (const block of decoder.decode({})) {
        expected.update(block.data)
        expectedBytes += block.data.length
        block.release?.()
      }
      const session = await openJpegXlSession(input)
      let offset = 0,
        completed = 0
      const oracle = native.fixtures.find((fixture) => fixture.jxl === entry.path)
      const oracleFile = oracle ? new Uint8Array(readFileSync(oracle.oracle)) : undefined
      if (oracle && oracleFile) expect(hash(oracleFile)).toBe(oracle.oracleSha256)
      // PNM/PAM raster length is fixed by the independently recorded native dimensions and depth.
      const raster =
        oracle && oracleFile
          ? oracleFile.subarray(
              oracleFile.length -
                oracle.width *
                  oracle.height *
                  (oracle.alpha === 'none'
                    ? oracle.colorEncoding.startsWith('grayscale')
                      ? 1
                      : 3
                    : 4),
            )
          : undefined
      let maximum = 0,
        squared = 0
      for await (const event of session.decode()) {
        if (event.type === 'block') {
          expect(event.block.format).toBe(decoder.pixelFormat)
          expect(event.block.colorSemantics).toEqual(decoder.colorSemantics)
          actual.update(event.block.data)
          for (const value of event.block.data) {
            if (raster) {
              const error = Math.abs(value - (raster[offset] ?? 0))
              maximum = Math.max(maximum, error)
              squared += error * error
            }
            offset++
          }
          event.block.release?.()
        } else if (event.type === 'final') completed++
      }
      expect(offset).toBe(expectedBytes)
      expect(actual.digest('hex')).toBe(expected.digest('hex'))
      expect(completed).toBe(1)
      if (raster) {
        expect(offset).toBe(raster.length)
        expect(maximum).toBeLessThanOrEqual(1)
        expect(Math.sqrt(squared / offset)).toBeLessThanOrEqual(0.55)
      }
      await session.close()
      expect(session.managedLiveBytes).toBe(0)
    }, 30_000)
})
