import { describe, expect, it } from 'vitest'
import calibrationOracle from './fixtures/tiff-calibration-oracle.json' with { type: 'json' }
import type { PixelBlock } from '../src/pixel.ts'
import type { RasterBlock } from '../src/raster.ts'
import { encodeTiffDocument } from '../src/codecs/tiff.ts'
import { openTiffDocument } from '../src/codecs/tiff.ts'
import { nodeRuntime } from '../src/node-runtime.ts'
import { ScientificReaderRegistry } from '../src/scientific/reader.ts'
import { omeTiffReader } from '../src/scientific/readers/ome-tiff.ts'
import {
  createTiffReader,
  tiffReader,
  tiffReaderDescriptor,
} from '../src/scientific/readers/tiff.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import {
  MemorySource,
  sourceSessionEnd,
  sourceSessionStart,
  type ImageSource,
} from '../src/source.ts'
import {
  defaultTiffCalibrationProfiles,
  digitalMicrographTiffCalibrationProfile,
  feiSemTiffCalibrationProfile,
  imageJTiffCalibrationProfile,
  standardTiffCalibrationProfile,
  zeissSemTiffCalibrationProfile,
} from '../src/tiff/calibration-profiles.ts'
import { createTiffProfileRegistry } from '../src/tiff/profiles.ts'

interface TiffEntryFixture {
  readonly tag: number
  readonly type: 2 | 3 | 4 | 5 | 11 | 12
  readonly values: readonly number[]
}

interface TiffFixtureOptions {
  readonly width: number
  readonly height: number
  readonly bitsPerSample: readonly number[]
  readonly sampleFormats: readonly number[]
  readonly photometric: number
  readonly segments: readonly Uint8Array[]
  readonly planar?: boolean
  readonly tiled?: boolean
  readonly extraEntries?: readonly TiffEntryFixture[]
}

const fixtureEntryValueBytes = (type: number): number =>
  type === 3 ? 2 : type === 4 || type === 11 ? 4 : type === 5 || type === 12 ? 8 : 1

const fixtureEntryCount = (entry: TiffEntryFixture): number =>
  entry.type === 5 ? entry.values.length / 2 : entry.values.length

const fixtureEntryBytes = (entry: TiffEntryFixture): number =>
  fixtureEntryCount(entry) * fixtureEntryValueBytes(entry.type)

const tiffFixture = (options: TiffFixtureOptions): Uint8Array => {
  const entriesFor = (offsets: readonly number[]): TiffEntryFixture[] => [
    { tag: 256, type: 4, values: [options.width] },
    { tag: 257, type: 4, values: [options.height] },
    { tag: 258, type: 3, values: options.bitsPerSample },
    { tag: 259, type: 3, values: [1] },
    { tag: 262, type: 3, values: [options.photometric] },
    ...(options.tiled ? [] : [{ tag: 273, type: 4 as const, values: offsets }]),
    { tag: 277, type: 3, values: [options.bitsPerSample.length] },
    ...(options.tiled ? [] : [{ tag: 278, type: 4 as const, values: [options.height] }]),
    ...(options.tiled
      ? []
      : [
          {
            tag: 279,
            type: 4 as const,
            values: options.segments.map(({ byteLength }) => byteLength),
          },
        ]),
    { tag: 284, type: 3, values: [options.planar ? 2 : 1] },
    ...(options.tiled
      ? [
          { tag: 322, type: 4 as const, values: [options.width] },
          { tag: 323, type: 4 as const, values: [options.height] },
          { tag: 324, type: 4 as const, values: offsets },
          {
            tag: 325,
            type: 4 as const,
            values: options.segments.map(({ byteLength }) => byteLength),
          },
        ]
      : []),
    { tag: 339, type: 3, values: options.sampleFormats },
    ...(options.extraEntries ?? []),
  ]
  const placeholder = entriesFor(options.segments.map(() => 0)).sort(
    (left, right) => left.tag - right.tag,
  )
  const ifdBytes = 2 + placeholder.length * 12 + 4
  const externalBytes = placeholder.reduce((total, entry) => {
    const bytes = fixtureEntryBytes(entry)
    return total + (bytes > 4 ? bytes : 0)
  }, 0)
  const pixelOffset = 8 + ifdBytes + externalBytes
  const offsets: number[] = []
  let cursor = pixelOffset
  for (const segment of options.segments) {
    offsets.push(cursor)
    cursor += segment.byteLength
  }
  const entries = entriesFor(offsets).sort((left, right) => left.tag - right.tag)
  const output = new Uint8Array(cursor)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, 8, true)
  view.setUint16(8, entries.length, true)
  let externalOffset = 8 + ifdBytes
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry === undefined) continue
    const entryOffset = 10 + index * 12
    const valueBytes = fixtureEntryBytes(entry)
    const valuesOffset = valueBytes > 4 ? externalOffset : entryOffset + 8
    view.setUint16(entryOffset, entry.tag, true)
    view.setUint16(entryOffset + 2, entry.type, true)
    view.setUint32(entryOffset + 4, fixtureEntryCount(entry), true)
    if (valueBytes > 4) {
      view.setUint32(entryOffset + 8, externalOffset, true)
      externalOffset += valueBytes
    }
    if (entry.type === 5) {
      for (let valueIndex = 0; valueIndex < entry.values.length; valueIndex += 2) {
        const offset = valuesOffset + (valueIndex / 2) * 8
        view.setUint32(offset, entry.values[valueIndex] ?? 0, true)
        view.setUint32(offset + 4, entry.values[valueIndex + 1] ?? 1, true)
      }
    } else {
      for (let valueIndex = 0; valueIndex < entry.values.length; valueIndex += 1) {
        const value = entry.values[valueIndex] ?? 0
        const offset = valuesOffset + valueIndex * fixtureEntryValueBytes(entry.type)
        if (entry.type === 3) view.setUint16(offset, value, true)
        else if (entry.type === 4) view.setUint32(offset, value, true)
        else if (entry.type === 11) view.setFloat32(offset, value, true)
        else if (entry.type === 12) view.setFloat64(offset, value, true)
        else output[offset] = value
      }
    }
  }
  for (let index = 0; index < options.segments.length; index += 1) {
    output.set(options.segments[index] ?? new Uint8Array(), offsets[index] ?? 0)
  }
  return output
}

const linkTiffPages = (pages: readonly Uint8Array[]): Uint8Array => {
  if (pages.length < 1) throw new Error('Expected at least one TIFF page')
  const totalBytes = pages.reduce(
    (total, page, index) => total + page.byteLength - (index === 0 ? 0 : 8),
    0,
  )
  const output = new Uint8Array(totalBytes)
  let pageOffset = 0
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]
    if (page === undefined) continue
    const sourceOffset = pageIndex === 0 ? 0 : 8
    output.set(page.subarray(sourceOffset), pageOffset)
    const ifdOffset = pageIndex === 0 ? 8 : pageOffset
    const delta = ifdOffset - 8
    const view = new DataView(output.buffer)
    const entryCount = view.getUint16(ifdOffset, true)
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
      const entryOffset = ifdOffset + 2 + entryIndex * 12
      const tag = view.getUint16(entryOffset, true)
      const type = view.getUint16(entryOffset + 2, true)
      const count = view.getUint32(entryOffset + 4, true)
      const valueBytes = count * fixtureEntryValueBytes(type)
      const oldPayloadOffset =
        valueBytes > 4 ? view.getUint32(entryOffset + 8, true) : entryOffset + 8 - delta
      if (valueBytes > 4) view.setUint32(entryOffset + 8, oldPayloadOffset + delta, true)
      if (tag === 273 || tag === 324) {
        const payloadOffset = oldPayloadOffset + delta
        for (let valueIndex = 0; valueIndex < count; valueIndex += 1) {
          const offset = payloadOffset + valueIndex * 4
          view.setUint32(offset, view.getUint32(offset, true) + delta, true)
        }
      }
    }
    const nextOffset = ifdOffset + 2 + entryCount * 12
    const nextPage = pages[pageIndex + 1]
    const nextPageOffset =
      nextPage === undefined ? 0 : pageOffset + page.byteLength - (pageIndex === 0 ? 0 : 8)
    view.setUint32(nextOffset, nextPageOffset, true)
    pageOffset += page.byteLength - sourceOffset
  }
  return output
}

const encoded16 = (values: readonly number[], signed: boolean): Uint8Array => {
  const output = new Uint8Array(values.length * 2)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    if (signed) view.setInt16(index * 2, values[index] ?? 0, true)
    else view.setUint16(index * 2, values[index] ?? 0, true)
  }
  return output
}

const encodedFloat32 = (values: readonly number[]): Uint8Array => {
  const output = new Uint8Array(values.length * 4)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(index * 4, values[index] ?? 0, true)
  }
  return output
}

const asciiEntry = (tag: number, value: string): TiffEntryFixture => ({
  tag,
  type: 2,
  values: [...new TextEncoder().encode(value), 0],
})

const open = async (bytes: Uint8Array, reader = tiffReader) =>
  new ScientificReaderRegistry([reader]).open({
    primary: { id: 'primary', name: 'fixture.tiff', source: new MemorySource(bytes) },
  })

const collect = async (
  dataset: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['openDataset']>>,
  fixedIndices: readonly { readonly axisId: string; readonly index: number }[] = [],
  resolutionLevel = 0,
): Promise<readonly RasterBlock[]> => {
  const blocks: RasterBlock[] = []
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices,
    resolutionLevel,
  })) {
    blocks.push(block)
  }
  return blocks
}

const blockView = (block: RasterBlock | undefined): DataView => {
  if (block === undefined) throw new Error('Expected a TIFF raster block')
  return new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
}

const pixelBlocks = (
  width: number,
  height: number,
  format: 'rgb8' | 'rgba8',
  data: Uint8Array,
): AsyncIterable<PixelBlock> => ({
  async *[Symbol.asyncIterator]() {
    yield {
      x: 0,
      y: 0,
      width,
      height,
      stride: width * (format === 'rgb8' ? 3 : 4),
      format,
      data,
    }
  },
})

class SessionTrackingSource implements ImageSource {
  readonly size: number
  starts = 0
  ends = 0
  readonly #source: MemorySource

  constructor(bytes: Uint8Array) {
    this.#source = new MemorySource(bytes)
    this.size = bytes.byteLength
  }

  read(...parameters: Parameters<ImageSource['read']>): ReturnType<ImageSource['read']> {
    return this.#source.read(...parameters)
  }

  [sourceSessionStart](): void {
    this.starts += 1
  }

  async [sourceSessionEnd](): Promise<void> {
    this.ends += 1
  }
}

describe('ordinary TIFF scientific reader', () => {
  it('applies standard TIFF physical resolution and position with embedded evidence', async () => {
    const input = tiffFixture({
      width: 2,
      height: 2,
      bitsPerSample: [8],
      sampleFormats: [1],
      photometric: 1,
      segments: [Uint8Array.of(1, 2, 3, 4)],
      extraEntries: [
        { tag: 282, type: 5, values: [20_000, 1] },
        { tag: 283, type: 5, values: [10_000, 1] },
        { tag: 286, type: 5, values: [1, 1_000] },
        { tag: 287, type: 5, values: [1, 500] },
        { tag: 296, type: 3, values: [3] },
      ],
    })
    const tiff = await openTiffDocument(new MemorySource(input))
    const result = await createTiffProfileRegistry(defaultTiffCalibrationProfiles).open(tiff)
    expect(result?.profileId).toBe(standardTiffCalibrationProfile.id)
    expect(result?.value).toMatchObject({
      directories: [
        {
          axes: [
            { axisId: 'x', ...calibrationOracle.standardTiff.x },
            { axisId: 'y', ...calibrationOracle.standardTiff.y },
          ],
        },
      ],
    })

    const dataset = await (await open(input)).openDataset('series-0')
    expect(dataset.descriptor.axes).toMatchObject([
      {
        id: 'x',
        unit: 'µm',
        coordinates: { type: 'linear', origin: 10, step: 0.5 },
        calibration: {
          kind: 'embedded',
          resourceId: 'primary',
          locator: 'tiff:ifd:0/tags:282,296,286',
        },
      },
      {
        id: 'y',
        unit: 'µm',
        coordinates: { type: 'linear', origin: 20, step: 1 },
      },
    ])
  })

  it('prefers ImageJ description units and spacing over standard TIFF units', async () => {
    const description = [
      'ImageJ=1.54',
      'images=2',
      'slices=2',
      'unit=micron',
      'spacing=1.5',
      'xorigin=2',
      'yorigin=-1',
      'zorigin=3',
      '',
    ].join('\n')
    const firstPage = tiffFixture({
      width: 2,
      height: 2,
      bitsPerSample: [8],
      sampleFormats: [1],
      photometric: 1,
      segments: [Uint8Array.of(1, 2, 3, 4)],
      extraEntries: [
        asciiEntry(270, description),
        { tag: 282, type: 5, values: [4, 1] },
        { tag: 283, type: 5, values: [2, 1] },
        { tag: 296, type: 3, values: [1] },
      ],
    })
    const secondPage = tiffFixture({
      width: 2,
      height: 2,
      bitsPerSample: [8],
      sampleFormats: [1],
      photometric: 1,
      segments: [Uint8Array.of(5, 6, 7, 8)],
      extraEntries: [
        { tag: 282, type: 5, values: [4, 1] },
        { tag: 283, type: 5, values: [2, 1] },
        { tag: 296, type: 3, values: [1] },
      ],
    })
    const input = linkTiffPages([firstPage, secondPage])
    const tiff = await openTiffDocument(new MemorySource(input))
    const result = await createTiffProfileRegistry(defaultTiffCalibrationProfiles).open(tiff)
    expect(result?.profileId).toBe(imageJTiffCalibrationProfile.id)
    expect(result?.value).toMatchObject({
      directories: [
        {
          axes: [
            { axisId: 'x', ...calibrationOracle.imageJ.x },
            { axisId: 'y', ...calibrationOracle.imageJ.y },
          ],
        },
        {
          axes: [
            { axisId: 'x', ...calibrationOracle.imageJ.x },
            { axisId: 'y', ...calibrationOracle.imageJ.y },
          ],
        },
      ],
      pageAxis: { axisId: 'z', ...calibrationOracle.imageJ.z, length: 2 },
    })
    const dataset = await (await open(input)).openDataset('series-0')
    expect(dataset.descriptor.axes).toMatchObject([
      { id: 'x', coordinates: { origin: -0.5, step: 0.25 }, unit: 'µm' },
      { id: 'y', coordinates: { origin: 0.5, step: 0.5 }, unit: 'µm' },
      { id: 'z', coordinates: { origin: -4.5, step: 1.5 }, unit: 'µm', length: 2 },
    ])
    expect(
      Array.from((await collect(dataset, [{ axisId: 'z', index: 1 }]))[0]?.data ?? []),
    ).toEqual([5, 6, 7, 8])
    expect(dataset.descriptor.metadata?.['purejsimage:tiff']).toMatchObject({
      calibrationProfile: imageJTiffCalibrationProfile.id,
      'purejsimage:imagej': { unit: 'micron', spacing: '1.5' },
    })
  })

  it('reads coherent DigitalMicrograph axis and intensity tuples without EPICS collisions', async () => {
    const input = tiffFixture({
      width: 2,
      height: 2,
      bitsPerSample: [8],
      sampleFormats: [1],
      photometric: 1,
      segments: [Uint8Array.of(1, 2, 3, 4)],
      extraEntries: [
        asciiEntry(65_003, 'nm'),
        asciiEntry(65_004, 'nm'),
        asciiEntry(65_005, 'nm'),
        { tag: 65_006, type: 12, values: [1.25] },
        { tag: 65_007, type: 12, values: [2.5] },
        { tag: 65_008, type: 12, values: [-3] },
        { tag: 65_009, type: 12, values: [0.1] },
        { tag: 65_010, type: 12, values: [0.2] },
        { tag: 65_011, type: 12, values: [0.5] },
        asciiEntry(65_022, 'electron'),
        { tag: 65_024, type: 12, values: [4] },
        { tag: 65_025, type: 12, values: [0.25] },
        { tag: 282, type: 5, values: [1, 1] },
        { tag: 283, type: 5, values: [1, 1] },
        { tag: 296, type: 3, values: [3] },
        asciiEntry(271, 'Gatan'),
        asciiEntry(272, 'K3'),
        asciiEntry(305, 'DigitalMicrograph 3.6'),
        asciiEntry(306, '2026:08:14 08:00:00'),
      ],
    })
    const tiff = await openTiffDocument(new MemorySource(input))
    const result = await createTiffProfileRegistry(defaultTiffCalibrationProfiles).open(tiff)
    expect(result?.profileId).toBe(digitalMicrographTiffCalibrationProfile.id)
    expect(result?.value).toMatchObject({
      directories: [
        {
          axes: [
            { axisId: 'x', ...calibrationOracle.digitalMicrograph.x },
            { axisId: 'y', ...calibrationOracle.digitalMicrograph.y },
            { axisId: 'z', ...calibrationOracle.digitalMicrograph.z },
          ],
          intensity: calibrationOracle.digitalMicrograph.intensity,
        },
      ],
      acquisition: {
        manufacturer: 'Gatan',
        model: 'K3',
        software: 'DigitalMicrograph 3.6',
        acquisitionDate: '2026:08:14 08:00:00',
      },
      warnings: [
        'DigitalMicrograph X calibration contradicts standard TIFF resolution tags',
        'DigitalMicrograph Y calibration contradicts standard TIFF resolution tags',
      ],
    })
    const dataset = await (await open(input)).openDataset('series-0')
    expect(dataset.descriptor.axes).toMatchObject([
      { id: 'x', coordinates: { origin: 1.25, step: 0.1 }, unit: 'nm' },
      { id: 'y', coordinates: { origin: 2.5, step: 0.2 }, unit: 'nm' },
      { id: 'z', coordinates: { origin: -3, step: 0.5 }, unit: 'nm', length: 1 },
    ])
    expect(dataset.descriptor.components).toMatchObject([
      { id: 'intensity', kind: 'intensity', unit: 'electron' },
    ])
    expect(dataset.descriptor.metadata?.['purejsimage:tiff']).toMatchObject({
      intensityCalibration: { origin: 4, step: 0.25, unit: 'electron' },
      'purejsimage:digital-micrograph': { '65003': 'nm', '65025': [0.25] },
    })

    const epics = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8],
      sampleFormats: [1],
      photometric: 1,
      segments: [Uint8Array.of(9)],
      extraEntries: [
        asciiEntry(65_003, '123456'),
        asciiEntry(65_009, 'ColorMode:0'),
        asciiEntry(65_010, 'RingCurrent:100.0'),
      ],
    })
    const epicsDocument = await openTiffDocument(new MemorySource(epics))
    expect(await digitalMicrographTiffCalibrationProfile.detect({ document: epicsDocument })).toBe(
      false,
    )
    expect((await open(epics)).metadata).toMatchObject({ calibrationStatus: 'uncalibrated' })

    const malformed = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8],
      sampleFormats: [1],
      photometric: 1,
      segments: [Uint8Array.of(11)],
      extraEntries: [
        asciiEntry(65_003, 'nm'),
        { tag: 65_006, type: 12, values: [0] },
        { tag: 65_009, type: 12, values: [Number.NaN] },
      ],
    })
    const malformedDocument = await open(malformed)
    expect(malformedDocument.metadata).toMatchObject({
      calibrationStatus: 'uncalibrated',
      calibrationProfile: digitalMicrographTiffCalibrationProfile.id,
    })
    const malformedDataset = await malformedDocument.openDataset('series-0')
    expect(malformedDataset.descriptor.axes).toMatchObject([
      { id: 'x', coordinates: { type: 'index' } },
      { id: 'y', coordinates: { type: 'index' } },
    ])
    expect(Array.from((await collect(malformedDataset))[0]?.data ?? [])).toEqual([11])
  })

  it('matches independent FEI SFEG and Helios calibration families without an inferred FOV fallback', async () => {
    const families = [
      {
        tag: 34_680,
        expected: calibrationOracle.fei.sfeg,
        metadata: [
          '[Scan]',
          'PixelWidth=8.26823e-10',
          'PixelHeight=8.26823e-10',
          'Dwelltime=2e-7',
          '[Beam]',
          'HV=5000',
          '[Stage]',
          'WorkingDistance=0.0041',
          '[System]',
          'SystemType=Sirion SFEG',
          '[User]',
          'Date=08/14/2026',
          'Time=09:30:00',
        ].join('\n'),
      },
      {
        tag: 34_682,
        expected: calibrationOracle.fei.helios,
        metadata: [
          '[Scan]',
          'PixelWidth=3.10059e-10',
          'PixelHeight=3.10059e-10',
          'Dwelltime=3e-5',
          '[Beam]',
          'HV=15000',
          '[Stage]',
          'WorkingDistance=0.004',
          '[System]',
          'SystemType=Helios NanoLab',
          'Software=xT microscope server',
          '[User]',
          'Date=08/14/2026',
          'Time=10:00:00',
        ].join('\n'),
      },
    ]
    for (const family of families) {
      const input = tiffFixture({
        width: 2,
        height: 1,
        bitsPerSample: [8],
        sampleFormats: [1],
        photometric: 1,
        segments: [Uint8Array.of(1, 2)],
        extraEntries: [asciiEntry(family.tag, family.metadata)],
      })
      const tiff = await openTiffDocument(new MemorySource(input))
      const registry = createTiffProfileRegistry(defaultTiffCalibrationProfiles)
      const result = await registry.open(tiff)
      const value = await registry.openWith(tiff, feiSemTiffCalibrationProfile)
      expect(result?.profileId).toBe(feiSemTiffCalibrationProfile.id)
      expect(value).toMatchObject({
        directories: [
          {
            axes: [
              { axisId: 'x', origin: 0, unit: family.expected.unit },
              { axisId: 'y', origin: 0, unit: family.expected.unit },
            ],
          },
        ],
        acquisition: {
          manufacturer: 'FEI',
          acceleratingVoltageKv: family.tag === 34_680 ? 5 : 15,
          dwellTimeSeconds: family.tag === 34_680 ? 2e-7 : 3e-5,
        },
      })
      expect(value.acquisition?.workingDistanceMm).toBeCloseTo(family.tag === 34_680 ? 4.1 : 4)
      expect(value.directories[0]?.axes[0]?.step).toBeCloseTo(family.expected.step)
      expect(value.directories[0]?.axes[1]?.step).toBeCloseTo(family.expected.step)
      const dataset = await (await open(input)).openDataset('series-0')
      expect(dataset.descriptor.axes).toMatchObject([
        { id: 'x', coordinates: { origin: 0 }, unit: 'nm' },
        { id: 'y', coordinates: { origin: 0 }, unit: 'nm' },
      ])
      const x = dataset.descriptor.axes[0]
      const y = dataset.descriptor.axes[1]
      expect(x?.coordinates.type === 'linear' ? x.coordinates.step : undefined).toBeCloseTo(
        family.expected.step,
      )
      expect(y?.coordinates.type === 'linear' ? y.coordinates.step : undefined).toBeCloseTo(
        family.expected.step,
      )
    }

    const fovOnly = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8],
      sampleFormats: [1],
      photometric: 1,
      segments: [Uint8Array.of(3)],
      extraEntries: [asciiEntry(34_682, '[Scan]\nHorFieldsize=1e-6\nVerFieldsize=1e-6')],
    })
    const uncalibrated = await open(fovOnly)
    expect(uncalibrated.metadata).toMatchObject({
      calibrationStatus: 'uncalibrated',
      calibrationProfile: feiSemTiffCalibrationProfile.id,
    })
    expect(
      Array.from((await collect(await uncalibrated.openDataset('series-0')))[0]?.data ?? []),
    ).toEqual([3])
  })

  it('matches independent Zeiss LEO 1550 and Merlin private-tag families', async () => {
    const families = [
      {
        expected: calibrationOracle.zeiss.leo1550,
        metadata: [
          '0',
          '0',
          '0',
          '3.593750e-8',
          'DP_DETECTOR_CHANNEL',
          'Signal A = InLens',
          'DP_SEM',
          'Sem = 1550',
          'DP_DWELL_TIME',
          'Dwell Time = 100 ns',
          'AP_WD',
          'WD = 4.1 mm',
          'AP_PIXEL_SIZE',
          'Pixel Size = 35.94 nm',
          'AP_MANUALKV',
          'EHT Target = 5.00 kV',
        ].join('\n'),
        acquisition: {
          model: '1550',
          detector: 'InLens',
          dwellTimeSeconds: 1e-7,
          workingDistanceMm: 4.1,
          acceleratingVoltageKv: 5,
        },
      },
      {
        expected: calibrationOracle.zeiss.merlin,
        metadata: [
          '0',
          '0',
          '0',
          '7.300143e-9',
          'DP_DETECTOR_TYPE',
          'Detector = InLens',
          'DP_SEM',
          'Sem = Merlin',
          'DP_DWELL_TIME',
          'Dwell Time = 50 ns',
          'AP_WD',
          'WD = 2.7 mm',
          'AP_IMAGE_PIXEL_SIZE',
          'Image Pixel Size = 7.300 nm',
          'AP_ACTUALKV',
          'EHT = 3.00 kV',
          'SV_VERSION',
          'Version = V05.06.00.00 : 10-Dec-12',
        ].join('\n'),
        acquisition: {
          model: 'Merlin',
          detector: 'InLens',
          dwellTimeSeconds: 5e-8,
          workingDistanceMm: 2.7,
          acceleratingVoltageKv: 3,
          software: 'V05.06.00.00 : 10-Dec-12',
        },
      },
    ]
    for (const family of families) {
      const input = tiffFixture({
        width: 1_024,
        height: 1,
        bitsPerSample: [8],
        sampleFormats: [1],
        photometric: 1,
        segments: [new Uint8Array(1_024)],
        extraEntries: [asciiEntry(34_118, family.metadata)],
      })
      const tiff = await openTiffDocument(new MemorySource(input))
      const registry = createTiffProfileRegistry(defaultTiffCalibrationProfiles)
      const result = await registry.open(tiff)
      const value = await registry.openWith(tiff, zeissSemTiffCalibrationProfile)
      expect(result?.profileId).toBe(zeissSemTiffCalibrationProfile.id)
      expect(value).toMatchObject({
        directories: [
          {
            axes: [
              { axisId: 'x', origin: 0, ...family.expected },
              { axisId: 'y', origin: 0, ...family.expected },
            ],
          },
        ],
        acquisition: { manufacturer: 'Zeiss', ...family.acquisition },
      })
      expect(value.rawMetadata.value).toMatchObject({
        unnamed: [0, 0, 0, family.expected.step / 1_000_000_000],
        dp_sem: family.acquisition.model,
      })
    }

    const namedOnly = tiffFixture({
      width: 4,
      height: 1,
      bitsPerSample: [8],
      sampleFormats: [1],
      photometric: 1,
      segments: [Uint8Array.of(1, 2, 3, 4)],
      extraEntries: [
        asciiEntry(
          34_118,
          [
            'AP_IMAGE_PIXEL_SIZE',
            'Image Pixel Size = 12.5 nm',
            'AP_DATE',
            'Date = 14 Aug 2026',
            'AP_TIME',
            'Time = 11:00:00',
          ].join('\n'),
        ),
      ],
    })
    const namedResult = await createTiffProfileRegistry(defaultTiffCalibrationProfiles).open(
      await openTiffDocument(new MemorySource(namedOnly)),
    )
    expect(namedResult?.value).toMatchObject({
      directories: [
        {
          axes: [
            { axisId: 'x', origin: 0, step: 12.5, unit: 'nm' },
            { axisId: 'y', origin: 0, step: 12.5, unit: 'nm' },
          ],
        },
      ],
      acquisition: { manufacturer: 'Zeiss', acquisitionDate: '14 Aug 2026 11:00:00' },
    })
  })

  it('preserves uint16, signed int16, planar float32, and native component semantics', async () => {
    const unsigned = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [16, 16, 16, 16, 16],
      sampleFormats: [1, 1, 1, 1, 1],
      photometric: 1,
      segments: [encoded16([0, 1, 255, 256, 65_535, 500, 600, 700, 800, 900], false)],
    })
    const unsignedDocument = await open(unsigned)
    const unsignedDataset = await unsignedDocument.openDataset('series-0')
    expect(unsignedDataset.descriptor).toMatchObject({
      sampleType: 'uint16',
      components: [
        { id: 'intensity', kind: 'intensity' },
        { id: 'component-2', kind: 'scalar' },
        { id: 'component-3', kind: 'scalar' },
        { id: 'component-4', kind: 'scalar' },
        { id: 'component-5', kind: 'scalar' },
      ],
    })
    const unsignedBlock = (await collect(unsignedDataset))[0]
    const unsignedView = blockView(unsignedBlock)
    expect(
      Array.from({ length: 10 }, (_, index) => unsignedView.getUint16(index * 2, false)),
    ).toEqual([0, 1, 255, 256, 65_535, 500, 600, 700, 800, 900])

    const signedDocument = await open(
      tiffFixture({
        width: 3,
        height: 1,
        bitsPerSample: [16],
        sampleFormats: [2],
        photometric: 1,
        segments: [encoded16([-32_768, -2, 32_767], true)],
      }),
    )
    const signedBlock = (await collect(await signedDocument.openDataset('series-0')))[0]
    expect(signedBlock?.format).toEqual({ sampleType: 'int16', channels: 1, planar: false })
    const signedView = blockView(signedBlock)
    expect([0, 1, 2].map((index) => signedView.getInt16(index * 2, false))).toEqual([
      -32_768, -2, 32_767,
    ])

    const floatDocument = await open(
      tiffFixture({
        width: 2,
        height: 1,
        bitsPerSample: [32, 32, 32],
        sampleFormats: [3, 3, 3],
        photometric: 1,
        planar: true,
        segments: [encodedFloat32([0.25, 0.5]), encodedFloat32([0.75, 1]), encodedFloat32([-1, 2])],
      }),
    )
    const floatBlock = (await collect(await floatDocument.openDataset('series-0')))[0]
    expect(floatBlock?.format).toEqual({ sampleType: 'float32', channels: 3, planar: true })
    expect(floatBlock?.planeStride).toBe(8)
    const floatView = blockView(floatBlock)
    expect([0, 4, 8, 12, 16, 20].map((offset) => floatView.getFloat32(offset, false))).toEqual([
      0.25, 0.5, 0.75, 1, -1, 2,
    ])

    const rgbDocument = await open(
      tiffFixture({
        width: 1,
        height: 1,
        bitsPerSample: [8, 8, 8],
        sampleFormats: [1, 1, 1],
        photometric: 2,
        segments: [Uint8Array.of(10, 20, 30)],
      }),
    )
    expect((await rgbDocument.openDataset('series-0')).descriptor.components).toMatchObject([
      { id: 'red', kind: 'red' },
      { id: 'green', kind: 'green' },
      { id: 'blue', kind: 'blue' },
    ])
  })

  it('groups only contiguous compatible pages and exposes SubIFDs as levels', async () => {
    const sink = new Uint8ArraySink()
    await encodeTiffDocument(sink, {
      runtime: nodeRuntime,
      options: { rowsPerStrip: 1, format: 'classic' },
      pages: [
        {
          width: 2,
          height: 1,
          pixelFormat: 'rgb8',
          blocks: pixelBlocks(2, 1, 'rgb8', Uint8Array.of(1, 2, 3, 4, 5, 6)),
          reducedImages: [
            {
              width: 1,
              height: 1,
              pixelFormat: 'rgb8',
              blocks: pixelBlocks(1, 1, 'rgb8', Uint8Array.of(7, 8, 9)),
            },
          ],
        },
        {
          width: 2,
          height: 1,
          pixelFormat: 'rgb8',
          blocks: pixelBlocks(2, 1, 'rgb8', Uint8Array.of(10, 11, 12, 13, 14, 15)),
          reducedImages: [
            {
              width: 1,
              height: 1,
              pixelFormat: 'rgb8',
              blocks: pixelBlocks(1, 1, 'rgb8', Uint8Array.of(16, 17, 18)),
            },
          ],
        },
        {
          width: 1,
          height: 1,
          pixelFormat: 'rgba8',
          blocks: pixelBlocks(1, 1, 'rgba8', Uint8Array.of(20, 21, 22, 23)),
        },
      ],
    })
    const document = await open(sink.toUint8Array())
    expect(document.datasets.map(({ id }) => id)).toEqual(['series-0', 'series-1'])
    const first = await document.openDataset('series-0')
    expect(first.descriptor.axes).toMatchObject([
      { id: 'x', length: 2 },
      { id: 'y', length: 1 },
      { id: 'page', kind: 'index', length: 2, coordinates: { values: ['Page 0', 'Page 1'] } },
    ])
    expect(first.descriptor.levels).toMatchObject([
      { level: 0, axisLengths: [{ length: 2 }, { length: 1 }, { length: 2 }] },
      { level: 1, axisLengths: [{ length: 1 }, { length: 1 }, { length: 2 }] },
    ])
    const secondPage = await collect(first, [{ axisId: 'page', index: 1 }])
    expect(Array.from(secondPage[0]?.data ?? [])).toEqual([10, 11, 12, 13, 14, 15])
    const reduced = await collect(first, [{ axisId: 'page', index: 1 }], 1)
    expect(Array.from(reduced[0]?.data ?? [])).toEqual([16, 17, 18])
    const incompatible = await document.openDataset('series-1')
    expect(incompatible.descriptor.axes.map(({ id }) => id)).toEqual(['x', 'y'])
  })

  it('reads tiled regions and exposes selected private metadata within explicit bounds', async () => {
    const privateValue = [...new TextEncoder().encode('[Scan]\nPixelWidth=1.25e-9\n'), 0]
    const oversizedValue = [...new TextEncoder().encode('x'.repeat(128)), 0]
    const document = await open(
      tiffFixture({
        width: 3,
        height: 2,
        bitsPerSample: [8],
        sampleFormats: [1],
        photometric: 1,
        tiled: true,
        segments: [Uint8Array.of(1, 2, 3, 4, 5, 6)],
        extraEntries: [
          { tag: 34_680, type: 2, values: privateValue },
          { tag: 34_682, type: 2, values: oversizedValue },
        ],
      }),
      createTiffReader({ maxMetadataBytes: 1_024, maxMetadataTagBytes: 64 }),
    )
    const dataset = await document.openDataset('series-0')
    const blocks: RasterBlock[] = []
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 1,
      y: 0,
      width: 2,
      height: 2,
    })) {
      blocks.push(block)
    }
    expect(blocks.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual([
      { x: 1, y: 0, width: 2, height: 2 },
    ])
    expect(Array.from(blocks[0]?.data ?? [])).toEqual([2, 3, 5, 6])
    const metadata = document.datasets[0]?.metadata
    expect(JSON.stringify(metadata)).toContain('PixelWidth=1.25e-9')
    expect(JSON.stringify(metadata)).toContain('metadata-limit')
  })

  it('keeps the generic probe below OME-TIFF and preserves stable dataset identity', async () => {
    const xml = `<?xml version="1.0"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
      <Image ID="Image:0"><Pixels ID="Pixels:0" DimensionOrder="XYCZT" Type="uint8"
      SizeX="2" SizeY="1" SizeZ="1" SizeC="3" SizeT="1"><Channel ID="Channel:0"
      SamplesPerPixel="3"/><TiffData IFD="0" PlaneCount="1"/></Pixels></Image></OME>`
    const input = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8, 8, 8],
      sampleFormats: [1, 1, 1],
      photometric: 2,
      segments: [Uint8Array.of(10, 20, 30, 40, 50, 60)],
      extraEntries: [{ tag: 270, type: 2, values: [...new TextEncoder().encode(xml), 0] }],
    })
    const registry = new ScientificReaderRegistry([tiffReader, omeTiffReader])
    const detection = await registry.detect({
      primary: { id: 'primary', name: 'fixture.ome.tiff', source: new MemorySource(input) },
    })
    expect(detection).toMatchObject({
      reader: { id: 'purejsimage/ome-tiff' },
      confidence: 1,
    })

    const ordinary = await open(input)
    expect(ordinary.datasets[0]?.identity).toMatchObject({
      kind: 'scientific-dataset',
      reader: { id: tiffReaderDescriptor.id, version: tiffReaderDescriptor.version },
      datasetId: 'series-0',
      resources: [{ id: 'primary', identity: { size: input.byteLength } }],
    })
  })

  it('propagates cancellation and closes a read source session on iterator return', async () => {
    const input = tiffFixture({
      width: 2,
      height: 2,
      bitsPerSample: [8],
      sampleFormats: [1],
      photometric: 1,
      segments: [Uint8Array.of(1, 2, 3, 4)],
    })
    const source = new SessionTrackingSource(input)
    const document = await new ScientificReaderRegistry([tiffReader]).open({
      primary: { id: 'tracked', name: 'tracked.tiff', source },
    })
    expect(source.starts).toBe(source.ends)
    const dataset = await document.openDataset('series-0')
    const beforeRead = source.starts
    const iterator = dataset
      .readPlane({ displayAxes: ['x', 'y'], fixedIndices: [] })
      [Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    await iterator.return?.()
    expect(source.starts).toBe(beforeRead + 1)
    expect(source.ends).toBe(source.starts)

    const abort = new AbortController()
    abort.abort(new DOMException('cancel TIFF read', 'AbortError'))
    const cancelled = async (): Promise<void> => {
      for await (const block of dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        signal: abort.signal,
      })) {
        block.release?.()
      }
    }
    await expect(cancelled()).rejects.toMatchObject({ name: 'AbortError' })
    expect(source.ends).toBe(source.starts)
  })
})
