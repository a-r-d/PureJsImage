import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { object } from '../comparison/model.ts'
import { parseTransplantComponent } from './transplant.ts'

const root = process.argv[2] ?? '.tmp/jpegxl-lossy-lab/replay-v5'
const components = process.argv.slice(3).length
  ? process.argv.slice(3).map(parseTransplantComponent)
  : (['filters', 'available', 'features', 'all'] as const)
let experiment = Number(process.env.PUREJSIMAGE_TRANSPLANT_FIRST_EXPERIMENT ?? '600')
if (!Number.isSafeInteger(experiment) || experiment < 1)
  throw new Error('Invalid experiment number')
for (const component of components) {
  const results = []
  for (const mode of ['screen', 'lab']) {
    const output = join(root, component, mode)
    await mkdir(output, { recursive: true })
    const log = await open(join(output, 'run.log'), 'wx')
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
          `replay-${component}`,
          '--workers',
          '4',
          '--transplant',
          component,
          '--transplant-root',
          '.tmp/jpegxl-lossy-lab/transplant-20261013',
        ],
        { stdio: ['ignore', log.fd, log.fd] },
      )
    } catch (error) {
      console.log(
        `${component} ${mode} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      await log.close()
    }
    const summary = object(JSON.parse(await readFile(join(output, 'summary.json'), 'utf8')))
    if (!Array.isArray(summary.table)) throw new Error('Missing replay table')
    results.push(
      `${mode}: ${summary.table
        .filter((value) => object(value).peer === 'vips')
        .map((value) => {
          const row = object(value)
          return `${row.metric} ${typeof row.mean === 'number' ? row.mean.toFixed(5) : 'unavailable'}% (${row.count} curves)`
        })
        .join(', ')}; failures ${summary.failures}`,
    )
    console.log(`Finished ${component} ${mode}`)
  }
  await appendFile(
    'benchmark/jpegxl/lossy-lab-log.md',
    `\n| LL-${experiment++}, 2026-10-13 | Complete ${component} replay with inverse signaled Gaborish and exact native reference samples where needed. | ${results.join('. ')}. Evidence ${root}/${component}. | Four workers; quality timings are diagnostic. Fresh isolated rows follow. | Development transplant only. Own transform mathematics and entropy writer; no source heuristic port or promotion. | uncommitted |\n`,
  )
}
