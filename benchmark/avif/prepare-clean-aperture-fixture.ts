import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PNG } from 'pngjs'
import sharp from 'sharp'

import {
  avifCleanApertureFixture,
  avifCleanApertureFixtureDirectory,
} from './clean-aperture-fixture.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const createSource = (): Uint8Array => {
  const { encodedWidth: width, encodedHeight: height } = avifCleanApertureFixture
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      png.data[offset] = x * 16
      png.data[offset + 1] = y * 20
      png.data[offset + 2] = (x * 13 + y * 7) & 0xff
      png.data[offset + 3] = 0xff
    }
  }
  return PNG.sync.write(png)
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-clean-aperture-'))
try {
  const source = createSource()
  const sourceSha256 = sha256(source)
  if (sourceSha256 !== avifCleanApertureFixture.sourcePngSha256) {
    throw new Error(`Clean-aperture source checksum changed: ${sourceSha256}`)
  }

  const sourcePath = join(temporaryDirectory, 'source.png')
  const outputPath = join(avifCleanApertureFixtureDirectory, avifCleanApertureFixture.file)
  await writeFile(sourcePath, source)
  const { x, y, width, height } = avifCleanApertureFixture.crop
  const result = spawnSync(
    'avifenc',
    [
      '-j',
      '1',
      '--lossless',
      '--yuv',
      '444',
      '--cicp',
      '1/13/0',
      '--crop',
      `${x},${y},${width},${height}`,
      '-s',
      '6',
      sourcePath,
      outputPath,
    ],
    { stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`avifenc exited with status ${result.status ?? 'unknown'}`)
  }

  const encoded = await readFile(outputPath)
  const encodedSha256 = sha256(encoded)
  if (encodedSha256 !== avifCleanApertureFixture.fileSha256) {
    throw new Error(`Clean-aperture AVIF checksum changed: ${encodedSha256}`)
  }
  const oracle = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (oracle.info.width !== width || oracle.info.height !== height) {
    throw new Error(
      `Sharp clean-aperture dimensions changed: ${oracle.info.width}x${oracle.info.height}`,
    )
  }
  const oracleSha256 = sha256(oracle.data)
  if (oracleSha256 !== avifCleanApertureFixture.sharpRgbaSha256) {
    throw new Error(`Sharp clean-aperture checksum changed: ${oracleSha256}`)
  }
  console.log(`generated ${avifCleanApertureFixture.file}`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
