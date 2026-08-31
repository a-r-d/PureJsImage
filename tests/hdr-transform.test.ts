import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'vitest'

import type { ImageDecoder } from '../src/codec.ts'
import {
  encodeTransformedGainMapJpeg,
  inspectHdrJpeg,
  normalizeGainMapMetadata,
  openGainMapImage,
  renderTransformedGainMapRasters,
  transformGainMapRasters,
  writeGainMapAvif,
} from '../src/hdr/index.ts'
import type { PixelBlock, PixelFormat } from '../src/pixel.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

const fixturePath = 'benchmark/corpus/files/hdr-surgery-synthetic-dual.jpg'

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

describe('paired gain-map transforms', () => {
  test('crops, flips, rotates, resizes, writes, and reopens both renditions', async () => {
    const source = new Uint8Array(await readFile(fixturePath))
    const opened = await openGainMapImage(source)
    const transformed = opened
      .crop({ x: 40, y: 30, width: 240, height: 120 })
      .flipHorizontal()
      .rotate(90)
      .resize({ width: 60, height: 120, kernel: 'bilinear' })

    const jpeg = await transformed.jpeg({
      baseQuality: 88,
      gainMapQuality: 92,
      metadataMode: 'dual',
    })
    const inspection = await inspectHdrJpeg(new MemorySource(jpeg))
    expect(inspection.primaryDimensions).toMatchObject({ width: 60, height: 120 })
    expect(inspection.gainMapDimensions).toMatchObject({ width: 15, height: 30, components: 1 })
    expect(inspection.representations).toEqual(['iso-21496-1', 'ultra-hdr-xmp'])

    const reopened = await openGainMapImage(jpeg)
    expect(reopened.inspection().metadata.orientation).toBe(1)
    expect(reopened.inspection().metadata.baseDimensions).toEqual({ width: 60, height: 120 })
    expect(reopened.inspection().metadata.gainMapDimensions).toEqual({ width: 15, height: 30 })
    let rows = 0
    let maximum = 0
    for await (const block of reopened.render({ displayBoost: 8 })) {
      rows += block.height
      for (const value of block.data) maximum = Math.max(maximum, value)
    }
    expect(rows).toBe(120)
    expect(maximum).toBeGreaterThan(1)
    reopened.close()
    opened.close()
  })

  test('keeps non-integral crop alignment and scalar map cardinality', async () => {
    const source = new Uint8Array(
      await readFile('benchmark/corpus/files/hdr-surgery-synthetic-odd-scale.jpg'),
    )
    const opened = await openGainMapImage(source)
    const transformed = opened.crop({ x: 1, y: 1, width: 317, height: 185 })
    const output = await transformed.jpeg({ metadataMode: 'iso' })
    const reopened = await openGainMapImage(output)
    expect(reopened.inspection().metadata.sourceCardinality).toBe('scalar')
    expect(reopened.inspection().metadata.baseDimensions).toEqual({ width: 317, height: 185 })
    const map = reopened.inspection().metadata.gainMapDimensions
    expect(BigInt(map.width) * 185n).toBe(BigInt(map.height) * 317n)
    reopened.close()
    opened.close()
  })

  test('rejects transformed working sets above the caller limit', async () => {
    const source = new Uint8Array(await readFile(fixturePath))
    const opened = await openGainMapImage(source)
    await expect(
      opened.resize({ width: 640, height: 360 }).jpeg({
        maxMaterializedBytes: 1024,
      }),
    ).rejects.toThrow(/maxMaterializedBytes/u)
    opened.close()
  })

  test('does not start a deferred transformed decode after close', async () => {
    const opened = await openGainMapImage(
      new Uint8Array(await readFile('benchmark/corpus/files/hdr-surgery-synthetic-dual.jpg')),
    )
    const iterator = opened
      .resize({ width: 64, height: 36 })
      .render({ displayBoost: 2 })
      [Symbol.asyncIterator]()
    opened.close()
    await expect(iterator.next()).rejects.toThrow(/closed/u)
  })

  test('preserves straight base alpha through paired transforms and HDR rendering', async () => {
    const color = Object.freeze({
      family: 'rgb' as const,
      primaries: 'srgb' as const,
      transfer: Object.freeze({ kind: 'linear' as const }),
      matrix: 'identity' as const,
      range: 'full' as const,
      alpha: 'none' as const,
      provenance: 'decoder-converted' as const,
    })
    const metadata = normalizeGainMapMetadata({
      baseRendition: 'sdr',
      channelCount: 1,
      baseDimensions: { width: 2, height: 1 },
      gainMapDimensions: { width: 2, height: 1 },
      minimum: 0,
      maximum: 0,
      gamma: 1,
      offsetSdr: 0,
      offsetHdr: 0,
      capacityMinimum: 0,
      capacityMaximum: 1,
      useBaseColorSpace: true,
      baseColor: { ...color, alpha: 'straight' },
      alternateColor: color,
      gainMapColor: { ...color, family: 'gray' },
      container: 'avif',
      representations: ['iso-21496-1'],
      selectedRepresentation: 'iso-21496-1',
      metadataRanges: [],
      orientation: 1,
      warnings: [],
    })
    const transformed = await transformGainMapRasters(
      decoder(2, 1, 'rgba8', new Uint8Array([10, 20, 30, 64, 40, 50, 60, 192])),
      decoder(2, 1, 'rgb8', new Uint8Array([255, 255, 255, 255, 255, 255])),
      metadata,
      [{ type: 'flip-horizontal' }],
    )
    expect(transformed.base.channels).toBe(4)
    expect(Array.from(transformed.base.data)).toEqual([40, 50, 60, 192, 10, 20, 30, 64])
    const blocks = []
    for await (const block of renderTransformedGainMapRasters(transformed, 2)) blocks.push(block)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.pixelFormat).toBe('rgbaf32')
    expect(blocks[0]?.data[3]).toBeCloseTo(192 / 255, 7)
    expect(blocks[0]?.data[7]).toBeCloseTo(64 / 255, 7)
  })

  test('retains pending EXIF orientation through earlier transforms and applies it once', async () => {
    const color = Object.freeze({
      family: 'rgb' as const,
      primaries: 'srgb' as const,
      transfer: Object.freeze({ kind: 'linear' as const }),
      matrix: 'identity' as const,
      range: 'full' as const,
      alpha: 'none' as const,
      provenance: 'decoder-converted' as const,
    })
    const metadata = normalizeGainMapMetadata({
      baseRendition: 'sdr',
      channelCount: 1,
      baseDimensions: { width: 2, height: 1 },
      gainMapDimensions: { width: 2, height: 1 },
      minimum: 0,
      maximum: 0,
      gamma: 1,
      offsetSdr: 0,
      offsetHdr: 0,
      capacityMinimum: 0,
      capacityMaximum: 1,
      useBaseColorSpace: true,
      baseColor: color,
      alternateColor: color,
      gainMapColor: { ...color, family: 'gray' },
      container: 'jpeg',
      representations: ['ultra-hdr-xmp'],
      selectedRepresentation: 'ultra-hdr-xmp',
      metadataRanges: [],
      orientation: 6,
      warnings: [],
    })
    const pending = await transformGainMapRasters(
      decoder(2, 1, 'rgb8', new Uint8Array([10, 20, 30, 40, 50, 60])),
      decoder(2, 1, 'rgb8', new Uint8Array([0, 0, 0, 255, 255, 255])),
      metadata,
      [{ type: 'resize', width: 4, height: 2, kernel: 'nearest' }],
    )
    expect(pending.metadata.orientation).toBe(6)
    await expect(encodeTransformedGainMapJpeg(pending)).rejects.toThrow(/autoOrient/u)
    await expect(writeGainMapAvif(new Uint8ArraySink(), pending)).rejects.toThrow(/autoOrient/u)

    const transformed = await transformGainMapRasters(
      decoder(2, 1, 'rgb8', new Uint8Array([10, 20, 30, 40, 50, 60])),
      decoder(2, 1, 'rgb8', new Uint8Array([0, 0, 0, 255, 255, 255])),
      metadata,
      [{ type: 'resize', width: 4, height: 2, kernel: 'nearest' }, { type: 'auto-orient' }],
    )
    expect(transformed.base).toMatchObject({ width: 2, height: 4 })
    expect(transformed.gainMap).toMatchObject({ width: 2, height: 4 })
    expect(transformed.metadata).toMatchObject({
      baseDimensions: { width: 2, height: 4 },
      gainMapDimensions: { width: 2, height: 4 },
      orientation: 1,
    })

    const rotatedThenOriented = await transformGainMapRasters(
      decoder(2, 1, 'rgb8', new Uint8Array([10, 20, 30, 40, 50, 60])),
      decoder(2, 1, 'rgb8', new Uint8Array([0, 0, 0, 255, 255, 255])),
      metadata,
      [{ type: 'rotate', degrees: 90 }, { type: 'auto-orient' }],
    )
    expect(rotatedThenOriented.base).toMatchObject({ width: 2, height: 1 })
    expect(rotatedThenOriented.gainMap).toMatchObject({ width: 2, height: 1 })
    expect(rotatedThenOriented.metadata.orientation).toBe(1)
  })
})
