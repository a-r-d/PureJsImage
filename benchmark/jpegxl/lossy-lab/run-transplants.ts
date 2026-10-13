import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { object } from '../comparison/model.ts'

const root = process.argv[2] ?? '.tmp/jpegxl-lossy-lab/transplant-20261013-v2'
const peerRoot = '.tmp/jpegxl-lossy-lab/transplant-20261013'
const components = [
  'control',
  'quant',
  'dc',
  'cfl',
  'filters',
  'available',
  'strategy',
  'features',
  'all',
]
async function resultText(component: string, mode: string): Promise<string> {
  const summary = object(
    JSON.parse(await readFile(join(root, component, mode, 'summary.json'), 'utf8')),
  )
  if (!Array.isArray(summary.table)) throw new Error('Missing transplant summary table')
  return summary.table
    .filter((t) => object(t).peer === 'vips')
    .map((t) => {
      const row = object(t)
      return `${row.metric}: ${typeof row.mean === 'number' ? row.mean.toFixed(3) + '%' : 'unavailable'} (${row.count ?? 0} images)`
    })
    .join('; ')
}
let id = 585
for (const component of components) {
  for (const mode of ['screen', 'lab']) {
    const output = join(root, component, mode)
    await mkdir(output, { recursive: true })
    const log = await open(join(output, 'run.log'), 'w')
    console.log(`Starting ${component} ${mode}`)
    try {
      execFileSync(
        process.execPath,
        [
          'benchmark/jpegxl/lossy-lab/run.ts',
          '--manifest',
          '.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json',
          '--out',
          output,
          '--mode',
          mode,
          '--variant',
          `transplant-${component}`,
          '--workers',
          '4',
          '--transplant',
          component,
          '--transplant-root',
          peerRoot,
        ],
        { stdio: ['ignore', log.fd, log.fd] },
      )
    } catch (error) {
      console.log(
        `${component} ${mode} completed with failures: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      await log.close()
    }
    console.log(`Finished ${component} ${mode}`)
  }
  await appendFile(
    'benchmark/jpegxl/lossy-lab-log.md',
    `\n| LL-${id++}, 2026-10-13 | Force ${component} decisions from fresh vips streams at effort 7. | Screen vips: ${await resultText(component, 'screen')}. Full vips: ${await resultText(component, 'lab')}. Summaries: ${root}/${component}. | Four workers; encode times retained, no isolated speed claim. | Development measurement only; failed or incomplete rows are unavailable for ranking. No port or promotion. | uncommitted |\n`,
  )
}
