import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import type { ImageCodec, ImageDecoder } from '../src/codec.ts'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { defaultImageLimits } from '../src/limits.ts'
import type { PixelBlock } from '../src/pixel.ts'
import type { RasterBlock } from '../src/raster.ts'
import {
  createImageCodecScientificReader,
  getScientificDatasetIdentity,
  ScientificReaderRegistry,
  type ScientificDataset,
  type ScientificReaderDescriptor,
} from '../src/scientific/index.ts'
import { jpegReader } from '../src/scientific/readers/jpeg.ts'
import { pngReader } from '../src/scientific/readers/png.ts'
import { MemorySource } from '../src/source.ts'

const rgbaPixels = Uint8Array.of(
  5,
  15,
  25,
  35,
  45,
  55,
  65,
  75,
  85,
  95,
  105,
  115,
  125,
  135,
  145,
  155,
  165,
  175,
  185,
  195,
  205,
  215,
  225,
  235,
)

const pngFixture = (): Uint8Array => {
  const image = new PNG({ width: 3, height: 2 })
  image.data.set(rgbaPixels)
  return PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 })
}

const grayscalePngFixture = (): Uint8Array => {
  const image = new PNG({ width: 2, height: 1 })
  image.data.set([17, 17, 17, 255, 231, 231, 231, 255])
  return PNG.sync.write(image, { colorType: 0, inputColorType: 6, bitDepth: 8 })
}

const jpegFixture = (): Uint8Array =>
  jpeg.encode({ width: 3, height: 2, data: rgbaPixels }, 92).data

const visibleBytes = (block: PixelBlock | RasterBlock, channels: number): number[] => {
  const output: number[] = []
  for (let row = 0; row < block.height; row += 1) {
    output.push(
      ...block.data.subarray(row * block.stride, row * block.stride + block.width * channels),
    )
  }
  return output
}

const collectCodec = async (codec: ImageCodec, bytes: Uint8Array): Promise<number[]> => {
  const decoder = await codec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
  if (decoder === undefined) throw new Error('Test codec has no decoder')
  const channels = decoder.pixelFormat === 'gray8' ? 1 : decoder.pixelFormat === 'rgb8' ? 3 : 4
  const output: number[] = []
  for await (const block of decoder.decode()) {
    output.push(...visibleBytes(block, channels))
    block.release?.()
  }
  return output
}

const collectDataset = async (dataset: ScientificDataset): Promise<number[]> => {
  const output: number[] = []
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
  })) {
    output.push(...visibleBytes(block, block.format.channels))
    block.release?.()
  }
  return output
}

describe('image-codec scientific readers', () => {
  it.each([
    { name: 'PNG', bytes: pngFixture, codec: pngCodec, reader: pngReader, extension: 'sample.png' },
    {
      name: 'JPEG',
      bytes: jpegFixture,
      codec: jpegCodec,
      reader: jpegReader,
      extension: 'sample.jpg',
    },
  ])('opens $name through registry detection with exact codec pixels', async (fixture) => {
    const bytes = fixture.bytes()
    const digest = fixture.codec.format === 'png' ? 'a'.repeat(64) : 'b'.repeat(64)
    const source = new MemorySource(bytes, {
      identity: {
        kind: 'content',
        strength: 'strong',
        stability: 'content-addressed',
        algorithm: 'sha256',
        digest,
        size: bytes.byteLength,
      },
    })
    const registry = new ScientificReaderRegistry([pngReader, jpegReader])
    const document = await registry.open({
      primary: { id: 'primary', name: fixture.extension, source },
    })

    expect(document.reader.id).toBe(fixture.reader.descriptor.id)
    expect(document.datasets).toHaveLength(1)
    expect(document.datasets[0]?.id).toBe('image')
    expect(document.datasets[0]?.identity.resources).toEqual([
      {
        id: 'primary',
        identity: {
          kind: 'content',
          strength: 'strong',
          stability: 'content-addressed',
          algorithm: 'sha256',
          digest,
          size: bytes.byteLength,
        },
      },
    ])
    const dataset = await document.openDataset('image')
    expect(getScientificDatasetIdentity(dataset)).toBe(document.datasets[0]?.identity)
    expect(await collectDataset(dataset)).toEqual(await collectCodec(fixture.codec, bytes))
  })

  it('keeps metadata-only PNG/JPEG frame counts out of the selectable dataset shape', async () => {
    for (const [reader, bytes] of [
      [pngReader, pngFixture()],
      [jpegReader, jpegFixture()],
    ] as const) {
      const originalMetadata = reader === pngReader ? pngCodec.metadata : jpegCodec.metadata
      const codec = reader === pngReader ? pngCodec : jpegCodec
      const metadataOnlyCodec: ImageCodec = {
        ...codec,
        metadata: async (source, limits, options) => ({
          ...(await originalMetadata(source, limits, options)),
          frames: 4,
          resolutionLevels: 3,
        }),
      }
      const adapted = createImageCodecScientificReader({
        descriptor: reader.descriptor,
        codec: metadataOnlyCodec,
      })
      const document = await new ScientificReaderRegistry([adapted]).open({
        primary: { id: 'image', source: new MemorySource(bytes) },
        readerId: adapted.descriptor.id,
      })
      expect(document.datasets.map(({ id }) => id)).toEqual(['image'])
      expect(document.datasets[0]?.descriptor.levels).toHaveLength(1)
    }
  })

  it('preserves grayscale intensity semantics', async () => {
    const document = await new ScientificReaderRegistry([pngReader]).open({
      primary: { id: 'gray', name: 'gray.png', source: new MemorySource(grayscalePngFixture()) },
    })
    expect(document.datasets[0]?.descriptor.components).toEqual([
      { id: 'grayscale', name: 'Grayscale intensity', kind: 'intensity' },
    ])
    expect(await collectDataset(await document.openDataset('image'))).toEqual([17, 231])
  })

  it('uses one dataset per selectable frame and levels within each dataset', async () => {
    const descriptor: ScientificReaderDescriptor = {
      id: 'test/selectable',
      version: '1.0.0',
      format: 'Selectable test image',
      extensions: ['selectable'],
      mediaTypes: ['image/x-selectable'],
      capabilities: {},
    }
    const codec: ImageCodec = {
      format: 'selectable',
      mimeTypes: ['image/x-selectable'],
      minimumBytes: 1,
      selection: { frames: true, resolutionLevels: true },
      detect: (header) => header[0] === 99,
      metadata: async () => ({
        width: 8,
        height: 6,
        format: 'selectable',
        mimeType: 'image/x-selectable',
        hasAlpha: false,
        frames: 2,
        resolutionLevels: 2,
      }),
      createDecoder: async (_source, _limits, options = {}) => {
        const divisor = options.resolutionLevel === 1 ? 2 : 1
        return {
          width: 8 / divisor,
          height: 6 / divisor,
          pixelFormat: 'rgb8',
          capabilities: {
            sequential: true,
            regionDecode: true,
            scaledDecode: false,
            progressive: false,
          },
          async *decode(request = {}) {
            const width = request.width ?? 8 / divisor
            const height = request.height ?? 6 / divisor
            yield {
              x: request.x ?? 0,
              y: request.y ?? 0,
              width,
              height,
              stride: width * 3,
              format: 'rgb8',
              data: new Uint8Array(width * height * 3).fill(options.frame ?? 0),
            }
          },
        }
      },
    }
    const reader = createImageCodecScientificReader({ descriptor, codec })
    const document = await new ScientificReaderRegistry([reader]).open({
      primary: { id: 'selectable', source: new MemorySource(Uint8Array.of(99)) },
    })

    expect(document.datasets.map(({ id }) => id)).toEqual(['frame-0', 'frame-1'])
    expect(document.datasets[0]?.descriptor.levels).toEqual([
      {
        level: 0,
        axisLengths: [
          { axisId: 'x', length: 8 },
          { axisId: 'y', length: 6 },
        ],
      },
      {
        level: 1,
        axisLengths: [
          { axisId: 'x', length: 4 },
          { axisId: 'y', length: 3 },
        ],
      },
    ])
    const frame = await document.openDataset('frame-1')
    const iterator = frame
      .readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        resolutionLevel: 1,
        width: 1,
        height: 1,
      })
      [Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { width: 1, height: 1, data: Uint8Array.of(1, 1, 1) },
    })
    await iterator.return?.()
  })

  it('keeps codec adapters below specialized-reader confidence', async () => {
    const fallback = await pngReader.probe({
      primary: { id: 'png', name: 'sample.png', source: new MemorySource(pngFixture()) },
    })
    expect(fallback.confidence).toBe(0.6)
    const specialized = {
      descriptor: {
        ...pngReader.descriptor,
        id: 'test/specialized-png',
      },
      probe: async () => ({ confidence: 0.99, reason: 'specialized metadata matched' }),
      open: pngReader.open,
    }
    const detection = await new ScientificReaderRegistry([pngReader, specialized]).detect({
      primary: { id: 'png', name: 'sample.png', source: new MemorySource(pngFixture()) },
    })
    expect(detection.reader.id).toBe('test/specialized-png')
  })

  it('does not decode during open and transfers block data and release ownership zero-copy', async () => {
    const data = Uint8Array.of(10, 20, 30, 40)
    let decodeCalls = 0
    let releases = 0
    const decoder = (): ImageDecoder => ({
      width: 2,
      height: 2,
      pixelFormat: 'rgba8',
      capabilities: {
        sequential: true,
        regionDecode: true,
        scaledDecode: false,
        progressive: false,
      },
      async *decode(request = {}) {
        decodeCalls += 1
        yield {
          x: request.x ?? 0,
          y: request.y ?? 0,
          width: request.width ?? 2,
          height: request.height ?? 2,
          stride: (request.width ?? 2) * 4,
          format: 'rgba8',
          data,
          release: () => {
            releases += 1
          },
        }
      },
    })
    const codec: ImageCodec = {
      format: 'test-rgba',
      mimeTypes: ['image/x-test-rgba'],
      minimumBytes: 1,
      detect: (header) => header[0] === 42,
      metadata: async () => ({
        width: 2,
        height: 2,
        format: 'test-rgba',
        mimeType: 'image/x-test-rgba',
        hasAlpha: true,
      }),
      createDecoder: async () => decoder(),
    }
    const descriptor: ScientificReaderDescriptor = {
      id: 'test/rgba',
      version: '1.0.0',
      format: 'Test RGBA',
      extensions: ['rgba'],
      mediaTypes: ['image/x-test-rgba'],
      capabilities: {},
    }
    const reader = createImageCodecScientificReader({ descriptor, codec })
    const document = await new ScientificReaderRegistry([reader]).open({
      primary: { id: 'test', source: new MemorySource(Uint8Array.of(42)) },
    })
    expect(decodeCalls).toBe(0)
    expect(document.datasets[0]?.descriptor.components.map(({ kind }) => kind)).toEqual([
      'red',
      'green',
      'blue',
      'alpha',
    ])

    const dataset = await document.openDataset('image')
    const iterator = dataset
      .readPlane({ displayAxes: ['x', 'y'], fixedIndices: [], x: 1, y: 1, width: 1, height: 1 })
      [Symbol.asyncIterator]()
    const result = await iterator.next()
    expect(result.done).toBe(false)
    if (result.done === true) throw new Error('Expected a scientific raster block')
    expect(result.value.data).toBe(data)
    expect(result.value).toMatchObject({ x: 1, y: 1, width: 1, height: 1, stride: 4 })
    expect(releases).toBe(0)
    result.value.release?.()
    expect(releases).toBe(1)
    await iterator.return?.()
  })

  it('observes cancellation after a document is opened without decoding another block', async () => {
    const controller = new AbortController()
    const document = await new ScientificReaderRegistry([pngReader]).open({
      primary: { id: 'png', name: 'sample.png', source: new MemorySource(pngFixture()) },
    })
    const dataset = await document.openDataset('image')
    controller.abort(new DOMException('cancel image read', 'AbortError'))
    const iterator = dataset
      .readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        signal: controller.signal,
      })
      [Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
  })
})
