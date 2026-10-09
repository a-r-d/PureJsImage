import { createHash } from 'node:crypto'
import { join } from 'node:path'
import priorOriginals from '../production-program/m6-native-sources.json' with { type: 'json' }
import selection from '../production-program/m7-corpus-selection.json' with { type: 'json' }

export const photoCategories = [
  '1000-lilith-photos-general',
  '1200-lilith-interiors',
  '1400-lilith-nature',
  '1600-lilith-food',
  '2000-unsplash-people',
  '2400-unsplash-textures',
  '3000-art-institute-of-chicago-photos',
  '3300-met-museum-photos',
] as const

export interface PhotoSource {
  readonly id: string
  readonly split: 'development' | 'holdout' | 'watch-reference'
  readonly category: string
  readonly sourcePath: string
  readonly sourceSha256: string
  readonly sourceBytes: number | null
  readonly width: number
  readonly height: number
  readonly license: string
}
export interface CropRectangle {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}
export interface LabFixture extends PhotoSource {
  readonly crop: CropRectangle
  readonly largeGateRepresentative: boolean
}
export interface CorpusOptions {
  readonly normalCount?: number
  readonly screenCount?: number
  readonly normalEdge?: number
  readonly largeCount?: number
  readonly largeEdge?: number
  readonly sourceDirectory?: string
}
export interface CorpusReduction {
  readonly id: string
  readonly kind:
    | 'full-lab-count'
    | 'screen-count'
    | 'normal-crop-size'
    | 'large-crop-size'
    | 'large-crop-count'
  readonly reason: string
}
interface CorpusConfig {
  readonly normalCount: number
  readonly screenCount: number
  readonly normalEdge: number
  readonly largeCount: number
  readonly largeEdge: number
}
export interface DevelopmentCorpus {
  readonly version: string
  readonly config: CorpusConfig
  readonly normal: readonly LabFixture[]
  readonly screen: readonly LabFixture[]
  readonly watch: readonly LabFixture[]
  readonly reductions: readonly CorpusReduction[]
  readonly secondaryIds: readonly string[]
}
export interface SecondaryDevelopmentCorpus {
  readonly version: string
  readonly config: { readonly normalCount: number; readonly normalEdge: number }
  readonly fixtures: readonly LabFixture[]
  readonly reductions: readonly CorpusReduction[]
}

const recipe = 'jpegxl-lossy-lab-crops-v1'
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const photoCategorySet = new Set<string>(photoCategories)
const ranked = (sources: readonly PhotoSource[], purpose: string): PhotoSource[] =>
  [...sources].sort((a, b) => {
    const first = hash(`${recipe}/${purpose}/${a.id}/${a.sourceSha256}`)
    const second = hash(`${recipe}/${purpose}/${b.id}/${b.sourceSha256}`)
    return first < second ? -1 : first > second ? 1 : a.id.localeCompare(b.id)
  })
const boundedInteger = (value: number, minimum: number, maximum: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  return value
}

export function deterministicCrop(source: PhotoSource, edge: number): CropRectangle {
  boundedInteger(edge, 1, 8192, 'crop edge')
  const width = Math.min(edge, source.width)
  const height = Math.min(edge, source.height)
  const seed = `${recipe}/crop/${source.id}/${source.sourceSha256}/${width}/${height}`
  return {
    x: Number.parseInt(hash(`${seed}/x`).slice(0, 8), 16) % (source.width - width + 1),
    y: Number.parseInt(hash(`${seed}/y`).slice(0, 8), 16) % (source.height - height + 1),
    width,
    height,
  }
}

function sources(
  split: 'development' | 'holdout',
  directory: string,
  secondary = false,
): PhotoSource[] {
  const selected = selection.cases.filter(
    (entry) => entry.split === split && photoCategorySet.has(entry.category) !== secondary,
  )
  const expected = secondary ? 56 : split === 'development' ? 64 : 63
  if (selected.length !== expected) throw new Error(`Corpus split changed: ${split}`)
  const families = new Set<string>()
  return selected.map((entry) => {
    if (
      families.has(entry.sourceFamily) ||
      !/^im26-\d+$/u.test(entry.id) ||
      !/^[a-f0-9]{64}$/u.test(entry.sourceSha256) ||
      (entry.format !== 'jpg' && entry.format !== 'png') ||
      !Number.isSafeInteger(entry.width) ||
      entry.width < 1 ||
      !Number.isSafeInteger(entry.height) ||
      entry.height < 1
    )
      throw new Error(`Invalid source definition: ${entry.id}`)
    families.add(entry.sourceFamily)
    return {
      id: entry.id,
      split,
      category: entry.category,
      sourcePath: join(directory, `${entry.id}.${entry.format}`),
      sourceSha256: entry.sourceSha256,
      sourceBytes: entry.bytes,
      width: entry.width,
      height: entry.height,
      license: entry.license,
    }
  })
}

/** Secondary development results stay separate from the photographic lab. */
export function selectSecondaryDevelopmentCorpus(
  options: Pick<CorpusOptions, 'normalCount' | 'normalEdge' | 'sourceDirectory'> = {},
): SecondaryDevelopmentCorpus {
  const ordered = ranked(
    sources('development', options.sourceDirectory ?? '.tmp/jpegxl-m7/sources', true),
    'secondary-development',
  )
  const config = {
    normalCount: boundedInteger(options.normalCount ?? 56, 1, 56, 'secondary count'),
    normalEdge: boundedInteger(options.normalEdge ?? 512, 1, 8192, 'normal edge'),
  }
  const fixtures = ordered
    .slice(0, config.normalCount)
    .map((entry) => fixture(entry, config.normalEdge))
  const reductions: CorpusReduction[] = ordered.slice(config.normalCount).map((entry) => ({
    id: entry.id,
    kind: 'full-lab-count',
    reason: `Reduced secondary development set from 56 to ${config.normalCount} images`,
  }))
  if (config.normalEdge < 512)
    for (const entry of fixtures)
      reductions.push({
        id: entry.id,
        kind: 'normal-crop-size',
        reason: `Secondary crop edge reduced from 512 to ${config.normalEdge}`,
      })
  return {
    version: hash(
      JSON.stringify({
        recipe,
        sourceRevision: selection.revision,
        set: 'secondary-development',
        config,
        fixtures: fixtures.map(({ sourcePath: _path, ...entry }) => entry),
      }),
    ),
    config,
    fixtures,
    reductions,
  }
}
const fixture = (source: PhotoSource, edge: number): LabFixture => {
  const crop = deterministicCrop(source, edge)
  return { ...source, crop, largeGateRepresentative: crop.width * crop.height > 4_194_304 }
}
const original = (source: PhotoSource): LabFixture => ({
  ...source,
  crop: { x: 0, y: 0, width: source.width, height: source.height },
  largeGateRepresentative: source.width * source.height > 4_194_304,
})

function configuration(options: CorpusOptions): CorpusConfig {
  const normalCount = boundedInteger(options.normalCount ?? 64, 1, 64, 'normal count')
  const screenCount = boundedInteger(
    options.screenCount ?? Math.min(16, normalCount),
    1,
    Math.min(16, normalCount),
    'screen count',
  )
  return {
    normalCount,
    screenCount,
    normalEdge: boundedInteger(options.normalEdge ?? 512, 1, 8192, 'normal edge'),
    largeCount: boundedInteger(
      options.largeCount ?? Math.min(2, screenCount),
      0,
      Math.min(2, screenCount),
      'large count',
    ),
    // The current original-photo gate is strictly above 2048², not above 4,000,000.
    largeEdge: boundedInteger(options.largeEdge ?? 2080, 1, 8192, 'large edge'),
  }
}

export function selectDevelopmentCorpus(options: CorpusOptions = {}): DevelopmentCorpus {
  const directory = options.sourceDirectory ?? '.tmp/jpegxl-m7/sources'
  const development = sources('development', directory)
  const ordered = ranked(development, 'development')
  const config = configuration(options)
  const quick = ordered.slice(0, 16)
  const eligibleLarge = ranked(
    quick.filter((entry) => entry.width >= 2080 && entry.height >= 2080),
    'large-representatives',
  )
  const defaultLarge = eligibleLarge.slice(0, 2)
  const activeIds = new Set(ordered.slice(0, config.screenCount).map((entry) => entry.id))
  const largeIds = new Set(
    defaultLarge
      .slice(0, config.largeCount)
      .filter((entry) => activeIds.has(entry.id))
      .map((entry) => entry.id),
  )
  const normal = ordered
    .slice(0, config.normalCount)
    .map((entry) => fixture(entry, largeIds.has(entry.id) ? config.largeEdge : config.normalEdge))
  const byId = new Map(normal.map((entry) => [entry.id, entry]))
  const screen = ordered.slice(0, config.screenCount).map((entry) => {
    const selected = byId.get(entry.id)
    if (!selected) throw new Error('Quick screen must be contained in full lab')
    return selected
  })
  const watch = ranked(development, 'full-resolution-watch').slice(0, 6).map(original)
  const independent = development.find((entry) => entry.id === 'im26-1416')
  if (!independent) throw new Error('Previous 12 MP development photo missing')
  watch.push(original({ ...independent, id: 'prior-12mp-im26-1416', split: 'watch-reference' }))
  for (const id of ['portrait-2400x3000', 'tundra-4000x3000', 'earthrise-2400x2400']) {
    const entry = priorOriginals.entries.find((source) => source.id === id)
    if (!entry) throw new Error(`Previous watch original missing: ${id}`)
    watch.push(
      original({
        id,
        split: 'watch-reference',
        category: 'prior-photographic-reference',
        sourcePath: entry.sourcePath,
        sourceSha256: entry.sha256,
        sourceBytes: null,
        width: entry.width,
        height: entry.height,
        license: entry.license,
      }),
    )
  }
  const reductions: CorpusReduction[] = []
  for (const entry of ordered.slice(config.normalCount))
    reductions.push({
      id: entry.id,
      kind: 'full-lab-count',
      reason: `Reduced full lab from 64 to ${config.normalCount} images`,
    })
  for (const entry of quick.slice(config.screenCount))
    reductions.push({
      id: entry.id,
      kind: 'screen-count',
      reason: `Reduced quick screen from 16 to ${config.screenCount} images`,
    })
  for (const entry of normal) {
    const defaultEdge = defaultLarge.some((large) => large.id === entry.id) ? 2080 : 512
    const requested = largeIds.has(entry.id) ? config.largeEdge : config.normalEdge
    if (requested < defaultEdge)
      reductions.push({
        id: entry.id,
        kind: defaultEdge === 2080 ? 'large-crop-size' : 'normal-crop-size',
        reason: `Crop edge reduced from ${defaultEdge} to ${requested}`,
      })
  }
  for (const entry of defaultLarge)
    if (!largeIds.has(entry.id))
      reductions.push({
        id: entry.id,
        kind: 'large-crop-count',
        reason: 'Large gate representative omitted by count reduction',
      })
  const version = hash(
    JSON.stringify({
      recipe,
      sourceRevision: selection.revision,
      config,
      normal: normal.map(({ sourcePath: _path, ...entry }) => entry),
    }),
  )
  return {
    version,
    config,
    normal,
    screen,
    watch,
    reductions,
    secondaryIds: selection.cases
      .filter((entry) => entry.split === 'development' && !photoCategorySet.has(entry.category))
      .map((entry) => entry.id),
  }
}

/** Promotion is a separate explicit call; exploratory selections never contain holdout cases. */
export function selectHoldoutForPromotion(
  options: Pick<CorpusOptions, 'normalEdge' | 'largeEdge' | 'largeCount' | 'sourceDirectory'> = {},
): readonly LabFixture[] {
  const ordered = ranked(
    sources('holdout', options.sourceDirectory ?? '.tmp/jpegxl-m7/sources'),
    'holdout',
  )
  const edge = boundedInteger(options.normalEdge ?? 512, 1, 8192, 'normal edge')
  const count = boundedInteger(options.largeCount ?? 2, 0, 63, 'large count')
  const largeEdge = boundedInteger(options.largeEdge ?? 2080, 1, 8192, 'large edge')
  const large = new Set(
    ranked(
      ordered.filter((entry) => entry.width >= 2080 && entry.height >= 2080),
      'large-representatives',
    )
      .slice(0, count)
      .map((entry) => entry.id),
  )
  return ordered.map((entry) => fixture(entry, large.has(entry.id) ? largeEdge : edge))
}
