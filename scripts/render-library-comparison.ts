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
} from '../docs/data/library-comparison.ts'

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

interface ConformanceReport {
  readonly generatedAt: string
  readonly nodeVersion: string
  readonly platform: string
  readonly architecture: string
  readonly oracle: string
  readonly timeoutMs: number
  readonly memoryMb: number
  readonly directories: readonly string[]
  readonly versions: Readonly<Record<string, string>>
  readonly totals: ReadonlyMap<string, ReportTotal>
}

const reportPath = 'benchmark/results/tiff-competitor-conformance.json'
const readmePath = 'README.md'
const indexPath = 'docs/index.html'
const tiffPath = 'docs/tiff.html'
const comparisonPath = 'docs/tiff-comparison.html'

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

const numberOf = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

const stringArrayOf = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((entry, index) => stringOf(entry, `${label}[${index}]`))
}

const loadReport = async (): Promise<ConformanceReport> => {
  const root = recordOf(JSON.parse(await readFile(reportPath, 'utf8')), 'conformance report')
  if (numberOf(root.schemaVersion, 'schemaVersion') !== 2) {
    throw new Error('Unsupported TIFF competitor report schema')
  }
  const corpus = recordOf(root.corpus, 'corpus')
  const settings = recordOf(root.settings, 'settings')
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
  return {
    generatedAt: stringOf(root.generatedAt, 'generatedAt'),
    nodeVersion: stringOf(root.nodeVersion, 'nodeVersion'),
    platform: stringOf(root.platform, 'platform'),
    architecture: stringOf(root.architecture, 'architecture'),
    oracle: stringOf(root.oracle, 'oracle'),
    timeoutMs: numberOf(settings.timeoutMs, 'settings.timeoutMs'),
    memoryMb: numberOf(settings.memoryMb, 'settings.memoryMb'),
    directories: stringArrayOf(corpus.directories, 'corpus.directories'),
    versions,
    totals,
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

const versionLabel = (library: LibraryComparison): string =>
  library.id === 'purejsimage' ? `${library.version} workspace` : library.version

const comparisonMethodology = [
  'Capability claims come from versioned upstream documentation or inspected source. Unknown means not verified, not unsupported.',
  'The conformance harness uses pinned corpus files, isolated child processes, a fixed heap limit, a fixed timeout, and independent RGBA output.',
  'The PureJsImage row is the current workspace at its package version; other JavaScript rows are the exact installed dev-dependency versions.',
  'Signed, floating-point, wider-than-16-bit, and arbitrary-channel native rasters are not forced through an RGBA oracle.',
  'Color-converted and lossy mismatches remain visible; exact equality is not used to claim one valid converter is universally better.',
] as const

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
    const reportVersion = report.versions[library.conformanceEngine]
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

const markdownValue = (value: ComparisonValue): string => statusLabel[value.status]

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

const conformanceCell = (
  library: LibraryComparison,
  report: ConformanceReport,
  html: boolean,
): string => {
  if (library.conformanceEngine === undefined) return 'Not run'
  const total = report.totals.get(library.conformanceEngine)
  if (total === undefined) throw new Error(`Missing conformance total for ${library.id}`)
  const text = `${total.exact}/${total.rgbaCompared} exact; malformed ${total.malformedRejected} rejected, ${total.malformedAccepted} accepted, ${total.malformedTimeout} timeout, ${total.malformedCrash} crash`
  return html ? htmlEscape(text) : text
}

const compactMarkdown = (report: ConformanceReport): string => {
  const rows = libraryComparisons
    .map(
      (library) =>
        `| ${library.name} ${versionLabel(library)} | ${library.implementation === 'pure-javascript' ? 'Pure JavaScript' : 'Native wrapper'} | ${markdownValue(library.runtime.browser)} | ${markdownValue(capability(library, 'bigTiff'))} | ${markdownValue(capability(library, 'tiles'))} | ${markdownValue(capability(library, 'regionDecode'))} | ${markdownValue(capability(library, 'nativeRasterOutput'))} | ${markdownValue(combinedSemantics(library))} | ${conformanceCell(library, report, false)} |`,
    )
    .join('\n')
  return `${readmeStart}
<!-- Generated by scripts/render-library-comparison.ts. Do not edit this block. -->
### TIFF library comparison

A capability is **Yes** only when upstream documentation or source supports it; the conformance column is measured separately against independent RGBA output. “Not verified” is not treated as unsupported.

| Library | Runtime model | Browser | BigTIFF | Tiles | Region decode | Native scientific raster | OME / whole-slide semantics | Exact conformance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

[Full grouped capability matrix, methods, sources, and per-library results](https://a-r-d.github.io/PureJsImage/tiff-comparison.html)
${readmeEnd}`
}

const compactHtml = (report: ConformanceReport): string => {
  const rows = libraryComparisons
    .map(
      (library) =>
        `<tr><th scope="row"><a href="${htmlEscape(library.url)}" target="_blank" rel="noreferrer">${htmlEscape(library.name)}</a><small>${htmlEscape(versionLabel(library))} · ${library.implementation === 'pure-javascript' ? 'Pure JavaScript' : 'Native wrapper'}</small></th><td>${htmlValue(library.runtime.browser, false)}</td><td>${htmlValue(capability(library, 'bigTiff'), false)}</td><td>${htmlValue(capability(library, 'tiles'), false)}</td><td>${htmlValue(capability(library, 'regionDecode'), false)}</td><td>${htmlValue(capability(library, 'nativeRasterOutput'), false)}</td><td>${htmlValue(combinedSemantics(library), false)}</td><td>${conformanceCell(library, report, true)}</td></tr>`,
    )
    .join('\n')
  return `<section class="section tint comparison-section" id="tiff-library-comparison">
      <div class="container">
        <div class="section-heading"><div><p class="section-label">Measured compatibility</p><h2>TIFF support, without collapsing every claim to yes or no.</h2></div><a class="text-link" href="tiff-comparison.html">Full comparison →</a></div>
        <p class="comparison-intro">Capability cells follow upstream documentation or source. Exact conformance is a separate 106-fixture RGBA comparison; scientific rasters and malformed inputs are reported separately.</p>
        <div class="comparison-table-wrap"><table class="comparison-table compact"><thead><tr><th>Library</th><th>Browser</th><th>BigTIFF</th><th>Tiles</th><th>Region</th><th>Scientific raster</th><th>OME / WSI</th><th>Exact / malformed</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="section-note">Measured ${htmlEscape(report.generatedAt.slice(0, 10))} with ${htmlEscape(report.nodeVersion)} on ${htmlEscape(report.platform)}/${htmlEscape(report.architecture)}. <a href="tiff-comparison.html#methodology">Methodology, caveats, versions, and evidence.</a></p>
      </div>
    </section>`
}

const detailedMatrix = (): string =>
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
            `<th>${htmlEscape(library.name)}<small>${htmlEscape(versionLabel(library))}</small></th>`,
        )
        .join('')
      return `<section class="comparison-group"><h3>${htmlEscape(group.name)}</h3><div class="comparison-table-wrap"><table class="comparison-table"><thead><tr><th>Capability</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div></section>`
    })
    .join('\n')

const conformanceTable = (report: ConformanceReport): string => {
  const rows = libraryComparisons
    .filter((library) => library.conformanceEngine !== undefined)
    .map((library) => {
      const total = report.totals.get(library.conformanceEngine ?? '')
      if (total === undefined) throw new Error(`Missing conformance total for ${library.id}`)
      return `<tr><th scope="row">${htmlEscape(library.name)}<small>${htmlEscape(versionLabel(library))}</small></th><td>${total.attempted}</td><td>${total.rgbaCompared}</td><td>${total.decoded}</td><td>${total.exact}</td><td>${total.mismatch}</td><td>${total.unsupported}</td><td>${total.error}</td><td>${total.oracleFailure}</td><td>${total.timeout}</td><td>${total.processCrash}</td><td>${total.notComparable}</td><td>${total.malformedRejected}</td><td>${total.malformedAccepted}</td><td>${total.malformedTimeout}</td><td>${total.malformedCrash}</td></tr>`
    })
    .join('\n')
  return `<div class="comparison-table-wrap"><table class="comparison-table conformance-table"><thead><tr><th>Library</th><th>Attempted</th><th>RGBA compared</th><th>Decoded</th><th>Exact</th><th>Mismatch</th><th>Unsupported</th><th>Error</th><th>Oracle failure</th><th>Timeout</th><th>Crash</th><th>Native raster</th><th>Malformed rejected</th><th>Malformed accepted</th><th>Malformed timeout</th><th>Malformed crash</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

const conformanceSummaryTable = (report: ConformanceReport): string => {
  const rows = libraryComparisons
    .filter((library) => library.conformanceEngine !== undefined)
    .map((library) => {
      const total = report.totals.get(library.conformanceEngine ?? '')
      if (total === undefined) throw new Error(`Missing conformance total for ${library.id}`)
      return `<tr><th scope="row">${htmlEscape(library.name)}<small>${htmlEscape(versionLabel(library))}</small></th><td>${total.exact} / ${total.rgbaCompared}</td><td>${total.mismatch}</td><td>${total.unsupported} / ${total.error} / ${total.timeout} / ${total.processCrash}</td><td>${total.malformedRejected} rejected · ${total.malformedAccepted} accepted · ${total.malformedTimeout} timeout · ${total.malformedCrash} crash</td></tr>`
    })
    .join('\n')
  return `<div class="comparison-table-wrap"><table class="comparison-table compact"><thead><tr><th>Library</th><th>Exact / compared</th><th>Pixel mismatch</th><th>Unsupported / error / timeout / crash</th><th>Malformed inputs</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

const evidenceList = (): string =>
  comparisonEvidence
    .map(
      (evidence) =>
        `<li id="evidence-${htmlEscape(evidence.id)}"><strong>${htmlEscape(evidence.label)}.</strong> <a href="${htmlEscape(evidence.url)}" target="_blank" rel="noreferrer">Source</a></li>`,
    )
    .join('\n')

const fullComparisonBody = (
  report: ConformanceReport,
): string => `<section class="section comparison-hero"><div class="container"><p class="eyebrow">Evidence-backed TIFF comparison</p><h1>JavaScript TIFF libraries compared by capability and measured output.</h1><p class="lede">Documentation claims and pixel conformance are separate signals. “Not verified” means exactly that—not “unsupported.”</p></div></section>
${compactHtml(report)}
<section class="section"><div class="container"><div class="section-heading"><div><p class="section-label">Capability matrix</p><h2>Grouped by TIFF workflow.</h2></div></div>${detailedMatrix()}</div></section>
<section class="section tint" id="conformance"><div class="container"><div class="section-heading"><div><p class="section-label">Reproducible corpus run</p><h2>Exact pixels, failures, and malformed-input behavior.</h2></div><a class="text-link" href="https://github.com/a-r-d/PureJsImage/blob/main/benchmark/results/tiff-competitor-conformance.md" target="_blank" rel="noreferrer">Per-file report →</a></div><p class="comparison-intro">All six JavaScript engines were attempted in isolated child processes on 154 pinned files. The 106 display-image cases use ${htmlEscape(report.oracle)} as the independent raw-RGBA8 oracle; exact means every compared channel matched. Forty-four native scientific rasters are not forced through RGBA. Four malformed files test bounded rejection separately.</p>${conformanceTable(report)}</div></section>
<section class="section" id="methodology"><div class="container prose"><p class="section-label">Methodology</p><h2>What these numbers do—and do not—mean.</h2><ul>${comparisonMethodology.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}<li>Run limits: ${report.timeoutMs / 1000} seconds and ${report.memoryMb} MiB per child process, concurrency 2.</li><li>Environment: ${htmlEscape(report.nodeVersion)}, ${htmlEscape(report.platform)}/${htmlEscape(report.architecture)}; report generated ${htmlEscape(report.generatedAt)}.</li><li>Corpus directories: ${report.directories.map(htmlEscape).join(', ')}.</li></ul><p>A mismatch in a color-converted or lossy case is visible but is not automatically a decoder defect: compliant converters can differ in rounding, chroma reconstruction, ICC handling, or JPEG output. The raw report preserves those files and deltas rather than hiding them.</p></div></section>
<section class="section tint"><div class="container prose"><p class="section-label">Sources</p><h2>Versioned evidence</h2><ol class="comparison-evidence">${evidenceList()}</ol><h3>Excluded or historical libraries</h3><ul>${excludedTiffLibraries.map((library) => `<li><a href="${htmlEscape(library.url)}" target="_blank" rel="noreferrer"><strong>${htmlEscape(library.name)}</strong></a>: ${htmlEscape(library.reason)}</li>`).join('')}</ul></div></section>`

const page = (report: ConformanceReport): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Evidence-backed JavaScript TIFF library capability and exact-pixel conformance comparison.">
  <meta name="theme-color" content="#f6f7f2">
  <link rel="canonical" href="https://a-r-d.github.io/PureJsImage/tiff-comparison.html">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="styles.css">
  <title>TIFF library comparison — PureJsImage</title>
  <script>document.documentElement.dataset.theme=localStorage.getItem('purejsimage-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')</script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><div class="container header-inner">
    <a class="brand" href="index.html" aria-label="PureJsImage home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span>PureJsImage</span></a>
    <nav class="site-nav" data-nav aria-label="Primary navigation"><a href="demo.html">Demo</a><a href="guides.html">Guides</a><a href="api.html">API</a><a href="codecs.html" aria-current="page">Codecs</a><a href="performance.html">Performance</a><a href="contributing.html">Contribute</a></nav>
    <div class="header-actions"><button class="icon-button" type="button" data-theme-toggle aria-label="Use dark theme"></button><a class="button secondary small github-header" href="https://github.com/a-r-d/PureJsImage" target="_blank" rel="noreferrer">GitHub</a><button class="icon-button menu-button" type="button" data-menu-toggle aria-label="Open navigation" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"/></svg></button></div>
  </div></header>
  <main id="main">${fullComparisonBody(report)}</main>
  <footer class="site-footer"><div class="container"><div class="footer-grid"><div class="footer-intro"><a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span>PureJsImage</span></a><p>MIT-licensed image codecs and processing in strict TypeScript.</p></div><div class="footer-column"><strong>Documentation</strong><a href="guides.html">Getting started</a><a href="api.html">API reference</a><a href="codecs.html">Codec support</a><a href="tiff.html">TIFF guide</a></div><div class="footer-column"><strong>Project</strong><a href="https://github.com/a-r-d/PureJsImage" target="_blank" rel="noreferrer">GitHub</a><a href="https://www.npmjs.com/package/purejsimage" target="_blank" rel="noreferrer">npm</a><a href="https://github.com/a-r-d/PureJsImage/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer">Changelog</a></div></div><div class="footer-bottom"><span>© 2026 Aaron Decker and PureJsImage contributors.</span><span>Default reference engine · pure TypeScript · zero runtime dependencies</span></div></div></footer>
  <script src="site.js" defer></script>
</body>
</html>
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
  const tiffSection = `${tiffStart}\n        <section id="library-comparison" data-search-item><h2>JavaScript TIFF library comparison</h2><p>The compact matrix distinguishes documented capability from independently measured exact-pixel conformance. “Not verified” is not treated as unsupported.</p>${conformanceSummaryTable(report)}<p><a href="tiff-comparison.html">Open the full grouped capability matrix, methodology, versions, and sources →</a></p></section>\n        ${tiffEnd}`
  await updateFile(
    tiffPath,
    replaceGenerated(tiff, tiffStart, tiffEnd, tiffSection, tiffPath),
    check,
  )
  await updateFile(comparisonPath, page(report), check)
}

await main()
