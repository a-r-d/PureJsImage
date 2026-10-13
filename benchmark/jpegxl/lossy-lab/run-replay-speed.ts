import { execFileSync } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { parseTransplantComponent } from './transplant.ts'

const root = process.argv[2] ?? '.tmp/jpegxl-lossy-lab/replay-v5'
const components = process.argv.slice(3).length
  ? process.argv.slice(3).map(parseTransplantComponent)
  : (['strategy', 'filters', 'available', 'features', 'all'] as const)
for (const component of components) {
  await mkdir(join(root, component), { recursive: true })
  const log = await open(join(root, component, 'speed-run.log'), 'wx')
  console.log(`Starting isolated ${component}`)
  try {
    execFileSync(
      process.execPath,
      [
        'benchmark/jpegxl/lossy-lab/run.ts',
        '--manifest',
        '.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json',
        '--out',
        join(root, component, 'speed'),
        '--mode',
        'speed',
        '--variant',
        `replay-${component}`,
        '--workers',
        '1',
        '--transplant',
        component,
        '--transplant-root',
        '.tmp/jpegxl-lossy-lab/transplant-20261013',
      ],
      { stdio: ['ignore', log.fd, log.fd] },
    )
  } finally {
    await log.close()
  }
  console.log(`Finished isolated ${component}`)
}
