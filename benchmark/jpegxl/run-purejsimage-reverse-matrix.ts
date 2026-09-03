import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'

import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { createPureJsImageSrgbIcc } from '../../src/hdr/srgb-icc.ts'
import { transcodeJpegToJpegXl } from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

interface MatrixCase {
  readonly id: string
  readonly source: string
  readonly sourceKind?: 'metadata-markers' | 'restart-interval'
  readonly sourceSha256: string
  readonly profile: string
  readonly maximumAbsoluteError: number
  readonly maximumRmse: number
}

const matrix: readonly MatrixCase[] = Object.freeze([
  Object.freeze({
    id: 'baseline-yuv420',
    source: 'benchmark/corpus/files/jpeg-reference/generated-sof1-8bit.jpg',
    sourceSha256: '09048d46b313702386605da3eddd6ad0ebbfb104f891901ec17603a00bb25104',
    profile: 'baseline YCbCr 4:2:0 with generated quantization and Huffman tables',
    maximumAbsoluteError: 24,
    maximumRmse: 1.5,
  }),
  Object.freeze({
    id: 'baseline-yuv422-camera',
    source: 'benchmark/corpus/files/tundra-4000x3000.jpg',
    sourceSha256: 'af55711534d744a385a805d7c0ff20c7e32c19f9fb886b468b078af24ddb8ab6',
    profile: 'baseline YCbCr 4:2:2 camera JPEG',
    maximumAbsoluteError: 24,
    maximumRmse: 1.5,
  }),
  Object.freeze({
    id: 'baseline-rgb444',
    source: 'benchmark/corpus/files/jpeg-reference/generated-adobe-rgb.jpg',
    sourceSha256: 'd075ab672879c684eeacb84e88d2a7a9c9b300e65eed97eab31a46399dfdedc4',
    profile: 'baseline RGB 4:4:4 with Adobe marker',
    maximumAbsoluteError: 24,
    maximumRmse: 1.5,
  }),
  Object.freeze({
    id: 'progressive-yuv420-exif',
    source: 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-yuv420.jpg',
    sourceSha256: '226671d7fcd032a237d7e195e936545f0b492628fd96b21e1b062ccbc40e2a6e',
    profile: 'progressive YCbCr 4:2:0 with Exif',
    maximumAbsoluteError: 24,
    maximumRmse: 1.5,
  }),
  Object.freeze({
    id: 'progressive-rgb-exif',
    source: 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-rgb.jpg',
    sourceSha256: 'b941a2bf2aa4d29aeca018f7ac02abb6ef8be5c1a782147a8638355a22826e65',
    profile: 'progressive RGB 4:4:4 with Exif',
    maximumAbsoluteError: 24,
    maximumRmse: 1.5,
  }),
  Object.freeze({
    id: 'progressive-custom-scans',
    source: 'benchmark/corpus/files/jpeg-reference/generated-progressive.jpg',
    sourceSha256: 'ef15e5eafc4eb4d98e012f03ea2b8b1a400c7dff29fb0303e6c7c98ade0981ee',
    profile: 'progressive YCbCr with successive approximation refinement',
    maximumAbsoluteError: 24,
    maximumRmse: 1.5,
  }),
  Object.freeze({
    id: 'sequential-multiscan',
    source: 'benchmark/corpus/files/jpeg-reference/generated-sequential-multiscan.jpg',
    sourceSha256: 'c916cbd242f3a1fc2a41870fb536f2e30f609055cd75165ab9d1df2285f21279',
    profile: 'baseline YCbCr with separate component scans',
    maximumAbsoluteError: 24,
    maximumRmse: 1.5,
  }),
  Object.freeze({
    id: 'progressive-yuv420-camera',
    source: 'benchmark/corpus/files/tundra-4000x3000-progressive.jpg',
    sourceSha256: '680f4c1ab6fc7e40f0ddf314ad1c6006fddc8519f19b7a613cbd9d8b948bc03e',
    profile: 'large progressive YCbCr 4:2:0 camera JPEG',
    maximumAbsoluteError: 24,
    maximumRmse: 1.5,
  }),
  Object.freeze({
    id: 'baseline-yuv420-metadata-markers',
    source: 'benchmark/corpus/files/jpeg-reference/generated-sof1-8bit.jpg',
    sourceKind: 'metadata-markers',
    sourceSha256: '47a70915f689a37a7391d726eb9e25f053a1e25f98bee88c37dfeb7f18362db2',
    profile: 'baseline YCbCr 4:2:0 with ICC, XMP, COM, and bounded unknown APP15 markers',
    maximumAbsoluteError: 24,
    maximumRmse: 1.5,
  }),
  Object.freeze({
    id: 'baseline-yuv420-restart-interval',
    source: 'generated://baseline-yuv420-restart-interval',
    sourceKind: 'restart-interval',
    sourceSha256: 'efcd7bc88cefe03969e58adb069965981dd76533d8df3223ef0aa210be00a3bf',
    profile: 'baseline YCbCr 4:2:0 with a DRI segment and ordered restart markers',
    maximumAbsoluteError: 24,
    maximumRmse: 1.5,
  }),
])

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

// Independently generated 48x48 YCbCr 4:2:0 JPEG with DRI=1 and ordered RST0-RST7 markers.
const restartIntervalJpegBase64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAwAEADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAUI/8QAFhAAAwAAAAAAAAAAAAAAAAAAABRh/8QAGAEAAgMAAAAAAAAAAAAAAAAABAkGBwj/xAAYEQACAwAAAAAAAAAAAAAAAAAAFRZhYv/dAAQAAf/aAAwDAQACEQMRAD8AzWzQzSUzQzSKx7IxV7Z//9DNbNDNJTNDNIrHsjFXtn//0c1s0M0lM0M0iseyMVe2f//SzWzQzSUzQzSKx7IxV7Z//9PIDNDNJTNDNLxj2TR72z//1MgM0M0lM0M0vGPZNHvbP//VyAzQzSUzQzS8Y9k0e9s//9bIDNDNJTNDNLxj2TR72z//18LM0M0ks0M0YXHshD2z/9DCzNDNJLNDNGFx7IQ9s//RwszQzSSzQzRhceyEPbP/0sLM0M0ks0M0YXHshD2z/9k='

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

const jpegSegment = (marker: number, payload: Uint8Array): Uint8Array => {
  if (payload.byteLength > 65_533) throw new Error('Generated JPEG marker payload is too large')
  const length = payload.byteLength + 2
  return concatenate(Uint8Array.of(0xff, marker, length >>> 8, length & 0xff), payload)
}

const withMetadataMarkers = (source: Uint8Array): Uint8Array => {
  if (source[0] !== 0xff || source[1] !== 0xd8) {
    throw new Error('Metadata-marker reverse-matrix source is not a JPEG')
  }
  const profile = createPureJsImageSrgbIcc()
  const icc = concatenate(ascii('ICC_PROFILE\0'), Uint8Array.of(1, 1), profile)
  const xmp = concatenate(
    ascii('http://ns.adobe.com/xap/1.0/\0'),
    ascii(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>',
    ),
  )
  return concatenate(
    source.subarray(0, 2),
    jpegSegment(0xe2, icc),
    jpegSegment(0xe1, xmp),
    jpegSegment(0xfe, ascii('PureJsImage JPEG XL reverse matrix')),
    jpegSegment(0xef, Uint8Array.of(0x50, 0x4a, 0x49, 0x00, 0x01, 0x02, 0x03, 0x04)),
    source.subarray(2),
  )
}

const loadSource = async (definition: MatrixCase): Promise<Uint8Array> => {
  if (definition.sourceKind === 'restart-interval') {
    return new Uint8Array(Buffer.from(restartIntervalJpegBase64, 'base64'))
  }
  const source = new Uint8Array(await readFile(definition.source))
  return definition.sourceKind === 'metadata-markers' ? withMetadataMarkers(source) : source
}

const run = async (command: string, arguments_: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: ['ignore', 'pipe', 'inherit'] })
    const chunks: Uint8Array[] = []
    child.stdout.on('data', (chunk: Uint8Array) => chunks.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with status ${code ?? 'unknown'}`))
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })

const pnmPixels = (data: Uint8Array): Uint8Array => {
  const marker = new TextEncoder().encode('255\n')
  for (let offset = 0; offset <= data.byteLength - marker.byteLength; offset += 1) {
    if (marker.every((value, index) => data[offset + index] === value)) {
      return data.subarray(offset + marker.byteLength)
    }
  }
  throw new Error('djxl PPM output has no 8-bit sample payload')
}

const decodeSharpRgb = async (data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(
    await sharp(data).autoOrient().toColourspace('srgb').removeAlpha().raw().toBuffer(),
  )

const decodePureJsImageRgb = async (data: Uint8Array): Promise<Uint8Array> => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(data), defaultImageLimits)
  if (decoder?.pixelFormat !== 'rgb8') {
    throw new Error('PureJsImage JPEG XL reverse matrix requires RGB8 decoder output')
  }
  const output = new Uint8Array(decoder.width * decoder.height * 3)
  for await (const block of decoder.decode()) {
    try {
      for (let row = 0; row < block.height; row += 1) {
        const source = row * block.stride
        output.set(
          block.data.subarray(source, source + block.width * 3),
          ((block.y + row) * decoder.width + block.x) * 3,
        )
      }
    } finally {
      block.release?.()
    }
  }
  return output
}

const compare = (
  actual: Uint8Array,
  expected: Uint8Array,
): Readonly<{ maximumAbsoluteError: number; rmse: number }> => {
  if (actual.byteLength !== expected.byteLength) throw new Error('Pixel output lengths differ')
  let maximumAbsoluteError = 0
  let squaredError = 0
  for (let index = 0; index < actual.byteLength; index += 1) {
    const difference = Math.abs((actual[index] ?? 0) - (expected[index] ?? 0))
    maximumAbsoluteError = Math.max(maximumAbsoluteError, difference)
    squaredError += difference * difference
  }
  return Object.freeze({
    maximumAbsoluteError,
    rmse: Math.sqrt(squaredError / actual.byteLength),
  })
}

const percentile = (values: readonly number[], percentileValue: number): number => {
  if (values.length === 0) throw new Error('Cannot calculate a percentile without values')
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1),
  )
  return sorted[index] ?? 0
}

const binaryDirectory = process.argv[2]
if (!binaryDirectory) {
  throw new Error('Usage: node run-purejsimage-reverse-matrix.ts <libjxl-tools-directory>')
}
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1]
if (outputIndex >= 0 && !output) throw new Error('--output requires a path')
const requestedCases = new Set(
  process.argv.slice(3).filter((value, index, values) => {
    if (value === '--output') return false
    return index === 0 || values[index - 1] !== '--output'
  }),
)
const selectedMatrix =
  requestedCases.size === 0 ? matrix : matrix.filter(({ id }) => requestedCases.has(id))
if (selectedMatrix.length === 0) throw new Error('No requested reverse-matrix cases matched')

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-jpegxl-reverse-'))
const results = []
try {
  for (const definition of selectedMatrix) {
    const source = await loadSource(definition)
    const sourceDigest = sha256(source)
    if (sourceDigest !== definition.sourceSha256) {
      throw new Error(
        `${definition.id} source checksum ${sourceDigest} does not match the pinned matrix`,
      )
    }
    const encoded = await transcodeJpegToJpegXl(source, { reconstruction: 'required' })
    const sourcePath = join(temporaryDirectory, `${definition.id}.jpg`)
    const encodedPath = join(temporaryDirectory, `${definition.id}.jxl`)
    const reconstructedPath = join(temporaryDirectory, `${definition.id}.reconstructed.jpg`)
    const decodedPath = join(temporaryDirectory, `${definition.id}.ppm`)
    const referencePath = join(temporaryDirectory, `${definition.id}.libjxl.jxl`)
    const referenceDecodedPath = join(temporaryDirectory, `${definition.id}.libjxl.ppm`)
    await writeFile(sourcePath, source)
    await writeFile(encodedPath, encoded.data)
    const inspection = await run(join(binaryDirectory, 'jxlinfo'), [encodedPath])
    if (!inspection.toLowerCase().includes('jpeg bitstream reconstruction data')) {
      throw new Error(`${definition.id} jxlinfo did not report JPEG reconstruction data`)
    }
    await run(join(binaryDirectory, 'djxl'), [encodedPath, reconstructedPath])
    const reconstructed = new Uint8Array(await readFile(reconstructedPath))
    if (
      reconstructed.byteLength !== source.byteLength ||
      sha256(reconstructed) !== definition.sourceSha256 ||
      !reconstructed.every((value, index) => value === source[index])
    ) {
      throw new Error(`${definition.id} pinned djxl reconstruction differs from the source JPEG`)
    }
    await run(join(binaryDirectory, 'djxl'), [encodedPath, decodedPath, '--bits_per_sample=8'])
    await run(join(binaryDirectory, 'cjxl'), [
      sourcePath,
      referencePath,
      '--lossless_jpeg=1',
      '--compress_boxes=0',
      '--effort=1',
    ])
    await run(join(binaryDirectory, 'djxl'), [
      referencePath,
      referenceDecodedPath,
      '--bits_per_sample=8',
    ])
    const reference = new Uint8Array(await readFile(referencePath))
    const djxlPixels = pnmPixels(new Uint8Array(await readFile(decodedPath)))
    const referencePixels = pnmPixels(new Uint8Array(await readFile(referenceDecodedPath)))
    if (sha256(djxlPixels) !== sha256(referencePixels)) {
      throw new Error(`${definition.id} pixels differ from pinned cjxl and djxl output`)
    }
    const independent = await decodeSharpRgb(source)
    const djxlComparison = compare(djxlPixels, independent)
    const pureJsImageComparison = compare(await decodePureJsImageRgb(encoded.data), independent)
    for (const [decoder, comparison] of [
      ['djxl', djxlComparison],
      ['PureJsImage', pureJsImageComparison],
    ] as const) {
      if (
        comparison.maximumAbsoluteError > definition.maximumAbsoluteError ||
        comparison.rmse > definition.maximumRmse
      ) {
        throw new Error(
          `${definition.id} ${decoder} pixel comparison ${comparison.maximumAbsoluteError}/${comparison.rmse} exceeds max ${definition.maximumAbsoluteError}, RMSE ${definition.maximumRmse}`,
        )
      }
    }
    results.push(
      Object.freeze({
        id: definition.id,
        profile: definition.profile,
        sourceBytes: source.byteLength,
        jxlBytes: encoded.data.byteLength,
        libjxlBytes: reference.byteLength,
        savingsPercentage: encoded.savingsPercentage,
        ratioToLibjxl: encoded.data.byteLength / reference.byteLength,
        elapsedMilliseconds: encoded.elapsedMilliseconds,
        sourceSha256: definition.sourceSha256,
        jxlSha256: sha256(encoded.data),
        reconstructedSha256: sha256(reconstructed),
        exact: true,
        djxlPixelComparison: djxlComparison,
        pureJsImagePixelComparison: pureJsImageComparison,
      }),
    )
  }
  const savings = results.map(({ savingsPercentage }) => savingsPercentage)
  const ratios = results.map(({ ratioToLibjxl }) => ratioToLibjxl)
  const smallerCases = savings.filter((value) => value > 0).length
  const report = Object.freeze({
    schemaVersion: 2,
    baseRevision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    oracle: 'libjxl a7a9c787341cf703dede03c2009fa460cae5e5df (v0.12.0)',
    jpegOracle: 'sharp-0.35.3 autoOrient and sRGB output',
    results,
    milestone1CompressionGate: Object.freeze({
      passed:
        smallerCases / results.length >= 0.9 &&
        percentile(savings, 0.5) >= 12 &&
        percentile(savings, 0.1) >= 0 &&
        percentile(ratios, 0.5) <= 1.1 &&
        percentile(ratios, 0.9) <= 1.2 &&
        Math.max(...ratios) <= 1.35,
      exactCases: results.filter(({ exact }) => exact).length,
      totalCases: results.length,
      smallerRate: smallerCases / results.length,
      medianSavingsPercentage: percentile(savings, 0.5),
      p10SavingsPercentage: percentile(savings, 0.1),
      medianRatioToLibjxl: percentile(ratios, 0.5),
      p90RatioToLibjxl: percentile(ratios, 0.9),
      worstRatioToLibjxl: Math.max(...ratios),
    }),
  })
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, undefined, 2))
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
