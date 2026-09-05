import holdoutManifest from './production-program/pr35-holdout-manifest.json' with { type: 'json' }
import smallJpegManifest from './production-program/pr35-small-jpeg-manifest.json' with {
  type: 'json',
}
import conformanceManifest from './production-program/corpora/conformance.json' with {
  type: 'json',
}
import remediationManifest from '../../tests/fixtures/jpegxl/remediation/manifest.json' with {
  type: 'json',
}
export const evidenceFiles = {
  remediationFixtures: 'remediation-fixtures.json',
  holdout: 'holdout.json',
  smallJpeg: 'small-jpeg-holdout.json',
  encoder: 'encoder.json',
  reverse: 'reverse.json',
  compression1: 'compression-1.json',
  compression7: 'compression-7.json',
  benchmark: 'benchmark.json',
  modularMemory: 'memory.json',
  varDctMemory: 'vardct-memory.json',
  encoderMemory: 'encoder-memory.json',
  conformance: 'conformance.json',
  color: 'm4-conformance.json',
  pipelines: 'm5-pipelines.json',
  realJpeg: 'm1-real.json',
  commonStatic: 'm3-common-static.json',
  commonPipelines: 'm5-common-static.json',
} as const
export type EvidenceGate = keyof typeof evidenceFiles
export const extendedGates: readonly EvidenceGate[] = [
  'realJpeg',
  'commonStatic',
  'commonPipelines',
]
type RecordValue = Readonly<Record<string, unknown>>
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): RecordValue => {
  if (!isRecord(value)) throw new Error('Expected evidence object')
  return value
}
const requireCondition = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}
const rows = (value: unknown, minimum = 1): readonly RecordValue[] => {
  if (!Array.isArray(value) || value.length < minimum)
    throw new Error(`Expected at least ${minimum} evidence rows`)
  return value.map(record)
}
const finite = (value: unknown, minimum = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum)
    throw new Error('Invalid evidence measurement')
  return value
}
const sha = (value: unknown): void =>
  requireCondition(
    typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
    'Missing evidence checksum',
  )
const allPassed = (value: unknown, keys: readonly string[]): void => {
  const gates = record(value)
  for (const key of keys) requireCondition(gates[key] === true, `Gate ${key} did not pass`)
  for (const passed of Object.values(gates))
    requireCondition(passed === true, 'Failed or malformed gate')
}
const tolerance = (
  row: RecordValue,
  maxName = 'maximumError',
  rmseName = 'rmse',
  maximum = 1,
  rmse = 0.55,
): void => {
  requireCondition(
    finite(row[maxName]) <= maximum && finite(row[rmseName]) <= rmse,
    'Pixel tolerance gate failed',
  )
}

/** Validate raw outcomes before deriving any capability status. A matching SHA alone is insufficient. */
export const validateEvidenceReport = (
  gate: EvidenceGate,
  value: unknown,
  revision: string,
): number => {
  const report = record(value)
  requireCondition(
    /^[0-9a-f]{40}$/.test(revision) && report.revision === revision,
    `${gate}: evidence revision mismatch`,
  )
  requireCondition(
    report.schemaVersion === (gate === 'reverse' ? 3 : gate === 'encoderMemory' ? 2 : 1),
    `${gate}: unknown schema version`,
  )
  switch (gate) {
    case 'remediationFixtures': {
      requireCondition(report.passed === true, 'Remediation fixture oracle failed')
      const results = rows(report.results, 9)
      requireCondition(results.length === 9, 'Remediation fixture count changed')
      requireCondition(
        report.oracleRevision === remediationManifest.libjxlRevision,
        'Wrong remediation oracle',
      )
      for (const expected of remediationManifest.cases) {
        const matches = results.filter((row) => row.id === expected.id)
        requireCondition(
          matches.length === 1 &&
            matches[0]?.inputSha256 === expected.sha256 &&
            matches[0]?.pixelsSha256 === expected.pixelsSha256,
          'Remediation fixture or reference changed',
        )
      }
      for (const row of results) {
        sha(row.inputSha256)
        sha(row.pixelsSha256)
        requireCondition(
          row.passed === true && finite(row.maximumError) <= 1e-7,
          'Remediation independent sample failure',
        )
      }
      return results.length
    }
    case 'holdout':
    case 'smallJpeg': {
      requireCondition(record(report.validation).passed === true, 'Holdout correctness failed')
      const manifest = gate === 'holdout' ? holdoutManifest : smallJpegManifest
      const results = rows(report.results, manifest.cases.length)
      requireCondition(results.length === manifest.cases.length, 'Holdout cases changed')
      for (const entry of manifest.cases) {
        const matches = results.filter((row) => row.id === entry.id),
          row = matches[0]
        requireCondition(
          matches.length === 1 && row !== undefined,
          'Holdout case missing or duplicated',
        )
        if (!row) throw new Error('Missing holdout')
        requireCondition(
          row.sourceSha256 === entry.sha256 &&
            row.width === entry.sourceWidth &&
            row.height === entry.sourceHeight,
          'Holdout source or dimensions changed',
        )
        const outputs = rows(row.results, 2)
        requireCondition(
          outputs.length === 2 &&
            outputs.some((output) => output.effort === 1) &&
            outputs.some((output) => output.effort === 7),
          'Holdout effort missing',
        )
        for (const output of outputs) {
          requireCondition(
            output.exactNativeSamples === true && output.managedLiveBytes === 0,
            'Holdout pixels or cleanup failed',
          )
          sha(output.outputSha256)
          finite(output.bytes, 1)
          finite(output.ratioToPng, 0)
          finite(output.ratioToLibjxl, 0)
        }
        const jpeg = record(row.exactJpeg)
        const jpegInput = /\.jpe?g$/i.test(entry.path)
        requireCondition(
          (!jpegInput && jpeg.status === 'not-applicable') ||
            (jpeg.status === 'encoded' && jpeg.byteExact === true) ||
            (gate !== 'smallJpeg' &&
              jpegInput &&
              jpeg.status === 'rejected' &&
              record(jpeg.eligibility).eligible === false),
          'Unexpected holdout JPEG failure',
        )
      }
      return results.length
    }
    case 'encoder': {
      requireCondition(
        report.validation === 'exact native samples',
        'Encoder exactness policy missing',
      )
      const cases = rows(report.cases, 150)
      for (const effort of [1, 3, 5, 7])
        requireCondition(
          cases.some((row) => row.effort === effort),
          `Missing effort ${effort}`,
        )
      for (const format of ['gray8', 'gray16', 'rgb8', 'rgb16', 'rgba8', 'rgba16'])
        for (const effort of [1, 3, 5, 7])
          requireCondition(
            cases.some((row) => row.format === format && row.effort === effort),
            `Missing format ${format} at effort ${effort}`,
          )
      for (const row of cases) {
        sha(row.inputSha256)
        sha(row.outputSha256)
        finite(row.outputBytes, 1)
        const decoders = record(row.decoders)
        for (const name of ['djxl', 'jxl-rs', 'jxl-oxide']) {
          const decoder = record(decoders[name])
          sha(decoder.outputSha256)
          requireCondition(
            decoder.status === 'exact-native-samples' ||
              (name === 'jxl-oxide' &&
                row.sampleBitDepth === 16 &&
                decoder.status === 'pinned-decoder-limitation-signed-16-bit-modular'),
            `${name} failed exact pixels`,
          )
        }
      }
      return cases.length
    }
    case 'reverse':
    case 'realJpeg': {
      if (gate === 'reverse')
        requireCondition(record(report.validation).passed === true, 'Reverse exactness gate failed')
      const results = rows(report.results, gate === 'realJpeg' ? 250 : 10)
      for (const row of results) {
        sha(row.sourceSha256)
        sha(row.reconstructedSha256)
        requireCondition(
          row.exact === true && row.sourceSha256 === row.reconstructedSha256,
          'JPEG bytes are not exact',
        )
      }
      if (gate === 'realJpeg') {
        const acceptance = record(report.milestone1CompressionGate)
        requireCondition(
          acceptance.passed === true &&
            acceptance.exactCases === results.length &&
            acceptance.totalCases === results.length,
          'Real JPEG promotion gate failed',
        )
        requireCondition(
          finite(acceptance.smallerRate) >= 0.9 &&
            finite(acceptance.medianSavingsPercentage) >= 12 &&
            finite(acceptance.p10SavingsPercentage) >= 0 &&
            finite(acceptance.medianRatioToLibjxl) <= 1.1 &&
            finite(acceptance.p90RatioToLibjxl) <= 1.2,
          'Real JPEG size criteria failed',
        )
        requireCondition(
          Array.isArray(acceptance.unexplainedOutliers) &&
            acceptance.unexplainedOutliers.length === 0,
          'Unexplained JPEG outliers',
        )
      }
      return results.length
    }
    case 'compression1':
    case 'compression7': {
      const effort = gate === 'compression1' ? 1 : 7
      requireCondition(
        report.effort === effort && report.status === 'milestone-thresholds-passed',
        'Compression status or effort mismatch',
      )
      const files = rows(report.files, 150)
      allPassed(
        report.gates,
        effort === 1
          ? ['corpusAtLeast150', 'medianSizeVsLibjxl', 'medianSpeedVsLibjxl']
          : [
              'corpusAtLeast150',
              'medianSizeVsLibjxl',
              'p90SizeVsLibjxl',
              'noUnexplainedOutlier',
              'medianAtLeast10PercentSmallerThanPng',
              'atLeast75PercentNoLargerThanPng',
              'everyClassMedianVsPng',
              'medianSpeedVsLibjxl',
            ],
      )
      for (const file of files) {
        const encoders = record(file.encoders)
        for (const name of ['pureJsImage', `libjxlEffort${effort}`, 'png']) {
          const encoded = record(encoders[name])
          requireCondition(encoded.exactNativeSamples === true, 'Compression result is not exact')
          finite(encoded.bytes, 1)
          finite(encoded.milliseconds)
        }
      }
      requireCondition(
        record(report.metrics).corpusCases === files.length,
        'Compression case count mismatch',
      )
      const metrics = record(report.metrics)
      const size = record(metrics.ratioToLibjxl)
      const speed = record(metrics.speedRatioToLibjxl)
      requireCondition(
        finite(size.median) <= (effort === 1 ? 1.4 : 1.25) &&
          finite(speed.median) <= (effort === 1 ? 5 : 15),
        'Compression measurements exceed declared thresholds',
      )
      if (effort === 7) {
        const png = record(metrics.ratioToPng)
        const classes = record(png.byClassMedian)
        requireCondition(
          finite(size.p90) <= 1.4 &&
            finite(size.worst) <= 1.75 &&
            finite(png.median) <= 0.9 &&
            finite(png.noLargerFraction) >= 0.75 &&
            finite(png.noLargerFraction) <= 1 &&
            Object.keys(classes).length === 12 &&
            Object.values(classes).every((value) => finite(value) <= 1.5),
          'Effort-7 measured size criteria failed',
        )
      }
      return files.length
    }
    case 'benchmark':
    case 'modularMemory':
    case 'varDctMemory': {
      requireCondition(
        record(report.validation).passed === true,
        'Correctness gate missing or failed',
      )
      const summaries = rows(report.summaries)
      for (const row of summaries) {
        sha(row.inputSha256)
        if (row.validation !== 'preflight-rejection') sha(row.outputSha256)
        finite(row.medianWallMilliseconds)
        if (gate === 'varDctMemory') {
          if (row.validation === 'preflight-rejection')
            requireCondition(row.rejectionCode === 'LIMIT_EXCEEDED', 'Wrong preflight rejection')
          else {
            requireCondition(row.validation === 'tolerance-pixels', 'Missing VarDCT validation')
            tolerance(row, 'maximumError', 'rmse', 1, 0.5)
          }
        }
      }
      if (gate === 'benchmark') {
        const oracle = record(record(report.validation).independentOracle)
        requireCondition(
          oracle.available === true && oracle.exactPixels === true,
          'Independent benchmark oracle missing',
        )
      }
      return summaries.length
    }
    case 'encoderMemory': {
      requireCondition(
        record(report.validation).passed === true,
        'Encoder memory correctness missing',
      )
      const results = rows(report.results, 16)
      for (const row of results) {
        sha(row.sha256)
        requireCondition(
          row.independentExactPixels === true,
          'Encoder memory independent pixels missing',
        )
        const managed = record(row.managed)
        requireCondition(managed.live === 0 && managed.allocations === 0, 'Encoder allocation leak')
        requireCondition(
          finite(managed.peak, 1) >= finite(row.inputBytes, 1),
          'Encoder peak omits input',
        )
        finite(row.absolutePeakRssBytes, 1)
        finite(row.milliseconds)
      }
      for (const effort of [1, 3, 5, 7])
        for (const mode of ['cold', 'warm'])
          for (const width of [512, 6000])
            requireCondition(
              results.some(
                (row) => row.effort === effort && row.mode === mode && row.width === width,
              ),
              'Missing encoder memory workload',
            )
      return results.length
    }
    case 'conformance': {
      const results = rows(report.results, conformanceManifest.cases.length)
      requireCondition(
        report.baselineMatched === true &&
          report.cases === results.length &&
          results.length === conformanceManifest.cases.length &&
          report.corpusRevision === conformanceManifest.revision &&
          report.archiveSha256 === conformanceManifest.archiveSha256,
        'Conformance classification mismatch',
      )
      for (const expected of conformanceManifest.cases) {
        const matches = results.filter((row) => row.id === expected.id)
        const row = matches[0]
        requireCondition(
          matches.length === 1 && row !== undefined,
          'Conformance fixture missing or duplicated',
        )
        if (!row) throw new Error('Missing conformance row')
        requireCondition(
          row.matchesBaseline === true &&
            row.inputSha256 === expected.sha256 &&
            row.actualClassification === expected.baselineClassification,
          'Unexpected conformance result',
        )
        if (expected.baselineClassification === 'unexpected-failure')
          requireCondition(
            row.errorCode === expected.expectedErrorCode,
            'Known conformance failure changed',
          )
      }
      return results.length
    }
    case 'color': {
      const results = rows(report.results, 5)
      for (const row of results) {
        sha(row.inputSha256)
        sha(row.outputSha256)
        tolerance(row)
      }
      return results.length
    }
    case 'pipelines': {
      requireCondition(report.passed === true, 'Pipeline gate failed')
      const workflows = rows(report.workflows, 105)
      for (const row of workflows) {
        finite(row.width, 1)
        finite(row.height, 1)
        finite(row.checksum)
      }
      for (const row of rows(report.measurements, 4)) {
        sha(row.sha256)
        tolerance(row)
      }
      return workflows.length
    }
    case 'commonStatic': {
      const acceptance = record(report.acceptance),
        results = rows(report.results, 297),
        failures = rows(report.failures, 0)
      requireCondition(
        report.corpus !== undefined &&
          record(report.corpus).photographs === 100 &&
          results.length + failures.length === 300,
        'Wrong extended common-static scope',
      )
      requireCondition(
        acceptance.passed === true &&
          acceptance.incorrectOutputs === 0 &&
          acceptance.decoded === results.length &&
          acceptance.failed === failures.length &&
          results.length / 300 >= 0.99,
        'Common-static acceptance failed',
      )
      for (const row of results) {
        sha(row.encodedSha256)
        tolerance(row)
      }
      for (const row of failures)
        requireCondition(
          row.classification === 'unsupported' && row.code === 'UNSUPPORTED_OPERATION',
          'Non-explicit common-static failure',
        )
      return results.length
    }
    case 'commonPipelines': {
      const results = rows(report.results, 297)
      requireCondition(
        report.passed === true &&
          report.incorrectOutputs === 0 &&
          report.decoded === results.length &&
          report.workflows === results.length * 5 &&
          results.length + finite(report.unsupported) === 300,
        'Wrong extended pipeline scope or failure',
      )
      for (const row of results) {
        sha(row.sha256)
        sha(row.oraclePixelsSha256)
        const outputs = rows(row.outputs, 5)
        requireCondition(outputs.length === 5, 'Unexpected pipeline output count')
        for (const output of outputs) {
          requireCondition(
            finite(output.maxLimit) <= 1 && finite(output.rmseLimit) <= 0.55,
            'Pipeline tolerance exceeds the approved rounding exception',
          )
          tolerance(
            output,
            'maximumError',
            'rmse',
            finite(output.maxLimit),
            finite(output.rmseLimit),
          )
        }
      }
      return results.length * 5
    }
  }
}

export const knownEvidenceFailures = (gate: EvidenceGate, value: unknown): readonly string[] =>
  gate === 'conformance'
    ? rows(record(value).results)
        .filter((row) => row.actualClassification === 'unexpected-failure')
        .map((row) => `${String(row.id)}: ${String(row.errorCode)}`)
    : []
