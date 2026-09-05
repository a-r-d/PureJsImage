import holdoutManifest from '../benchmark/jpegxl/production-program/pr35-holdout-manifest.json' with {
  type: 'json',
}
import smallJpegManifest from '../benchmark/jpegxl/production-program/pr35-small-jpeg-manifest.json' with {
  type: 'json',
}
import conformanceManifest from '../benchmark/jpegxl/production-program/corpora/conformance.json' with {
  type: 'json',
}
import remediationManifest from './fixtures/jpegxl/remediation/manifest.json' with { type: 'json' }
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFinalEvidence } from '../benchmark/jpegxl/build-final-evidence.ts'
import {
  evidenceFiles,
  extendedGates,
  validateEvidenceReport,
  type EvidenceGate,
} from '../benchmark/jpegxl/evidence-validation.ts'

const revision = 'a'.repeat(40),
  hash = 'b'.repeat(64)
const count = (length: number, make: (index: number) => unknown) =>
  Array.from({ length }, (_, index) => make(index))
const fixture = (gate: EvidenceGate): Record<string, unknown> => {
  const common = {
    schemaVersion: gate === 'reverse' ? 3 : gate === 'encoderMemory' ? 2 : 1,
    revision,
  }
  switch (gate) {
    case 'remediationFixtures':
      return {
        ...common,
        passed: true,
        oracleRevision: remediationManifest.libjxlRevision,
        results: remediationManifest.cases.map((entry) => ({
          id: entry.id,
          inputSha256: entry.sha256,
          pixelsSha256: entry.pixelsSha256,
          passed: true,
          maximumError: 0,
        })),
      }
    case 'holdout':
    case 'smallJpeg':
      return {
        ...common,
        validation: { passed: true },
        results: (gate === 'holdout' ? holdoutManifest : smallJpegManifest).cases.map((entry) => ({
          id: entry.id,
          sourceSha256: entry.sha256,
          width: entry.sourceWidth,
          height: entry.sourceHeight,
          results: [1, 7].map((effort) => ({
            effort,
            exactNativeSamples: true,
            managedLiveBytes: 0,
            outputSha256: hash,
            bytes: 100,
            ratioToPng: 2,
            ratioToLibjxl: 3,
          })),
          exactJpeg: /\.jpe?g$/i.test(entry.path)
            ? { status: 'encoded', byteExact: true }
            : { status: 'not-applicable' },
        })),
      }
    case 'encoder':
      return {
        ...common,
        validation: 'exact native samples',
        cases: count(163, (index) => ({
          id: `case-${index}`,
          format: ['gray8', 'gray16', 'rgb8', 'rgb16', 'rgba8', 'rgba16'][index % 6],
          effort: [1, 3, 5, 7][Math.floor(index / 6) % 4],
          inputSha256: hash,
          outputSha256: hash,
          outputBytes: 30,
          decoders: Object.fromEntries(
            ['djxl', 'jxl-rs', 'jxl-oxide'].map((name) => [
              name,
              { outputSha256: hash, status: 'exact-native-samples' },
            ]),
          ),
        })),
      }
    case 'reverse':
    case 'realJpeg':
      return {
        ...common,
        validation: { passed: true },
        results: count(gate === 'reverse' ? 10 : 250, (index) => ({
          id: `jpeg-${index}`,
          sourceSha256: hash,
          reconstructedSha256: hash,
          exact: true,
        })),
        milestone1CompressionGate: {
          passed: true,
          exactCases: 250,
          totalCases: 250,
          smallerRate: 1,
          medianSavingsPercentage: 20,
          p10SavingsPercentage: 10,
          medianRatioToLibjxl: 1,
          p90RatioToLibjxl: 1,
          unexplainedOutliers: [],
        },
      }
    case 'compression1':
    case 'compression7':
      return {
        ...common,
        effort: gate === 'compression1' ? 1 : 7,
        status: 'milestone-thresholds-passed',
        gates: Object.fromEntries(
          [
            'corpusAtLeast150',
            'medianSizeVsLibjxl',
            'p90SizeVsLibjxl',
            'noUnexplainedOutlier',
            'medianAtLeast10PercentSmallerThanPng',
            'atLeast75PercentNoLargerThanPng',
            'everyClassMedianVsPng',
            'medianSpeedVsLibjxl',
          ].map((key) => [key, true]),
        ),
        metrics: {
          corpusCases: 156,
          ratioToLibjxl: { median: 1, p90: 1.2, worst: 1.5 },
          speedRatioToLibjxl: { median: 2 },
          ratioToPng: {
            median: 0.8,
            noLargerFraction: 0.9,
            byClassMedian: Object.fromEntries(
              Array.from({ length: 12 }, (_, index) => [`class-${index}`, 0.8]),
            ),
          },
        },
        files: count(156, (index) => ({
          id: `case-${index}`,
          encoders: Object.fromEntries(
            ['pureJsImage', 'png', 'libjxlEffort1', 'libjxlEffort7'].map((key) => [
              key,
              { exactNativeSamples: true, bytes: 100, milliseconds: 1 },
            ]),
          ),
        })),
      }
    case 'benchmark':
    case 'modularMemory':
    case 'varDctMemory':
      return {
        ...common,
        validation: { passed: true, independentOracle: { available: true, exactPixels: true } },
        summaries: [
          {
            inputSha256: hash,
            outputSha256: hash,
            medianWallMilliseconds: 1,
            validation: 'tolerance-pixels',
            maximumError: 1,
            rmse: 0.4,
          },
        ],
      }
    case 'encoderMemory':
      return {
        ...common,
        validation: { passed: true },
        results: [1, 3, 5, 7].flatMap((effort) =>
          ['cold', 'warm'].flatMap((mode) =>
            [512, 6000].map((width) => ({
              width,
              effort,
              mode,
              sha256: hash,
              inputBytes: 30,
              managed: { peak: 100, live: 0, allocations: 0 },
              absolutePeakRssBytes: 1000,
              milliseconds: 1,
              independentExactPixels: true,
            })),
          ),
        ),
      }
    case 'conformance':
      return {
        ...common,
        baselineMatched: true,
        cases: conformanceManifest.cases.length,
        corpusRevision: conformanceManifest.revision,
        archiveSha256: conformanceManifest.archiveSha256,
        results: conformanceManifest.cases.map((entry) => ({
          id: entry.id,
          inputSha256: entry.sha256,
          matchesBaseline: true,
          actualClassification: entry.baselineClassification,
          errorCode: entry.expectedErrorCode,
        })),
      }
    case 'color':
      return {
        ...common,
        results: count(5, () => ({
          inputSha256: hash,
          outputSha256: hash,
          maximumError: 1,
          rmse: 0.5,
        })),
      }
    case 'pipelines':
      return {
        ...common,
        passed: true,
        workflows: count(105, () => ({ width: 1, height: 1, checksum: 1 })),
        measurements: count(4, () => ({ sha256: hash, maximumError: 1, rmse: 0.5 })),
      }
    case 'commonStatic':
      return {
        ...common,
        corpus: { photographs: 100 },
        acceptance: { passed: true, incorrectOutputs: 0, decoded: 300, failed: 0 },
        results: count(300, () => ({ encodedSha256: hash, maximumError: 1, rmse: 0.5 })),
        failures: [],
      }
    case 'commonPipelines':
      return {
        ...common,
        passed: true,
        incorrectOutputs: 0,
        decoded: 300,
        unsupported: 0,
        workflows: 1500,
        results: count(300, () => ({
          sha256: hash,
          oraclePixelsSha256: hash,
          outputs: count(5, () => ({ maximumError: 1, rmse: 0.5, maxLimit: 1, rmseLimit: 0.55 })),
        })),
      }
  }
}
const gates = Object.keys(evidenceFiles) as EvidenceGate[]

describe('JPEG XL evidence admission', () => {
  it.each(gates)('validates required outcomes for %s', (gate) =>
    expect(validateEvidenceReport(gate, fixture(gate), revision)).toBeGreaterThan(0),
  )
  it.each(gates)('rejects matching-SHA empty or malformed %s reports', (gate) => {
    expect(() => validateEvidenceReport(gate, { revision, schemaVersion: 1 }, revision)).toThrow()
    expect(() =>
      validateEvidenceReport(gate, { ...fixture(gate), schemaVersion: 99 }, revision),
    ).toThrow()
    expect(() =>
      validateEvidenceReport(gate, { ...fixture(gate), revision: 'c'.repeat(40) }, revision),
    ).toThrow(/revision/)
  })
  it('rejects a failed effort-7 gate despite a success label', () => {
    const report = {
      ...fixture('compression7'),
      gates: { corpusAtLeast150: true, medianSizeVsLibjxl: false },
    }
    expect(() => validateEvidenceReport('compression7', report, revision)).toThrow()
  })
  it('rejects wrong effort, missing encoder efforts and non-exact reconstruction', () => {
    expect(() =>
      validateEvidenceReport('compression7', { ...fixture('compression1'), effort: 1 }, revision),
    ).toThrow()
    expect(() =>
      validateEvidenceReport(
        'encoder',
        { ...fixture('encoder'), cases: count(163, () => ({ effort: 1 })) },
        revision,
      ),
    ).toThrow()
    expect(() =>
      validateEvidenceReport(
        'reverse',
        {
          ...fixture('reverse'),
          results: count(10, () => ({
            sourceSha256: hash,
            reconstructedSha256: 'c'.repeat(64),
            exact: true,
          })),
        },
        revision,
      ),
    ).toThrow()
  })
  it('rejects memory leaks and missing independent pixel checks', () => {
    expect(() =>
      validateEvidenceReport(
        'encoderMemory',
        {
          ...fixture('encoderMemory'),
          results: count(16, () => ({
            sha256: hash,
            independentExactPixels: true,
            managed: { peak: 100, live: 1, allocations: 1 },
          })),
        },
        revision,
      ),
    ).toThrow(/leak/)
    expect(() =>
      validateEvidenceReport(
        'encoderMemory',
        { ...fixture('encoderMemory'), validation: { passed: false } },
        revision,
      ),
    ).toThrow()
  })
  it('rejects a falsely successful common-static acceptance summary', () => {
    expect(() =>
      validateEvidenceReport('commonStatic', { ...fixture('commonStatic'), results: [] }, revision),
    ).toThrow()
  })
  it('rejects inflated pipeline tolerances and false compression gate booleans', () => {
    expect(() =>
      validateEvidenceReport(
        'commonPipelines',
        {
          ...fixture('commonPipelines'),
          results: count(300, () => ({
            sha256: hash,
            oraclePixelsSha256: hash,
            outputs: count(5, () => ({ maximumError: 2, rmse: 0.8, maxLimit: 2, rmseLimit: 1 })),
          })),
        },
        revision,
      ),
    ).toThrow(/tolerance exceeds/)
    expect(() =>
      validateEvidenceReport(
        'compression7',
        {
          ...fixture('compression7'),
          metrics: {
            corpusCases: 156,
            ratioToLibjxl: { median: 10 },
            speedRatioToLibjxl: { median: 2 },
          },
        },
        revision,
      ),
    ).toThrow(/measurements exceed/)
  })
  it('derives PR statuses while leaving missing extended evidence explicitly not run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jpegxl-evidence-'))
    try {
      for (const gate of gates.filter((gate) => !extendedGates.includes(gate)))
        await writeFile(join(directory, evidenceFiles[gate]), JSON.stringify(fixture(gate)))
      const report = await buildFinalEvidence(directory, revision, 'pr')
      expect(report.status).toBe('required-gates-passed-with-known-failures')
      expect(report.capabilities.commonStaticDecode?.knownFailures).toEqual([
        'delta_palette: INVALID_INPUT',
      ])
      expect(report.capabilities.exactJpegTranscode?.extendedStatus).toBe('not-run')
      expect(report.capabilities.losslessPixelEncode?.status).toBe('validated-for-declared-gates')
      expect(report.gates.compression7).toMatchObject({ status: 'passed', revision, cases: 156 })
      expect(report.gates.compression7?.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(report)).not.toContain('encoder remains Experimental')
      await expect(buildFinalEvidence(directory, revision, 'extended')).rejects.toThrow(/missing/)
      await rm(join(directory, evidenceFiles.compression7))
      await expect(buildFinalEvidence(directory, revision, 'pr')).rejects.toThrow(/compression7/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('rejects stale optional extended evidence instead of silently omitting it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jpegxl-evidence-'))
    try {
      for (const gate of gates)
        await writeFile(join(directory, evidenceFiles[gate]), JSON.stringify(fixture(gate)))
      const valid = await buildFinalEvidence(directory, revision, 'extended')
      expect(valid.capabilities.commonStaticDecode?.extendedStatus).toBe('passed')
      await writeFile(
        join(directory, evidenceFiles.realJpeg),
        JSON.stringify({ ...fixture('realJpeg'), revision: 'd'.repeat(40) }),
      )
      await expect(buildFinalEvidence(directory, revision, 'pr')).rejects.toThrow(/realJpeg/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
