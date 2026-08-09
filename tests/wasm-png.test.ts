import { readFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import {
  createWasmPngAccelerator,
  type WasmPngAcceleratorOptions,
  wasmPngAccelerator,
} from '../src/accelerator-entries/wasm-png-node.ts'
import {
  createWasmPngAcceleratorWithLoader,
  createWasmPngAcceleratorWithLoaders,
} from '../src/accelerators/wasm/png.ts'
import type { DecodeRequest, ImageCodec, ImageDecoder, ImageEncoder } from '../src/codec.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { crc32 } from '../src/codecs/crc32.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { nodeRuntime } from '../src/node-runtime.ts'
import type { PixelBlock, PixelFormat } from '../src/pixel.ts'
import type { ImageSink } from '../src/sink.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

const scalarArtifactUrl = new URL('../src/accelerator-entries/png-codec.wasm', import.meta.url)
const simdArtifactUrl = new URL('../src/accelerator-entries/png-codec-simd.wasm', import.meta.url)
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

interface SupportedFormat {
  readonly colorType: 0 | 2 | 6
  readonly format: 'gray8' | 'rgb8' | 'rgba8'
  readonly label: string
}

const grayFormat: SupportedFormat = { colorType: 0, format: 'gray8', label: 'gray8' }
const rgbFormat: SupportedFormat = { colorType: 2, format: 'rgb8', label: 'rgb8' }
const rgbaFormat: SupportedFormat = { colorType: 6, format: 'rgba8', label: 'rgba8' }
const supportedFormats: readonly SupportedFormat[] = [grayFormat, rgbFormat, rgbaFormat]

const artifactCases = [
  { kind: 'scalar', url: scalarArtifactUrl },
  { kind: 'simd', url: simdArtifactUrl },
] as const

const instantiateArtifact = async (url: URL): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(url))
  return result.instance
}

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const encodedType = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.byteLength)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(encodedType, data))
  return Buffer.concat([length, encodedType, data, checksum])
}

const pngFromScanlines = (
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  scanlines: Uint8Array,
  options: {
    readonly interlace?: boolean
    readonly palette?: Uint8Array
    readonly transparency?: Uint8Array
  } = {},
): Buffer => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = bitDepth
  header[9] = colorType
  header[12] = options.interlace ? 1 : 0
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    ...(options.palette ? [pngChunk('PLTE', options.palette)] : []),
    ...(options.transparency ? [pngChunk('tRNS', options.transparency)] : []),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', new Uint8Array()),
  ])
}

const channelCount = (format: PixelFormat): number =>
  format === 'gray8' ? 1 : format === 'rgb8' ? 3 : 4

const sample = (x: number, y: number, channel: number): number =>
  (x * 29 + y * 17 + channel * 61 + ((x * y + channel * 13) % 37)) & 255

const sourceRow = (
  width: number,
  y: number,
  format: SupportedFormat,
  startX = 0,
  stepX = 1,
): Uint8Array => {
  const channels = channelCount(format.format)
  const row = new Uint8Array(width * channels)
  for (let x = 0; x < width; x += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      row[x * channels + channel] = sample(startX + x * stepX, y, channel)
    }
  }
  return row
}

const paeth = (left: number, above: number, upperLeft: number): number => {
  const prediction = left + above - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const aboveDistance = Math.abs(prediction - above)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

const filteredRow = (
  row: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
  filter: number,
): Uint8Array => {
  const output = new Uint8Array(row.byteLength + 1)
  output[0] = filter
  for (let index = 0; index < row.byteLength; index += 1) {
    const value = row[index] ?? 0
    const left = index >= bytesPerPixel ? (row[index - bytesPerPixel] ?? 0) : 0
    const above = previous[index] ?? 0
    const upperLeft = index >= bytesPerPixel ? (previous[index - bytesPerPixel] ?? 0) : 0
    let predictor = 0
    if (filter === 1) predictor = left
    else if (filter === 2) predictor = above
    else if (filter === 3) predictor = Math.floor((left + above) / 2)
    else if (filter === 4) predictor = paeth(left, above, upperLeft)
    output[index + 1] = (value - predictor) & 255
  }
  return output
}

const supportedFixture = (
  format: SupportedFormat,
  filter: number,
  width = 43,
  height = 67,
): Buffer => {
  const rows: Uint8Array[] = []
  let previous: Uint8Array = new Uint8Array(width * channelCount(format.format))
  for (let y = 0; y < height; y += 1) {
    const row = sourceRow(width, y, format)
    rows.push(filteredRow(row, previous, channelCount(format.format), filter))
    previous = row
  }
  return pngFromScanlines(width, height, 8, format.colorType, Buffer.concat(rows))
}

const adam7Passes = [
  { startX: 0, startY: 0, stepX: 8, stepY: 8 },
  { startX: 4, startY: 0, stepX: 8, stepY: 8 },
  { startX: 0, startY: 4, stepX: 4, stepY: 8 },
  { startX: 2, startY: 0, stepX: 4, stepY: 4 },
  { startX: 0, startY: 2, stepX: 2, stepY: 4 },
  { startX: 1, startY: 0, stepX: 2, stepY: 2 },
  { startX: 0, startY: 1, stepX: 1, stepY: 2 },
] as const

const passLength = (size: number, start: number, step: number): number =>
  start >= size ? 0 : Math.floor((size - start + step - 1) / step)

const adam7Fixture = (format: SupportedFormat, width = 43, height = 41): Buffer => {
  const rows: Uint8Array[] = []
  let filter = 0
  for (const pass of adam7Passes) {
    const passWidth = passLength(width, pass.startX, pass.stepX)
    const passHeight = passLength(height, pass.startY, pass.stepY)
    if (passWidth === 0 || passHeight === 0) continue
    let previous: Uint8Array = new Uint8Array(passWidth * channelCount(format.format))
    for (let y = 0; y < passHeight; y += 1) {
      const sourceY = pass.startY + y * pass.stepY
      const row = sourceRow(passWidth, sourceY, format, pass.startX, pass.stepX)
      rows.push(filteredRow(row, previous, channelCount(format.format), filter % 5))
      previous = row
      filter += 1
    }
  }
  return pngFromScanlines(width, height, 8, format.colorType, Buffer.concat(rows), {
    interlace: true,
  })
}

const paletteFixture = (width = 43, height = 41): Buffer => {
  const rows: Uint8Array[] = []
  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(width + 1)
    for (let x = 0; x < width; x += 1) row[x + 1] = (x + y * 3) & 3
    rows.push(row)
  }
  return pngFromScanlines(width, height, 8, 3, Buffer.concat(rows), {
    palette: Uint8Array.of(3, 5, 7, 29, 31, 37, 101, 103, 107, 211, 223, 227),
  })
}

const gray16Fixture = (width = 43, height = 41): Buffer => {
  const rows: Uint8Array[] = []
  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(width * 2 + 1)
    for (let x = 0; x < width; x += 1) {
      const value = (x * 997 + y * 811) & 65_535
      row[x * 2 + 1] = value >>> 8
      row[x * 2 + 2] = value & 255
    }
    rows.push(row)
  }
  return pngFromScanlines(width, height, 16, 0, Buffer.concat(rows))
}

interface DecodedPixels {
  readonly blockHeights: readonly number[]
  readonly data: Uint8Array
  readonly format: PixelFormat
  readonly height: number
  readonly width: number
}

const appendBlock = (
  output: Uint8Array,
  outputWidth: number,
  channels: number,
  block: PixelBlock,
): void => {
  for (let row = 0; row < block.height; row += 1) {
    output.set(
      block.data.subarray(row * block.stride, row * block.stride + block.width * channels),
      ((block.y + row) * outputWidth + block.x) * channels,
    )
  }
  block.release?.()
}

const decoderPixels = async (
  decoder: ImageDecoder,
  request: DecodeRequest = {},
): Promise<DecodedPixels> => {
  const width = request.width ?? decoder.width - (request.x ?? 0)
  const height = request.height ?? decoder.height - (request.y ?? 0)
  const channels = channelCount(decoder.pixelFormat)
  const output = new Uint8Array(width * height * channels)
  const blockHeights: number[] = []
  for await (const block of decoder.decode(request)) {
    expect(block.format).toBe(decoder.pixelFormat)
    appendBlock(output, width, channels, block)
    blockHeights.push(block.height)
  }
  return { blockHeights, data: output, format: decoder.pixelFormat, height, width }
}

const decode = async (
  codec: ImageCodec,
  input: Uint8Array,
  request: DecodeRequest = {},
): Promise<DecodedPixels> => {
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('PNG decoder is unavailable')
  return decoderPixels(decoder, request)
}

const createDecoder = async (codec: ImageCodec, input: Uint8Array): Promise<ImageDecoder> => {
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('PNG decoder is unavailable')
  return decoder
}

const makePixelBlock = (
  format: SupportedFormat['format'],
  width: number,
  y: number,
  height: number,
  stridePadding: number,
): PixelBlock => {
  const channels = channelCount(format)
  const stride = width * channels + stridePadding
  const data = new Uint8Array(stride * height)
  data.fill(0xa5)
  for (let row = 0; row < height; row += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        data[row * stride + x * channels + channel] = sample(x, y + row, channel)
      }
    }
  }
  return { data, format, height, stride, width, x: 0, y }
}

const createEncoder = async (
  codec: ImageCodec,
  sink: ImageSink,
  format: SupportedFormat['format'],
  width: number,
  height: number,
  compressionLevel = 6,
): Promise<ImageEncoder> => {
  const encoder = await codec.createEncoder?.(sink, {
    height,
    options: { compressionLevel },
    pixelFormat: format,
    runtime: nodeRuntime,
    width,
  })
  if (!encoder) throw new Error('PNG encoder is unavailable')
  return encoder
}

const encode = async (
  codec: ImageCodec,
  format: SupportedFormat['format'],
  width = 47,
  height = 69,
  compressionLevel = 6,
): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await createEncoder(codec, sink, format, width, height, compressionLevel)
  let y = 0
  for (const [preferredHeight, stridePadding] of [
    [17, 7],
    [32, 3],
    [height, 11],
  ] as const) {
    if (y === height) break
    const blockHeight = Math.min(preferredHeight, height - y)
    await encoder.write(makePixelBlock(format, width, y, blockHeight, stridePadding))
    y += blockHeight
  }
  await encoder.finish()
  return sink.toUint8Array()
}

const expectedRgba = (format: SupportedFormat['format'], width: number, height: number): Buffer => {
  const output = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      if (format === 'gray8') {
        output[offset] = sample(x, y, 0)
        output[offset + 1] = sample(x, y, 0)
        output[offset + 2] = sample(x, y, 0)
        output[offset + 3] = 255
      } else {
        output[offset] = sample(x, y, 0)
        output[offset + 1] = sample(x, y, 1)
        output[offset + 2] = sample(x, y, 2)
        output[offset + 3] = format === 'rgba8' ? sample(x, y, 3) : 255
      }
    }
  }
  return output
}

const acceleratedWithArtifact = (
  kind: 'scalar' | 'simd',
  url: URL,
  direction: 'decode' | 'encode',
  onLoad?: () => void,
): ImageCodec => {
  const loader = async (): Promise<WebAssembly.Instance> => {
    onLoad?.()
    return instantiateArtifact(url)
  }
  const loaders =
    direction === 'decode'
      ? kind === 'simd'
        ? { simdDecoder: loader }
        : { decoder: loader }
      : kind === 'simd'
        ? { simdEncoder: loader }
        : { encoder: loader }
  return createWasmPngAcceleratorWithLoaders(loaders, {
    minimumEncodePixels: 1,
    minimumPixels: 1,
  }).accelerate(pngCodec)
}

class FailingSink implements ImageSink {
  write(_chunk: Uint8Array): Promise<void> {
    return Promise.reject(new Error('simulated PNG sink failure'))
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  abort(reason: unknown): Promise<void> {
    void reason
    return Promise.resolve()
  }
}

const transparentRgbRows = (width: number, height: number): Uint8Array => {
  const rows = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const offset = y * (width * 3 + 1)
    for (let x = 0; x < width; x += 1) {
      rows[offset + x * 3 + 1] = sample(x, y, 0)
      rows[offset + x * 3 + 2] = sample(x, y, 1)
      rows[offset + x * 3 + 3] = sample(x, y, 2)
    }
  }
  return rows
}

describe('Rust/WASM PNG accelerator', () => {
  it.each(
    artifactCases.flatMap((artifact) =>
      supportedFormats.flatMap((format) =>
        [0, 1, 2, 3, 4].map((filter) => ({ artifact, filter, format })),
      ),
    ),
  )(
    'decodes $format.label filter $filter exactly with the $artifact.kind artifact',
    async ({ artifact, filter, format }) => {
      let loads = 0
      const input = supportedFixture(format, filter)
      const accelerated = acceleratedWithArtifact(artifact.kind, artifact.url, 'decode', () => {
        loads += 1
      })
      const expected = await decode(pngCodec, input)
      const actual = await decode(accelerated, input)

      expect(actual).toEqual(expected)
      expect(actual.blockHeights).toEqual([32, 32, 3])
      expect(loads).toBe(1)
    },
  )

  it.each(artifactCases)(
    'encodes gray8, rgb8, and rgba8 exactly with ordered strided blocks using the $kind artifact',
    async ({ kind, url }) => {
      let loads = 0
      const accelerated = acceleratedWithArtifact(kind, url, 'encode', () => {
        loads += 1
      })
      for (const format of supportedFormats) {
        const expected = await encode(pngCodec, format.format)
        const actual = await encode(accelerated, format.format)
        expect(actual).toEqual(expected)
        const decoded = PNG.sync.read(Buffer.from(actual))
        expect({ height: decoded.height, width: decoded.width }).toEqual({ height: 69, width: 47 })
        expect(decoded.data).toEqual(expectedRgba(format.format, 47, 69))
      }
      expect(loads).toBe(1)
    },
  )

  it('loads checked-in artifacts through the public Node entry', async () => {
    const input = supportedFixture(rgbaFormat, 4)
    const options: WasmPngAcceleratorOptions = {
      minimumEncodePixels: 1,
      minimumPixels: 1,
    }
    const accelerated = createWasmPngAccelerator(options).accelerate(pngCodec)

    await expect(decode(accelerated, input)).resolves.toEqual(await decode(pngCodec, input))
    await expect(encode(accelerated, 'rgba8')).resolves.toEqual(await encode(pngCodec, 'rgba8'))
    expect(wasmPngAccelerator.accelerate).toBeTypeOf('function')
  })

  it('loads lazily and caches independent warm decoder and encoder instances', async () => {
    let decoderLoads = 0
    let encoderLoads = 0
    const accelerator = createWasmPngAcceleratorWithLoaders(
      {
        decoder: async () => {
          decoderLoads += 1
          return instantiateArtifact(scalarArtifactUrl)
        },
        encoder: async () => {
          encoderLoads += 1
          return instantiateArtifact(scalarArtifactUrl)
        },
      },
      { minimumEncodePixels: 1, minimumPixels: 1 },
    )
    const codec = accelerator.accelerate(pngCodec)
    expect(decoderLoads).toBe(0)
    expect(encoderLoads).toBe(0)

    const input = supportedFixture(rgbFormat, 3)
    await decode(codec, input)
    await decode(codec, input)
    await encode(codec, 'rgb8')
    await encode(codec, 'rgb8')
    expect(decoderLoads).toBe(1)
    expect(encoderLoads).toBe(1)
  })

  it('uses the measured 65,536-pixel default decode and encode selector boundary', async () => {
    let decoderLoads = 0
    let encoderLoads = 0
    const codec = createWasmPngAcceleratorWithLoaders({
      decoder: async () => {
        decoderLoads += 1
        return instantiateArtifact(scalarArtifactUrl)
      },
      encoder: async () => {
        encoderLoads += 1
        return instantiateArtifact(scalarArtifactUrl)
      },
    }).accelerate(pngCodec)
    const input = supportedFixture(rgbFormat, 4, 256, 256)
    await expect(decode(codec, input)).resolves.toEqual(await decode(pngCodec, input))
    await expect(encode(codec, 'rgb8', 256, 256)).resolves.toEqual(
      await encode(pngCodec, 'rgb8', 256, 256),
    )
    expect(decoderLoads).toBe(1)
    expect(encoderLoads).toBe(1)
  })

  it('prefers SIMD and falls back independently to scalar decode and encode modules', async () => {
    const input = supportedFixture(rgbaFormat, 4)
    let preferredScalarLoads = 0
    let preferredSimdLoads = 0
    const preferred = createWasmPngAcceleratorWithLoaders(
      {
        decoder: async () => {
          preferredScalarLoads += 1
          return instantiateArtifact(scalarArtifactUrl)
        },
        encoder: async () => {
          preferredScalarLoads += 1
          return instantiateArtifact(scalarArtifactUrl)
        },
        simdDecoder: async () => {
          preferredSimdLoads += 1
          return instantiateArtifact(simdArtifactUrl)
        },
        simdEncoder: async () => {
          preferredSimdLoads += 1
          return instantiateArtifact(simdArtifactUrl)
        },
      },
      { minimumEncodePixels: 1, minimumPixels: 1 },
    ).accelerate(pngCodec)
    await expect(decode(preferred, input)).resolves.toEqual(await decode(pngCodec, input))
    await expect(encode(preferred, 'rgba8')).resolves.toEqual(await encode(pngCodec, 'rgba8'))
    expect(preferredSimdLoads).toBe(2)
    expect(preferredScalarLoads).toBe(0)

    let scalarLoads = 0
    let unavailableSimdLoads = 0
    const scalarFallback = createWasmPngAcceleratorWithLoaders(
      {
        decoder: async () => {
          scalarLoads += 1
          return instantiateArtifact(scalarArtifactUrl)
        },
        encoder: async () => {
          scalarLoads += 1
          return instantiateArtifact(scalarArtifactUrl)
        },
        simdDecoder: async () => {
          unavailableSimdLoads += 1
          throw new Error('simulated unavailable SIMD decoder')
        },
        simdEncoder: async () => {
          unavailableSimdLoads += 1
          throw new Error('simulated unavailable SIMD encoder')
        },
      },
      { minimumEncodePixels: 1, minimumPixels: 1 },
    ).accelerate(pngCodec)
    await expect(decode(scalarFallback, input)).resolves.toEqual(await decode(pngCodec, input))
    await expect(encode(scalarFallback, 'rgba8')).resolves.toEqual(await encode(pngCodec, 'rgba8'))
    expect(unavailableSimdLoads).toBe(2)
    expect(scalarLoads).toBe(2)
  })

  it('falls back without loading for small, cropped, Adam7, palette, transparent, 16-bit, and oversized-row inputs', async () => {
    const supported = rgbaFormat
    let defaultLoads = 0
    const defaultThreshold = createWasmPngAcceleratorWithLoader(async () => {
      defaultLoads += 1
      return instantiateArtifact(scalarArtifactUrl)
    }).accelerate(pngCodec)
    const small = supportedFixture(supported, 0, 31, 29)
    await expect(decode(defaultThreshold, small)).resolves.toEqual(await decode(pngCodec, small))
    expect(defaultLoads).toBe(0)

    let smallEncoderLoads = 0
    const smallEncoder = createWasmPngAcceleratorWithLoaders({
      encoder: async () => {
        smallEncoderLoads += 1
        return instantiateArtifact(scalarArtifactUrl)
      },
    }).accelerate(pngCodec)
    await expect(encode(smallEncoder, 'rgba8', 31, 29)).resolves.toEqual(
      await encode(pngCodec, 'rgba8', 31, 29),
    )
    expect(smallEncoderLoads).toBe(0)

    let nonAdaptiveLoads = 0
    const nonAdaptive = createWasmPngAcceleratorWithLoaders(
      {
        encoder: async () => {
          nonAdaptiveLoads += 1
          return instantiateArtifact(scalarArtifactUrl)
        },
      },
      { minimumEncodePixels: 1 },
    ).accelerate(pngCodec)
    await expect(encode(nonAdaptive, 'rgba8', 47, 69, 0)).resolves.toEqual(
      await encode(pngCodec, 'rgba8', 47, 69, 0),
    )
    expect(nonAdaptiveLoads).toBe(0)

    let loads = 0
    const fallback = createWasmPngAcceleratorWithLoader(
      async () => {
        loads += 1
        return instantiateArtifact(scalarArtifactUrl)
      },
      { minimumPixels: 1 },
    ).accelerate(pngCodec)
    const regular = supportedFixture(supported, 1)
    const transparent = pngFromScanlines(43, 67, 8, 2, transparentRgbRows(43, 67), {
      transparency: Uint8Array.of(0, 1, 0, 2, 0, 3),
    })
    for (const [input, request] of [
      [regular, { height: 19, width: 23, x: 3, y: 5 }],
      [adam7Fixture(supported), {}],
      [paletteFixture(), {}],
      [transparent, {}],
      [gray16Fixture(), {}],
    ] as const) {
      await expect(decode(fallback, input, request)).resolves.toEqual(
        await decode(pngCodec, input, request),
      )
    }
    expect(loads).toBe(0)

    let rowLimitDecoderLoads = 0
    let rowLimitEncoderLoads = 0
    const rowLimited = createWasmPngAcceleratorWithLoaders(
      {
        decoder: async () => {
          rowLimitDecoderLoads += 1
          return instantiateArtifact(scalarArtifactUrl)
        },
        encoder: async () => {
          rowLimitEncoderLoads += 1
          return instantiateArtifact(scalarArtifactUrl)
        },
      },
      { maximumRowBytes: 64, minimumEncodePixels: 1, minimumPixels: 1 },
    ).accelerate(pngCodec)
    await expect(decode(rowLimited, regular)).resolves.toEqual(await decode(pngCodec, regular))
    await expect(encode(rowLimited, 'rgba8')).resolves.toEqual(await encode(pngCodec, 'rgba8'))
    expect(rowLimitDecoderLoads).toBe(0)
    expect(rowLimitEncoderLoads).toBe(0)
  })

  it('caches unavailable and invalid modules as reference-codec fallbacks', async () => {
    const input = supportedFixture(rgbFormat, 2)
    let unavailableDecoderLoads = 0
    let unavailableEncoderLoads = 0
    const unavailable = createWasmPngAcceleratorWithLoaders(
      {
        decoder: async () => {
          unavailableDecoderLoads += 1
          throw new Error('simulated unavailable PNG decoder module')
        },
        encoder: async () => {
          unavailableEncoderLoads += 1
          throw new Error('simulated unavailable PNG encoder module')
        },
      },
      { minimumEncodePixels: 1, minimumPixels: 1 },
    ).accelerate(pngCodec)
    await expect(decode(unavailable, input)).resolves.toEqual(await decode(pngCodec, input))
    await expect(decode(unavailable, input)).resolves.toEqual(await decode(pngCodec, input))
    await expect(encode(unavailable, 'rgb8')).resolves.toEqual(await encode(pngCodec, 'rgb8'))
    await expect(encode(unavailable, 'rgb8')).resolves.toEqual(await encode(pngCodec, 'rgb8'))
    expect(unavailableDecoderLoads).toBe(1)
    expect(unavailableEncoderLoads).toBe(1)

    const emptyModule = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0))
    let invalidDecoderLoads = 0
    let invalidEncoderLoads = 0
    const invalid = createWasmPngAcceleratorWithLoaders(
      {
        decoder: async () => {
          invalidDecoderLoads += 1
          return new WebAssembly.Instance(emptyModule)
        },
        encoder: async () => {
          invalidEncoderLoads += 1
          return new WebAssembly.Instance(emptyModule)
        },
      },
      { minimumEncodePixels: 1, minimumPixels: 1 },
    ).accelerate(pngCodec)
    await expect(decode(invalid, input)).resolves.toEqual(await decode(pngCodec, input))
    await expect(decode(invalid, input)).resolves.toEqual(await decode(pngCodec, input))
    await expect(encode(invalid, 'rgb8')).resolves.toEqual(await encode(pngCodec, 'rgb8'))
    await expect(encode(invalid, 'rgb8')).resolves.toEqual(await encode(pngCodec, 'rgb8'))
    expect(invalidDecoderLoads).toBe(1)
    expect(invalidEncoderLoads).toBe(1)
  })

  it('falls back while instances are leased and releases decoder and encoder leases after completion', async () => {
    const input = supportedFixture(rgbaFormat, 4, 83, 97)
    const codec = createWasmPngAcceleratorWithLoaders(
      {
        decoder: () => instantiateArtifact(scalarArtifactUrl),
        encoder: () => instantiateArtifact(scalarArtifactUrl),
      },
      { minimumEncodePixels: 1, minimumPixels: 1 },
    ).accelerate(pngCodec)
    const firstDecoder = await createDecoder(codec, input)
    const iterator = firstDecoder.decode()[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done) throw new Error('PNG decoder did not yield its first block')

    await expect(decode(codec, input)).resolves.toEqual(await decode(pngCodec, input))

    const channels = channelCount(firstDecoder.pixelFormat)
    const firstOutput = new Uint8Array(firstDecoder.width * firstDecoder.height * channels)
    appendBlock(firstOutput, firstDecoder.width, channels, first.value)
    const heights = [first.value.height]
    for (;;) {
      const next = await iterator.next()
      if (next.done) break
      appendBlock(firstOutput, firstDecoder.width, channels, next.value)
      heights.push(next.value.height)
    }
    expect({
      blockHeights: heights,
      data: firstOutput,
      format: firstDecoder.pixelFormat,
      height: firstDecoder.height,
      width: firstDecoder.width,
    }).toEqual(await decode(pngCodec, input))
    await expect(decode(codec, input)).resolves.toEqual(await decode(pngCodec, input))

    const firstSink = new Uint8ArraySink()
    const firstEncoder = await createEncoder(codec, firstSink, 'rgba8', 47, 69)
    await expect(encode(codec, 'rgba8')).resolves.toEqual(await encode(pngCodec, 'rgba8'))
    await firstEncoder.write(makePixelBlock('rgba8', 47, 0, 69, 5))
    await firstEncoder.finish()
    expect(firstSink.toUint8Array()).toEqual(await encode(pngCodec, 'rgba8'))
    await expect(encode(codec, 'rgba8')).resolves.toEqual(await encode(pngCodec, 'rgba8'))
  })

  it('releases decoder and encoder leases after failures', async () => {
    const format = rgbaFormat
    const valid = supportedFixture(format, 4)
    const invalidFilterRows = new Uint8Array((43 * 4 + 1) * 67)
    invalidFilterRows[0] = 5
    const invalidFilter = pngFromScanlines(43, 67, 8, 6, invalidFilterRows)
    const codec = createWasmPngAcceleratorWithLoaders(
      {
        decoder: () => instantiateArtifact(scalarArtifactUrl),
        encoder: () => instantiateArtifact(scalarArtifactUrl),
      },
      { minimumEncodePixels: 1, minimumPixels: 1 },
    ).accelerate(pngCodec)

    await expect(decode(codec, invalidFilter)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(decode(codec, valid)).resolves.toEqual(await decode(pngCodec, valid))

    await expect(createEncoder(codec, new FailingSink(), 'rgba8', 47, 69)).rejects.toThrow(
      'simulated PNG sink failure',
    )
    await expect(encode(codec, 'rgba8')).resolves.toEqual(await encode(pngCodec, 'rgba8'))
  })

  it('rejects invalid selection and row-bound options before registration', () => {
    const loader = () => instantiateArtifact(scalarArtifactUrl)
    expect(() => createWasmPngAcceleratorWithLoader(loader, { minimumPixels: 0 })).toThrow(
      /minimumPixels must be a positive integer/,
    )
    expect(() =>
      createWasmPngAcceleratorWithLoaders({ encoder: loader }, { minimumEncodePixels: 1.5 }),
    ).toThrow(/minimumEncodePixels must be a positive integer/)
    expect(() => createWasmPngAcceleratorWithLoader(loader, { maximumRowBytes: 0 })).toThrow(
      /maximumRowBytes must be a positive integer/,
    )
  })
})
