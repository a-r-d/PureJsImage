import { describe, expect, it } from 'vitest'
import type { PixelBlock } from '../src/pixel.ts'
import type { RasterBlock } from '../src/raster.ts'
import { encodeTiffDocument } from '../src/codecs/tiff.ts'
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

interface TiffEntryFixture {
  readonly tag: number
  readonly type: 2 | 3 | 4
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

const fixtureEntryBytes = (entry: TiffEntryFixture): number =>
  entry.values.length * (entry.type === 3 ? 2 : entry.type === 4 ? 4 : 1)

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
    view.setUint32(entryOffset + 4, entry.values.length, true)
    if (valueBytes > 4) {
      view.setUint32(entryOffset + 8, externalOffset, true)
      externalOffset += valueBytes
    }
    for (let valueIndex = 0; valueIndex < entry.values.length; valueIndex += 1) {
      const value = entry.values[valueIndex] ?? 0
      const offset = valuesOffset + valueIndex * (entry.type === 3 ? 2 : entry.type === 4 ? 4 : 1)
      if (entry.type === 3) view.setUint16(offset, value, true)
      else if (entry.type === 4) view.setUint32(offset, value, true)
      else output[offset] = value
    }
  }
  for (let index = 0; index < options.segments.length; index += 1) {
    output.set(options.segments[index] ?? new Uint8Array(), offsets[index] ?? 0)
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
