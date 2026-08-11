import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PNG } from 'pngjs'

import {
  avifMirrorFixtureDirectory,
  avifMirrorFixtures,
  avifMirrorSourcePngSha256,
} from './mirror-fixtures.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const createSource = (alpha: boolean): Uint8Array => {
  const width = 160
  const height = 160
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      png.data[offset] = (x * 13 + y * 3) & 0xff
      png.data[offset + 1] = (x * 5 + y * 11) & 0xff
      png.data[offset + 2] = ((x ^ y) * 7) & 0xff
      png.data[offset + 3] = alpha ? 32 + ((x * 7 + y * 9) % 224) : 0xff
    }
  }
  return PNG.sync.write(png)
}

const encode = (arguments_: readonly string[]): void => {
  const result = spawnSync('avifenc', arguments_, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`avifenc exited with status ${result.status ?? 'unknown'}`)
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-imir-'))
try {
  const opaqueSource = createSource(false)
  const alphaSource = createSource(true)
  if (sha256(opaqueSource) !== avifMirrorSourcePngSha256.opaque) {
    throw new Error('Opaque imir source checksum changed')
  }
  if (sha256(alphaSource) !== avifMirrorSourcePngSha256.alpha) {
    throw new Error('Alpha imir source checksum changed')
  }
  const opaquePath = join(temporaryDirectory, 'opaque.png')
  const alphaPath = join(temporaryDirectory, 'alpha.png')
  await writeFile(opaquePath, opaqueSource)
  await writeFile(alphaPath, alphaSource)

  for (const fixture of avifMirrorFixtures) {
    const outputPath = join(avifMirrorFixtureDirectory, fixture.file)
    const common = ['--jobs', '1', '--lossless', '-y', '444', '--cicp', '1/13/0', '--range', 'full']
    if (fixture.primaryItemType === 'grid') {
      encode([
        ...common,
        '--grid',
        '2x2',
        '--crop',
        '16,24,112,96',
        '--irot',
        '1',
        '--imir',
        String(fixture.mirrorAxis),
        alphaPath,
        outputPath,
      ])
    } else {
      encode([...common, '--imir', String(fixture.mirrorAxis), opaquePath, outputPath])
    }
    const encoded = await readFile(outputPath)
    const encodedSha256 = sha256(encoded)
    if (encodedSha256 !== fixture.fileSha256) {
      throw new Error(`${fixture.file} checksum changed: ${encodedSha256}`)
    }
    console.log(`generated ${fixture.file}`)
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
