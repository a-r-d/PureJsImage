import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { allCodecs } from '../src/codec-entries/all.ts'
import { inspectJpegXlStructure } from '../src/codecs/jpegxl.ts'
import { ImageError } from '../src/index.ts'
import { createCodecFixtures, type CodecFixture } from './codec-fixtures.ts'
import { jpegXlContainerFixture } from './fixtures.ts'
import { Image } from './image-library.ts'

const truncationStep = 1_024
const releaseCampaign = process.env.PUREJSIMAGE_FUZZ_RELEASE === '1'

const configuredInteger = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const configured = process.env[name]
  if (configured === undefined) return fallback
  const value = Number(configured)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

const bitFlipCases = configuredInteger(
  'PUREJSIMAGE_FUZZ_CASES',
  releaseCampaign ? 512 : 16,
  1,
  10_000,
)
const campaignSeed = configuredInteger('PUREJSIMAGE_FUZZ_SEED', 0x5eed_2026, 0, 0xffff_ffff)
const campaignTimeout = releaseCampaign ? 3_300_000 : 30_000
const crashDirectory = process.env.PUREJSIMAGE_FUZZ_CRASH_DIR

interface FuzzFixture {
  readonly id: string
  readonly input: Uint8Array
}

interface BitFlip {
  readonly bit: number
  readonly byteOffset: number
  readonly index: number
  readonly input: Uint8Array
}

const benchmarkSeeds = [
  {
    format: 'jpeg',
    id: 'wpt-webcodecs-mozjpeg-rgb',
    path: 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-rgb.jpg',
  },
  {
    format: 'jpegxl',
    id: 'conformance-alpha-nonpremultiplied',
    path: 'benchmark/fixtures/jpegxl/conformance-alpha-nonpremultiplied.jxl',
  },
  {
    format: 'jp2',
    id: 'openjpeg-lossless-rgb16',
    path: 'benchmark/corpus/files/jp2/openjpeg-lossless-rgb16.jp2',
  },
  {
    format: 'png',
    id: 'pngsuite-palette-8',
    path: 'benchmark/corpus/files/pngsuite-palette-8.png',
  },
  {
    format: 'gif',
    id: 'static-transparent-640x360',
    path: 'benchmark/corpus/files/static-transparent-640x360.gif',
  },
  {
    format: 'webp',
    id: 'webp-lossless-tux-386x395',
    path: 'benchmark/corpus/files/webp-lossless-tux-386x395.webp',
  },
  {
    format: 'avif',
    id: 'kodim03-yuv420-8bpc',
    path: 'benchmark/corpus/files/avif/kodim03_yuv420_8bpc.avif',
  },
  {
    format: 'bmp',
    id: 'bmpsuite-rgb24',
    path: 'benchmark/corpus/files/bmpsuite-rgb24.bmp',
  },
  {
    format: 'hdr',
    id: 'radiance-2x2',
    path: 'tests/fixtures/small-codecs/radiance-2x2.hdr',
  },
  {
    format: 'ico',
    id: 'ico-dib24-mask-96',
    path: 'benchmark/corpus/files/ico-dib24-mask-96.ico',
  },
  {
    format: 'netpbm',
    id: 'ffmpeg-pfm-potsdamer',
    path: 'tests/fixtures/small-codecs/potsdamer-8x4-ffmpeg.pfm',
  },
  {
    format: 'qoi',
    id: 'reference-qoi-city-16x16',
    path: 'tests/fixtures/small-codecs/city-16x16-reference.qoi',
  },
  {
    format: 'tga',
    id: 'ffmpeg-tga-city-16x16',
    path: 'tests/fixtures/small-codecs/city-16x16-ffmpeg-rle.tga',
  },
  {
    format: 'tiff',
    id: 'libtiff-rgb-3c-8b',
    path: 'benchmark/corpus/files/libtiff-rgb-3c-8b.tiff',
  },
] as const satisfies readonly {
  readonly format: CodecFixture['format']
  readonly id: string
  readonly path: string
}[]

const avifHardeningSeeds = [
  {
    id: 'superres-yuv420',
    path: 'benchmark/corpus/files/avif/libaom-superres-denom12-yuv420-96x64.avif',
  },
  {
    id: 'superres-yuv420-multi-band',
    path: 'benchmark/corpus/files/avif/libaom-superres-denom12-yuv420-320x192.avif',
  },
  {
    id: 'tiled-high-bit',
    path: 'benchmark/corpus/files/avif/tiled-lossless-10bpc-yuv444-2x2-256x256.avif',
  },
  {
    id: 'premultiplied-alpha',
    path: 'benchmark/corpus/files/avif/alpha-premultiplied-64x48.avif',
  },
  {
    id: 'restoration-units',
    path: 'benchmark/corpus/files/avif/post-filter-restoration-units-300x130.avif',
  },
  {
    id: 'cropped-grid',
    path: 'benchmark/corpus/files/avif/sofa_grid1x5_420.avif',
  },
] as const

const persistRawCrash = async (
  input: Uint8Array,
  label: string,
  failure: unknown,
): Promise<void> => {
  if (!crashDirectory) return
  await mkdir(crashDirectory, { recursive: true })
  const basename = label.replaceAll(/[^a-zA-Z0-9._-]/g, '-').slice(0, 180)
  const detail =
    failure instanceof Error
      ? { message: failure.message, name: failure.name, stack: failure.stack }
      : { value: String(failure) }
  await Promise.all([
    writeFile(join(crashDirectory, `${basename}.bin`), input),
    writeFile(join(crashDirectory, `${basename}.json`), `${JSON.stringify(detail, null, 2)}\n`),
  ])
}

const exercise = async (
  input: Uint8Array,
  label: string,
  failureRequired: boolean,
): Promise<void> => {
  let failure: unknown
  let threw = false
  try {
    const image = await Image.open(input)
    const metadata = await image.metadata()
    await image
      .crop({
        x: 0,
        y: 0,
        width: Math.min(8, metadata.width),
        height: Math.min(8, metadata.height),
      })
      .png()
      .toBuffer()
  } catch (error) {
    threw = true
    failure = error
  }

  if (failureRequired) expect(threw, `${label} unexpectedly decoded`).toBe(true)
  if (threw && !(failure instanceof ImageError)) await persistRawCrash(input, label, failure)
  if (threw) expect(failure, label).toBeInstanceOf(ImageError)
}

const seedFor = (id: string): number => {
  let seed = 0x811c_9dc5
  for (const character of id) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 16_777_619) >>> 0
  }
  return (seed ^ campaignSeed) >>> 0 || 0xa341_316c
}

const bitFlips = function* (fixture: FuzzFixture): Generator<BitFlip> {
  let state = seedFor(fixture.id)
  for (let index = 0; index < bitFlipCases; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    const byteOffset = state % fixture.input.byteLength
    const bit = 1 << ((state >>> 29) & 7)
    const input = fixture.input.slice()
    input[byteOffset] = (input[byteOffset] ?? 0) ^ bit
    yield { bit, byteOffset, index, input }
  }
}

const loadBenchmarkSeeds = async (): Promise<readonly FuzzFixture[]> =>
  Promise.all(
    benchmarkSeeds.map(async ({ format, id, path }) => ({
      format,
      id: `benchmark-${id}`,
      input: await readFile(path),
    })),
  )

const loadAvifHardeningSeeds = async (): Promise<readonly FuzzFixture[]> =>
  Promise.all(
    avifHardeningSeeds.map(async ({ id, path }) => ({
      id: `avif-${id}`,
      input: await readFile(path),
    })),
  )

const loadRegressionFixtures = async (): Promise<readonly FuzzFixture[]> => {
  const directory = 'tests/fuzz-regressions'
  const entries = await readdir(directory, { withFileTypes: true })
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.bin'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => ({
        id: `regression-${entry.name}`,
        input: await readFile(join(directory, entry.name)),
      })),
  )
}

describe('deterministic corruption fuzz', () => {
  let fixtures: readonly FuzzFixture[] = []
  let campaignFixtures: readonly FuzzFixture[] = []
  let regressionFixtures: readonly FuzzFixture[] = []
  let avifHardeningFixtures: readonly FuzzFixture[] = []

  beforeAll(async () => {
    fixtures = (await createCodecFixtures()).map((fixture) => ({
      ...fixture,
      id: `generated-${fixture.format}`,
    }))
    avifHardeningFixtures = await loadAvifHardeningSeeds()
    campaignFixtures = releaseCampaign ? await loadBenchmarkSeeds() : fixtures
    regressionFixtures = await loadRegressionFixtures()
  })

  it('pins one committed release-campaign seed for every registered pixel decoder', async () => {
    expect(benchmarkSeeds.map(({ format }) => format)).toEqual(
      allCodecs
        .filter(({ createDecoder }) => createDecoder !== undefined)
        .map(({ format }) => format),
    )
    expect(
      benchmarkSeeds.every(
        ({ path }) =>
          path.startsWith('benchmark/corpus/files/') ||
          path.startsWith('benchmark/fixtures/jpegxl/') ||
          path.startsWith('tests/fixtures/small-codecs/'),
      ),
    ).toBe(true)
    await Promise.all(benchmarkSeeds.map(({ path }) => access(path)))
  })

  it('normalizes deterministic JPEG XL structure corruption as ImageErrors', async () => {
    const fixture = { id: 'jpegxl-structure', input: jpegXlContainerFixture() }
    for (const corruption of bitFlips(fixture)) {
      try {
        await inspectJpegXlStructure(corruption.input)
      } catch (error) {
        expect(error, `JPEG XL corruption at byte ${corruption.byteOffset}`).toBeInstanceOf(
          ImageError,
        )
      }
    }

    for (let length = 0; length < fixture.input.byteLength; length += 1) {
      await expect(
        inspectJpegXlStructure(fixture.input.subarray(0, length)),
      ).rejects.toBeInstanceOf(ImageError)
    }
  })

  it(
    'normalizes deterministic corruption across diverse AVIF syntax classes',
    async () => {
      await Promise.all(avifHardeningSeeds.map(({ path }) => access(path)))
      for (const fixture of avifHardeningFixtures) {
        for (const corruption of bitFlips(fixture)) {
          const label = `${fixture.id}-seed-${campaignSeed}-case-${corruption.index}-offset-${corruption.byteOffset}-bit-${corruption.bit}`
          await exercise(corruption.input, label, false)
        }
      }
    },
    campaignTimeout,
  )

  it('turns every 1 KiB and final-byte truncation into an ImageError', async () => {
    for (const fixture of fixtures) {
      for (
        let length = truncationStep;
        length < fixture.input.byteLength;
        length += truncationStep
      ) {
        await exercise(
          fixture.input.subarray(0, length),
          `${fixture.id}-truncated-at-${length}`,
          true,
        )
      }
      const finalByte = fixture.input.byteLength - 1
      if (finalByte % truncationStep !== 0) {
        await exercise(
          fixture.input.subarray(0, finalByte),
          `${fixture.id}-truncated-at-${finalByte}`,
          true,
        )
      }
    }
  }, 30_000)

  it(
    'never leaks raw exceptions after deterministic bit flips',
    async () => {
      for (const fixture of campaignFixtures) {
        for (const corruption of bitFlips(fixture)) {
          const label = `${fixture.id}-seed-${campaignSeed}-case-${corruption.index}-offset-${corruption.byteOffset}-bit-${corruption.bit}`
          await exercise(corruption.input, label, false)
        }
      }
    },
    campaignTimeout,
  )

  it('keeps every checked-in fuzz crash normalized as an ImageError', async () => {
    for (const fixture of regressionFixtures) {
      await exercise(fixture.input, fixture.id, true)
    }
  })
})
