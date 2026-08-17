import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync, deflateSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { crc32 } from '../src/codecs/crc32.ts'
import { ImageError } from '../src/errors.ts'
import { rasterSampleBytes } from '../src/raster.ts'
import { createScientificFileContext } from '../src/scientific/browser.ts'
import type { ScientificDataset } from '../src/scientific/dataset.ts'
import { crc32c } from '../src/scientific/formats/crc32c.ts'
import { createScientificPathContext } from '../src/scientific/node.ts'
import type {
  ScientificCompanionRequest,
  ScientificOpenContext,
  ScientificReader,
  ScientificResource,
} from '../src/scientific/reader.ts'
import { createOmeZarrReader, omeZarrReader } from '../src/scientific/readers/ome-zarr.ts'
import { readRasterSample } from '../src/scientific/samples.ts'
import { MemorySource } from '../src/source.ts'

const text = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const resource = (name: string, bytes: Uint8Array): ScientificResource =>
  Object.freeze({ id: name, name, source: new MemorySource(bytes) })

const trackingContext = (
  files: Readonly<Record<string, Uint8Array>>,
  primaryName = 'zarr.json',
): { readonly context: ScientificOpenContext; readonly resolved: string[] } => {
  const resolved: string[] = []
  const primary = files[primaryName]
  if (primary === undefined) throw new Error(`Test store is missing ${primaryName}`)
  return {
    resolved,
    context: {
      primary: resource(primaryName, primary),
      companions: {
        async resolve(request: Readonly<ScientificCompanionRequest>) {
          const name = request.kind === 'relative-name' ? request.name : request.relativeName
          if (name === undefined) return undefined
          resolved.push(name)
          const bytes = files[name]
          return bytes === undefined ? undefined : resource(name, bytes)
        },
      },
    },
  }
}

const groupMeta = (
  datasets: readonly { readonly path: string; readonly scale: readonly number[] }[],
  extras: Readonly<Record<string, unknown>> = {},
): Uint8Array =>
  text({
    zarr_format: 3,
    node_type: 'group',
    attributes: {
      ome: {
        version: '0.5',
        ...extras,
        multiscales: [
          {
            name: 'demo',
            axes: [
              { name: 'y', type: 'space', unit: 'micrometer' },
              { name: 'x', type: 'space', unit: 'micrometer' },
            ],
            datasets: datasets.map((dataset) => ({
              path: dataset.path,
              coordinateTransformations: [{ type: 'scale', scale: dataset.scale }],
            })),
          },
        ],
      },
    },
  })

const arrayMeta = (
  shape: readonly number[],
  chunkShape: readonly number[],
  codecs: unknown,
  extras: Readonly<Record<string, unknown>> = {},
): Uint8Array =>
  text({
    zarr_format: 3,
    node_type: 'array',
    shape,
    data_type: extras.data_type ?? 'uint8',
    chunk_grid: { name: 'regular', configuration: { chunk_shape: chunkShape } },
    chunk_key_encoding: extras.chunk_key_encoding ?? {
      name: 'default',
      configuration: { separator: '/' },
    },
    fill_value: extras.fill_value ?? 0,
    codecs,
    attributes: {},
  })

const bytesCodec = [{ name: 'bytes', configuration: { endian: 'little' } }]

const raster = (height: number, width: number): Uint8Array => {
  const data = new Uint8Array(height * width)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[y * width + x] = y * 10 + x
  }
  return data
}

const chunkOf = (
  data: Uint8Array,
  _height: number,
  width: number,
  y0: number,
  x0: number,
  chunkHeight: number,
  chunkWidth: number,
): Uint8Array => {
  const chunk = new Uint8Array(chunkHeight * chunkWidth)
  for (let y = 0; y < chunkHeight; y += 1) {
    for (let x = 0; x < chunkWidth; x += 1) {
      chunk[y * chunkWidth + x] = data[(y0 + y) * width + (x0 + x)] ?? 0
    }
  }
  return chunk
}

const regularStore = (): Record<string, Uint8Array> => {
  const level0 = raster(8, 8)
  const level1 = raster(4, 4)
  return {
    'zarr.json': groupMeta(
      [
        { path: '0', scale: [0.5, 0.5] },
        { path: '1', scale: [1, 1] },
      ],
      {
        omero: {
          channels: [{ label: 'DAPI', color: '0000FF' }],
        },
      },
    ),
    '0/zarr.json': arrayMeta([8, 8], [4, 4], bytesCodec),
    '0/c/0/0': chunkOf(level0, 8, 8, 0, 0, 4, 4),
    '0/c/0/1': chunkOf(level0, 8, 8, 0, 4, 4, 4),
    '0/c/1/0': chunkOf(level0, 8, 8, 4, 0, 4, 4),
    '0/c/1/1': chunkOf(level0, 8, 8, 4, 4, 4, 4),
    '1/zarr.json': arrayMeta([4, 4], [4, 4], bytesCodec),
    '1/c/0/0': level1,
  }
}

const openDataset = async (
  reader: ScientificReader,
  files: Readonly<Record<string, Uint8Array>>,
  primaryName = 'zarr.json',
): Promise<ScientificDataset> => {
  const { context } = trackingContext(files, primaryName)
  const document = await reader.open(context)
  return document.openDataset(document.datasets[0]?.id ?? '')
}

const planeValues = async (
  dataset: ScientificDataset,
  request: {
    readonly x?: number
    readonly y?: number
    readonly width?: number
    readonly height?: number
    readonly resolutionLevel?: number
    readonly displayAxes?: readonly [string, string]
  } = {},
): Promise<number[]> => {
  const values: number[] = []
  for await (const block of dataset.readPlane({
    displayAxes: request.displayAxes ?? ['x', 'y'],
    fixedIndices: [],
    ...request,
  })) {
    const sampleBytes = rasterSampleBytes(block.format.sampleType)
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let y = 0; y < block.height; y += 1) {
      for (let x = 0; x < block.width; x += 1) {
        values.push(
          readRasterSample(
            block.data,
            view,
            y * block.stride + x * sampleBytes,
            block.format.sampleType,
          ),
        )
      }
    }
  }
  return values
}

const expectCode = async (
  action: () => Promise<unknown>,
  code: ImageError['code'],
): Promise<void> => {
  try {
    await action()
    throw new Error(`Expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(ImageError)
    expect((error as ImageError).code).toBe(code)
  }
}

const rawZstd = (data: Uint8Array): Uint8Array => {
  const header = data.byteLength * 8 + 1
  return Uint8Array.of(
    0x28,
    0xb5,
    0x2f,
    0xfd,
    0x20,
    data.byteLength,
    header & 255,
    (header >>> 8) & 255,
    (header >>> 16) & 255,
    ...data,
  )
}

const lz4Literals = (data: Uint8Array): Uint8Array => {
  if (data.byteLength < 15) return Uint8Array.of(data.byteLength << 4, ...data)
  return Uint8Array.of(0xf0, data.byteLength - 15, ...data)
}

const bloscMemcpy = (payload: Uint8Array): Uint8Array => {
  const output = new Uint8Array(16 + payload.byteLength)
  output[0] = 2
  output[1] = 1
  output[2] = 0x02
  output[3] = 1
  const view = new DataView(output.buffer)
  view.setInt32(4, payload.byteLength, true)
  view.setInt32(8, payload.byteLength, true)
  view.setInt32(12, output.byteLength, true)
  output.set(payload, 16)
  return output
}

const bloscLz4 = (payload: Uint8Array): Uint8Array => {
  const compressed = lz4Literals(payload)
  const output = new Uint8Array(20 + compressed.byteLength)
  output[0] = 2
  output[1] = 1
  output[2] = 1 << 5
  output[3] = 1
  const view = new DataView(output.buffer)
  view.setInt32(4, payload.byteLength, true)
  view.setInt32(8, payload.byteLength, true)
  view.setInt32(12, output.byteLength, true)
  view.setInt32(16, compressed.byteLength, true)
  output.set(compressed, 20)
  return output
}

const appendCrc32c = (payload: Uint8Array): Uint8Array => {
  const output = new Uint8Array(payload.byteLength + 4)
  output.set(payload)
  const view = new DataView(output.buffer)
  view.setUint32(payload.byteLength, crc32c(payload), true)
  return output
}

describe('OME-Zarr 0.5 reader', () => {
  it('probes OME-NGFF 0.5 groups and ignores generic Zarr arrays', async () => {
    const ome = await omeZarrReader.probe(trackingContext(regularStore()).context)
    expect(ome.confidence).toBeGreaterThan(0.9)
    const generic = await omeZarrReader.probe(
      trackingContext({
        'zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
      }).context,
    )
    expect(generic.confidence).toBe(0)
  })

  it('opens a multiscale image with calibrated levels and selected chunk reads', async () => {
    const { context, resolved } = trackingContext(regularStore())
    const document = await omeZarrReader.open(context)
    expect(document.format).toBe('OME-Zarr')
    expect(document.metadata.omeNgffVersion).toBe('0.5')
    const dataset = await document.openDataset('image')
    expect(dataset.descriptor.axes.map((axis) => axis.id)).toEqual(['y', 'x'])
    expect(dataset.descriptor.capabilities.resolutionLevels).toBe(true)
    const x = dataset.descriptor.axes.find((axis) => axis.id === 'x')
    expect(x?.unit).toBe('micrometer')
    expect(x?.coordinates).toEqual({ type: 'linear', origin: 0, step: 0.5 })
    expect(x?.calibration).toMatchObject({ kind: 'embedded', locator: 'ome:multiscales/axes/x' })
    expect(dataset.descriptor.levels[1]?.axisCoordinates?.[1]?.coordinates).toEqual({
      type: 'linear',
      origin: 0,
      step: 1,
    })
    expect(await planeValues(dataset, { x: 5, y: 1, width: 2, height: 2 })).toEqual([
      15, 16, 25, 26,
    ])
    expect(await planeValues(dataset, { resolutionLevel: 1, width: 2, height: 1 })).toEqual([0, 1])
    expect(resolved.filter((name) => name.startsWith('0/c/'))).toEqual(['0/c/0/1'])
  })

  it('fills missing chunks and rejects unsupported codecs by name', async () => {
    const files = regularStore()
    delete files['0/c/1/1']
    const dataset = await openDataset(omeZarrReader, files)
    expect(await planeValues(dataset, { x: 4, y: 4, width: 1, height: 1 })).toEqual([0])

    const snappy = regularStore()
    snappy['0/zarr.json'] = arrayMeta([8, 8], [8, 8], [{ name: 'snappy', configuration: {} }])
    snappy['0/c/0/0'] = raster(8, 8)
    await expectCode(
      () => openDataset(omeZarrReader, snappy).then((opened) => planeValues(opened)),
      'UNSUPPORTED_OPERATION',
    )
  })

  it('decodes gzip, zstd, and sharded arrays', async () => {
    const pixels = raster(4, 4)
    const gzipStore = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [4, 4],
        [4, 4],
        [
          { name: 'bytes', configuration: { endian: 'little' } },
          { name: 'gzip', configuration: { level: 1 } },
        ],
      ),
      '0/c/0/0': new Uint8Array(gzipSync(pixels)),
    }
    expect(await planeValues(await openDataset(omeZarrReader, gzipStore))).toEqual([...pixels])

    const zstdStore = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [4, 4],
        [4, 4],
        [
          { name: 'bytes', configuration: { endian: 'little' } },
          { name: 'zstd', configuration: { level: 0 } },
        ],
      ),
      '0/c/0/0': rawZstd(pixels),
    }
    expect(await planeValues(await openDataset(omeZarrReader, zstdStore))).toEqual([...pixels])

    const inner = [
      chunkOf(pixels, 4, 4, 0, 0, 2, 2),
      chunkOf(pixels, 4, 4, 0, 2, 2, 2),
      chunkOf(pixels, 4, 4, 2, 0, 2, 2),
      chunkOf(pixels, 4, 4, 2, 2, 2, 2),
    ]
    const index = new Uint8Array(64)
    const indexView = new DataView(index.buffer)
    let offset = 0
    const payloads: Uint8Array[] = []
    for (const [entry, chunk] of inner.entries()) {
      indexView.setUint32(entry * 16, offset, true)
      indexView.setUint32(entry * 16 + 8, chunk.byteLength, true)
      payloads.push(chunk)
      offset += chunk.byteLength
    }
    const shard = new Uint8Array(offset + 68)
    let cursor = 0
    for (const payload of payloads) {
      shard.set(payload, cursor)
      cursor += payload.byteLength
    }
    shard.set(appendCrc32c(index), offset)
    const sharded = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [4, 4],
        [4, 4],
        [
          {
            name: 'sharding_indexed',
            configuration: {
              chunk_shape: [2, 2],
              codecs: bytesCodec,
              index_codecs: [...bytesCodec, { name: 'crc32c' }],
              index_location: 'end',
            },
          },
        ],
      ),
      '0/c/0/0': shard,
    }
    expect(await planeValues(await openDataset(omeZarrReader, sharded))).toEqual([...pixels])
  })

  it('resolves store-relative companions and Node directory roots', async () => {
    const files = Object.fromEntries(
      Object.entries(regularStore()).map(([name, bytes]) => [
        name === 'zarr.json' ? 'plate.zarr/zarr.json' : `plate.zarr/${name}`,
        bytes,
      ]),
    )
    const dataset = await openDataset(omeZarrReader, files, 'plate.zarr/zarr.json')
    expect(await planeValues(dataset, { width: 1, height: 1 })).toEqual([0])

    const root = await mkdtemp(join(tmpdir(), 'purejsimage-ome-zarr-'))
    const store = regularStore()
    for (const [name, bytes] of Object.entries(store)) {
      const path = join(root, name)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, bytes)
    }
    const document = await omeZarrReader.open(
      await createScientificPathContext(join(root, 'zarr.json')),
    )
    const fromDisk = await document.openDataset('image')
    expect(await planeValues(fromDisk, { x: 3, y: 0, width: 1, height: 1 })).toEqual([3])
  })

  it('opens a browser File store and rejects Zarr v2, traversal, and missing companions', async () => {
    const files = regularStore()
    const companions = Object.entries(files)
      .filter(([name]) => name !== 'zarr.json')
      .map(([name, bytes]) => new File([Uint8Array.from(bytes)], name))
    const document = await omeZarrReader.open(
      createScientificFileContext(
        new File([Uint8Array.from(files['zarr.json'] ?? new Uint8Array())], 'zarr.json'),
        { companions },
      ),
    )
    expect((await document.openDataset('image')).descriptor.sampleType).toBe('uint8')

    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({ '.zgroup': text({ zarr_format: 2 }) }, '.zgroup').context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open({
          primary: resource('zarr.json', groupMeta([{ path: '0', scale: [1, 1] }])),
        }),
      'INVALID_INPUT',
    )
    const traversal = regularStore()
    traversal['zarr.json'] = groupMeta([{ path: '../secret', scale: [1, 1] }])
    await expectCode(() => omeZarrReader.open(trackingContext(traversal).context), 'INVALID_INPUT')
    await expectCode(
      () =>
        createOmeZarrReader({ limits: { maxDimensions: 1 } }).open(
          trackingContext(regularStore()).context,
        ),
      'LIMIT_EXCEEDED',
    )
  })

  it('computes CRC-32C matching the Castagnoli checksum used by Zarr', () => {
    expect(crc32c(new TextEncoder().encode('123456789'))).toBe(0xe306_9283)
  })
})

const v2Group = (): Uint8Array => text({ zarr_format: 2 })

const v2Attrs = (
  datasets: readonly { readonly path: string; readonly scale: readonly number[] }[],
): Uint8Array =>
  text({
    multiscales: [
      {
        version: '0.4',
        name: 'legacy',
        axes: [
          { name: 'y', type: 'space', unit: 'micrometer' },
          { name: 'x', type: 'space', unit: 'micrometer' },
        ],
        datasets: datasets.map((dataset) => ({
          path: dataset.path,
          coordinateTransformations: [{ type: 'scale', scale: dataset.scale }],
        })),
      },
    ],
    omero: { channels: [{ label: 'DAPI', color: '0000FF' }] },
  })

const v2Array = (
  shape: readonly number[],
  chunks: readonly number[],
  extras: Readonly<Record<string, unknown>> = {},
): Uint8Array =>
  text({
    zarr_format: 2,
    shape,
    chunks,
    dtype: extras.dtype ?? '|u1',
    compressor: extras.compressor ?? null,
    fill_value: extras.fill_value ?? 0,
    order: extras.order ?? 'C',
    filters: extras.filters ?? null,
    dimension_separator: extras.dimension_separator ?? '/',
  })

describe('OME-Zarr 0.4 / Zarr v2 reader', () => {
  it('opens a .zgroup store with calibrated 0.4 multiscales and C-order chunks', async () => {
    const level0 = raster(8, 8)
    const files = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [0.5, 0.5] }]),
      '0/.zarray': v2Array([8, 8], [4, 4]),
      '0/0/0': chunkOf(level0, 8, 8, 0, 0, 4, 4),
      '0/0/1': chunkOf(level0, 8, 8, 0, 4, 4, 4),
      '0/1/0': chunkOf(level0, 8, 8, 4, 0, 4, 4),
      '0/1/1': chunkOf(level0, 8, 8, 4, 4, 4, 4),
    }
    const probed = await omeZarrReader.probe(trackingContext(files, '.zgroup').context)
    expect(probed.confidence).toBeGreaterThan(0.7)
    const { context, resolved } = trackingContext(files, '.zgroup')
    const document = await omeZarrReader.open(context)
    expect(document.metadata.omeNgffVersion).toBe('0.4')
    expect(document.metadata.zarrFormat).toBe(2)
    const dataset = await document.openDataset('image')
    expect(dataset.descriptor.axes.find((axis) => axis.id === 'x')?.coordinates).toEqual({
      type: 'linear',
      origin: 0,
      step: 0.5,
    })
    expect(await planeValues(dataset, { x: 5, y: 1, width: 2, height: 2 })).toEqual([
      15, 16, 25, 26,
    ])
    expect(resolved.filter((name) => name.startsWith('0/'))).toEqual([
      '0/.zarray',
      '0/.zattrs',
      '0/0/1',
    ])
  })

  it('opens .zattrs as the primary resource and decodes F-order, zlib, gzip, and Blosc', async () => {
    const pixels = Uint8Array.of(1, 2, 3, 4, 5, 6)
    const fOrder = Uint8Array.of(1, 4, 2, 5, 3, 6)
    const fortran = {
      '.zgroup': text({ zarr_format: 2 }),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 3], [2, 3], { order: 'F', dimension_separator: '.' }),
      '0/0.0': fOrder,
    }
    expect(await planeValues(await openDataset(omeZarrReader, fortran, '.zattrs'))).toEqual([
      ...pixels,
    ])

    const gzip = {
      '.zgroup': text({ zarr_format: 2 }),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { compressor: { id: 'gzip', level: 1 } }),
      '0/0/0': new Uint8Array(gzipSync(Uint8Array.of(9, 8, 7, 6))),
    }
    expect(await planeValues(await openDataset(omeZarrReader, gzip, '.zgroup'))).toEqual([
      9, 8, 7, 6,
    ])

    const zlib = {
      '.zgroup': text({ zarr_format: 2 }),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { compressor: { id: 'zlib', level: 1 } }),
      '0/0/0': new Uint8Array(deflateSync(Uint8Array.of(1, 2, 3, 4))),
    }
    expect(await planeValues(await openDataset(omeZarrReader, zlib, '.zgroup'))).toEqual([
      1, 2, 3, 4,
    ])

    const memcpy = {
      '.zgroup': text({ zarr_format: 2 }),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], {
        compressor: { id: 'blosc', cname: 'lz4', shuffle: 0 },
      }),
      '0/0/0': bloscMemcpy(Uint8Array.of(4, 3, 2, 1)),
    }
    expect(await planeValues(await openDataset(omeZarrReader, memcpy, '.zgroup'))).toEqual([
      4, 3, 2, 1,
    ])

    const lz4 = {
      '.zgroup': text({ zarr_format: 2 }),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { compressor: { id: 'blosc', cname: 'lz4' } }),
      '0/0/0': bloscLz4(Uint8Array.of(8, 7, 6, 5)),
    }
    expect(await planeValues(await openDataset(omeZarrReader, lz4, '.zgroup'))).toEqual([
      8, 7, 6, 5,
    ])
  })

  it('fills missing v2 chunks and rejects Blosc bitshuffle', async () => {
    const files = {
      '.zgroup': text({ zarr_format: 2 }),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { fill_value: 9 }),
    }
    expect(await planeValues(await openDataset(omeZarrReader, files, '.zgroup'))).toEqual([
      9, 9, 9, 9,
    ])

    const bitshuffle = bloscMemcpy(Uint8Array.of(1, 2, 3, 4))
    bitshuffle[2] = 0x04
    const rejected = {
      '.zgroup': text({ zarr_format: 2 }),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { compressor: { id: 'blosc' } }),
      '0/0/0': bitshuffle,
    }
    await expectCode(
      () => openDataset(omeZarrReader, rejected, '.zgroup').then((opened) => planeValues(opened)),
      'UNSUPPORTED_OPERATION',
    )
  })
})

const v3Group = (ome: Readonly<Record<string, unknown>>): Uint8Array =>
  text({
    zarr_format: 3,
    node_type: 'group',
    attributes: { ome: { version: '0.5', ...ome } },
  })

const tinyImage = (
  groupPath: string,
  pixels: Uint8Array,
  extras: Readonly<Record<string, unknown>> = {},
): Record<string, Uint8Array> => {
  const prefix = groupPath.length === 0 ? '' : `${groupPath}/`
  return {
    [`${prefix}zarr.json`]: groupMeta([{ path: '0', scale: [1, 1] }], extras),
    [`${prefix}0/zarr.json`]: arrayMeta([2, 2], [2, 2], bytesCodec),
    [`${prefix}0/c/0/0`]: pixels,
  }
}

describe('OME-Zarr labels and plates', () => {
  it('publishes a sibling labels group as a separate label dataset', async () => {
    const files = {
      ...tinyImage('', Uint8Array.of(1, 2, 3, 4)),
      'labels/zarr.json': v3Group({ labels: ['cell'] }),
      ...tinyImage('labels/cell', Uint8Array.of(0, 1, 1, 0), {
        'image-label': {
          colors: [{ 'label-value': 1, rgba: [255, 0, 0, 255] }],
          source: { image: '../../' },
        },
      }),
    }
    const document = await omeZarrReader.open(trackingContext(files).context)
    expect(document.datasets.map((entry) => entry.id)).toEqual(['image', 'labels/cell'])
    const label = await document.openDataset('labels/cell')
    expect(label.descriptor.metadata?.kind).toBe('label')
    expect(label.descriptor.metadata?.imageLabel).toMatchObject({
      sourceImage: '../../',
      colors: [{ value: 1, rgba: [255, 0, 0, 255] }],
    })
    expect(await planeValues(label)).toEqual([0, 1, 1, 0])
  })

  it('opens a plate of well fields and rejects traversal in well paths', async () => {
    const files = {
      'zarr.json': v3Group({
        plate: {
          name: 'demo-plate',
          rows: [{ name: 'A' }],
          columns: [{ name: '1' }, { name: '2' }],
          wells: [
            { path: 'A/1', rowIndex: 0, columnIndex: 0 },
            { path: 'A/2', rowIndex: 0, columnIndex: 1 },
          ],
        },
      }),
      'A/1/zarr.json': v3Group({ well: { images: [{ path: '0' }] } }),
      ...tinyImage('A/1/0', Uint8Array.of(1, 1, 1, 1)),
      'A/2/zarr.json': v3Group({ well: { images: [{ path: '0' }] } }),
      ...tinyImage('A/2/0', Uint8Array.of(2, 2, 2, 2)),
    }
    const probed = await omeZarrReader.probe(trackingContext(files).context)
    expect(probed.confidence).toBeGreaterThan(0.9)
    const document = await omeZarrReader.open(trackingContext(files).context)
    expect(document.metadata.plate).toMatchObject({ name: 'demo-plate', wellCount: 2 })
    expect(document.datasets.map((entry) => entry.id)).toEqual(['A/1/0', 'A/2/0'])
    const first = await document.openDataset('A/1/0')
    expect(first.descriptor.metadata?.well).toMatchObject({
      path: 'A/1',
      field: 'A/1/0',
      rowIndex: 0,
      columnIndex: 0,
    })
    expect(await planeValues(first)).toEqual([1, 1, 1, 1])
    expect(await planeValues(await document.openDataset('A/2/0'))).toEqual([2, 2, 2, 2])

    const hostile = {
      'zarr.json': v3Group({
        plate: { wells: [{ path: '../secret', rowIndex: 0, columnIndex: 0 }] },
      }),
    }
    await expectCode(() => omeZarrReader.open(trackingContext(hostile).context), 'INVALID_INPUT')
  })

  it('opens a v2 labels index and enforces maxDatasets', async () => {
    const files = {
      '.zgroup': text({ zarr_format: 2 }),
      '.zattrs': text({ labels: ['cell'] }),
      'cell/.zgroup': text({ zarr_format: 2 }),
      'cell/.zattrs': text({
        version: '0.4',
        'image-label': { colors: [{ 'label-value': 1, rgba: [0, 255, 0, 128] }] },
        multiscales: [
          {
            version: '0.4',
            name: 'cells',
            axes: [
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            datasets: [
              { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
            ],
          },
        ],
      }),
      'cell/0/.zarray': v2Array([2, 2], [2, 2]),
      'cell/0/0/0': Uint8Array.of(0, 1, 0, 1),
    }
    const document = await omeZarrReader.open(trackingContext(files, '.zattrs').context)
    expect(document.datasets.map((entry) => entry.id)).toEqual(['labels/cell'])
    expect(await planeValues(await document.openDataset('labels/cell'))).toEqual([0, 1, 0, 1])

    const imageAndLabel = {
      ...tinyImage('', Uint8Array.of(1, 2, 3, 4)),
      'labels/zarr.json': v3Group({ labels: ['cell'] }),
      ...tinyImage('labels/cell', Uint8Array.of(0, 1, 1, 0)),
    }
    await expectCode(
      () =>
        createOmeZarrReader({ limits: { maxDatasets: 1 } }).open(
          trackingContext(imageAndLabel).context,
        ),
      'LIMIT_EXCEEDED',
    )
  })
})

const zipArchive = (
  files: Readonly<Record<string, Uint8Array>>,
  method: 0 | 8 = 0,
): Uint8Array<ArrayBuffer> => {
  const names = Object.keys(files)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const name of names) {
    const value = files[name]
    if (value === undefined) continue
    const nameBytes = new TextEncoder().encode(name)
    const compressed = method === 0 ? value : Uint8Array.from(deflateRawSync(value))
    const checksum = crc32(value)
    const local = new Uint8Array(30 + nameBytes.byteLength + compressed.byteLength)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x0403_4b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(8, method, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, compressed.byteLength, true)
    localView.setUint32(22, value.byteLength, true)
    localView.setUint16(26, nameBytes.byteLength, true)
    local.set(nameBytes, 30)
    local.set(compressed, 30 + nameBytes.byteLength)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.byteLength)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x0201_4b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(10, method, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, compressed.byteLength, true)
    centralView.setUint32(24, value.byteLength, true)
    centralView.setUint16(28, nameBytes.byteLength, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)
    offset += local.byteLength
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.byteLength, 0)
  const output = new Uint8Array(offset + centralSize + 22)
  let cursor = 0
  for (const local of locals) {
    output.set(local, cursor)
    cursor += local.byteLength
  }
  const centralOffset = cursor
  for (const central of centrals) {
    output.set(central, cursor)
    cursor += central.byteLength
  }
  const view = new DataView(output.buffer)
  view.setUint32(cursor, 0x0605_4b50, true)
  view.setUint16(cursor + 8, names.length, true)
  view.setUint16(cursor + 10, names.length, true)
  view.setUint32(cursor + 12, centralSize, true)
  view.setUint32(cursor + 16, centralOffset, true)
  return output
}

const zipContext = (
  files: Readonly<Record<string, Uint8Array>>,
  name = 'image.ozx',
  method: 0 | 8 = 0,
): ScientificOpenContext =>
  Object.freeze({
    primary: resource(name, zipArchive(files, method)),
  })

describe('OME-Zarr ZIP store', () => {
  it('opens a stored .ozx archive without a companion resolver', async () => {
    const files = tinyImage('', Uint8Array.of(4, 5, 6, 7))
    const probed = await omeZarrReader.probe(zipContext(files))
    expect(probed.confidence).toBeGreaterThan(0.9)
    const document = await omeZarrReader.open(zipContext(files))
    expect(document.metadata.store).toBe('zip')
    expect(document.metadata.omeNgffVersion).toBe('0.5')
    expect(await planeValues(await document.openDataset('image'))).toEqual([4, 5, 6, 7])
  })

  it('opens deflated ZIP members and Node .ozx paths', async () => {
    const files = tinyImage('', Uint8Array.of(9, 8, 7, 6))
    const document = await omeZarrReader.open(zipContext(files, 'plate.zarr.zip', 8))
    expect(await planeValues(await document.openDataset('image'))).toEqual([9, 8, 7, 6])

    const root = await mkdtemp(join(tmpdir(), 'purejsimage-ome-zarr-zip-'))
    const path = join(root, 'demo.ozx')
    await writeFile(path, zipArchive(files))
    const fromDisk = await omeZarrReader.open(await createScientificPathContext(path))
    expect(fromDisk.metadata.store).toBe('zip')
    expect(await planeValues(await fromDisk.openDataset('image'))).toEqual([9, 8, 7, 6])
  })

  it('opens a v2 ZIP store and a browser File without companions', async () => {
    const files = {
      '.zgroup': text({ zarr_format: 2 }),
      '.zattrs': text({
        multiscales: [
          {
            version: '0.4',
            name: 'zipped',
            axes: [
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            datasets: [
              { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
            ],
          },
        ],
      }),
      '0/.zarray': text({
        zarr_format: 2,
        shape: [2, 2],
        chunks: [2, 2],
        dtype: '|u1',
        compressor: null,
        fill_value: 0,
        order: 'C',
        filters: null,
        dimension_separator: '/',
      }),
      '0/0/0': Uint8Array.of(3, 2, 1, 0),
    }
    const document = await omeZarrReader.open(zipContext(files, 'legacy.ozx'))
    expect(document.metadata.omeNgffVersion).toBe('0.4')
    expect(await planeValues(await document.openDataset('image'))).toEqual([3, 2, 1, 0])

    const browser = await omeZarrReader.open(
      createScientificFileContext(
        new File(
          [Uint8Array.from(zipArchive(tinyImage('', Uint8Array.of(1, 1, 1, 1))))],
          'image.ozx',
        ),
      ),
    )
    expect(browser.metadata.store).toBe('zip')
    expect(await planeValues(await browser.openDataset('image'))).toEqual([1, 1, 1, 1])
  })

  it('rejects nested-only metadata, non-Zarr ZIPs, and missing directory companions', async () => {
    const nestedOnly = {
      'nested/zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      'nested/0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
      'nested/0/c/0/0': Uint8Array.of(1, 2, 3, 4),
    }
    expect((await omeZarrReader.probe(zipContext(nestedOnly))).confidence).toBe(0)
    await expectCode(() => omeZarrReader.open(zipContext(nestedOnly)), 'INVALID_INPUT')

    const notZarr = zipContext({ 'main.xml': new TextEncoder().encode('<x3p/>') }, 'surface.x3p')
    expect((await omeZarrReader.probe(notZarr)).confidence).toBe(0)
    expect(
      (
        await omeZarrReader.probe(
          zipContext(tinyImage('', Uint8Array.of(1, 2, 3, 4)), 'surface.x3p'),
        )
      ).confidence,
    ).toBe(0)

    await expectCode(
      () =>
        omeZarrReader.open({
          primary: resource('zarr.json', groupMeta([{ path: '0', scale: [1, 1] }])),
        }),
      'INVALID_INPUT',
    )
  })
})
