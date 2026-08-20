import { execFile } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import {
  assertOmeZarrConformanceReportCurrent,
  OME_ZARR_CONFORMANCE_EXCLUSION_BY_ID,
  OME_ZARR_CONFORMANCE_EXCLUSIONS,
  OME_ZARR_CONFORMANCE_REPORT_PATH,
  OME_ZARR_CONFORMANCE_REPOSITORY,
  OME_ZARR_CONFORMANCE_REVISION,
  OME_ZARR_CONFORMANCE_VERSION,
} from './ome-zarr-conformance-data.ts'

const exec = promisify(execFile)
const checkout = join(process.cwd(), '.tmp', `ngff-spec-${OME_ZARR_CONFORMANCE_REVISION}`)
const caseDirectory = join(process.cwd(), '.tmp', 'ome-zarr-conformance-cases')

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const checkoutRevision = async (): Promise<void> => {
  if (await exists(join(checkout, '.git'))) {
    const { stdout } = await exec('git', ['-C', checkout, 'rev-parse', 'HEAD'])
    if (stdout.trim() === OME_ZARR_CONFORMANCE_REVISION) return
  } else {
    await mkdir(dirname(checkout), { recursive: true })
    await exec('git', [
      'clone',
      '--quiet',
      '--no-checkout',
      OME_ZARR_CONFORMANCE_REPOSITORY,
      checkout,
    ])
  }
  await exec('git', ['-C', checkout, 'fetch', '--quiet', 'origin', OME_ZARR_CONFORMANCE_REVISION])
  await exec('git', [
    '-C',
    checkout,
    'checkout',
    '--quiet',
    '--detach',
    OME_ZARR_CONFORMANCE_REVISION,
  ])
  const { stdout } = await exec('git', ['-C', checkout, 'rev-parse', 'HEAD'])
  if (stdout.trim() !== OME_ZARR_CONFORMANCE_REVISION) {
    throw new Error('OME-Zarr conformance checkout revision mismatch')
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface OfficialCase {
  readonly id: string
  readonly expectedValid: boolean
  readonly attributes: Readonly<Record<string, unknown>>
  readonly strict: boolean
}

const suiteFiles = Object.freeze([
  'image_suite.json',
  'label_suite.json',
  'plate_suite.json',
  'well_suite.json',
  'strict_image_suite.json',
  'strict_label_suite.json',
  'strict_plate_suite.json',
  'strict_well_suite.json',
])

const readCases = async (): Promise<readonly OfficialCase[]> => {
  const cases: OfficialCase[] = []
  for (const filename of suiteFiles) {
    const parsed: unknown = JSON.parse(await readFile(join(checkout, 'tests', filename), 'utf8'))
    if (!isRecord(parsed) || !Array.isArray(parsed.tests)) {
      throw new Error(`Official OME-Zarr suite ${filename} is invalid`)
    }
    for (const [index, value] of parsed.tests.entries()) {
      if (!isRecord(value) || !isRecord(value.data) || typeof value.valid !== 'boolean') {
        throw new Error(`Official OME-Zarr suite ${filename} case ${index} is invalid`)
      }
      const former = typeof value.formerly === 'string' ? value.formerly : `case-${index}`
      cases.push(
        Object.freeze({
          id: `${filename.replace(/\.json$/u, '')}/${former.replace(/\.json$/u, '')}`,
          expectedValid: value.valid,
          attributes: value.data,
          strict: filename.startsWith('strict_'),
        }),
      )
    }
  }
  return Object.freeze(cases)
}

interface DingusOutput {
  readonly valid: boolean
  readonly message?: string
}

const parseDingusOutput = (value: string): DingusOutput => {
  const parsed: unknown = JSON.parse(value)
  if (!isRecord(parsed) || typeof parsed.valid !== 'boolean') {
    throw new Error('PureJsImage conformance dingus returned invalid JSON')
  }
  return Object.freeze({
    valid: parsed.valid,
    ...(typeof parsed.message === 'string' ? { message: parsed.message } : {}),
  })
}

interface CliOptions {
  readonly mode: 'stdout' | 'write' | 'check'
  readonly outputPath: string
}

const parseCli = (argv: readonly string[]): CliOptions => {
  const write = argv.includes('--write')
  const check = argv.includes('--check')
  if (write && check) throw new Error('Use only one of --write or --check')
  const outputIndex = argv.indexOf('--output')
  const output = outputIndex < 0 ? undefined : argv[outputIndex + 1]
  if (outputIndex >= 0 && (output === undefined || output.startsWith('--'))) {
    throw new Error('--output requires a path')
  }
  const recognized = new Set([
    '--write',
    '--check',
    ...(outputIndex < 0 ? [] : ['--output', output ?? '']),
  ])
  const unexpected = argv.find((entry) => !recognized.has(entry))
  if (unexpected !== undefined) throw new Error(`Unknown argument ${unexpected}`)
  return Object.freeze({
    mode: write ? 'write' : check ? 'check' : 'stdout',
    outputPath: resolve(process.cwd(), output ?? OME_ZARR_CONFORMANCE_REPORT_PATH),
  })
}

const cli = parseCli(process.argv.slice(2))
await checkoutRevision()
await mkdir(caseDirectory, { recursive: true })
const cases = await readCases()
const seenExclusions = new Set<string>()
const results = []
for (const [index, test] of cases.entries()) {
  const path = join(caseDirectory, `${index}.json`)
  await writeFile(path, `${JSON.stringify(test.attributes)}\n`)
  const { stdout } = await exec(process.execPath, [
    join(process.cwd(), 'scripts', 'ome-zarr-conformance.ts'),
    path,
  ])
  const output = parseDingusOutput(stdout)
  const exclusion = OME_ZARR_CONFORMANCE_EXCLUSION_BY_ID.get(test.id)
  if (exclusion !== undefined) {
    seenExclusions.add(test.id)
    if (
      test.expectedValid !== exclusion.expectedValid ||
      output.valid !== exclusion.pureJsImageValid
    ) {
      throw new Error(`OME-Zarr exclusion ${test.id} no longer matches the pinned case results`)
    }
  }
  results.push(
    Object.freeze({
      id: test.id,
      strict: test.strict,
      expectedValid: test.expectedValid,
      actualValid: output.valid,
      matchesExpected: exclusion === undefined && output.valid === test.expectedValid,
      excluded: exclusion !== undefined,
      ...(output.message === undefined ? {} : { message: output.message }),
    }),
  )
}

const missingExclusions = OME_ZARR_CONFORMANCE_EXCLUSIONS.filter(
  (entry) => !seenExclusions.has(entry.id),
)
if (missingExclusions.length > 0) {
  throw new Error(`Pinned OME-Zarr exclusions were not found: ${missingExclusions[0]?.id}`)
}

const normativeResults = results.filter((result) => !result.strict && !result.excluded)
const strictResults = results.filter((result) => result.strict && !result.excluded)
const report = Object.freeze({
  schemaVersion: 2,
  conformanceLevel: 'attributes',
  upstreamRepository: OME_ZARR_CONFORMANCE_REPOSITORY,
  upstreamRevision: OME_ZARR_CONFORMANCE_REVISION,
  omeZarrVersion: OME_ZARR_CONFORMANCE_VERSION,
  normative: Object.freeze({
    passed: normativeResults.filter((result) => result.matchesExpected).length,
    total: normativeResults.length,
  }),
  strict: Object.freeze({
    passed: strictResults.filter((result) => result.matchesExpected).length,
    total: strictResults.length,
    failures: Object.freeze(strictResults.filter((result) => !result.matchesExpected)),
  }),
  excludedCases: OME_ZARR_CONFORMANCE_EXCLUSIONS,
  unexpectedFailures: Object.freeze(normativeResults.filter((result) => !result.matchesExpected)),
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  platform: `${process.platform}/${process.arch}`,
})

const serialized = `${JSON.stringify(report, null, 2)}\n`
if (cli.mode === 'write') {
  await mkdir(dirname(cli.outputPath), { recursive: true })
  await writeFile(cli.outputPath, serialized)
} else if (cli.mode === 'check') {
  const checkedIn: unknown = JSON.parse(await readFile(cli.outputPath, 'utf8'))
  assertOmeZarrConformanceReportCurrent(checkedIn, report)
}
process.stdout.write(serialized)
if (report.normative.passed !== report.normative.total) process.exitCode = 1
