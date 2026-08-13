import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  openEnvi,
  type EnviInterleave,
  type SupportedEnviDataType,
} from '../src/scientific/formats/envi.ts'
import { renderEnviClassification } from '../src/scientific/classification.ts'
import {
  createScientificLibrary,
  encodeGsf,
  enviReader,
  gsfReader,
  ScientificReaderRegistry,
} from '../src/scientific/index.ts'
import { rasterSampleBytes, type RasterSampleType } from '../src/raster.ts'
import { readRasterSample } from '../src/scientific/samples.ts'
import { createScientificPathContext } from '../src/scientific/node.ts'
import { BlobSource, MemorySource } from '../src/source.ts'

interface EnviFixtureOptions {
  readonly samples: number
  readonly lines: number
  readonly bands: number
  readonly dataType: SupportedEnviDataType
  readonly interleave: EnviInterleave
  readonly byteOrder: 0 | 1
  readonly headerOffset?: number
  readonly extraHeader?: string
  readonly fileType?: 'ENVI Standard' | 'ENVI Classification'
  readonly value?: (x: number, y: number, band: number) => number
}

const openScientificEnvi = async (header: Uint8Array, data: Uint8Array | Blob) => {
  const document = await new ScientificReaderRegistry([enviReader]).open({
    primary: { id: 'header', name: 'scene.hdr', source: new MemorySource(header) },
    companions: {
      async resolve(request) {
        return request.kind === 'role' && request.role === 'data'
          ? {
              id: 'data',
              name: 'scene',
              source: data instanceof Blob ? new BlobSource(data) : new MemorySource(data),
            }
          : undefined
      },
    },
    readerId: 'purejsimage/envi',
  })
  return document.openDataset('raster')
}

const sampleTypeForDataType = (type: SupportedEnviDataType): RasterSampleType => {
  if (type === 1) return 'uint8'
  if (type === 2) return 'int16'
  if (type === 3) return 'int32'
  if (type === 4) return 'float32'
  if (type === 5) return 'float64'
  if (type === 12) return 'uint16'
  return 'uint32'
}

const writeSample = (
  view: DataView,
  offset: number,
  type: SupportedEnviDataType,
  value: number,
  littleEndian: boolean,
): void => {
  if (type === 1) view.setUint8(offset, value)
  else if (type === 2) view.setInt16(offset, value, littleEndian)
  else if (type === 3) view.setInt32(offset, value, littleEndian)
  else if (type === 4) view.setFloat32(offset, value, littleEndian)
  else if (type === 5) view.setFloat64(offset, value, littleEndian)
  else if (type === 12) view.setUint16(offset, value, littleEndian)
  else view.setUint32(offset, value, littleEndian)
}

const fixture = (
  options: EnviFixtureOptions,
): { readonly header: Uint8Array; readonly data: Uint8Array } => {
  const headerOffset = options.headerOffset ?? 0
  const sampleType = sampleTypeForDataType(options.dataType)
  const bytesPerSample = rasterSampleBytes(sampleType)
  const data = new Uint8Array(
    headerOffset + options.samples * options.lines * options.bands * bytesPerSample,
  )
  data.fill(0xa5, 0, headerOffset)
  const view = new DataView(data.buffer)
  const value = options.value ?? ((x, y, band) => band * 100 + y * 10 + x)
  for (let y = 0; y < options.lines; y += 1) {
    for (let x = 0; x < options.samples; x += 1) {
      for (let band = 0; band < options.bands; band += 1) {
        const index =
          options.interleave === 'bsq'
            ? (band * options.lines + y) * options.samples + x
            : options.interleave === 'bil'
              ? (y * options.bands + band) * options.samples + x
              : (y * options.samples + x) * options.bands + band
        writeSample(
          view,
          headerOffset + index * bytesPerSample,
          options.dataType,
          value(x, y, band),
          options.byteOrder === 0,
        )
      }
    }
  }
  const header = new TextEncoder().encode(`ENVI
samples = ${options.samples}
lines = ${options.lines}
bands = ${options.bands}
header offset = ${headerOffset}
file type = ${options.fileType ?? 'ENVI Standard'}
data type = ${options.dataType}
interleave = ${options.interleave}
byte order = ${options.byteOrder}
${options.extraHeader ?? ''}`)
  return { header, data }
}

const readValues = async (
  opened: Awaited<ReturnType<typeof openEnvi>>,
  channels: readonly number[],
): Promise<number[]> => {
  const values: number[] = []
  for await (const block of opened.readPlane({
    z: 0,
    c: channels,
    t: 0,
    x: 1,
    y: 0,
    width: 2,
    height: 2,
  })) {
    const bytesPerSample = rasterSampleBytes(block.format.sampleType)
    const planeStride = block.planeStride ?? block.stride * block.height
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let channel = 0; channel < channels.length; channel += 1) {
      for (let y = 0; y < block.height; y += 1) {
        for (let x = 0; x < block.width; x += 1) {
          values.push(
            readRasterSample(
              block.data,
              view,
              channel * planeStride + y * block.stride + x * bytesPerSample,
              block.format.sampleType,
            ),
          )
        }
      }
    }
  }
  return values
}

describe('ENVI Standard scientific rasters', () => {
  it('keeps a large Blob-backed binary lazy and reads only bounded slices', async () => {
    const requestedSlices: { readonly start: number; readonly end: number }[] = []
    class VirtualRasterBlob extends Blob {
      override get size(): number {
        return 1_073_741_824
      }

      override slice(start = 0, end = this.size, contentType?: string): Blob {
        requestedSlices.push({ start, end })
        return contentType === undefined
          ? new Blob([new Uint8Array(end - start)])
          : new Blob([new Uint8Array(end - start)], { type: contentType })
      }
    }
    const header = new TextEncoder().encode(`ENVI
samples = 1024
lines = 1024
bands = 1024
file type = ENVI Standard
data type = 1
interleave = bsq
byte order = 0
`)
    const opened = await openEnvi({
      header: new Blob([header]),
      data: new VirtualRasterBlob(),
      maxInputBytes: 1_073_741_824,
      maxFrames: 1024,
      rowsPerBlock: 1,
    })
    expect(requestedSlices).toEqual([])
    for await (const _block of opened.readPlane({
      z: 0,
      c: 512,
      t: 0,
      x: 20,
      y: 30,
      width: 5,
      height: 2,
    })) {
      // Exhaust the two selected rows.
    }
    expect(opened.sourceBytesRead).toBe(10)
    expect(requestedSlices.length).toBeGreaterThan(0)
    expect(
      requestedSlices.every(
        ({ start, end }) => end - start < opened.sizeX * opened.sizeY * opened.sizeC,
      ),
    ).toBe(true)
    expect(Math.max(...requestedSlices.map(({ end }) => end))).toBeLessThan(
      opened.sizeX * opened.sizeY * opened.sizeC,
    )
  })

  it.each([
    ['bsq', 1, 0],
    ['bil', 12, 0],
    ['bip', 2, 1],
    ['bsq', 3, 1],
    ['bil', 4, 0],
    ['bip', 5, 1],
    ['bsq', 13, 0],
  ] as const)(
    'decodes %s data type %i with byte order %i into canonical native samples',
    async (interleave, dataType, byteOrder) => {
      const input = fixture({ samples: 3, lines: 2, bands: 2, interleave, dataType, byteOrder })
      const opened = await openEnvi(input)
      expect(opened.sampleType).toBe(sampleTypeForDataType(dataType))
      expect(await readValues(opened, [1, 0])).toEqual([101, 102, 111, 112, 1, 2, 11, 12])
    },
  )

  it('parses multiline spectral metadata, header offsets, nodata, and unknown fields', async () => {
    const input = fixture({
      samples: 2,
      lines: 1,
      bands: 3,
      dataType: 4,
      interleave: 'bip',
      byteOrder: 0,
      headerOffset: 16,
      extraHeader: `description = {
  Synthetic hyperspectral cube
  generated for tests }
band names = {
  Blue,
  Green,
  Red }
wavelength = {
  450.5, 550.25,
  650.75 }
wavelength units = Nanometers
fwhm = { 10, 11, 12 }
data ignore value = -9999
default bands = { 3, 2, 1 }
sensor type = Synthetic Pushbroom
custom laboratory field = retained
`,
    })
    const opened = await openEnvi(input)
    expect({
      dimensions: [opened.sizeX, opened.sizeY, opened.sizeC],
      headerOffset: opened.headerOffset,
      description: opened.description,
      noData: opened.noDataValue,
      defaultBands: opened.defaultBands,
      sensor: opened.sensorType,
      custom: opened.metadata['custom laboratory field'],
      channels: opened.channels,
    }).toEqual({
      dimensions: [2, 1, 3],
      headerOffset: 16,
      description: 'Synthetic hyperspectral cube\n  generated for tests',
      noData: -9_999,
      defaultBands: [2, 1, 0],
      sensor: 'Synthetic Pushbroom',
      custom: 'retained',
      channels: [
        {
          id: 'Band:1',
          name: 'Blue',
          samplesPerPixel: 1,
          spectral: { center: 450.5, unit: 'Nanometers', fwhm: 10 },
        },
        {
          id: 'Band:2',
          name: 'Green',
          samplesPerPixel: 1,
          spectral: { center: 550.25, unit: 'Nanometers', fwhm: 11 },
        },
        {
          id: 'Band:3',
          name: 'Red',
          samplesPerPixel: 1,
          spectral: { center: 650.75, unit: 'Nanometers', fwhm: 12 },
        },
      ],
    })
  })

  it('resolves header-primary and data-primary ENVI pairs without filesystem assumptions', async () => {
    const input = fixture({
      samples: 2,
      lines: 1,
      bands: 2,
      dataType: 2,
      interleave: 'bsq',
      byteOrder: 0,
      extraHeader: `band names = { Blue, Red }
wavelength = { 450, 650 }
wavelength units = nm
fwhm = { 10, 20 }
map info = { Geographic Lat/Lon, 1, 1, -83.7, 42.3, 0.01, 0.01, WGS-84 }
`,
    })
    const registry = new ScientificReaderRegistry([enviReader])
    const requests: unknown[] = []
    const headerPrimary = await registry.open({
      primary: { id: 'header', name: 'scene.hdr', source: new MemorySource(input.header) },
      companions: {
        async resolve(request) {
          requests.push(request)
          return request.kind === 'role' && request.role === 'data'
            ? { id: 'data', name: 'scene', source: new MemorySource(input.data) }
            : undefined
        },
      },
    })
    expect(requests).toContainEqual({ kind: 'role', role: 'data', relativeName: 'scene' })
    expect(headerPrimary.datasets).toHaveLength(1)
    expect(headerPrimary.datasets[0]?.identity).toMatchObject({
      kind: 'scientific-dataset',
      reader: { id: 'purejsimage/envi', version: '1.0.0' },
      datasetId: 'raster',
      resources: [
        { id: 'data', identity: { kind: 'session', size: input.data.byteLength } },
        { id: 'header', identity: { kind: 'session', size: input.header.byteLength } },
      ],
    })
    const headerDataset = await headerPrimary.openDataset('raster')
    expect(headerDataset.descriptor.axes.find(({ id }) => id === 'channel')).toMatchObject({
      kind: 'spectral',
      entries: [
        { name: 'Blue', spectral: { center: 450, unit: 'nm', fwhm: 10 } },
        { name: 'Red', spectral: { center: 650, unit: 'nm', fwhm: 20 } },
      ],
    })
    expect(headerDataset.descriptor.metadata?.['purejsimage:envi']).toMatchObject({
      dataType: 2,
      interleave: 'bsq',
      mapInfo: ['Geographic Lat/Lon', 1, 1, -83.7, 42.3, 0.01, 0.01, 'WGS-84'],
    })

    const dataPrimary = await registry.open({
      primary: { id: 'data', name: 'scene.dat', source: new MemorySource(input.data) },
      companions: {
        async resolve(request) {
          expect(request).toEqual({ kind: 'role', role: 'header', relativeName: 'scene.hdr' })
          return { id: 'header', name: 'scene.hdr', source: new MemorySource(input.header) }
        },
      },
    })
    expect(dataPrimary.datasets[0]?.id).toBe('raster')

    await expect(
      registry.detect({
        primary: { id: 'orphan', name: 'orphan.hdr', source: new MemorySource(input.header) },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('binary companion'),
    })

    await expect(
      new ScientificReaderRegistry([enviReader, gsfReader]).detect({
        primary: {
          id: 'not-envi',
          name: 'surface.gsf',
          source: new MemorySource(encodeGsf({ width: 1, height: 1, values: [3] })),
        },
        companions: { async resolve() {} },
      }),
    ).resolves.toMatchObject({ reader: { id: 'purejsimage/gsf' } })
  })

  it('defaults an omitted header offset to zero for compatible institutional rasters', async () => {
    const input = fixture({
      samples: 3,
      lines: 2,
      bands: 2,
      dataType: 4,
      interleave: 'bil',
      byteOrder: 0,
    })
    const header = new TextEncoder().encode(
      new TextDecoder().decode(input.header).replace('header offset = 0\n', ''),
    )
    const opened = await openEnvi({ header, data: input.data })

    expect(opened.headerOffset).toBe(0)
    expect(await readValues(opened, [1, 0])).toEqual([101, 102, 111, 112, 1, 2, 11, 12])
  })

  it('opens and color-renders ENVI Classification rasters with categorical sampling', async () => {
    const input = fixture({
      samples: 6,
      lines: 4,
      bands: 1,
      dataType: 1,
      interleave: 'bsq',
      byteOrder: 0,
      fileType: 'ENVI Classification',
      extraHeader: `classes = 3
class names = { Unclassified, Clay, Carbonate }
class lookup = { 0, 0, 0, 240, 80, 20, 30, 160, 220 }
`,
      value: (x, y) => (x + y) % 3,
    })
    const opened = await openEnvi(input)
    expect(opened.fileType).toBe('ENVI Classification')
    expect(opened.classes).toEqual([
      { value: 0, name: 'Unclassified', color: { red: 0, green: 0, blue: 0 } },
      { value: 1, name: 'Clay', color: { red: 240, green: 80, blue: 20 } },
      { value: 2, name: 'Carbonate', color: { red: 30, green: 160, blue: 220 } },
    ])
    const rendered = renderEnviClassification(await openScientificEnvi(input.header, input.data), {
      maxWidth: 3,
      maxHeight: 2,
    })
    const pixels: number[] = []
    for await (const block of rendered.pixels) pixels.push(...block.data)
    expect({ width: rendered.width, height: rendered.height }).toEqual({ width: 3, height: 2 })
    expect(pixels).toEqual([30, 160, 220, 240, 80, 20, 0, 0, 0, 240, 80, 20, 0, 0, 0, 30, 160, 220])
  })

  it('keeps the official Afghanistan map dimensions lazy despite full-frame image limits', async () => {
    const width = 37_679
    const height = 39_594
    const bytes = width * height
    class VirtualClassificationBlob extends Blob {
      override get size(): number {
        return bytes
      }

      override slice(start = 0, end = this.size, contentType?: string): Blob {
        const row = new Uint8Array(end - start)
        row.fill(1)
        return contentType === undefined ? new Blob([row]) : new Blob([row], { type: contentType })
      }
    }
    const header = new TextEncoder().encode(`ENVI
samples = ${width}
lines = ${height}
bands = 1
file type = ENVI Classification
data type = 1
interleave = bsq
byte order = 0
classes = 2
class names = { Unclassified, Mineral }
class lookup = { 0, 0, 0, 180, 90, 30 }
`)
    await openEnvi({
      header,
      data: new VirtualClassificationBlob(),
      maxInputBytes: bytes,
      maxPixels: 1,
      maxDecodedBytes: 1_048_576,
    })
    const rendered = renderEnviClassification(
      await openScientificEnvi(header, new VirtualClassificationBlob()),
      { maxWidth: 4, maxHeight: 4 },
    )
    let outputBytes = 0
    for await (const block of rendered.pixels) outputBytes += block.data.byteLength
    expect({ width: rendered.width, height: rendered.height, outputBytes }).toEqual({
      width: 3,
      height: 4,
      outputBytes: 36,
    })
  })

  it('rejects malformed ENVI Classification metadata and undeclared class samples', async () => {
    const input = fixture({
      samples: 2,
      lines: 1,
      bands: 1,
      dataType: 1,
      interleave: 'bsq',
      byteOrder: 0,
      fileType: 'ENVI Classification',
      extraHeader: `classes = 2
class names = { Unclassified, Mineral }
class lookup = { 0, 0, 0, 255, 100, 50 }
`,
      value: (x) => x * 2,
    })
    const malformedHeader = new TextEncoder().encode(
      new TextDecoder().decode(input.header).replace('255, 100, 50', '255, 100'),
    )
    await expect(openEnvi({ header: malformedHeader, data: input.data })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    const rendered = renderEnviClassification(await openScientificEnvi(input.header, input.data), {
      maxWidth: 2,
      maxHeight: 1,
    })
    await expect(async () => {
      for await (const _block of rendered.pixels) {
        // Exhaust the categorical renderer.
      }
    }).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('opens an associated ENVI header and binary pair by Node path', async () => {
    const input = fixture({
      samples: 3,
      lines: 2,
      bands: 2,
      dataType: 12,
      interleave: 'bil',
      byteOrder: 0,
    })
    const directory = await mkdtemp(join(tmpdir(), 'purejsimage-envi-'))
    const headerPath = join(directory, 'cube.hdr')
    try {
      await Promise.all([
        writeFile(headerPath, input.header),
        writeFile(join(directory, 'cube'), input.data),
      ])
      const scientific = createScientificLibrary({ readers: [enviReader] })
      const document = await scientific.open(await createScientificPathContext(headerPath))
      expect(document.datasets[0]?.id).toBe('raster')
      const opened = await document.openDataset('raster')
      const values: number[] = []
      for await (const block of opened.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'channel', index: 1 }],
      })) {
        for (let offset = 0; offset < block.data.byteLength; offset += 2) {
          values.push(
            new DataView(block.data.buffer, block.data.byteOffset + offset, 2).getUint16(0, false),
          )
        }
      }
      expect(values).toEqual([100, 101, 102, 110, 111, 112])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['bsq', 20],
    ['bil', 20],
    ['bip', 200],
  ] as const)(
    'keeps %s ROI reads bounded to calculable row ranges',
    async (interleave, expectedBytes) => {
      const input = fixture({
        samples: 100,
        lines: 20,
        bands: 10,
        dataType: 12,
        interleave,
        byteOrder: 0,
      })
      const opened = await openEnvi({ ...input, rowsPerBlock: 1 })
      for await (const _block of opened.readPlane({
        z: 0,
        c: 4,
        t: 0,
        x: 10,
        y: 3,
        width: 5,
        height: 2,
      })) {
        // Exhaust the bounded reads.
      }
      expect(opened.sourceBytesRead).toBe(expectedBytes)
    },
  )

  it('rejects malformed dimensions, truncation, trailing data, and unsupported scalar classes', async () => {
    const valid = fixture({
      samples: 2,
      lines: 2,
      bands: 1,
      dataType: 1,
      interleave: 'bsq',
      byteOrder: 0,
    })
    await expect(
      openEnvi({ header: valid.header, data: valid.data.subarray(0, 3) }),
    ).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
    const trailing = new Uint8Array(valid.data.byteLength + 1)
    trailing.set(valid.data)
    await expect(openEnvi({ header: valid.header, data: trailing })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    const text = new TextDecoder().decode(valid.header)
    await expect(
      openEnvi({
        header: new TextEncoder().encode(text.replace('samples = 2', 'samples = 0')),
        data: valid.data,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    for (const unsupported of [6, 9, 14, 15]) {
      await expect(
        openEnvi({
          header: new TextEncoder().encode(
            text.replace('data type = 1', `data type = ${unsupported}`),
          ),
          data: valid.data,
        }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    }
    await expect(openEnvi({ ...valid, maxFrames: 0 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects band/allocation attacks before raster reads', async () => {
    const input = fixture({
      samples: 4,
      lines: 4,
      bands: 3,
      dataType: 5,
      interleave: 'bil',
      byteOrder: 1,
    })
    await expect(openEnvi({ ...input, maxPixels: 8 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(openEnvi({ ...input, maxFrames: 2 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })
})
