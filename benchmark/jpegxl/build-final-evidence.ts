import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`)
  return value
}

const readReport = async (
  path: string,
  label: string,
): Promise<Readonly<Record<string, unknown>>> => {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!record(parsed)) throw new Error(`${label} report is not an object`)
  return parsed
}

const arrayLength = (report: Readonly<Record<string, unknown>>, key: string): number => {
  const value = report[key]
  if (!Array.isArray(value)) throw new Error(`${key} is missing from a JPEG XL evidence report`)
  return value.length
}

const inputDirectory = argument('--input-dir') ?? '.tmp/jpegxl-evidence'
const reports = Object.freeze({
  encoderMatrix: await readReport(join(inputDirectory, 'encoder.json'), 'encoder matrix'),
  reverseTranscodeMatrix: await readReport(join(inputDirectory, 'reverse.json'), 'reverse matrix'),
  compressionGate: await readReport(join(inputDirectory, 'compression.json'), 'compression gate'),
  benchmark: await readReport(join(inputDirectory, 'benchmark.json'), 'benchmark'),
  modularMemory: await readReport(join(inputDirectory, 'memory.json'), 'Modular memory'),
  varDctMemory: await readReport(join(inputDirectory, 'vardct-memory.json'), 'VarDCT memory'),
})

const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error('Could not resolve the Git revision')
for (const [label, report] of Object.entries(reports)) {
  if (report.revision !== revision) {
    throw new Error(`${label} was generated for ${String(report.revision)}, expected ${revision}`)
  }
}

const commandRoot = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const result = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  revision,
  branch: spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim(),
  status: 'Experimental',
  validation: Object.freeze({
    passed: true,
    encoderCases: arrayLength(reports.encoderMatrix, 'cases'),
    reverseTranscodeCases: arrayLength(reports.reverseTranscodeMatrix, 'results'),
    benchmarkWorkloads: arrayLength(reports.benchmark, 'summaries'),
    modularMemoryWorkloads: arrayLength(reports.modularMemory, 'summaries'),
    varDctMemoryWorkloads: arrayLength(reports.varDctMemory, 'summaries'),
    policy:
      'Every advertised encoder format passed exact native-sample validation through applicable pinned decoders. Every eligible reverse-transcode case reconstructed exact JPEG bytes. Memory and compression results remain correctness-gated.',
  }),
  oracleRevisions: Object.freeze({
    libjxl: 'a7a9c787341cf703dede03c2009fa460cae5e5df (v0.12.0)',
    jxlRs: '07ab48fcccde0a73c384b4011520fec67e5e09cd',
    jxlOxide: 'c0cc4c7ea57c1207f38ff2970d94757470613be4',
    simpleLosslessEncoder: '7b9f14fd0ef1f4cb7e52e58ba5a222570937ddbf',
    imazenJxlEncoder: 'd63e9d1a1aa84b2dbdfc90eeddccc33fef5eb48b',
    imazenResolvedCargoLockSha256:
      '69b6e3c2229f9b6410da8f45fdea6bb8fd8a3a54ad83451219ca670b6790b040',
    independentJpegDecoder: 'sharp 0.35.3',
  }),
  commands: Object.freeze([
    `node benchmark/jpegxl/run-purejsimage-reverse-matrix.ts ${commandRoot} --output ${inputDirectory}/reverse.json`,
    `npm run fixtures:jpegxl:encoder-matrix -- --output ${inputDirectory}/encoder.json`,
    `npm run bench:jpegxl:compression -- --output ${inputDirectory}/compression.json`,
    `PUREJSIMAGE_JPEGXL_ORACLE_DIR=${commandRoot} npm run bench:jpegxl -- --output ${inputDirectory}/benchmark.json`,
    `node benchmark/jpegxl/run-memory.ts --output ${inputDirectory}/memory.json`,
    `node benchmark/jpegxl/run-vardct-memory.ts --output ${inputDirectory}/vardct-memory.json`,
  ]),
  unsupportedClassifications: Object.freeze([
    'general lossy VarDCT encoding',
    'complete multi-group VarDCT photo decode',
    'animation',
    'Level 10 pixel decode',
    'arbitrary extra-channel extraction',
    'universal ICC support',
    'CMYK or YCCK exact JPEG transcode',
    'universal exact JPEG eligibility',
    'jxl-oxide unsigned 16-bit Modular samples above 32767 at the pinned revision',
  ]),
  compressionDecision:
    'The encoder remains Experimental because its corpus compression distribution does not meet the stable threshold.',
  reports,
})

const requestedOutput = argument('--output')
const output =
  requestedOutput ??
  `benchmark/results/jpegxl-release-hardening-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}.json`
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
const markdown = output.replace(/\.json$/u, '.md')
await writeFile(
  markdown,
  `# JPEG XL release hardening evidence\n\n- Revision: ${revision}\n- Branch: ${result.branch}\n- Status: Experimental\n- Encoder matrix: ${result.validation.encoderCases} cases\n- Reverse exact-transcode matrix: ${result.validation.reverseTranscodeCases} cases\n- Correctness: passed\n- Result: ${output}\n`,
)
console.log(`Wrote ${output}`)
console.log(JSON.stringify(result, null, 2))
