import { expect, it } from 'vitest'
import { verifyAnsHeaderModels } from './helpers/jpegxl-ans-header.ts'

it('preserves ANS headers and frequencies without payload tables, including recursive maps', () => {
  const rows = verifyAnsHeaderModels()
  expect(rows).toHaveLength(12)
  for (const row of rows) {
    expect(row.exact).toBe(true)
    const [full, header] = row.peaks
    expect(full).toBeGreaterThan(0)
    expect(header).toBeLessThan(full ?? 0)
  }
})
