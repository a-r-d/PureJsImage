import { readFile } from 'node:fs/promises'
import { allCodecs } from '../../src/codec-entries/all.ts'
import { experimentalHeifCodec } from '../../src/codec-entries/experimental/heic.ts'
import { inspectHeifBitstream } from '../../src/codecs/heif.ts'
import { createImageLibrary, MemorySource } from '../../src/index.ts'
import {
  allFixtures,
  fixturePath,
  inspectFixture,
  readManifest,
  verifyInspection,
} from '../lib/corpus.ts'
import { heifBenchmarkFixtures } from './corpus.ts'

const Image = createImageLibrary([...allCodecs, experimentalHeifCodec])

const manifest = await readManifest()
const fixtures = new Map(allFixtures(manifest).map((fixture) => [fixture.id, fixture]))

for (const expectedFixture of heifBenchmarkFixtures) {
  const fixture = fixtures.get(expectedFixture.id)
  if (!fixture) throw new Error(`HEIF fixture is absent from the corpus: ${expectedFixture.id}`)

  const inspectionErrors = verifyInspection(fixture, await inspectFixture(fixture))
  if (inspectionErrors.length > 0) {
    throw new Error(`${expectedFixture.id}: ${inspectionErrors.join('; ')}`)
  }

  const input = await readFile(fixturePath(fixture))
  const metadata = await (await Image.open(input)).metadata()
  const expected = expectedFixture.expected
  for (const field of [
    'width',
    'height',
    'bitDepth',
    'chromaSubsampling',
    'codecProfile',
    'colorSpace',
    'orientation',
  ] as const) {
    if (metadata[field] !== expected[field]) {
      throw new Error(
        `${expectedFixture.id} ${field}: expected ${expected[field]}, got ${metadata[field]}`,
      )
    }
  }
  if (metadata.format !== 'heif') {
    throw new Error(`${expectedFixture.id} format: expected heif, got ${metadata.format}`)
  }

  const bitstream = await inspectHeifBitstream(new MemorySource(input))
  if (bitstream.primaryItemType !== expected.primaryItemType) {
    throw new Error(
      `${expectedFixture.id} primary item: expected ${expected.primaryItemType}, got ${bitstream.primaryItemType}`,
    )
  }
  if (bitstream.codedImages.length !== expected.codedImages) {
    throw new Error(
      `${expectedFixture.id} coded images: expected ${expected.codedImages}, got ${bitstream.codedImages.length}`,
    )
  }

  for (const codedImage of bitstream.codedImages) {
    const sps = codedImage.configuration.sps[0]
    const pps = codedImage.configuration.pps[0]
    const slice = codedImage.slices[0]
    if (
      codedImage.configuration.profile !== expected.codecProfile ||
      codedImage.configuration.bitDepth !== expected.bitDepth ||
      codedImage.configuration.chromaSubsampling !== expected.chromaSubsampling ||
      !sps?.scalingListsEnabled ||
      !sps.sampleAdaptiveOffset ||
      !pps?.cuQpDeltaEnabled ||
      !pps.entropyCodingSynchronization ||
      slice?.entryPointOffsets !== 15
    ) {
      throw new Error(`${expectedFixture.id} contains an unexpected HEVC tile configuration`)
    }
  }

  console.log(
    `${expectedFixture.id}: ${expected.width}x${expected.height}, ${expected.codedImages} HEVC tiles verified`,
  )
}
