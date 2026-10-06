import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { hash, implementationIdentity, json, work } from './io.ts'
import { number, object, string, validateImplementationIdentity } from './model.ts'
import {
  type OriginalLossyPoint,
  originalLossyBands,
  originalLossyPoint,
} from './original-lossy-bands.ts'
import { type OriginalMatrixAttempt, originalMatrixAttempts } from './original-matrix-ledger.ts'

const [output, fixtureId] = process.argv.slice(2)
if (!output || !fixtureId) throw new Error('Specify a report path and predeclared original photo')
const identity = await implementationIdentity()
const subjects = ['purejsimage', 'jsquash', 'vips'] as const
const planPath = 'benchmark/jpegxl/comparison/original-photo-matrix-plan.json'
const planBytes = await readFile(planPath),
  plan = object(JSON.parse(planBytes.toString('utf8')))
if (
  plan.implementationSourceSha256 !== identity.implementationSourceSha256 ||
  plan.maximumAttemptsPerUnchangedImplementationParticipantFixture !== 24 ||
  plan.maximumBracketWidthPerMetric !== 0.25 ||
  plan.effort !== 7 ||
  JSON.stringify(plan.participants) !== JSON.stringify(subjects) ||
  !Array.isArray(plan.fixtures)
)
  throw new Error('Unchanged predeclared original matrix required')
const fixture = plan.fixtures.map(object).find((row) => row.id === fixtureId)
if (!fixture) throw new Error('Original photo was not predeclared')
const width = number(fixture.width),
  height = number(fixture.height),
  samples = width * height * 4,
  inputSha256 = string(fixture.rawSha256)
if (
  !Number.isSafeInteger(width) ||
  width < 1 ||
  !Number.isSafeInteger(height) ||
  height < 1 ||
  !Number.isSafeInteger(samples) ||
  samples < 4 ||
  samples > 16_777_216 * 4
)
  throw new Error('Invalid original sample extent')
const precedingPath = 'benchmark/jpegxl/comparison/results/original-photo-production-controls.json'
const preceding = object(JSON.parse(await readFile(precedingPath, 'utf8')))
if (!Array.isArray(preceding.packages)) throw new Error('Qualified whole packages missing')
const expectedPackages = preceding.packages.map(object)
const pins = new Map<string, string>()
const fileHash = async (path: string): Promise<string> => {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path, { highWaterMark: 65_536 })) {
    if (!(chunk instanceof Uint8Array)) throw new Error('Unexpected evidence chunk')
    digest.update(chunk)
  }
  return digest.digest('hex')
}
const pin = (path: string, sha256: string) => {
  const previous = pins.get(path)
  if (previous !== undefined && previous !== sha256)
    throw new Error('Conflicting physical evidence pin')
  pins.set(path, sha256)
}
for (const path of [
  import.meta.filename,
  planPath,
  precedingPath,
  string(plan.fixtureManifest),
  'benchmark/jpegxl/comparison/original-matrix-ledger.ts',
  'benchmark/jpegxl/comparison/original-lossy-bands.ts',
  'benchmark/jpegxl/m7-quality-curves.ts',
  'benchmark/jpegxl/m7-recovery-curves.ts',
])
  pin(path, await fileHash(path))
const reports = new Map<string, Record<string, unknown>>()
interface Participant {
  readonly subject: (typeof subjects)[number]
  readonly attemptLedger: string
  readonly attempts: readonly OriginalMatrixAttempt[]
  readonly points: readonly OriginalLossyPoint[]
  readonly bands: ReturnType<typeof originalLossyBands>
}
const participants: Participant[] = []
const failures: {
  subject: string
  setting: number
  phase: string
  status: string
  detail: string
  report: string
}[] = []
let reusedGrids = 0,
  reusedPublicSamples = 0
for (const subject of subjects) {
  const domain = object(plan.domain)[subject]
  if (!Array.isArray(domain) || domain.length !== 2) throw new Error('Participant domain missing')
  const ledgerPath = `${work}/original-photo-matrix-1547/${identity.implementationSourceSha256}/${fixtureId}-${subject}-attempts.json`
  let attempts: readonly OriginalMatrixAttempt[] = []
  try {
    const bytes = await readFile(ledgerPath)
    attempts = originalMatrixAttempts(JSON.parse(bytes.toString('utf8')), {
      implementationSourceSha256: identity.implementationSourceSha256,
      fixture: fixtureId,
      inputSha256,
      minimumSetting: number(domain[0]),
      maximumSetting: number(domain[1]),
    })
    pin(ledgerPath, hash(bytes))
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const points: OriginalLossyPoint[] = []
  for (const attempt of attempts) {
    if (attempt.status === 'attempted') continue
    let report = reports.get(attempt.report)
    if (!report) {
      const bytes = await readFile(attempt.report)
      report = object(JSON.parse(bytes.toString('utf8')))
      if (
        report.completed !== true ||
        report.implementationSourceSha256 !== identity.implementationSourceSha256 ||
        report.fixture !== fixtureId ||
        report.inputSha256 !== inputSha256 ||
        object(report.predeclaredPlan).sha256 !== hash(planBytes) ||
        !Array.isArray(report.results) ||
        !Array.isArray(report.proof) ||
        !Array.isArray(report.pins) ||
        !Array.isArray(report.packages) ||
        !Array.isArray(report.ownership) ||
        report.freshEncodedFiles !== report.results.length ||
        report.freshCompleteIndependentGrids !== report.results.length * 2
      )
        throw new Error('Complete frozen measurement report required')
      if (report.packages.length !== 2) throw new Error('Both whole public packages required')
      const packageTargets = new Set<string>()
      for (const value of report.packages) {
        const measured = object(value),
          expected = expectedPackages.find((row) => row.target === measured.target)
        if (
          !expected ||
          packageTargets.has(string(measured.target)) ||
          measured.bytes !== expected.bytes ||
          measured.sha256 !== expected.sha256 ||
          measured.ceiling !== expected.ceiling ||
          number(measured.bytes) > number(measured.ceiling) ||
          JSON.stringify(measured.exports) !== JSON.stringify(expected.exports)
        )
          throw new Error('Qualified whole package identity or exports differ')
        packageTargets.add(string(measured.target))
        pin(string(measured.path), string(measured.sha256))
      }
      for (const value of report.ownership) {
        const owned = object(value)
        if (
          owned.ownedLive !== 0 ||
          owned.ownedAllocations !== 0 ||
          !Number.isSafeInteger(number(owned.ownedPeak)) ||
          number(owned.ownedPeak) < 0
        )
          throw new Error('Original caller ownership did not close')
      }
      for (const value of report.pins) {
        const row = object(value)
        pin(string(row.path), string(row.sha256))
      }
      pin(attempt.report, hash(bytes))
      reports.set(attempt.report, report)
    }
    if (
      !Array.isArray(report.results) ||
      !Array.isArray(report.proof) ||
      !Array.isArray(report.ownership)
    )
      throw new Error('Measured points missing')
    if (attempt.status === 'failed') {
      if (!Array.isArray(report.failures)) throw new Error('Failed measurement evidence missing')
      const failure = report.failures
        .map(object)
        .find((row) => row.subject === subject && row.setting === attempt.setting)
      if (!failure) throw new Error('Failed attempt missing from its measurement report')
      failures.push({
        subject,
        setting: attempt.setting,
        phase: string(failure.phase),
        status: string(failure.status),
        detail: string(failure.detail),
        report: attempt.report,
      })
      continue
    }
    const raw = report.results
      .map(object)
      .find((row) => row.subject === subject && row.setting === attempt.setting)
    const proof = report.proof
      .map(object)
      .find((row) => row.subject === subject && row.setting === attempt.setting)
    if (
      !raw ||
      !proof ||
      !Array.isArray(proof.grids) ||
      proof.grids.length !== 2 ||
      proof.encodedFresh !== true ||
      object(proof.alphaError).maximum !== 0 ||
      object(proof.nativeAlphaError).maximum !== 0 ||
      !Number.isFinite(number(proof.maximumDecoderError)) ||
      number(proof.maximumDecoderError) < 0 ||
      number(proof.maximumDecoderError) > 1 ||
      !Number.isFinite(number(proof.maximumMetricDecoderError)) ||
      number(proof.maximumMetricDecoderError) < 0 ||
      number(proof.maximumMetricDecoderError) > 1 ||
      (subject === 'purejsimage' &&
        (proof.publicSamples !== samples ||
          !Number.isFinite(number(proof.maximumPublicDecoderError)) ||
          number(proof.maximumPublicDecoderError) < 0 ||
          number(proof.maximumPublicDecoderError) > 1))
    )
      throw new Error('Complete independently verified point required')
    const decoders = new Set<string>()
    for (const value of proof.grids) {
      const grid = object(value),
        decoder = string(grid.decoder)
      if (
        (decoder !== 'native' && decoder !== 'rust') ||
        decoders.has(decoder) ||
        grid.samples !== samples ||
        object(grid.alphaError).maximum !== 0
      )
        throw new Error('Complete native and Rust grids required')
      decoders.add(decoder)
      pin(string(grid.path), string(grid.sha256))
      reusedGrids++
    }
    const point = originalLossyPoint({
      ...raw,
      artifactSha256: raw.encodedSha256,
      decodedSha256: raw.decodedPngSha256,
    })
    if (
      proof.encodedSha256 !== point.artifactSha256 ||
      proof.decodedPngSha256 !== point.decodedSha256 ||
      proof.bytes !== point.bytes ||
      proof.score !== point.score ||
      proof.butteraugli !== point.butteraugli
    )
      throw new Error('Quality point and independent proof differ')
    pin(point.artifact, point.artifactSha256)
    pin(point.artifact.replace(/\.jxl$/u, '.png'), point.decodedSha256)
    if (subject === 'purejsimage') {
      if (report.ownership.length !== report.results.length)
        throw new Error('Every public encode needs ownership proof')
      reusedPublicSamples += samples
    }
    points.push(point)
  }
  participants.push({
    subject,
    attemptLedger: ledgerPath,
    attempts,
    points,
    bands: [
      ...originalLossyBands(points, 'ssimulacra2'),
      ...originalLossyBands(points, 'butteraugli'),
    ],
  })
}
const pure = participants.find((row) => row.subject === 'purejsimage')
if (!pure) throw new Error('First-party participant missing')
const comparisons = participants
  .filter((row) => row.subject !== 'purejsimage')
  .flatMap((peer) =>
    pure.bands.map((band) => {
      const other = peer.bands.find(
        (row) => row.metric === band.metric && row.target === band.target,
      )
      if (!other) throw new Error('Corresponding metric band missing')
      const ratio =
        band.interpolatedBytes !== null && other.interpolatedBytes !== null
          ? band.interpolatedBytes / other.interpolatedBytes
          : null
      return {
        comparator: peer.subject,
        metric: band.metric,
        target: band.target,
        status: ratio === null ? 'unresolved' : 'adequate bracket',
        pure: band,
        peer: other,
        ratio,
        atOrBelowPeerBytes: ratio === null ? null : ratio <= 1,
      }
    }),
  )
// Freeze mutable repository evidence while its measured hashes still match. Later
// codec changes can reuse peer pixels without pretending their old source is current.
const snapshotDirectory = `${work}/original-matrix-source-snapshots/${basename(output, '.json')}`
await mkdir(snapshotDirectory, { recursive: true })
const ledgers = new Set(participants.map((row) => row.attemptLedger))
const physicalPins: { path: string; sha256: string; originalPath: string }[] = []
for (const [path, sha256] of pins) {
  if ((await fileHash(path)) !== sha256) throw new Error(`Physical matrix evidence drift: ${path}`)
  let frozen = path
  if (ledgers.has(path) || (!path.startsWith('.tmp/') && !path.startsWith('node_modules/'))) {
    frozen = `${snapshotDirectory}/${sha256}-${basename(path)}`
    try {
      await writeFile(frozen, await readFile(path), { flag: 'wx' })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
    if ((await fileHash(frozen)) !== sha256) throw new Error('Frozen source snapshot differs')
  }
  physicalPins.push({ path: frozen, sha256, originalPath: path })
}
validateImplementationIdentity(await implementationIdentity(), identity)
await json(output, {
  ...identity,
  completed: true,
  scope: 'original-photo-matrix',
  fixture: fixtureId,
  inputGeometry: { width, height },
  inputSha256,
  effort: 7,
  predeclaredPlan: { path: planPath, sha256: hash(planBytes) },
  maximumAttemptsPerUnchangedImplementationParticipantFixture: 24,
  maximumBracketWidthPerMetric: 0.25,
  extrapolation: false,
  participants,
  failures,
  comparisons,
  resolvedComparisons: comparisons.filter((row) => row.ratio !== null).length,
  sizeGaps: comparisons.filter((row) => row.ratio !== null && row.ratio > 1).length,
  unresolvedComparisons: comparisons.filter((row) => row.ratio === null).length,
  freshEncodedFiles: 0,
  freshCompleteIndependentGrids: 0,
  freshPublicDecodedSamples: 0,
  reusedQualifiedIndependentGrids: reusedGrids,
  reusedQualifiedPublicDecodedSamples: reusedPublicSamples,
  measurementReports: [...reports.keys()],
  pins: physicalPins,
  publicComparisonCountsChanged: false,
  fullParity: false,
  policy:
    'Physically rehash every complete measurement, package, artifact, grid, scoring image and tool pin. Preserve the predeclared source, exact unresized pixels and durable attempt budget, including failures and interruptions. Compare separate nondominated metric frontiers using quarter-unit brackets and log-byte interpolation without extrapolation. Unmeasured or unresolved bands stay null. Frozen source snapshots preserve historical peer qualification across later first-party codec changes. This verifier reuses qualified pixels; it performs no fresh encode or decode and makes no universal compression claim.',
})
console.log(
  JSON.stringify({
    fixture: fixtureId,
    comparisons: comparisons.map(({ comparator, metric, target, status, ratio }) => ({
      comparator,
      metric,
      target,
      status,
      ratio,
    })),
  }),
)
