import { ImageError, invalidInput } from '../../src/errors.ts'
import type { ScientificDataset, ScientificPlaneReadRequest } from '../../src/scientific/dataset.ts'
import {
  createOmeZarrHttpContext,
  normalizeOmeZarrStoreUrl,
  type OmeZarrHttpStoreOptions,
} from '../../src/scientific/ome-zarr-http.ts'
import { createOmeZarrReader } from '../../src/scientific/readers/ome-zarr.ts'

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

export interface OmeZarrCompatibilitySample {
  readonly id: string
  readonly collection: string
  readonly url: string
  readonly expectedClassification?: OmeZarrCompatibilityClassification
}

export interface OmeZarrCompatibilityCorpus {
  readonly schemaVersion: 1
  readonly samples: readonly OmeZarrCompatibilitySample[]
}

export interface OmeZarrCompatibilityDatasetResult {
  readonly id: string
  readonly sampleType: string
  readonly levels: number
  readonly bytesRead: number
}

export interface OmeZarrCompatibilityResult {
  readonly id: string
  readonly collection: string
  readonly url: string
  readonly classification: OmeZarrCompatibilityClassification
  readonly expectedClassification?: OmeZarrCompatibilityClassification
  readonly probeConfidence?: number
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
    return Object.freeze({
      id,
      collection,
      url,
      ...(expectedClassification === undefined ? {} : { expectedClassification }),
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
    /network|fetch failed|request failed|returned status|http .*status|timed? out|dns|cors/u.test(
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

const tinyPlaneRequest = (
  dataset: ScientificDataset,
  level: number,
  widthLimit: number,
  heightLimit: number,
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
  return Object.freeze({
    displayAxes,
    fixedIndices: Object.freeze(
      dataset.descriptor.axes
        .filter((axis) => axis.id !== horizontal.id && axis.id !== vertical.id)
        .map((axis) => Object.freeze({ axisId: axis.id, index: 0 })),
    ),
    resolutionLevel: level,
    x: 0,
    y: 0,
    width: Math.min(widthLimit, levelAxisLength(dataset, level, horizontal.id)),
    height: Math.min(heightLimit, levelAxisLength(dataset, level, vertical.id)),
  })
}

const readAllLevels = async (
  dataset: ScientificDataset,
  width: number,
  height: number,
): Promise<number> => {
  let bytesRead = 0
  for (const level of dataset.descriptor.levels.keys()) {
    let blocks = 0
    for await (const block of dataset.readPlane(tinyPlaneRequest(dataset, level, width, height))) {
      try {
        bytesRead += block.data.byteLength
        blocks += 1
      } finally {
        block.release?.()
      }
    }
    if (blocks === 0) throw invalidInput(`OME-Zarr level ${level} returned no raster blocks`)
  }
  return bytesRead
}

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
  try {
    context = await createOmeZarrHttpContext(sample.url, storeOptions)
    const reader = createOmeZarrReader({
      limits: { maxDatasets: 256, maxLevels: 64, maxRegionBytes: 1_048_576 },
    })
    const probe = await reader.probe(context)
    probeConfidence = probe.confidence
    if (probe.confidence === 0) throw invalidInput(probe.reason ?? 'Not an OME-Zarr store')
    const document = await reader.open(context)
    try {
      const datasets: OmeZarrCompatibilityDatasetResult[] = []
      for (const summary of document.datasets) {
        const dataset = await document.openDataset(summary.id)
        datasets.push(
          Object.freeze({
            id: summary.id,
            sampleType: dataset.descriptor.sampleType,
            levels: dataset.descriptor.levels.length,
            bytesRead: await readAllLevels(dataset, width, height),
          }),
        )
      }
      return Object.freeze({
        ...sample,
        classification: 'PASS',
        probeConfidence,
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
      message: cause instanceof Error ? cause.message : String(cause),
    })
  } finally {
    context?.store.close()
  }
}
