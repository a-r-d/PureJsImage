import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { crc32 } from '../src/codecs/crc32.ts'
import { rasterSampleBytes } from '../src/raster.ts'
import type { ScientificDataset } from '../src/scientific/dataset.ts'
import { openZipArchive, normalizeZipPath } from '../src/scientific/formats/zip.ts'
import { createDigitalSurfReader } from '../src/scientific/readers/digital-surf.ts'
import { createIgorBinaryWaveReader } from '../src/scientific/readers/igor-binary-wave.ts'
import { createNanonisSxmReader } from '../src/scientific/readers/nanonis-sxm.ts'
import { createX3pReader } from '../src/scientific/readers/x3p.ts'
import { readRasterSample } from '../src/scientific/samples.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'
import surfaceCorpus from './fixtures/scientific-surface/corpus.json' with { type: 'json' }

const fixture = (name: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(readFileSync(`tests/fixtures/scientific-surface/${name}`))

const repairIbwChecksum = (bytes: Uint8Array<ArrayBuffer>): void => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, 384)
  view.setUint16(2, 0, true)
  let sum = 0
  for (let offset = 0; offset < 384; offset += 2) {
    sum = (sum + view.getUint16(offset, true)) & 0xffff
  }
  view.setUint16(2, -sum & 0xffff, true)
}

const generatedBigEndianIbw = (): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(384 + 32)
  const view = new DataView(output.buffer)
  view.setUint16(0, 5, false)
  view.setInt32(4, 320 + 32, false)
  const wave = 64
  view.setInt32(wave + 12, 16, false)
  view.setUint16(wave + 16, 0x10, false)
  output.set(new TextEncoder().encode('big4d'), wave + 28)
  for (let index = 0; index < 4; index += 1) {
    view.setInt32(wave + 68 + index * 4, 2, false)
    view.setFloat64(wave + 84 + index * 8, index + 0.25, false)
    view.setFloat64(wave + 116 + index * 8, index + 10, false)
  }
  for (let index = 0; index < 16; index += 1) view.setInt16(384 + index * 2, index, false)
  view.setUint16(2, 0, false)
  let sum = 0
  for (let offset = 0; offset < 384; offset += 2)
    sum = (sum + view.getUint16(offset, false)) & 0xffff
  view.setUint16(2, -sum & 0xffff, false)
  return output
}

class CountingSource implements ImageSource {
  readonly size: number
  readonly reads: Array<Readonly<{ readonly offset: number; readonly length: number }>> = []
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    if (options.signal?.aborted === true) throw options.signal.reason
    this.reads.push(Object.freeze({ offset, length }))
    return this.#bytes.slice(offset, offset + length)
  }
}

const zip = (
  name: string,
  value: Uint8Array,
  method: 0 | 8,
  options: Readonly<{
    readonly flags?: number
    readonly centralName?: string
    readonly crc?: number
  }> = {},
): Uint8Array<ArrayBuffer> => {
  const nameBytes = new TextEncoder().encode(name)
  const centralNameBytes = new TextEncoder().encode(options.centralName ?? name)
  const compressed = method === 0 ? value : Uint8Array.from(deflateRawSync(value))
  const localBytes = 30 + nameBytes.byteLength + compressed.byteLength
  const centralBytes = 46 + centralNameBytes.byteLength
  const bytes = new Uint8Array(localBytes + centralBytes + 22)
  const view = new DataView(bytes.buffer)
  const checksum = options.crc ?? crc32(value)
  view.setUint32(0, 0x0403_4b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, options.flags ?? 0, true)
  view.setUint16(8, method, true)
  view.setUint32(14, checksum, true)
  view.setUint32(18, compressed.byteLength, true)
  view.setUint32(22, value.byteLength, true)
  view.setUint16(26, nameBytes.byteLength, true)
  bytes.set(nameBytes, 30)
  bytes.set(compressed, 30 + nameBytes.byteLength)

  const central = localBytes
  view.setUint32(central, 0x0201_4b50, true)
  view.setUint16(central + 4, 20, true)
  view.setUint16(central + 6, 20, true)
  view.setUint16(central + 8, options.flags ?? 0, true)
  view.setUint16(central + 10, method, true)
  view.setUint32(central + 16, checksum, true)
  view.setUint32(central + 20, compressed.byteLength, true)
  view.setUint32(central + 24, value.byteLength, true)
  view.setUint16(central + 28, centralNameBytes.byteLength, true)
  bytes.set(centralNameBytes, central + 46)

  const end = central + centralBytes
  view.setUint32(end, 0x0605_4b50, true)
  view.setUint16(end + 8, 1, true)
  view.setUint16(end + 10, 1, true)
  view.setUint32(end + 12, centralBytes, true)
  view.setUint32(end + 16, central, true)
  return bytes
}

const zip64Stored = (name: string, value: Uint8Array): Uint8Array<ArrayBuffer> => {
  const nameBytes = new TextEncoder().encode(name)
  const localBytes = 30 + nameBytes.byteLength + value.byteLength
  const centralBytes = 46 + nameBytes.byteLength + 28
  const zip64RecordOffset = localBytes + centralBytes
  const bytes = new Uint8Array(zip64RecordOffset + 56 + 20 + 22)
  const view = new DataView(bytes.buffer)
  const checksum = crc32(value)
  view.setUint32(0, 0x0403_4b50, true)
  view.setUint16(4, 45, true)
  view.setUint32(14, checksum, true)
  view.setUint32(18, value.byteLength, true)
  view.setUint32(22, value.byteLength, true)
  view.setUint16(26, nameBytes.byteLength, true)
  bytes.set(nameBytes, 30)
  bytes.set(value, 30 + nameBytes.byteLength)
  const central = localBytes
  view.setUint32(central, 0x0201_4b50, true)
  view.setUint16(central + 4, 45, true)
  view.setUint16(central + 6, 45, true)
  view.setUint32(central + 16, checksum, true)
  view.setUint32(central + 20, 0xffff_ffff, true)
  view.setUint32(central + 24, 0xffff_ffff, true)
  view.setUint16(central + 28, nameBytes.byteLength, true)
  view.setUint16(central + 30, 28, true)
  view.setUint32(central + 42, 0xffff_ffff, true)
  bytes.set(nameBytes, central + 46)
  const extra = central + 46 + nameBytes.byteLength
  view.setUint16(extra, 1, true)
  view.setUint16(extra + 2, 24, true)
  view.setBigUint64(extra + 4, BigInt(value.byteLength), true)
  view.setBigUint64(extra + 12, BigInt(value.byteLength), true)
  view.setBigUint64(extra + 20, 0n, true)
  view.setUint32(zip64RecordOffset, 0x0606_4b50, true)
  view.setBigUint64(zip64RecordOffset + 4, 44n, true)
  view.setUint16(zip64RecordOffset + 12, 45, true)
  view.setUint16(zip64RecordOffset + 14, 45, true)
  view.setBigUint64(zip64RecordOffset + 24, 1n, true)
  view.setBigUint64(zip64RecordOffset + 32, 1n, true)
  view.setBigUint64(zip64RecordOffset + 40, BigInt(centralBytes), true)
  view.setBigUint64(zip64RecordOffset + 48, BigInt(central), true)
  const locator = zip64RecordOffset + 56
  view.setUint32(locator, 0x0706_4b50, true)
  view.setBigUint64(locator + 8, BigInt(zip64RecordOffset), true)
  view.setUint32(locator + 16, 1, true)
  const end = locator + 20
  view.setUint32(end, 0x0605_4b50, true)
  view.setUint16(end + 8, 0xffff, true)
  view.setUint16(end + 10, 0xffff, true)
  view.setUint32(end + 12, 0xffff_ffff, true)
  view.setUint32(end + 16, 0xffff_ffff, true)
  return bytes
}

const digitalSurfFixture = (
  options: Readonly<{
    readonly objectType: 1 | 2 | 5
    readonly width: number
    readonly height: number
    readonly layers?: number
    readonly values: readonly number[]
    readonly objects?: number
    readonly special?: boolean
  }>,
): Uint8Array<ArrayBuffer> => {
  const layers = options.layers ?? 1
  const output = new Uint8Array(512 + options.values.length * 2)
  const view = new DataView(output.buffer)
  let offset = 0
  const text = (value: string, length: number): void => {
    output.set(new TextEncoder().encode(value).slice(0, length), offset)
    offset += length
  }
  const i16 = (value: number): void => {
    view.setInt16(offset, value, true)
    offset += 2
  }
  const u16 = (value: number): void => {
    view.setUint16(offset, value, true)
    offset += 2
  }
  const i32 = (value: number): void => {
    view.setInt32(offset, value, true)
    offset += 4
  }
  const u32 = (value: number): void => {
    view.setUint32(offset, value, true)
    offset += 4
  }
  const f32 = (value: number): void => {
    view.setFloat32(offset, value, true)
    offset += 4
  }
  text('DIGITAL SURF', 12)
  i16(0)
  u16(options.objects ?? 1)
  i16(1)
  i16(options.objectType)
  text('Generated object', 30)
  text('PureJsImage', 30)
  i16(1)
  i16(0)
  i16(0)
  i16(options.special === true ? 1 : 0)
  i16(0)
  f32(0)
  u32(layers)
  i16(16)
  i32(10)
  i32(40)
  i32(options.width)
  i32(options.height)
  i32(options.width * options.height)
  f32(0.5)
  f32(0.75)
  f32(2)
  text('X', 16)
  text('Y', 16)
  text('Z', 16)
  text('mm', 16)
  text('mm', 16)
  text('nm', 16)
  text('', 16 * 3)
  f32(1)
  f32(1)
  f32(1)
  i16(0)
  i16(0)
  i16(0)
  text('', 12)
  for (let index = 0; index < 7; index += 1) i16(0)
  f32(0)
  u32(0)
  text('', 6)
  i16(0)
  i16(0)
  text('', 128)
  f32(1)
  f32(2)
  f32(1)
  f32(0)
  f32(0)
  text('', 13)
  text('', 13)
  if (offset !== 512) throw new Error(`Generated Digital Surf header used ${offset} bytes`)
  for (let index = 0; index < options.values.length; index += 1) {
    view.setInt16(512 + index * 2, options.values[index] ?? 0, true)
  }
  return output
}

const firstValues = async (
  dataset: ScientificDataset,
  count: number,
  fixedIndices = dataset.descriptor.axes.slice(2).map(({ id }) => ({ axisId: id, index: 0 })),
): Promise<readonly number[]> => {
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices,
    x: 0,
    y: 0,
    width: count,
    height: 1,
  })) {
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    const bytes = rasterSampleBytes(block.format.sampleType)
    return Object.freeze(
      Array.from({ length: count }, (_, index) =>
        readRasterSample(block.data, view, index * bytes, block.format.sampleType),
      ),
    )
  }
  throw new Error('Expected one raster block')
}

describe('independent surface fixture provenance', () => {
  it.each(surfaceCorpus.files)('pins $localFile with complete provenance', (entry) => {
    expect(createHash('sha256').update(fixture(entry.localFile)).digest('hex')).toBe(entry.sha256)
    expect(entry.source.url).toContain(entry.source.revision)
    expect(entry.source.url).toContain(entry.source.path)
    expect(entry.license.spdx).toMatch(/^[A-Za-z0-9.+-]+$/u)
    expect(entry.license.url).toContain(entry.source.revision)
    expect(entry.attribution.length).toBeGreaterThan(0)
    expect(entry.redistribution.status).toBe('included-test-only')
    expect(entry.redistribution.justification.length).toBeGreaterThan(0)
    expect(entry.oracle.test).toBe('tests/scientific-surface-formats.test.ts')
    expect(entry.oracle.assertions.length).toBeGreaterThan(0)
  })
})

describe('bounded scientific ZIP container', () => {
  it.each([0, 8] as const)(
    'indexes and CRC-verifies method %i with bounded range reads',
    async (method) => {
      const value = new TextEncoder().encode('bounded surface member')
      const source = new CountingSource(zip('surface/data.bin', value, method))
      const archive = await openZipArchive(source)
      expect(archive.entries).toEqual([
        expect.objectContaining({
          path: 'surface/data.bin',
          compression: method === 0 ? 'stored' : 'deflate',
        }),
      ])
      await expect(archive.read('surface/data.bin')).resolves.toEqual(value)
      expect(source.reads.length).toBeLessThanOrEqual(5)
      if (method === 0) {
        const member = await archive.openStored('surface/data.bin')
        await expect(member.read(8, 7)).resolves.toEqual(value.slice(8, 15))
      }
    },
  )

  it('rejects unsafe paths, encryption, CRC corruption, and local/central name disagreement', async () => {
    expect(() => normalizeZipPath('../surface.bin')).toThrow('normalized')
    expect(() => normalizeZipPath('/surface.bin')).toThrow('absolute')
    await expect(
      openZipArchive(new MemorySource(zip('surface.bin', new Uint8Array(1), 0, { flags: 1 }))),
    ).rejects.toThrow('Encrypted')
    const badCrc = await openZipArchive(
      new MemorySource(zip('surface.bin', new Uint8Array([1, 2]), 0, { crc: 0 })),
    )
    await expect(badCrc.read('surface.bin')).rejects.toThrow('CRC-32')
    const names = await openZipArchive(
      new MemorySource(zip('local.bin', new Uint8Array(1), 0, { centralName: 'central.bin' })),
    )
    await expect(names.read('central.bin')).rejects.toThrow('names disagree')
    const inconsistentStored = zip('surface.bin', new Uint8Array(1), 0)
    new DataView(inconsistentStored.buffer).setUint32(30 + 'surface.bin'.length + 1 + 24, 2, true)
    await expect(openZipArchive(new MemorySource(inconsistentStored))).rejects.toThrow(
      'inconsistent sizes',
    )
  })

  it('enforces entry, member, total, ratio, and central-directory limits before member decoding', async () => {
    const archive = zip('surface.bin', new Uint8Array(128), 8)
    await expect(openZipArchive(new MemorySource(archive), { maxEntries: 0 })).rejects.toThrow(
      'positive',
    )
    await expect(openZipArchive(new MemorySource(archive), { maxMemberBytes: 64 })).rejects.toThrow(
      'maxMemberBytes',
    )
    await expect(
      openZipArchive(new MemorySource(archive), { maxTotalDecodedBytes: 64 }),
    ).rejects.toThrow('total decoded')
    await expect(
      openZipArchive(new MemorySource(archive), { maxDecompressionRatio: 1 }),
    ).rejects.toThrow('maxDecompressionRatio')
    await expect(
      openZipArchive(new MemorySource(archive), { maxCentralDirectoryBytes: 16 }),
    ).rejects.toThrow('central directory')
  })

  it('indexes ZIP64 directory and member fields without whole-archive reads', async () => {
    const value = new TextEncoder().encode('zip64 surface')
    const source = new CountingSource(zip64Stored('surface.bin', value))
    const archive = await openZipArchive(source)
    await expect(archive.read('surface.bin')).resolves.toEqual(value)
    expect(source.reads.length).toBeLessThanOrEqual(7)
  })
})

describe('Nanonis SXM scientific reader', () => {
  it('matches two independent acquisition families and preserves file-row Y orientation', async () => {
    const reader = createNanonisSxmReader()
    const cases = [
      {
        name: 'nanonis-afm-generic4.sxm',
        datasets: 18,
        width: 128,
        step: 1.5748031496062993e-11,
        first: -2.1861611188001007e-8,
      },
      {
        name: 'nanonis-stm-generic5.sxm',
        datasets: 4,
        width: 256,
        step: 1.5686274509803923e-11,
        first: 1.7243860853111137e-11,
      },
    ] as const
    for (const expected of cases) {
      const bytes = fixture(expected.name)
      const document = await reader.open({
        primary: { id: expected.name, name: expected.name, source: new MemorySource(bytes) },
      })
      expect(document.datasets).toHaveLength(expected.datasets)
      const summary = document.datasets[0]
      if (summary === undefined) throw new Error('Expected an SXM dataset')
      expect(summary.descriptor.axes[0]).toMatchObject({
        length: expected.width,
        unit: 'm',
        coordinates: { step: expected.step },
      })
      expect(summary.descriptor.axes[1]).toMatchObject({
        length: expected.width,
        unit: 'm',
        coordinates: { step: -expected.step },
      })
      expect(JSON.stringify(summary.descriptor.axes[1]?.calibration)).toContain('no vertical flip')
      expect(await firstValues(await document.openDataset(summary.id), 1)).toEqual([expected.first])
    }
  })

  it('keeps selected-channel reads sparse and rejects truncated or oversized headers', async () => {
    const bytes = fixture('nanonis-afm-generic4.sxm')
    const source = new CountingSource(bytes)
    const reader = createNanonisSxmReader({ limits: { rowsPerBlock: 1 } })
    const document = await reader.open({ primary: { id: 'sxm', name: 'surface.sxm', source } })
    const summary = document.datasets[4]
    if (summary === undefined) throw new Error('Expected an SXM channel')
    const before = source.reads.length
    await firstValues(await document.openDataset(summary.id), 2)
    expect(source.reads.slice(before)).toHaveLength(1)
    await expect(
      reader.open({ primary: { id: 'short', source: new MemorySource(bytes.slice(0, 1_000)) } }),
    ).rejects.toThrow()
    await expect(
      createNanonisSxmReader({ limits: { maxHeaderBytes: 128 } }).open({
        primary: { id: 'large', source: new MemorySource(bytes) },
      }),
    ).rejects.toThrow('header exceeds')
  })
})

describe('Igor Binary Wave v5 scientific reader', () => {
  it('validates an independent 3D Asylum wave with labels, units, calibration, notes, and region reads', async () => {
    const source = new CountingSource(fixture('asylum-afm-v5.ibw'))
    const document = await createIgorBinaryWaveReader().open({
      primary: { id: 'ibw', name: 'surface.ibw', source },
    })
    const summary = document.datasets[0]
    if (summary === undefined) throw new Error('Expected an IBW dataset')
    expect(summary.descriptor.axes.slice(0, 2)).toMatchObject([
      { id: 'x', length: 512, unit: 'm', coordinates: { step: 1.5655577299412918e-9 } },
      { id: 'y', length: 512, unit: 'm', coordinates: { step: 1.5655577299412918e-9 } },
    ])
    expect(summary.descriptor.axes[2]).toMatchObject({ id: 'dim2', length: 8 })
    expect(summary.descriptor.axes[2]?.entries?.map(({ name }) => name)).toEqual([
      'HeightTrace',
      'HeightRetrace',
      'ZSensorTrace',
      'ZSensorRetrace',
      'UserIn0Trace',
      'UserIn0Retrace',
      'UserIn1Trace',
      'UserIn1Retrace',
    ])
    expect(document.metadata).toMatchObject({
      dimensions: [512, 512, 8],
      name: 'dna1_pll0015',
      byteOrder: 'little-endian',
    })
    const before = source.reads.length
    expect(await firstValues(await document.openDataset(summary.id), 2)).toEqual([
      -8.26381835850043e-7, -8.263509698736016e-7,
    ])
    expect(source.reads.slice(before)).toHaveLength(1)
  })

  it('rejects rank-1 v5 waves, invalid checksums, and complex samples', async () => {
    const reader = createIgorBinaryWaveReader()
    await expect(
      reader.open({
        primary: { id: 'rank1', source: new MemorySource(fixture('igor-win-v5-rank1.ibw')) },
      }),
    ).rejects.toThrow('2D through 4D')
    const invalid = fixture('asylum-afm-v5.ibw')
    invalid[2] = (invalid[2] ?? 0) ^ 1
    await expect(
      reader.open({ primary: { id: 'checksum', source: new MemorySource(invalid) } }),
    ).rejects.toThrow('checksum')
    const complex = fixture('asylum-afm-v5.ibw')
    new DataView(complex.buffer).setUint16(64 + 16, 3, true)
    repairIbwChecksum(complex)
    await expect(
      reader.open({ primary: { id: 'complex', source: new MemorySource(complex) } }),
    ).rejects.toThrow('Complex')
  })

  it('reads a checksum-valid big-endian numeric 4D wave at fixed higher-axis indices', async () => {
    const document = await createIgorBinaryWaveReader().open({
      primary: { id: 'big', source: new MemorySource(generatedBigEndianIbw()) },
    })
    const summary = document.datasets[0]
    if (summary === undefined) throw new Error('Expected a generated IBW dataset')
    expect(summary.descriptor.axes.map(({ length, coordinates }) => [length, coordinates])).toEqual(
      [
        [2, { type: 'linear', origin: 10, step: 0.25 }],
        [2, { type: 'linear', origin: 11, step: 1.25 }],
        [2, { type: 'linear', origin: 12, step: 2.25 }],
        [2, { type: 'linear', origin: 13, step: 3.25 }],
      ],
    )
    expect(
      await firstValues(await document.openDataset(summary.id), 2, [
        { axisId: 'dim2', index: 1 },
        { axisId: 'dim3', index: 1 },
      ]),
    ).toEqual([12, 13])
  })
})

describe('Digital Surf and X3P surface readers', () => {
  it('matches an independent compressed Digital Surf surface and exact integer scaling', async () => {
    const document = await createDigitalSurfReader().open({
      primary: {
        id: 'sur',
        name: 'surface.sur',
        source: new MemorySource(fixture('digital-surf-compressed.sur')),
      },
    })
    const summary = document.datasets[0]
    if (summary === undefined) throw new Error('Expected a Digital Surf object')
    expect(summary.descriptor.axes).toMatchObject([
      {
        length: 128,
        name: 'Width',
        unit: 'mm',
        coordinates: { origin: 0, step: 0.00008252197585534304 },
      },
      {
        length: 128,
        name: 'Height',
        unit: 'mm',
        coordinates: { origin: 0, step: 0.00008252197585534304 },
      },
    ])
    expect(summary.descriptor.components[0]).toMatchObject({ name: 'CL Intensity', unit: 'a.u.' })
    expect(await firstValues(await document.openDataset(summary.id), 2)).toEqual([
      418.8810366748985, 451.24627585728376,
    ])
  })

  it('enumerates Digital Surf objects and addresses multilayer, profile, and special-point samples', async () => {
    const first = digitalSurfFixture({
      objectType: 5,
      width: 2,
      height: 1,
      layers: 2,
      values: [10, 20, 30, 40],
      objects: 2,
    })
    const second = digitalSurfFixture({
      objectType: 2,
      width: 2,
      height: 1,
      values: [8, 12],
      objects: 2,
      special: true,
    })
    const combined = new Uint8Array(first.byteLength + second.byteLength)
    combined.set(first)
    combined.set(second, first.byteLength)
    const document = await createDigitalSurfReader().open({
      primary: { id: 'multi', source: new MemorySource(combined) },
    })
    expect(document.datasets).toHaveLength(2)
    const multilayer = await document.openDataset('object-0')
    expect(multilayer.descriptor.axes.map(({ id, length }) => [id, length])).toEqual([
      ['x', 2],
      ['y', 1],
      ['layer', 2],
    ])
    expect(await firstValues(multilayer, 2, [{ axisId: 'layer', index: 1 }])).toEqual([21, 61])
    expect(await firstValues(await document.openDataset('object-1'), 2)).toEqual([Number.NaN, 5])

    const profileDocument = await createDigitalSurfReader().open({
      primary: {
        id: 'profile',
        source: new MemorySource(
          digitalSurfFixture({ objectType: 1, width: 3, height: 1, values: [10, 11, 12] }),
        ),
      },
    })
    const profile = await profileDocument.openDataset('object-0')
    if (profile.readSeries === undefined)
      throw new Error('Expected Digital Surf profile series reads')
    const values: number[] = []
    for await (const block of profile.readSeries({
      axisId: 'x',
      fixedIndices: [],
      start: 0,
      length: 3,
    })) {
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let index = 0; index < block.length; index += 1)
        values.push(view.getFloat64(index * 8, false))
    }
    expect(values).toEqual([1, 3, 5])
  })

  it.each([
    ['iso5436-sample1.x3p', [0.486219120804151, 0.00346341436648013]],
    ['iso5436-sample4.x3p', [0.486, 0.0030000000000000027]],
  ] as const)(
    'opens official ISO 5436 X3P fixture %s through bounded ZIP',
    async (name, values) => {
      const source = new CountingSource(fixture(name))
      const document = await createX3pReader().open({ primary: { id: name, name, source } })
      const summary = document.datasets[0]
      if (summary === undefined) throw new Error('Expected an X3P surface')
      expect(summary.descriptor.axes).toMatchObject([
        { length: 4, unit: 'm', coordinates: { origin: 0, step: 0.016016 } },
        { length: 4, unit: 'm', coordinates: { origin: 0, step: 0.016016 } },
      ])
      expect(await firstValues(await document.openDataset(summary.id), 2)).toEqual(values)
      expect(source.reads.length).toBeLessThan(15)
    },
  )

  it('rejects corrupt X3P CRCs and non-X3P ZIPs', async () => {
    const reader = createX3pReader()
    const corrupt = fixture('iso5436-sample4.x3p')
    corrupt[203] = (corrupt[203] ?? 0) ^ 1
    await expect(
      reader.open({ primary: { id: 'bad', name: 'bad.x3p', source: new MemorySource(corrupt) } }),
    ).rejects.toThrow()
    await expect(
      reader.open({
        primary: {
          id: 'zip',
          name: 'empty.x3p',
          source: new MemorySource(zip('other.txt', new Uint8Array(1), 0)),
        },
      }),
    ).rejects.toThrow('main.xml')
  })
})

describe('surface reader cancellation', () => {
  it.each([
    ['surface.sxm', createNanonisSxmReader(), 'nanonis-afm-generic4.sxm'],
    ['surface.ibw', createIgorBinaryWaveReader(), 'asylum-afm-v5.ibw'],
    ['surface.sur', createDigitalSurfReader(), 'digital-surf-compressed.sur'],
    ['surface.x3p', createX3pReader(), 'iso5436-sample4.x3p'],
  ] as const)(
    'rejects an already-aborted %s open before indexing',
    async (name, reader, fixtureName) => {
      const controller = new AbortController()
      controller.abort(new DOMException('cancelled', 'AbortError'))
      await expect(
        reader.open({
          primary: { id: name, name, source: new MemorySource(fixture(fixtureName)) },
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' })
    },
  )
})
