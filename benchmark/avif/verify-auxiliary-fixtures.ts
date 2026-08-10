import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { allCodecs } from '../../src/codec-entries/all.ts'
import { parseAv1FrameObus } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra } from '../../src/codecs/av1-intra.ts'
import { type AvifCodedImageInspection, inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { createNodeImageLibrary } from '../../src/node-image.ts'
import { MemorySource } from '../../src/source.ts'
import {
  avifAlphaGridFixture,
  avifAlphaTransformDecodedRgbaSha256,
  avifAlphaTransformFixtures,
  avifAuxiliaryFixtureDirectory,
  avifAuxiliaryRoleFixtures,
  avifExpandedAlphaFixtures,
} from './auxiliary-fixtures.ts'

const Image = createNodeImageLibrary(allCodecs)
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const alphaPlane = (rgba: Uint8Array): Uint8Array => {
  const alpha = new Uint8Array(rgba.byteLength / 4)
  for (let index = 0, offset = 3; index < alpha.length; index += 1, offset += 4) {
    alpha[index] = rgba[offset] ?? 0
  }
  return alpha
}
const decodePureRgba = async (path: string): Promise<Uint8Array> => {
  const png = PNG.sync.read(await (await Image.open(path)).png().toBuffer())
  return new Uint8Array(png.data)
}
const decodeAvifdecRgba = async (
  path: string,
  decoder: 'aom' | 'dav1d',
  outputPath: string,
): Promise<Uint8Array> => {
  const result = spawnSync('avifdec', ['-j', '1', '--codec', decoder, path, outputPath], {
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`avifdec ${decoder} failed: ${result.stderr}`)
  return new Uint8Array(PNG.sync.read(await readFile(outputPath)).data)
}
const nativeAlphaPlane = (coded: AvifCodedImageInspection): Uint8Array => {
  const frame = decodeRestrictedAv1Intra(
    coded.sequence,
    parseAv1FrameObus(coded.sequence, coded.obus),
  )
  const output = new Uint8Array(frame.width * frame.height)
  for (let y = 0; y < frame.height; y += 1) {
    output.set(
      frame.y.subarray(y * frame.yStride, y * frame.yStride + frame.width),
      y * frame.width,
    )
  }
  return output
}

const results: Array<Record<string, unknown>> = []
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-auxiliary-oracles-'))
try {
  for (const fixture of avifExpandedAlphaFixtures) {
    const path = join(avifAuxiliaryFixtureDirectory, fixture.file)
    const input = new Uint8Array(await readFile(path))
    if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const alpha = inspection.codedImages.find((image) => image.role === 'alpha')
    if (
      !alpha ||
      alpha.sequence.bitDepth !== fixture.alphaBitDepth ||
      alpha.sequence.fullRange !== fixture.alphaFullRange
    ) {
      throw new Error(`${fixture.file} alpha configuration changed`)
    }
    const pure = await decodePureRgba(path)
    if (sha256(pure) !== fixture.decodedRgbaSha256) {
      throw new Error(`${fixture.file} portable RGBA checksum changed`)
    }
    if (fixture.alphaBitDepth === 8) {
      const native = nativeAlphaPlane(alpha)
      if (sha256(native) !== '57a3e2dc01f8073971501db8bd7e0907ff285fa6e9dcdab89bd6000940bde3f3') {
        throw new Error(`${fixture.file} native alpha checksum changed`)
      }
      if (!fixture.decodedAlphaSha256 || sha256(alphaPlane(pure)) !== fixture.decodedAlphaSha256) {
        throw new Error(`${fixture.file} normalized alpha checksum changed`)
      }
      const lastObu = alpha.obus.at(-1)
      if (!lastObu) throw new Error(`${fixture.file} alpha item has no OBU`)
      const payloadOffset = Buffer.from(input).indexOf(Buffer.from(lastObu.payload))
      const itemOffset = payloadOffset - lastObu.headerBytes - lastObu.offset
      if (itemOffset < 0) throw new Error(`${fixture.file} alpha item payload was not found`)
      const bitstream = new Uint8Array(alpha.payloadBytes + 2)
      bitstream.set([0x12, 0])
      bitstream.set(input.subarray(itemOffset, itemOffset + alpha.payloadBytes), 2)
      const bitstreamPath = join(temporaryDirectory, 'limited-alpha.obu')
      const oraclePath = join(temporaryDirectory, 'limited-alpha.gray')
      await writeFile(bitstreamPath, bitstream)
      const oracle = spawnSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'obu',
          '-c:v',
          'libdav1d',
          '-i',
          bitstreamPath,
          '-frames:v',
          '1',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'gray',
          oraclePath,
        ],
        { encoding: 'utf8' },
      )
      if (oracle.error) throw oracle.error
      if (oracle.status !== 0) throw new Error(`FFmpeg/dav1d alpha decode failed: ${oracle.stderr}`)
      if (!Buffer.from(native).equals(await readFile(oraclePath))) {
        throw new Error(`${fixture.file} native alpha differs from dav1d`)
      }
    } else {
      for (const decoder of ['dav1d', 'aom'] as const) {
        const oracle = await decodeAvifdecRgba(
          path,
          decoder,
          join(temporaryDirectory, `${fixture.file}-${decoder}.png`),
        )
        if (!Buffer.from(pure).equals(oracle)) {
          throw new Error(`${fixture.file} RGBA differs from ${decoder}`)
        }
      }
    }
    results.push({
      file: fixture.file,
      alphaBitDepth: fixture.alphaBitDepth,
      alphaFullRange: fixture.alphaFullRange,
    })
  }

  const gridPath = join(avifAuxiliaryFixtureDirectory, avifAlphaGridFixture.file)
  const gridInput = new Uint8Array(await readFile(gridPath))
  if (sha256(gridInput) !== avifAlphaGridFixture.fileSha256)
    throw new Error('Alpha grid checksum changed')
  const gridInspection = await inspectAvifBitstreams(new MemorySource(gridInput))
  if (gridInspection.alphaAssociations.length !== gridInspection.colorItemIds.length) {
    throw new Error('Alpha grid associations changed')
  }
  const gridPure = await decodePureRgba(gridPath)
  if (sha256(gridPure) !== avifAlphaGridFixture.decodedRgbaSha256) {
    throw new Error('Alpha grid portable RGBA checksum changed')
  }
  for (const decoder of ['dav1d', 'aom'] as const) {
    const oracle = await decodeAvifdecRgba(
      gridPath,
      decoder,
      join(temporaryDirectory, `alpha-grid-${decoder}.png`),
    )
    if (sha256(oracle) !== avifAlphaGridFixture.oracleRgbaSha256) {
      throw new Error(`Alpha grid ${decoder} RGBA checksum changed`)
    }
    if (sha256(alphaPlane(oracle)) !== avifAlphaGridFixture.decodedAlphaSha256) {
      throw new Error(`Alpha grid ${decoder} alpha checksum changed`)
    }
    let maximumRgbDifference = 0
    for (let offset = 0; offset < gridPure.byteLength; offset += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        maximumRgbDifference = Math.max(
          maximumRgbDifference,
          Math.abs((gridPure[offset + channel] ?? 0) - (oracle[offset + channel] ?? 0)),
        )
      }
    }
    if (maximumRgbDifference > 1) throw new Error(`Alpha grid ${decoder} RGB drifted`)
  }
  results.push({
    file: avifAlphaGridFixture.file,
    alphaTiles: gridInspection.alphaAssociations.length,
  })

  for (const fixture of avifAlphaTransformFixtures) {
    const path = join(avifAuxiliaryFixtureDirectory, fixture.file)
    const input = new Uint8Array(await readFile(path))
    if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
    const pure = await decodePureRgba(path)
    if (sha256(pure) !== avifAlphaTransformDecodedRgbaSha256) {
      throw new Error(`${fixture.file} transformed RGBA checksum changed`)
    }
    for (const decoder of ['dav1d', 'aom'] as const) {
      const oracle = await decodeAvifdecRgba(
        path,
        decoder,
        join(temporaryDirectory, `${fixture.file}-${decoder}.png`),
      )
      if (!Buffer.from(pure).equals(oracle)) {
        throw new Error(`${fixture.file} RGBA differs from ${decoder}`)
      }
    }
  }
  results.push({ transformedAlphaItems: avifAlphaTransformFixtures.length })

  for (const fixture of avifAuxiliaryRoleFixtures) {
    const path = join(avifAuxiliaryFixtureDirectory, fixture.file)
    const input = new Uint8Array(await readFile(path))
    if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const colorItems = inspection.codedImages.filter((image) => image.role === 'color').length
    const alphaItems = inspection.codedImages.filter((image) => image.role === 'alpha').length
    if (colorItems !== fixture.colorItems || alphaItems !== fixture.alphaItems) {
      throw new Error(`${fixture.file} auxiliary roles changed`)
    }
    results.push({ file: fixture.file, colorItems, alphaItems })
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}

console.log(JSON.stringify({ decoders: ['PureJsImage', 'dav1d', 'libaom'], results }, null, 2))
