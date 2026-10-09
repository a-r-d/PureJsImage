import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { jpegCodec } from '../../../src/codecs/jpeg.ts'
import { pngCodec } from '../../../src/codecs/png.ts'
import { createNodeImageLibrary } from '../../../src/node-image.ts'
import {
  type CorpusOptions,
  type LabFixture,
  selectDevelopmentCorpus,
  selectHoldoutForPromotion,
  selectSecondaryDevelopmentCorpus,
} from './corpus.ts'

const Image = createNodeImageLibrary([jpegCodec, pngCodec])
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export interface PreparedLabFixture {
  readonly fixture: LabFixture
  readonly sourceBytes: number
  readonly pngPath: string
  readonly pngSha256: string
  readonly pngBytes: number
}

/** Called by preparation only, outside every timed encoder run. */
export async function prepareCorpusFixture(
  fixture: LabFixture,
  outputDirectory: string,
): Promise<PreparedLabFixture> {
  const input = await readFile(fixture.sourcePath)
  if (
    hash(input) !== fixture.sourceSha256 ||
    (fixture.sourceBytes !== null && input.length !== fixture.sourceBytes)
  )
    throw new Error(`Source identity changed: ${fixture.id}`)
  const image = await Image.open(input)
  const metadata = await image.metadata()
  if (metadata.width !== fixture.width || metadata.height !== fixture.height)
    throw new Error(`Source dimensions changed: ${fixture.id}`)
  const png = await image.crop(fixture.crop).png().toBuffer()
  const cropped = await (await Image.open(png)).metadata()
  if (cropped.width !== fixture.crop.width || cropped.height !== fixture.crop.height)
    throw new Error(`Crop dimensions changed: ${fixture.id}`)
  if (!/^[a-z0-9-]+$/u.test(fixture.id)) throw new Error('Invalid fixture ID')
  await mkdir(outputDirectory, { recursive: true })
  const pngPath = join(outputDirectory, `${fixture.id}.png`)
  await writeFile(pngPath, png)
  return { fixture, sourceBytes: input.length, pngPath, pngSha256: hash(png), pngBytes: png.length }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name)
    if (index < 0) return undefined
    const next = args[index + 1]
    if (next === undefined || next.startsWith('--')) throw new Error(`Missing value: ${name}`)
    return next
  }
  const numeric = (name: string): number | undefined => {
    const text = value(name)
    return text === undefined ? undefined : Number(text)
  }
  const set = value('--set') ?? (args.includes('--watch') ? 'watch' : 'full')
  if (
    set !== 'screen' &&
    set !== 'full' &&
    set !== 'watch' &&
    set !== 'holdout' &&
    set !== 'secondary'
  )
    throw new Error('Set must be screen, full, watch, holdout or secondary')
  if (set === 'holdout' && !args.includes('--promotion-holdout'))
    throw new Error('Holdout preparation requires --promotion-holdout')
  const sourceDirectory = value('--sources')
  const normalEdge = numeric('--normal-edge')
  const largeEdge = numeric('--large-edge')
  const normalCount = numeric('--normal-count')
  const screenCount = numeric('--screen-count')
  const largeCount = numeric('--large-count')
  const options: CorpusOptions = {
    ...(sourceDirectory === undefined ? {} : { sourceDirectory }),
    ...(normalEdge === undefined ? {} : { normalEdge }),
    ...(largeEdge === undefined ? {} : { largeEdge }),
    ...(normalCount === undefined ? {} : { normalCount }),
    ...(screenCount === undefined ? {} : { screenCount }),
    ...(largeCount === undefined ? {} : { largeCount }),
  }
  const corpus = selectDevelopmentCorpus(set === 'secondary' ? {} : options)
  const secondary = set === 'secondary' ? selectSecondaryDevelopmentCorpus(options) : undefined
  const version = secondary?.version ?? corpus.version
  const candidates =
    secondary !== undefined
      ? secondary.fixtures
      : set === 'screen'
        ? corpus.screen
        : set === 'full'
          ? corpus.normal
          : set === 'watch'
            ? corpus.watch
            : selectHoldoutForPromotion(options)
  const only = value('--only')
  const fixtures = only === undefined ? candidates : candidates.filter((entry) => entry.id === only)
  if (fixtures.length === 0) throw new Error(`No fixture selected: ${only ?? set}`)
  const output = value('--out') ?? value('--output') ?? `.tmp/jpegxl-lossy-lab/${version}/${set}`
  await mkdir(output, { recursive: true })
  const completed: PreparedLabFixture[] = []
  const failures: { id: string; error: string }[] = []
  for (const fixture of fixtures) {
    try {
      completed.push(await prepareCorpusFixture(fixture, output))
      console.log(`${fixture.id}: ${fixture.crop.width}x${fixture.crop.height}`)
    } catch (error) {
      failures.push({
        id: fixture.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    await writeFile(
      join(output, 'manifest.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          version,
          set,
          config: secondary?.config ?? corpus.config,
          drops: [
            ...(secondary?.reductions ?? corpus.reductions),
            ...candidates
              .filter((entry) => only !== undefined && entry.id !== only)
              .map((entry) => ({
                id: entry.id,
                kind: 'pilot-only',
                reason: `Omitted by --only ${only}`,
              })),
          ],
          screenIds: secondary === undefined ? corpus.screen.map((entry) => entry.id) : [],
          requestedIds: fixtures.map((entry) => entry.id),
          preprocessing:
            'First-party JPEG/PNG decode and deterministic native-pixel crop; no resizing or hand-selected coordinates. All engines receive this same PNG.',
          fixtures: completed.map((entry) => ({
            id: entry.fixture.id,
            split: entry.fixture.split,
            kind: set === 'watch' ? 'watch' : 'lab',
            png: entry.pngPath,
            width: entry.fixture.crop.width,
            height: entry.fixture.crop.height,
            sourceSha256: entry.fixture.sourceSha256,
            crop: entry.fixture.crop,
            fixtureSha256: entry.pngSha256,
            source: entry.fixture.sourcePath,
            sourceBytes: entry.sourceBytes,
            fixtureBytes: entry.pngBytes,
            category: entry.fixture.category,
            license: entry.fixture.license,
            largeGateRepresentative: entry.fixture.largeGateRepresentative,
          })),
          failures,
        },
        null,
        2,
      )}\n`,
    )
  }
  if (failures.length > 0) process.exitCode = 1
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main()
