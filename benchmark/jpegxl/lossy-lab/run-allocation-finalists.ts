import { spawn } from 'node:child_process'
import { appendFile, open, readFile } from 'node:fs/promises'
import { number, object } from '../comparison/model.ts'

const root = '.tmp/jpegxl-lossy-lab/allocation-20261014'
async function run(args: string[], log: string): Promise<void> {
  const file = await open(`${root}/${log}.log`, 'wx')
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, { stdio: ['ignore', file.fd, file.fd] })
      child.once('error', reject)
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`${args[0]} exited ${code}`)),
      )
    })
  } finally {
    await file.close()
  }
}
async function assertFullLab(directory: string): Promise<void> {
  const summary = object(JSON.parse(await readFile(`${directory}/summary.json`, 'utf8')))
  if (
    summary.selectedImages !== 64 ||
    !Array.isArray(summary.failures) ||
    summary.failures.length ||
    !Array.isArray(summary.speed)
  )
    throw new Error(`Incomplete full lab ${directory}`)
  const own = summary.speed.map(object).find((row) => row.engine === 'purejsimage')
  if (!own || object(own.lab).count !== 576) throw new Error(`Missing full-lab points ${directory}`)
}
const report = object(JSON.parse(await readFile(`${root}/report.json`, 'utf8')))
if (
  !Array.isArray(report.rows) ||
  report.rows.length !== 32 ||
  !Array.isArray(report.bestTwo) ||
  report.bestTwo.length !== 2
)
  throw new Error('Complete grid report required before finalists')
const common = ['--manifest', '.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', '--workers', '4']
const diagnostic = `${root}/gaborish-lab`
console.log('START native-map Gaborish diagnostic on full lab')
await run(
  [
    'benchmark/jpegxl/lossy-lab/run.ts',
    ...common,
    '--out',
    diagnostic,
    '--mode',
    'lab',
    '--variant',
    'native-gaborish',
    '--transplant',
    'strategy-quant-gaborish',
  ],
  'gaborish-lab',
)
await assertFullLab(diagnostic)
await run(
  [
    'benchmark/jpegxl/lossy-lab/summarize-port.ts',
    diagnostic,
    '.tmp/jpegxl-lossy-lab/transplant-20261013-v2/control/lab/transplant-control-purejsimage',
  ],
  'gaborish-control',
)
await run(
  [
    'benchmark/jpegxl/lossy-lab/summarize-port.ts',
    diagnostic,
    '.tmp/jpegxl-lossy-lab/coupled-20261013/strategy-quant-dc-lab/coupled-strategy-quant-dc-purejsimage',
    'against-mathematical.json',
  ],
  'gaborish-mathematical',
)
await appendFile(
  'benchmark/jpegxl/lossy-lab-log.md',
  `\n| LL-665, 2026-10-14 | Native-map replay with optimized source inverse Gaborish. | Full 64-photo, nine-distance lab. Exact comparisons in ${diagnostic}/against-control.json and against-mathematical.json. | Four-worker diagnostic timing only. | Isolate preconditioning with all replayed maps fixed. | measured |\n`,
)
for (let index = 0; index < report.bestTwo.length; index++) {
  const row = object(report.bestTwo[index])
  if (typeof row.name !== 'string' || (row.smoothing !== 'off' && row.smoothing !== 'on'))
    throw new Error('Invalid finalist')
  const directory = `${root}/${row.name}-lab`
  console.log(`START finalist ${row.name}`)
  await run(
    [
      'benchmark/jpegxl/lossy-lab/run.ts',
      ...common,
      '--out',
      directory,
      '--mode',
      'lab',
      '--variant',
      row.name,
      '--allocation',
      `${number(row.alpha)},${number(row.acScale)},${row.smoothing}`,
    ],
    `${row.name}-lab`,
  )
  await assertFullLab(directory)
  await run(
    [
      'benchmark/jpegxl/lossy-lab/summarize-port.ts',
      directory,
      '.tmp/jpegxl-lossy-lab/transplant-20261013-v2/control/lab/transplant-control-purejsimage',
    ],
    `${row.name}-lab-control`,
  )
  await appendFile(
    'benchmark/jpegxl/lossy-lab-log.md',
    `\n| LL-${666 + index}, 2026-10-14 | Full lab for allocation finalist ${row.name}. | Exact peer/control comparisons in ${directory}/against-control.json. | Four-worker diagnostic timing only. | Evaluate the owner objective before isolated speed and promotion. | measured |\n`,
  )
  console.log(`DONE finalist ${row.name}`)
}
