import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'

import { avifAuxiliaryFixtureDirectory, avifExpandedAlphaFixtures } from './auxiliary-fixtures.ts'

const width = 64
const height = 48
const source = new PNG({ width, height })
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4
    source.data[offset] = (x * 5 + y * 3) & 0xff
    source.data[offset + 1] = (x * 2 + y * 7) & 0xff
    source.data[offset + 2] = (x * 11 + y) & 0xff
    source.data[offset + 3] = (x * 9 + y * 13 + (x ^ y) * 3) & 0xff
  }
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-expanded-alpha-'))
try {
  const sourcePath = join(temporaryDirectory, 'source.png')
  await writeFile(sourcePath, PNG.sync.write(source))
  const sourceSha256 = createHash('sha256')
    .update(await readFile(sourcePath))
    .digest('hex')
  if (sourceSha256 !== 'c9c9282e58a42be0adf840063acf7a733f363f49b78bee9ef7ead56129d30914') {
    throw new Error(`Expanded alpha fixture source checksum changed: ${sourceSha256}`)
  }

  for (const fixture of avifExpandedAlphaFixtures) {
    if (fixture.alphaBitDepth === 8) continue
    const outputPath = join(avifAuxiliaryFixtureDirectory, fixture.file)
    const result = spawnSync(
      'avifenc',
      [
        '--jobs',
        '1',
        '--speed',
        '6',
        '--depth',
        String(fixture.alphaBitDepth),
        '--yuv',
        '444',
        '--range',
        'full',
        '--qcolor',
        '100',
        '--qalpha',
        '100',
        '-a',
        'end-usage=q',
        '-a',
        'cq-level=0',
        '-a',
        'enable-cdef=0',
        '-a',
        'enable-restoration=0',
        '-a',
        'loopfilter-control=0',
        sourcePath,
        outputPath,
      ],
      { stdio: 'inherit' },
    )
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`avifenc exited with status ${result.status ?? 'unknown'}`)
    }
    const encodedSha256 = createHash('sha256')
      .update(await readFile(outputPath))
      .digest('hex')
    if (encodedSha256 !== fixture.fileSha256) {
      throw new Error(`${fixture.file} checksum changed: ${encodedSha256}`)
    }
    console.log(`generated ${fixture.file}`)
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
