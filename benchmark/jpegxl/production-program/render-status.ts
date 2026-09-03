import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type MilestoneStatus = 'not started' | 'in progress' | 'PR open' | 'merged' | 'blocked'

interface MilestoneDefinition {
  readonly id: string
  readonly goal: string
  readonly branch: string
  readonly requiredGates: readonly string[]
  readonly target: 'A' | 'B' | 'C'
}

const milestones: readonly MilestoneDefinition[] = Object.freeze([
  {
    id: 'M0',
    goal: 'Production baseline, corpus, and CI architecture',
    branch: 'codex/jpegxl-m00-program-baseline',
    target: 'A',
    requiredGates: [
      'checksum-pinned licensed corpora',
      'extracted fixture features',
      'claim-to-test coverage',
      'stable failure classification',
      'scheduled full-corpus CI',
      'npm run check',
      'Chromium, Firefox, and WebKit with retries disabled',
      'no capability promotion',
    ],
  },
  {
    id: 'M1',
    goal: 'Exact JPEG recompression',
    branch: 'codex/jpegxl-m01-jpeg-recompression',
    target: 'A',
    requiredGates: [
      'byte-exact reconstruction',
      'compression thresholds',
      'performance thresholds',
      '250 real JPEGs',
      'browser and Node agreement',
    ],
  },
  {
    id: 'M2',
    goal: 'Competitive lossless Modular encoder',
    branch: 'codex/jpegxl-m02-lossless-encoder',
    target: 'A',
    requiredGates: [
      'four-decoder exactness',
      'effort-tier compression thresholds',
      'performance thresholds',
      'bounded output and cancellation',
    ],
  },
  {
    id: 'M3',
    goal: 'Common static VarDCT decoding',
    branch: 'codex/jpegxl-m03-common-vardct',
    target: 'A',
    requiredGates: [
      'common-static corpus correctness',
      'fixed pixel tolerances',
      'bounded 24 MP memory',
      'Node performance thresholds',
    ],
  },
  {
    id: 'M4',
    goal: 'Color, orientation, alpha, HDR, and metadata',
    branch: 'codex/jpegxl-m04-color-alpha-metadata',
    target: 'A',
    requiredGates: [
      'eight orientations',
      'structured color and HDR oracles',
      'alpha semantics',
      'bounded ICC and metadata',
    ],
  },
  {
    id: 'M5',
    goal: 'Production static pipeline integration',
    branch: 'codex/jpegxl-m05-static-pipeline',
    target: 'A',
    requiredGates: [
      'listed transform and output workflows',
      'planner evidence',
      'Node and browser agreement',
      'package examples',
    ],
  },
  {
    id: 'M6',
    goal: 'Progressive and range-aware decoding',
    branch: 'codex/jpegxl-m06-progressive-range',
    target: 'A',
    requiredGates: [
      'progressive stages',
      'reduced-resolution byte skipping',
      'range-backed source evidence',
      'viewport and cancellation thresholds',
    ],
  },
  {
    id: 'M7',
    goal: 'General lossy VarDCT encoder',
    branch: 'codex/jpegxl-m07-lossy-encoder',
    target: 'B',
    requiredGates: [
      'independent decoder correctness',
      'quality thresholds',
      'rate-distortion thresholds',
      'performance and memory thresholds',
    ],
  },
  {
    id: 'M8',
    goal: 'Broad Level 5 animation, previews, and extra channels',
    branch: 'codex/jpegxl-m08-level5-breadth',
    target: 'B',
    requiredGates: [
      'applicable Level 5 conformance',
      'frame and timestamp agreement',
      'bounded sequence memory',
      'extra-channel discovery',
    ],
  },
  {
    id: 'M9',
    goal: 'Production hardening, API freeze, and release preparation',
    branch: 'codex/jpegxl-m09-production-hardening',
    target: 'B',
    requiredGates: [
      'conformance and fuzzing',
      'security review',
      'runtime matrix',
      'API and package-size freeze',
      'release target B gates',
    ],
  },
  {
    id: 'M10',
    goal: 'Level 10 and uncommon standardized profiles',
    branch: 'codex/jpegxl-m10-level10-stretch',
    target: 'C',
    requiredGates: [
      'applicable Level 5 and Level 10 conformance',
      'named rare unsupported features',
      'bounded Level 10 resources',
      'runtime and security gates',
    ],
  },
])

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

const milestoneStatus = (value: unknown, label: string): MilestoneStatus => {
  if (
    value !== 'not started' &&
    value !== 'in progress' &&
    value !== 'PR open' &&
    value !== 'merged' &&
    value !== 'blocked'
  ) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

const strings = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings`)
  }
  return Object.freeze(value.map(String))
}

const statePath = join('benchmark', 'jpegxl', 'production-program', 'program-state.json')
const outputPath = join('benchmark', 'jpegxl', 'production-program', 'status.json')
const state: unknown = JSON.parse(await readFile(statePath, 'utf8'))
if (!isRecord(state) || !isRecord(state.milestones)) {
  throw new Error(`${statePath} is invalid`)
}
const milestoneState = state.milestones
const currentMainSha = requiredString(state.currentMainSha, 'currentMainSha')
const packageVersion = requiredString(state.packageVersion, 'packageVersion')
const currentTarget = requiredString(state.currentTarget, 'currentTarget')
if (currentTarget !== 'A' && currentTarget !== 'B' && currentTarget !== 'C') {
  throw new Error('currentTarget must be A, B, or C')
}

const outputMilestones = milestones.map((definition) => {
  const value = milestoneState[definition.id]
  if (value === undefined) {
    return Object.freeze({
      ...definition,
      status: 'not started',
      branch: definition.branch,
      pr: null,
      startRevision: null,
      finalRevision: null,
      localCommands: Object.freeze([]),
      remoteWorkflowRuns: Object.freeze([]),
      measuredResults: Object.freeze([]),
      corpusVersions: Object.freeze([]),
      oracleRevisions: Object.freeze([]),
      benchmarkReportPath: null,
      capabilityChanges: Object.freeze([]),
      capabilityPromotions: Object.freeze([]),
      acceptedLimitations: Object.freeze([]),
      deferredWork: Object.freeze([]),
      stablePromotionGatePassed: false,
      remainingBlockers: Object.freeze([...definition.requiredGates]),
    })
  }
  if (!isRecord(value)) throw new Error(`${definition.id} state must be an object`)
  const status = milestoneStatus(value.status, `${definition.id}.status`)
  return Object.freeze({
    ...definition,
    status,
    branch: requiredString(value.branch, `${definition.id}.branch`),
    pr: typeof value.pr === 'number' ? value.pr : null,
    startRevision: typeof value.startRevision === 'string' ? value.startRevision : null,
    finalRevision: typeof value.finalRevision === 'string' ? value.finalRevision : null,
    localCommands: strings(value.localCommands, `${definition.id}.localCommands`),
    remoteWorkflowRuns: strings(value.remoteWorkflowRuns, `${definition.id}.remoteWorkflowRuns`),
    measuredResults: strings(value.measuredResults, `${definition.id}.measuredResults`),
    corpusVersions: strings(value.corpusVersions, `${definition.id}.corpusVersions`),
    oracleRevisions: strings(value.oracleRevisions, `${definition.id}.oracleRevisions`),
    benchmarkReportPath:
      typeof value.benchmarkReportPath === 'string' ? value.benchmarkReportPath : null,
    capabilityChanges: strings(value.capabilityChanges, `${definition.id}.capabilityChanges`),
    capabilityPromotions: strings(
      value.capabilityPromotions,
      `${definition.id}.capabilityPromotions`,
    ),
    acceptedLimitations: strings(value.acceptedLimitations, `${definition.id}.acceptedLimitations`),
    deferredWork: strings(value.deferredWork, `${definition.id}.deferredWork`),
    stablePromotionGatePassed: value.stablePromotionGatePassed === true,
    remainingBlockers: strings(value.remainingBlockers, `${definition.id}.remainingBlockers`),
  })
})

const report = Object.freeze({
  schemaVersion: 1,
  currentMainSha,
  packageVersion,
  currentTarget,
  milestones: Object.freeze(outputMilestones),
})
const output = `${JSON.stringify(report, null, 2)}\n`
if (process.argv.includes('--write')) await writeFile(outputPath, output)
else if (process.argv.includes('--check')) {
  const current: unknown = JSON.parse(await readFile(outputPath, 'utf8'))
  if (JSON.stringify(current) !== JSON.stringify(report)) {
    throw new Error(`${outputPath} is not current; run render-status.ts --write`)
  }
} else process.stdout.write(output)
