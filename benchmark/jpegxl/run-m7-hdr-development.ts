import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { m7ExpansionCases, m7ExpansionSplit } from './m7-expansion-selection.ts'

const split = m7ExpansionSplit(process.env.PUREJSIMAGE_M7_EXPANSION_SPLIT)

const runId = process.argv[2]
if (!runId || !/^[a-z0-9-]+$/u.test(runId)) throw new Error('Specify a unique run identifier')
const checkedRunId = runId
const cases = m7ExpansionCases(split, 'hdr')
const jobs = cases.flatMap((entry) =>
  [0.25, 0.5, 1, 2, 3, 5].map((distance) => ({ id: entry.id, distance })),
)
const script = new URL('./evaluate-m7-hdr-development.ts', import.meta.url)
await writeFile(
  `.tmp/jpegxl-m7/hdr-${split}-${runId}-dispatch.json`,
  JSON.stringify(
    {
      jobs,
      split,
      workers: 1,
      evaluatorSha256: createHash('sha256')
        .update(await readFile(script))
        .digest('hex'),
      policy: `Complete frozen HDR ${split} grid. Every failure is retained; no result-based exclusion. Individual reports fingerprint the executing source snapshot and independent tools. One serial child at a time; quality runs do not establish runtime performance.`,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
)
let next = 0,
  failures = 0
async function worker(): Promise<void> {
  while (next < jobs.length) {
    const job = jobs[next++]
    if (!job) throw new Error('Missing HDR job')
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [script.pathname, job.id, String(job.distance), checkedRunId],
        { stdio: 'inherit' },
      )
      child.once('error', reject)
      child.once('exit', (status) => resolve(status ?? 1))
    })
    if (code !== 0) failures++
  }
}
await worker()
console.log(JSON.stringify({ cases: cases.length, points: jobs.length, failures }))
if (failures) process.exitCode = 1
