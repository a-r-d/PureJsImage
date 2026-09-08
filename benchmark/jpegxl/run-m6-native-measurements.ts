import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sources from './production-program/m6-native-sources.json' with { type: 'json' }
const directory = process.argv[2] ?? '.tmp/jpegxl-m6-native/encoded'
const output = process.argv[3] ?? '.tmp/jpegxl-m6-m10/m6-native-measurements.json'
await mkdir('.tmp/jpegxl-m6-m10', { recursive: true })
const results: unknown[] = []
for (const entry of sources.entries)
  for (const mode of ['preview', 'viewport', 'final'])
    for (const temperature of ['cold', 'warm']) {
      const path = join(directory, `${entry.id}.jxl`)
      await readFile(path) // Fail before spawning when the pinned preparation step is missing.
      const result = spawnSync(
        process.execPath,
        ['--expose-gc', 'benchmark/jpegxl/measure-m6-session.ts', path, mode, temperature],
        { encoding: 'utf8', maxBuffer: 1_048_576 },
      )
      const record: unknown = JSON.parse(result.stdout)
      results.push(record)
      await writeFile(
        output,
        JSON.stringify(
          {
            schemaVersion: 1,
            selectionFrozenAt: sources.frozenAt,
            measurement:
              'One isolated process per case, mode and temperature. Warm runs complete once, close, yield and force GC twice before the measured run. Absolute RSS includes warmup. Hashing includes all emitted bytes; no oracle pixels are retained.',
            results,
          },
          null,
          2,
        ) + '\n',
      )
      console.log(entry.id, mode, temperature, result.status)
      if (result.stderr) console.error(result.stderr)
    }
