import { readFile, writeFile } from 'node:fs/promises'
import { m7ExpansionCases, m7ExpansionSplit } from './m7-expansion-selection.ts'
import { interpolateM7Quality } from './m7-quality-curves.ts'

const split = m7ExpansionSplit(process.env.PUREJSIMAGE_M7_EXPANSION_SPLIT)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected record')
  return value
}
const number = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Expected finite metric')
  return value
}
const load = async (path: string) => record(JSON.parse(await readFile(path, 'utf8')))
const targets = [
  { metric: 'ssimulacra2', score: 70 },
  { metric: 'ssimulacra2', score: 80 },
  { metric: 'ssimulacra2', score: 90 },
  { metric: 'butteraugli', score: 1 },
  { metric: 'butteraugli', score: 2 },
] as const
interface Point {
  id: string
  engine: string
  setting: number
  bytes: number
  domain: string
  ssimulacra2: number
  butteraugli: number
}
const runId = process.argv[2]
if (!runId || !/^[a-z0-9-]+$/u.test(runId))
  throw new Error('Specify the shared HDR/alpha run identifier')
const mode = process.argv[3] ?? 'both'
if (mode !== 'both' && mode !== 'alpha') throw new Error('Expected both or alpha report mode')
const kinds: readonly ('hdr' | 'alpha')[] = mode === 'alpha' ? ['alpha'] : ['hdr', 'alpha']
const domains =
  mode === 'alpha'
    ? ['background-black', 'background-white']
    : ['headroom-1', 'headroom-2', 'headroom-4', 'background-black', 'background-white']
const alphaProtocol = await load(`.tmp/jpegxl-m7/alpha-${split}-${runId}/protocol.json`)
if (
  (alphaProtocol.split ?? 'development') !== split ||
  !Array.isArray(alphaProtocol.sourceFiles) ||
  !Array.isArray(alphaProtocol.oracleFiles) ||
  typeof alphaProtocol.mappingProtocolSha256 !== 'string'
)
  throw new Error('Missing alpha protocol fingerprint')
let hdrSourceFingerprint: string | undefined
const results: object[] = [],
  errors: object[] = [],
  points: Point[] = []
for (const kind of kinds) {
  const cases = m7ExpansionCases(split, kind === 'hdr' ? 'hdr' : 'png')
  for (const entry of cases) {
    if (kind === 'hdr') {
      for (const setting of [0.25, 0.5, 1, 2, 3, 5]) {
        const path = `.tmp/jpegxl-m7/hdr-${split}-${runId}/${entry.id}/distance-${setting}/report.json`
        try {
          const report = await load(path),
            protocol = record(report.protocol)
          if (
            protocol.split !== split ||
            protocol.id !== entry.id ||
            protocol.distance !== setting ||
            protocol.sourceSha256 !== entry.sourceSha256 ||
            !Array.isArray(report.results)
          )
            throw new Error('HDR provenance mismatch')
          const fingerprint = JSON.stringify({
            sources: protocol.sourceFiles,
            tools: protocol.oracleFiles,
            mapping: protocol.mappingProtocolSha256,
          })
          if (
            !Array.isArray(protocol.sourceFiles) ||
            !Array.isArray(protocol.oracleFiles) ||
            typeof protocol.mappingProtocolSha256 !== 'string' ||
            protocol.mappingProtocolSha256 !== alphaProtocol.mappingProtocolSha256
          )
            throw new Error('Missing HDR protocol fingerprint')
          if (hdrSourceFingerprint !== undefined && hdrSourceFingerprint !== fingerprint)
            throw new Error('Mixed HDR source or tool versions')
          hdrSourceFingerprint = fingerprint
          for (const raw of report.results) {
            const point = record(raw)
            if (
              point.status !== 'measured' ||
              typeof point.engine !== 'string' ||
              !Array.isArray(point.displays)
            ) {
              errors.push({ path, point })
              continue
            }
            for (const rawDisplay of point.displays) {
              const d = record(rawDisplay)
              points.push({
                id: entry.id,
                engine: point.engine,
                setting,
                bytes: number(point.bytes),
                domain: `headroom-${number(d.headroom)}`,
                ssimulacra2: number(d.ssimulacra2),
                butteraugli: number(d.butteraugli),
              })
            }
          }
          results.push({ path, report })
        } catch (error) {
          errors.push({ path, error: String(error) })
        }
      }
    } else {
      const path = `.tmp/jpegxl-m7/alpha-${split}-${runId}/${entry.id}/report.json`
      try {
        const report = await load(path)
        if (
          report.id !== entry.id ||
          report.sourceSha256 !== entry.sourceSha256 ||
          !Array.isArray(report.points)
        )
          throw new Error('Alpha provenance mismatch')
        for (const raw of report.points) {
          const point = record(raw)
          if (
            point.status !== 'measured' ||
            typeof point.engine !== 'string' ||
            !Array.isArray(point.composites)
          ) {
            errors.push({ path, point })
            continue
          }
          for (const rawDisplay of point.composites) {
            const d = record(rawDisplay)
            if (d.background !== 'black' && d.background !== 'white')
              throw new Error('Invalid composite domain')
            points.push({
              id: entry.id,
              engine: point.engine,
              setting: number(point.setting),
              bytes: number(point.bytes),
              domain: `background-${d.background}`,
              ssimulacra2: number(d.ssimulacra2),
              butteraugli: number(d.butteraugli),
            })
          }
        }
        results.push({ path, report })
      } catch (error) {
        errors.push({ path, error: String(error) })
      }
    }
  }
}
for (const point of points) {
  const coordinates =
    point.engine === 'purejsimage' || point.engine === 'libjxl'
      ? [0.25, 0.5, 1, 2, 3, 5]
      : [40, 55, 70, 80, 90, 97]
  if (
    !['purejsimage', 'libjxl', 'webp', 'avif'].includes(point.engine) ||
    !coordinates.includes(point.setting) ||
    !Number.isSafeInteger(point.bytes) ||
    point.bytes < 1
  )
    throw new Error('Curve point is outside the frozen protocol')
}
const matches: {
  domain: string
  metric: string
  score: number
  engine: string
  id: string
  ratio: number
}[] = []
const unmatched: object[] = []
for (const domain of domains)
  for (const entry of m7ExpansionCases(split, domain.startsWith('headroom') ? 'hdr' : 'png')) {
    const engines = domain.startsWith('headroom')
      ? ['purejsimage', 'libjxl']
      : ['purejsimage', 'libjxl', 'webp', 'avif']
    for (const target of targets) {
      const matched = new Map<string, number>()
      for (const engine of engines) {
        const curve = points.filter(
          (p) => p.id === entry.id && p.domain === domain && p.engine === engine,
        )
        if (curve.length !== 6 || new Set(curve.map((p) => p.setting)).size !== 6) {
          unmatched.push({ domain, id: entry.id, engine, ...target, reason: 'incomplete' })
          continue
        }
        const bytes = interpolateM7Quality(
          curve.map((p) => ({ bytes: p.bytes, score: p[target.metric] })),
          target.score,
          target.metric === 'ssimulacra2',
        )
        if (bytes === undefined)
          unmatched.push({ domain, id: entry.id, engine, ...target, reason: 'unbracketed' })
        else matched.set(engine, bytes)
      }
      const own = matched.get('purejsimage')
      if (own !== undefined)
        for (const engine of engines) {
          const comparator = matched.get(engine)
          if (engine !== 'purejsimage' && comparator !== undefined)
            matches.push({ domain, id: entry.id, engine, ...target, ratio: own / comparator })
        }
    }
  }
const summaries: object[] = []
for (const domain of domains)
  for (const target of targets)
    for (const engine of ['libjxl', 'webp', 'avif']) {
      const values = matches
        .filter(
          (p) =>
            p.domain === domain &&
            p.metric === target.metric &&
            p.score === target.score &&
            p.engine === engine,
        )
        .map((p) => p.ratio)
        .sort((a, b) => a - b)
      if (!values.length) continue
      const low = values[Math.floor((values.length - 1) / 2)],
        high = values[Math.floor(values.length / 2)]
      if (low === undefined || high === undefined) throw new Error('Missing median')
      summaries.push({
        domain,
        ...target,
        engine,
        matched: values.length,
        missingOrUnbracketed: 6 - values.length,
        medianRatio: (low + high) / 2,
        p90Ratio: values[Math.ceil(values.length * 0.9) - 1],
        worstRatio: values.at(-1),
      })
    }
await writeFile(
  `.tmp/jpegxl-m7/expansion-quality-${split === 'development' ? '' : 'holdout-'}${runId}-summary.json`,
  `${JSON.stringify({ split, policy: `Frozen ${split} diagnostic only. One vote per family, comparator, metric and domain. Never extrapolate; incomplete or unbracketed curves stay missing. Full raw source/tool protocols retained. No stable promotion.`, runId, alphaProtocol, errors, summaries, matches, unmatched, results, stablePromotionGatePassed: false }, null, 2)}\n`,
)
console.log(JSON.stringify({ reports: results.length, errors: errors.length, summaries }))
