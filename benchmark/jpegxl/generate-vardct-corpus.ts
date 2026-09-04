import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
    expectedPureJsImageBehavior: 'supported',
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
    expectedPureJsImageBehavior: 'supported',
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
    expectedPureJsImageBehavior: 'supported',
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
  Object.freeze({
    id: 'rgb8-distance1-single-group-255',
    source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/rgb8-255x255.pnm',
    width: 255,
    height: 255,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    oracleExtension: 'ppm',
    features: Object.freeze([
      'VarDCT',
      'default XYB',
      'near-boundary single group',
      'memory evidence',
    ]),
    options: Object.freeze(['--distance=1', '--effort=1']),
    expectedPureJsImageBehavior: 'supported',
  }),
  Object.freeze({
    id: 'rgb8-distance1-multi-group-odd',
    source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/rgb8-513x385.pnm',
    width: 513,
    height: 385,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    oracleExtension: 'ppm',
    features: Object.freeze([
      'VarDCT',
      'default XYB',
      'multiple groups',
      'odd dimensions',
      'group-boundary restoration',
    ]),
    options: Object.freeze(['--distance=1', '--effort=1']),
    expectedPureJsImageBehavior: 'supported',
  }),
  Object.freeze({
    id: 'rgb8-distance1-large-transform',
    source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/rgb8-513x385-gradient.pnm',
    width: 513,
    height: 385,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    oracleExtension: 'ppm',
    features: Object.freeze([
      'VarDCT',
      'default XYB',
      'multiple groups',
      'large transform strategy',
      'smooth gradient',
    ]),
    options: Object.freeze(['--distance=1', '--effort=5']),
    expectedPureJsImageBehavior: 'supported',
  }),
  Object.freeze({
    id: 'rgb8-distance1-hornuss',
    source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/rgb8-513x385.pnm',
    width: 513,
    height: 385,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    oracleExtension: 'ppm',
    features: Object.freeze(['VarDCT', 'default XYB', 'Hornuss', 'multiple groups']),
    options: Object.freeze(['--distance=1', '--effort=5']),
    expectedPureJsImageBehavior: 'supported',
  }),
  Object.freeze({
    id: 'rgb8-distance1-strategy-mix',
    source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/rgb8-513x385-blocks.pnm',
    width: 513,
    height: 385,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    oracleExtension: 'ppm',
    features: Object.freeze([
      'VarDCT',
      'default XYB',
      'rectangular strategies',
      'large transform strategies',
      'multiple groups',
    ]),
    options: Object.freeze(['--distance=1', '--effort=5']),
    expectedPureJsImageBehavior: 'supported',
  }),
  Object.freeze({
    id: 'rgb8-distance1-multi-group-progressive',
    source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/rgb8-513x385.pnm',
    width: 513,
    height: 385,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    oracleExtension: 'ppm',
    features: Object.freeze([
      'VarDCT',
      'default XYB',
      'multiple groups',
      'progressive passes',
      'local DC group transforms',
    ]),
    options: Object.freeze(['--distance=1', '--effort=9', '--progressive']),
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

const createRgb8Pnm = (width: number, height: number): Uint8Array => {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
  const output = new Uint8Array(header.byteLength + width * height * 3)
  output.set(header)
  let offset = header.byteLength
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      output[offset] = (x * 13 + y * 3 + ((x >>> 3) ^ (y >>> 3)) * 17) & 255
      output[offset + 1] = (x * 5 + y * 11 + ((x + y) >>> 2)) & 255
      output[offset + 2] = (x * 7 + y * 19 + (x >>> 4) * (y >>> 4)) & 255
      offset += 3
    }
  }
  return output
}

const createRgb8GradientPnm = (width: number, height: number): Uint8Array => {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
  const output = new Uint8Array(header.byteLength + width * height * 3)
  output.set(header)
  let offset = header.byteLength
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      output[offset] = Math.round(16 + (224 * x) / (width - 1))
      output[offset + 1] = Math.round(32 + (160 * y) / (height - 1))
      output[offset + 2] = Math.round(64 + (128 * (x + y)) / (width + height - 2))
      offset += 3
    }
  }
  return output
}

const createRgb8BlocksPnm = (width: number, height: number): Uint8Array => {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
  const output = new Uint8Array(header.byteLength + width * height * 3)
  output.set(header)
  let offset = header.byteLength
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let color: readonly [number, number, number] = [128, 128, 128]
      if (x <= 240 && y <= 180) color = [32, 48, 80]
      else if (x >= 270 && y <= 190) color = [208, 176, 112]
      else if (x <= 250 && y >= 210) color = [64, 96, 48]
      else if (x >= 280 && y >= 220) color = [112, 64, 96]
      output[offset] = color[0]
      output[offset + 1] = color[1]
      output[offset + 2] = color[2]
      offset += 3
    }
  }
  return output
}

const binaryDirectory = process.argv[2]
if (!binaryDirectory) {
  throw new Error('Usage: node generate-vardct-corpus.ts <libjxl-tools-directory>')
}

const outputDirectory = 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0'
await mkdir(outputDirectory, { recursive: true })
await mkdir(join(outputDirectory, 'input'), { recursive: true })
await writeFile(join(outputDirectory, 'input', 'rgb8-255x255.pnm'), createRgb8Pnm(255, 255))
await writeFile(join(outputDirectory, 'input', 'rgb8-513x385.pnm'), createRgb8Pnm(513, 385))
await writeFile(
  join(outputDirectory, 'input', 'rgb8-513x385-gradient.pnm'),
  createRgb8GradientPnm(513, 385),
)
await writeFile(
  join(outputDirectory, 'input', 'rgb8-513x385-blocks.pnm'),
  createRgb8BlocksPnm(513, 385),
)
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
  implementedStrategyIds: Object.freeze([
    0, 1, 2, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  ]),
  unsupportedStrategyIds: Object.freeze([3, 8, 9, 21, 22, 23, 24, 25, 26]),
  fixtures: Object.freeze(entries),
})

await writeFile(
  'benchmark/jpegxl/generated-vardct-manifest.json',
  `${JSON.stringify(manifest, undefined, 2)}\n`,
)
