import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareLabOutputDirectory } from '../benchmark/jpegxl/lossy-lab/output-directory.ts'

const temporaryDirectories: string[] = []
const temporary = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'jpegxl-lab-output-'))
  temporaryDirectories.push(directory)
  return directory
}
afterEach(async () => {
  for (const directory of temporaryDirectories)
    await rm(directory, { recursive: true, force: true })
  temporaryDirectories.length = 0
})

describe('lossy lab measurement directories', () => {
  it('creates a fresh nested speed directory', async () => {
    const directory = join(await temporary(), 'nested', 'measurement')
    await prepareLabOutputDirectory(directory, 'speed', false)
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects reuse even when the old speed directory is empty', async () => {
    const directory = await temporary()
    await expect(prepareLabOutputDirectory(directory, 'speed', false)).rejects.toMatchObject({
      code: 'EEXIST',
    })
  })

  it('preserves old timing records and encoded bytes when fresh timing is rejected', async () => {
    const directory = await temporary()
    const summary = '{"median":1234}\n'
    const encoded = Uint8Array.of(255, 10, 0, 1)
    await writeFile(join(directory, 'summary.json'), summary)
    await writeFile(join(directory, '2.jxl'), encoded)
    await expect(prepareLabOutputDirectory(directory, 'speed', false)).rejects.toMatchObject({
      code: 'EEXIST',
    })
    expect(await readFile(join(directory, 'summary.json'), 'utf8')).toBe(summary)
    expect(new Uint8Array(await readFile(join(directory, '2.jxl')))).toEqual(encoded)
  })

  it('admits only one of two competing fresh measurement starts', async () => {
    const directory = join(await temporary(), 'measurement')
    const results = await Promise.allSettled([
      prepareLabOutputDirectory(directory, 'speed', false),
      prepareLabOutputDirectory(directory, 'speed', false),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('allows the explicitly validated baseline speed continuation directory', async () => {
    const directory = await temporary()
    await writeFile(join(directory, 'progress.json'), 'saved ledger')
    await prepareLabOutputDirectory(directory, 'speed', true)
    expect(await readFile(join(directory, 'progress.json'), 'utf8')).toBe('saved ledger')
  })

  it('keeps existing non-speed peer curves available', async () => {
    const directory = await temporary()
    await writeFile(join(directory, 'peer.json'), 'cached curve')
    await prepareLabOutputDirectory(directory, 'screen', false)
    expect(await readFile(join(directory, 'peer.json'), 'utf8')).toBe('cached curve')
  })

  it('rejects the public runner before replacing an existing measurement', async () => {
    const root = await temporary()
    const directory = join(root, 'measurement')
    await mkdir(directory)
    await writeFile(join(directory, 'summary.json'), 'original measurement')
    const manifest = join(root, 'manifest.json')
    await writeFile(
      manifest,
      JSON.stringify({
        fixtures: [
          {
            id: 'measurement-guard',
            png: join(root, 'unused.png'),
            split: 'development',
            kind: 'lab',
            fixtureSha256: 'unused-before-directory-admission',
            largeGateRepresentative: false,
          },
        ],
        screenIds: [],
        failures: [],
      }),
    )
    const run = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'benchmark/jpegxl/lossy-lab/run.ts',
        '--manifest',
        manifest,
        '--out',
        directory,
        '--mode',
        'speed',
        '--workers',
        '1',
      ],
      { encoding: 'utf8', timeout: 10000 },
    )
    expect(run.error).toBeUndefined()
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('EEXIST')
    expect(await readFile(join(directory, 'summary.json'), 'utf8')).toBe('original measurement')
    expect(await readdir(directory)).toEqual(['summary.json'])
  })
})
