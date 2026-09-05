import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { PNG } from 'pngjs'

interface VarDctDefinition {
  readonly id: string
  readonly source: string
  readonly width: number
  readonly height: number
  readonly bitDepth: 8
  readonly colorEncoding: 'grayscale D65 sRGB' | 'RGB D65 sRGB'
  readonly alpha: 'none' | 'straight 8-bit'
  readonly oracleExtension: 'pam' | 'pgm' | 'ppm'
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
    alpha: 'none',
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
    alpha: 'none',
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
    alpha: 'none',
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
    alpha: 'none',
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
    alpha: 'none',
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
    alpha: 'none',
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
    alpha: 'none',
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
    alpha: 'none',
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
    alpha: 'none',
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
    alpha: 'none',
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
    alpha: 'none',
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
  Object.freeze({
    id: 'rgb8-distance4-dct4x4',
    source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/rgb8-513x385.pnm',
    width: 513,
    height: 385,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    alpha: 'none',
    oracleExtension: 'ppm',
    features: Object.freeze(['VarDCT', 'DCT4x4 strategy', 'multiple groups']),
    options: Object.freeze(['--distance=4', '--effort=5']),
    expectedPureJsImageBehavior: 'supported',
  }),
  ...([2, 4, 8] as const).map((factor) =>
    Object.freeze({
      id: `rgb8-distance${factor}-resampling${factor}`,
      source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/rgb8-513x385.pnm',
      width: 513,
      height: 385,
      bitDepth: 8 as const,
      colorEncoding: 'RGB D65 sRGB' as const,
      alpha: 'none' as const,
      oracleExtension: 'ppm' as const,
      features: Object.freeze(['VarDCT', `${factor}x upsampling`, 'odd dimensions']),
      options: Object.freeze([`--distance=${factor}`, '--effort=5', `--resampling=${factor}`]),
      expectedPureJsImageBehavior: 'supported' as const,
    }),
  ),
  Object.freeze({
    id: 'rgba8-distance1-alpha',
    source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/rgba8-257x193.pam',
    width: 257,
    height: 193,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    alpha: 'straight 8-bit',
    oracleExtension: 'pam',
    features: Object.freeze(['VarDCT', '8-bit alpha', 'grouped extra channel', 'odd dimensions']),
    options: Object.freeze(['--distance=1', '--effort=5', '--alpha_distance=0']),
    expectedPureJsImageBehavior: 'supported',
  }),
  Object.freeze({
    id: 'rgb8-distance1-progressive-dc2',
    source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/rgb8-513x385.pnm',
    width: 513,
    height: 385,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    alpha: 'none',
    oracleExtension: 'ppm',
    features: Object.freeze(['VarDCT', 'progressive DC level 2', 'internal frame dependencies']),
    options: Object.freeze(['--distance=1', '--effort=9', '--progressive', '--progressive_dc=2']),
    expectedPureJsImageBehavior: 'supported',
  }),
  Object.freeze({
    id: 'gray8-distance1-patches',
    source: 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/input/gray8-patches.pgm',
    width: 1011,
    height: 277,
    bitDepth: 8,
    colorEncoding: 'grayscale D65 sRGB',
    alpha: 'none',
    oracleExtension: 'pgm',
    features: Object.freeze(['VarDCT', 'patch dictionary', 'Modular reference frame']),
    options: Object.freeze(['--distance=1', '--effort=9', '--patches=1']),
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

const createRgba8Pam = (width: number, height: number): Uint8Array => {
  const header = new TextEncoder().encode(
    `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
  )
  const output = new Uint8Array(header.byteLength + width * height * 4)
  output.set(header)
  let offset = header.byteLength
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      output[offset] = (x * 13 + y * 3) & 255
      output[offset + 1] = (x * 5 + y * 11) & 255
      output[offset + 2] = (x * 7 + y * 19) & 255
      output[offset + 3] = (x * 17 + y * 23 + 31) & 255
      offset += 4
    }
  }
  return output
}

const createPatchPgm = (pngBytes: Uint8Array): Uint8Array => {
  const decoded = PNG.sync.read(Buffer.from(pngBytes))
  const { width, height } = decoded
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`)
  const output = new Uint8Array(header.byteLength + width * height)
  output.set(header)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      output[header.byteLength + y * width + x] = decoded.data[(y * width + x) * 4] ?? 0
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
await writeFile(join(outputDirectory, 'input', 'rgba8-257x193.pam'), createRgba8Pam(257, 193))
const libjxlSourceDirectory = resolve(binaryDirectory, '../..')
await writeFile(
  join(outputDirectory, 'input', 'gray8-patches.pgm'),
  createPatchPgm(await readFile(join(libjxlSourceDirectory, 'testdata/jxl/grayscale_patches.png'))),
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
      alpha: definition.alpha,
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

const splineSource = join(libjxlSourceDirectory, 'testdata/jxl/splines.jxl')
const splineOutput = join(outputDirectory, 'rgb8-static-splines.jxl')
const splineOracle = join(outputDirectory, 'rgb8-static-splines.oracle.ppm')
const splineBytes = await readFile(splineSource)
await writeFile(splineOutput, splineBytes)
await run(join(binaryDirectory, 'djxl'), [splineOutput, splineOracle, '--bits_per_sample=8'])
const splineOracleBytes = await readFile(splineOracle)
entries.push(
  Object.freeze({
    id: 'rgb8-static-splines',
    source:
      'https://github.com/libjxl/libjxl/blob/a7a9c787341cf703dede03c2009fa460cae5e5df/testdata/jxl/splines.jxl',
    generator: 'benchmark/jpegxl/generate-vardct-corpus.ts',
    license: 'BSD-3-Clause',
    redistribution: 'upstream libjxl test fixture may be redistributed under BSD-3-Clause',
    width: 320,
    height: 320,
    bitDepth: 8,
    colorEncoding: 'RGB D65 sRGB',
    alpha: 'none',
    coding: 'modular',
    level: 'unknown',
    container: 'raw',
    preview: false,
    progressive: false,
    patches: false,
    splines: true,
    noise: false,
    restorationFilters: Object.freeze([]),
    extraChannels: Object.freeze([]),
    jpegReconstruction: false,
    expectedPureJsImageBehavior: 'supported',
    features: Object.freeze(['static spline syntax', 'image-level spline rendering']),
    options: Object.freeze(['upstream jxl_from_tree fixture']),
    inputSha256: sha256(splineBytes),
    jxl: splineOutput,
    jxlSha256: sha256(splineBytes),
    jxlBytes: splineBytes.byteLength,
    oracle: splineOracle,
    oracleSha256: sha256(splineOracleBytes),
    oracleBytes: splineOracleBytes.byteLength,
  }),
)

const manifest = Object.freeze({
  oracle: 'libjxl cjxl and djxl v0.12.0',
  revision: 'a7a9c787341cf703dede03c2009fa460cae5e5df',
  sourceArchiveSha256: '818398895831069902e3677d285054a7d1255b11b221e94c6aaa1cb83b0a3f29',
  license: 'BSD-3-Clause development oracle; generated pixel patterns are CC0',
  implementedStrategyIds: Object.freeze([
    0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  ]),
  unsupportedStrategyIds: Object.freeze([8, 9, 21, 22, 23, 24, 25, 26]),
  fixtures: Object.freeze(entries),
})

await writeFile(
  'benchmark/jpegxl/generated-vardct-manifest.json',
  `${JSON.stringify(manifest, undefined, 2)}\n`,
)
