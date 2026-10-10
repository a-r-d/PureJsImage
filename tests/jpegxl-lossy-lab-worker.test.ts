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

it('keeps effort 9 out of exploration and separates peer cache efforts', async () => {
  const { parseCampaignEffort, curveMatches } = await import(
    '../benchmark/jpegxl/lossy-lab/model.ts'
  )
  expect(parseCampaignEffort('7', 'lab', false)).toBe(7)
  expect(parseCampaignEffort('9', 'screen', true)).toBe(9)
  expect(() => parseCampaignEffort('9', 'lab', true)).toThrow('promotion screen')
  expect(() => parseCampaignEffort('9', 'screen', false)).toThrow('promotion screen')
  expect(() => parseCampaignEffort('8', 'screen', true)).toThrow()
  const saved = { fixtureSha256: 'fixture', engine: 'jsquash', channels: 4, effort: 7, points: [] }
  expect(curveMatches(saved, 'fixture', 'jsquash', 4, 7)).toBe(true)
  expect(curveMatches(saved, 'fixture', 'jsquash', 4, 9)).toBe(false)
  expect(curveMatches({ ...saved, effort: 9 }, 'fixture', 'jsquash', 4, 9)).toBe(true)
})
