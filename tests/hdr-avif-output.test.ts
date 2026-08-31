import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'vitest'

import { avifCodec, inspectAvifBitstreams } from '../src/codecs/avif.ts'
import { createEvidenceSession } from '../src/evidence.ts'
import { normalizeGainMapMetadata, openGainMapImage, writeGainMapAvif } from '../src/hdr/index.ts'
import { resolveLimits } from '../src/limits.ts'
import type { ImageSink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

describe('constrained ISO gain-map AVIF output', () => {
  test('reports bounded coded-item and container assembly evidence', async () => {
    const session = createEvidenceSession({ mode: 'summary' })
    const opened = await openGainMapImage(
      new Uint8Array(await readFile('benchmark/corpus/files/hdr-surgery-synthetic-dual.jpg')),
      { evidence: session.context },
    )
    try {
      await opened.resize({ width: 64, height: 36 }).avif()
    } finally {
      opened.close()
    }
    const report = session.finalize()
    expect(report.scopes.map((scope) => scope.label)).toEqual(
      expect.arrayContaining(['AVIF coded-item assembly', 'AVIF container assembly']),
    )
  })

  test('writes one base, one gain-map, and one preferred tone-map item', async () => {
    const jpeg = new Uint8Array(
      await readFile('benchmark/corpus/files/hdr-surgery-synthetic-dual.jpg'),
    )
    const opened = await openGainMapImage(jpeg)
    const avif = await opened.resize({ width: 64, height: 36, kernel: 'bilinear' }).avif()
    const inspection = await inspectAvifBitstreams(new MemorySource(avif))
    expect(inspection.primaryItemType).toBe('av01')
    expect(inspection.gainMap).toMatchObject({
      gainMapItemType: 'av01',
      metadata: { channelCount: 1, baseRendition: 'sdr', useBaseColorSpace: true },
    })
    expect(inspection.displayRegion).toMatchObject({ width: 64, height: 36 })
    const gain = inspection.codedImages.find((image) => image.role === 'gain-map')
    expect(gain).toMatchObject({
      width: 16,
      height: 9,
      nclx: {
        primaries: 2,
        transferCharacteristics: 2,
        matrixCoefficients: 1,
        fullRange: true,
      },
      sequence: {
        colorPrimaries: 2,
        transferCharacteristics: 2,
        matrixCoefficients: 1,
        fullRange: true,
      },
    })

    if (!avifCodec.createDecoder) throw new Error('AVIF decoder is unavailable')
    const decoder = await avifCodec.createDecoder(new MemorySource(avif), resolveLimits({}))
    let rows = 0
    for await (const block of decoder.decode()) rows += block.height
    expect(rows).toBe(36)

    const generic = await openGainMapImage(avif)
    expect(generic.inspection()).toMatchObject({
      container: 'avif',
      metadata: {
        baseDimensions: { width: 64, height: 36 },
        gainMapDimensions: { width: 16, height: 9 },
        selectedRepresentation: 'iso-21496-1',
      },
    })
    expect((await generic.extractBase()).byteLength).toBeGreaterThan(0)
    expect((await generic.extractGainMap()).byteLength).toBeGreaterThan(0)
    let genericRows = 0
    let genericMaximum = 0
    for await (const block of generic.render({ displayBoost: 8 })) {
      genericRows += block.height
      for (const value of block.data) genericMaximum = Math.max(genericMaximum, value)
    }
    expect(genericRows).toBe(36)
    expect(genericMaximum).toBeGreaterThan(1)
    generic.close()
    opened.close()
  })

  test('opens the pinned HDR-base AVIF through the generic selected-boost API', async () => {
    const source = new Uint8Array(
      await readFile('benchmark/corpus/files/avif/libavif-seine-hdr-gainmap-srgb.avif'),
    )
    const opened = await openGainMapImage(source)
    expect(opened.inspection()).toMatchObject({
      container: 'avif',
      metadata: {
        baseRendition: 'hdr',
        channelCount: 3,
        capacityMinimum: 0,
        capacityMaximum: 1.3,
      },
    })
    let sdrMaximum = 0
    for await (const block of opened.render({ displayBoost: 1 })) {
      for (const value of block.data) sdrMaximum = Math.max(sdrMaximum, value)
    }
    let rows = 0
    let maximum = 0
    for await (const block of opened.render({ displayBoost: 2 ** 1.3 })) {
      rows += block.height
      expect(block.colorSemantics).toMatchObject({
        primaries: 'srgb',
        transfer: { kind: 'linear' },
        matrix: 'identity',
        range: 'full',
      })
      for (const value of block.data) maximum = Math.max(maximum, value)
    }
    expect(rows).toBe(300)
    expect(maximum).toBeGreaterThan(sdrMaximum)
    opened.close()
  })

  test('propagates cancellation through AVIF gain-map inspection reads', async () => {
    const bytes = new Uint8Array(
      await readFile('benchmark/corpus/files/avif/libavif-seine-hdr-gainmap-srgb.avif'),
    )
    const controller = new AbortController()
    let reads = 0
    const source = {
      size: bytes.byteLength,
      async read(offset: number, length: number): Promise<Uint8Array> {
        reads += 1
        if (reads === 1) controller.abort()
        return bytes.subarray(offset, Math.min(bytes.byteLength, offset + length))
      },
    }
    await expect(openGainMapImage(source, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(reads).toBe(1)
  })

  test('rejects a gain-map relationship that needs an unimplemented gamut conversion', async () => {
    const source = new Uint8Array(
      await readFile('benchmark/corpus/files/avif/libavif-seine-hdr-gainmap-srgb.avif'),
    )
    const marker = new TextEncoder().encode('nclx')
    let occurrence = 0
    let alternateOffset = -1
    for (let offset = 0; offset <= source.byteLength - marker.byteLength; offset += 1) {
      if (marker.every((value, index) => source[offset + index] === value)) {
        occurrence += 1
        if (occurrence === 2) {
          alternateOffset = offset
          break
        }
      }
    }
    expect(alternateOffset).toBeGreaterThan(0)
    source[alternateOffset + 4] = 0
    source[alternateOffset + 5] = 12
    await expect(openGainMapImage(source)).rejects.toThrow(
      /different base and alternate primaries/u,
    )
  })

  test('rejects RGB gain maps outside the first AVIF output subset', async () => {
    const jpeg = new Uint8Array(
      await readFile('benchmark/corpus/files/hdr-surgery-synthetic-rgb-progressive.jpg'),
    )
    const opened = await openGainMapImage(jpeg)
    await expect(opened.avif()).rejects.toThrow(/one-channel gain map/u)
    opened.close()
  })

  test('closes a successful AVIF sink and aborts it after a partial write failure', async () => {
    const color = Object.freeze({
      family: 'rgb' as const,
      primaries: 'srgb' as const,
      transfer: Object.freeze({ kind: 'srgb' as const }),
      matrix: 'identity' as const,
      range: 'full' as const,
      alpha: 'none' as const,
      provenance: 'decoder-converted' as const,
    })
    const rasters = Object.freeze({
      base: Object.freeze({ width: 8, height: 4, channels: 3 as const, data: new Uint8Array(96) }),
      gainMap: Object.freeze({
        width: 4,
        height: 2,
        channels: 1 as const,
        data: new Uint8Array(8),
      }),
      metadata: normalizeGainMapMetadata({
        baseRendition: 'sdr',
        channelCount: 1,
        baseDimensions: { width: 8, height: 4 },
        gainMapDimensions: { width: 4, height: 2 },
        minimum: 0,
        maximum: 2,
        gamma: 1,
        offsetSdr: 0,
        offsetHdr: 0,
        capacityMinimum: 0,
        capacityMaximum: 2,
        useBaseColorSpace: true,
        baseColor: color,
        alternateColor: { ...color, transfer: { kind: 'linear' } },
        gainMapColor: {
          ...color,
          family: 'gray',
          primaries: 'unspecified',
          transfer: { kind: 'linear' },
        },
        container: 'avif',
        representations: ['iso-21496-1'],
        selectedRepresentation: 'iso-21496-1',
        metadataRanges: [],
        orientation: 1,
        warnings: [],
      }),
    })
    let closed = false
    const successful: ImageSink = {
      async write(): Promise<void> {},
      async close(): Promise<void> {
        closed = true
      },
      async abort(): Promise<void> {
        throw new Error('Successful sink should not abort')
      },
    }
    await writeGainMapAvif(successful, rasters)
    expect(closed).toBe(true)

    const failure = new Error('partial sink failure')
    let writes = 0
    let aborted: unknown
    const failing: ImageSink = {
      async write(): Promise<void> {
        writes += 1
        if (writes === 2) throw failure
      },
      async close(): Promise<void> {
        throw new Error('Failing sink should not close')
      },
      async abort(reason: unknown): Promise<void> {
        aborted = reason
      },
    }
    await expect(writeGainMapAvif(failing, rasters)).rejects.toBe(failure)
    expect(aborted).toBe(failure)
  })
})
