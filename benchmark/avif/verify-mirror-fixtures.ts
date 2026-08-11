import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PNG } from 'pngjs'
import sharp from 'sharp'

import { allCodecs } from '../../src/codec-entries/all.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { createNodeImageLibrary } from '../../src/node-image.ts'
import { MemorySource } from '../../src/source.ts'
import {
  type AvifMirrorFixture,
  avifMirrorFixturePath,
  avifMirrorFixtures,
} from './mirror-fixtures.ts'

const Image = createNodeImageLibrary(allCodecs)
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const expectedRgba = (fixture: AvifMirrorFixture): Uint8Array => {
  const output = new Uint8Array(fixture.decodedWidth * fixture.decodedHeight * 4)
  for (let y = 0; y < fixture.decodedHeight; y += 1) {
    for (let x = 0; x < fixture.decodedWidth; x += 1) {
      let sourceX: number
      let sourceY: number
      if (fixture.primaryItemType === 'grid') {
        sourceX = 16 + (111 - y)
        sourceY = 24 + (95 - x)
      } else if (fixture.mirrorAxis === 0) {
        sourceX = x
        sourceY = 159 - y
      } else {
        sourceX = 159 - x
        sourceY = y
      }
      const offset = (y * fixture.decodedWidth + x) * 4
      output[offset] = (sourceX * 13 + sourceY * 3) & 0xff
      output[offset + 1] = (sourceX * 5 + sourceY * 11) & 0xff
      output[offset + 2] = ((sourceX ^ sourceY) * 7) & 0xff
      output[offset + 3] = fixture.hasAlpha ? 32 + ((sourceX * 7 + sourceY * 9) % 224) : 0xff
    }
  }
  return output
}

const decodeAvifdec = async (
  path: string,
  decoder: 'aom' | 'dav1d',
  outputPath: string,
): Promise<PNG> => {
  const result = spawnSync('avifdec', ['-j', '1', '--codec', decoder, path, outputPath], {
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`avifdec ${decoder} failed: ${result.stderr}`)
  return PNG.sync.read(await readFile(outputPath))
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-imir-verify-'))
try {
  const results: object[] = []
  for (const fixture of avifMirrorFixtures) {
    const path = avifMirrorFixturePath(fixture)
    const input = new Uint8Array(await readFile(path))
    if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)

    const image = await Image.open(input)
    const metadata = await image.metadata()
    if (metadata.orientation !== fixture.orientation || metadata.hasAlpha !== fixture.hasAlpha) {
      throw new Error(`${fixture.file} mirror metadata changed`)
    }
    const purePng = PNG.sync.read(await image.autoOrient().png().toBuffer())
    if (purePng.width !== fixture.decodedWidth || purePng.height !== fixture.decodedHeight) {
      throw new Error(`${fixture.file} auto-oriented dimensions changed`)
    }
    const pure = new Uint8Array(purePng.data)
    if (sha256(pure) !== fixture.decodedRgbaSha256) {
      throw new Error(`${fixture.file} auto-oriented RGBA checksum changed`)
    }
    if (!Buffer.from(pure).equals(expectedRgba(fixture))) {
      throw new Error(`${fixture.file} does not match its deterministic mirrored source pixels`)
    }

    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    if (
      inspection.primaryItemType !== fixture.primaryItemType ||
      inspection.mirroring !== fixture.mirrorAxis ||
      inspection.rotation !== (fixture.primaryItemType === 'grid' ? 1 : 0)
    ) {
      throw new Error(`${fixture.file} transformative property inspection changed`)
    }
    for (const coded of inspection.codedImages.filter((image) => image.role === 'color')) {
      if (
        coded.mirroring !== fixture.mirrorAxis ||
        coded.rotation !== (fixture.primaryItemType === 'grid' ? 1 : 0)
      ) {
        throw new Error(`${fixture.file} coded color transform associations changed`)
      }
    }

    const nativeDecoders: Record<string, string> = {}
    for (const decoder of ['dav1d', 'aom'] as const) {
      const native = await decodeAvifdec(
        path,
        decoder,
        join(temporaryDirectory, `${fixture.file}-${decoder}.png`),
      )
      if (native.width !== fixture.rawWidth || native.height !== fixture.rawHeight) {
        throw new Error(`${fixture.file} ${decoder} raw dimensions changed`)
      }
      const nativeHash = sha256(native.data)
      if (nativeHash !== fixture.rawRgbaSha256) {
        throw new Error(`${fixture.file} ${decoder} raw RGBA checksum changed: ${nativeHash}`)
      }
      nativeDecoders[decoder] = nativeHash
    }

    const sharpOutput = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (
      sharpOutput.info.width !== fixture.sharpWidth ||
      sharpOutput.info.height !== fixture.sharpHeight
    ) {
      throw new Error(`${fixture.file} Sharp dimensions changed`)
    }
    const sharpHash = sha256(sharpOutput.data)
    if (sharpHash !== fixture.sharpRgbaSha256) {
      throw new Error(`${fixture.file} Sharp RGBA checksum changed: ${sharpHash}`)
    }

    results.push({
      file: fixture.file,
      orientation: fixture.orientation,
      dimensions: [fixture.decodedWidth, fixture.decodedHeight],
      rgbaSha256: fixture.decodedRgbaSha256,
      nativeDecoders,
      sharp: {
        dimensions: [fixture.sharpWidth, fixture.sharpHeight],
        rgbaSha256: sharpHash,
        matchesPure: sharpHash === fixture.decodedRgbaSha256,
      },
    })
  }
  console.log(JSON.stringify({ results }))
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
