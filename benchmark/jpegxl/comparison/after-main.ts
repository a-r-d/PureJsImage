import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { root, work } from './io.ts'

// Run under run-m7-bounded.ts. One process tree and one phase at a time.
const phases = [
  ['repair-chromium', 'run.ts', 'repair', 'chromium'],
  ['compat-firefox', 'run.ts', 'compat', 'firefox'],
  ['compat-webkit', 'run.ts', 'compat', 'webkit'],
  ['preview-chromium', 'preview.ts'],
  ['quality', 'quality.ts'],
  ['main-node', 'run.ts', 'main', 'node'],
  ['cold-chromium', 'run.ts', 'cold', 'chromium'],
  ['cold-node', 'run.ts', 'cold', 'node'],
] as const
await mkdir(`${work}/phase-logs`, { recursive: true })
for (const [id, file, ...args] of phases) {
  console.log(`Starting ${id}`)
  const result = spawnSync(process.execPath, [`${root}/${file}`, ...args], {
    encoding: 'utf8',
    timeout: 40 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...(id === 'repair-chromium' ? { JXL_COMPARE_SUBJECTS: 'vips' } : {}) },
  })
  await writeFile(`${work}/phase-logs/${id}.log`, `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  if (result.status !== 0)
    throw new Error(
      `${id} failed: ${result.error?.message ?? result.signal ?? result.status}; ${(result.stderr ?? '').slice(-1600)}`,
    )
  console.log(`Finished ${id}`)
}
