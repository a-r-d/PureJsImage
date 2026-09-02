import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { ImageCodec, ImageDecoder } from '../../src/codec.ts'
import { inspectJpegXl } from '../../src/codecs/jpegxl-inspect.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import type { PixelFormat } from '../../src/pixel.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

type EncoderFormat = 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16'

interface MatrixCase {
  readonly id: string
  readonly format: EncoderFormat
  readonly width: number
  readonly height: number
  readonly imageClass: 'gradient' | 'line-art' | 'photo-like' | 'alpha-heavy'
  readonly container: boolean
}

interface DecodedPixels {
  readonly format: PixelFormat
  readonly pixels: Uint8Array
}

const cases: readonly MatrixCase[] = Object.freeze([
  {
    id: 'gray8-line-art-odd',
    format: 'gray8',
    width: 9,
    height: 7,
    imageClass: 'line-art',
    container: false,
  },
  {
    id: 'gray16-gradient-odd',
    format: 'gray16',
    width: 11,
    height: 5,
    imageClass: 'gradient',
    container: true,
  },
  {
    id: 'rgb8-photo-like-odd',
    format: 'rgb8',
    width: 13,
    height: 9,
    imageClass: 'photo-like',
    container: false,
  },
  {
    id: 'rgb16-gradient-odd',
    format: 'rgb16',
    width: 7,
    height: 11,
    imageClass: 'gradient',
    container: true,
  },
  {
    id: 'rgba8-alpha-heavy-odd',
    format: 'rgba8',
    width: 15,
    height: 9,
    imageClass: 'alpha-heavy',
    container: false,
  },
  {
    id: 'rgba16-alpha-heavy-odd',
    format: 'rgba16',
    width: 9,
    height: 13,
    imageClass: 'alpha-heavy',
    container: true,
  },
  {
    id: 'rgb8-photo-like-multigroup',
    format: 'rgb8',
    width: 1_031,
    height: 7,
    imageClass: 'photo-like',
    container: true,
  },
])

const channels = (format: EncoderFormat): 1 | 3 | 4 =>
  format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3

const bytesPerSample = (format: EncoderFormat): 1 | 2 => (format.endsWith('16') ? 2 : 1)

const sampleValue = (definition: MatrixCase, x: number, y: number, channel: number): number => {
  const maximum = bytesPerSample(definition.format) === 2 ? 65_535 : 255
  if (definition.imageClass === 'line-art') {
    return ((x >>> 1) + (y >>> 1) + channel) % 2 === 0 ? 0 : maximum
  }
  if (definition.imageClass === 'gradient') {
    return Math.round(
      (((x * 257 + y * 193 + channel * 911) % (definition.width * 257 + definition.height * 193)) /
        (definition.width * 257 + definition.height * 193 - 1)) *
        maximum,
    )
  }
  if (definition.imageClass === 'alpha-heavy' && channel === 3) {
    return (x * 17 + y * 29) % 5 === 0 ? 0 : (x * 37 + y * 71) % (maximum + 1)
  }
  const low = (x * 73 + y * 151 + channel * 47 + ((x * y) >>> 1)) & 255
  return bytesPerSample(definition.format) === 1
    ? low
    : (low << 8) | ((x * 19 + y * 31 + channel * 59) & 255)
}

const fixturePixels = (definition: MatrixCase): Uint8Array => {
  const channelCount = channels(definition.format)
  const sampleBytes = bytesPerSample(definition.format)
  const pixels = new Uint8Array(definition.width * definition.height * channelCount * sampleBytes)
  let offset = 0
  for (let y = 0; y < definition.height; y += 1) {
    for (let x = 0; x < definition.width; x += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const value = sampleValue(definition, x, y, channel)
        pixels[offset] = sampleBytes === 2 ? value >>> 8 : value & 255
        if (sampleBytes === 2) pixels[offset + 1] = value & 255
        offset += sampleBytes
      }
    }
  }
  return pixels
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const pngWithoutExternalColorMetadata = (input: Uint8Array): Uint8Array => {
  if (input.byteLength < 8) return input
  const chunks: Uint8Array[] = [input.subarray(0, 8)]
  let offset = 8
  let outputBytes = 8
  while (offset + 12 <= input.byteLength) {
    const view = new DataView(input.buffer, input.byteOffset + offset, input.byteLength - offset)
    const payloadBytes = view.getUint32(0, false)
    const chunkBytes = payloadBytes + 12
    if (offset + chunkBytes > input.byteLength)
      throw new Error('External decoder wrote a truncated PNG')
    const type = String.fromCharCode(
      input[offset + 4] ?? 0,
      input[offset + 5] ?? 0,
      input[offset + 6] ?? 0,
      input[offset + 7] ?? 0,
    )
    if (type !== 'cICP' && type !== 'iCCP') {
      chunks.push(input.subarray(offset, offset + chunkBytes))
      outputBytes += chunkBytes
    }
    offset += chunkBytes
    if (type === 'IEND') break
  }
  const output = new Uint8Array(outputBytes)
  let outputOffset = 0
  for (const chunk of chunks) {
    output.set(chunk, outputOffset)
    outputOffset += chunk.byteLength
  }
  return output
}

const encode = async (definition: MatrixCase, pixels: Uint8Array): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: definition.width,
    height: definition.height,
    pixelFormat: definition.format,
    colorSemantics: {
      family: definition.format.startsWith('gray') ? 'gray' : 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: definition.format.startsWith('rgba') ? 'straight' : 'none',
      provenance: 'assumed-default',
    },
    options: { mode: 'lossless', effort: 1, container: definition.container },
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('JPEG XL encoder is unavailable')
  await encoder.write({
    x: 0,
    y: 0,
    width: definition.width,
    height: definition.height,
    stride: definition.width * channels(definition.format) * bytesPerSample(definition.format),
    format: definition.format,
    data: pixels,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

const collect = async (decoder: ImageDecoder): Promise<DecodedPixels> => {
  const format = decoder.pixelFormat
  if (!['gray8', 'gray16', 'rgb8', 'rgb16', 'rgba8', 'rgba16'].includes(format)) {
    throw new Error(`Matrix decoder returned unsupported pixel format ${format}`)
  }
  const channelCount = format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3
  const sampleBytes = format.endsWith('16') ? 2 : 1
  const rowBytes = decoder.width * channelCount * sampleBytes
  const pixels = new Uint8Array(rowBytes * decoder.height)
  for await (const block of decoder.decode()) {
    try {
      for (let row = 0; row < block.height; row += 1) {
        const sourceStart = row * block.stride
        const destinationStart =
          ((block.y + row) * decoder.width + block.x) * channelCount * sampleBytes
        pixels.set(
          block.data.subarray(sourceStart, sourceStart + block.width * channelCount * sampleBytes),
          destinationStart,
        )
      }
    } finally {
      block.release?.()
    }
  }
  return Object.freeze({ format, pixels })
}

const decodeWith = async (
  codec: ImageCodec,
  input: Uint8Array,
  preserveIcc = false,
): Promise<DecodedPixels> => {
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits, {
    preserveIcc,
  })
  if (!decoder) throw new Error(`${codec.format} decoder is unavailable`)
  return collect(decoder)
}

const assertExact = (
  id: string,
  decoder: string,
  expected: DecodedPixels,
  actual: DecodedPixels,
): void => {
  if (actual.format !== expected.format) {
    throw new Error(`${id} ${decoder} returned ${actual.format}; expected ${expected.format}`)
  }
  if (sha256(actual.pixels) !== sha256(expected.pixels)) {
    const firstDifference = expected.pixels.findIndex(
      (value, index) => actual.pixels[index] !== value,
    )
    throw new Error(
      `${id} ${decoder} native samples differ from the source at byte ${String(firstDifference)}: expected ${String(expected.pixels[firstDifference])}, received ${String(actual.pixels[firstDifference])}`,
    )
  }
}

const jxlOxideSigned16BitClassification = (
  expected: DecodedPixels,
  actual: DecodedPixels,
): Readonly<{ readonly affectedSamples: number; readonly totalSamples: number }> | undefined => {
  if (!expected.format.endsWith('16') || actual.format !== expected.format) return undefined
  let affectedSamples = 0
  const totalSamples = expected.pixels.byteLength / 2
  for (let offset = 0; offset < expected.pixels.byteLength; offset += 2) {
    const expectedValue = (expected.pixels[offset] ?? 0) * 256 + (expected.pixels[offset + 1] ?? 0)
    const actualValue = (actual.pixels[offset] ?? 0) * 256 + (actual.pixels[offset + 1] ?? 0)
    if (expectedValue <= 32_767) {
      if (actualValue !== expectedValue) return undefined
    } else {
      if (actualValue !== 0) return undefined
      affectedSamples += 1
    }
  }
  return affectedSamples > 0 ? Object.freeze({ affectedSamples, totalSamples }) : undefined
}

const run = (binary: string, arguments_: readonly string[]): string => {
  const result = spawnSync(binary, arguments_, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${basename(binary)} ${arguments_.join(' ')} failed (${String(result.status)}): ${result.stderr.trim()}`,
    )
  }
  return `${result.stdout}${result.stderr}`
}

const libjxlDirectory = process.argv[2]
const jxlOxideBinary = process.argv[3]
const jxlRsBinary = process.argv[4]
if (!libjxlDirectory || !jxlOxideBinary || !jxlRsBinary) {
  throw new Error(
    'Usage: run-purejsimage-encoder-matrix.ts <libjxl-tools-dir> <jxl-oxide-bin> <jxl-rs-bin>',
  )
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-jxl-encoder-matrix-'))
const results: Record<string, unknown>[] = []
try {
  for (const definition of cases) {
    const sourcePixels = fixturePixels(definition)
    const encoded = await encode(definition, sourcePixels)
    const expected: DecodedPixels = Object.freeze({
      format: definition.format,
      pixels: sourcePixels,
    })
    const inspection = await inspectJpegXl(encoded)
    if (
      inspection.width !== definition.width ||
      inspection.height !== definition.height ||
      inspection.bitDepth !== bytesPerSample(definition.format) * 8 ||
      inspection.expectedPixelFormat !== definition.format ||
      inspection.encoding !== 'modular' ||
      inspection.alpha !== (definition.format.startsWith('rgba') ? 'straight' : 'none')
    ) {
      throw new Error(`${definition.id} PureJsImage inspection differs from the encoder request`)
    }

    const pureJsImage = await decodeWith(jpegxlCodec, encoded)
    assertExact(definition.id, 'PureJsImage', expected, pureJsImage)

    const inputPath = join(temporaryDirectory, `${definition.id}.jxl`)
    await writeFile(inputPath, encoded)
    const jxlinfo = run(join(libjxlDirectory, 'jxlinfo'), [inputPath])

    const external = [
      {
        name: 'djxl',
        output: join(temporaryDirectory, `${definition.id}-djxl.png`),
        decode: (): string =>
          run(join(libjxlDirectory, 'djxl'), [
            inputPath,
            join(temporaryDirectory, `${definition.id}-djxl.png`),
            `--bits_per_sample=${String(bytesPerSample(definition.format) * 8)}`,
          ]),
      },
      {
        name: 'jxl-rs',
        output: join(temporaryDirectory, `${definition.id}-jxl-rs.png`),
        decode: (): string =>
          run(jxlRsBinary, [
            inputPath,
            join(temporaryDirectory, `${definition.id}-jxl-rs.png`),
            '--data-type',
            bytesPerSample(definition.format) === 2 ? 'u16' : 'u8',
          ]),
      },
      {
        name: 'jxl-oxide',
        output: join(temporaryDirectory, `${definition.id}-jxl-oxide.png`),
        decode: (): string =>
          run(jxlOxideBinary, [
            inputPath,
            '--output',
            join(temporaryDirectory, `${definition.id}-jxl-oxide.png`),
            '--output-format',
            bytesPerSample(definition.format) === 2 ? 'png16' : 'png8',
            '--quiet',
          ]),
      },
    ] as const

    const decoders: Record<string, unknown> = {}
    for (const externalDecoder of external) {
      const diagnostic = externalDecoder.decode()
      const png = pngWithoutExternalColorMetadata(
        new Uint8Array(await readFile(externalDecoder.output)),
      )
      const decoded = await decodeWith(pngCodec, png, true)
      const signed16BitLimitation =
        externalDecoder.name === 'jxl-oxide'
          ? jxlOxideSigned16BitClassification(expected, decoded)
          : undefined
      if (!signed16BitLimitation)
        assertExact(definition.id, externalDecoder.name, expected, decoded)
      decoders[externalDecoder.name] = Object.freeze({
        status: signed16BitLimitation
          ? 'pinned-decoder-limitation-signed-16-bit-modular'
          : 'exact-native-samples',
        pixelFormat: decoded.format,
        outputSha256: sha256(decoded.pixels),
        ...(signed16BitLimitation ?? {}),
        diagnostic: diagnostic.trim(),
      })
    }

    results.push({
      id: definition.id,
      imageClass: definition.imageClass,
      width: definition.width,
      height: definition.height,
      format: definition.format,
      container: definition.container,
      inputBytes: sourcePixels.byteLength,
      inputSha256: sha256(sourcePixels),
      outputBytes: encoded.byteLength,
      outputSha256: sha256(encoded),
      inspection,
      jxlinfo: jxlinfo.trim(),
      decoders,
    })
  }
} finally {
  if (process.env.PUREJSIMAGE_KEEP_JPEGXL_MATRIX_TEMP === '1') {
    console.error(`Retained matrix files at ${temporaryDirectory}`)
  } else {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

const report = {
  schemaVersion: 1,
  revision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  revisions: {
    libjxl: 'a7a9c787341cf703dede03c2009fa460cae5e5df',
    jxlOxide: 'c0cc4c7ea57c1207f38ff2970d94757470613be4',
    jxlRs: '07ab48fcccde0a73c384b4011520fec67e5e09cd',
  },
  validation: 'exact native samples',
  cases: results,
}
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1]
if (outputIndex >= 0 && !output) throw new Error('--output requires a path')
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
