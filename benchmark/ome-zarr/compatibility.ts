import { ImageError, invalidInput } from '../../src/errors.ts'
import type { ScientificDataset, ScientificPlaneReadRequest } from '../../src/scientific/dataset.ts'
import {
  createOmeZarrHttpContext,
  normalizeOmeZarrStoreUrl,
  type OmeZarrHttpStoreIdentitySummary,
  type OmeZarrHttpStoreOptions,
} from '../../src/scientific/ome-zarr-http.ts'
import {
  createOmeZarrReader,
  type OmeZarrMetadataValidation,
  type OmeZarrWarning,
} from '../../src/scientific/readers/ome-zarr.ts'

export type OmeZarrCompatibilityClassification =
  | 'PASS'
  | 'UNSUPPORTED_CODEC'
  | 'UNSUPPORTED_DTYPE'
  | 'UNSUPPORTED_METADATA'
  | 'INVALID'
  | 'NETWORK_FAILURE'

export const OME_ZARR_COMPATIBILITY_CLASSIFICATIONS = Object.freeze([
  'PASS',
  'UNSUPPORTED_CODEC',
  'UNSUPPORTED_DTYPE',
  'UNSUPPORTED_METADATA',
  'INVALID',
  'NETWORK_FAILURE',
] satisfies readonly OmeZarrCompatibilityClassification[])

const compatibilityClassifications = new Set<string>(OME_ZARR_COMPATIBILITY_CLASSIFICATIONS)

export const isOmeZarrCompatibilityClassification = (
  value: unknown,
): value is OmeZarrCompatibilityClassification =>
  typeof value === 'string' && compatibilityClassifications.has(value)

export type OmeZarrCompatibilitySurface =
  | 'ome-ngff-0.4-zarr-v2'
  | 'ome-ngff-0.5-zarr-v3'
  | 'regular-chunks'
  | 'sharding-indexed'
  | 'multidimensional-z'
  | 'multidimensional-t'
  | 'multiple-channels-omero'
  | 'image-labels'
  | 'hcs-plate-well-field'
  | 'bioformats2raw-series'

export const OME_ZARR_COMPATIBILITY_SURFACES = Object.freeze([
  'ome-ngff-0.4-zarr-v2',
  'ome-ngff-0.5-zarr-v3',
  'regular-chunks',
  'sharding-indexed',
  'multidimensional-z',
  'multidimensional-t',
  'multiple-channels-omero',
  'image-labels',
  'hcs-plate-well-field',
  'bioformats2raw-series',
] satisfies readonly OmeZarrCompatibilitySurface[])

const compatibilitySurfaces = new Set<string>(OME_ZARR_COMPATIBILITY_SURFACES)

export interface OmeZarrCompatibilityProvenance {
  readonly dataset: string
  readonly sourceUrl: string
  readonly license: string
  readonly licenseUrl: string
}

export interface OmeZarrCompatibilitySample {
  readonly id: string
  readonly collection: string
  readonly url: string
  readonly expectedClassification?: OmeZarrCompatibilityClassification
  readonly metadataValidation?: OmeZarrMetadataValidation
  readonly expectedSurfaces?: readonly OmeZarrCompatibilitySurface[]
  readonly provenance?: OmeZarrCompatibilityProvenance
}

export interface OmeZarrCompatibilityCorpus {
  readonly schemaVersion: 1
  readonly samples: readonly OmeZarrCompatibilitySample[]
}

export interface OmeZarrCompatibilityDatasetResult {
  readonly id: string
  readonly sampleType: string
  readonly levels: number
  readonly selections: number
  readonly bytesRead: number
  readonly objectRequests: number
  readonly rangeRequests: number
  readonly bytesFetched: number
  readonly axes: readonly { readonly id: string; readonly length: number }[]
  readonly kind?: string
  readonly hasOmeroDisplay: boolean
  readonly levelStorage: readonly {
    readonly level: number
    readonly codecs: readonly string[]
    readonly logicalChunkShape: readonly number[]
    readonly storageChunkShape: readonly number[]
  }[]
}

export interface OmeZarrCompatibilityResult {
  readonly id: string
  readonly collection: string
  readonly url: string
  readonly classification: OmeZarrCompatibilityClassification
  readonly expectedClassification?: OmeZarrCompatibilityClassification
  readonly probeConfidence?: number
  readonly observedSurfaces?: readonly OmeZarrCompatibilitySurface[]
  readonly storeIdentity?: OmeZarrHttpStoreIdentitySummary
  readonly warnings?: readonly OmeZarrWarning[]
  readonly datasets?: readonly OmeZarrCompatibilityDatasetResult[]
  readonly message?: string
}

export interface OmeZarrCompatibilityOptions {
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal
  readonly regionWidth?: number
  readonly regionHeight?: number
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredManifestString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidInput(`${label} must be a non-empty string`)
  }
  return value
}

export const parseOmeZarrCompatibilityCorpus = (value: unknown): OmeZarrCompatibilityCorpus => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.samples)) {
    throw invalidInput('OME-Zarr compatibility manifest is invalid')
  }
  const ids = new Set<string>()
  const samples = value.samples.map((entry, index): OmeZarrCompatibilitySample => {
    if (!isRecord(entry)) {
      throw invalidInput(`OME-Zarr compatibility sample ${index} must be an object`)
    }
    const id = requiredManifestString(entry.id, `OME-Zarr compatibility sample ${index} id`)
    if (ids.has(id)) throw invalidInput(`OME-Zarr compatibility sample id ${id} is repeated`)
    ids.add(id)
    const collection = requiredManifestString(
      entry.collection,
      `OME-Zarr compatibility sample ${id} collection`,
    )
    const url = requiredManifestString(entry.url, `OME-Zarr compatibility sample ${id} URL`)
    normalizeOmeZarrStoreUrl(url)
    const expectedClassification = entry.expectedClassification
    if (
      expectedClassification !== undefined &&
      !isOmeZarrCompatibilityClassification(expectedClassification)
    ) {
      throw invalidInput(`OME-Zarr compatibility sample ${id} expectedClassification is invalid`)
    }
    const metadataValidation = entry.metadataValidation
    if (
      metadataValidation !== undefined &&
      metadataValidation !== 'strict' &&
      metadataValidation !== 'compatible'
    ) {
      throw invalidInput(`OME-Zarr compatibility sample ${id} metadataValidation is invalid`)
    }
    const expectedSurfaces = entry.expectedSurfaces
    if (
      expectedSurfaces !== undefined &&
      (!Array.isArray(expectedSurfaces) ||
        expectedSurfaces.some(
          (surface) => typeof surface !== 'string' || !compatibilitySurfaces.has(surface),
        ) ||
        new Set(expectedSurfaces).size !== expectedSurfaces.length)
    ) {
      throw invalidInput(`OME-Zarr compatibility sample ${id} expectedSurfaces is invalid`)
    }
    const provenance = entry.provenance
    let parsedProvenance: OmeZarrCompatibilityProvenance | undefined
    if (provenance !== undefined) {
      if (!isRecord(provenance)) {
        throw invalidInput(`OME-Zarr compatibility sample ${id} provenance is invalid`)
      }
      const sourceUrl = requiredManifestString(
        provenance.sourceUrl,
        `OME-Zarr compatibility sample ${id} provenance sourceUrl`,
      )
      normalizeOmeZarrStoreUrl(sourceUrl)
      const licenseUrl = requiredManifestString(
        provenance.licenseUrl,
        `OME-Zarr compatibility sample ${id} provenance licenseUrl`,
      )
      normalizeOmeZarrStoreUrl(licenseUrl)
      parsedProvenance = Object.freeze({
        dataset: requiredManifestString(
          provenance.dataset,
          `OME-Zarr compatibility sample ${id} provenance dataset`,
        ),
        sourceUrl,
        license: requiredManifestString(
          provenance.license,
          `OME-Zarr compatibility sample ${id} provenance license`,
        ),
        licenseUrl,
      })
    }
    return Object.freeze({
      id,
      collection,
      url,
      ...(expectedClassification === undefined ? {} : { expectedClassification }),
      ...(metadataValidation === undefined ? {} : { metadataValidation }),
      ...(expectedSurfaces === undefined
        ? {}
        : { expectedSurfaces: Object.freeze(expectedSurfaces.slice()) }),
      ...(parsedProvenance === undefined ? {} : { provenance: parsedProvenance }),
    })
  })
  return Object.freeze({ schemaVersion: 1, samples: Object.freeze(samples) })
}

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 16) {
    throw invalidInput(`${label} must be an integer from 1 through 16`)
  }
  return resolved
}

const errorChain = (cause: unknown): readonly unknown[] => {
  const values: unknown[] = []
  let current = cause
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    values.push(current)
    current = current instanceof Error ? current.cause : undefined
  }
  return values
}

export const classifyOmeZarrCompatibilityFailure = (
  cause: unknown,
): OmeZarrCompatibilityClassification => {
  const chain = errorChain(cause)
  const message = chain
    .map((entry) => (entry instanceof Error ? entry.message : String(entry)))
    .join(' ')
    .toLowerCase()
  if (
    /network|fetch failed|request failed|returned status|http .*status|timeout|timed? out|aborted|dns|cors/u.test(
      message,
    )
  ) {
    return 'NETWORK_FAILURE'
  }
  if (/codec|compressor|compression|filter/u.test(message)) return 'UNSUPPORTED_CODEC'
  if (/data type|dtype|sample type/u.test(message)) return 'UNSUPPORTED_DTYPE'
  if (
    chain.some((entry) => entry instanceof ImageError && entry.code === 'UNSUPPORTED_OPERATION') &&
    /ome|ngff|metadata|multiscale|transform|axes|plate|well|label/u.test(message)
  ) {
    return 'UNSUPPORTED_METADATA'
  }
  return 'INVALID'
}

const levelAxisLength = (dataset: ScientificDataset, level: number, axisId: string): number => {
  const value = dataset.descriptor.levels[level]?.axisLengths.find(
    (entry) => entry.axisId === axisId,
  )?.length
  if (value === undefined || value < 1)
    throw invalidInput(`Level ${level} is missing axis ${axisId}`)
  return value
}

const planeRequest = (
  dataset: ScientificDataset,
  level: number,
  widthLimit: number,
  heightLimit: number,
  position: 'top-left' | 'center' | 'bottom-right',
  boundary?: { readonly axis: 'x' | 'y'; readonly coordinate: number },
): ScientificPlaneReadRequest => {
  const spatial = dataset.descriptor.axes.filter((axis) => axis.kind === 'space')
  const horizontal = spatial.find((axis) => axis.id.toLowerCase() === 'x') ?? spatial.at(-1)
  const vertical = spatial.find((axis) => axis.id.toLowerCase() === 'y') ?? spatial.at(-2)
  if (horizontal === undefined || vertical === undefined || horizontal.id === vertical.id) {
    throw invalidInput('Compatibility sample has no distinct spatial x/y axes')
  }
  const displayAxes: readonly [horizontal: string, vertical: string] = Object.freeze([
    horizontal.id,
    vertical.id,
  ])
  const horizontalLength = levelAxisLength(dataset, level, horizontal.id)
  const verticalLength = levelAxisLength(dataset, level, vertical.id)
  const width = Math.min(widthLimit, horizontalLength)
  const height = Math.min(heightLimit, verticalLength)
  const positionStart = (length: number, extent: number): number => {
    if (position === 'top-left') return 0
    if (position === 'center') return Math.max(0, Math.floor((length - extent) / 2))
    return Math.max(0, length - extent)
  }
  let x = positionStart(horizontalLength, width)
  let y = positionStart(verticalLength, height)
  if (boundary?.axis === 'x')
    x = Math.max(0, Math.min(horizontalLength - width, boundary.coordinate))
  if (boundary?.axis === 'y')
    y = Math.max(0, Math.min(verticalLength - height, boundary.coordinate))
  const fixedIndex = (axisId: string): number => {
    const length = levelAxisLength(dataset, level, axisId)
    if (position === 'top-left') return 0
    if (position === 'center') return Math.min(1, length - 1)
    return length - 1
  }
  return Object.freeze({
    displayAxes,
    fixedIndices: Object.freeze(
      dataset.descriptor.axes
        .filter((axis) => axis.id !== horizontal.id && axis.id !== vertical.id)
        .map((axis) => Object.freeze({ axisId: axis.id, index: fixedIndex(axis.id) })),
    ),
    resolutionLevel: level,
    x,
    y,
    width,
    height,
  })
}

interface CompatibilityLevelStorage {
  readonly level: number
  readonly codecs: readonly string[]
  readonly logicalChunkShape: readonly number[]
  readonly storageChunkShape: readonly number[]
}

const numberTuple = (value: unknown): readonly number[] | undefined =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0)
    ? Object.freeze(value.map(Number))
    : undefined

const levelStorage = (dataset: ScientificDataset): readonly CompatibilityLevelStorage[] => {
  const value = dataset.descriptor.metadata?.omeZarrLevels
  if (!Array.isArray(value)) return Object.freeze([])
  return Object.freeze(
    value.flatMap((entry): readonly CompatibilityLevelStorage[] => {
      if (!isRecord(entry) || !Number.isSafeInteger(entry.level) || !Array.isArray(entry.codecs)) {
        return []
      }
      const codecs = entry.codecs.filter((codec): codec is string => typeof codec === 'string')
      const logicalChunkShape = numberTuple(entry.logicalChunkShape)
      const storageChunkShape = numberTuple(entry.storageChunkShape)
      if (logicalChunkShape === undefined || storageChunkShape === undefined) return []
      return [
        Object.freeze({
          level: Number(entry.level),
          codecs: Object.freeze(codecs),
          logicalChunkShape,
          storageChunkShape,
        }),
      ]
    }),
  )
}

const readAllLevels = async (
  dataset: ScientificDataset,
  width: number,
  height: number,
): Promise<{ readonly bytesRead: number; readonly selections: number }> => {
  let bytesRead = 0
  let selections = 0
  const storage = levelStorage(dataset)
  for (const level of dataset.descriptor.levels.keys()) {
    const requests: ScientificPlaneReadRequest[] = [
      planeRequest(dataset, level, width, height, 'top-left'),
      planeRequest(dataset, level, width, height, 'center'),
      planeRequest(dataset, level, width, height, 'bottom-right'),
    ]
    const levelInfo = storage.find((entry) => entry.level === level)
    const spatial = dataset.descriptor.axes.filter((axis) => axis.kind === 'space')
    const horizontal = spatial.find((axis) => axis.id.toLowerCase() === 'x') ?? spatial.at(-1)
    const vertical = spatial.find((axis) => axis.id.toLowerCase() === 'y') ?? spatial.at(-2)
    if (levelInfo !== undefined && horizontal !== undefined && vertical !== undefined) {
      const horizontalIndex = dataset.descriptor.axes.findIndex((axis) => axis.id === horizontal.id)
      const verticalIndex = dataset.descriptor.axes.findIndex((axis) => axis.id === vertical.id)
      for (const [axis, axisIndex] of [
        ['x', horizontalIndex],
        ['y', verticalIndex],
      ] as const) {
        const inner = levelInfo.logicalChunkShape[axisIndex]
        const outer = levelInfo.storageChunkShape[axisIndex]
        if (inner !== undefined && inner > 1) {
          requests.push(
            planeRequest(dataset, level, width, height, 'top-left', {
              axis,
              coordinate: inner - 1,
            }),
          )
        }
        if (outer !== undefined && outer > 1 && outer !== inner) {
          requests.push(
            planeRequest(dataset, level, width, height, 'top-left', {
              axis,
              coordinate: outer - 1,
            }),
          )
        }
      }
    }
    const seen = new Set<string>()
    for (const request of requests) {
      const key = JSON.stringify(request)
      if (seen.has(key)) continue
      seen.add(key)
      let blocks = 0
      for await (const block of dataset.readPlane(request)) {
        try {
          bytesRead += block.data.byteLength
          blocks += 1
        } finally {
          block.release?.()
        }
      }
      if (blocks === 0) throw invalidInput(`OME-Zarr level ${level} returned no raster blocks`)
      selections += 1
    }
  }
  return { bytesRead, selections }
}

const metadataWarnings = (value: unknown): readonly OmeZarrWarning[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const warnings = value.map((entry, index): OmeZarrWarning => {
    if (
      !isRecord(entry) ||
      entry.code !== 'OME_ZARR_PLATE_VERSION_MISSING' ||
      typeof entry.path !== 'string' ||
      typeof entry.message !== 'string'
    ) {
      throw invalidInput(`OME-Zarr warning ${index} is invalid`)
    }
    return Object.freeze({ code: entry.code, path: entry.path, message: entry.message })
  })
  return Object.freeze(warnings)
}

const orderedSurfaces = (
  values: ReadonlySet<OmeZarrCompatibilitySurface>,
): readonly OmeZarrCompatibilitySurface[] =>
  Object.freeze(OME_ZARR_COMPATIBILITY_SURFACES.filter((surface) => values.has(surface)))

export const runOmeZarrCompatibilitySample = async (
  sample: Readonly<OmeZarrCompatibilitySample>,
  options: Readonly<OmeZarrCompatibilityOptions> = {},
): Promise<OmeZarrCompatibilityResult> => {
  const width = positive(options.regionWidth, 2, 'Compatibility region width')
  const height = positive(options.regionHeight, 2, 'Compatibility region height')
  const storeOptions: OmeZarrHttpStoreOptions = {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    maxOpenSources: 16,
    maxCacheBytesPerSource: 1_048_576,
  }
  let context: Awaited<ReturnType<typeof createOmeZarrHttpContext>> | undefined
  let probeConfidence: number | undefined
  let storeIdentity: OmeZarrHttpStoreIdentitySummary | undefined
  try {
    context = await createOmeZarrHttpContext(sample.url, storeOptions)
    storeIdentity = context.store.identitySummary()
    const reader = createOmeZarrReader({
      limits: { maxDatasets: 256, maxLevels: 64, maxRegionBytes: 1_048_576 },
      metadataValidation: sample.metadataValidation ?? 'strict',
    })
    const probe = await reader.probe(context)
    probeConfidence = probe.confidence
    if (probe.confidence === 0) throw invalidInput(probe.reason ?? 'Not an OME-Zarr store')
    const document = await reader.open(context)
    try {
      storeIdentity = context.store.identitySummary(document)
      const datasets: OmeZarrCompatibilityDatasetResult[] = []
      const surfaces = new Set<OmeZarrCompatibilitySurface>()
      if (document.metadata.omeNgffVersion === '0.4' && document.metadata.zarrFormat === 2) {
        surfaces.add('ome-ngff-0.4-zarr-v2')
      }
      if (document.metadata.omeNgffVersion === '0.5' && document.metadata.zarrFormat === 3) {
        surfaces.add('ome-ngff-0.5-zarr-v3')
      }
      if (document.metadata.bioformats2rawLayout === 3) surfaces.add('bioformats2raw-series')
      if (isRecord(document.metadata.plate)) surfaces.add('hcs-plate-well-field')
      for (const summary of document.datasets) {
        const dataset = await document.openDataset(summary.id)
        const before = context.store.stats()
        const read = await readAllLevels(dataset, width, height)
        const after = context.store.stats()
        const storage = levelStorage(dataset)
        if (storage.some((entry) => entry.codecs.includes('sharding_indexed'))) {
          surfaces.add('sharding-indexed')
        }
        if (storage.some((entry) => !entry.codecs.includes('sharding_indexed'))) {
          surfaces.add('regular-chunks')
        }
        const zAxis = dataset.descriptor.axes.find((axis) => axis.id.toLowerCase() === 'z')
        const tAxis = dataset.descriptor.axes.find((axis) => axis.id.toLowerCase() === 't')
        const cAxis = dataset.descriptor.axes.find((axis) => axis.id.toLowerCase() === 'c')
        if (zAxis !== undefined && zAxis.length > 1) surfaces.add('multidimensional-z')
        if (tAxis !== undefined && tAxis.length > 1) surfaces.add('multidimensional-t')
        const descriptorMetadata = dataset.descriptor.metadata
        const hasOmeroDisplay = isRecord(descriptorMetadata?.omeZarrDisplay)
        if (cAxis !== undefined && cAxis.length > 1 && hasOmeroDisplay) {
          surfaces.add('multiple-channels-omero')
        }
        if (descriptorMetadata?.kind === 'label') surfaces.add('image-labels')
        if (isRecord(descriptorMetadata?.well)) surfaces.add('hcs-plate-well-field')
        const kind =
          typeof descriptorMetadata?.kind === 'string' ? descriptorMetadata.kind : undefined
        datasets.push(
          Object.freeze({
            id: summary.id,
            sampleType: dataset.descriptor.sampleType,
            levels: dataset.descriptor.levels.length,
            selections: read.selections,
            bytesRead: read.bytesRead,
            objectRequests: after.objectRequests - before.objectRequests,
            rangeRequests: after.rangeRequests - before.rangeRequests,
            bytesFetched: after.bytesFetched - before.bytesFetched,
            axes: Object.freeze(
              dataset.descriptor.axes.map((axis) =>
                Object.freeze({ id: axis.id, length: axis.length }),
              ),
            ),
            ...(kind === undefined ? {} : { kind }),
            hasOmeroDisplay,
            levelStorage: storage,
          }),
        )
      }
      const observedSurfaces = orderedSurfaces(surfaces)
      const missingSurface = sample.expectedSurfaces?.find((surface) => !surfaces.has(surface))
      if (missingSurface !== undefined) {
        throw invalidInput(
          `OME-Zarr sample ${sample.id} did not exercise expected surface ${missingSurface}`,
        )
      }
      const warnings = metadataWarnings(document.metadata.omeZarrWarnings)
      return Object.freeze({
        ...sample,
        classification: 'PASS',
        probeConfidence,
        storeIdentity,
        observedSurfaces,
        ...(warnings === undefined ? {} : { warnings }),
        datasets: Object.freeze(datasets),
      })
    } finally {
      document.close?.()
    }
  } catch (cause) {
    return Object.freeze({
      ...sample,
      classification: classifyOmeZarrCompatibilityFailure(cause),
      ...(probeConfidence === undefined ? {} : { probeConfidence }),
      ...(storeIdentity === undefined ? {} : { storeIdentity }),
      message: cause instanceof Error ? cause.message : String(cause),
    })
  } finally {
    context?.store.close()
  }
}
