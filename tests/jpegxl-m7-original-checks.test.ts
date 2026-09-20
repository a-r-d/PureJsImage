import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'

test('original-size preparation refuses to overwrite an existing measured snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'purejsimage-m7-original-checks-'))
  const snapshot = join(directory, '.tmp/jpegxl-m7/original052-snapshot')
  try {
    await mkdir(snapshot, { recursive: true })
    await writeFile(join(snapshot, 'measured.txt'), 'preserve this measured snapshot')
    const result = spawnSync(
      process.execPath,
      [resolve('benchmark/jpegxl/prepare-m7-original-checks.ts')],
      { cwd: directory, encoding: 'utf8', timeout: 30_000 },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('EEXIST')
    expect(await readFile(join(snapshot, 'measured.txt'), 'utf8')).toBe(
      'preserve this measured snapshot',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
