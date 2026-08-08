import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type CompatibilityStatus =
  | 'Compatible'
  | 'Explicitly unsupported'
  | 'Invalid'
  | 'Incorrect pixels'
  | 'Unexpected exception'
  | 'Timeout'
  | 'Excessive memory'

export interface HevcExpectation {
  readonly bitDepth: number
  readonly chroma: string
  readonly profile: string
  readonly sliceCount: number
  readonly tiles: boolean
  readonly wpp: boolean
}

export interface ColorExpectation {
  readonly metadata: string
  readonly range: 'full' | 'limited'
  readonly space: string
}

interface FixtureBase {
  readonly auxiliaryItems: readonly string[]
  readonly brands: readonly string[]
  readonly color: ColorExpectation
  readonly expectedStatus: CompatibilityStatus
  readonly file: string
  readonly height: number
  readonly hevc: HevcExpectation
  readonly id: string
  readonly layout: string
  readonly license: string
  readonly orientation: number
  readonly primaryItemType: string
  readonly provenance: string
  readonly sha256: string
  readonly source: string
  readonly sourcePage: string
  readonly transforms: readonly string[]
  readonly width: number
}

export interface SourceFixture extends FixtureBase {
  readonly url: string
}

export interface GeneratedFixture extends FixtureBase {
  readonly generator: 'main10-pq' | 'replace-irot-with-imir'
  readonly sourceFixtureId?: string
}

export type CompatibilityFixture = SourceFixture | GeneratedFixture

export interface CompatibilityManifest {
  readonly fixtures: readonly CompatibilityFixture[]
  readonly oracle: {
    readonly minimumImageMagick: string
    readonly name: string
    readonly notes: string
  }
  readonly version: number
}

const compatibilityDirectory = dirname(fileURLToPath(import.meta.url))
export const compatibilityCorpusDirectory = join(
  dirname(dirname(compatibilityDirectory)),
  'corpus',
  'files',
  'heif-compatibility',
)
export const compatibilityManifestPath = join(compatibilityDirectory, 'manifest.json')

const statuses: ReadonlySet<unknown> = new Set<CompatibilityStatus>([
  'Compatible',
  'Explicitly unsupported',
  'Invalid',
  'Incorrect pixels',
  'Unexpected exception',
  'Timeout',
  'Excessive memory',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

const isHevc = (value: unknown): value is HevcExpectation =>
  isRecord(value) &&
  typeof value.profile === 'string' &&
  typeof value.bitDepth === 'number' &&
  typeof value.chroma === 'string' &&
  typeof value.sliceCount === 'number' &&
  typeof value.wpp === 'boolean' &&
  typeof value.tiles === 'boolean'

const isColor = (value: unknown): value is ColorExpectation =>
  isRecord(value) &&
  (value.range === 'full' || value.range === 'limited') &&
  typeof value.space === 'string' &&
  typeof value.metadata === 'string'

const isFixtureBase = (value: unknown): value is FixtureBase & Record<string, unknown> =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.file === 'string' &&
  typeof value.source === 'string' &&
  typeof value.sourcePage === 'string' &&
  typeof value.license === 'string' &&
  typeof value.sha256 === 'string' &&
  /^[a-f0-9]{64}$/.test(value.sha256) &&
  typeof value.provenance === 'string' &&
  isStringArray(value.brands) &&
  typeof value.primaryItemType === 'string' &&
  typeof value.layout === 'string' &&
  typeof value.width === 'number' &&
  typeof value.height === 'number' &&
  typeof value.orientation === 'number' &&
  isStringArray(value.transforms) &&
  isHevc(value.hevc) &&
  isColor(value.color) &&
  isStringArray(value.auxiliaryItems) &&
  statuses.has(value.expectedStatus)

const isFixture = (value: unknown): value is CompatibilityFixture => {
  if (!isFixtureBase(value)) return false
  if (typeof value.url === 'string') return value.generator === undefined
  return (
    (value.generator === 'main10-pq' || value.generator === 'replace-irot-with-imir') &&
    (value.sourceFixtureId === undefined || typeof value.sourceFixtureId === 'string')
  )
}

const isManifest = (value: unknown): value is CompatibilityManifest =>
  isRecord(value) &&
  typeof value.version === 'number' &&
  isRecord(value.oracle) &&
  typeof value.oracle.name === 'string' &&
  typeof value.oracle.minimumImageMagick === 'string' &&
  typeof value.oracle.notes === 'string' &&
  Array.isArray(value.fixtures) &&
  value.fixtures.every(isFixture)

export const readCompatibilityManifest = async (): Promise<CompatibilityManifest> => {
  const parsed: unknown = JSON.parse(await readFile(compatibilityManifestPath, 'utf8'))
  if (!isManifest(parsed)) throw new Error('Invalid HEIF compatibility manifest')
  return parsed
}

export const compatibilityFixturePath = (fixture: CompatibilityFixture): string => {
  if (
    fixture.file.length === 0 ||
    fixture.file === '.' ||
    fixture.file === '..' ||
    fixture.file.includes('/') ||
    fixture.file.includes('\\') ||
    fixture.file.includes('\0')
  ) {
    throw new Error(`HEIF fixture must use a portable base name: ${fixture.file}`)
  }
  return join(compatibilityCorpusDirectory, fixture.file)
}

export const fixtureSha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

export const isSourceFixture = (fixture: CompatibilityFixture): fixture is SourceFixture =>
  'url' in fixture
