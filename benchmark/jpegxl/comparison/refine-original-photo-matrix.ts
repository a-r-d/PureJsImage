import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { hash, json, work } from './io.ts'
import { number, object, string } from './model.ts'
import {
  type OriginalLossyPoint,
  originalLossyBands,
  originalLossyPoint,
} from './original-lossy-bands.ts'
import { type OriginalMatrixAttempt, originalMatrixAttempts } from './original-matrix-ledger.ts'
import { nextComparisonQualitySetting } from './quality-refinement.ts'

const [prefix, fixtureId, subject] = process.argv.slice(2)
if (
  !prefix ||
  !fixtureId ||
  (subject !== 'purejsimage' && subject !== 'jsquash' && subject !== 'vips')
)
  throw new Error('Specify a unique report prefix, predeclared original and participant')
const planPath = 'benchmark/jpegxl/comparison/original-photo-matrix-plan.json'
const planBytes = await readFile(planPath)
const plan = object(JSON.parse(planBytes.toString('utf8')))
if (
  !Array.isArray(plan.fixtures) ||
  plan.maximumAttemptsPerUnchangedImplementationParticipantFixture !== 24
)
  throw new Error('Predeclared bounded matrix required')
const fixture = plan.fixtures.map(object).find((row) => row.id === fixtureId)
if (!fixture) throw new Error('Original not predeclared')
const domain = object(plan.domain)[subject]
if (!Array.isArray(domain) || domain.length !== 2) throw new Error('Participant domain missing')
const minimum = number(domain[0]),
  maximum = number(domain[1])
const ledgerPath = `${work}/original-photo-matrix-1547/${string(plan.implementationSourceSha256)}/${fixtureId}-${subject}-attempts.json`
const ledger = async (): Promise<readonly OriginalMatrixAttempt[]> => {
  try {
    return originalMatrixAttempts(JSON.parse(await readFile(ledgerPath, 'utf8')), {
      implementationSourceSha256: string(plan.implementationSourceSha256),
      fixture: fixtureId,
      inputSha256: string(fixture.rawSha256),
      minimumSetting: minimum,
      maximumSetting: maximum,
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}
const measure = async (settings: readonly number[]) => {
  const attempts = await ledger()
  const report = `${prefix}-${String(attempts.length + 1).padStart(2, '0')}.json`
  const program = 'benchmark/jpegxl/comparison/measure-original-photo-matrix.ts'
  const args = [program, report, fixtureId, subject, ...settings.map(String)]
  console.log(
    JSON.stringify({
      fixture: fixtureId,
      subject,
      attemptedBefore: attempts.length,
      settings,
      report,
    }),
  )
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (code !== 0)
    throw new Error(`Measurement failed with exit ${code}; preserve its durable attempts`)
  if (hash(await readFile(planPath)) !== hash(planBytes))
    throw new Error('Predeclared plan changed')
}
const initial = object(plan.initialSettings)[
  subject === 'purejsimage'
    ? 'purejsimageDistances'
    : subject === 'jsquash'
      ? 'jsquashSearchSettings'
      : 'vipsDistances'
]
if (!Array.isArray(initial)) throw new Error('Initial matrix settings missing')
const preceding = await ledger()
const unattempted = initial
  .map(number)
  .filter((setting) => !preceding.some((attempt) => attempt.setting === setting))
if (unattempted.length) await measure(unattempted)
const targets = [
  { metric: 'ssimulacra2', target: 70 },
  { metric: 'butteraugli', target: 0.5 },
  { metric: 'ssimulacra2', target: 80 },
  { metric: 'butteraugli', target: 1 },
  { metric: 'ssimulacra2', target: 90 },
  { metric: 'butteraugli', target: 2 },
  { metric: 'butteraugli', target: 3 },
] as const
let stopReason = ''
while (true) {
  const attempts = await ledger()
  const points: OriginalLossyPoint[] = []
  for (const path of new Set(
    attempts.filter((row) => row.status === 'verified').map((row) => row.report),
  )) {
    const report = object(JSON.parse(await readFile(path, 'utf8')))
    if (
      report.completed !== true ||
      report.implementationSourceSha256 !== plan.implementationSourceSha256 ||
      report.fixture !== fixtureId ||
      report.inputSha256 !== fixture.rawSha256 ||
      !Array.isArray(report.results)
    )
      throw new Error('Verified measurement report identity differs')
    for (const input of report.results) {
      const row = object(input)
      if (row.subject !== subject) throw new Error('Measured participant differs')
      const point = originalLossyPoint({
        ...row,
        artifactSha256: row.encodedSha256,
        decodedSha256: row.decodedPngSha256,
      })
      if (
        !attempts.some(
          (attempt) =>
            attempt.setting === point.setting &&
            attempt.status === 'verified' &&
            attempt.report === path,
        )
      )
        throw new Error('Verified point missing from durable ledger')
      points.push(point)
    }
  }
  const bands = [
    ...originalLossyBands(points, 'ssimulacra2'),
    ...originalLossyBands(points, 'butteraugli'),
  ]
  console.log(
    JSON.stringify({
      fixture: fixtureId,
      subject,
      attempts: attempts.length,
      bands: bands.map(({ metric, target, status, width, interpolatedBytes }) => ({
        metric,
        target,
        status,
        width,
        interpolatedBytes,
      })),
    }),
  )
  if (bands.every((band) => band.status === 'adequate bracket')) {
    stopReason = 'all seven metric brackets adequate'
    break
  }
  if (attempts.length >= 24) {
    stopReason = 'shared attempt budget exhausted'
    break
  }
  if (!points.length) {
    stopReason = 'no independently verified public output'
    break
  }
  let next: number | undefined
  for (let index = 0; index < targets.length; index++) {
    const target = targets[(attempts.length + index) % targets.length]
    if (!target) throw new Error('Missing refinement target')
    const signed = points.map((point) => ({
      setting: point.setting,
      bytes: point.bytes,
      score: target.metric === 'ssimulacra2' ? point.score : -point.butteraugli,
    }))
    const candidate = nextComparisonQualitySetting(
      signed,
      [target.metric === 'ssimulacra2' ? target.target : -target.target],
      minimum,
      maximum,
      0.25,
    )
    if (candidate !== undefined && !attempts.some((attempt) => attempt.setting === candidate)) {
      next = candidate
      break
    }
  }
  if (next === undefined) {
    stopReason = 'no unattempted refinement candidate; preserve unresolved bands'
    break
  }
  await measure([next])
}
await json(`${prefix}-completion.json`, {
  fixture: fixtureId,
  subject,
  stopReason,
  planPath,
  planSha256: hash(planBytes),
  attemptLedger: ledgerPath,
  attempts: await ledger(),
  fullParity: false,
  policy:
    'One participant, unchanged predeclared source and shared budget. Bracket adequacy is separate from matched peer size and complete physical qualification.',
})
