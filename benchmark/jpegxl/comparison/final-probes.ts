import { spawnSync } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import { root } from './io.ts'

await mkdir(`${root}/results/preflight`, { recursive: true })
for (const file of [
  'repair-chromium.json',
  'compat-firefox.json',
  'compat-webkit.json',
  'specialized-node.json',
])
  await copyFile(`${root}/results/${file}`, `${root}/results/preflight/${file}`)
for (const [file, ...args] of [
  ['run.ts', 'repair', 'chromium'],
  ['run.ts', 'compat', 'firefox'],
  ['run.ts', 'compat', 'webkit'],
  ['specialized.ts'],
  ['validate-quality.ts'],
]) {
  if (!file) throw new Error('Missing phase')
  const result = spawnSync(process.execPath, [`${root}/${file}`, ...args], {
    stdio: 'inherit',
    timeout: 10 * 60 * 1000,
    env: {
      ...process.env,
      ...(args[0] === 'repair' ? { JXL_COMPARE_SUBJECTS: 'oxide,vips' } : {}),
    },
  })
  if (result.status !== 0) throw new Error(`Final probe failed: ${file} ${args.join(' ')}`)
}
