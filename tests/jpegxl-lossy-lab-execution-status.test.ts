import { expect, it } from 'vitest'
import { labExecutionComplete } from '../benchmark/jpegxl/lossy-lab/execution-status.ts'

const complete = { completedJobs: 189, totalJobs: 189, failures: [], omissions: [] }

it('keeps completed encodes valid when the summary reports partial curve coverage', () => {
  expect(
    labExecutionComplete(complete, {
      failures: [],
      omissions: [{ reason: 'ssimulacra2: incomplete required-range overlap' }],
      complete: false,
    }),
  ).toBe(true)
})

it.each([
  { ...complete, completedJobs: 188 },
  { ...complete, failures: [{ detail: 'Decoder failed' }] },
  { ...complete, omissions: [{ reason: 'Wall budget exhausted before job' }] },
  { ...complete, completedJobs: 0, totalJobs: 0 },
])('rejects an unfinished or failed execution ledger', (progress) => {
  expect(labExecutionComplete(progress, { failures: [] })).toBe(false)
})

it('rejects failures recorded in the final summary', () => {
  expect(labExecutionComplete(complete, { failures: [{ detail: 'Encoder failed' }] })).toBe(false)
})

it.each([
  { ...complete, completedJobs: 190 },
  { ...complete, completedJobs: -1 },
  { ...complete, completedJobs: 188.5 },
  { ...complete, omissions: null },
])('rejects malformed execution counters', (progress) => {
  expect(() => labExecutionComplete(progress, { failures: [] })).toThrow('Invalid lab execution')
})
