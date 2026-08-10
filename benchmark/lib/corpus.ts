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
import { identifyTiff } from './tiff.ts'

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
  'ico-dib24',
  'ico-dib32',
  'ico-mixed',
  'odd-rgba',
  'rgba-gradient',
  'seeded-noise',
  'static-transparent-gif',
  'streaming-stress-gradient',
  'tiff-gradient',
  'tiff-bigtiff-rgb16',
  'tiff-cmyk8-planar',
  'tiff-packed12-strip',
  'tiff-packed12-tile',
  'tiny-transparent',
  'transparent-logo',
  'webp-gradient-lossless',
  'webp-gradient-lossy',
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

export const fixturePath = (fixture: Fixture): string => {
  if (
    fixture.file.length === 0 ||
    fixture.file === '.' ||
    fixture.file === '..' ||
    fixture.file.includes('/') ||
    fixture.file.includes('\\') ||
    fixture.file.includes('\0')
  ) {
    throw new Error(`Fixture file must be a portable base name: ${fixture.file}`)
  }
  return join(corpusFilesDirectory, fixture.file)
}

export const sha256 = (buffer: Uint8Array): string => {
  return createHash('sha256').update(buffer).digest('hex')
}

const identifyIco = (
  bytes: Uint8Array,
): { type: 'ico'; width: number; height: number; frames: number } | undefined => {
  if (
    bytes.byteLength < 6 ||
    bytes[0] !== 0 ||
    bytes[1] !== 0 ||
    bytes[2] !== 1 ||
    bytes[3] !== 0
  ) {
    return undefined
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const frames = view.getUint16(4, true)
  if (frames < 1 || 6 + frames * 16 > bytes.byteLength) return undefined
  let width = 0
  let height = 0
  let area = 0
  let bitDepth = 0
  for (let index = 0; index < frames; index += 1) {
    const entry = 6 + index * 16
    const entryWidth = bytes[entry] === 0 ? 256 : (bytes[entry] ?? 0)
    const entryHeight = bytes[entry + 1] === 0 ? 256 : (bytes[entry + 1] ?? 0)
    const entryBitDepth = view.getUint16(entry + 6, true)
    const length = view.getUint32(entry + 8, true)
    const offset = view.getUint32(entry + 12, true)
    if (length < 1 || offset < 6 + frames * 16 || offset + length > bytes.byteLength) {
      return undefined
    }
    const entryArea = entryWidth * entryHeight
    if (entryArea > area || (entryArea === area && entryBitDepth > bitDepth)) {
      width = entryWidth
      height = entryHeight
      area = entryArea
      bitDepth = entryBitDepth
    }
  }
  return { type: 'ico', width, height, frames }
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
  const dimensions = detected ?? bmpDimensions ?? identifyTiff(bytes) ?? identifyIco(bytes)

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
  if (
    dimensions.type === 'ico' &&
    'frames' in dimensions &&
    typeof dimensions.frames === 'number'
  ) {
    inspection.frames = dimensions.frames
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
