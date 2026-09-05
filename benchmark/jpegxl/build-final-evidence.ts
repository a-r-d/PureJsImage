import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import capabilityManifest from '../../capabilities/manifest.json' with { type: 'json' }
import {
  evidenceFiles,
  extendedGates,
  validateEvidenceReport,
  knownEvidenceFailures,
  type EvidenceGate,
} from './evidence-validation.ts'
import { reportArgument, reportRevision } from './report-provenance.ts'

const commands: Readonly<Record<EvidenceGate, string>> = {
  remediationFixtures: 'node benchmark/jpegxl/verify-remediation-fixtures.ts',
  holdout: 'node benchmark/jpegxl/run-pr35-holdout.ts',
  smallJpeg:
    'node benchmark/jpegxl/run-pr35-holdout.ts --manifest benchmark/jpegxl/production-program/pr35-small-jpeg-manifest.json',
  encoder: 'npm run fixtures:jpegxl:encoder-matrix',
  reverse: 'npm run jpegxl:m1:reverse',
  compression1: 'npm run bench:jpegxl:compression -- --effort 1',
  compression7: 'npm run bench:jpegxl:compression -- --effort 7',
  benchmark: 'npm run bench:jpegxl (with pinned PUREJSIMAGE_JPEGXL_ORACLE_DIR)',
  modularMemory: 'node benchmark/jpegxl/run-memory.ts',
  varDctMemory: 'node benchmark/jpegxl/run-vardct-memory.ts',
  encoderMemory: 'node benchmark/jpegxl/run-encoder-memory.ts',
  conformance: 'npm run jpegxl:program:conformance -- --corpus-root .tmp/jpegxl-conformance',
  color: 'node benchmark/jpegxl/production-program/verify-m4-conformance.ts',
  pipelines: 'node benchmark/jpegxl/production-program/verify-m5-pipelines.ts',
  realJpeg: 'npm run jpegxl:m1:corpus (250 eligible COCO inputs)',
  commonStatic: 'npm run jpegxl:m3:corpus (100 COCO sources and 300 variants)',
  commonPipelines: 'node benchmark/jpegxl/production-program/verify-m5-common-static.ts',
}
const criteria: Readonly<Record<EvidenceGate, string>> = {
  remediationFixtures: 'Nine pinned libjxl fixtures; independent float samples within 1e-7.',
  holdout:
    'All nine frozen assets at original dimensions; efforts 1 and 7 independently pixel exact; eligible JPEGs byte exact; all expansions and explicit ineligibility retained. No size or timing promotion gate.',
  smallJpeg:
    'Both pinned small eligible JPEGs byte exact, including files rejected by onlyIfSmaller; efforts 1 and 7 independently pixel exact. Synthetic eligibility supplement, not an original blind photo holdout.',
  encoder:
    'At least 150 cases, six layouts and all four efforts; exact native samples in pinned independent decoders, with the named jxl-oxide signed-16-bit limitation exposed.',
  reverse:
    'Ten checksum-pinned JPEGs reconstruct byte for byte. Small regression matrix, not the 250-file size promotion cohort.',
  compression1:
    '156 procedural cases in 12 classes: exact native samples; median bytes/libjxl <= 1.4 and median wall time/libjxl <= 5.',
  compression7:
    '156 procedural cases in 12 classes: exact native samples; median/p90/worst bytes/libjxl <= 1.25/1.4/1.75; median bytes/PNG <= 0.9; at least 75% no larger than PNG; each class median <= 1.5; median time/libjxl <= 15.',
  benchmark:
    'Checksum-gated exact pixel and JPEG workloads with a required independent pixel oracle. Hosted absolute timing is observational.',
  modularMemory:
    'Checksum-gated isolated Modular memory workloads; expected allocation-limit preflight rejection remains explicit.',
  varDctMemory:
    'Checksum-gated isolated VarDCT memory workloads; expected allocation-limit preflight rejection remains explicit.',
  encoderMemory:
    'Sixteen isolated cold/warm workloads: 512x512 and native 24 MP at efforts 1/3/5/7; independent exact pixels, actual owned-buffer peak, zero live bytes and allocations after finish.',
  conformance:
    'All 39 classifications and input hashes match the pinned official corpus. Known failures are baseline observations, not supported-case passes.',
  color:
    'Five distinct official M4 cases; maximum error <= 1 and RMSE <= 0.55 under the documented 8-bit rounding exception.',
  pipelines:
    '105 complete workflows and four isolated memory comparisons; maximum error <= 1 and RMSE <= 0.55 for the documented VarDCT comparison.',
  realJpeg:
    '250 eligible COCO JPEGs >= 224 KiB, selected from 357 eligible candidates; all byte exact; >= 90% smaller; median savings >= 12%, p10 >= 0%; median/p90 ratio to libjxl <= 1.1/1.2; no unexplained outliers.',
  commonStatic:
    '100 COCO sources and 300 resized/upscaled variants; >= 99% decode, zero incorrect outputs, explicit unsupported failures only; maximum error <= 1 and RMSE <= 0.55.',
  commonPipelines:
    'All supported outputs from the 300-variant corpus complete five workflows; exact comparisons or the explicitly scoped maximum-1/RMSE-0.55 rounding exception.',
}
const capabilities = {
  commonStaticDecode: {
    pr: [
      'conformance',
      'color',
      'remediationFixtures',
      'pipelines',
      'modularMemory',
      'varDctMemory',
    ],
    extended: ['commonStatic'],
  },
  losslessPixelEncode: {
    pr: [
      'encoder',
      'compression1',
      'compression7',
      'encoderMemory',
      'benchmark',
      'holdout',
      'smallJpeg',
    ],
    extended: [],
  },
  losslessEffort1: {
    pr: ['encoder', 'compression1', 'encoderMemory', 'holdout', 'smallJpeg'],
    extended: [],
  },
  losslessEffort7: {
    pr: ['encoder', 'compression7', 'encoderMemory', 'holdout', 'smallJpeg'],
    extended: [],
  },
  colorAlphaHdr: { pr: ['color', 'remediationFixtures', 'pipelines'], extended: [] },
  exactJpegTranscode: { pr: ['reverse', 'benchmark'], extended: ['realJpeg'] },
  nativePrecisionPipelines: {
    pr: ['color', 'remediationFixtures', 'pipelines'],
    extended: ['commonStatic', 'commonPipelines'],
  },
} satisfies Record<string, { pr: EvidenceGate[]; extended: EvidenceGate[] }>

export const buildFinalEvidence = async (
  inputDirectory: string,
  revision: string,
  scope: 'pr' | 'extended',
) => {
  const gates: Partial<
    Record<
      EvidenceGate,
      Readonly<{
        status: 'passed' | 'not-run'
        file: string
        command: string
        criterion: string
        revision?: string
        sha256?: string
        cases?: number
        knownFailures?: readonly string[]
      }>
    >
  > = {}
  const reports: Partial<Record<EvidenceGate, unknown>> = {}
  for (const id of Object.keys(evidenceFiles) as EvidenceGate[]) {
    const file = evidenceFiles[id]
    let bytes: Uint8Array
    try {
      bytes = await readFile(join(inputDirectory, file))
    } catch (error) {
      if (
        scope === 'pr' &&
        extendedGates.includes(id) &&
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        gates[id] = { status: 'not-run', file, command: commands[id], criterion: criteria[id] }
        continue
      }
      throw new Error(`Required ${id} report ${file} is missing or unreadable`, { cause: error })
    }
    const report: unknown = JSON.parse(new TextDecoder().decode(bytes))
    let cases: number
    try {
      cases = validateEvidenceReport(id, report, revision)
    } catch (error) {
      throw new Error(`${id}: report validation failed`, { cause: error })
    }
    gates[id] = {
      status: 'passed',
      file,
      command: commands[id],
      criterion: criteria[id],
      revision,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      cases,
      knownFailures: knownEvidenceFailures(id, report),
    }
    reports[id] = report
  }
  const capabilityResults = Object.fromEntries(
    Object.entries(capabilities).map(([id, required]) => {
      const prPassed = required.pr.every((gate) => gates[gate]?.status === 'passed')
      const extendedPassed = required.extended.every((gate) => gates[gate]?.status === 'passed')
      const knownFailures = required.pr.flatMap((gate) => gates[gate]?.knownFailures ?? [])
      return [
        id,
        {
          status:
            knownFailures.length > 0
              ? 'validated-subset-with-known-failures'
              : prPassed
                ? extendedPassed
                  ? 'validated-for-declared-gates'
                  : 'validated-at-pr-scope'
                : 'not-validated',
          knownFailures,
          prGateIds: required.pr,
          extendedGateIds: required.extended,
          extendedStatus:
            required.extended.length === 0
              ? 'not-applicable'
              : extendedPassed
                ? 'passed'
                : 'not-run',
        },
      ]
    }),
  )
  const declaredCapability = capabilityManifest.codecs.find((codec) => codec.id === 'jpegxl')
  if (!declaredCapability) throw new Error('Missing authoritative JPEG XL capability')
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    revision,
    scope,
    provenance: {
      execution: process.env.GITHUB_ACTIONS === 'true' ? 'hosted-ci' : 'local-reference-machine',
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      historical: false,
      workingTreeDiffSha256: createHash('sha256')
        .update(
          execFileSync('git', ['diff', 'HEAD', '--', 'src', 'benchmark/jpegxl', 'capabilities']),
        )
        .digest('hex'),
      policy:
        'Reports are current executions at the recorded checkout revision. Local uncommitted changes are not proof of a committed SHA. Absolute hosted wall times are observational; reference-machine performance reports are recorded separately.',
    },
    declaredCapability,
    futureM6: {
      status: 'not-run',
      boundary: 'Progressive APIs and M6 work are outside this remediation.',
    },
    status: Object.values(gates).some((gate) => (gate.knownFailures?.length ?? 0) > 0)
      ? 'required-gates-passed-with-known-failures'
      : 'required-gates-passed',
    capabilities: capabilityResults,
    gates,
    reports,
    interpretation:
      'Official conformance is a baseline-classification gate, with known failing cases exposed separately. Status derives from the listed raw gate outcomes for this exact revision. PR evidence does not substitute for missing extended promotion runs. These results establish only the tested subsets; they do not mark M6 or all JPEG XL features complete. Browser and repository checks are separate CI jobs and are not asserted by this artifact.',
    corpusScope: {
      exactJpeg:
        '250 eligible COCO 2017 validation JPEGs at least 224 KiB, selected from 357 eligible candidates. Selection and exclusions are published.',
      pixelCompression:
        '156 procedural cases across 12 named classes; screenshot, text and photo-like labels describe generated patterns, not captured screens or camera photographs.',
      commonStatic:
        '100 COCO photographs with three encoder variants each; test rasters are resized or upscaled, including approximately 12 and 24 MP cases. Original dimensions are recorded separately.',
      rounding:
        'Maximum 1 and RMSE 0.55 apply to the documented 8-bit VarDCT/djxl comparisons and downstream exact-pixel composition. The independently justified rounding exception differs from the original 0.25 RMSE target. It is not a general HDR or lossless tolerance.',
    },
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const input = reportArgument('--input-dir', '.tmp/jpegxl-evidence')
  const scope = reportArgument('--scope', 'pr')
  if (scope !== 'pr' && scope !== 'extended') throw new Error('--scope must be pr or extended')
  const result = await buildFinalEvidence(input, reportRevision(), scope)
  const output = reportArgument('--output', join(input, 'jpegxl-release-hardening.json'))
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  const lines = Object.entries(result.capabilities).map(
    ([name, capability]) => `| ${name} | ${capability.status} | ${capability.extendedStatus} |`,
  )
  await writeFile(
    output.replace(/\.json$/, '.md'),
    `# JPEG XL validation evidence\n\nRevision: ${result.revision}\n\nScope: ${result.scope}\n\n| Capability | Current gate status | Extended evidence |\n| --- | --- | --- |\n${lines.join('\n')}\n\n${result.interpretation}\n\nRaw reports, commands and SHA-256 hashes are included in the JSON artifact.\n`,
  )
  console.log(`Wrote ${output}`)
}
