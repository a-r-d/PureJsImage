import { readdir, readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { hash, json, root, work } from './io.ts'
import {
  counts,
  number,
  object,
  type Status,
  statuses,
  string,
  subjects,
  summarize,
  validateImplementationIdentity,
} from './model.ts'

function rows(value: unknown): Record<string, unknown>[] {
  const list = object(value).rows
  if (!Array.isArray(list)) throw new Error('Missing result rows')
  return list.map(object)
}
function status(value: unknown): Status {
  const result = statuses.find((s) => s === value)
  if (!result) throw new Error(`Invalid result status: ${value}`)
  return result
}
const rawReports = []
for (const file of (await readdir(`${root}/results`))
  .filter(
    (f) =>
      /^(main|repair|compat|cold|specialized|preview|quality|validation-amendment)/.test(f) &&
      f.endsWith('.json'),
  )
  .sort()) {
  const bytes = await readFile(`${root}/results/${file}`)
  const data: unknown = JSON.parse(bytes.toString())
  rawReports.push({ path: `${root}/results/${file}`, sha256: hash(bytes), data: object(data) })
}
const amendmentReport = rawReports.find((report) =>
  report.path.endsWith('/validation-amendment.json'),
)
const amended = amendmentReport?.data.reports
if (Array.isArray(amended))
  for (const value of amended) {
    const amendment = object(value)
    const source = rawReports.find((report) => report.path === amendment.sourceReport)
    if (!source || source.sha256 !== amendment.sourceReportSha256)
      throw new Error('Validation amendment source report changed')
  }
const amendments = Array.isArray(amended)
  ? amended.map(object).flatMap((report) =>
      Array.isArray(report.amendments)
        ? report.amendments.map((value) => ({
            ...object(value),
            sourceReport: report.sourceReport,
          }))
        : [],
    )
  : []
const allTimingRows = rawReports
  .filter((r) => /\/(main|repair|compat|cold)-/.test(r.path))
  .flatMap((report) =>
    rows(report.data).map((row) => {
      const times = Array.isArray(row.times) ? row.times.map(number) : [],
        amendment = amendments.find(
          (change) => change.sourceReport === report.path && object(change).key === row.key,
        ),
        s = status(amendment ? object(amendment).status : row.status)
      return {
        ...row,
        originalStatus: row.status,
        validationAmendment: amendment ?? null,
        key: string(row.key),
        fixture: string(row.fixture),
        scope: row.scope,
        settings: row.settings,
        output: row.output,
        memory: row.memory,
        subject: string(row.subject),
        operation: string(row.operation),
        requests: row.requests,
        runtime: string(report.data.runtime),
        status: s,
        sourceReport: report.path,
        warmMs: s === 'verified' ? summarize(times) : null,
        coldMs: s === 'verified' ? (row.coldMs ?? null) : null,
        unvalidatedTiming: s === 'verified' ? null : { coldMs: row.coldMs ?? null, times },
      }
    }),
  )
const repaired = allTimingRows.filter((row) => row.sourceReport.includes('/repair-'))
const supersededMeasurements = allTimingRows.filter(
  (row) =>
    row.sourceReport.includes('/main-') &&
    repaired.some((repair) => repair.runtime === row.runtime && repair.key === row.key),
)
const timingRows = allTimingRows.filter((row) => !supersededMeasurements.includes(row))
const summaries = []
for (const runtime of ['chromium', 'node'])
  for (const subject of subjects)
    for (const operation of ['decode-lossless', 'decode-lossy', 'encode', 'roundtrip']) {
      const selected = timingRows.filter(
        (r) =>
          r.runtime === runtime &&
          r.subject === subject &&
          r.operation === operation &&
          (r.sourceReport.includes('/main-') || r.sourceReport.includes('/repair-')),
      )
      summaries.push({
        runtime,
        subject,
        operation,
        counts: counts(selected),
        note:
          subject === 'oxide'
            ? 'Decode plus mandatory PNG export; raw pixels API absent. Not included in raw-decode speed ratios.'
            : null,
      })
    }
const manifest = object(JSON.parse(await readFile(`${root}/subjects.json`, 'utf8'))),
  assets = manifest.files
for (const report of rawReports)
  if (/\/(main|repair|compat|cold|specialized|preview)-|\/quality\.json$/.test(report.path))
    validateImplementationIdentity(report.data, manifest)
if (!Array.isArray(assets)) throw new Error('Missing asset inventory')
const assetRows = assets.map(object),
  footprints = []
for (const subject of subjects) {
  const measured = timingRows.find(
    (r) =>
      r.runtime === 'chromium' &&
      r.subject === subject &&
      r.status === 'verified' &&
      Array.isArray(r.requests),
  )
  const requests = Array.isArray(measured?.requests) ? measured.requests.map(object) : [],
    paths = new Set(
      requests
        .map((r) => string(r.url))
        .filter((url) => url.startsWith('/web/') || url.startsWith('/assets/')),
    )
  const measuredReport = rawReports.find((report) => report.path === measured?.sourceReport)
  let measuredAssets = assetRows
  if (
    measuredReport &&
    measuredReport.data.subjectsSha256 !== hash(await readFile(`${root}/subjects.json`))
  ) {
    const old = object(
      JSON.parse(
        gunzipSync(
          await readFile(
            `${root}/results/subjects-${string(measuredReport.data.subjectsSha256)}.json.gz`,
          ),
        ).toString(),
      ),
    )
    if (!Array.isArray(old.files)) throw new Error('Missing historical assets')
    measuredAssets = old.files.map(object)
  }
  const files = [...paths].map((path) => {
    const found = measuredAssets.find((a) => a.path === `${work}${path}`)
    if (!found) throw new Error(`Unpinned loaded asset ${path}`)
    return found
  })
  footprints.push({
    subject,
    files,
    uniqueDeployedBytes: files.reduce((sum, f) => sum + number(f.bytes), 0),
    gzipBytes: files.reduce((sum, f) => sum + number(f.gzipBytes), 0),
    brotliBytes: files.reduce((sum, f) => sum + number(f.brotliBytes), 0),
    observedColdUncompressedTransferBytes: requests
      .filter((r) => paths.has(string(r.url)))
      .reduce((sum, r) => sum + number(r.bytes), 0),
    coldLibraryRequests: requests.filter((r) => paths.has(string(r.url))).length,
    cache:
      'No-store loopback HTTP during measurement; gzip/brotli are offline transfer estimates; warm operation requires zero new library requests; deployment counts each required file once',
    scope:
      'Combined encode+decode adapter toolkit, includes common benchmark worker and public entry-point dependencies; not a minimum decode-only bundle',
  })
}
const specialized = rawReports.find((r) => r.path.endsWith('specialized-node.json')),
  specializedRows = specialized ? rows(specialized.data) : []
const capabilities: Record<string, unknown>[] = []
const featureNames: Record<string, string[]> = {
  'native float and HDR headroom': [
    'native float samples',
    'explicit display conversion',
    'HDR headroom 1/2/4',
  ],
  'native float HDR': ['native float samples', 'native-light HDR'],
  'animation encode, decode, composition, timing and frame access': [
    'animation encode',
    'animation decode',
    'animation composition',
    'frame timing',
    'frame access',
  ],
  'animation decode, frame timing and frame access': ['frame timing'],
  'animation frame access and composition': [
    'animation decode',
    'animation composition',
    'frame access',
  ],
  'animation decode, frame timing and composition': [
    'animation decode',
    'frame timing',
    'animation composition',
  ],
  'animation frame access': ['frame access'],
  'exact JPEG recompression and reconstruction': [
    'exact JPEG recompression',
    'original-byte reconstruction',
  ],
  'region, reduced resolution, preview and selective reads': [
    'incremental input (known-length read-at source)',
    'region reconstruction',
    'reduced resolution',
    'early progressive output',
    'selective source reads',
  ],
  'incremental input and first useful preview': [
    'incremental input (sequential feed)',
    'early progressive output',
  ],
}
for (const row of timingRows.filter(
  (row) => row.sourceReport.includes('/main-') || row.sourceReport.includes('/repair-'),
)) {
  const settings = object(row.settings)
  capabilities.push({
    subject: row.subject,
    runtime: row.runtime,
    fixture: row.fixture,
    scope: row.scope,
    feature:
      row.operation === 'encode'
        ? settings.lossless
          ? 'static lossless encode'
          : 'static lossy encode'
        : row.operation === 'decode-lossless'
          ? 'static lossless decode'
          : row.operation === 'decode-lossy'
            ? 'static lossy decode'
            : 'decode and lossless re-encode',
    status: row.status,
    evidenceKey: row.key,
    sourceReport: row.sourceReport,
  })
}
for (const runtime of ['node', 'chromium', 'firefox', 'webkit'])
  for (const subject of subjects) {
    const verified = timingRows.find(
      (row) => row.runtime === runtime && row.subject === subject && row.status === 'verified',
    )
    capabilities.push({
      subject,
      runtime,
      feature: 'runtime availability',
      status: verified ? 'verified' : 'not tested',
      evidenceKey: verified?.key ?? null,
      sourceReport: verified?.sourceReport ?? null,
    })
    if (runtime !== 'node')
      capabilities.push({
        subject,
        runtime,
        feature: 'dedicated module worker',
        status: verified ? 'verified' : 'not tested',
        crossOriginIsolationRequired: subject === 'vips',
        evidenceKey: verified?.key ?? null,
      })
  }
for (const subject of subjects) {
  for (const row of specializedRows.filter((r) => r.subject === subject))
    for (const feature of featureNames[string(row.feature)] ?? [string(row.feature)])
      capabilities.push({
        ...row,
        probe: row.feature,
        feature,
        runtime: 'node',
        sourceReport: specialized?.path,
        maturity:
          subject === 'purejsimage' && /animation|frame timing|frame access/.test(feature)
            ? 'Experimental'
            : null,
      })
  const absent: Record<string, string> =
    subject === 'jsquash'
      ? {
          'native integer above 8-bit / native float':
            'ImageData8 wrapper exposes no native high-depth sample API',
          'extra channels': 'No named extra-channel export',
          'animation decode / frame timing / frame access / animation encode':
            'Published encode/decode API has no sequence control or timing result',
          'ICC / metadata access': 'ImageData result contains no original metadata',
          'incremental input / early progressive output / reduced resolution / region reconstruction / selective source reads':
            'Only whole ArrayBuffer decode is exposed',
          'exact JPEG recompression / original-byte reconstruction': 'No JPEG reconstruction API',
        }
      : subject === 'oxide'
        ? {
            'static encode / animation encode': 'Published binding is decoder-only',
            'native raw integer planes / native raw float planes':
              'RenderResult exports PNG, not native raw sample planes; PNG conversion is separate',
            'extra channels': 'No raw named extra-channel export',
            'reduced resolution': 'No scale control in published binding',
            'selective source reads':
              'Sequential feedBytes, no caller read-at interface; region reconstruction does not imply selective source reads',
            'exact JPEG recompression / original-byte reconstruction':
              'No reconstruction API in published binding',
          }
        : subject === 'vips'
          ? {
              'incremental input / early progressive output':
                'Buffer/source loaders expose materialized Image evaluation, no progressive-pass result API',
              'reduced-resolution JPEG XL reconstruction':
                'No shrink/scale option on published jxlloadBuffer loader',
              'selective source reads':
                'Published Source exposes memory/file inputs, no JavaScript read-at callback. A lazy crop alone does not establish selective reads',
              'exact JPEG recompression / original-byte reconstruction':
                'No exact JPEG reconstruction entry point on the JXL wrapper',
            }
          : {}
  for (const [group, detail] of Object.entries(absent))
    for (const feature of group.split(' / '))
      capabilities.push({
        subject,
        feature,
        status: 'API not exposed',
        detail,
        runtime: 'public API inspection',
        sourceReport: 'survey.json',
      })
  for (const feature of [
    'Exif/XMP preservation',
    'orientation rendering',
    'arbitrary animation blend modes',
    'multithread speedup',
    'lossy native 16-bit encode/decode',
  ])
    capabilities.push({
      subject,
      feature,
      status: 'not tested',
      detail:
        'No claim from a file opening or from native engine capability; outside the finite measured subset',
      runtime: 'node/browser',
      sourceReport: null,
    })
  if (subject === 'vips')
    capabilities.push({
      subject,
      feature: 'region reconstruction',
      status: 'not tested',
      detail:
        'crop() API exists, but this comparison has not proved which JXL groups it reconstructs; never labeled selective decode',
      runtime: 'node/browser',
      sourceReport: null,
    })
}
const quality = rawReports.find((r) => r.path.endsWith('/quality.json'))?.data ?? null
const qualityCorrectness =
  rawReports.find((report) => report.path.endsWith('/quality-correctness.json'))?.data ?? null
if (qualityCorrectness) {
  const source = rawReports.find((report) => report.path === qualityCorrectness.sourceReport)
  if (!source || source.sha256 !== qualityCorrectness.sourceReportSha256)
    throw new Error('Quality validation source report changed')
}
const qualityEligible =
  qualityCorrectness !== null &&
  rows(qualityCorrectness).length > 0 &&
  rows(qualityCorrectness).every((row) => row.status === 'verified')
const qualityComparisons: unknown[] = []
if (qualityEligible && quality && Array.isArray(quality.results)) {
  const curves = quality.results.map(object)
  for (const own of curves.filter((curve) => curve.subject === 'purejsimage')) {
    const ownBands = Array.isArray(own.bands) ? own.bands.map(object) : []
    for (const other of curves.filter(
      (curve) =>
        curve.fixture === own.fixture &&
        curve.subject !== 'purejsimage' &&
        curve.subject !== 'native-libjxl',
    )) {
      const otherBands = Array.isArray(other.bands) ? other.bands.map(object) : []
      for (const target of [70, 80, 90]) {
        const a = ownBands.find((band) => band.target === target),
          b = otherBands.find((band) => band.target === target)
        const adequate = a?.status === 'adequate bracket' && b?.status === 'adequate bracket'
        qualityComparisons.push({
          fixture: own.fixture,
          subject: other.subject,
          target,
          status: adequate ? 'measured with adequate brackets' : 'unresolved',
          pureBracket: a ?? null,
          otherBracket: b ?? null,
          pureToOtherBytesRatio: adequate
            ? number(a.interpolatedBytes) / number(b.interpolatedBytes)
            : null,
        })
      }
    }
  }
}
const losslessPairs = []
for (const runtime of ['chromium', 'node'])
  for (const other of ['jsquash', 'vips'])
    for (const scope of ['capped', 'original', 'specialized'])
      for (const effort of [1, 7]) {
        const eligible = timingRows.filter(
          (row) =>
            row.runtime === runtime &&
            row.status === 'verified' &&
            row.operation === 'encode' &&
            row.scope === scope &&
            (row.sourceReport.includes('/main-') || row.sourceReport.includes('/repair-')) &&
            object(row.settings).lossless === true &&
            object(row.settings).effort === effort,
        )
        const pairs = []
        for (const own of eligible.filter((row) => row.subject === 'purejsimage')) {
          const reference = eligible.find(
            (row) => row.subject === other && row.fixture === own.fixture,
          )
          if (!reference) continue
          const a = own.warmMs?.median,
            b = reference.warmMs?.median
          pairs.push({
            fixture: own.fixture,
            sizeRatio: number(object(own.output).bytes) / number(object(reference.output).bytes),
            warmTimeRatio: typeof a === 'number' && typeof b === 'number' && b > 0 ? a / b : null,
          })
        }
        losslessPairs.push({
          runtime,
          other,
          scope,
          effort,
          pairs,
          sizeRatio: summarize(pairs.map((pair) => pair.sizeRatio)),
          warmTimeRatio: summarize(
            pairs.flatMap((pair) => (pair.warmTimeRatio === null ? [] : [pair.warmTimeRatio])),
          ),
          meaning:
            'PureJsImage / comparator, paired verified fixtures only; equal effort numbers do not imply equal work; no overall winner score',
        })
      }
const dataset = {
  schemaVersion: 1,
  generated: new Date().toISOString(),
  scope: 'Among these pinned public JavaScript APIs on the declared host; no overall winner score',
  sourceReports: rawReports.map(({ data, ...source }) => source),
  implementationRevision: manifest.implementationRevision,
  implementationSourceSha256: manifest.implementationSourceSha256,
  implementationDirty: manifest.implementationDirty,
  subjectsManifest: 'subjects.json',
  fixturesManifest: 'fixtures.json',
  survey: 'survey.json',
  timingRows,
  supersededMeasurements,
  repairReason:
    'Native-precision adapter correction: recognize wasm-vips grey16 and request oxide native-depth PNG instead of forceSrgb 8-bit PNG. Fresh repaired cells supersede affected initial measurements, which remain visible above.',
  summaries,
  footprints,
  capabilities,
  quality,
  validationAmendment: amendmentReport?.data ?? null,
  qualityCorrectness,
  qualityEligible,
  qualityComparisons,
  losslessPairs,
  preview: rawReports.find((r) => r.path.endsWith('preview-chromium.json'))?.data ?? null,
  limitations: [
    'Cold timings cover library import/initialization plus first operation inside a fresh worker/process. Harness startup, file preparation and validation are outside the timed interval.',
    'Cold timing has one observation per main cell; use cold-repeats report for repeated representative startup measurements.',
    'Only verified rows may support performance or size comparisons. Failed/unavailable cells remain present with their diagnostic timings.',
    'No aggregate lossy size ranking at equal numeric options. Quality subset and unresolved brackets remain explicit.',
    'Browser memory unavailable. Node RSS includes runtime, prepared input, output buffers, WASM and caches; not encoder-managed memory.',
    'Preview geometry checks do not establish visual fidelity, and the two preview workflows differ.',
    'Inspected M7 sources are regression evidence, not an unseen generalization set.',
  ],
}
await json(`${root}/website-data.json`, dataset)
const lines = [
  '# Measured comparison summary',
  '',
  'Generated from the raw reports. See `REPORT.md` for methods and limits.',
  '',
  '## Correctness and coverage',
  '',
  '| Runtime | Subject | Operation | Verified | API absent | Unsupported | Incorrect | Failed |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
]
for (const r of summaries)
  lines.push(
    `| ${r.runtime} | ${r.subject} | ${r.operation} | ${r.counts.verified} | ${r.counts['API not exposed']} | ${r.counts['unsupported input']} | ${r.counts['incorrect output']} | ${r.counts['execution failure']} |`,
  )
lines.push(
  '',
  '## Representative photo workflows',
  '',
  'Fixture im26-1030-diagnostic. Times in milliseconds; warm median [minimum, maximum] from three operations. Cold is initialization plus first operation, with sample count. Node peak RSS includes the entire isolated process. Oxide decode includes PNG export. Failed validation stays visible and has no performance result.',
  '',
  '| Runtime | Subject | Workflow | Warm ms [range] | Cold ms [range]; n | Peak RSS MiB |',
  '| --- | --- | --- | --- | --- | ---: |',
)
for (const runtime of ['chromium', 'node'])
  for (const subject of subjects)
    for (const operation of ['decode-lossless', 'decode-lossy', 'encode', 'roundtrip']) {
      const row = timingRows.find(
        (r) =>
          r.sourceReport.includes('/main-') &&
          r.runtime === runtime &&
          r.subject === subject &&
          r.fixture === 'im26-1030-diagnostic' &&
          r.operation === operation &&
          object(r.settings).lossless === true &&
          object(r.settings).effort === 1,
      )
      if (!row) continue
      const warm = row.warmMs
      const repeats = timingRows.filter(
        (r) =>
          r.sourceReport.includes('/cold-') &&
          r.runtime === runtime &&
          r.subject === subject &&
          r.fixture === row.fixture &&
          r.operation === operation &&
          r.status === 'verified',
      )
      const cold = summarize(
        repeats.length
          ? repeats.map((r) => number(r.coldMs))
          : row.status === 'verified' && typeof row.coldMs === 'number'
            ? [row.coldMs]
            : [],
      )
      const memory = row.memory ? object(row.memory) : null
      const format = (value: ReturnType<typeof summarize>) =>
        value
          ? `${number(value.median).toFixed(1)} [${number(value.minimum).toFixed(1)}, ${number(value.maximum).toFixed(1)}]`
          : row.status
      lines.push(
        `| ${runtime} | ${subject} | ${operation === 'encode' ? 'lossless encode, effort 1' : operation} | ${format(warm)} | ${format(cold)}${cold ? `; ${cold.count}` : ''} | ${row.status === 'verified' && typeof memory?.peakRssBytes === 'number' ? (memory.peakRssBytes / 1048576).toFixed(1) : 'unavailable'} |`,
      )
    }
lines.push(
  '',
  '## Loaded toolkit assets',
  '',
  'Includes required JS, WASM, and worker assets once each. Compression sizes are offline estimates.',
  '',
  '| Subject | Deployed bytes | gzip | Brotli | Observed cold transfer |',
  '| --- | ---: | ---: | ---: | ---: |',
)
for (const f of footprints)
  lines.push(
    `| ${f.subject} | ${f.uniqueDeployedBytes} | ${f.gzipBytes} | ${f.brotliBytes} | ${f.observedColdUncompressedTransferBytes} |`,
  )
lines.push(
  '',
  '## Specialized public API probes',
  '',
  '| Subject | Probe | Status |',
  '| --- | --- | --- |',
)
for (const r of specializedRows) lines.push(`| ${r.subject} | ${r.feature} | ${r.status} |`)
lines.push(
  '',
  '## Paired lossless ratios',
  '',
  'PureJsImage divided by each comparator. Only pairs that passed exact validation are included. Capped diagnostics, complete originals and precision fixtures stay separate.',
  '',
  '| Runtime | Comparator | Scope | Effort | Pairs | Median bytes ratio | Median warm time ratio |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: |',
)
for (const row of losslessPairs)
  if (row.pairs.length)
    lines.push(
      `| ${row.runtime} | ${row.other} | ${row.scope} | ${row.effort} | ${row.pairs.length} | ${row.sizeRatio?.median?.toFixed(3)} | ${row.warmTimeRatio?.median?.toFixed(3) ?? 'unavailable'} |`,
    )
lines.push(
  '',
  '## Matched lossy quality',
  '',
  'Only comparisons with independently validated outputs and adequate brackets on both sides receive a ratio. All unresolved targets and endpoints remain in the dataset.',
  '',
  '| Fixture | Comparator | SSIMULACRA2 | Pure/comparator bytes |',
  '| --- | --- | ---: | ---: |',
)
for (const value of qualityComparisons) {
  const row = object(value)
  if (row.status === 'measured with adequate brackets')
    lines.push(
      `| ${row.fixture} | ${row.subject} | ${row.target} | ${number(row.pureToOtherBytesRatio).toFixed(3)} |`,
    )
}
await writeFile(`${root}/SUMMARY.md`, `${lines.join('\n')}\n`)
console.log(
  `Generated ${timingRows.length} rows, ${capabilities.length} capability entries, ${footprints.length} footprints`,
)
