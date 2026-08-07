import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExifParser from 'exif-parser'
import { imageDimensionsFromData } from 'image-dimensions'
import { GifReader } from 'omggif'
import type {
  CorpusManifest,
  Fixture,
  FixtureExpectation,
  FixtureInspection,
  GeneratedFixture,
  SourceFixture,
} from '../types.ts'
import { identifyClassicTiff } from './tiff.ts'

const benchmarkDirectory = dirname(dirname(fileURLToPath(import.meta.url)))

export const corpusDirectory = join(benchmarkDirectory, 'corpus')
export const corpusFilesDirectory = join(corpusDirectory, 'files')
export const manifestPath = join(corpusDirectory, 'manifest.json')

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const isExpectation = (value: unknown): value is FixtureExpectation => {
  return (
    isRecord(value) &&
    typeof value.format === 'string' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.sha256 === 'string'
  )
}

const isFixtureBase = (
  value: unknown,
): value is Record<string, unknown> & {
  id: string
  file: string
  expected: FixtureExpectation
} => {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.file === 'string' &&
    isExpectation(value.expected)
  )
}

const isSourceFixture = (value: unknown): value is SourceFixture => {
  return (
    isFixtureBase(value) &&
    typeof value.url === 'string' &&
    typeof value.sourcePage === 'string' &&
    typeof value.author === 'string' &&
    typeof value.license === 'string'
  )
}

const fixtureGenerators: ReadonlySet<unknown> = new Set([
  'bmp-gradient',
  'odd-rgba',
  'rgba-gradient',
  'seeded-noise',
  'static-transparent-gif',
  'streaming-stress-gradient',
  'tiff-gradient',
  'tiny-transparent',
  'transparent-logo',
])

const isGeneratedFixture = (value: unknown): value is GeneratedFixture => {
  return isFixtureBase(value) && fixtureGenerators.has(value.generator)
}

const isManifest = (value: unknown): value is CorpusManifest => {
  return (
    isRecord(value) &&
    typeof value.version === 'number' &&
    Array.isArray(value.sources) &&
    value.sources.every(isSourceFixture) &&
    Array.isArray(value.generated) &&
    value.generated.every(isGeneratedFixture)
  )
}

export const readManifest = async (): Promise<CorpusManifest> => {
  const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!isManifest(manifest)) throw new Error(`Invalid corpus manifest: ${manifestPath}`)
  return manifest
}

export const allFixtures = (manifest: CorpusManifest): Fixture[] => [
  ...manifest.sources.map((fixture): Fixture => ({ ...fixture, origin: 'download' })),
  ...manifest.generated.map((fixture): Fixture => ({ ...fixture, origin: 'generated' })),
]

export const fixturePath = (fixture: Fixture): string => join(corpusFilesDirectory, fixture.file)

export const sha256 = (buffer: Uint8Array): string => {
  return createHash('sha256').update(buffer).digest('hex')
}

export const inspectFixture = async (fixture: Fixture): Promise<FixtureInspection> => {
  const buffer = await readFile(fixturePath(fixture))
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const detected = imageDimensionsFromData(bytes)
  let bmpDimensions: { type: string; width: number; height: number } | undefined
  if (!detected && bytes[0] === 0x42 && bytes[1] === 0x4d && bytes.byteLength >= 26) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const headerSize = view.getUint32(14, true)
    const width = headerSize === 12 ? view.getUint16(18, true) : view.getInt32(18, true)
    const storedHeight = headerSize === 12 ? view.getUint16(20, true) : view.getInt32(22, true)
    if (width > 0 && storedHeight !== 0) {
      bmpDimensions = { type: 'bmp', width, height: Math.abs(storedHeight) }
    }
  }
  const dimensions = detected ?? bmpDimensions ?? identifyClassicTiff(bytes)

  if (!dimensions) {
    throw new Error(`Could not identify ${fixture.file}`)
  }

  const inspection: FixtureInspection = {
    bytes: buffer.byteLength,
    format: dimensions.type,
    width: dimensions.width,
    height: dimensions.height,
    sha256: sha256(buffer),
  }

  if (dimensions.type === 'gif') {
    inspection.frames = new GifReader(buffer).numFrames()
  }

  if (fixture.expected.orientation) {
    const orientation = ExifParser.create(buffer).parse().tags.Orientation
    if (orientation !== undefined) inspection.orientation = orientation
  }

  return inspection
}

export const verifyInspection = (fixture: Fixture, inspection: FixtureInspection): string[] => {
  const errors: string[] = []

  for (const field of ['format', 'width', 'height', 'frames', 'orientation'] as const) {
    const expected = fixture.expected[field]
    if (expected !== undefined && inspection[field] !== expected) {
      errors.push(`${field}: expected ${expected}, got ${inspection[field]}`)
    }
  }

  if (
    fixture.expected.sha256 &&
    fixture.expected.sha256 !== 'PENDING' &&
    inspection.sha256 !== fixture.expected.sha256
  ) {
    errors.push(`sha256: expected ${fixture.expected.sha256}, got ${inspection.sha256}`)
  }

  return errors
}
