import { join } from 'node:path'
import { PNG } from 'pngjs'
import { ImageError } from '../../src/errors.ts'
import { Image } from '../../src/index.ts'
import { avifCorpusDirectory, avifFixtures } from './corpus.ts'

const neutralLosslessAvif = Buffer.from(
  'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAEAAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGAAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAGG1kYXQSAAoFGAA2ACAyBRAAAASA',
  'base64',
)
const lossyReference = [
  0, 132, 0, 255, 0, 145, 0, 255, 35, 117, 23, 255, 122, 129, 121, 255, 0, 145, 0, 255, 1, 157, 0,
  255, 123, 130, 122, 255, 210, 142, 220, 255, 36, 118, 24, 255, 123, 130, 122, 255, 245, 103, 255,
  255, 255, 114, 255, 255, 122, 129, 121, 255, 210, 142, 220, 255, 255, 114, 255, 255, 255, 125,
  255, 255,
] as const
const commonPhotographs = [
  { file: 'kodim03_yuv420_8bpc.avif', width: 768, height: 512 },
  { file: 'fox.profile0.8bpc.yuv420.avif', width: 1204, height: 800 },
] as const

const median = (values: readonly number[]): number => {
  const ordered = [...values].sort((left, right) => left - right)
  const middle = ordered[Math.floor(ordered.length / 2)]
  if (middle === undefined) throw new Error('Cannot take the median of no values')
  return middle
}

const decodeNeutral = async (): Promise<void> => {
  const decoded = PNG.sync.read(await (await Image.open(neutralLosslessAvif)).png().toBuffer())
  if (decoded.width !== 2 || decoded.height !== 2) throw new Error('B2 dimensions are incorrect')
  for (let offset = 0; offset < decoded.data.byteLength; offset += 4) {
    if (
      decoded.data[offset] !== 130 ||
      decoded.data[offset + 1] !== 130 ||
      decoded.data[offset + 2] !== 130 ||
      decoded.data[offset + 3] !== 255
    ) {
      throw new Error('B2 pixels differ from the libavif reference decode')
    }
  }
}

const decodeLossy = async (): Promise<void> => {
  const decoded = PNG.sync.read(
    await (await Image.open(join(avifCorpusDirectory, 'extended_pixi.avif'))).png().toBuffer(),
  )
  if (decoded.width !== 4 || decoded.height !== 4)
    throw new Error('Lossy B2 dimensions are incorrect')
  if (decoded.data.some((value, index) => value !== lossyReference[index])) {
    throw new Error('Lossy B2 pixels differ from the independent reference decode')
  }
}

const decodePhotograph = async (fixture: (typeof commonPhotographs)[number]): Promise<void> => {
  const decoded = PNG.sync.read(
    await (await Image.open(join(avifCorpusDirectory, fixture.file))).png().toBuffer(),
  )
  if (decoded.width !== fixture.width || decoded.height !== fixture.height) {
    throw new Error(`${fixture.file} dimensions are incorrect`)
  }
}

await decodeNeutral()
await decodeLossy()
const timings: number[] = []
let maximumRss = process.memoryUsage.rss()
for (let iteration = 0; iteration < 25; iteration += 1) {
  globalThis.gc?.()
  const start = performance.now()
  await decodeNeutral()
  timings.push(performance.now() - start)
  maximumRss = Math.max(maximumRss, process.memoryUsage.rss())
}
const targetedMaximumRss = maximumRss

const photographResults: { file: string; medianWallMs: number }[] = []
for (const fixture of commonPhotographs) {
  const photographTimings: number[] = []
  for (let iteration = 0; iteration < 5; iteration += 1) {
    globalThis.gc?.()
    const start = performance.now()
    await decodePhotograph(fixture)
    photographTimings.push(performance.now() - start)
    maximumRss = Math.max(maximumRss, process.memoryUsage.rss())
  }
  photographResults.push({
    file: fixture.file,
    medianWallMs: Number(median(photographTimings).toFixed(3)),
  })
}

let compatible = 0
let unsupported = 0
let invalid = 0
const unexpected: string[] = []
for (const fixture of avifFixtures) {
  try {
    const decoded = PNG.sync.read(
      await (await Image.open(join(avifCorpusDirectory, fixture.file))).png().toBuffer(),
    )
    if (decoded.width !== fixture.expected.width || decoded.height !== fixture.expected.height) {
      throw new Error('decoded dimensions differ from the corpus manifest')
    }
    compatible += 1
  } catch (error: unknown) {
    if (error instanceof ImageError && error.code === 'UNSUPPORTED_OPERATION') unsupported += 1
    else if (error instanceof ImageError && error.code === 'INVALID_INPUT') invalid += 1
    else
      unexpected.push(`${fixture.file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log(
  JSON.stringify(
    {
      targetedFixture: {
        compatible: true,
        source: 'libavif avifenc 1.3.0 / libaom, lossless 2x2 YUV420',
        runs: timings.length,
        medianWallMs: Number(median(timings).toFixed(3)),
        maximumObservedRssMiB: Number((targetedMaximumRss / 1024 ** 2).toFixed(1)),
        output: '2x2 RGBA, exact reference pixels',
      },
      lossyFixture: {
        compatible: true,
        source: 'libavif extended_pixi.avif, 8-bit lossy YUV420',
        output: '4x4 RGBA, exact reference pixels',
      },
      commonPhotographs: {
        compatible: `${commonPhotographs.length}/${commonPhotographs.length}`,
        runsPerFixture: 5,
        maximumObservedRssMiB: Number((maximumRss / 1024 ** 2).toFixed(1)),
        fixtures: photographResults,
      },
      broadCorpus: {
        total: avifFixtures.length,
        compatible,
        unsupported,
        invalid,
        unexpected,
      },
    },
    undefined,
    2,
  ),
)
