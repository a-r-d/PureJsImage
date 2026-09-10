import { createHash } from 'node:crypto'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'

/** One serial worker owns each path. A killed writer leaves the previous checkpoint intact. */
export async function writeM7QualityReport(
  path: string,
  value: Readonly<Record<string, unknown>>,
): Promise<void> {
  const pending = `${path}.pending`
  await writeFile(pending, `${JSON.stringify(value, null, 2)}\n`)
  await rename(pending, path)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Invalid M7 cache record')
  return value
}
export interface M7CacheIdentity {
  readonly id: string
  readonly sourceSha256: string
  readonly normalizedSha256: string
  readonly width: number
  readonly height: number
}
export function validateM7CachedPoint(
  value: unknown,
  engine: string,
  setting: number,
): Record<string, unknown> {
  const point = record(value)
  if (point.engine !== engine || point.setting !== setting || point.status !== 'measured')
    throw new Error('M7 cache coordinate or status mismatch')
  for (const field of ['bytes', 'ssimulacra2', 'butteraugli', 'rmse', 'maximumError']) {
    const number = point[field]
    if (typeof number !== 'number' || !Number.isFinite(number))
      throw new Error(`Invalid cached ${field}`)
  }
  if (typeof point.bytes !== 'number' || !Number.isSafeInteger(point.bytes) || point.bytes <= 0)
    throw new Error('Invalid cached byte count')
  for (const field of ['encodedSha256', 'decodedSha256'])
    if (typeof point[field] !== 'string' || !/^[a-f0-9]{64}$/u.test(point[field]))
      throw new Error('Invalid cached hash')
  const raw = record(point.rawMetrics)
  if (
    typeof raw.ssimulacra2Text !== 'string' ||
    typeof raw.butteraugliText !== 'string' ||
    Number.parseFloat(raw.ssimulacra2Text) !== point.ssimulacra2 ||
    Number.parseFloat(raw.butteraugliText) !== point.butteraugli
  )
    throw new Error('Cached raw metrics disagree with scores')
  if (
    engine === 'purejsimage' &&
    (typeof point.maximumIndependentDifference !== 'number' ||
      !Number.isSafeInteger(point.maximumIndependentDifference) ||
      point.maximumIndependentDifference < 0 ||
      point.maximumIndependentDifference > 2)
  )
    throw new Error('Cached first-party point lacks independent decoder agreement')
  return point
}
export async function loadM7QualityCache(
  directory: string | undefined,
  identity: M7CacheIdentity,
  expectedProtocol: Readonly<Record<string, unknown>>,
  ownFingerprint?: string,
): Promise<
  | Readonly<{
      directory: string
      reportSha256: string
      sourceFingerprint: string
      points: readonly unknown[]
    }>
  | undefined
> {
  if (!directory) return undefined
  let bytes: Uint8Array
  try {
    bytes = await readFile(`${directory}/${identity.id}/report.json`)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  const protocol = record(JSON.parse(await readFile(`${directory}/protocol.json`, 'utf8')))
  const report = record(JSON.parse(new TextDecoder().decode(bytes)))
  const resolutionTransition =
    (protocol.resolution ?? 'original') === 'original' && expectedProtocol.resolution === '2mp'
  if (resolutionTransition) {
    for (const field of ['id', 'sourceSha256'] as const)
      if (report[field] !== identity[field]) throw new Error(`M7 cache source mismatch: ${field}`)
    // Small originals are unchanged by the new cap. Larger originals must be measured again.
    // A normalized-pixel hash match is required before relaxing the preprocessing label.
    if (
      report.width !== identity.width ||
      report.height !== identity.height ||
      report.normalizedSha256 !== identity.normalizedSha256
    )
      return undefined
    if (identity.width * identity.height > 2_000_000)
      throw new Error('Capped cache exceeds pixel limit')
  }
  for (const field of ['runtime', 'sharp', 'tools', 'preprocessing', 'evaluation', 'matching'])
    if (
      !(resolutionTransition && field === 'preprocessing') &&
      JSON.stringify(protocol[field]) !== JSON.stringify(expectedProtocol[field])
    )
      throw new Error(`M7 cache protocol mismatch: ${field}`)
  if ((protocol.split ?? 'development') !== (expectedProtocol.split ?? 'development'))
    throw new Error('M7 cache split mismatch')
  for (const [field, value] of Object.entries(identity))
    if (report[field] !== value) throw new Error(`M7 cache source mismatch: ${field}`)
  if (
    typeof report.sourceFingerprint !== 'string' ||
    report.sourceFingerprint.length === 0 ||
    report.sourceFingerprint !== protocol.sourceFingerprint ||
    (ownFingerprint !== undefined && report.sourceFingerprint !== ownFingerprint)
  )
    throw new Error('M7 cache implementation mismatch')
  if (!Array.isArray(report.points)) throw new Error('M7 cache has no point array')
  return {
    directory,
    reportSha256: createHash('sha256').update(bytes).digest('hex'),
    sourceFingerprint: report.sourceFingerprint,
    points: report.points,
  }
}
function cachedPoint(
  cache: Awaited<ReturnType<typeof loadM7QualityCache>>,
  engine: string,
  setting: number,
): Record<string, unknown> | undefined {
  if (!cache) return undefined
  const matches = cache.points.filter((value) => {
    const point = record(value)
    return point.engine === engine && point.setting === setting
  })
  if (matches.length > 1) throw new Error('Duplicate M7 cache coordinate')
  if (matches.length === 0) return undefined
  if (record(matches[0]).status === 'failed')
    throw new Error('Requested cached coordinate previously failed')
  return validateM7CachedPoint(matches[0], engine, setting)
}
export async function reuseM7QualityPoint(
  cache: Awaited<ReturnType<typeof loadM7QualityCache>>,
  id: string,
  engine: string,
  setting: number,
  destinationDirectory: string,
): Promise<Record<string, unknown> | undefined> {
  if (!cache) return undefined
  // Failed points remain in their original report and are never reused as successful evidence.
  const point = cachedPoint(cache, engine, setting)
  if (!point) return undefined
  const suffix =
    engine === 'purejsimage' || engine === 'libjxl' ? 'jxl' : engine === 'mozjpeg' ? 'jpg' : engine
  const encoded = await readFile(`${cache.directory}/${id}/${engine}-${setting}.${suffix}`)
  if (
    encoded.length !== point.bytes ||
    createHash('sha256').update(encoded).digest('hex') !== point.encodedSha256
  )
    throw new Error('Cached encoded artifact changed')
  await copyFile(
    `${cache.directory}/${id}/${engine}-${setting}.${suffix}`,
    `${destinationDirectory}/${engine}-${setting}.${suffix}`,
  )
  return { ...point, reusedFrom: { directory: cache.directory, reportSha256: cache.reportSha256 } }
}

/** Protocol and input identity are checked when loading; fresh bytes prove output equivalence. */
export async function revalidateM7EncodedPoint(
  cache: Awaited<ReturnType<typeof loadM7QualityCache>>,
  id: string,
  setting: number,
  freshlyEncoded: Uint8Array,
  currentFingerprint: string,
  destinationDirectory: string,
): Promise<Record<string, unknown> | undefined> {
  const point = cachedPoint(cache, 'purejsimage', setting)
  if (!cache || !point) return undefined
  const encodedSha256 = createHash('sha256').update(freshlyEncoded).digest('hex')
  if (freshlyEncoded.length !== point.bytes || encodedSha256 !== point.encodedSha256)
    return undefined
  const reused = await reuseM7QualityPoint(cache, id, 'purejsimage', setting, destinationDirectory)
  if (!reused) throw new Error('Revalidated point disappeared')
  return {
    ...reused,
    byteRevalidation: {
      encodedSha256,
      previousFingerprint: cache.sourceFingerprint,
      currentFingerprint,
      policy:
        'Fresh encoding is byte-identical; original pinned-decoder and metric evidence retained',
    },
  }
}
