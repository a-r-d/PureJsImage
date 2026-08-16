import { readFile, writeFile } from 'node:fs/promises'

import {
  type ComparisonStatus,
  type ComparisonValue,
  comparisonEvidence,
  excludedTiffLibraries,
  type LibraryComparison,
  libraryComparisons,
  type TiffCapabilityKey,
  tiffCapabilityGroups,
} from '../docs-astro/src/data/library-comparison.ts'

interface ReportTotal {
  readonly engine: string
  readonly attempted: number
  readonly rgbaCompared: number
  readonly decoded: number
  readonly exact: number
  readonly mismatch: number
  readonly unsupported: number
  readonly error: number
  readonly oracleFailure: number
  readonly timeout: number
  readonly processCrash: number
  readonly notComparable: number
  readonly malformedRejected: number
  readonly malformedTimeout: number
  readonly malformedCrash: number
  readonly malformedAccepted: number
}
interface PureJsImageSnapshot {
  readonly packageVersion: string
  readonly gitCommit: string
  readonly dirty: boolean
}

interface ReportRecord {
  readonly engine: string
  readonly status: string
  readonly exact: boolean | null
  readonly rootMeanSquareError: number | null
}

interface ConformanceReport {
  readonly generatedAt: string
  readonly nodeVersion: string
  readonly platform: string
  readonly architecture: string
  readonly oracle: string
  readonly timeoutMs: number
  readonly memoryMb: number
  readonly directories: readonly string[]
  readonly purejsimage: PureJsImageSnapshot
  readonly versions: Readonly<Record<string, string>>
  readonly totals: ReadonlyMap<string, ReportTotal>
  readonly records: readonly ReportRecord[]
}

const reportPath = 'benchmark/results/tiff-competitor-conformance.json'
const readmePath = 'README.md'
const indexPath = 'docs-astro/src/pages/index.astro'
const tiffPath = 'docs-astro/src/pages/tiff.astro'
const comparisonPath = 'docs-astro/src/pages/tiff-comparison.astro'

const readmeStart = '<!-- library-comparison:readme:start -->'
const readmeEnd = '<!-- library-comparison:readme:end -->'
const indexStart = '<!-- library-comparison:index:start -->'
const indexEnd = '<!-- library-comparison:index:end -->'
const tiffStart = '<!-- library-comparison:tiff:start -->'
const tiffEnd = '<!-- library-comparison:tiff:end -->'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const recordOf = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

const stringOf = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}
const booleanOf = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

const numberOf = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

const nullableBooleanOf = (value: unknown, label: string): boolean | null =>
  value === null ? null : booleanOf(value, label)

const nullableNumberOf = (value: unknown, label: string): number | null =>
  value === null ? null : numberOf(value, label)

const stringArrayOf = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((entry, index) => stringOf(entry, `${label}[${index}]`))
}

const loadReport = async (): Promise<ConformanceReport> => {
  const root = recordOf(JSON.parse(await readFile(reportPath, 'utf8')), 'conformance report')
  if (numberOf(root.schemaVersion, 'schemaVersion') !== 3) {
    throw new Error('Unsupported TIFF competitor report schema')
  }
  const corpus = recordOf(root.corpus, 'corpus')
  const settings = recordOf(root.settings, 'settings')
  const pureJsImageSource = recordOf(root.purejsimage, 'purejsimage')
  const purejsimage: PureJsImageSnapshot = {
    packageVersion: stringOf(pureJsImageSource.packageVersion, 'purejsimage.packageVersion'),
    gitCommit: stringOf(pureJsImageSource.gitCommit, 'purejsimage.gitCommit'),
    dirty: booleanOf(pureJsImageSource.dirty, 'purejsimage.dirty'),
  }
  if (!/^[a-f0-9]{40}$/u.test(purejsimage.gitCommit)) {
    throw new Error('purejsimage.gitCommit must be a full Git commit')
  }
  const versionsSource = recordOf(root.versions, 'versions')
  const versions: Record<string, string> = {}
  for (const [engine, version] of Object.entries(versionsSource)) {
    versions[engine] = stringOf(version, `versions.${engine}`)
  }
  if (!Array.isArray(root.totals)) throw new Error('totals must be an array')
  const totals = new Map<string, ReportTotal>()
  for (const [index, entry] of root.totals.entries()) {
    const total = recordOf(entry, `totals[${index}]`)
    const parsed: ReportTotal = {
      engine: stringOf(total.engine, `totals[${index}].engine`),
      attempted: numberOf(total.attempted, `totals[${index}].attempted`),
      rgbaCompared: numberOf(total.rgbaCompared, `totals[${index}].rgbaCompared`),
      decoded: numberOf(total.decoded, `totals[${index}].decoded`),
      exact: numberOf(total.exact, `totals[${index}].exact`),
      mismatch: numberOf(total.mismatch, `totals[${index}].mismatch`),
      unsupported: numberOf(total.unsupported, `totals[${index}].unsupported`),
      error: numberOf(total.error, `totals[${index}].error`),
      oracleFailure: numberOf(total.oracleFailure, `totals[${index}].oracleFailure`),
      timeout: numberOf(total.timeout, `totals[${index}].timeout`),
      processCrash: numberOf(total.processCrash, `totals[${index}].processCrash`),
      notComparable: numberOf(total.notComparable, `totals[${index}].notComparable`),
      malformedRejected: numberOf(total.malformedRejected, `totals[${index}].malformedRejected`),
      malformedAccepted: numberOf(total.malformedAccepted, `totals[${index}].malformedAccepted`),
      malformedTimeout: numberOf(total.malformedTimeout, `totals[${index}].malformedTimeout`),
      malformedCrash: numberOf(total.malformedCrash, `totals[${index}].malformedCrash`),
    }
    if (totals.has(parsed.engine)) throw new Error(`Duplicate report engine ${parsed.engine}`)
    if (parsed.decoded !== parsed.exact + parsed.mismatch) {
      throw new Error(`${parsed.engine} decoded total is inconsistent`)
    }
    totals.set(parsed.engine, parsed)
  }
  if (!Array.isArray(root.records)) throw new Error('records must be an array')
  const records = root.records.map((entry, index): ReportRecord => {
    const record = recordOf(entry, `records[${index}]`)
    return {
      engine: stringOf(record.engine, `records[${index}].engine`),
      status: stringOf(record.status, `records[${index}].status`),
      exact: nullableBooleanOf(record.exact, `records[${index}].exact`),
      rootMeanSquareError: nullableNumberOf(
        record.rootMeanSquareError,
        `records[${index}].rootMeanSquareError`,
      ),
    }
  })
  return {
    generatedAt: stringOf(root.generatedAt, 'generatedAt'),
    nodeVersion: stringOf(root.nodeVersion, 'nodeVersion'),
    platform: stringOf(root.platform, 'platform'),
    architecture: stringOf(root.architecture, 'architecture'),
    oracle: stringOf(root.oracle, 'oracle'),
    timeoutMs: numberOf(settings.timeoutMs, 'settings.timeoutMs'),
    memoryMb: numberOf(settings.memoryMb, 'settings.memoryMb'),
    directories: stringArrayOf(corpus.directories, 'corpus.directories'),
    purejsimage,
    versions,
    totals,
    records,
  }
}

const packageVersion = (
  packages: Readonly<Record<string, unknown>>,
  packageName: string,
): string => {
  const packageEntry = recordOf(packages[`node_modules/${packageName}`], packageName)
  return stringOf(packageEntry.version, `${packageName} version`)
}

const capability = (library: LibraryComparison, key: TiffCapabilityKey): ComparisonValue =>
  library.tiff[key] ?? { status: 'unknown' }

const versionLabel = (library: LibraryComparison, report: ConformanceReport): string => {
  if (library.id !== 'purejsimage') return library.version
  const dirty = report.purejsimage.dirty ? ' · dirty' : ''
  return `benchmark snapshot · ${report.purejsimage.gitCommit.slice(0, 7)}${dirty}`
}

const comparisonMethodology = (report: ConformanceReport): readonly string[] => [
  'Capability claims come from versioned upstream documentation or inspected source. Unknown means not verified, not unsupported.',
  'The conformance harness uses pinned corpus files, isolated child processes, a fixed heap limit, a fixed timeout, and independent RGBA output.',
  `The PureJsImage row is a ${report.purejsimage.dirty ? 'dirty' : 'clean'} benchmark snapshot at commit ${report.purejsimage.gitCommit}; ${report.purejsimage.packageVersion} is package metadata, not a release claim. Other JavaScript rows are exact installed dev-dependency versions.`,
  'Signed, floating-point, wider-than-16-bit, and arbitrary-channel native rasters are not forced through an RGBA oracle.',
  'Oracle unavailable means the independent Sharp/ImageMagick ground-truth path could not decode that fixture. It is not a failure by the JavaScript engine, which is why every measured engine has the same two unavailable cases.',
  'Color-converted and lossy mismatches remain visible; exact equality is not used to claim one valid converter is universally better.',
  'Jimp uses utif2 for TIFF internally, so its matching aggregate TIFF outcomes are expected rather than duplicated measurements.',
]

const validateData = async (report: ConformanceReport): Promise<void> => {
  const libraryIds = new Set<string>()
  const evidenceIds = new Set<string>()
  for (const evidence of comparisonEvidence) {
    if (evidenceIds.has(evidence.id)) throw new Error(`Duplicate evidence id ${evidence.id}`)
    evidenceIds.add(evidence.id)
    if (!evidence.url.startsWith('https://')) {
      throw new Error(`Evidence URL is not HTTPS: ${evidence.id}`)
    }
  }
  const validateValue = (value: ComparisonValue, label: string): void => {
    if (value.status !== 'unknown' && value.evidence === undefined) {
      throw new Error(`${label} needs evidence`)
    }
    if (value.evidence !== undefined && !evidenceIds.has(value.evidence)) {
      throw new Error(`${label} references unknown evidence ${value.evidence}`)
    }
  }
  for (const library of libraryComparisons) {
    if (libraryIds.has(library.id)) throw new Error(`Duplicate library id ${library.id}`)
    libraryIds.add(library.id)
    for (const [key, value] of Object.entries(library.runtime)) {
      validateValue(value, `${library.id}.runtime.${key}`)
    }
    for (const group of tiffCapabilityGroups) {
      for (const [key] of group.features) {
        validateValue(capability(library, key), `${library.id}.${key}`)
      }
    }
    if (library.conformanceEngine === undefined) continue
    const total = report.totals.get(library.conformanceEngine)
    if (total === undefined) throw new Error(`Missing report engine ${library.conformanceEngine}`)
    const reportVersion =
      library.id === 'purejsimage'
        ? report.purejsimage.packageVersion
        : report.versions[library.conformanceEngine]
    if (reportVersion !== library.version) {
      throw new Error(
        `${library.id} version drift: data has ${library.version}, report has ${reportVersion ?? 'none'}`,
      )
    }
    if (total.attempted !== 154 || total.rgbaCompared !== 106 || total.notComparable !== 44) {
      throw new Error(`${library.id} report does not cover the pinned 154-file corpus split`)
    }
    if (
      total.malformedAccepted +
        total.malformedRejected +
        total.malformedTimeout +
        total.malformedCrash !==
      4
    ) {
      throw new Error(`${library.id} report does not cover all four malformed inputs`)
    }
  }
  const project = recordOf(JSON.parse(await readFile('package.json', 'utf8')), 'package.json')
  const projectVersion = stringOf(project.version, 'package version')
  const lock = recordOf(
    JSON.parse(await readFile('package-lock.json', 'utf8')),
    'package-lock.json',
  )
  const packages = recordOf(lock.packages, 'package-lock.json packages')
  for (const library of libraryComparisons) {
    const installed =
      library.id === 'purejsimage'
        ? projectVersion
        : library.packageName === null
          ? undefined
          : packageVersion(packages, library.packageName)
    if (installed !== undefined && installed !== library.version) {
      throw new Error(
        `${library.id} version drift: data has ${library.version}, installed version is ${installed}`,
      )
    }
  }
  if (report.timeoutMs !== 30_000 || report.memoryMb !== 512) {
    throw new Error('Conformance report must use the published 30 s / 512 MiB limits')
  }
  if (!report.directories.some((directory) => directory.endsWith('/robustness'))) {
    throw new Error('Conformance report is missing the malformed-input corpus')
  }
}

const statusLabel: Readonly<Record<ComparisonStatus, string>> = {
  yes: 'Yes',
  partial: 'Partial',
  no: 'No',
  unknown: 'Not verified',
}

const htmlEscape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const htmlValue = (value: ComparisonValue, detailed: boolean): string => {
  const evidence =
    value.evidence === undefined
      ? ''
      : ` <a href="#evidence-${htmlEscape(value.evidence)}" aria-label="Evidence ${htmlEscape(value.evidence)}">[source]</a>`
  const note =
    detailed && value.note !== undefined ? `<small>${htmlEscape(value.note)}</small>` : ''
  return `<span class="comparison-status status-${value.status}">${statusLabel[value.status]}</span>${note}${detailed ? evidence : ''}`
}

const combinedSemantics = (library: LibraryComparison): ComparisonValue => {
  const ome = capability(library, 'omeTiffSemantics')
  const wholeSlide = capability(library, 'wholeSlideSemantics')
  const evidence = ome.evidence ?? wholeSlide.evidence
  if (ome.status === 'yes' && wholeSlide.status === 'yes') {
    return { status: 'yes', ...(evidence === undefined ? {} : { evidence }) }
  }
  if (ome.status === 'no' && wholeSlide.status === 'no') {
    return { status: 'no', ...(evidence === undefined ? {} : { evidence }) }
  }
  if (ome.status === 'unknown' && wholeSlide.status === 'unknown') return { status: 'unknown' }
  return { status: 'partial', ...(evidence === undefined ? {} : { evidence }) }
}

const countLabel = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`

const conformanceFailures = (total: ReportTotal): string =>
  [
    total.unsupported === 0
      ? undefined
      : countLabel(total.unsupported, 'unsupported', 'unsupported'),
    total.error === 0 ? undefined : countLabel(total.error, 'error'),
    total.oracleFailure === 0
      ? undefined
      : countLabel(total.oracleFailure, 'oracle-unavailable case', 'oracle-unavailable cases'),
    total.timeout === 0 ? undefined : countLabel(total.timeout, 'timeout'),
    total.processCrash === 0 ? undefined : countLabel(total.processCrash, 'crash', 'crashes'),
  ]
    .filter((value): value is string => value !== undefined)
    .join(' · ')

const conformanceCell = (
  library: LibraryComparison,
  report: ConformanceReport,
  html: boolean,
): string => {
  if (library.conformanceEngine === undefined) return 'Not run'
  const total = report.totals.get(library.conformanceEngine)
  if (total === undefined) throw new Error(`Missing conformance total for ${library.id}`)
  const coverage = `${total.decoded}/${total.rgbaCompared} decoded`
  const exact = `${total.exact} exact`
  const mismatch = countLabel(total.mismatch, 'pixel mismatch', 'pixel mismatches')
  const failures = conformanceFailures(total)
  if (!html) return [coverage, exact, mismatch, failures].filter(Boolean).join('<br>')
  return `<strong>${coverage}</strong><small>${exact} · ${mismatch}</small>${failures.length === 0 ? '' : `<small>${htmlEscape(failures)}</small>`}`
}

const pureJsImagePsnrSummary = (report: ConformanceReport): string => {
  const mismatches = report.records.filter(
    (record) =>
      record.engine === 'purejsimage' &&
      record.status === 'success' &&
      record.exact === false &&
      record.rootMeanSquareError !== null &&
      record.rootMeanSquareError > 0,
  )
  const total = report.totals.get('purejsimage')
  if (total === undefined || mismatches.length !== total.mismatch) {
    throw new Error('PureJsImage mismatch records do not match the report total')
  }
  const psnr = mismatches.map(
    (record) => 20 * Math.log10(255 / (record.rootMeanSquareError ?? Number.NaN)),
  )
  const aboveForty = psnr.filter((value) => value >= 40).length
  const twentyToThirty = psnr.filter((value) => value >= 20 && value < 30).length
  const belowTen = psnr.filter((value) => value < 10).length
  if (aboveForty + twentyToThirty + belowTen !== psnr.length) {
    throw new Error('PureJsImage PSNR summary needs another displayed quality band')
  }
  return `${aboveForty} at or above 40 dB PSNR, ${twentyToThirty} from 20 to below 30 dB, and ${belowTen} below 10 dB`
}

const implementationLabel = (library: (typeof libraryComparisons)[number]): string =>
  library.id === 'purejsimage'
    ? 'Strict TypeScript'
    : library.implementation === 'pure-javascript'
      ? 'Pure JavaScript'
      : 'Native wrapper'

const compactMarkdown = (report: ConformanceReport): string => {
  const purejsimage = report.totals.get('purejsimage')
  if (purejsimage === undefined) throw new Error('Missing PureJsImage conformance total')
  return `${readmeStart}
<!-- Generated by scripts/render-library-comparison.ts. Do not edit this block. -->
### Historical TIFF conformance comparison

The checked ${report.generatedAt.slice(0, 10)} snapshot compared documented TIFF capabilities separately from independent RGBA output. PureJsImage decoded ${purejsimage.decoded}/${purejsimage.rgbaCompared} comparable display cases; ${purejsimage.exact} were exact and ${purejsimage.mismatch} had pixel differences. “Oracle unavailable” means the independent Sharp/ImageMagick path could not produce ground truth, not that an engine failed. Current performance headlines come from the newer generated benchmark index above.

[Full grouped capability matrix, methods, sources, and per-library results](https://purejsimage.com/tiff-comparison/)
${readmeEnd}`
}

const runtimeDependencySummary = (library: LibraryComparison): string => {
  if (library.id === 'purejsimage') return 'None'
  if (library.implementation === 'native-wrapper') return 'Native addon'
  return 'JavaScript package'
}

const wrapScrollableTable = (markup: string): string =>
  `<div class="comparison-table-wrap" data-table-wrap><p class="table-scroll-cue" data-scroll-cue hidden>Scroll table horizontally</p><div class="table-wrap-scroller" data-scroll-region="table">${markup}</div></div>`

const compactMobileSummary = (): string => {
  const cards = libraryComparisons
    .map((library) => {
      const rows = (
        [
          ['Pure TypeScript', statusLabel[library.runtime.pureJavaScript.status]],
          ['Runtime dependencies', runtimeDependencySummary(library)],
          ['Browser support', statusLabel[library.runtime.browser.status]],
          ['Native addon', statusLabel[library.runtime.nativeRequired.status]],
          ['Scientific readers', statusLabel[capability(library, 'nativeRasterOutput').status]],
          ['Bounded memory model', statusLabel[capability(library, 'boundedRegionDecode').status]],
        ] as const satisfies readonly (readonly [string, string])[]
      )
        .map(
          ([label, value]) =>
            `<div><dt>${htmlEscape(label)}</dt><dd>${htmlEscape(value)}</dd></div>`,
        )
        .join('')
      return `<li class="comparison-summary-card"><h3>${htmlEscape(library.name)}</h3><p>${htmlEscape(implementationLabel(library))}</p><dl>${rows}</dl></li>`
    })
    .join('')
  return `<div class="comparison-mobile-summary">
        <p class="comparison-summary-lede">The dimensions that matter first on a narrow screen. The complete TIFF matrix stays in this page and opens below.</p>
        <ul class="comparison-summary-list">${cards}</ul>
      </div>`
}

const compactHtml = (report: ConformanceReport, comparisonHref = 'tiff-comparison/'): string => {
  const rows = libraryComparisons
    .map(
      (library) =>
        `<tr><th scope="row"><a href="${htmlEscape(library.url)}" target="_blank" rel="noreferrer">${htmlEscape(library.name)}</a><small>${htmlEscape(versionLabel(library, report))} · ${implementationLabel(library)}</small></th><td>${htmlValue(library.runtime.browser, false)}</td><td>${htmlValue(capability(library, 'bigTiff'), false)}</td><td>${htmlValue(capability(library, 'tiles'), false)}</td><td>${htmlValue(capability(library, 'regionDecode'), false)}</td><td>${htmlValue(capability(library, 'nativeRasterOutput'), false)}</td><td>${htmlValue(combinedSemantics(library), false)}</td><td>${conformanceCell(library, report, true)}</td></tr>`,
    )
    .join('\n')
  return `<section class="section tint comparison-section" id="tiff-library-comparison">
      <div class="container">
        <div class="section-heading"><div><p class="section-label">Scientific and instrument imagery</p><h2>Native raster workflows beyond ordinary application images.</h2></div><a class="text-link" href="${comparisonHref}">TIFF demo and details →</a></div>
        <p class="comparison-intro">The codec and raster architecture is designed to grow across scientific instruments and research workflows. TIFF, OME microscopy, whole-slide pathology, and geospatial rasters are current examples. This table separates documented features from a 106-file image test of decode coverage and output.</p>
        ${compactMobileSummary()}
        <details class="comparison-matrix-disclosure" open>
          <summary>Full comparison matrix</summary>
          ${wrapScrollableTable(`<table class="comparison-table compact"><thead><tr><th>Library</th><th>Browser</th><th>BigTIFF</th><th>Tiles</th><th>Region</th><th>Scientific raster</th><th>OME / WSI</th><th>Decode coverage</th></tr></thead><tbody>${rows}</tbody></table>`)}
        </details>
        <p class="section-note"><strong>Oracle unavailable is not an engine failure:</strong> the independent Sharp/ImageMagick ground-truth path could not decode the same two fixtures for every measured engine. PureJsImage's ${report.totals.get('purejsimage')?.mismatch ?? 0} non-exact decodes comprise ${pureJsImagePsnrSummary(report)}, derived from recorded RMSE. Jimp uses utif2 for TIFF internally, so its matching aggregate outcomes are expected.</p>
        <p class="section-note">Measured ${htmlEscape(report.generatedAt.slice(0, 10))} with ${htmlEscape(report.nodeVersion)} on ${htmlEscape(report.platform)}/${htmlEscape(report.architecture)}. <a href="${comparisonHref}#methodology">Methods, caveats, versions, and sources.</a></p>
      </div>
    </section>`
}

const detailedMatrix = (report: ConformanceReport): string =>
  tiffCapabilityGroups
    .map((group) => {
      const rows = group.features
        .map(([key, label]) => {
          const cells = libraryComparisons
            .map((library) => `<td>${htmlValue(capability(library, key), true)}</td>`)
            .join('')
          return `<tr><th scope="row">${htmlEscape(label)}</th>${cells}</tr>`
        })
        .join('\n')
      const headers = libraryComparisons
        .map(
          (library) =>
            `<th>${htmlEscape(library.name)}<small>${htmlEscape(versionLabel(library, report))}</small></th>`,
        )
        .join('')
      return `<section class="comparison-group"><h3>${htmlEscape(group.name)}</h3>${wrapScrollableTable(`<table class="comparison-table"><thead><tr><th>Capability</th>${headers}</tr></thead><tbody>${rows}</tbody></table>`)}</section>`
    })
    .join('\n')

const conformanceTable = (report: ConformanceReport): string => {
  const rows = libraryComparisons
    .filter((library) => library.conformanceEngine !== undefined)
    .map((library) => {
      const total = report.totals.get(library.conformanceEngine ?? '')
      if (total === undefined) throw new Error(`Missing conformance total for ${library.id}`)
      return `<tr><th scope="row">${htmlEscape(library.name)}<small>${htmlEscape(versionLabel(library, report))}</small></th><td>${total.attempted}</td><td>${total.rgbaCompared}</td><td>${total.decoded}</td><td>${total.exact}</td><td>${total.mismatch}</td><td>${total.unsupported}</td><td>${total.error}</td><td>${total.oracleFailure}</td><td>${total.timeout}</td><td>${total.processCrash}</td><td>${total.notComparable}</td><td>${total.malformedRejected}</td><td>${total.malformedAccepted}</td><td>${total.malformedTimeout}</td><td>${total.malformedCrash}</td></tr>`
    })
    .join('\n')
  return wrapScrollableTable(
    `<table class="comparison-table conformance-table"><thead><tr><th>Library</th><th>Attempted</th><th>RGBA compared</th><th>Decoded</th><th>Exact</th><th>Mismatch</th><th>Unsupported</th><th>Error</th><th>Oracle unavailable</th><th>Timeout</th><th>Crash</th><th>Native raster</th><th>Malformed rejected</th><th>Malformed accepted</th><th>Malformed timeout</th><th>Malformed crash</th></tr></thead><tbody>${rows}</tbody></table>`,
  )
}

const conformanceSummaryTable = (report: ConformanceReport): string => {
  const rows = libraryComparisons
    .filter((library) => library.conformanceEngine !== undefined)
    .map((library) => {
      const total = report.totals.get(library.conformanceEngine ?? '')
      if (total === undefined) throw new Error(`Missing conformance total for ${library.id}`)
      return `<tr><th scope="row">${htmlEscape(library.name)}<small>${htmlEscape(versionLabel(library, report))}</small></th><td>${total.decoded} / ${total.rgbaCompared}</td><td>${total.exact}</td><td>${total.mismatch}</td><td>${total.unsupported} / ${total.error} / ${total.oracleFailure} / ${total.timeout} / ${total.processCrash}</td><td>${total.malformedRejected} rejected · ${total.malformedAccepted} accepted · ${total.malformedTimeout} timeout · ${total.malformedCrash} crash</td></tr>`
    })
    .join('\n')
  return wrapScrollableTable(
    `<table class="comparison-table compact"><thead><tr><th>Library</th><th>Decoded / comparable</th><th>Exact</th><th>Pixel mismatch</th><th>Unsupported / error / oracle unavailable / timeout / crash</th><th>Malformed inputs</th></tr></thead><tbody>${rows}</tbody></table>`,
  )
}

const evidenceList = (report: ConformanceReport): string =>
  [
    `<li><strong>PureJsImage conformance snapshot.</strong> <a href="https://github.com/a-r-d/PureJsImage/tree/${htmlEscape(report.purejsimage.gitCommit)}" target="_blank" rel="noreferrer">Main snapshot ${htmlEscape(report.purejsimage.gitCommit.slice(0, 7))}</a>; ${report.purejsimage.dirty ? 'dirty working tree' : 'clean working tree'}; unreleased; package metadata ${htmlEscape(report.purejsimage.packageVersion)}.</li>`,
    ...comparisonEvidence.map(
      (evidence) =>
        `<li id="evidence-${htmlEscape(evidence.id)}"><strong>${htmlEscape(evidence.label)}.</strong> <a href="${htmlEscape(evidence.url)}" target="_blank" rel="noreferrer">Source</a></li>`,
    ),
  ].join('\n')

const fullComparisonBody = (
  report: ConformanceReport,
): string => `<section class="section comparison-hero"><div class="container"><p class="eyebrow">Evidence-backed TIFF comparison</p><h1>JavaScript TIFF libraries compared by capability and measured output.</h1><p class="lede">Documentation claims and pixel conformance are separate signals. “Not verified” means exactly that; it does not mean “unsupported.”</p></div></section>
${compactHtml(report, './')}
<section class="section"><div class="container"><div class="section-heading"><div><p class="section-label">Capability matrix</p><h2>Grouped by TIFF workflow.</h2></div></div>${detailedMatrix(report)}</div></section>
<section class="section tint" id="conformance"><div class="container"><div class="section-heading"><div><p class="section-label">Reproducible corpus run</p><h2>Decode coverage, exact pixels, and reported outcomes.</h2></div><a class="text-link" href="https://github.com/a-r-d/PureJsImage/blob/main/benchmark/results/tiff-competitor-conformance.md" target="_blank" rel="noreferrer">Per-file report →</a></div><p class="comparison-intro">All six JavaScript engines were attempted in isolated child processes on 154 pinned files. The 106 display-image cases use ${htmlEscape(report.oracle)} as the independent raw-RGBA8 oracle; decoded coverage is primary, while exact means every compared channel matched. Oracle unavailable means that independent ground truth could not be produced, not that the engine failed. Forty-four native scientific rasters are not forced through RGBA. Four malformed files test bounded rejection separately.</p>${conformanceTable(report)}</div></section>
<section class="section" id="methodology"><div class="container prose"><p class="section-label">Methodology</p><h2>What these numbers do and do not mean.</h2><ul>${comparisonMethodology(
  report,
)
  .map((item) => `<li>${htmlEscape(item)}</li>`)
  .join(
    '',
  )}<li>Run limits: ${report.timeoutMs / 1000} seconds and ${report.memoryMb} MiB per child process, concurrency 2.</li><li>Environment: ${htmlEscape(report.nodeVersion)}, ${htmlEscape(report.platform)}/${htmlEscape(report.architecture)}; report generated ${htmlEscape(report.generatedAt)}.</li><li>Corpus directories: ${report.directories.map(htmlEscape).join(', ')}.</li></ul><p>A mismatch in a color-converted or lossy case is visible but is not automatically a decoder defect: compliant converters can differ in rounding, chroma reconstruction, ICC handling, and codec output. Native scientific rasters are reported by type rather than normalized into misleading RGBA. Malformed-input results are separated from valid-file support.</p></div></section>
<section class="section tint"><div class="container prose"><p class="section-label">Sources</p><h2>Versioned evidence</h2><ol class="comparison-evidence">${evidenceList(report)}</ol><h3>Excluded or historical libraries</h3><ul>${excludedTiffLibraries.map((library) => `<li><a href="${htmlEscape(library.url)}" target="_blank" rel="noreferrer"><strong>${htmlEscape(library.name)}</strong></a>: ${htmlEscape(library.reason)}</li>`).join('')}</ul></div></section>`

const page = (report: ConformanceReport): string => `---
import SiteLayout from '../layouts/SiteLayout.astro'
---

<SiteLayout title="TIFF library comparison | PureJsImage" description="Evidence-backed JavaScript TIFF library capability, decode-coverage, and exact-pixel comparison." canonical="https://purejsimage.com/tiff-comparison/" current="codecs/">
<main id="main">${fullComparisonBody(report)}</main>
</SiteLayout>
`

const replaceGenerated = (
  source: string,
  start: string,
  end: string,
  generated: string,
  path: string,
): string => {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end)
  if (startIndex < 0 || endIndex < startIndex)
    throw new Error(`Missing generated markers in ${path}`)
  if (
    source.indexOf(start, startIndex + start.length) >= 0 ||
    source.indexOf(end, endIndex + end.length) >= 0
  ) {
    throw new Error(`Duplicate generated markers in ${path}`)
  }
  return `${source.slice(0, startIndex)}${generated}${source.slice(endIndex + end.length)}`
}

const updateFile = async (path: string, expected: string, check: boolean): Promise<void> => {
  if (check) {
    const actual = await readFile(path, 'utf8').catch(() => '')
    if (actual !== expected) throw new Error(`${path} is stale; run npm run comparison:generate`)
    return
  }
  await writeFile(path, expected)
}

const main = async (): Promise<void> => {
  const check = process.argv.includes('--check')
  const report = await loadReport()
  await validateData(report)
  const readme = await readFile(readmePath, 'utf8')
  const index = await readFile(indexPath, 'utf8')
  const tiff = await readFile(tiffPath, 'utf8')
  await updateFile(
    readmePath,
    replaceGenerated(readme, readmeStart, readmeEnd, compactMarkdown(report), readmePath),
    check,
  )
  await updateFile(
    indexPath,
    replaceGenerated(
      index,
      indexStart,
      indexEnd,
      `${indexStart}\n    ${compactHtml(report)}\n    ${indexEnd}`,
      indexPath,
    ),
    check,
  )
  const tiffSection = `${tiffStart}\n        <section id="library-comparison" data-search-item><h2>JavaScript TIFF library comparison</h2><p>The compact matrix distinguishes documented capability from independently measured decode coverage and exact pixels. “Not verified” is not treated as unsupported.</p>${conformanceSummaryTable(report)}<p><a href="../tiff-comparison/">Open the full grouped capability matrix, methodology, versions, and sources →</a></p></section>\n        ${tiffEnd}`
  await updateFile(
    tiffPath,
    replaceGenerated(tiff, tiffStart, tiffEnd, tiffSection, tiffPath),
    check,
  )
  await updateFile(comparisonPath, page(report), check)
}

await main()
