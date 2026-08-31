import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { inspectJpegXlStructure } from '../../src/codecs/jpegxl.ts'

type SampleDepth = 8 | 10 | 12 | 16
type InputKind = 'gray' | 'rgb' | 'rgba'

interface SourceDefinition {
  readonly id: string
  readonly kind: InputKind
  readonly width: number
  readonly height: number
  readonly bitDepth: SampleDepth
}

interface EncodeDefinition {
  readonly id: string
  readonly source: string
  readonly features: readonly string[]
  readonly options: readonly string[]
  readonly outputFormat?: 'pam'
}

const sourceDefinitions: readonly SourceDefinition[] = Object.freeze([
  Object.freeze({ id: 'gray8-odd', kind: 'gray', width: 37, height: 29, bitDepth: 8 }),
  Object.freeze({ id: 'gray16-odd', kind: 'gray', width: 41, height: 31, bitDepth: 16 }),
  Object.freeze({ id: 'rgb8-odd', kind: 'rgb', width: 43, height: 35, bitDepth: 8 }),
  Object.freeze({ id: 'rgb10-odd', kind: 'rgb', width: 39, height: 33, bitDepth: 10 }),
  Object.freeze({ id: 'rgb12-odd', kind: 'rgb', width: 45, height: 37, bitDepth: 12 }),
  Object.freeze({ id: 'rgb16-odd', kind: 'rgb', width: 47, height: 39, bitDepth: 16 }),
  Object.freeze({ id: 'rgba8-transparent', kind: 'rgba', width: 37, height: 31, bitDepth: 8 }),
  Object.freeze({ id: 'rgba10-transparent', kind: 'rgba', width: 39, height: 33, bitDepth: 10 }),
  Object.freeze({ id: 'rgba12-transparent', kind: 'rgba', width: 41, height: 35, bitDepth: 12 }),
  Object.freeze({ id: 'rgba16-transparent', kind: 'rgba', width: 35, height: 33, bitDepth: 16 }),
  Object.freeze({ id: 'gray8-groups', kind: 'gray', width: 775, height: 643, bitDepth: 8 }),
  Object.freeze({ id: 'rgb8-groups', kind: 'rgb', width: 769, height: 641, bitDepth: 8 }),
])

const predictorCases: readonly EncodeDefinition[] = Object.freeze(
  Array.from({ length: 14 }, (_, predictor) =>
    Object.freeze({
      id: `rgb8-predictor-${predictor}`,
      source: 'rgb8-odd',
      features: Object.freeze([`Modular predictor ${predictor}`, 'local fixed tree']),
      options: Object.freeze(['--iterations=0', `--modular_predictor=${predictor}`]),
    }),
  ),
)

const encodeDefinitions: readonly EncodeDefinition[] = Object.freeze([
  ...predictorCases,
  Object.freeze({
    id: 'gray8-default',
    source: 'gray8-odd',
    features: Object.freeze(['8-bit grayscale', 'local MA tree', 'odd dimensions']),
    options: Object.freeze(['--effort=7']),
  }),
  Object.freeze({
    id: 'gray16-default',
    source: 'gray16-odd',
    features: Object.freeze(['16-bit grayscale', 'local MA tree', 'odd dimensions']),
    options: Object.freeze(['--effort=7']),
  }),
  ...([8, 10, 12, 16] as const).map((bitDepth) =>
    Object.freeze({
      id: `rgb${bitDepth}-default`,
      source: `rgb${bitDepth}-odd`,
      features: Object.freeze([`${bitDepth}-bit RGB`, 'local MA tree', 'odd dimensions']),
      options: Object.freeze(['--effort=7']),
    }),
  ),
  Object.freeze({
    id: 'rgba8-straight',
    source: 'rgba8-transparent',
    features: Object.freeze(['8-bit RGBA', 'straight alpha', 'transparent colors']),
    options: Object.freeze(['--effort=7', '--premultiply=0', '--keep_invisible=1']),
    outputFormat: 'pam',
  }),
  Object.freeze({
    id: 'rgba8-premultiplied',
    source: 'rgba8-transparent',
    features: Object.freeze(['8-bit RGBA', 'premultiplied alpha', 'transparent colors']),
    options: Object.freeze(['--effort=7', '--premultiply=1', '--keep_invisible=1']),
    outputFormat: 'pam',
  }),
  ...([10, 12, 16] as const).map((bitDepth) =>
    Object.freeze({
      id: `rgba${bitDepth}-straight`,
      source: `rgba${bitDepth}-transparent`,
      features: Object.freeze([`${bitDepth}-bit RGBA`, 'straight alpha', 'transparent colors']),
      options: Object.freeze(['--effort=7', '--premultiply=0', '--keep_invisible=1']),
      outputFormat: 'pam' as const,
    }),
  ),
  Object.freeze({
    id: 'rgb8-palette',
    source: 'rgb8-odd',
    features: Object.freeze(['ordinary Palette transform']),
    options: Object.freeze(['--effort=9', '--modular_palette_colors=256']),
  }),
  Object.freeze({
    id: 'rgb8-delta-palette',
    source: 'rgb8-odd',
    features: Object.freeze(['delta Palette transform', 'palette-index prediction']),
    options: Object.freeze([
      '--effort=9',
      '--modular_colorspace=0',
      '--modular_lossy_palette',
      '--modular_palette_colors=0',
    ]),
  }),
  Object.freeze({
    id: 'rgb8-squeeze',
    source: 'rgb8-odd',
    features: Object.freeze(['horizontal squeeze', 'vertical squeeze', 'odd-dimension squeeze']),
    options: Object.freeze(['--effort=7', '--responsive=1']),
  }),
  Object.freeze({
    id: 'gray8-multiple-groups',
    source: 'gray8-groups',
    features: Object.freeze(['multiple groups', 'global and local MA trees']),
    options: Object.freeze(['--effort=7', '--modular_group_size=0']),
  }),
  Object.freeze({
    id: 'rgb8-permuted-sections',
    source: 'rgb8-groups',
    features: Object.freeze(['multiple groups', 'permuted section table']),
    options: Object.freeze(['--effort=9', '--modular_group_size=0', '--group_order=1']),
  }),
  Object.freeze({
    id: 'rgb8-jxlc',
    source: 'rgb8-odd',
    features: Object.freeze(['jxlc container']),
    options: Object.freeze(['--effort=7', '--container=1']),
  }),
  Object.freeze({
    id: 'rgb8-jxlp-ordered',
    source: 'rgb8-groups',
    features: Object.freeze(['ordered jxlp container']),
    options: Object.freeze(['--effort=7', '--container=1', '--streaming_output']),
  }),
  Object.freeze({
    id: 'rgb8-jxlp-out-of-order',
    source: 'rgb8-groups',
    features: Object.freeze(['file format version 1', 'out-of-order jxlp container']),
    options: Object.freeze(['--effort=7', '--container=1', '--output_mode=2']),
  }),
])

const concatenate = (...parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const ascii = (value: string): Uint8Array => new TextEncoder().encode(value)

const sampleValue = (x: number, y: number, channel: number, maximum: number): number => {
  const broadGradient = x * (31 + channel * 6) + y * (17 + channel * 10)
  const checker = ((x >>> 2) ^ (y >>> 2)) & 1 ? maximum >>> 3 : 0
  return (broadGradient + checker + channel * (maximum >>> 2)) % (maximum + 1)
}

const createSource = (definition: SourceDefinition): Uint8Array => {
  const channels = definition.kind === 'gray' ? 1 : definition.kind === 'rgb' ? 3 : 4
  const maximum = 2 ** definition.bitDepth - 1
  const bytesPerSample = definition.bitDepth <= 8 ? 1 : 2
  const samples = new Uint8Array(definition.width * definition.height * channels * bytesPerSample)
  let offset = 0
  for (let y = 0; y < definition.height; y += 1) {
    for (let x = 0; x < definition.width; x += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        let sample = sampleValue(x, y, channel, maximum)
        if (definition.kind === 'rgba' && channel === 3) {
          sample = (x + y * 3) % 11 === 0 ? 0 : sampleValue(x, y, channel, maximum)
        }
        if (bytesPerSample === 1) {
          samples[offset] = sample
          offset += 1
        } else {
          samples[offset] = sample >>> 8
          samples[offset + 1] = sample & 0xff
          offset += 2
        }
      }
    }
  }
  if (definition.kind === 'rgba') {
    return concatenate(
      ascii(
        `P7\nWIDTH ${definition.width}\nHEIGHT ${definition.height}\nDEPTH 4\nMAXVAL ${maximum}\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
      ),
      samples,
    )
  }
  const magic = definition.kind === 'gray' ? 'P5' : 'P6'
  return concatenate(
    ascii(`${magic}\n${definition.width} ${definition.height}\n${maximum}\n`),
    samples,
  )
}

const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const run = async (
  command: string,
  args: readonly string[],
  libraryDirectory: string,
): Promise<void> =>
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, LD_LIBRARY_PATH: libraryDirectory },
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(undefined)
        return
      }
      reject(new Error(`${command} exited with code ${String(code)} and signal ${String(signal)}`))
    })
  })

const libjxlRevision = 'a7a9c787341cf703dede03c2009fa460cae5e5df'
const libjxlSourceArchiveSha256 = '818398895831069902e3677d285054a7d1255b11b221e94c6aaa1cb83b0a3f29'
const oracleDirectory = process.env.PUREJSIMAGE_LIBJXL_ROOT ?? '.tmp/jpegxl-oracles/libjxl-v0.12.0'
const binaryDirectory =
  process.env.PUREJSIMAGE_LIBJXL_BIN ?? join(oracleDirectory, 'source', 'build-pinned', 'tools')
const libraryDirectory =
  process.env.PUREJSIMAGE_LIBJXL_LIB ?? join(oracleDirectory, 'source', 'build-pinned', 'lib')
const sourceArchivePath =
  process.env.PUREJSIMAGE_LIBJXL_SOURCE_ARCHIVE ?? join(oracleDirectory, 'source-a7a9c787.tar.gz')
const sourceArchiveSha256 = digest(await readFile(sourceArchivePath))
if (sourceArchiveSha256 !== libjxlSourceArchiveSha256) {
  throw new Error(
    `Pinned libjxl source archive checksum mismatch: expected ${libjxlSourceArchiveSha256}, received ${sourceArchiveSha256}`,
  )
}
const outputDirectory = join('benchmark', 'fixtures', 'jpegxl', 'generated-lossless-v0.12.0')
const inputDirectory = join(outputDirectory, 'input')
await mkdir(inputDirectory, { recursive: true })

const sourceById = new Map<string, SourceDefinition>()
for (const definition of sourceDefinitions) {
  sourceById.set(definition.id, definition)
  const extension = definition.kind === 'rgba' ? 'pam' : 'pnm'
  await writeFile(join(inputDirectory, `${definition.id}.${extension}`), createSource(definition))
}

const report: {
  oracle: string
  revision: string
  sourceArchiveSha256: string
  license: string
  redistribution: string
  fixtures: {
    id: string
    source: string
    generator: string
    license: string
    redistribution: string
    width: number
    height: number
    bitDepth: SampleDepth
    colorEncoding: string
    alpha: 'none' | 'straight' | 'premultiplied'
    coding: 'modular'
    level: 5 | 10 | 'unknown'
    container: 'raw' | 'jxlc' | 'jxlp'
    preview: false
    progressive: boolean
    patches: false
    splines: false
    noise: false
    restorationFilters: readonly string[]
    extraChannels: readonly string[]
    jpegReconstruction: false
    expectedPureJsImageBehavior: 'exact-decode' | 'unsupported'
    features: readonly string[]
    options: readonly string[]
    inputSha256: string
    jxlSha256: string
    jxlBytes: number
    djxlOutputSha256: string
  }[]
} = {
  oracle: 'libjxl cjxl and djxl v0.12.0',
  revision: libjxlRevision,
  sourceArchiveSha256,
  license: 'BSD-3-Clause development oracle; generated pixel patterns are CC0',
  redistribution: 'Generated fixtures may be redistributed; binaries are prepared on demand',
  fixtures: [],
}

for (const definition of encodeDefinitions) {
  const source = sourceById.get(definition.source)
  if (!source) throw new Error(`Unknown JPEG XL source ${definition.source}`)
  const inputExtension = source.kind === 'rgba' ? 'pam' : 'pnm'
  const inputPath = join(inputDirectory, `${source.id}.${inputExtension}`)
  const outputPath = join(outputDirectory, `${definition.id}.jxl`)
  const decodedPath = join(
    outputDirectory,
    `${definition.id}.oracle.${definition.outputFormat ?? 'pnm'}`,
  )
  await mkdir(dirname(outputPath), { recursive: true })
  await run(
    join(binaryDirectory, 'cjxl'),
    [
      inputPath,
      outputPath,
      '--quiet',
      '--distance=0',
      '--modular=1',
      '--num_threads=0',
      ...definition.options,
    ],
    libraryDirectory,
  )
  await run(
    join(binaryDirectory, 'djxl'),
    [
      outputPath,
      decodedPath,
      '--quiet',
      '--num_threads=0',
      `--bits_per_sample=${source.bitDepth}`,
      ...(source.kind === 'rgba' ? ['--output_extra_channels'] : []),
    ],
    libraryDirectory,
  )
  const [input, encoded, decoded] = await Promise.all([
    readFile(inputPath),
    readFile(outputPath),
    readFile(decodedPath),
  ])
  const structure = await inspectJpegXlStructure(encoded)
  const premultiplied = definition.options.includes('--premultiply=1')
  report.fixtures.push({
    id: definition.id,
    source: source.id,
    generator: 'benchmark/jpegxl/generate-lossless-corpus.ts',
    license: 'CC0',
    redistribution: 'generated on demand',
    width: source.width,
    height: source.height,
    bitDepth: source.bitDepth,
    colorEncoding: source.kind === 'gray' ? 'Gray D65 sRGB' : 'RGB D65 sRGB',
    alpha: source.kind === 'rgba' ? (premultiplied ? 'premultiplied' : 'straight') : 'none',
    coding: 'modular',
    level: structure.level ?? 'unknown',
    container: structure.organization,
    preview: false,
    progressive: definition.id === 'rgb8-squeeze',
    patches: false,
    splines: false,
    noise: false,
    restorationFilters: Object.freeze([]),
    extraChannels: Object.freeze(source.kind === 'rgba' ? ['alpha'] : []),
    jpegReconstruction: false,
    expectedPureJsImageBehavior: premultiplied ? 'unsupported' : 'exact-decode',
    features: definition.features,
    options: Object.freeze([
      '--distance=0',
      '--modular=1',
      '--num_threads=0',
      ...definition.options,
    ]),
    inputSha256: digest(input),
    jxlSha256: digest(encoded),
    jxlBytes: encoded.byteLength,
    djxlOutputSha256: digest(decoded),
  })
  console.log(`Generated ${definition.id}: ${encoded.byteLength} bytes`)
}

await writeFile(
  join('benchmark', 'jpegxl', 'generated-lossless-manifest.json'),
  `${JSON.stringify(report, undefined, 2)}\n`,
)
