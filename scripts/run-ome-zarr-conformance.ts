import { execFile } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repository = 'https://github.com/ome/ngff-spec.git'
const revision = '69b136f1e64e68fead11216ac8dd3f1155668d04'
const checkout = join(process.cwd(), '.tmp', `ngff-spec-${revision}`)
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
    if (stdout.trim() === revision) return
  } else {
    await mkdir(dirname(checkout), { recursive: true })
    await exec('git', ['clone', '--quiet', '--no-checkout', repository, checkout])
  }
  await exec('git', ['-C', checkout, 'fetch', '--quiet', 'origin', revision])
  await exec('git', ['-C', checkout, 'checkout', '--quiet', '--detach', revision])
  const { stdout } = await exec('git', ['-C', checkout, 'rev-parse', 'HEAD'])
  if (stdout.trim() !== revision) throw new Error('OME-Zarr conformance checkout revision mismatch')
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

const suiteDrift = new Map<string, string>([
  [
    'plate_suite/plate/minimal_no_acquisitions',
    'The finalized 0.5 report requires plate.version, but this suite case omits it.',
  ],
  [
    'plate_suite/plate/minimal_acquisitions',
    'The finalized 0.5 report requires plate.version, but this suite case omits it.',
  ],
  [
    'plate_suite/plate/non_alphanumeric_row',
    'The finalized 0.5 report requires alphanumeric row names, but this suite case expects otherwise.',
  ],
  [
    'strict_plate_suite/plate/strict_no_acquisitions',
    'The finalized 0.5 report requires plate.version, but this suite case omits it.',
  ],
  [
    'strict_plate_suite/plate/strict_acquisitions',
    'The finalized 0.5 report requires plate.version, but this suite case omits it.',
  ],
])

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

await checkoutRevision()
await mkdir(caseDirectory, { recursive: true })
const cases = await readCases()
const results = []
for (const [index, test] of cases.entries()) {
  const path = join(caseDirectory, `${index}.json`)
  await writeFile(path, `${JSON.stringify(test.attributes)}\n`)
  const { stdout } = await exec(process.execPath, [
    join(process.cwd(), 'scripts', 'ome-zarr-conformance.ts'),
    path,
  ])
  const output = parseDingusOutput(stdout)
  const excludedReason = suiteDrift.get(test.id)
  results.push(
    Object.freeze({
      id: test.id,
      strict: test.strict,
      expectedValid: test.expectedValid,
      actualValid: output.valid,
      pass: output.valid === test.expectedValid,
      ...(excludedReason === undefined ? {} : { excludedReason }),
      ...(output.message === undefined ? {} : { message: output.message }),
    }),
  )
}

const specResults = results.filter(
  (result) => !result.strict && result.excludedReason === undefined,
)
const strictResults = results.filter(
  (result) => result.strict && result.excludedReason === undefined,
)
const report = Object.freeze({
  schemaVersion: 1,
  source: Object.freeze({ repository, revision, specification: '0.5' }),
  normative: Object.freeze({
    passed: specResults.filter((result) => result.pass).length,
    total: specResults.length,
  }),
  strict: Object.freeze({
    passed: strictResults.filter((result) => result.pass).length,
    total: strictResults.length,
  }),
  exclusions: Object.freeze(
    results
      .filter((result) => result.excludedReason !== undefined)
      .map((result) => ({ id: result.id, reason: result.excludedReason })),
  ),
  failures: Object.freeze(
    results.filter((result) => !result.pass && result.excludedReason === undefined),
  ),
})
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (report.normative.passed !== report.normative.total) process.exitCode = 1
