import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import selection from '../benchmark/jpegxl/production-program/m7-corpus-selection.json' with {
  type: 'json',
}

it('fails the quality batch when a worker fails, preserving its diagnostic report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jpegxl-m7-quality-runner-'))
  const script = resolve('benchmark/jpegxl/evaluate-m7-lossy-development.ts')
  const first = selection.cases.find((entry) => entry.split === 'development')
  if (!first) throw new Error('Missing frozen development source')
  try {
    // These files provide fingerprints only. No oracle is executed: the source is missing.
    for (const name of [
      'libjxl-v0.12.0/source/build-pinned/tools/cjxl',
      'libjxl-v0.12.0/source/build-pinned/tools/djxl',
      'libjxl-v0.12.0/source/build-m7-metrics/tools/ssimulacra2',
      'libjxl-v0.12.0/source/build-m7-metrics/tools/butteraugli_main',
      'jxl-rs-07ab48f/target/release/jxl_cli',
    ]) {
      const path = join(directory, '.tmp/jpegxl-oracles', name)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, 'unused test oracle fingerprint')
    }
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      env: {
        ...process.env,
        PUREJSIMAGE_M7_LOSSY_RUN: 'fixture',
        PUREJSIMAGE_M7_LOSSY_SPLIT: 'development',
        PUREJSIMAGE_M7_LOSSY_WORKERS: '1',
        PUREJSIMAGE_M7_OWN_CACHE: undefined,
        PUREJSIMAGE_M7_COMPARATOR_CACHE: undefined,
      },
      encoding: 'utf8',
      timeout: 15_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`${first.id}: quality worker failed (1)`)
    const report: unknown = JSON.parse(
      await readFile(
        join(directory, '.tmp/jpegxl-m7/lossy-development-fixture', first.id, 'report.json'),
        'utf8',
      ),
    )
    expect(report).toMatchObject({
      id: first.id,
      status: 'failed',
      error: expect.stringContaining('ENOENT'),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)
