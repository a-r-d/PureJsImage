import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  record,
  validateM6Report,
} from '../benchmark/jpegxl/production-program/validate-m6-report.ts'
const report = (): Record<string, unknown> =>
  record(JSON.parse(readFileSync('benchmark/jpegxl/production-program/m6-report.json', 'utf8')))
function rows(value: unknown): Record<string, unknown>[] {
  const entries = record(value).results
  if (!Array.isArray(entries)) throw new Error('Missing results')
  return entries.map(record)
}
describe('M6 recorded acceptance evidence', () => {
  it('recomputes native cohort gates and retains individual misses', () => {
    const value = report()
    expect(validateM6Report(value)).toEqual(value.gates)
  })
  it('rejects an omitted unfavorable photo', () => {
    const value = report(),
      measurements = record(value.measurements)
    measurements.results = rows(measurements).slice(1)
    value.measurements = measurements
    expect(() => validateM6Report(value)).toThrow(/Incomplete/)
  })
  it('rejects failed native stage agreement', () => {
    const value = report(),
      correctness = record(value.correctness),
      results = rows(correctness)
    const first = results[0]
    if (!first) throw new Error('Missing comparison')
    first.maximum = 2
    value.correctness = { ...correctness, results }
    expect(() => validateM6Report(value)).toThrow(/tolerance/)
  })
  it('rejects a failed byte budget even when a stored summary claims success', () => {
    const value = report(),
      measurements = record(value.measurements),
      results = rows(measurements)
    for (const row of results) if (row.mode === 'viewport') row.requestedBytes = row.inputBytes
    value.measurements = { ...measurements, results }
    expect(() => validateM6Report(value)).toThrow(/byte gate/)
  })
  it('rejects evidence stamped with another source revision', () => {
    const value = report()
    value.revision = '0'.repeat(40)
    expect(() => validateM6Report(value)).toThrow(/revision mismatch/)
  })
})
