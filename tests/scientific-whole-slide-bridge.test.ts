import { describe, expect, it } from 'vitest'
import type { PixelBlock } from '../src/pixel.ts'
import type {
  WholeSlideAssociatedImage,
  WholeSlideImage,
  WholeSlideRegionRequest,
} from '../src/pathology/whole-slide.ts'
import { MemorySource } from '../src/source.ts'
import type { ScientificReaderDescriptor } from '../src/scientific/reader.ts'
import { createWholeSlideScientificDocument } from '../src/scientific/whole-slide-bridge.ts'

const reader: ScientificReaderDescriptor = Object.freeze({
  id: 'example/whole-slide',
  version: '1.0.0',
  format: 'Synthetic whole slide',
  extensions: Object.freeze(['svs']),
  mediaTypes: Object.freeze(['image/tiff']),
  capabilities: Object.freeze({ datasets: 'pyramid-and-associated-images' }),
})

const metadata = Object.freeze({
  compression: 7,
  photometric: 2,
  samplesPerPixel: 3,
  bitsPerSample: Object.freeze([8, 8, 8]),
})
const metadataWithIcc = Object.freeze({
  ...metadata,
  iccProfile: { present: true as const, byteLength: 4, tag: 34675 as const },
})

const block = (width: number, height: number, release: () => void): PixelBlock =>
  Object.freeze({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 3,
    format: 'rgb8',
    data: new Uint8Array(width * height * 3),
    release,
  })

describe('generic whole-slide scientific bridge', () => {
  it('rejects mixed decoded formats before publishing a pyramid descriptor', async () => {
    const slide: WholeSlideImage = Object.freeze({
      width: 4,
      height: 4,
      format: 'rgb8',
      properties: Object.freeze({}),
      levels: Object.freeze([
        Object.freeze({
          index: 0,
          width: 4,
          height: 4,
          downsample: 1,
          format: 'rgb8' as const,
          async *tile() {},
        }),
        Object.freeze({
          index: 1,
          width: 2,
          height: 2,
          downsample: 2,
          format: 'gray8' as const,
          async *tile() {},
        }),
      ]),
      associatedImages: Object.freeze([]),
      async *readRegion() {
        yield* []
        throw new Error('Mixed-format pyramid must fail before reads')
      },
    })
    await expect(
      createWholeSlideScientificDocument({
        context: {
          primary: {
            id: 'mixed-slide',
            source: new MemorySource(Uint8Array.of(1)),
          },
        },
        reader,
        slide,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('resolves anisotropic levels, separates associated images, and forwards ownership', async () => {
    const reads: WholeSlideRegionRequest[] = []
    let releases = 0
    const associated = (id: string): WholeSlideAssociatedImage =>
      Object.freeze({
        id,
        label: id,
        width: 3,
        height: 2,
        format: 'rgb8' as const,
        metadata,
        async *read() {
          yield block(3, 2, () => {
            releases += 1
          })
        },
      })
    const slide: WholeSlideImage = Object.freeze({
      width: 8,
      height: 6,
      format: 'rgb8' as const,
      micronsPerPixel: 0.5,
      objectivePower: 20,
      properties: Object.freeze({ vendor: 'synthetic' }),
      levels: Object.freeze([
        Object.freeze({
          index: 0,
          width: 8,
          height: 6,
          downsample: 1,
          downsampleX: 1,
          downsampleY: 1,
          format: 'rgb8' as const,
          metadata: metadataWithIcc,
          async *tile() {},
        }),
        Object.freeze({
          index: 1,
          width: 4,
          height: 2,
          downsample: 2,
          downsampleX: 2,
          downsampleY: 3,
          format: 'rgb8' as const,
          metadata,
          async *tile() {},
        }),
      ]),
      associatedImages: Object.freeze([
        associated('label'),
        associated('macro'),
        associated('thumbnail'),
      ]),
      async *readRegion(request: Readonly<WholeSlideRegionRequest>) {
        request.signal?.throwIfAborted()
        reads.push(request)
        yield block(request.width, request.height, () => {
          releases += 1
        })
      },
    })
    const document = await createWholeSlideScientificDocument({
      context: {
        primary: {
          id: 'synthetic-slide',
          name: 'slide.svs',
          mediaType: 'image/tiff',
          source: new MemorySource(Uint8Array.of(1, 2, 3)),
        },
      },
      reader,
      slide,
      metadata: { vendor: slide.properties },
    })
    expect(document.datasets.map(({ id }) => id)).toEqual([
      'pyramid',
      'associated/label',
      'associated/macro',
      'associated/thumbnail',
    ])
    expect(new Set(document.datasets.map(({ identity }) => JSON.stringify(identity))).size).toBe(4)
    const pyramid = await document.openDataset('pyramid')
    expect(pyramid.descriptor.levels[1]).toMatchObject({
      level: 1,
      axisLengths: [
        { axisId: 'x', length: 4 },
        { axisId: 'y', length: 2 },
      ],
      axisCoordinates: [
        { axisId: 'x', coordinates: { type: 'linear', step: 1 } },
        { axisId: 'y', coordinates: { type: 'linear', step: 1.5 } },
      ],
    })
    expect(pyramid.descriptor.metadata).toMatchObject({
      levels: [
        {
          level: 0,
          tiff: {
            iccProfile: { present: true, byteLength: 4, tag: 34675 },
          },
        },
        { level: 1 },
      ],
    })
    for await (const raster of pyramid.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      resolutionLevel: 1,
      x: 1,
      y: 0,
      width: 2,
      height: 2,
    })) {
      expect(raster).toMatchObject({ x: 1, y: 0, width: 2, height: 2 })
      raster.release?.()
    }
    expect(reads).toEqual([expect.objectContaining({ level: 1, x: 1, y: 0, width: 2, height: 2 })])
    expect(releases).toBe(1)

    const abort = new AbortController()
    abort.abort(new Error('cancel synthetic slide'))
    const cancelledRead = async (): Promise<void> => {
      for await (const raster of pyramid.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        resolutionLevel: 1,
        width: 1,
        height: 1,
        signal: abort.signal,
      })) {
        raster.release?.()
      }
    }
    await expect(cancelledRead()).rejects.toThrow('cancel synthetic slide')
    expect(reads).toHaveLength(1)
  })
})
