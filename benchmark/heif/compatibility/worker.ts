import { readFile, writeFile } from 'node:fs/promises'
import { allCodecs } from '../../../src/codec-entries/all.ts'
import { experimentalHeifCodec } from '../../../src/codec-entries/experimental/heic.ts'
import { inspectHeifBitstream } from '../../../src/codecs/heif.ts'
import { createImageLibrary, ImageError, MemorySource } from '../../../src/index.ts'

const [fixturePath, outputPath] = process.argv.slice(2)
if (!fixturePath || !outputPath) throw new Error('Usage: worker.ts <fixture> <output-png>')

const Image = createImageLibrary([...allCodecs, experimentalHeifCodec])
const input = await readFile(fixturePath)
const started = performance.now()

try {
  const metadata = await (await Image.open(input)).metadata()
  const bitstream = await inspectHeifBitstream(new MemorySource(input))
  const output = await (await Image.open(input)).autoOrient().png().toBuffer()
  await writeFile(outputPath, output)
  const configurations = bitstream.codedImages.map(({ configuration, slices }) => {
    const sps = configuration.sps[0]
    const pps = configuration.pps[0]
    return {
      profile: configuration.profile,
      bitDepth: configuration.bitDepth,
      chroma: configuration.chromaSubsampling,
      slices: slices.length,
      wpp: pps?.entropyCodingSynchronization ?? false,
      tiles: pps?.tilesEnabled ?? false,
      fullRange: sps?.vui?.fullRange,
      primaries: sps?.vui?.colorPrimaries,
      transfer: sps?.vui?.transferCharacteristics,
      matrix: sps?.vui?.matrixCoefficients,
    }
  })
  const uniqueConfigurations = [
    ...new Map(configurations.map((value) => [JSON.stringify(value), value])).values(),
  ]
  console.log(
    JSON.stringify({
      outcome: 'decoded',
      wallMilliseconds: Number((performance.now() - started).toFixed(3)),
      maximumRssBytes: process.resourceUsage().maxRSS * 1024,
      outputBytes: output.byteLength,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation ?? 1,
        bitDepth: metadata.bitDepth,
        chromaSubsampling: metadata.chromaSubsampling,
        codecProfile: metadata.codecProfile,
        colorSpace: metadata.colorSpace,
        colorProfile: metadata.colorProfile,
      },
      bitstream: {
        primaryItemType: bitstream.primaryItemType,
        codedImages: bitstream.codedImages.length,
        configurations: uniqueConfigurations,
      },
    }),
  )
} catch (error: unknown) {
  console.log(
    JSON.stringify({
      outcome: 'error',
      wallMilliseconds: Number((performance.now() - started).toFixed(3)),
      maximumRssBytes: process.resourceUsage().maxRSS * 1024,
      error: {
        code: error instanceof ImageError ? error.code : undefined,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      },
    }),
  )
}
