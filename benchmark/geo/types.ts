export type GeoBenchmarkStatus = 'passed' | 'unsupported' | 'failed'

export interface GeoBenchmarkMeasurements {
  readonly openMetadataMs: number
  readonly timeToFirstTileMs: number
  readonly requestsToFirstTile: number
  readonly transferredBytes: number
  readonly uniqueBytes: number
  readonly decodedPixels: number
  readonly cacheHits: number
  readonly peakManagedMemoryBytes: number
  readonly reprojectionOverheadMs: number
  readonly overviewSelection: string | null
  readonly zarrChunksAccessed: number
  readonly zarrShardsAccessed: number
  readonly zarrUniqueShardObjects: number
  readonly zarrShardIndexReads: number
  readonly zarrShardPayloadRanges: number
}

export interface GeoBenchmarkResult {
  readonly id: string
  readonly name: string
  readonly status: GeoBenchmarkStatus
  readonly fixtureIdentity: string
  readonly correctness: string
  readonly measurements: GeoBenchmarkMeasurements
  readonly notes: readonly string[]
}

export interface GeoBenchmarkReport {
  readonly schemaVersion: 1
  readonly harnessVersion: 1
  readonly generatedAt: string
  readonly deterministicServers: true
  readonly results: readonly GeoBenchmarkResult[]
}

export interface GeoLiveCompatibilityRecord {
  readonly schemaVersion: 1
  readonly assetIdentity: string
  readonly testedAt: string
  readonly transport: Readonly<{
    readonly protocol: string
    readonly acceptsRanges: boolean | 'unknown'
    readonly contentEncoding: string | null
  }>
  readonly sourceMutationEvidence: Readonly<{
    readonly etag: string | null
    readonly lastModified: string | null
    readonly versionId: string | null
  }>
  readonly outcome: 'passed' | 'failed' | 'unsupported' | 'source-mutated'
  readonly failureCategory: string | null
}

const nonEmpty = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`)
  return value
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finiteNonNegative = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`)
  }
  return value
}

const parseMeasurements = (value: unknown): GeoBenchmarkMeasurements => {
  if (!isRecord(value)) throw new Error('Geo benchmark measurements must be an object')
  const overview = value.overviewSelection
  if (overview !== null && typeof overview !== 'string') {
    throw new Error('Geo benchmark overviewSelection must be a string or null')
  }
  return {
    openMetadataMs: finiteNonNegative(value.openMetadataMs, 'openMetadataMs'),
    timeToFirstTileMs: finiteNonNegative(value.timeToFirstTileMs, 'timeToFirstTileMs'),
    requestsToFirstTile: finiteNonNegative(value.requestsToFirstTile, 'requestsToFirstTile'),
    transferredBytes: finiteNonNegative(value.transferredBytes, 'transferredBytes'),
    uniqueBytes: finiteNonNegative(value.uniqueBytes, 'uniqueBytes'),
    decodedPixels: finiteNonNegative(value.decodedPixels, 'decodedPixels'),
    cacheHits: finiteNonNegative(value.cacheHits, 'cacheHits'),
    peakManagedMemoryBytes: finiteNonNegative(
      value.peakManagedMemoryBytes,
      'peakManagedMemoryBytes',
    ),
    reprojectionOverheadMs: finiteNonNegative(
      value.reprojectionOverheadMs,
      'reprojectionOverheadMs',
    ),
    overviewSelection: overview,
    zarrChunksAccessed: finiteNonNegative(value.zarrChunksAccessed, 'zarrChunksAccessed'),
    zarrShardsAccessed: finiteNonNegative(value.zarrShardsAccessed, 'zarrShardsAccessed'),
    zarrUniqueShardObjects: finiteNonNegative(
      value.zarrUniqueShardObjects,
      'zarrUniqueShardObjects',
    ),
    zarrShardIndexReads: finiteNonNegative(value.zarrShardIndexReads, 'zarrShardIndexReads'),
    zarrShardPayloadRanges: finiteNonNegative(
      value.zarrShardPayloadRanges,
      'zarrShardPayloadRanges',
    ),
  }
}

const parseResult = (value: unknown): GeoBenchmarkResult => {
  if (!isRecord(value)) throw new Error('Geo benchmark result must be an object')
  const status = value.status
  if (status !== 'passed' && status !== 'unsupported' && status !== 'failed') {
    throw new Error('Geo benchmark status is invalid')
  }
  if (!Array.isArray(value.notes) || value.notes.some((note) => typeof note !== 'string')) {
    throw new Error('Geo benchmark notes must be strings')
  }
  const notes: readonly string[] = value.notes.filter(
    (note): note is string => typeof note === 'string',
  )
  return {
    id: nonEmpty(value.id, 'result.id'),
    name: nonEmpty(value.name, 'result.name'),
    status,
    fixtureIdentity: nonEmpty(value.fixtureIdentity, 'result.fixtureIdentity'),
    correctness: nonEmpty(value.correctness, 'result.correctness'),
    measurements: parseMeasurements(value.measurements),
    notes,
  }
}

export const parseGeoBenchmarkReport = (value: unknown): GeoBenchmarkReport => {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.harnessVersion !== 1) {
    throw new Error('Geo benchmark report version is invalid')
  }
  if (value.deterministicServers !== true) {
    throw new Error('Geo benchmark report must use deterministic servers')
  }
  if (!Array.isArray(value.results)) throw new Error('Geo benchmark results must be an array')
  return {
    schemaVersion: 1,
    harnessVersion: 1,
    generatedAt: nonEmpty(value.generatedAt, 'generatedAt'),
    deterministicServers: true,
    results: value.results.map(parseResult),
  }
}

/** Validates opt-in public asset records before they are retained as evidence. */
export const validateGeoLiveCompatibilityRecord = (value: unknown): GeoLiveCompatibilityRecord => {
  if (!isRecord(value)) throw new Error('Live geo record must be an object')
  const record = value
  if (record.schemaVersion !== 1) throw new Error('Live geo record schemaVersion must be 1')
  const transport = record.transport
  const mutation = record.sourceMutationEvidence
  if (!isRecord(transport)) throw new Error('Live geo transport is required')
  if (!isRecord(mutation)) throw new Error('Live geo mutation evidence is required')
  const transportRecord = transport
  const mutationRecord = mutation
  const acceptsRanges = transportRecord.acceptsRanges
  if (acceptsRanges !== true && acceptsRanges !== false && acceptsRanges !== 'unknown')
    throw new Error('Live geo acceptsRanges is invalid')
  const nullableString = (candidate: unknown, label: string): string | null => {
    if (candidate === null) return null
    return nonEmpty(candidate, label)
  }
  const outcome = record.outcome
  if (
    outcome !== 'passed' &&
    outcome !== 'failed' &&
    outcome !== 'unsupported' &&
    outcome !== 'source-mutated'
  )
    throw new Error('Live geo outcome is invalid')
  const failureCategory = nullableString(record.failureCategory, 'failureCategory')
  if (outcome === 'passed' && failureCategory !== null)
    throw new Error('Passed live geo records cannot have a failure category')
  if (outcome !== 'passed' && failureCategory === null)
    throw new Error('Non-passing live geo records require a failure category')
  const testedAt = nonEmpty(record.testedAt, 'testedAt')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(testedAt)) {
    throw new Error('testedAt must be an exact UTC ISO timestamp')
  }
  return {
    schemaVersion: 1,
    assetIdentity: nonEmpty(record.assetIdentity, 'assetIdentity'),
    testedAt,
    transport: {
      protocol: nonEmpty(transportRecord.protocol, 'transport.protocol'),
      acceptsRanges,
      contentEncoding: nullableString(transportRecord.contentEncoding, 'transport.contentEncoding'),
    },
    sourceMutationEvidence: {
      etag: nullableString(mutationRecord.etag, 'sourceMutationEvidence.etag'),
      lastModified: nullableString(
        mutationRecord.lastModified,
        'sourceMutationEvidence.lastModified',
      ),
      versionId: nullableString(mutationRecord.versionId, 'sourceMutationEvidence.versionId'),
    },
    outcome,
    failureCategory,
  }
}
