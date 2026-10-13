import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.argv[2] ?? '.tmp/jpegxl-lossy-lab/transplant-20261013-v2'
let id = 595
for (const component of ['quant', 'available']) {
  for (const mode of ['screen', 'lab']) {
    const output = join(root, `${component}-corrected`, mode)
    await mkdir(output, { recursive: true })
    const log = await open(join(output, 'run.log'), 'w')
    console.log(`Starting corrected ${component} ${mode}`)
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
          '.tmp/jpegxl-lossy-lab/transplant-20261013',
        ],
        { stdio: ['ignore', log.fd, log.fd] },
      )
    } finally {
      await log.close()
    }
    console.log(`Finished corrected ${component} ${mode}`)
  }
  await appendFile(
    'benchmark/jpegxl/lossy-lab-log.md',
    `\n| LL-${id++}, 2026-10-13 | Re-measure ${component} after requiring exact representable forced quant fields. | Screen/full lab in ${root}/${component}-corrected. All successful emitted maps validate before scoring; supersedes the initial ${component} row. | Isolated timing follows after quality work stops. | Development measurement; no port or promotion. | uncommitted |\n`,
  )
}
