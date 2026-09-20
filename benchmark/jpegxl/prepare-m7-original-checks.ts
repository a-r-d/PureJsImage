import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import plan from './production-program/m7-bounded-quality-protocol.json' with { type: 'json' }
import corpus from './production-program/m7-corpus-selection.json' with { type: 'json' }

const root = '.tmp/jpegxl-m7/original052-snapshot'
const fixtures = '.tmp/jpegxl-m7/original052-fixtures'
await mkdir(root)
await mkdir(`${root}/benchmark/jpegxl/production-program`, { recursive: true })
await cp('src', `${root}/src`, { recursive: true })
await cp('package.json', `${root}/package.json`)
await symlink(`${process.cwd()}/node_modules`, `${root}/node_modules`)
for (const file of ['m7-quality-decoding.ts', 'production-program/m7-corpus-selection.json'])
  await cp(`benchmark/jpegxl/${file}`, `${root}/benchmark/jpegxl/${file}`)
const cases = plan.originalSizeChecks.ids.map((id) => ({
  id,
  reason: 'Frozen original-resolution supplement',
  preparation: { kind: 'resize' },
}))
await writeFile(
  `${root}/benchmark/jpegxl/m7-diagnostic-cases.ts`,
  `export const m7DiagnosticCases = ${JSON.stringify(cases)}\nexport function m7DiagnosticGeometry(width: number, height: number, _preparation: unknown) { return {left: 0, top: 0, width, height} }\n`,
)
let script = await readFile('benchmark/jpegxl/run-m7-diagnostic.ts', 'utf8')
const diagnosticOutput = `\`.tmp/jpegxl-m7/diagnostic-\${runId}\``
const originalOutput = `\`.tmp/jpegxl-m7/original052-\${runId}\``
// Reuse the diagnostic measurement loop in an isolated first-party snapshot.
// Assert its frozen shape before adapting only selection, dimensions and distances.
for (const [fragment, count] of [
  ["const fixtures = '.tmp/jpegxl-m7/diagnostic-fixtures-v1'", 1],
  [" && row.split === 'development'", 2],
  ['for (const distance of [1, 2, 3])', 1],
  [diagnosticOutput, 1],
] as const) {
  if (script.split(fragment).length !== count + 1)
    throw new Error('Diagnostic harness changed; review the original-size adaptation')
}
if (!/const policy =\n {2}'[^']*'/u.test(script)) throw new Error('Diagnostic policy changed')
script = script.replace(
  "const fixtures = '.tmp/jpegxl-m7/diagnostic-fixtures-v1'",
  `const fixtures = '${fixtures}'`,
)
script = script.replaceAll(" && row.split === 'development'", '')
script = script.replace('for (const distance of [1, 2, 3])', 'for (const distance of [1, 3])')
script = script.replace(diagnosticOutput, originalOutput)
script = script.replace(
  /const policy =\n {2}'[^']*'/u,
  `const policy = ${JSON.stringify('Frozen eight-source original-resolution supplement, four development and four holdout cases, effort 7 distances 1 and 3, first-party and native libjxl. All first-party streams checked with native, Rust and repository decoders. Both metrics and visual review supplement the approved capped matrix. No all-source original-resolution quality claim.')}`,
)
await writeFile(`${root}/benchmark/jpegxl/run-m7-diagnostic.ts`, script)
await mkdir(fixtures)
sharp.concurrency(1)
sharp.cache(false)
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const results = []
for (const id of plan.originalSizeChecks.ids) {
  const entry = corpus.cases.find((row) => row.id === id)
  if (!entry) throw new Error('Missing original-size case')
  const source = await readFile(`.tmp/jpegxl-m7/sources/${id}.${entry.format}`)
  if (hash(source) !== entry.sourceSha256) throw new Error('Source hash mismatch')
  const { data, info } = await sharp(source)
    .withIccProfile('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== entry.width || info.height !== entry.height || info.channels !== 3)
    throw new Error('Original dimensions changed')
  const header = new TextEncoder().encode(`P6\n${info.width} ${info.height}\n255\n`)
  const ppm = new Uint8Array(header.length + data.length)
  ppm.set(header)
  ppm.set(data, header.length)
  await writeFile(`${fixtures}/${id}.ppm`, ppm, { flag: 'wx' })
  results.push({
    id,
    split: entry.split,
    width: info.width,
    height: info.height,
    sourceSha256: entry.sourceSha256,
    normalizedSha256: hash(data),
  })
}
const encoderSources = []
for (const name of [
  'jpegxl-vardct-encode.ts',
  'jpegxl-vardct-quantization.ts',
  'jpegxl-vardct-forward-transforms.ts',
  'jpegxl-jpeg-encode.ts',
  'jpegxl-modular-encode.ts',
  'jpegxl-encoder-memory.ts',
  'icc.ts',
  'jpegxl-decode.ts',
]) {
  const path = `src/codecs/${name}`
  const sha256 = hash(await readFile(path))
  if (hash(await readFile(`${root}/${path}`)) !== sha256)
    throw new Error('Original-check snapshot differs from current source')
  encoderSources.push({ path, sha256 })
}
await writeFile(
  `${fixtures}/manifest.json`,
  `${JSON.stringify({ plan, results, encoderSources, preparationHarnessSha256: hash(await readFile(import.meta.filename)) }, null, 2)}\n`,
)
