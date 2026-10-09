import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { describe, expect, it } from 'vitest'
import { missingSettings, parsePoint } from '../benchmark/jpegxl/lossy-lab/model.ts'

describe('lossy lab worker', () => {
  it('runs under the same Node TypeScript strip mode used by the lab', () => {
    const source = readFileSync('benchmark/jpegxl/lossy-lab/worker.ts', 'utf8')
    expect(() => stripTypeScriptTypes(source, { mode: 'strip' })).not.toThrow()
  })
  it('rejects incomplete measured points from a failed worker', () => {
    expect(() => parsePoint({ setting: 1, bytes: 123 })).toThrow()
  })
  it('extends cached peer curves without re-encoding their existing points', () => {
    const point = parsePoint({
      setting: 1,
      bytes: 123,
      encodeMs: 5,
      managedPeakBytes: null,
      processPeakRssBytes: 100,
      ssimulacra2: 80,
      butteraugliMax: 1,
      butteraugliNorm3: 0.5,
    })
    expect(missingSettings([0.25, 1, 6, 9], [point])).toEqual([0.25, 6, 9])
  })
})
