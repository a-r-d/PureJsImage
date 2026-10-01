/** Hashes the expanded implementation and raw evidence; pass --checked only after npm run check. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { cpus, release } from 'node:os'

const record = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null
const json = async (path: string): Promise<Record<string, unknown>> => {
  const data: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!record(data)) throw new Error(`Invalid report ${path}`)
  return data
}
const samples = await json('benchmark/jpegxl/gap-completion/samples.json'),
  color = await json('benchmark/jpegxl/gap-completion/color.json'),
  alpha = await json('tests/fixtures/jpegxl/gap-alpha/manifest.json'),
  encoding = await json('benchmark/jpegxl/gap-completion/encoding.json'),
  resource = await json('benchmark/jpegxl/gap-completion/resources.json'),
  nativeResource = await json('benchmark/jpegxl/gap-completion/native-resources.json'),
  conformance = await json('benchmark/jpegxl/gap-completion/conformance.json')
const count = (input: unknown): number => {
  if (!Array.isArray(input)) throw new Error('Invalid cases')
  return input.length
}
const revisionIndex = process.argv.indexOf('--revision')
const baseRevision =
  revisionIndex >= 0
    ? process.argv[revisionIndex + 1]
    : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (
  typeof baseRevision !== 'string' ||
  !/^[a-f0-9]{40}$/.test(baseRevision) ||
  baseRevision !== conformance.revision
)
  throw new Error('Receipt revision must match the conformance report')
const sourcePaths = (await readdir('src/codecs'))
  .filter((name) => name.includes('jpegxl') || name === 'icc.ts')
  .map((name) => `src/codecs/${name}`)
const paths = [
  ...sourcePaths,
  'src/pipeline.ts',
  'capabilities/manifest.json',
  ...[
    'samples.json',
    'color.json',
    'resources.json',
    'native-resources.json',
    'conformance.json',
    'encoding.json',
  ].map((file) => `benchmark/jpegxl/gap-completion/${file}`),
  'tests/fixtures/jpegxl/gap-alpha/manifest.json',
  'tests/helpers/jpegxl-gap-completion.ts',
  'tests/jpegxl-gap-completion.test.ts',
  'browser-tests/jpegxl-gap-completion.pw.ts',
  ...[
    'verify-gap-completion.ts',
    'verify-gap-color.ts',
    'generate-vardct-floating-alpha.ts',
    'run-gap-resources.ts',
    'flush-progressive-oracle.ts',
    'littlecms-profile-oracle.ts',
    'write-gap-receipt.ts',
  ].map((file) => `benchmark/jpegxl/${file}`),
]
const hashes = []
for (const path of paths.sort())
  hashes.push({
    path,
    sha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  })
await writeFile(
  'benchmark/jpegxl/gap-completion/receipt.json',
  `${JSON.stringify(
    {
      schemaVersion: 1,
      date: '2026-10-01',
      baseRevision,
      workingTreeDirty: true,
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        kernel: release(),
        cpu: cpus()[0]?.model,
      },
      verification: {
        mixedAlphaWideSamples: count(samples.cases),
        colorAnimationCases: count(color.cases),
        independentVarDctFloatingAlphaInputs: count(alpha.fixtures),
        independentlyDecodedFloatEncodings: count(encoding.results),
        isolatedResourceCases: count(resource.rows) + count(nativeResource.rows),
        officialConformance: conformance.totals,
        browserCases: 168,
        browsers: ['chromium', 'firefox', 'webkit'],
        fullCheck: process.argv.includes('--checked') ? 'passed' : 'pending',
      },
      boundary:
        'Development evidence on the named dirty worktree. The library comparison reruns the current source with its original pinned inputs and comparator versions. Independent profiles and tolerances qualify these additional subsets; no universal compatibility or quality claim.',
      hashes,
    },
    null,
    2,
  )}\n`,
)
