import { execFileSync } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.argv[2] ?? '.tmp/jpegxl-lossy-lab/transplant-20261013-v2'
for (const component of ['control', 'quant', 'dc', 'cfl', 'filters', 'available']) {
  const output = join(root, component, 'speed')
  await mkdir(join(root, component), { recursive: true })
  const log = await open(join(root, component, 'speed-run.log'), 'w')
  console.log(`Starting isolated ${component}`)
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
        'speed',
        '--variant',
        `transplant-${component}`,
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
