import { describe, expect, test } from 'vitest'

import type { ImageDecoder } from '../src/codec.ts'
import { HdrMaterializationBudget, MaterializedUint8ArraySink } from '../src/hdr/materialization.ts'
import { normalizeGainMapMetadata } from '../src/hdr/model.ts'
import {
  encodeTransformedGainMapJpeg,
  gainMapMaterializationBudget,
  getGainMapMaterializationSnapshot,
  renderTransformedGainMapRasters,
  transformGainMapRasters,
} from '../src/hdr/transform.ts'
import type { PixelBlock, PixelFormat } from '../src/pixel.ts'

const decoder = (
  width: number,
  height: number,
  format: PixelFormat,
  data: Uint8Array,
): ImageDecoder => ({
  width,
  height,
  pixelFormat: format,
  capabilities: { sequential: true, regionDecode: false, scaledDecode: false, progressive: false },
  decode: () => ({
    async *[Symbol.asyncIterator](): AsyncGenerator<PixelBlock> {
      yield { x: 0, y: 0, width, height, stride: data.length / height, format, data }
    },
  }),
})

const color = Object.freeze({
  family: 'rgb' as const,
  primaries: 'srgb' as const,
  transfer: Object.freeze({ kind: 'linear' as const }),
  matrix: 'identity' as const,
  range: 'full' as const,
  alpha: 'none' as const,
  provenance: 'decoder-converted' as const,
})

const transformed = async () => {
  const width = 64
  const height = 32
  return transformGainMapRasters(
    decoder(width, height, 'rgb8', new Uint8Array(width * height * 3).fill(64)),
    decoder(
      width / 4,
      height / 4,
      'rgb8',
      new Uint8Array((width / 4) * (height / 4) * 3).fill(128),
    ),
    normalizeGainMapMetadata({
      baseRendition: 'sdr',
      channelCount: 3,
      baseDimensions: { width, height },
      gainMapDimensions: { width: width / 4, height: height / 4 },
      minimum: 0,
      maximum: 2,
      gamma: 1,
      offsetSdr: 0,
      offsetHdr: 0,
      capacityMinimum: 0,
      capacityMaximum: 2,
      useBaseColorSpace: true,
      baseColor: color,
      alternateColor: color,
      gainMapColor: color,
      container: 'jpeg',
      representations: ['iso-21496-1'],
      selectedRepresentation: 'iso-21496-1',
      metadataRanges: [],
      orientation: 1,
      warnings: [],
    }),
    [],
    { maxMaterializedBytes: 512 * 1024 },
  )
}

describe('HDR materialization accounting', () => {
  test('releases encoded chunks after final allocation, copy, and encoder abort failures', async () => {
    const allocationBudget = new HdrMaterializationBudget(1024)
    const allocationSink = new MaterializedUint8ArraySink(allocationBudget, 1024, {
      allocate(): Uint8Array {
        throw new Error('allocation failure')
      },
    })
    await allocationSink.write(Uint8Array.of(1, 2, 3))
    await expect(() => allocationSink.toMaterializedUint8Array()).toThrow('allocation failure')
    expect(allocationBudget.snapshot().currentBytes).toBe(0)

    const copyBudget = new HdrMaterializationBudget(1024)
    const copySink = new MaterializedUint8ArraySink(copyBudget, 1024, {
      copy(): void {
        throw new Error('copy failure')
      },
    })
    await copySink.write(Uint8Array.of(4, 5, 6))
    expect(() => copySink.toMaterializedUint8Array()).toThrow('copy failure')
    expect(copyBudget.snapshot().currentBytes).toBe(0)

    const abortBudget = new HdrMaterializationBudget(1024)
    const abortSink = new MaterializedUint8ArraySink(abortBudget)
    await abortSink.write(Uint8Array.of(7, 8, 9))
    await abortSink.abort(new Error('encoder failure'))
    await abortSink.abort(new Error('repeated abort'))
    expect(abortBudget.snapshot().currentBytes).toBe(0)
  })

  test('enforces a smaller later operation limit against retained rasters', async () => {
    const rasters = await transformed()
    const retained = getGainMapMaterializationSnapshot(rasters).retainedRasterBytes
    const iterator = renderTransformedGainMapRasters(rasters, 2, retained - 1)
    await expect(iterator.next()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(getGainMapMaterializationSnapshot(rasters).currentBytes).toBe(retained)
  })

  test('rejects invalid later operation limits after retained rasters are registered', async () => {
    const rasters = await transformed()

    expect(() => gainMapMaterializationBudget(rasters, Number.NaN)).toThrow(
      /positive safe integer/u,
    )
    expect(() => gainMapMaterializationBudget(rasters, 0)).toThrow(/positive safe integer/u)
  })

  test('restores retained accounting after early return, cancellation, and repeated renders', async () => {
    const rasters = await transformed()
    const retained = getGainMapMaterializationSnapshot(rasters).retainedRasterBytes
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const iterator = renderTransformedGainMapRasters(rasters, 2, 512 * 1024)
      const first = await iterator.next()
      expect(first.done).toBe(false)
      if (!first.done) {
        first.value.release?.()
        first.value.release?.()
      }
      await iterator.return(undefined)
      expect(getGainMapMaterializationSnapshot(rasters).currentBytes).toBe(retained)
    }

    const controller = new AbortController()
    const cancelled = renderTransformedGainMapRasters(rasters, 2, 512 * 1024, controller.signal)
    controller.abort()
    await expect(cancelled.next()).rejects.toMatchObject({ name: 'AbortError' })
    const snapshot = getGainMapMaterializationSnapshot(rasters)
    expect(snapshot.currentBytes).toBe(retained)
    expect(snapshot.peakBytes).toBeGreaterThan(retained)
    expect(snapshot.outputBlockMaximumBytes).toBe(64 * 32 * 3 * 4)
    expect(snapshot.fullAdaptedFloatImageAllocated).toBe(false)
  })

  test('retains only transformed rasters after repeated JPEG encodes', async () => {
    const rasters = await transformed()
    const retained = getGainMapMaterializationSnapshot(rasters).retainedRasterBytes
    for (let iteration = 0; iteration < 2; iteration += 1) {
      expect((await encodeTransformedGainMapJpeg(rasters)).byteLength).toBeGreaterThan(0)
      const snapshot = getGainMapMaterializationSnapshot(rasters)
      expect(snapshot.currentBytes).toBe(retained)
      expect(snapshot.encodedArtifactPeakBytes).toBeGreaterThan(0)
    }
  })
})
