import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

import type { ImageCodec, ImageDecoder, ImageMetadata } from '../../src/codec.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { createNodeImageLibrary } from '../../src/node-image.ts'
import { MemorySource } from '../../src/source.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

type Operation =
  | 'import'
  | 'detect'
  | 'inspect'
  | 'decode'
  | 'region'
  | 'convert'
  | 'encode'
  | 'encode-stream'

interface WorkerArguments {
  readonly codec: string
  readonly fixture: string
  readonly operation: Operation
  readonly width: number
  readonly height: number
  readonly frame?: number
  readonly output?: string
  readonly variant?: 'pam' | 'pfm' | 'ppm'
}

interface DecodedSummary {
  readonly bytes: number
  readonly height: number
  readonly pixelFormat: string
  readonly sha256: string
  readonly width: number
}

interface WorkerResult {
  readonly codec: string
  readonly fixture: string
  readonly operation: Operation
  readonly maximumRssBytes: number
  readonly validation: {
    readonly dimensions: boolean
    readonly format: boolean
    readonly output: boolean
    readonly passed: boolean
    readonly sampleOrPixelHash: string
  }
  readonly metadata?: ImageMetadata
  readonly outputBytes?: number
  readonly outputSha256?: string
  readonly wallMilliseconds: number
}

const isOperation = (value: string | undefined): value is Operation =>
  value === 'import' ||
  value === 'detect' ||
  value === 'inspect' ||
  value === 'decode' ||
  value === 'region' ||
  value === 'convert' ||
  value === 'encode' ||
  value === 'encode-stream'

const numberArgument = (name: string): number => {
  const value = process.argv[process.argv.indexOf(`--${name}`) + 1]
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`--${name} must be positive`)
  return parsed
}

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const args: WorkerArguments = (() => {
  const codec = argument('codec')
  const fixture = argument('fixture')
  const operation = argument('operation')
  if (!codec || !fixture || !isOperation(operation)) {
    throw new Error('Usage: stable-codec-worker.ts --codec id --fixture path --operation operation')
  }
  const variant = argument('variant')
  const frame = argument('frame')
  const output = argument('output')
  if (variant !== undefined && variant !== 'pam' && variant !== 'pfm' && variant !== 'ppm') {
    throw new Error(`Unsupported Netpbm variant: ${variant}`)
  }
  if (frame !== undefined && (!Number.isSafeInteger(Number(frame)) || Number(frame) < 0)) {
    throw new Error('--frame must be a non-negative integer')
  }
  return {
    codec,
    fixture,
    operation,
    width: numberArgument('width'),
    height: numberArgument('height'),
    ...(frame === undefined ? {} : { frame: Number(frame) }),
    ...(output === undefined ? {} : { output }),
    ...(variant === undefined ? {} : { variant }),
  }
})()

const codecFor = async (id: string): Promise<ImageCodec> => {
  switch (id) {
    case 'jpeg':
      return (await import('../../src/codecs/jpeg.ts')).jpegCodec
    case 'png':
      return (await import('../../src/codecs/png.ts')).pngCodec
    case 'webp':
      return (await import('../../src/codecs/webp.ts')).webpCodec
    case 'bmp':
      return (await import('../../src/codecs/bmp.ts')).bmpCodec
    case 'gif':
      return (await import('../../src/codecs/gif.ts')).gifCodec
    case 'tiff':
      return (await import('../../src/codecs/tiff.ts')).tiffCodec
    case 'ico':
      return (await import('../../src/codecs/ico.ts')).icoCodec
    case 'jpeg2000':
      return (await import('../../src/codecs/jpeg2000.ts')).jpeg2000Codec
    case 'avif':
      return (await import('../../src/codecs/avif.ts')).avifCodec
    case 'jpegxl':
      return (await import('../../src/codecs/jpegxl.ts')).jpegxlCodec
    case 'hdr':
      return (await import('../../src/codecs/hdr.ts')).hdrCodec
    case 'qoi':
      return (await import('../../src/codecs/qoi.ts')).qoiCodec
    case 'netpbm':
      return (await import('../../src/codecs/netpbm.ts')).netpbmCodec
    case 'tga':
      return (await import('../../src/codecs/tga.ts')).tgaCodec
    default:
      throw new Error(`No first-party codec loader for ${id}`)
  }
}

const maximumRssBytes = (): number => {
  const usage = process.resourceUsage()
  return usage.maxRSS > 0 ? usage.maxRSS * 1_024 : process.memoryUsage().rss
}

const hashDecoded = async (
  decoder: ImageDecoder,
  request: Readonly<{
    readonly x?: number
    readonly y?: number
    readonly width?: number
    readonly height?: number
  }> = {},
): Promise<DecodedSummary> => {
  const hash = createHash('sha256')
  let bytes = 0
  let width = 0
  let height = 0
  let pixelFormat = decoder.pixelFormat
  for await (const block of decoder.decode(request)) {
    if (width === 0) {
      width = block.width
      pixelFormat = block.format
    }
    height += block.height
    bytes += block.data.byteLength
    hash.update(block.data)
    block.release?.()
  }
  return { bytes, height, pixelFormat, sha256: hash.digest('hex'), width }
}

const decoderFor = async (codec: ImageCodec, input: Uint8Array, frame: number | undefined) => {
  if (!codec.createDecoder) throw new Error(`${codec.format} does not expose a decoder`)
  return codec.createDecoder(new MemorySource(input), defaultImageLimits, {
    ...(frame === undefined ? {} : { frame }),
  })
}

const validateDecoded = (
  decoded: DecodedSummary,
  expectedWidth: number,
  expectedHeight: number,
): {
  readonly dimensions: boolean
  readonly format: boolean
  readonly sampleOrPixelHash: string
} => ({
  dimensions: decoded.width === expectedWidth && decoded.height === expectedHeight,
  format: decoded.pixelFormat.length > 0,
  sampleOrPixelHash: decoded.sha256,
})

const encodeImage = (
  image: Awaited<ReturnType<ReturnType<typeof createNodeImageLibrary>['open']>>,
  codec: string,
  variant: WorkerArguments['variant'],
) => {
  if (codec === 'jpeg') return image.encode('jpeg', { quality: 80 })
  if (codec === 'png') return image.encode('png', { compressionLevel: 6 })
  if (codec === 'webp') return image.encode('webp', { quality: 80 })
  if (codec === 'bmp') return image.encode('bmp')
  if (codec === 'avif') return image.encode('avif')
  if (codec === 'hdr') return image.encode('hdr')
  if (codec === 'qoi') return image.encode('qoi')
  if (codec === 'tga') return image.encode('tga')
  if (codec === 'tiff') return image.encode('tiff', { compression: 'deflate' })
  if (codec === 'netpbm') return image.encode('netpbm', { format: variant ?? 'ppm' })
  throw new Error(`${codec} has no stable encoder operation`)
}

const main = async (): Promise<void> => {
  const input = new Uint8Array(await readFile(args.fixture))
  const importedAt = performance.now()
  const codec = await codecFor(args.codec)
  const importMilliseconds = performance.now() - importedAt
  if (args.operation === 'import') {
    process.stdout.write(
      `${JSON.stringify({
        codec: args.codec,
        fixture: args.fixture,
        operation: args.operation,
        maximumRssBytes: maximumRssBytes(),
        validation: {
          dimensions: true,
          format: codec.format.length > 0,
          output: true,
          passed: codec.format.length > 0,
          sampleOrPixelHash: createHash('sha256').update(input).digest('hex'),
        },
        wallMilliseconds: Number(importMilliseconds.toFixed(3)),
      } satisfies WorkerResult)}\n`,
    )
    return
  }

  const startedAt = performance.now()
  let metadata: ImageMetadata | undefined
  let decoded: DecodedSummary | undefined
  let output: Uint8Array | undefined
  let detected = true
  if (args.operation === 'detect') {
    detected = codec.detect(input.subarray(0, Math.min(input.byteLength, 65_536)))
  } else if (args.operation === 'inspect') {
    metadata = await codec.metadata(new MemorySource(input), defaultImageLimits, {
      ...(args.frame === undefined ? {} : { frame: args.frame }),
    })
  } else if (args.operation === 'decode' || args.operation === 'region') {
    const decoder = await decoderFor(codec, input, args.frame)
    const regionWidth = Math.min(64, args.width)
    const regionHeight = Math.min(64, args.height)
    const region =
      args.operation === 'region'
        ? {
            x: args.width > regionWidth ? 1 : 0,
            y: args.height > regionHeight ? 1 : 0,
            width: regionWidth,
            height: regionHeight,
          }
        : {}
    decoded = await hashDecoded(decoder, region)
  } else if (
    args.operation === 'convert' ||
    args.operation === 'encode' ||
    args.operation === 'encode-stream'
  ) {
    const { pngCodec } = await import('../../src/codecs/png.ts')
    const inputLibrary = createNodeImageLibrary([
      codec,
      ...(codec.format === 'png' ? [] : [pngCodec]),
    ])
    const image = await inputLibrary.open(input, {
      ...(args.frame === undefined ? {} : { frame: args.frame }),
    })
    if (args.operation === 'convert') {
      output = await image.png().toBuffer()
    } else {
      const encoded = encodeImage(image, args.codec, args.variant)
      if (args.operation === 'encode-stream') {
        const sink = new Uint8ArraySink()
        await encoded.toSink(sink)
        output = sink.toUint8Array()
      } else {
        output = await encoded.toBuffer()
      }
    }
  }
  const wallMilliseconds = Number((performance.now() - startedAt).toFixed(3))

  let dimensions = true
  let format = detected
  let outputValid = true
  let sampleOrPixelHash = ''
  if (args.operation === 'detect') {
    format = detected
    sampleOrPixelHash = createHash('sha256').update(input.subarray(0, 64)).digest('hex')
  } else if (args.operation === 'inspect') {
    dimensions = metadata?.width === args.width && metadata.height === args.height
    format =
      metadata?.format === codec.format || (codec.format === 'jp2' && metadata?.format === 'jp2')
    sampleOrPixelHash = createHash('sha256').update(input.subarray(0, 64)).digest('hex')
  } else if (decoded !== undefined) {
    const expectedWidth = args.operation === 'region' ? Math.min(64, args.width) : args.width
    const expectedHeight = args.operation === 'region' ? Math.min(64, args.height) : args.height
    const checked = validateDecoded(decoded, expectedWidth, expectedHeight)
    dimensions = checked.dimensions
    format = checked.format
    sampleOrPixelHash = checked.sampleOrPixelHash
  } else if (output !== undefined) {
    outputValid = true
    const { pngCodec } = await import('../../src/codecs/png.ts')
    const outputLibrary = createNodeImageLibrary([
      codec,
      ...(codec.format === 'png' ? [] : [pngCodec]),
    ])
    const outputImage = await outputLibrary.open(output)
    const outputMetadata = await outputImage.metadata()
    const expectedFormat = args.operation === 'convert' ? 'png' : codec.format
    dimensions = outputMetadata.width === args.width && outputMetadata.height === args.height
    format = outputMetadata.format === expectedFormat
    outputValid = dimensions && format
    sampleOrPixelHash = createHash('sha256').update(output).digest('hex')
    metadata = outputMetadata
  }
  const result: WorkerResult = {
    codec: args.codec,
    fixture: args.fixture,
    operation: args.operation,
    maximumRssBytes: maximumRssBytes(),
    validation: {
      dimensions,
      format,
      output: outputValid,
      passed: dimensions && format && outputValid,
      sampleOrPixelHash,
    },
    ...(metadata === undefined ? {} : { metadata }),
    ...(output === undefined
      ? {}
      : {
          outputBytes: output.byteLength,
          outputSha256: createHash('sha256').update(output).digest('hex'),
        }),
    wallMilliseconds,
  }
  if (!result.validation.passed) {
    throw new Error(`Stable codec validation failed: ${JSON.stringify(result.validation)}`)
  }
  if (args.output !== undefined && output !== undefined) {
    await writeFile(args.output, output)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

await main()
