import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

interface VarDctDefinition {
  readonly id: string
  readonly source: string
  readonly width: number
  readonly height: number
  readonly bitDepth: 8
  readonly colorEncoding: 'grayscale D65 sRGB' | 'RGB D65 sRGB'
  readonly oracleExtension: 'pgm' | 'ppm'
  readonly features: readonly string[]
  readonly options: readonly string[]
  readonly expectedPureJsImageBehavior: 'supported' | 'unsupported'
}

const definitions: readonly VarDctDefinition[] = Object.freeze([
  Object.freeze({
    id: 'rgb8-distance1-effort1',
    source: 'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/input/rgb8-odd.pnm',
    width: 43,
    height: 35,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    oracleExtension: 'ppm',
    features: Object.freeze(['VarDCT', 'default XYB', 'single pass', 'odd dimensions']),
    options: Object.freeze(['--distance=1', '--effort=1']),
    expectedPureJsImageBehavior: 'supported',
  }),
  Object.freeze({
    id: 'rgb8-distance1-effort7',
    source: 'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/input/rgb8-odd.pnm',
    width: 43,
    height: 35,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    oracleExtension: 'ppm',
    features: Object.freeze(['VarDCT', 'default XYB', 'effort 7', 'odd dimensions']),
    options: Object.freeze(['--distance=1', '--effort=7']),
    expectedPureJsImageBehavior: 'unsupported',
  }),
  Object.freeze({
    id: 'rgb8-distance2-progressive',
    source: 'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/input/rgb8-odd.pnm',
    width: 43,
    height: 35,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    oracleExtension: 'ppm',
    features: Object.freeze(['VarDCT', 'default XYB', 'progressive passes', 'odd dimensions']),
    options: Object.freeze(['--distance=2', '--effort=9', '--progressive']),
    expectedPureJsImageBehavior: 'unsupported',
  }),
  Object.freeze({
    id: 'rgb8-distance4-noise',
    source: 'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/input/rgb8-odd.pnm',
    width: 43,
    height: 35,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    oracleExtension: 'ppm',
    features: Object.freeze(['VarDCT', 'default XYB', 'synthetic noise', 'odd dimensions']),
    options: Object.freeze(['--distance=4', '--effort=5', '--photon_noise_iso=100']),
    expectedPureJsImageBehavior: 'unsupported',
  }),
  Object.freeze({
    id: 'gray8-distance1-effort3',
    source: 'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/input/gray8-odd.pnm',
    width: 37,
    height: 29,
    bitDepth: 8,
    colorEncoding: 'grayscale D65 sRGB',
    oracleExtension: 'pgm',
    features: Object.freeze(['VarDCT', 'grayscale', 'single pass', 'odd dimensions']),
    options: Object.freeze(['--distance=1', '--effort=3']),
    expectedPureJsImageBehavior: 'supported',
  }),
])

const run = async (command: string, arguments_: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with status ${code ?? 'unknown'}`))
    })
  })

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const binaryDirectory = process.argv[2]
if (!binaryDirectory) {
  throw new Error('Usage: node generate-vardct-corpus.ts <libjxl-tools-directory>')
}

const outputDirectory = 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0'
await mkdir(outputDirectory, { recursive: true })
const entries = []
for (const definition of definitions) {
  const output = join(outputDirectory, `${definition.id}.jxl`)
  const oracle = join(outputDirectory, `${definition.id}.oracle.${definition.oracleExtension}`)
  await mkdir(dirname(output), { recursive: true })
  const encoderOptions = ['--modular=0', '--num_threads=1', ...definition.options] as const
  await run(join(binaryDirectory, 'cjxl'), [definition.source, output, ...encoderOptions])
  await run(join(binaryDirectory, 'djxl'), [output, oracle, '--bits_per_sample=8'])
  const sourceBytes = await readFile(definition.source)
  const outputBytes = await readFile(output)
  const oracleBytes = await readFile(oracle)
  entries.push(
    Object.freeze({
      id: definition.id,
      source: definition.source,
      generator: 'benchmark/jpegxl/generate-vardct-corpus.ts',
      license: 'CC0',
      redistribution: 'generated fixture may be redistributed',
      width: definition.width,
      height: definition.height,
      bitDepth: definition.bitDepth,
      colorEncoding: definition.colorEncoding,
      alpha: 'none',
      coding: 'vardct',
      level: 'unknown',
      container: 'raw',
      preview: false,
      progressive: definition.options.includes('--progressive'),
      patches: 'unknown',
      splines: 'unknown',
      noise: definition.options.some((option) => option.startsWith('--photon_noise_iso=')),
      restorationFilters: Object.freeze(['Gaborish default', 'EPF default']),
      extraChannels: Object.freeze([]),
      jpegReconstruction: false,
      expectedPureJsImageBehavior: definition.expectedPureJsImageBehavior,
      features: definition.features,
      options: Object.freeze(encoderOptions),
      inputSha256: sha256(sourceBytes),
      jxl: output,
      jxlSha256: sha256(outputBytes),
      jxlBytes: outputBytes.byteLength,
      oracle,
      oracleSha256: sha256(oracleBytes),
      oracleBytes: oracleBytes.byteLength,
    }),
  )
}

const manifest = Object.freeze({
  oracle: 'libjxl cjxl and djxl v0.12.0',
  revision: 'a7a9c787341cf703dede03c2009fa460cae5e5df',
  sourceArchiveSha256: '818398895831069902e3677d285054a7d1255b11b221e94c6aaa1cb83b0a3f29',
  license: 'BSD-3-Clause development oracle; generated pixel patterns are CC0',
  fixtures: Object.freeze(entries),
})

await writeFile(
  'benchmark/jpegxl/generated-vardct-manifest.json',
  `${JSON.stringify(manifest, undefined, 2)}\n`,
)
