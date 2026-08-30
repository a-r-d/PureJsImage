import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'vitest'

import { avifCodec, inspectAvifBitstreams } from '../src/codecs/avif.ts'
import { openGainMapImage } from '../src/hdr/index.ts'
import { resolveLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

describe('constrained ISO gain-map AVIF output', () => {
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
    expect(gain).toMatchObject({ width: 16, height: 9 })

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
      for (const value of block.data) maximum = Math.max(maximum, value)
    }
    expect(rows).toBe(300)
    expect(maximum).toBeGreaterThan(sdrMaximum)
    opened.close()
  })

  test('rejects RGB gain maps outside the first AVIF output subset', async () => {
    const jpeg = new Uint8Array(
      await readFile('benchmark/corpus/files/hdr-surgery-synthetic-rgb-progressive.jpg'),
    )
    const opened = await openGainMapImage(jpeg)
    await expect(opened.avif()).rejects.toThrow(/one-channel gain map/u)
    opened.close()
  })
})
