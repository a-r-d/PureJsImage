import { spawn } from 'node:child_process'
import { appendFile, mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { object } from '../comparison/model.ts'
import { allocationGrid, allocationName } from './allocation.ts'
import { assertAllocationScreen } from './allocation-screen.ts'

const root = '.tmp/jpegxl-lossy-lab/allocation-20261014'
await mkdir(root, { recursive: true })
async function command(args: string[], log: string): Promise<void> {
  const file = await open(log, 'wx')
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
const startAt = Number(process.argv[2] ?? '0')
for (let index = startAt; index < allocationGrid.length; index++) {
  const point = allocationGrid[index]
  if (!point) throw new Error('Missing grid point')
  const name = allocationName(point),
    directory = join(root, name)
  console.log(`START ${index + 1}/32 ${name} ${new Date().toISOString()}`)
  if (!(index === startAt && process.argv[3] === '--record-existing')) {
    await command(
      [
        'benchmark/jpegxl/lossy-lab/run.ts',
        '--manifest',
        '.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json',
        '--out',
        directory,
        '--mode',
        'screen',
        '--variant',
        name,
        '--workers',
        '4',
        '--allocation',
        `${point.alpha},${point.acScale},${point.smoothing}`,
      ],
      join(root, `${name}.log`),
    )
    await command(
      [
        'benchmark/jpegxl/lossy-lab/summarize-port.ts',
        directory,
        '.tmp/jpegxl-lossy-lab/transplant-20261013-v2/control/screen/transplant-control-purejsimage',
      ],
      join(root, `${name}-comparison.log`),
    )
  }
  const result = object(JSON.parse(await readFile(join(directory, 'against-control.json'), 'utf8')))
  const summary = object(JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8')))
  assertAllocationScreen(summary)
  const entry = {
    name,
    ...point,
    directory,
    control: result.control,
    peers: result.peers,
    speed: result.speedDiagnostic,
  }
  await appendFile(join(root, 'completed.jsonl'), `${JSON.stringify(entry)}\n`)
  await appendFile(
    'benchmark/jpegxl/lossy-lab-log.md',
    `\n| LL-${632 + index}, 2026-10-14 | Own-encoder allocation alpha=${point.alpha}, AC precision=${point.acScale}, normative DC smoothing ${point.smoothing}. | 80 valid screen points. Exact vips, jSquash and control BD-rates and coverage: ${directory}/against-control.json. | Four-worker diagnostic timing only; source base 120e0675. | Owner-prescribed grid; all rows retained for frontier and final two-point selection. No peer decisions consumed. | measured |\n`,
  )
  console.log(`DONE ${JSON.stringify(entry)}`)
}
