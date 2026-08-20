import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
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
import { lastZarrReadSessionStats } from '../src/scientific/formats/zarr.ts'
import { createScientificPathContext } from '../src/scientific/node.ts'
import type {
  ScientificCompanionRequest,
  ScientificOpenContext,
  ScientificReader,
  ScientificResource,
} from '../src/scientific/reader.ts'
import { getScientificDatasetIdentity, ScientificReaderRegistry } from '../src/scientific/reader.ts'
import { createOmeZarrReader, omeZarrReader } from '../src/scientific/readers/ome-zarr.ts'
import { readRasterBigIntSample, readRasterSample } from '../src/scientific/samples.ts'
import { MemorySource } from '../src/source.ts'
import omeZarrCorpus from './fixtures/scientific-ome-zarr/corpus.json' with { type: 'json' }

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
  name = 'demo',
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
            name,
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

const defaultDimensionNames = (rank: number): readonly string[] | undefined => {
  if (rank === 2) return ['y', 'x']
  if (rank === 3) return ['c', 'y', 'x']
  if (rank === 4) return ['c', 'z', 'y', 'x']
  if (rank === 5) return ['t', 'c', 'z', 'y', 'x']
  return undefined
}

const arrayMeta = (
  shape: readonly number[],
  chunkShape: readonly number[],
  codecs: unknown,
  extras: Readonly<Record<string, unknown>> = {},
): Uint8Array => {
  const names =
    extras.dimension_names === undefined
      ? defaultDimensionNames(shape.length)
      : extras.dimension_names === null
        ? undefined
        : extras.dimension_names
  return text({
    zarr_format: 3,
    node_type: 'array',
    shape,
    data_type: extras.data_type ?? 'uint8',
    chunk_grid: { name: 'regular', configuration: { chunk_shape: chunkShape } },
    chunk_key_encoding: extras.chunk_key_encoding ?? {
      name: 'default',
      configuration: { separator: '/' },
    },
    fill_value: extras.fill_value === undefined ? 0 : extras.fill_value,
    codecs,
    ...(names === undefined ? {} : { dimension_names: names }),
    attributes: {},
  })
}

const bytesCodec = [{ name: 'bytes', configuration: { endian: 'little' } }]
const validOmeroWindow = { min: 0, max: 255, start: 0, end: 255 }

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
          channels: [{ label: 'DAPI', color: '0000FF', window: validOmeroWindow }],
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
    readonly fixedIndices?: readonly { readonly axisId: string; readonly index: number }[]
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
  const output = new Uint8Array(24 + compressed.byteLength)
  output[0] = 2
  output[1] = 1
  output[2] = 1 << 5
  output[3] = 1
  const view = new DataView(output.buffer)
  view.setInt32(4, payload.byteLength, true)
  view.setInt32(8, payload.byteLength, true)
  view.setInt32(12, output.byteLength, true)
  view.setInt32(16, 20, true)
  view.setInt32(20, compressed.byteLength, true)
  output.set(compressed, 24)
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
    const genericV2 = await omeZarrReader.probe(
      trackingContext({ '.zgroup': text({ zarr_format: 2 }) }, '.zgroup').context,
    )
    expect(genericV2.confidence).toBe(0)
  })

  it('opens a multiscale image with calibrated levels and selected chunk reads', async () => {
    const { context, resolved } = trackingContext(regularStore())
    const document = await omeZarrReader.open(context)
    expect(document.format).toBe('OME-Zarr')
    expect(document.metadata.omeNgffVersion).toBe('0.5')
    const dataset = await document.openDataset('image')
    expect(dataset.descriptor.metadata?.omeZarrLevels).toEqual([
      {
        level: 0,
        path: '0',
        shape: [8, 8],
        logicalChunkShape: [4, 4],
        storageChunkShape: [4, 4],
        sharded: false,
        codecs: ['bytes'],
      },
      {
        level: 1,
        path: '1',
        shape: [4, 4],
        logicalChunkShape: [4, 4],
        storageChunkShape: [4, 4],
        sharded: false,
        codecs: ['bytes'],
      },
    ])
    expect(dataset.descriptor.axes.map((axis) => axis.id)).toEqual(['y', 'x'])
    expect(dataset.descriptor.capabilities.resolutionLevels).toBe(true)
    const x = dataset.descriptor.axes.find((axis) => axis.id === 'x')
    expect(x?.unit).toBe('micrometer')
    expect(x?.coordinates).toEqual({ type: 'linear', origin: 0, step: 0.5 })
    expect(x?.calibration).toMatchObject({
      kind: 'embedded',
      resourceId: 'zarr.json',
      locator: 'ome:multiscales/0/axes/1',
    })
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

  it('treats an empty optional multiscale display name like an omitted name', async () => {
    const files = regularStore()
    files['zarr.json'] = groupMeta(
      [
        { path: '0', scale: [0.5, 0.5] },
        { path: '1', scale: [1, 1] },
      ],
      {},
      '',
    )
    const document = await omeZarrReader.open(trackingContext(files).context)
    expect(document.datasets[0]?.name).toBe('image')
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
    const shardedDataset = await openDataset(omeZarrReader, sharded)
    expect(shardedDataset.descriptor.metadata?.omeZarrLevels).toEqual([
      {
        level: 0,
        path: '0',
        shape: [4, 4],
        logicalChunkShape: [2, 2],
        storageChunkShape: [4, 4],
        sharded: true,
        codecs: ['sharding_indexed', 'bytes', 'crc32c'],
        shardIndexLocation: 'end',
      },
    ])
    expect(await planeValues(shardedDataset)).toEqual([...pixels])
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
    expect(fromDisk.descriptor.axes[1]?.calibration).toMatchObject({
      kind: 'embedded',
      resourceId: join(root, 'zarr.json'),
      locator: 'ome:multiscales/0/axes/1',
    })
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
    fill_value: extras.fill_value === undefined ? 0 : extras.fill_value,
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

  it('fills missing v2 chunks', async () => {
    const files = {
      '.zgroup': text({ zarr_format: 2 }),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { fill_value: 9 }),
    }
    expect(await planeValues(await openDataset(omeZarrReader, files, '.zgroup'))).toEqual([
      9, 9, 9, 9,
    ])
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
          version: '0.5',
          colors: [{ 'label-value': 1, rgba: [255, 0, 0, 255] }],
          properties: [
            { 'label-value': 0, class: 'background' },
            { 'label-value': 1, class: 'cell', area: 2 },
          ],
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
      version: '0.5',
      colors: [{ value: 1, rgba: [255, 0, 0, 255] }],
      properties: [
        { value: 0, metadata: { class: 'background' } },
        { value: 1, metadata: { class: 'cell', area: 2 } },
      ],
      source: { image: '../../', relation: 'derived-from', datasetId: 'image' },
    })
    expect(await planeValues(label)).toEqual([0, 1, 1, 0])
  })

  it('does not attribute an authored external label source to its containing image', async () => {
    const files = {
      ...tinyImage('', Uint8Array.of(1, 2, 3, 4)),
      'labels/zarr.json': v3Group({ labels: ['external'] }),
      ...tinyImage('labels/external', Uint8Array.of(0, 1, 1, 0), {
        'image-label': { version: '0.5', source: { image: '../../../reference-image' } },
      }),
    }
    const document = await omeZarrReader.open(trackingContext(files).context)
    const label = await document.openDataset('labels/external')
    expect(label.descriptor.metadata?.imageLabel).toMatchObject({
      source: { image: '../../../reference-image', relation: 'derived-from' },
    })
    expect(label.descriptor.metadata?.imageLabel).not.toMatchObject({
      source: { datasetId: 'image' },
    })
  })

  it('preserves complete OMERO display state and exact signed int64 label samples', async () => {
    const omeroStore = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }], {
        omero: {
          channels: [
            {
              active: false,
              coefficient: 0.75,
              color: '12ABEF',
              family: 'linear',
              inverted: true,
              label: 'Nuclei',
              window: { min: -10, max: 500, start: 12, end: 240 },
            },
          ],
          rdefs: { defaultT: 0, defaultZ: 0, model: 'greyscale' },
        },
      }),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
      '0/c/0/0': Uint8Array.of(1, 2, 3, 4),
    }
    const displayed = await openDataset(omeZarrReader, omeroStore)
    expect(displayed.descriptor.metadata?.omeZarrDisplay).toEqual({
      channels: [
        {
          active: false,
          coefficient: 0.75,
          color: 0x12_ab_ef,
          family: 'linear',
          inverted: true,
          label: 'Nuclei',
          window: { min: -10, max: 500, start: 12, end: 240 },
        },
      ],
      rdefs: { defaultT: 0, defaultZ: 0, model: 'greyscale' },
    })

    const signed = new Uint8Array(16)
    const signedView = new DataView(signed.buffer)
    signedView.setBigInt64(0, -9_007_199_254_740_993n, true)
    signedView.setBigInt64(8, 9_007_199_254_740_993n, true)
    const int64Store = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([1, 2], [1, 2], bytesCodec, { data_type: 'int64' }),
      '0/c/0/0': signed,
    }
    const int64 = await openDataset(omeZarrReader, int64Store)
    expect(int64.descriptor.sampleType).toBe('int64')
    const values: bigint[] = []
    for await (const block of int64.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
    })) {
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      values.push(readRasterBigIntSample(view, 0, 'int64'))
      values.push(readRasterBigIntSample(view, 8, 'int64'))
      expect(() => readRasterSample(block.data, view, 0, 'int64')).toThrow('exact numeric')
    }
    expect(values).toEqual([-9_007_199_254_740_993n, 9_007_199_254_740_993n])
  })

  it('rejects a sibling label pyramid with a different level count', async () => {
    const files = {
      'zarr.json': groupMeta([
        { path: '0', scale: [1, 1] },
        { path: '1', scale: [2, 2] },
      ]),
      '0/zarr.json': arrayMeta([4, 4], [2, 2], bytesCodec),
      '1/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
      'labels/zarr.json': v3Group({ labels: ['cell'] }),
      ...tinyImage('labels/cell', Uint8Array.of(0, 1, 1, 0), {
        'image-label': { version: '0.5' },
      }),
    }
    await expect(omeZarrReader.open(trackingContext(files).context)).rejects.toThrow(
      'label pyramid has 1 levels',
    )
  })

  it('opens a plate of well fields and rejects traversal in well paths', async () => {
    const files = {
      'zarr.json': v3Group({
        plate: {
          name: 'demo-plate',
          version: '0.5',
          field_count: 2,
          acquisitions: [
            {
              id: 7,
              name: 'baseline',
              maximumfieldcount: 2,
              description: 'Initial scan',
              starttime: 100,
              endtime: 200,
            },
          ],
          rows: [{ name: 'A' }],
          columns: [{ name: '1' }, { name: '2' }],
          wells: [
            { path: 'A/1', rowIndex: 0, columnIndex: 0 },
            { path: 'A/2', rowIndex: 0, columnIndex: 1 },
          ],
        },
      }),
      'A/1/zarr.json': v3Group({
        well: { version: '0.5', images: [{ path: '0', acquisition: 7 }] },
      }),
      ...tinyImage('A/1/0', Uint8Array.of(1, 1, 1, 1)),
      'A/2/zarr.json': v3Group({
        well: { version: '0.5', images: [{ path: '0', acquisition: 7 }] },
      }),
      ...tinyImage('A/2/0', Uint8Array.of(2, 2, 2, 2)),
    }
    const probed = await omeZarrReader.probe(trackingContext(files).context)
    expect(probed.confidence).toBeGreaterThan(0.9)
    const document = await omeZarrReader.open(trackingContext(files).context)
    expect(document.metadata.plate).toMatchObject({
      name: 'demo-plate',
      version: '0.5',
      fieldCount: 2,
      rows: ['A'],
      columns: ['1', '2'],
      wellCount: 2,
      acquisitions: [
        {
          id: 7,
          name: 'baseline',
          maximumFieldCount: 2,
          description: 'Initial scan',
          startTime: 100,
          endTime: 200,
        },
      ],
    })
    expect(document.datasets.map((entry) => entry.id)).toEqual(['A/1/0', 'A/2/0'])
    const first = await document.openDataset('A/1/0')
    expect(first.descriptor.metadata?.well).toMatchObject({
      path: 'A/1',
      field: 'A/1/0',
      rowIndex: 0,
      columnIndex: 0,
      version: '0.5',
      acquisition: 7,
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
    expect(probed.confidence).toBeGreaterThan(0.8)
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

  it('opens a single nested ZIP store and rejects ambiguous or non-Zarr ZIPs', async () => {
    const nestedOnly = {
      'nested/zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      'nested/0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
      'nested/0/c/0/0': Uint8Array.of(1, 2, 3, 4),
    }
    expect((await omeZarrReader.probe(zipContext(nestedOnly))).confidence).toBeGreaterThan(0.8)
    expect(
      await planeValues(
        await omeZarrReader.open(zipContext(nestedOnly)).then((doc) => doc.openDataset('image')),
      ),
    ).toEqual([1, 2, 3, 4])

    const ambiguous = {
      'a.zarr/zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      'b.zarr/zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
    }
    expect((await omeZarrReader.probe(zipContext(ambiguous))).confidence).toBeGreaterThan(0.8)
    await expectCode(() => omeZarrReader.open(zipContext(ambiguous)), 'INVALID_INPUT')

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

    const zarrNamed = zipContext(nestedOnly, 'image.ome.zarr')
    expect((await omeZarrReader.probe(zarrNamed)).confidence).toBeGreaterThan(0.8)
    expect(
      await planeValues(
        await omeZarrReader.open(zarrNamed).then((doc) => doc.openDataset('image')),
      ),
    ).toEqual([1, 2, 3, 4])

    const macosSidecar = {
      ...nestedOnly,
      '__MACOSX/nested/zarr.json': text({ zarr_format: 3, node_type: 'group', attributes: {} }),
      '__MACOSX/._nested': Uint8Array.of(0, 5, 0x16, 7),
    }
    expect(
      (await omeZarrReader.probe(zipContext(macosSidecar, 'image.zarr'))).confidence,
    ).toBeGreaterThan(0.8)
    expect(
      await planeValues(
        await omeZarrReader
          .open(zipContext(macosSidecar, 'image.zarr'))
          .then((doc) => doc.openDataset('image')),
      ),
    ).toEqual([1, 2, 3, 4])
  })
})

const u16le = (values: readonly number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  for (const [index, value] of values.entries()) view.setUint16(index * 2, value, true)
  return bytes
}

const f32le = (values: readonly number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  for (const [index, value] of values.entries()) view.setFloat32(index * 4, value, true)
  return bytes
}

describe('OME-Zarr edge cases', () => {
  it('decodes partial last chunks, uint16 samples, and a non-zero fill', async () => {
    const pixels = [
      0, 1, 2, 3, 4, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 30, 31, 32, 33, 34, 40, 41, 42, 43, 44,
    ]
    const files = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([5, 5], [4, 4], bytesCodec, { data_type: 'uint16', fill_value: 9 }),
      '0/c/0/0': u16le([0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33]),
      '0/c/0/1': u16le([4, 14, 24, 34]),
      '0/c/1/0': u16le([40, 41, 42, 43]),
      '0/c/1/1': u16le([44]),
    }
    const dataset = await openDataset(omeZarrReader, files)
    expect(dataset.descriptor.sampleType).toBe('uint16')
    expect(await planeValues(dataset, { width: 5, height: 5 })).toEqual(pixels)

    const { '0/c/1/1': _unusedCorner, ...missing } = files
    expect(
      await planeValues(await openDataset(omeZarrReader, missing), {
        x: 4,
        y: 4,
        width: 1,
        height: 1,
      }),
    ).toEqual([9])
  })

  it('decodes float32, v2 dot-separated keys, and index-at-start shards', async () => {
    const floats = [1.5, 2.5, 3.5, 4.5]
    const floatStore = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [2, 2],
        [2, 2],
        [{ name: 'bytes', configuration: { endian: 'little' } }],
        { data_type: 'float32' },
      ),
      '0/c/0/0': f32le(floats),
    }
    expect(await planeValues(await openDataset(omeZarrReader, floatStore))).toEqual(floats)

    const dotted = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { dimension_separator: '.' }),
      '0/0.0': Uint8Array.of(8, 7, 6, 5),
    }
    expect(await planeValues(await openDataset(omeZarrReader, dotted, '.zgroup'))).toEqual([
      8, 7, 6, 5,
    ])

    const inner = [
      chunkOf(raster(4, 4), 4, 4, 0, 0, 2, 2),
      chunkOf(raster(4, 4), 4, 4, 0, 2, 2, 2),
      chunkOf(raster(4, 4), 4, 4, 2, 0, 2, 2),
      chunkOf(raster(4, 4), 4, 4, 2, 2, 2, 2),
    ]
    const index = new Uint8Array(64)
    const indexView = new DataView(index.buffer)
    let offset = 68
    for (const [entry, chunk] of inner.entries()) {
      indexView.setUint32(entry * 16, offset, true)
      indexView.setUint32(entry * 16 + 8, chunk.byteLength, true)
      offset += chunk.byteLength
    }
    const shard = new Uint8Array(offset)
    shard.set(appendCrc32c(index), 0)
    let cursor = 68
    for (const chunk of inner) {
      shard.set(chunk, cursor)
      cursor += chunk.byteLength
    }
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
              index_location: 'start',
            },
          },
        ],
      ),
      '0/c/0/0': shard,
    }
    expect(await planeValues(await openDataset(omeZarrReader, sharded))).toEqual([...raster(4, 4)])
  })

  it('reads a 4D plane, rejects NGFF 0.2, supports int64, and verifies a corrupt shard index', async () => {
    const volume = {
      'zarr.json': text({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                name: 'stack',
                axes: [
                  { name: 'c', type: 'channel' },
                  { name: 'z', type: 'space' },
                  { name: 'y', type: 'space' },
                  { name: 'x', type: 'space' },
                ],
                datasets: [
                  {
                    path: '0',
                    coordinateTransformations: [{ type: 'scale', scale: [1, 1, 1, 1] }],
                  },
                ],
              },
            ],
            omero: {
              channels: [
                { label: 'DAPI', color: '00FF00', window: validOmeroWindow },
                { label: 'GFP', color: '0000FF', window: validOmeroWindow },
              ],
            },
          },
        },
      }),
      '0/zarr.json': arrayMeta([2, 3, 2, 2], [2, 3, 2, 2], bytesCodec),
      '0/c/0/0/0/0': Uint8Array.from({ length: 24 }, (_, index) => index + 1),
    }
    const dataset = await openDataset(omeZarrReader, volume)
    expect(dataset.descriptor.axes.map((axis) => axis.id)).toEqual(['c', 'z', 'y', 'x'])
    expect(dataset.descriptor.axes[0]?.entries?.[0]).toMatchObject({
      name: 'DAPI',
      color: 0x00ff00,
    })
    expect(
      await planeValues(dataset, {
        width: 2,
        height: 2,
        fixedIndices: [
          { axisId: 'c', index: 1 },
          { axisId: 'z', index: 2 },
        ],
      }),
    ).toEqual([21, 22, 23, 24])

    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext(
            {
              '.zgroup': v2Group(),
              '.zattrs': text({
                multiscales: [{ version: '0.2', datasets: [{ path: '0' }] }],
              }),
            },
            '.zattrs',
          ).context,
        ),
      'UNSUPPORTED_OPERATION',
    )
    const int64 = regularStore()
    int64['0/zarr.json'] = arrayMeta([8, 8], [8, 8], bytesCodec, { data_type: 'int64' })
    int64['1/zarr.json'] = arrayMeta([4, 4], [4, 4], bytesCodec, { data_type: 'int64' })
    expect((await openDataset(omeZarrReader, int64)).descriptor.sampleType).toBe('int64')

    const bad = regularStore()
    const index = new Uint8Array(68)
    index.fill(0xff)
    index[67] = (index[67] ?? 0) ^ 1
    bad['0/zarr.json'] = arrayMeta(
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
    )
    bad['0/c/0/0'] = index
    await expectCode(
      () =>
        openDataset(omeZarrReader, bad).then((opened) =>
          planeValues(opened, { width: 2, height: 2 }),
        ),
      'INVALID_INPUT',
    )
  })

  it('defaults omitted v3 chunk keys and accepts string, hex, and null fills', async () => {
    const omittedKey = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': text({
        zarr_format: 3,
        node_type: 'array',
        shape: [2, 2],
        data_type: 'uint8',
        chunk_grid: { name: 'regular', configuration: { chunk_shape: [2, 2] } },
        fill_value: 0,
        codecs: bytesCodec,
        dimension_names: ['y', 'x'],
        attributes: {},
      }),
      '0/c/0/0': Uint8Array.of(1, 2, 3, 4),
    }
    expect(await planeValues(await openDataset(omeZarrReader, omittedKey))).toEqual([1, 2, 3, 4])

    const stringFill = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { fill_value: '9' }),
    }
    expect(await planeValues(await openDataset(omeZarrReader, stringFill, '.zgroup'))).toEqual([
      9, 9, 9, 9,
    ])

    const hexFill = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { dtype: '<u2', fill_value: '0x0009' }),
    }
    expect(await planeValues(await openDataset(omeZarrReader, hexFill, '.zgroup'))).toEqual([
      9, 9, 9, 9,
    ])

    const v3String = regularStore()
    v3String['0/zarr.json'] = arrayMeta([8, 8], [8, 8], bytesCodec, { fill_value: '9' })
    await expectCode(() => openDataset(omeZarrReader, v3String), 'INVALID_INPUT')

    const nullInt = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': text({
        zarr_format: 2,
        shape: [2, 2],
        chunks: [2, 2],
        dtype: '|u1',
        compressor: null,
        fill_value: null,
        order: 'C',
        filters: null,
        dimension_separator: '/',
      }),
      '0/0/0': Uint8Array.of(1, 2, 3, 4),
    }
    expect(await planeValues(await openDataset(omeZarrReader, nullInt, '.zgroup'))).toEqual([
      1, 2, 3, 4,
    ])

    const omittedV2Fill = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': text({
        zarr_format: 2,
        shape: [2, 2],
        chunks: [2, 2],
        dtype: '|u1',
        compressor: null,
        order: 'C',
        filters: null,
        dimension_separator: '/',
      }),
      '0/0/0': Uint8Array.of(4, 3, 2, 1),
    }
    expect(await planeValues(await openDataset(omeZarrReader, omittedV2Fill, '.zgroup'))).toEqual([
      4, 3, 2, 1,
    ])

    const nanFill = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': text({
        zarr_format: 3,
        node_type: 'array',
        shape: [2, 2],
        data_type: 'float32',
        chunk_grid: { name: 'regular', configuration: { chunk_shape: [2, 2] } },
        chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
        fill_value: 'NaN',
        codecs: bytesCodec,
        dimension_names: ['y', 'x'],
        attributes: {},
      }),
    }
    const nanDataset = await openDataset(omeZarrReader, nanFill)
    expect(nanDataset.descriptor.noDataValue).toBeUndefined()
    expect(nanDataset.descriptor.metadata?.zarrFill).toMatchObject({
      kind: 'defined',
      value: 'NaN',
    })
    const nanValues = await planeValues(nanDataset)
    expect(nanValues).toHaveLength(4)
    expect(nanValues.every((value) => Number.isNaN(value))).toBe(true)

    const infinityInt = regularStore()
    infinityInt['0/zarr.json'] = arrayMeta([8, 8], [8, 8], bytesCodec, { fill_value: 'Infinity' })
    await expectCode(() => openDataset(omeZarrReader, infinityInt), 'INVALID_INPUT')

    const fractional = regularStore()
    fractional['0/zarr.json'] = arrayMeta([8, 8], [8, 8], bytesCodec, {
      data_type: 'uint64',
      fill_value: 1.5,
    })
    await expectCode(() => openDataset(omeZarrReader, fractional), 'INVALID_INPUT')
  })

  it('decodes F-order edge chunks, big-endian samples, shuffle, and OMERO colors', async () => {
    const clipped = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([3, 2], [2, 2], { order: 'F', dimension_separator: '/' }),
      '0/0/0': Uint8Array.of(1, 3, 2, 4),
      '0/1/0': Uint8Array.of(5, 6),
    }
    expect(await planeValues(await openDataset(omeZarrReader, clipped, '.zgroup'))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])

    const padded = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([3, 2], [2, 2], { order: 'F', dimension_separator: '/' }),
      '0/0/0': Uint8Array.of(1, 3, 2, 4),
      '0/1/0': Uint8Array.of(5, 0, 6, 0),
    }
    expect(await planeValues(await openDataset(omeZarrReader, padded, '.zgroup'))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])

    const big = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [2, 2],
        [2, 2],
        [{ name: 'bytes', configuration: { endian: 'big' } }],
        { data_type: 'uint16' },
      ),
      '0/c/0/0': Uint8Array.of(0, 1, 0, 2, 0, 3, 0, 4),
    }
    expect(await planeValues(await openDataset(omeZarrReader, big))).toEqual([1, 2, 3, 4])

    const shuffled = u16le([1, 2, 3, 4])
    const elements = 4
    const encoded = new Uint8Array(8)
    for (let byte = 0; byte < 2; byte += 1) {
      for (let element = 0; element < elements; element += 1) {
        encoded[byte * elements + element] = shuffled[element * 2 + byte] ?? 0
      }
    }
    const shuffleStore = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], {
        dtype: '<u2',
        filters: [{ id: 'shuffle', elementsize: 2 }],
      }),
      '0/0/0': encoded,
    }
    expect(await planeValues(await openDataset(omeZarrReader, shuffleStore, '.zgroup'))).toEqual([
      1, 2, 3, 4,
    ])

    const colored = {
      'zarr.json': text({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                name: 'stack',
                axes: [
                  { name: 'c', type: 'channel' },
                  { name: 'y', type: 'space' },
                  { name: 'x', type: 'space' },
                ],
                datasets: [
                  { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1, 1] }] },
                ],
              },
            ],
            omero: {
              channels: [{ label: 'DAPI', color: '0000FF', window: validOmeroWindow }],
            },
          },
        },
      }),
      '0/zarr.json': arrayMeta([1, 2, 2], [1, 2, 2], bytesCodec),
      '0/c/0/0/0': Uint8Array.of(1, 2, 3, 4),
    }
    const dataset = await openDataset(omeZarrReader, colored)
    expect(dataset.descriptor.axes[0]?.entries?.[0]).toMatchObject({
      name: 'DAPI',
      color: 0x00_00ff,
    })
  })

  it('rejects a zero-size shard payload and overlapping shard indexes', async () => {
    const emptyIndex = new Uint8Array(16)
    const emptyShard = appendCrc32c(emptyIndex)
    const empty = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [2, 2],
        [2, 2],
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
        { fill_value: 7 },
      ),
      '0/c/0/0': emptyShard,
    }
    await expectCode(
      () => openDataset(omeZarrReader, empty).then((opened) => planeValues(opened)),
      'INVALID_INPUT',
    )

    const overlapIndex = new Uint8Array(16)
    const overlapView = new DataView(overlapIndex.buffer)
    overlapView.setUint32(0, 4, true)
    overlapView.setUint32(8, 4, true)
    const overlapShard = new Uint8Array(24)
    overlapShard.set(Uint8Array.of(1, 2, 3, 4), 0)
    overlapShard.set(appendCrc32c(overlapIndex), 4)
    const overlap = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [2, 2],
        [2, 2],
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
      '0/c/0/0': overlapShard,
    }
    await expectCode(
      () => openDataset(omeZarrReader, overlap).then((opened) => planeValues(opened)),
      'INVALID_INPUT',
    )
  })

  it('decodes big-endian shard indexes, v3 transpose, uint64, and UTF-8 BOM metadata', async () => {
    const beIndex = new Uint8Array(16)
    const beView = new DataView(beIndex.buffer)
    beView.setBigUint64(8, 4n, false)
    const beShard = new Uint8Array(24)
    beShard.set(Uint8Array.of(1, 2, 3, 4), 0)
    beShard.set(appendCrc32c(beIndex), 4)
    const sharded = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [2, 2],
        [2, 2],
        [
          {
            name: 'sharding_indexed',
            configuration: {
              chunk_shape: [2, 2],
              codecs: bytesCodec,
              index_codecs: [
                { name: 'bytes', configuration: { endian: 'big' } },
                { name: 'crc32c' },
              ],
              index_location: 'end',
            },
          },
        ],
      ),
      '0/c/0/0': beShard,
    }
    expect(await planeValues(await openDataset(omeZarrReader, sharded))).toEqual([1, 2, 3, 4])

    const transposed = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [2, 3],
        [2, 3],
        [
          { name: 'transpose', configuration: { order: [1, 0] } },
          { name: 'bytes', configuration: { endian: 'little' } },
        ],
      ),
      '0/c/0/0': Uint8Array.of(1, 4, 2, 5, 3, 6),
    }
    expect(await planeValues(await openDataset(omeZarrReader, transposed))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])

    const u64 = new Uint8Array(32)
    const u64View = new DataView(u64.buffer)
    for (const [index, value] of [1, 2, 3, 4].entries())
      u64View.setBigUint64(index * 8, BigInt(value), true)
    const uint64Store = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, { data_type: 'uint64' }),
      '0/c/0/0': u64,
    }
    expect(await planeValues(await openDataset(omeZarrReader, uint64Store))).toEqual([1, 2, 3, 4])

    const bom = regularStore()
    const root = bom['zarr.json']
    if (root === undefined) throw new Error('missing root')
    bom['zarr.json'] = Uint8Array.of(0xef, 0xbb, 0xbf, ...root)
    expect(
      await planeValues(await openDataset(omeZarrReader, bom), { width: 1, height: 1 }),
    ).toEqual([0])
  })

  it('rejects empty chunk objects and decodes F-order uint16 edge chunks', async () => {
    const emptyFile = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, { fill_value: 5 }),
      '0/c/0/0': new Uint8Array(0),
    }
    await expectCode(
      () => openDataset(omeZarrReader, emptyFile).then((opened) => planeValues(opened)),
      'INVALID_INPUT',
    )

    const fortran = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([3, 2], [2, 2], { dtype: '<u2', order: 'F', dimension_separator: '/' }),
      '0/0/0': u16le([1, 3, 2, 4]),
      '0/1/0': u16le([5, 6]),
    }
    expect(await planeValues(await openDataset(omeZarrReader, fortran, '.zgroup'))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])

    const translation = {
      'zarr.json': text({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                axes: [
                  { name: 'y', type: 'space', unit: 'micrometer' },
                  { name: 'x', type: 'space', unit: 'micrometer' },
                ],
                datasets: [
                  {
                    path: '0',
                    coordinateTransformations: [
                      { type: 'scale', scale: [2, 3] },
                      { type: 'translation', translation: [10, 20] },
                    ],
                  },
                ],
                coordinateTransformations: [{ type: 'scale', scale: [0.5, 0.5] }],
              },
            ],
          },
        },
      }),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
      '0/c/0/0': Uint8Array.of(1, 2, 3, 4),
    }
    const dataset = await openDataset(omeZarrReader, translation)
    expect(dataset.descriptor.axes.find((axis) => axis.id === 'y')?.coordinates).toEqual({
      type: 'linear',
      origin: 5,
      step: 1,
    })
    expect(dataset.descriptor.axes.find((axis) => axis.id === 'x')?.coordinates).toEqual({
      type: 'linear',
      origin: 10,
      step: 1.5,
    })
  })

  it('ignores empty .zattrs, trailing path slashes, bare u1 dtypes, and numcodecs names', async () => {
    const files = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0/', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { dtype: 'u1' }),
      '0/.zattrs': new Uint8Array(0),
      '0/0/0': Uint8Array.of(4, 3, 2, 1),
    }
    expect(await planeValues(await openDataset(omeZarrReader, files, '.zgroup'))).toEqual([
      4, 3, 2, 1,
    ])

    const prefixed = {
      'zarr.json': groupMeta([{ path: '0/', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [2, 2],
        [2, 2],
        ['bytes', { name: 'numcodecs.gzip', configuration: { level: 1 } }],
      ),
      '0/c/0/0': new Uint8Array(gzipSync(Uint8Array.of(9, 8, 7, 6))),
    }
    expect(await planeValues(await openDataset(omeZarrReader, prefixed))).toEqual([9, 8, 7, 6])
  })

  it('does not reject a clipped last chunk when the nominal chunk exceeds the decode budget', async () => {
    const files = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([5, 5], [4, 4], bytesCodec),
      '0/c/1/1': Uint8Array.of(44),
    }
    const dataset = await createOmeZarrReader({
      limits: { maxDecodedChunkBytes: 8 },
    }).open(trackingContext(files).context)
    expect(
      await planeValues(await dataset.openDataset('image'), {
        x: 4,
        y: 4,
        width: 1,
        height: 1,
      }),
    ).toEqual([44])
  })

  it('decodes signed samples, F-order volumes, crc32c chunks, and dotted default keys', async () => {
    const signed = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [2, 2],
        [2, 2],
        [{ name: 'bytes', configuration: { endian: 'little' } }],
        { data_type: 'int16', fill_value: -1 },
      ),
      '0/c/0/0': u16le([0xffff, 2, 0xfffe, 4]),
    }
    expect(await planeValues(await openDataset(omeZarrReader, signed))).toEqual([-1, 2, -2, 4])

    const fortran = Uint8Array.of(1, 5, 3, 7, 2, 6, 4, 8)
    const f3 = {
      '.zgroup': v2Group(),
      '.zattrs': text({
        multiscales: [
          {
            version: '0.4',
            name: 'vol',
            axes: [
              { name: 'z', type: 'space' },
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            datasets: [
              { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1, 1] }] },
            ],
          },
        ],
      }),
      '0/.zarray': v2Array([2, 2, 2], [2, 2, 2], { order: 'F', dimension_separator: '/' }),
      '0/0/0/0': fortran,
    }
    expect(
      await planeValues(await openDataset(omeZarrReader, f3, '.zgroup'), {
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'z', index: 1 }],
      }),
    ).toEqual([5, 6, 7, 8])

    const checksummed = appendCrc32c(Uint8Array.of(1, 2, 3, 4))
    const crcStore = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], [...bytesCodec, { name: 'crc32c' }]),
      '0/c/0/0': checksummed,
    }
    expect(await planeValues(await openDataset(omeZarrReader, crcStore))).toEqual([1, 2, 3, 4])

    const dotted = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, {
        chunk_key_encoding: { name: 'default', configuration: { separator: '.' } },
      }),
      '0/c.0.0': Uint8Array.of(8, 7, 6, 5),
    }
    expect(await planeValues(await openDataset(omeZarrReader, dotted))).toEqual([8, 7, 6, 5])

    const v2Keys = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, {
        chunk_key_encoding: { name: 'v2', configuration: { separator: '/' } },
      }),
      '0/0/0': Uint8Array.of(1, 1, 1, 1),
    }
    expect(await planeValues(await openDataset(omeZarrReader, v2Keys))).toEqual([1, 1, 1, 1])
  })

  it('accepts lowercase NaN fills, hash colors, gzip edge chunks, and multi-block Blosc', async () => {
    const nanFill = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [2, 2],
        [2, 2],
        [{ name: 'bytes', configuration: { endian: 'little' } }],
        { data_type: 'float32', fill_value: 'nan' },
      ),
    }
    const nanValues = await planeValues(await openDataset(omeZarrReader, nanFill))
    expect(nanValues.every((value) => Number.isNaN(value))).toBe(true)

    const colored = {
      'zarr.json': text({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                name: 'stack',
                axes: [
                  { name: 'c', type: 'channel' },
                  { name: 'y', type: 'space' },
                  { name: 'x', type: 'space' },
                ],
                datasets: [
                  { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1, 1] }] },
                ],
              },
            ],
            omero: {
              channels: [{ label: 'DAPI', color: '00FF00', window: validOmeroWindow }],
            },
          },
        },
      }),
      '0/zarr.json': arrayMeta([1, 2, 2], [1, 2, 2], bytesCodec),
      '0/c/0/0/0': Uint8Array.of(1, 2, 3, 4),
    }
    expect(
      (await openDataset(omeZarrReader, colored)).descriptor.axes[0]?.entries?.[0],
    ).toMatchObject({
      name: 'DAPI',
      color: 0x00_ff00,
    })

    const gzipEdge = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [3, 2],
        [2, 2],
        [
          { name: 'bytes', configuration: { endian: 'little' } },
          { name: 'gzip', configuration: { level: 1 } },
        ],
      ),
      '0/c/0/0': new Uint8Array(gzipSync(Uint8Array.of(1, 2, 3, 4))),
      '0/c/1/0': new Uint8Array(gzipSync(Uint8Array.of(5, 6))),
    }
    expect(await planeValues(await openDataset(omeZarrReader, gzipEdge))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])

    const twoBlocks = new Uint8Array(36)
    twoBlocks[0] = 2
    twoBlocks[1] = 1
    twoBlocks[2] = 1 << 5
    twoBlocks[3] = 1
    const blockView = new DataView(twoBlocks.buffer)
    blockView.setInt32(4, 4, true)
    blockView.setInt32(8, 2, true)
    blockView.setInt32(12, 36, true)
    blockView.setInt32(16, 24, true)
    blockView.setInt32(20, 30, true)
    blockView.setInt32(24, 2, true)
    twoBlocks[28] = 1
    twoBlocks[29] = 2
    blockView.setInt32(30, 2, true)
    twoBlocks[34] = 3
    twoBlocks[35] = 4
    const bloscStore = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { compressor: { id: 'blosc', cname: 'lz4' } }),
      '0/0/0': twoBlocks,
    }
    expect(await planeValues(await openDataset(omeZarrReader, bloscStore, '.zgroup'))).toEqual([
      1, 2, 3, 4,
    ])
  })

  it('opens bioformats2raw layout roots as consecutive series groups', async () => {
    const seriesAttrs = (name: string, pixels: Uint8Array): Record<string, Uint8Array> => ({
      [`${name}/.zgroup`]: v2Group(),
      [`${name}/.zattrs`]: text({
        multiscales: [
          {
            version: '0.4',
            name: `series-${name}`,
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
      [`${name}/0/.zarray`]: v2Array([2, 2], [2, 2]),
      [`${name}/0/0/0`]: pixels,
    })
    const files = {
      '.zgroup': v2Group(),
      '.zattrs': text({ 'bioformats2raw.layout': 3 }),
      ...seriesAttrs('0', Uint8Array.of(1, 2, 3, 4)),
      ...seriesAttrs('1', Uint8Array.of(5, 6, 7, 8)),
    }
    const probed = await omeZarrReader.probe(trackingContext(files, '.zattrs').context)
    expect(probed.confidence).toBeGreaterThan(0.85)
    const document = await omeZarrReader.open(trackingContext(files, '.zgroup').context)
    expect(document.metadata.bioformats2rawLayout).toBe(3)
    expect(document.metadata.seriesCount).toBe(2)
    expect(document.datasets.map((entry) => entry.id)).toEqual(['0', '1'])
    expect(await planeValues(await document.openDataset('0'))).toEqual([1, 2, 3, 4])
    expect(await planeValues(await document.openDataset('1'))).toEqual([5, 6, 7, 8])
  })

  it('discovers series without root .zattrs and does not count labels as series', async () => {
    const files = {
      '.zgroup': v2Group(),
      '0/.zgroup': v2Group(),
      '0/.zattrs': text({
        multiscales: [
          {
            version: '0.4',
            name: 'only',
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
      '0/0/.zarray': v2Array([2, 2], [2, 2]),
      '0/0/0/0': Uint8Array.of(9, 8, 7, 6),
      '0/labels/.zgroup': v2Group(),
      '0/labels/.zattrs': text({ labels: ['cell'] }),
      '0/labels/cell/.zgroup': v2Group(),
      '0/labels/cell/.zattrs': text({
        version: '0.4',
        'image-label': { colors: [{ 'label-value': 1, rgba: [0, 255, 0, 255] }] },
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
      '0/labels/cell/0/.zarray': v2Array([2, 2], [2, 2]),
      '0/labels/cell/0/0/0': Uint8Array.of(0, 1, 1, 0),
    }
    const document = await omeZarrReader.open(trackingContext(files, '.zgroup').context)
    expect(document.metadata.seriesCount).toBe(1)
    expect(document.metadata.bioformats2rawLayout).toBeUndefined()
    expect(document.datasets.map((entry) => entry.id)).toEqual(['0', '0/labels/cell'])
    expect(await planeValues(await document.openDataset('0'))).toEqual([9, 8, 7, 6])
    expect(await planeValues(await document.openDataset('0/labels/cell'))).toEqual([0, 1, 1, 0])

    const stringLayout = {
      '.zgroup': v2Group(),
      '.zattrs': text({ 'bioformats2raw.layout': '3' }),
      '0/.zgroup': v2Group(),
      '0/.zattrs': text({
        multiscales: [
          {
            version: '0.4',
            name: 's',
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
      '0/0/.zarray': v2Array([1, 1], [1, 1]),
      '0/0/0/0': Uint8Array.of(4),
    }
    const laidOut = await omeZarrReader.open(trackingContext(stringLayout, '.zattrs').context)
    expect(laidOut.metadata.bioformats2rawLayout).toBe(3)
    expect(await planeValues(await laidOut.openDataset('0'))).toEqual([4])

    const nestedV2 = {
      'stack.zarr/.zgroup': v2Group(),
      'stack.zarr/.zattrs': text({ 'bioformats2raw.layout': 3 }),
      'stack.zarr/0/.zgroup': v2Group(),
      'stack.zarr/0/.zattrs': text({
        multiscales: [
          {
            version: '0.4',
            name: 'nested',
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
      'stack.zarr/0/0/.zarray': v2Array([2, 2], [2, 2]),
      'stack.zarr/0/0/0/0': Uint8Array.of(1, 1, 1, 1),
    }
    const zipped = await omeZarrReader.open(zipContext(nestedV2, 'stack.zarr.zip'))
    expect(zipped.metadata.store).toBe('zip')
    expect(zipped.metadata.bioformats2rawLayout).toBe(3)
    expect(await planeValues(await zipped.openDataset('0'))).toEqual([1, 1, 1, 1])
  })

  it('keeps bioformats2raw series when the root also lists labels', async () => {
    const files = {
      '.zgroup': v2Group(),
      '.zattrs': text({
        'bioformats2raw.layout': 3,
        labels: ['cell'],
      }),
      '0/.zgroup': v2Group(),
      '0/.zattrs': text({
        multiscales: [
          {
            version: '0.4',
            name: 'series-0',
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
      '0/0/.zarray': v2Array([2, 2], [2, 2]),
      '0/0/0/0': Uint8Array.of(1, 2, 3, 4),
      'cell/.zgroup': v2Group(),
      'cell/.zattrs': text({
        version: '0.4',
        'image-label': { colors: [{ 'label-value': 1, rgba: [255, 0, 0, 255] }] },
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
      'cell/0/0/0': Uint8Array.of(0, 1, 1, 0),
    }
    const document = await omeZarrReader.open(trackingContext(files, '.zattrs').context)
    expect(document.metadata.seriesCount).toBe(1)
    expect(document.datasets.map((entry) => entry.id)).toContain('0')
    expect(await planeValues(await document.openDataset('0'))).toEqual([1, 2, 3, 4])
  })

  it('rejects a bioformats2raw root that exceeds maxDatasets', async () => {
    const files = {
      '.zgroup': v2Group(),
      '.zattrs': text({ 'bioformats2raw.layout': 3 }),
      '0/.zgroup': v2Group(),
      '0/.zattrs': text({
        multiscales: [
          {
            version: '0.4',
            name: 'a',
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
      '0/0/.zarray': v2Array([1, 1], [1, 1]),
      '0/0/0/0': Uint8Array.of(1),
      '1/.zgroup': v2Group(),
      '1/.zattrs': text({
        multiscales: [
          {
            version: '0.4',
            name: 'b',
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
      '1/0/.zarray': v2Array([1, 1], [1, 1]),
      '1/0/0/0': Uint8Array.of(2),
    }
    await expectCode(
      () =>
        createOmeZarrReader({ limits: { maxDatasets: 1 } }).open(
          trackingContext(files, '.zgroup').context,
        ),
      'LIMIT_EXCEEDED',
    )
  })

  it('opens a v3 bioformats2raw layout with two series', async () => {
    const series = (index: number, pixels: Uint8Array): Record<string, Uint8Array> => ({
      [`${index}/zarr.json`]: text({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                name: `s${index}`,
                axes: [
                  { name: 'y', type: 'space' },
                  { name: 'x', type: 'space' },
                ],
                datasets: [
                  { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
                ],
              },
            ],
          },
        },
      }),
      [`${index}/0/zarr.json`]: arrayMeta([2, 2], [2, 2], bytesCodec),
      [`${index}/0/c/0/0`]: pixels,
    })
    const files = {
      'zarr.json': text({
        zarr_format: 3,
        node_type: 'group',
        attributes: { ome: { version: '0.5', 'bioformats2raw.layout': 3 } },
      }),
      ...series(0, Uint8Array.of(1, 1, 1, 1)),
      ...series(1, Uint8Array.of(2, 2, 2, 2)),
    }
    const document = await omeZarrReader.open(trackingContext(files).context)
    expect(document.metadata.seriesCount).toBe(2)
    expect(document.datasets.map((entry) => entry.id)).toEqual(['0', '1'])
    const first = await document.openDataset('0')
    expect(first.descriptor.axes[0]?.kind).toBe('space')
    expect(await planeValues(first)).toEqual([1, 1, 1, 1])
    expect(await planeValues(await document.openDataset('1'))).toEqual([2, 2, 2, 2])
  })
})

const fixtureRoot = 'tests/fixtures/scientific-ome-zarr'

const collectStore = async (directory: string): Promise<Record<string, Uint8Array>> => {
  const files: Record<string, Uint8Array> = {}
  const walk = async (relative: string): Promise<void> => {
    const here = relative.length === 0 ? directory : join(directory, relative)
    for (const entry of await readdir(here, { withFileTypes: true })) {
      const child = relative.length === 0 ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) await walk(child)
      else files[child] = Uint8Array.from(await readFile(join(directory, child)))
    }
  }
  await walk('')
  return files
}

describe('OME-Zarr IDR 6001240 corpus', () => {
  it('keeps every pinned IDR slice checksum-stable', async () => {
    for (const file of omeZarrCorpus.files) {
      const bytes = Uint8Array.from(await readFile(join(fixtureRoot, file.localFile)))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
    }
  })

  it('cross-decodes the same coarsest 0.4 and 0.5 plane of IDR 6001240', async () => {
    const v4Files = await collectStore(join(fixtureRoot, 'idr0062-6001240-v0.4'))
    const v5Files = await collectStore(join(fixtureRoot, 'idr0062-6001240-v0.5'))
    const v4 = await omeZarrReader.open(trackingContext(v4Files, '.zgroup').context)
    const v5 = await omeZarrReader.open(trackingContext(v5Files).context)
    expect(v4.metadata.omeNgffVersion).toBe('0.4')
    expect(v5.metadata.omeNgffVersion).toBe('0.5')
    const v4Image = await v4.openDataset('image')
    const v5Image = await v5.openDataset('image')
    expect(v4Image.descriptor.sampleType).toBe('uint16')
    expect(v5Image.descriptor.sampleType).toBe('uint16')
    expect(v4Image.descriptor.axes.map((axis) => axis.id)).toEqual(['c', 'z', 'y', 'x'])
    expect(v4Image.descriptor.axes[0]?.entries?.[0]).toMatchObject({
      name: 'LaminB1',
      color: 0x00_00ff,
    })
    expect(v4Image.descriptor.levels[2]?.axisLengths).toEqual([
      { axisId: 'c', length: 2 },
      { axisId: 'z', length: 236 },
      { axisId: 'y', length: 68 },
      { axisId: 'x', length: 67 },
    ])
    const window = {
      resolutionLevel: 2,
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      fixedIndices: [
        { axisId: 'c', index: 0 },
        { axisId: 'z', index: 0 },
      ],
    }
    const fromV4 = await planeValues(v4Image, window)
    const fromV5 = await planeValues(v5Image, window)
    expect(fromV4).toEqual([28, 10, 10, 9])
    expect(fromV5).toEqual(fromV4)

    expect(v4.datasets.map((entry) => entry.id)).toEqual(['image', 'labels/0'])
    expect(v5.datasets.map((entry) => entry.id)).toEqual(['image', 'labels/0'])
    const v4Label = await v4.openDataset('labels/0')
    const v5Label = await v5.openDataset('labels/0')
    expect(v4Label.descriptor.sampleType).toBe('int8')
    expect(v5Label.descriptor.sampleType).toBe('int8')
    expect(v4Label.descriptor.metadata?.kind).toBe('label')
    expect(
      (v4Label.descriptor.metadata?.imageLabel as { sourceImage?: string } | undefined)
        ?.sourceImage,
    ).toBe('../..')
    expect(
      await planeValues(v4Label, {
        resolutionLevel: 3,
        x: 13,
        y: 10,
        width: 2,
        height: 2,
        fixedIndices: [
          { axisId: 'c', index: 0 },
          { axisId: 'z', index: 40 },
        ],
      }),
    ).toEqual([13, 13, 13, 13])
    expect(
      await planeValues(v5Label, {
        resolutionLevel: 2,
        x: 28,
        y: 20,
        width: 2,
        height: 2,
        fixedIndices: [
          { axisId: 'c', index: 0 },
          { axisId: 'z', index: 40 },
        ],
      }),
    ).toEqual([13, 13, 13, 13])
  })
})

describe('OME-Zarr IDR0033 bioformats2raw corpus', () => {
  it('discovers series 0 from a layout-only 0.5 root and decodes the coarsest plane', async () => {
    const files = await collectStore(join(fixtureRoot, 'idr0033-BR00109990-C2-v0.5'))
    const document = await omeZarrReader.open(trackingContext(files).context)
    expect(document.metadata.omeNgffVersion).toBe('0.5')
    expect(document.metadata.bioformats2rawLayout).toBe(3)
    expect(document.metadata.seriesCount).toBe(1)
    expect(document.datasets.map((entry) => entry.id)).toEqual(['0'])
    const dataset = await document.openDataset('0')
    expect(dataset.descriptor.sampleType).toBe('uint16')
    expect(dataset.descriptor.axes.map((axis) => axis.id)).toEqual(['c', 'y', 'x'])
    expect(dataset.descriptor.axes[0]?.entries?.map((entry) => entry.name)).toEqual([
      'Nuclei',
      'ER',
      'Nucleoli/Cytoplasmic RNA',
      'Actin/Golgi/Membrane',
      'Mitochondria',
    ])
    expect(dataset.descriptor.axes[0]?.entries?.[0]?.color).toBe(0x00_00ff)
    expect(dataset.descriptor.levels).toHaveLength(6)
    expect(dataset.descriptor.levels[5]?.axisLengths).toEqual([
      { axisId: 'c', length: 5 },
      { axisId: 'y', length: 48 },
      { axisId: 'x', length: 65 },
    ])
    const window = await planeValues(dataset, {
      resolutionLevel: 5,
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      fixedIndices: [{ axisId: 'c', index: 0 }],
    })
    expect(window).toEqual([517, 567, 638, 4709])

    const nested = Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [`BR00109990_C2.zarr/${name}`, bytes]),
    )
    const zipped = await omeZarrReader.open(zipContext(nested, 'idr0033.zarr.zip'))
    expect(zipped.metadata.store).toBe('zip')
    expect(zipped.metadata.bioformats2rawLayout).toBe(3)
    expect(
      await planeValues(await zipped.openDataset('0'), {
        resolutionLevel: 5,
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        fixedIndices: [{ axisId: 'c', index: 0 }],
      }),
    ).toEqual(window)
  })
})

describe('OME-Zarr additional IDR corpus', () => {
  it('opens an IDR0010 0.5 well root and decodes the coarsest sharded plane', async () => {
    const files = await collectStore(join(fixtureRoot, 'idr0010-76-45-well-A1-v0.5'))
    const document = await omeZarrReader.open(trackingContext(files).context)
    expect(document.metadata.omeNgffVersion).toBe('0.5')
    expect(document.datasets.map((entry) => entry.id)).toEqual(['0'])
    const dataset = await document.openDataset('0')
    expect(dataset.descriptor.sampleType).toBe('uint16')
    expect(dataset.descriptor.axes.map((axis) => axis.id)).toEqual(['t', 'c', 'z', 'y', 'x'])
    expect(dataset.descriptor.axes[1]?.entries?.map((entry) => entry.name)).toEqual([
      'Dapi',
      'Channel 1',
    ])
    expect(dataset.descriptor.metadata?.well).toMatchObject({ field: '0' })
    expect(
      await planeValues(dataset, {
        resolutionLevel: 2,
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        fixedIndices: [
          { axisId: 't', index: 0 },
          { axisId: 'c', index: 0 },
          { axisId: 'z', index: 0 },
        ],
      }),
    ).toEqual([72, 90, 105, 130])
  })

  it('opens an IDR0001 0.4 plate field and an IDR0101 translation image', async () => {
    const plate = await omeZarrReader.open(
      trackingContext(await collectStore(join(fixtureRoot, 'idr0001-2551-C3-0-v0.4')), '.zattrs')
        .context,
    )
    const field = await plate.openDataset('image')
    expect(field.descriptor.sampleType).toBe('uint16')
    expect(field.descriptor.axes.map((axis) => axis.id)).toEqual(['c', 'z', 'y', 'x'])
    expect(field.descriptor.axes[0]?.entries?.map((entry) => entry.name)).toEqual([
      'GFP',
      'Cascade blue',
    ])
    expect(
      await planeValues(field, {
        resolutionLevel: 4,
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        fixedIndices: [
          { axisId: 'c', index: 0 },
          { axisId: 'z', index: 0 },
        ],
      }),
    ).toEqual([52, 52, 56, 53])

    const translated = await omeZarrReader.open(
      trackingContext(await collectStore(join(fixtureRoot, 'idr0101-13457537-v0.4')), '.zattrs')
        .context,
    )
    const image = await translated.openDataset('image')
    const y = image.descriptor.axes.find((axis) => axis.id === 'y')
    expect(y?.coordinates).toEqual({ type: 'linear', origin: 52.109135, step: 0.108335 })
    expect(
      image.descriptor.levels[2]?.axisCoordinates?.find((entry) => entry.axisId === 'y'),
    ).toEqual({
      axisId: 'y',
      coordinates: { type: 'linear', origin: 52.109135, step: 0.43334 },
    })
    expect(
      await planeValues(image, {
        resolutionLevel: 2,
        x: 8,
        y: 0,
        width: 2,
        height: 2,
        fixedIndices: [
          { axisId: 't', index: 0 },
          { axisId: 'c', index: 0 },
          { axisId: 'z', index: 0 },
        ],
      }),
    ).toEqual([0, 0, 4, 0])
  })
})

const UINT64_SENTINEL = 0xffff_ffff_ffff_ffffn

const shardingCodec = (
  innerShape: readonly number[],
  extras: {
    readonly codecs?: unknown
    readonly indexCodecs?: unknown
  } = {},
): unknown[] => [
  {
    name: 'sharding_indexed',
    configuration: {
      chunk_shape: innerShape,
      codecs: extras.codecs ?? bytesCodec,
      index_codecs: extras.indexCodecs ?? [...bytesCodec, { name: 'crc32c' }],
      index_location: 'end',
    },
  },
]

const shardFromEntries = (
  entries: readonly (
    | { readonly kind: 'payload'; readonly bytes: Uint8Array }
    | { readonly kind: 'fill' }
    | { readonly kind: 'fields'; readonly offset: bigint; readonly length: bigint }
  )[],
): Uint8Array => {
  const index = new Uint8Array(entries.length * 16)
  const indexView = new DataView(index.buffer)
  const payloads: Uint8Array[] = []
  let offset = 0
  for (const [indexEntry, entry] of entries.entries()) {
    if (entry.kind === 'fill') {
      indexView.setBigUint64(indexEntry * 16, UINT64_SENTINEL, true)
      indexView.setBigUint64(indexEntry * 16 + 8, UINT64_SENTINEL, true)
    } else if (entry.kind === 'fields') {
      indexView.setBigUint64(indexEntry * 16, entry.offset, true)
      indexView.setBigUint64(indexEntry * 16 + 8, entry.length, true)
    } else {
      indexView.setBigUint64(indexEntry * 16, BigInt(offset), true)
      indexView.setBigUint64(indexEntry * 16 + 8, BigInt(entry.bytes.byteLength), true)
      payloads.push(entry.bytes)
      offset += entry.bytes.byteLength
    }
  }
  const encodedIndex = appendCrc32c(index)
  const shard = new Uint8Array(offset + encodedIndex.byteLength)
  let cursor = 0
  for (const payload of payloads) {
    shard.set(payload, cursor)
    cursor += payload.byteLength
  }
  shard.set(encodedIndex, offset)
  return shard
}

const readTrackingContext = (
  files: Readonly<Record<string, Uint8Array>>,
  primaryName = 'zarr.json',
): {
  readonly context: ScientificOpenContext
  readonly resolved: string[]
  readonly reads: { readonly name: string; readonly offset: number; readonly length: number }[]
} => {
  const reads: { name: string; offset: number; length: number }[] = []
  const resolved: string[] = []
  const primary = files[primaryName]
  if (primary === undefined) throw new Error(`Test store is missing ${primaryName}`)
  const wrap = (name: string, bytes: Uint8Array): ScientificResource =>
    Object.freeze({
      id: name,
      name,
      source: {
        size: bytes.byteLength,
        async read(offset: number, length: number) {
          const available =
            offset >= bytes.byteLength ? 0 : Math.min(length, bytes.byteLength - offset)
          reads.push({ name, offset, length: available })
          return bytes.subarray(offset, offset + available)
        },
      },
    })
  return {
    reads,
    resolved,
    context: {
      primary: wrap(primaryName, primary),
      companions: {
        async resolve(request: Readonly<ScientificCompanionRequest>) {
          const name = request.kind === 'relative-name' ? request.name : request.relativeName
          if (name === undefined) return undefined
          resolved.push(name)
          const bytes = files[name]
          return bytes === undefined ? undefined : wrap(name, bytes)
        },
      },
    },
  }
}

const unreadSource = (
  size: number,
): { readonly source: ScientificResource['source']; readonly reads: number } => {
  const state = { reads: 0 }
  return {
    get reads() {
      return state.reads
    },
    source: {
      size,
      async read() {
        state.reads += 1
        return new Uint8Array(0)
      },
    },
  }
}

describe('OME-Zarr PR 24 correctness', () => {
  it('packs any-axis-pair planes into destination row order', async () => {
    const files = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 3], [2, 3], bytesCodec),
      '0/c/0/0': Uint8Array.of(1, 2, 3, 4, 5, 6),
    }
    const dataset = await openDataset(omeZarrReader, files)
    expect(await planeValues(dataset, { displayAxes: ['x', 'y'] })).toEqual([1, 2, 3, 4, 5, 6])

    const transposed: { width: number; height: number; stride: number; values: number[] }[] = []
    for await (const block of dataset.readPlane({
      displayAxes: ['y', 'x'],
      fixedIndices: [],
    })) {
      transposed.push({
        width: block.width,
        height: block.height,
        stride: block.stride,
        values: [...block.data],
      })
    }
    expect(transposed).toEqual([{ width: 2, height: 3, stride: 2, values: [1, 4, 2, 5, 3, 6] }])

    const volume = {
      'zarr.json': text({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                name: 'vol',
                axes: [
                  { name: 'c', type: 'channel' },
                  { name: 'y', type: 'space' },
                  { name: 'x', type: 'space' },
                ],
                datasets: [
                  { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1, 1] }] },
                ],
              },
            ],
          },
        },
      }),
      '0/zarr.json': arrayMeta([2, 2, 3], [2, 2, 3], bytesCodec, {
        dimension_names: ['c', 'y', 'x'],
      }),
      '0/c/0/0/0': Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
    }
    const stacked = await openDataset(omeZarrReader, volume)
    expect(
      await planeValues(stacked, {
        displayAxes: ['c', 'x'],
        fixedIndices: [{ axisId: 'y', index: 0 }],
      }),
    ).toEqual([1, 7, 2, 8, 3, 9])

    const blocked = await createOmeZarrReader({ limits: { rowsPerBlock: 1 } }).open(
      trackingContext(files).context,
    )
    const pieces: { x: number; y: number; width: number; height: number; values: number[] }[] = []
    for await (const block of (await blocked.openDataset('image')).readPlane({
      displayAxes: ['y', 'x'],
      fixedIndices: [],
    })) {
      pieces.push({
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        values: [...block.data],
      })
    }
    expect(pieces).toEqual([
      { x: 0, y: 0, width: 2, height: 1, values: [1, 4] },
      { x: 0, y: 1, width: 2, height: 1, values: [2, 5] },
      { x: 0, y: 2, width: 2, height: 1, values: [3, 6] },
    ])
  })

  it('rejects integer fills outside the exact sample range and keeps representable no-data', async () => {
    const rejectFill = async (
      extras: Readonly<Record<string, unknown>>,
      code: ImageError['code'] = 'INVALID_INPUT',
    ): Promise<void> => {
      const files = {
        'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
        '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, extras),
      }
      await expectCode(() => openDataset(omeZarrReader, files), code)
    }

    await rejectFill({ data_type: 'uint8', fill_value: -1 })
    await rejectFill({ data_type: 'uint8', fill_value: 256 })
    await rejectFill({ data_type: 'uint8', fill_value: 300 })
    await rejectFill({ data_type: 'uint8', fill_value: '0x1ff' })
    await rejectFill({ data_type: 'int8', fill_value: -129 })
    await rejectFill({ data_type: 'int8', fill_value: 128 })
    await rejectFill({ data_type: 'uint16', fill_value: 65_536 })
    await rejectFill({ data_type: 'uint64', fill_value: Number.MAX_SAFE_INTEGER + 1 })

    const boundaries: readonly {
      readonly data_type: string
      readonly fill_value: number | string
      readonly expected: number
    }[] = [
      { data_type: 'uint8', fill_value: 0, expected: 0 },
      { data_type: 'uint8', fill_value: 255, expected: 255 },
      { data_type: 'int8', fill_value: -128, expected: -128 },
      { data_type: 'int8', fill_value: 127, expected: 127 },
      { data_type: 'uint16', fill_value: 0, expected: 0 },
      { data_type: 'uint16', fill_value: 65_535, expected: 65_535 },
      { data_type: 'int16', fill_value: -32_768, expected: -32_768 },
      { data_type: 'int16', fill_value: 32_767, expected: 32_767 },
      { data_type: 'uint32', fill_value: 0, expected: 0 },
      { data_type: 'uint32', fill_value: 4_294_967_295, expected: 4_294_967_295 },
      { data_type: 'int32', fill_value: -2_147_483_648, expected: -2_147_483_648 },
      { data_type: 'int32', fill_value: 2_147_483_647, expected: 2_147_483_647 },
    ]
    for (const boundary of boundaries) {
      const files = {
        'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
        '0/zarr.json': arrayMeta([1, 1], [1, 1], bytesCodec, {
          data_type: boundary.data_type,
          fill_value: boundary.fill_value,
        }),
      }
      const dataset = await openDataset(omeZarrReader, files)
      expect(dataset.descriptor.noDataValue).toBeUndefined()
      expect(dataset.descriptor.metadata?.zarrFill).toMatchObject({
        kind: 'defined',
        numeric: boundary.expected,
      })
      expect(await planeValues(dataset, { width: 1, height: 1 })).toEqual([boundary.expected])
    }

    const exactUint64 = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([1, 1], [1, 1], bytesCodec, {
        data_type: 'uint64',
        fill_value: 9,
      }),
    }
    const exact = await openDataset(omeZarrReader, exactUint64)
    expect(exact.descriptor.noDataValue).toBeUndefined()
    expect(exact.descriptor.metadata?.zarrFill).toMatchObject({ kind: 'defined', numeric: 9 })
    expect(await planeValues(exact, { width: 1, height: 1 })).toEqual([9])

    const wideUint64 = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([1, 1], [1, 1], bytesCodec, {
        data_type: 'uint64',
        fill_value: '0xffffffffffffffff',
      }),
    }
    await expectCode(() => openDataset(omeZarrReader, wideUint64), 'INVALID_INPUT')

    const missingV3Fill = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': text({
        zarr_format: 3,
        node_type: 'array',
        shape: [1, 1],
        data_type: 'uint8',
        chunk_grid: { name: 'regular', configuration: { chunk_shape: [1, 1] } },
        codecs: bytesCodec,
        dimension_names: ['y', 'x'],
        attributes: {},
      }),
    }
    await expectCode(() => openDataset(omeZarrReader, missingV3Fill), 'INVALID_INPUT')

    const v2NullPresent = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { fill_value: null }),
      '0/0/0': Uint8Array.of(1, 2, 3, 4),
    }
    expect(await planeValues(await openDataset(omeZarrReader, v2NullPresent, '.zgroup'))).toEqual([
      1, 2, 3, 4,
    ])

    const v2NullAbsent = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { fill_value: null }),
    }
    await expectCode(
      () =>
        openDataset(omeZarrReader, v2NullAbsent, '.zgroup').then((opened) => planeValues(opened)),
      'INVALID_INPUT',
    )

    const presentEmpty = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, { fill_value: 5 }),
      '0/c/0/0': new Uint8Array(0),
    }
    const absent = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, { fill_value: 5 }),
    }
    await expectCode(
      () => openDataset(omeZarrReader, presentEmpty).then((opened) => planeValues(opened)),
      'INVALID_INPUT',
    )
    expect(await planeValues(await openDataset(omeZarrReader, absent))).toEqual([5, 5, 5, 5])
  })

  it('validates sharding configuration at open and uses only both-sentinel missing inners', async () => {
    const sharded = (
      configuration: Readonly<Record<string, unknown>>,
      extras: Readonly<Record<string, unknown>> = {},
    ): Record<string, Uint8Array> => ({
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta(
        [2, 2],
        [2, 2],
        [{ name: 'sharding_indexed', configuration }],
        extras,
      ),
    })

    expect(
      await planeValues(
        await openDataset(omeZarrReader, {
          ...sharded({
            chunk_shape: [2, 2],
            codecs: bytesCodec,
            index_codecs: [...bytesCodec, { name: 'crc32c' }],
            index_location: 'end',
          }),
          '0/c/0/0': shardFromEntries([{ kind: 'fill' }]),
        }),
      ),
    ).toEqual([0, 0, 0, 0])

    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          ...sharded({
            chunk_shape: [2, 2],
            codecs: bytesCodec,
            index_codecs: [...bytesCodec, { name: 'crc32c' }],
            index_location: 'end',
          }),
          '0/c/0/0': shardFromEntries([{ kind: 'fields', offset: UINT64_SENTINEL, length: 4n }]),
        }).then((opened) => planeValues(opened)),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          ...sharded({
            chunk_shape: [2, 2],
            codecs: bytesCodec,
            index_codecs: [...bytesCodec, { name: 'crc32c' }],
            index_location: 'end',
          }),
          '0/c/0/0': shardFromEntries([{ kind: 'fields', offset: 0n, length: UINT64_SENTINEL }]),
        }).then((opened) => planeValues(opened)),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          ...sharded({
            chunk_shape: [2, 2],
            codecs: bytesCodec,
            index_codecs: [...bytesCodec, { name: 'crc32c' }],
            index_location: 'end',
          }),
          '0/c/0/0': shardFromEntries([{ kind: 'fields', offset: 0n, length: 0n }]),
        }).then((opened) => planeValues(opened)),
      'INVALID_INPUT',
    )

    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          sharded({
            chunk_shape: [3, 2],
            codecs: bytesCodec,
            index_codecs: [...bytesCodec, { name: 'crc32c' }],
          }),
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          sharded({
            chunk_shape: [2, 2],
            codecs: [{ name: 'gzip', configuration: { level: 1 } }],
            index_codecs: [...bytesCodec, { name: 'crc32c' }],
          }),
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          sharded({
            chunk_shape: [2, 2],
            codecs: [...bytesCodec, ...bytesCodec],
            index_codecs: [...bytesCodec, { name: 'crc32c' }],
          }),
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          sharded({
            chunk_shape: [2, 2],
            codecs: [...bytesCodec, { name: 'transpose', configuration: { order: [1, 0] } }],
            index_codecs: [...bytesCodec, { name: 'crc32c' }],
          }),
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          sharded({
            chunk_shape: [2, 2],
            codecs: bytesCodec,
            index_codecs: [
              { name: 'bytes', configuration: { endian: 'little' } },
              { name: 'gzip', configuration: { level: 1 } },
            ],
          }),
        ),
      'UNSUPPORTED_OPERATION',
    )
    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
          '0/zarr.json': arrayMeta(
            [2, 2],
            [2, 2],
            shardingCodec([2, 2], { codecs: [{ name: 'snappy' }] }),
          ),
        }),
      'UNSUPPORTED_OPERATION',
    )

    const hugeInner = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([1, 256], [1, 256], shardingCodec([1, 1])),
      '0/c/0/0': new Uint8Array(8),
    }
    const unread = unreadSource(8)
    const hugeContext: ScientificOpenContext = {
      primary: resource('zarr.json', hugeInner['zarr.json'] ?? new Uint8Array()),
      companions: {
        async resolve(request) {
          const name = request.kind === 'relative-name' ? request.name : request.relativeName
          if (name === '0/zarr.json') {
            return resource('0/zarr.json', hugeInner['0/zarr.json'] ?? new Uint8Array())
          }
          if (name === '0/c/0/0') return { id: name, name, source: unread.source }
          return undefined
        },
      },
    }
    const hugeDocument = await createOmeZarrReader({
      limits: { maxDecodedChunkBytes: 1024 },
    }).open(hugeContext)
    await expectCode(
      async () => planeValues(await hugeDocument.openDataset('image'), { width: 1, height: 1 }),
      'LIMIT_EXCEEDED',
    )
    expect(unread.reads).toBe(0)
  })

  it('rejects oversized optional metadata before reading the payload', async () => {
    const assertUnread = async (
      primaryName: string,
      files: Record<string, Uint8Array>,
      oversizedName: string,
    ): Promise<void> => {
      const unread = unreadSource(2_000_000)
      const context: ScientificOpenContext = {
        primary: resource(primaryName, files[primaryName] ?? new Uint8Array()),
        companions: {
          async resolve(request) {
            const name = request.kind === 'relative-name' ? request.name : request.relativeName
            if (name === undefined) return undefined
            if (name === oversizedName) return { id: name, name, source: unread.source }
            const bytes = files[name]
            return bytes === undefined ? undefined : resource(name, bytes)
          },
        },
      }
      await expectCode(() => omeZarrReader.open(context), 'LIMIT_EXCEEDED')
      expect(unread.reads).toBe(0)
    }

    await assertUnread(
      '.zgroup',
      {
        '.zgroup': v2Group(),
        '0/.zarray': v2Array([1, 1], [1, 1]),
        '0/0/0': Uint8Array.of(1),
      },
      '.zattrs',
    )
    await assertUnread(
      '.zgroup',
      {
        '.zgroup': v2Group(),
        '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
        '0/.zarray': v2Array([1, 1], [1, 1]),
        '0/0/0': Uint8Array.of(1),
      },
      '0/.zattrs',
    )
    await assertUnread(
      '.zgroup',
      {
        '.zgroup': v2Group(),
        '.zattrs': text({ labels: ['cell'] }),
        'cell/.zgroup': v2Group(),
        'cell/0/.zarray': v2Array([1, 1], [1, 1]),
        'cell/0/0/0': Uint8Array.of(1),
      },
      'cell/.zattrs',
    )
  })

  it('enforces OME-NGFF and Zarr format pairing and malformed nested metadata', async () => {
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext(
            {
              '.zgroup': v2Group(),
              '.zattrs': text({
                ome: {
                  version: '0.5',
                  multiscales: [
                    {
                      name: 'bad',
                      axes: [
                        { name: 'y', type: 'space' },
                        { name: 'x', type: 'space' },
                      ],
                      datasets: [
                        {
                          path: '0',
                          coordinateTransformations: [{ type: 'scale', scale: [1, 1] }],
                        },
                      ],
                    },
                  ],
                },
              }),
            },
            '.zgroup',
          ).context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': text({
              zarr_format: 3,
              node_type: 'group',
              attributes: {
                multiscales: [
                  {
                    version: '0.4',
                    axes: [
                      { name: 'y', type: 'space' },
                      { name: 'x', type: 'space' },
                    ],
                    datasets: [
                      {
                        path: '0',
                        coordinateTransformations: [{ type: 'scale', scale: [1, 1] }],
                      },
                    ],
                  },
                ],
              },
            }),
          }).context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
          '0/zarr.json': text({
            zarr_format: 2,
            shape: [2, 2],
            chunks: [2, 2],
            dtype: '|u1',
            fill_value: 0,
          }),
        }),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          {
            '.zgroup': v2Group(),
            '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
            '0/.zarray': text({
              zarr_format: 3,
              node_type: 'array',
              shape: [2, 2],
              data_type: 'uint8',
              fill_value: 0,
              codecs: bytesCodec,
            }),
          },
          '.zgroup',
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            ...tinyImage('', Uint8Array.of(1, 2, 3, 4)),
            'labels/zarr.json': text({
              zarr_format: 3,
              node_type: 'group',
              attributes: {
                ome: {
                  version: '0.4',
                  labels: ['cell'],
                },
              },
            }),
          }).context,
        ),
      'UNSUPPORTED_OPERATION',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': text({
              zarr_format: 3,
              node_type: 'group',
              attributes: { ome: { multiscales: [] } },
            }),
          }).context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': text({
              zarr_format: 3,
              node_type: 'group',
              attributes: { ome: { version: '0.5', 'bioformats2raw.layout': 3 } },
            }),
            '0/zarr.json': text({
              zarr_format: 3,
              node_type: 'group',
              attributes: {
                ome: {
                  version: '0.5',
                  multiscales: [
                    {
                      name: 'ok',
                      axes: [
                        { name: 'y', type: 'space' },
                        { name: 'x', type: 'space' },
                      ],
                      datasets: [
                        {
                          path: '0',
                          coordinateTransformations: [{ type: 'scale', scale: [1, 1] }],
                        },
                      ],
                    },
                  ],
                },
              },
            }),
            '0/0/zarr.json': arrayMeta([1, 1], [1, 1], bytesCodec),
            '0/0/c/0/0': Uint8Array.of(1),
            '1/zarr.json': text({
              zarr_format: 3,
              node_type: 'group',
              attributes: { ome: { version: '0.5' } },
            }),
          }).context,
        ),
      'INVALID_INPUT',
    )
  })

  it('validates NGFF dimension names and restricted transform lists', async () => {
    const withArray = (
      extras: Readonly<Record<string, unknown>>,
      transforms: unknown = [{ type: 'scale', scale: [1, 1] }],
    ): Record<string, Uint8Array> => ({
      'zarr.json': text({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                name: 'demo',
                axes: [
                  { name: 'y', type: 'space' },
                  { name: 'x', type: 'space' },
                ],
                datasets: [{ path: '0', coordinateTransformations: transforms }],
              },
            ],
          },
        },
      }),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, extras),
      '0/c/0/0': Uint8Array.of(1, 2, 3, 4),
    })

    await expectCode(
      () => openDataset(omeZarrReader, withArray({ dimension_names: null })),
      'INVALID_INPUT',
    )
    await expectCode(
      () => openDataset(omeZarrReader, withArray({ dimension_names: ['x', 'y'] })),
      'INVALID_INPUT',
    )
    await expectCode(
      () => openDataset(omeZarrReader, withArray({ dimension_names: ['y', 'X'] })),
      'INVALID_INPUT',
    )
    await expectCode(() => openDataset(omeZarrReader, withArray({}, [])), 'INVALID_INPUT')
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          withArray({}, [
            { type: 'scale', scale: [1, 1] },
            { type: 'scale', scale: [2, 2] },
          ]),
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          withArray({}, [
            { type: 'scale', scale: [1, 1] },
            { type: 'translation', translation: [0, 0] },
            { type: 'translation', translation: [1, 1] },
          ]),
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          withArray({}, [
            { type: 'translation', translation: [1, 1] },
            { type: 'scale', scale: [1, 1] },
          ]),
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () => openDataset(omeZarrReader, withArray({}, [{ type: 'identity' }])),
      'INVALID_INPUT',
    )
  })

  it('rejects resolution levels that change the sample contract', async () => {
    const twoLevel = (
      first: Readonly<Record<string, unknown>>,
      second: Readonly<Record<string, unknown>>,
    ): Record<string, Uint8Array> => ({
      'zarr.json': groupMeta([
        { path: '0', scale: [1, 1] },
        { path: '1', scale: [2, 2] },
      ]),
      '0/zarr.json': arrayMeta([4, 4], [4, 4], bytesCodec, first),
      '0/c/0/0': raster(4, 4),
      '1/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, second),
      '1/c/0/0': raster(2, 2),
    })
    await expectCode(
      () => openDataset(omeZarrReader, twoLevel({}, { data_type: 'uint16' })),
      'INVALID_INPUT',
    )
    await expectCode(
      () => openDataset(omeZarrReader, twoLevel({ fill_value: 0 }, { fill_value: 1 })),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          twoLevel({ dimension_names: ['y', 'x'] }, { dimension_names: ['x', 'y'] }),
        ),
      'INVALID_INPUT',
    )
  })

  it('keeps chunk lookup bounded separately from metadata discovery', async () => {
    const files: Record<string, Uint8Array> = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 10], [2, 2], bytesCodec),
    }
    for (let chunk = 0; chunk < 5; chunk += 1) {
      files[`0/c/0/${chunk}`] = Uint8Array.of(
        chunk * 10,
        chunk * 10 + 1,
        chunk * 10 + 2,
        chunk * 10 + 3,
      )
    }
    const { context, resolved } = trackingContext(files)
    const document = await createOmeZarrReader({ limits: { maxOpenSources: 2 } }).open(context)
    const dataset = await document.openDataset('image')
    for (let chunk = 0; chunk < 5; chunk += 1) {
      expect(await planeValues(dataset, { x: chunk * 2, y: 0, width: 2, height: 2 })).toEqual([
        chunk * 10,
        chunk * 10 + 1,
        chunk * 10 + 2,
        chunk * 10 + 3,
      ])
    }
    const firstBefore = resolved.filter((name) => name === '0/c/0/0').length
    expect(await planeValues(dataset, { x: 0, y: 0, width: 2, height: 2 })).toEqual([0, 1, 2, 3])
    expect(resolved.filter((name) => name === '0/c/0/0').length).toBeGreaterThan(firstBefore)

    await expectCode(
      () =>
        createOmeZarrReader({ limits: { maxStoreResolutions: 1 } }).open(
          trackingContext(regularStore()).context,
        ),
      'LIMIT_EXCEEDED',
    )
  })

  it('identifies directory stores from defining metadata and ZIP stores from the archive', async () => {
    const root = groupMeta([{ path: '0', scale: [1, 1] }])
    const array = arrayMeta([2, 2], [2, 2], bytesCodec)
    const first = {
      'zarr.json': root,
      '0/zarr.json': array,
      '0/c/0/0': Uint8Array.of(1, 2, 3, 4),
    }
    const second = {
      'zarr.json': root,
      '0/zarr.json': array,
      '0/c/0/0': Uint8Array.of(9, 8, 7, 6),
    }
    const document = await omeZarrReader.open(trackingContext(first).context)
    const dataset = await document.openDataset('image')
    const identity = getScientificDatasetIdentity(dataset)
    expect(identity).toBeDefined()
    expect(getScientificDatasetIdentity(await document.openDataset('image'))).toEqual(identity)
    expect(identity?.resources.some((entry) => entry.id === '0/zarr.json')).toBe(true)
    expect(identity?.resources.some((entry) => entry.id.includes('c/0/0'))).toBe(false)

    const otherChunks = getScientificDatasetIdentity(
      await (await omeZarrReader.open(trackingContext(second).context)).openDataset('image'),
    )
    expect(otherChunks).not.toEqual(identity)

    const changedArray = getScientificDatasetIdentity(
      await (
        await omeZarrReader.open(
          trackingContext({
            'zarr.json': root,
            '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, { fill_value: 3 }),
            '0/c/0/0': Uint8Array.of(1, 2, 3, 4),
          }).context,
        )
      ).openDataset('image'),
    )
    expect(changedArray).not.toEqual(identity)

    const zipDocument = await omeZarrReader.open(zipContext(first))
    const zipIdentity = getScientificDatasetIdentity(await zipDocument.openDataset('image'))
    expect(zipIdentity?.resources).toHaveLength(1)
    expect(zipIdentity?.resources[0]?.id).toBe('image.ozx')
  })

  it('validates exposed label colors and plate well geometry', async () => {
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            ...tinyImage('', Uint8Array.of(1, 2, 3, 4)),
            'labels/zarr.json': v3Group({ labels: ['cell'] }),
            ...tinyImage('labels/cell', Uint8Array.of(0, 1, 1, 0), {
              'image-label': { colors: [{ 'label-value': 1, rgba: [255, 0, 0, 255] }] },
            }),
            'labels/cell/0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, {
              data_type: 'float32',
              fill_value: 0,
            }),
          }).context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            ...tinyImage('', Uint8Array.of(1, 2, 3, 4)),
            'labels/zarr.json': v3Group({ labels: ['cell'] }),
            ...tinyImage('labels/cell', Uint8Array.of(0, 1, 1, 0), {
              'image-label': { colors: [{ 'label-value': 300, rgba: [0, 0, 0, 255] }] },
            }),
          }).context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            ...tinyImage('', Uint8Array.of(1, 2, 3, 4)),
            'labels/zarr.json': v3Group({ labels: ['cell'] }),
            ...tinyImage('labels/cell', Uint8Array.of(0, 1, 1, 0), {
              'image-label': { colors: [{ 'label-value': 1, rgba: [0, 0, 0, 300] }] },
            }),
          }).context,
        ),
      'INVALID_INPUT',
    )

    const plate = (wells: unknown, extras: Readonly<Record<string, unknown>> = {}): Uint8Array =>
      v3Group({
        plate: {
          version: '0.5',
          rows: [{ name: 'A' }],
          columns: [{ name: '1' }, { name: '2' }],
          wells,
          ...extras,
        },
      })
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': plate([{ path: 'A/1', rowIndex: -1, columnIndex: 0 }]),
          }).context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': plate([{ path: 'A/1', rowIndex: 0, columnIndex: 3 }]),
          }).context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': plate([{ path: 'B/1', rowIndex: 0, columnIndex: 0 }]),
          }).context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': plate([
              { path: 'A/1', rowIndex: 0, columnIndex: 0 },
              { path: 'A/1', rowIndex: 0, columnIndex: 0 },
            ]),
          }).context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': plate([{ path: 'A/1', rowIndex: 0, columnIndex: 0 }]),
            'A/1/zarr.json': v3Group({ well: { images: [{ path: '0' }, { path: '0' }] } }),
          }).context,
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': plate([{ path: 'A/1', rowIndex: 0, columnIndex: 0 }], {
              acquisitions: [{ id: 1 }],
            }),
            'A/1/zarr.json': v3Group({ well: { images: [{ path: '0', acquisition: 2 }] } }),
            ...tinyImage('A/1/0', Uint8Array.of(1, 1, 1, 1)),
          }).context,
        ),
      'INVALID_INPUT',
    )
  })

  it('reads a sharded region without refetching the index or the whole shard', async () => {
    const pixels = raster(4, 4)
    const shard = shardFromEntries([
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 0, 0, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 0, 2, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 2, 0, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 2, 2, 2, 2) },
    ])
    const files = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([4, 4], [4, 4], shardingCodec([2, 2])),
      '0/c/0/0': shard,
    }
    const { context, reads } = readTrackingContext(files)
    const document = await omeZarrReader.open(context)
    const dataset = await document.openDataset('image')
    expect(await planeValues(dataset, { x: 0, y: 0, width: 2, height: 4 })).toEqual([
      0, 1, 10, 11, 20, 21, 30, 31,
    ])
    const shardReads = reads.filter((entry) => entry.name === '0/c/0/0')
    const indexReads = shardReads.filter(
      (entry) => entry.offset + entry.length === shard.byteLength,
    )
    const payloadReads = shardReads.filter(
      (entry) => entry.offset + entry.length < shard.byteLength,
    )
    expect(indexReads).toHaveLength(1)
    expect(payloadReads).toHaveLength(2)
    expect(
      shardReads.some((entry) => entry.offset === 0 && entry.length === shard.byteLength),
    ).toBe(false)
    expect(await planeValues(dataset, { width: 4, height: 4 })).toEqual([...pixels])
  })

  it('propagates ZIP probe cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      omeZarrReader.probe({
        ...zipContext(tinyImage('', Uint8Array.of(1, 2, 3, 4))),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('treats v2 float-null as undefined fill and rejects v3 null and boolean integer fills', async () => {
    const v2Float = {
      '.zgroup': v2Group(),
      '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
      '0/.zarray': v2Array([2, 2], [2, 2], { dtype: '<f4', fill_value: null }),
      '0/0/0': new Uint8Array(new Float32Array([1, 2, 3, 4]).buffer),
    }
    expect(await planeValues(await openDataset(omeZarrReader, v2Float, '.zgroup'))).toEqual([
      1, 2, 3, 4,
    ])
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          {
            '.zgroup': v2Group(),
            '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
            '0/.zarray': v2Array([2, 2], [2, 2], { dtype: '<f4', fill_value: null }),
          },
          '.zgroup',
        ).then((opened) => planeValues(opened)),
      'INVALID_INPUT',
    )

    const v3Null = regularStore()
    v3Null['0/zarr.json'] = arrayMeta([8, 8], [8, 8], bytesCodec, {
      data_type: 'float32',
      fill_value: null,
    })
    await expectCode(() => openDataset(omeZarrReader, v3Null), 'INVALID_INPUT')
    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
          '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, { fill_value: true }),
        }),
      'INVALID_INPUT',
    )

    const rounded = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([1, 1], [1, 1], bytesCodec, {
        data_type: 'float32',
        fill_value: 0.1,
      }),
    }
    const roundedDataset = await openDataset(omeZarrReader, rounded)
    expect(roundedDataset.descriptor.metadata?.zarrFill).toMatchObject({
      kind: 'defined',
      numeric: Math.fround(0.1),
    })
    expect(await planeValues(roundedDataset, { width: 1, height: 1 })).toEqual([Math.fround(0.1)])

    const infinity = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([1, 1], [1, 1], bytesCodec, {
        data_type: 'float32',
        fill_value: 'Infinity',
      }),
    }
    const infinityDataset = await openDataset(omeZarrReader, infinity)
    expect(infinityDataset.descriptor.noDataValue).toBeUndefined()
    expect(infinityDataset.descriptor.metadata?.zarrFill).toMatchObject({
      kind: 'defined',
      value: 'Infinity',
    })
    expect(await planeValues(infinityDataset, { width: 1, height: 1 })).toEqual([
      Number.POSITIVE_INFINITY,
    ])

    const negativeInfinity = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([1, 1], [1, 1], bytesCodec, {
        data_type: 'float32',
        fill_value: '-Infinity',
      }),
    }
    expect(
      await planeValues(await openDataset(omeZarrReader, negativeInfinity), {
        width: 1,
        height: 1,
      }),
    ).toEqual([Number.NEGATIVE_INFINITY])

    const bits = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([1, 1], [1, 1], bytesCodec, {
        data_type: 'float32',
        fill_value: '0x3f800000',
      }),
    }
    expect(
      await planeValues(await openDataset(omeZarrReader, bits), { width: 1, height: 1 }),
    ).toEqual([1])

    const nan = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([1, 1], [1, 1], bytesCodec, {
        data_type: 'float32',
        fill_value: 'NaN',
      }),
    }
    const nanDataset = await openDataset(omeZarrReader, nan)
    expect(nanDataset.descriptor.noDataValue).toBeUndefined()
    expect(nanDataset.descriptor.metadata?.zarrFill).toMatchObject({
      kind: 'defined',
      value: 'NaN',
    })
    expect(Number.isNaN((await planeValues(nanDataset, { width: 1, height: 1 }))[0])).toBe(true)

    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
          '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec, { fill_value: '9' }),
        }),
      'INVALID_INPUT',
    )
  })

  it('requires shard-index endian and rejects storage transformers', async () => {
    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
          '0/zarr.json': arrayMeta(
            [2, 2],
            [2, 2],
            shardingCodec([2, 2], {
              indexCodecs: [{ name: 'bytes', configuration: {} }, { name: 'crc32c' }],
            }),
          ),
        }),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
          '0/zarr.json': arrayMeta(
            [2, 2],
            [2, 2],
            shardingCodec([2, 2], {
              indexCodecs: [
                { name: 'bytes', configuration: { endian: 'middle' } },
                { name: 'crc32c' },
              ],
            }),
          ),
        }),
      'INVALID_INPUT',
    )
    const transformed = regularStore()
    const parsed = JSON.parse(new TextDecoder().decode(transformed['0/zarr.json'])) as Record<
      string,
      unknown
    >
    parsed.storage_transformers = [{ name: 'vlen-utf8' }]
    transformed['0/zarr.json'] = text(parsed)
    await expectCode(() => openDataset(omeZarrReader, transformed), 'UNSUPPORTED_OPERATION')
    await expect(openDataset(omeZarrReader, transformed)).rejects.toMatchObject({
      message: expect.stringContaining('vlen-utf8'),
    })

    const emptyTransformers = regularStore()
    const emptyParsed = JSON.parse(
      new TextDecoder().decode(emptyTransformers['0/zarr.json']),
    ) as Record<string, unknown>
    emptyParsed.storage_transformers = []
    emptyTransformers['0/zarr.json'] = text(emptyParsed)
    expect(await planeValues(await openDataset(omeZarrReader, emptyTransformers))).toHaveLength(64)
  })

  it('validates NGFF axis composition and rejects malformed OMERO colors', async () => {
    const axesStore = (
      axes: readonly Record<string, string>[],
      shape: readonly number[],
    ): Record<string, Uint8Array> => ({
      'zarr.json': text({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                name: 'axes',
                axes,
                datasets: [
                  {
                    path: '0',
                    coordinateTransformations: [{ type: 'scale', scale: axes.map(() => 1) }],
                  },
                ],
              },
            ],
          },
        },
      }),
      '0/zarr.json': arrayMeta(shape, shape, bytesCodec, {
        dimension_names: axes.map((axis) => axis.name ?? ''),
      }),
      [`0/c/${shape.map(() => '0').join('/')}`]: new Uint8Array(shape.reduce((a, b) => a * b, 1)),
    })

    expect(
      (
        await openDataset(omeZarrReader, axesStore([{ name: 'y' }, { name: 'x' }], [2, 2]))
      ).descriptor.axes.map((axis) => axis.kind),
    ).toEqual(['space', 'space'])
    expect(
      (
        await openDataset(
          omeZarrReader,
          axesStore(
            [
              { name: 'z', type: 'space' },
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            [1, 2, 2],
          ),
        )
      ).descriptor.axes.map((axis) => axis.id),
    ).toEqual(['z', 'y', 'x'])
    expect(
      (
        await openDataset(
          omeZarrReader,
          axesStore(
            [
              { name: 't', type: 'time' },
              { name: 'c', type: 'channel' },
              { name: 'z', type: 'space' },
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            [1, 1, 1, 2, 2],
          ),
        )
      ).descriptor.axes.map((axis) => axis.kind),
    ).toEqual(['time', 'channel', 'space', 'space', 'space'])

    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          axesStore(
            [
              { name: 'x', type: 'space' },
              { name: 't', type: 'time' },
            ],
            [2, 2],
          ),
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(
          omeZarrReader,
          axesStore(
            [
              { name: 'c1', type: 'channel' },
              { name: 'c2', type: 'channel' },
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            [1, 1, 2, 2],
          ),
        ),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': text({
              zarr_format: 3,
              node_type: 'group',
              attributes: {
                ome: {
                  version: '0.5',
                  multiscales: [
                    {
                      axes: [
                        { name: 'y', type: 'space' },
                        { name: 'x', type: 'space' },
                      ],
                      datasets: [
                        {
                          path: '0',
                          coordinateTransformations: [{ type: 'scale', scale: [1, 1] }],
                        },
                      ],
                    },
                  ],
                  omero: {
                    channels: [{ label: 'DAPI', color: '#00FF00', window: validOmeroWindow }],
                  },
                },
              },
            }),
            '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
          }).context,
        ),
      'INVALID_INPUT',
    )
  })

  it('evicts chunk sources by retained bytes', async () => {
    const files: Record<string, Uint8Array> = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 8], [2, 2], bytesCodec),
      '0/c/0/0': Uint8Array.of(1, 1, 1, 1),
      '0/c/0/1': Uint8Array.of(2, 2, 2, 2),
      '0/c/0/2': Uint8Array.of(3, 3, 3, 3),
      '0/c/0/3': Uint8Array.of(4, 4, 4, 4),
    }
    const { context, resolved } = trackingContext(files)
    const document = await createOmeZarrReader({
      limits: { maxOpenSources: 8, maxCachedChunkBytes: 6 },
    }).open(context)
    const dataset = await document.openDataset('image')
    expect(await planeValues(dataset, { x: 0, y: 0, width: 2, height: 2 })).toEqual([1, 1, 1, 1])
    expect(await planeValues(dataset, { x: 2, y: 0, width: 2, height: 2 })).toEqual([2, 2, 2, 2])
    const firstBefore = resolved.filter((name) => name === '0/c/0/0').length
    expect(await planeValues(dataset, { x: 0, y: 0, width: 2, height: 2 })).toEqual([1, 1, 1, 1])
    expect(resolved.filter((name) => name === '0/c/0/0').length).toBeGreaterThan(firstBefore)
    const large = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 4], [2, 4], bytesCodec),
      '0/c/0/0': Uint8Array.from({ length: 8 }, () => 7),
    }
    const { context: largeContext, resolved: largeResolved } = trackingContext(large)
    const largeDocument = await createOmeZarrReader({
      limits: { maxOpenSources: 8, maxCachedChunkBytes: 6 },
    }).open(largeContext)
    expect(
      await planeValues(await largeDocument.openDataset('image'), {
        width: 4,
        height: 2,
      }),
    ).toEqual([7, 7, 7, 7, 7, 7, 7, 7])
    const before = largeResolved.filter((name) => name === '0/c/0/0').length
    expect(
      await planeValues(await largeDocument.openDataset('image'), {
        width: 4,
        height: 2,
      }),
    ).toEqual([7, 7, 7, 7, 7, 7, 7, 7])
    expect(largeResolved.filter((name) => name === '0/c/0/0').length).toBeGreaterThan(before)
  })

  it('cites the defining metadata path for nested plate fields and labels', async () => {
    const files = {
      'zarr.json': v3Group({
        plate: {
          version: '0.5',
          rows: [{ name: 'A' }],
          columns: [{ name: '1' }],
          wells: [{ path: 'A/1', rowIndex: 0, columnIndex: 0 }],
        },
      }),
      'A/1/zarr.json': v3Group({ well: { images: [{ path: '0' }] } }),
      ...tinyImage('A/1/0', Uint8Array.of(1, 1, 1, 1)),
      'A/1/0/labels/zarr.json': v3Group({ labels: ['cell'] }),
      ...tinyImage('A/1/0/labels/cell', Uint8Array.of(0, 1, 1, 0), {
        'image-label': { colors: [{ 'label-value': 1, rgba: [255, 0, 0, 255] }] },
      }),
    }
    const document = await omeZarrReader.open(trackingContext(files).context)
    const field = await document.openDataset('A/1/0')
    expect(field.descriptor.axes[1]?.calibration).toMatchObject({
      kind: 'embedded',
      resourceId: 'A/1/0/zarr.json',
      locator: 'ome:multiscales/0/axes/1',
    })
    const label = await document.openDataset('A/1/0/labels/cell')
    expect(label.descriptor.axes[0]?.calibration).toMatchObject({
      kind: 'embedded',
      resourceId: 'A/1/0/labels/cell/zarr.json',
      locator: 'ome:multiscales/0/axes/0',
    })

    const zipped = await omeZarrReader.open(zipContext(tinyImage('', Uint8Array.of(2, 2, 2, 2))))
    expect((await zipped.openDataset('image')).descriptor.axes[0]?.calibration).toMatchObject({
      kind: 'embedded',
      resourceId: 'image.ozx',
      locator: 'zarr.json#ome:multiscales/0/axes/0',
    })
  })

  it('probes large OME-Zarr ZIPs by name and leaves generic ZIPs unmatched', async () => {
    const bulky = new Uint8Array(70_000)
    bulky.set([0x50, 0x4b, 0x03, 0x04])
    const largeUnrelated = zipContext({ 'notes.txt': bulky }, 'archive.zip')
    const registry = new ScientificReaderRegistry([omeZarrReader])
    await expect(registry.detect(largeUnrelated)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    })
    expect(await omeZarrReader.probe(largeUnrelated)).toMatchObject({ confidence: 0 })

    const largeValid = zipContext(
      {
        ...tinyImage('', Uint8Array.of(1, 2, 3, 4)),
        'padding.bin': bulky,
      },
      'demo.ozx',
    )
    const detected = await registry.detect(largeValid)
    expect(detected.confidence).toBeGreaterThan(0.8)
    expect(detected.reader.id).toBe('purejsimage/ome-zarr')

    const genericV2Zip = zipContext({ '.zgroup': text({ zarr_format: 2 }) }, 'archive.zip')
    expect(await omeZarrReader.probe(genericV2Zip)).toMatchObject({ confidence: 0 })
    const ngffV2Zip = zipContext(
      {
        '.zgroup': text({ zarr_format: 2 }),
        '.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
        '0/.zarray': v2Array([2, 2], [2, 2]),
        '0/0/0': Uint8Array.of(1, 2, 3, 4),
      },
      'legacy.ozx',
    )
    expect((await omeZarrReader.probe(ngffV2Zip)).confidence).toBeGreaterThan(0.8)
  })

  it('rejects oversized deflated ZIP members before decompression', async () => {
    const metadataBomb = zipContext(
      { 'zarr.json': new Uint8Array(8_000_000).fill(123) },
      'bomb.ozx',
      8,
    )
    const started = Date.now()
    await expectCode(
      () => createOmeZarrReader({ limits: { maxMetadataBytes: 128 } }).open(metadataBomb),
      'LIMIT_EXCEEDED',
    )
    expect(Date.now() - started).toBeLessThan(500)

    const chunkBomb = zipContext(
      {
        ...tinyImage('', Uint8Array.of(1, 2, 3, 4)),
        '0/c/0/0': new Uint8Array(4_000_000).fill(7),
      },
      'chunks.ozx',
      8,
    )
    const chunkStarted = Date.now()
    await expectCode(
      () =>
        createOmeZarrReader({ limits: { maxChunkBytes: 16 } })
          .open(chunkBomb)
          .then(async (document) => planeValues(await document.openDataset('image'))),
      'LIMIT_EXCEEDED',
    )
    expect(Date.now() - chunkStarted).toBeLessThan(500)
  })
})

describe('OME-Zarr remaining review regressions', () => {
  it('does not revive unrelated v2 attributes or empty v3 ome objects', async () => {
    const unrelated = await omeZarrReader.probe(
      trackingContext(
        {
          '.zgroup': text({ zarr_format: 2 }),
          '.zattrs': text({ conventions: 'CF-1.8', title: 'plain zarr' }),
        },
        '.zgroup',
      ).context,
    )
    expect(unrelated.confidence).toBe(0)
    expect(unrelated.reason).toBeDefined()

    const emptyOme = await omeZarrReader.probe(
      trackingContext({
        'zarr.json': text({
          zarr_format: 3,
          node_type: 'group',
          attributes: { ome: { version: '0.5' } },
        }),
      }).context,
    )
    expect(emptyOme.confidence).toBe(0)
    expect(emptyOme.reason).toMatch(/NGFF surface/u)
  })

  it('requires bioformats2raw.layout 3 and does not scan after an invalid layout', async () => {
    const wrong = trackingContext(
      {
        '.zgroup': text({ zarr_format: 2 }),
        '.zattrs': text({ 'bioformats2raw.layout': 1 }),
        '0/.zgroup': v2Group(),
        '0/.zattrs': v2Attrs([{ path: '0', scale: [1, 1] }]),
        '0/0/.zarray': v2Array([2, 2], [2, 2]),
        '0/0/0/0': Uint8Array.of(1, 2, 3, 4),
      },
      '.zgroup',
    )
    const probed = await omeZarrReader.probe(wrong.context)
    expect(probed.confidence).toBe(0)
    expect(probed.reason).toMatch(/layout must be 3/u)
    await expectCode(() => omeZarrReader.open(wrong.context), 'INVALID_INPUT')
  })

  it('rejects repeated transpose codecs during array open', async () => {
    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
          '0/zarr.json': arrayMeta(
            [2, 3],
            [2, 3],
            [
              { name: 'transpose', configuration: { order: [1, 0] } },
              { name: 'transpose', configuration: { order: [1, 0] } },
              { name: 'bytes', configuration: { endian: 'little' } },
            ],
          ),
        }),
      'UNSUPPORTED_OPERATION',
    )
  })

  it('resolves one oversized shard once across rowsPerBlock subdivisions', async () => {
    const pixels = raster(4, 4)
    const shard = shardFromEntries([
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 0, 0, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 0, 2, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 2, 0, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 2, 2, 2, 2) },
    ])
    expect(shard.byteLength).toBeGreaterThan(20)
    const { context, resolved, reads } = readTrackingContext({
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([4, 4], [4, 4], shardingCodec([2, 2])),
      '0/c/0/0': shard,
    })
    const document = await createOmeZarrReader({
      limits: { maxCachedChunkBytes: 8, rowsPerBlock: 1 },
    }).open(context)
    const afterOpen = resolved.filter((name) => name === '0/c/0/0').length
    const indexReadsBefore = reads.filter(
      (entry) => entry.name === '0/c/0/0' && entry.offset + entry.length === shard.byteLength,
    ).length
    expect(await planeValues(await document.openDataset('image'), { width: 4, height: 4 })).toEqual(
      [...pixels],
    )
    expect(resolved.filter((name) => name === '0/c/0/0').length).toBe(afterOpen + 1)
    expect(
      reads.filter(
        (entry) => entry.name === '0/c/0/0' && entry.offset + entry.length === shard.byteLength,
      ).length,
    ).toBe(indexReadsBefore + 1)
  })

  it('validates present omero metadata and optional image-label source image', async () => {
    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          'zarr.json': text({
            zarr_format: 3,
            node_type: 'group',
            attributes: {
              ome: {
                version: '0.5',
                multiscales: [
                  {
                    axes: [
                      { name: 'y', type: 'space' },
                      { name: 'x', type: 'space' },
                    ],
                    datasets: [
                      {
                        path: '0',
                        coordinateTransformations: [{ type: 'scale', scale: [1, 1] }],
                      },
                    ],
                  },
                ],
                omero: 'bad',
              },
            },
          }),
          '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
        }),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        openDataset(omeZarrReader, {
          'zarr.json': text({
            zarr_format: 3,
            node_type: 'group',
            attributes: {
              ome: {
                version: '0.5',
                multiscales: [
                  {
                    axes: [
                      { name: 'c', type: 'channel' },
                      { name: 'y', type: 'space' },
                      { name: 'x', type: 'space' },
                    ],
                    datasets: [
                      {
                        path: '0',
                        coordinateTransformations: [{ type: 'scale', scale: [1, 1, 1] }],
                      },
                    ],
                  },
                ],
                omero: {
                  channels: [{ label: 'only-one', color: '00FF00', window: validOmeroWindow }],
                },
              },
            },
          }),
          '0/zarr.json': arrayMeta([2, 2, 2], [2, 2, 2], bytesCodec),
          '0/c/0/0/0': new Uint8Array(8),
        }),
      'INVALID_INPUT',
    )
    await expectCode(
      () =>
        omeZarrReader.open(
          trackingContext({
            'zarr.json': v3Group({ labels: ['cell'] }),
            'cell/zarr.json': v3Group({
              'image-label': {
                colors: [
                  { 'label-value': 1, rgba: [255, 0, 0, 255] },
                  { 'label-value': 1, rgba: [0, 255, 0, 255] },
                ],
              },
              multiscales: [
                {
                  name: 'cell',
                  axes: [
                    { name: 'y', type: 'space' },
                    { name: 'x', type: 'space' },
                  ],
                  datasets: [
                    {
                      path: '0',
                      coordinateTransformations: [{ type: 'scale', scale: [1, 1] }],
                    },
                  ],
                },
              ],
            }),
            'cell/0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
            'cell/0/c/0/0': Uint8Array.of(0, 1, 1, 0),
          }).context,
        ),
      'INVALID_INPUT',
    )
    const optionalSource = await omeZarrReader.open(
      trackingContext({
        'zarr.json': v3Group({ labels: ['cell'] }),
        'cell/zarr.json': v3Group({
          'image-label': {
            colors: [{ 'label-value': 1, rgba: [255, 0, 0, 255] }],
            source: {},
          },
          multiscales: [
            {
              name: 'cell',
              axes: [
                { name: 'y', type: 'space' },
                { name: 'x', type: 'space' },
              ],
              datasets: [
                {
                  path: '0',
                  coordinateTransformations: [{ type: 'scale', scale: [1, 1] }],
                },
              ],
            },
          ],
        }),
        'cell/0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
        'cell/0/c/0/0': Uint8Array.of(0, 1, 1, 0),
      }).context,
    )
    const optionalSourceLabel = await optionalSource.openDataset('labels/cell')
    expect(optionalSourceLabel.descriptor.metadata?.kind).toBe('label')
    expect(optionalSourceLabel.descriptor.metadata?.imageLabel).not.toHaveProperty('source')
    expect(optionalSourceLabel.descriptor.metadata?.imageLabel).not.toHaveProperty('sourceImage')
  })

  it('hits the persistent chunk cache across readPlane calls and evicts by budget', async () => {
    const files: Record<string, Uint8Array> = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 8], [2, 2], bytesCodec),
      '0/c/0/0': Uint8Array.of(1, 1, 1, 1),
      '0/c/0/1': Uint8Array.of(2, 2, 2, 2),
      '0/c/0/2': Uint8Array.of(3, 3, 3, 3),
      '0/c/0/3': Uint8Array.of(4, 4, 4, 4),
    }
    const { context, resolved } = trackingContext(files)
    const document = await createOmeZarrReader({
      limits: { maxOpenSources: 8, maxCachedChunkBytes: 6 },
    }).open(context)
    const dataset = await document.openDataset('image')
    expect(await planeValues(dataset, { x: 0, y: 0, width: 2, height: 2 })).toEqual([1, 1, 1, 1])
    const afterFirst = resolved.filter((name) => name === '0/c/0/0').length
    expect(await planeValues(dataset, { x: 0, y: 0, width: 2, height: 2 })).toEqual([1, 1, 1, 1])
    expect(resolved.filter((name) => name === '0/c/0/0').length).toBe(afterFirst)
    expect(await planeValues(dataset, { x: 2, y: 0, width: 2, height: 2 })).toEqual([2, 2, 2, 2])
    expect(await planeValues(dataset, { x: 4, y: 0, width: 2, height: 2 })).toEqual([3, 3, 3, 3])
    expect(await planeValues(dataset, { x: 0, y: 0, width: 2, height: 2 })).toEqual([1, 1, 1, 1])
    const afterEvict = resolved.filter((name) => name === '0/c/0/0').length
    expect(afterEvict).toBeGreaterThan(afterFirst)
  })

  it('keeps plane-session entry and byte high-water marks inside configured limits', async () => {
    const files: Record<string, Uint8Array> = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([2, 8], [2, 2], bytesCodec),
      '0/c/0/0': Uint8Array.of(1, 1, 1, 1),
      '0/c/0/2': Uint8Array.of(3, 3, 3, 3),
    }
    const { context } = trackingContext(files)
    const document = await createOmeZarrReader({
      limits: { maxOpenSources: 2, maxCachedChunkBytes: 4 },
    }).open(context)
    expect(await planeValues(await document.openDataset('image'), { width: 8, height: 2 })).toEqual(
      [1, 1, 0, 0, 3, 3, 0, 0, 1, 1, 0, 0, 3, 3, 0, 0],
    )
    const stats = lastZarrReadSessionStats()
    expect(stats).toBeDefined()
    expect(stats?.chunkEntryHighWater).toBe(2)
    expect(stats?.chunkByteHighWater).toBe(4)
    expect(stats?.indexEntryHighWater).toBe(0)
    expect(stats?.indexByteHighWater).toBe(0)
  })

  it('processes a 1x1-chunk region incrementally under tiny session limits', async () => {
    const width = 16
    const height = 8
    const files: Record<string, Uint8Array> = {
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([height, width], [1, 1], bytesCodec),
    }
    const expected: number[] = []
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = (y * width + x) & 255
        files[`0/c/${y}/${x}`] = Uint8Array.of(value)
        expected.push(value)
      }
    }
    const { context } = trackingContext(files)
    const document = await createOmeZarrReader({
      limits: { maxOpenSources: 3, maxCachedChunkBytes: 3 },
    }).open(context)
    expect(await planeValues(await document.openDataset('image'), { width, height })).toEqual(
      expected,
    )
    const stats = lastZarrReadSessionStats()
    expect(stats?.chunkEntryHighWater).toBe(3)
    expect(stats?.chunkByteHighWater).toBe(3)
  })

  it('reuses one cacheable shard and its index across rowsPerBlock subdivisions', async () => {
    const pixels = raster(4, 4)
    const shard = shardFromEntries([
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 0, 0, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 0, 2, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 2, 0, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 2, 2, 2, 2) },
    ])
    const { context, resolved, reads } = readTrackingContext({
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([4, 4], [4, 4], shardingCodec([2, 2])),
      '0/c/0/0': shard,
    })
    const document = await createOmeZarrReader({
      limits: { rowsPerBlock: 1 },
    }).open(context)
    const afterOpen = resolved.filter((name) => name === '0/c/0/0').length
    const indexReadsBefore = reads.filter(
      (entry) => entry.name === '0/c/0/0' && entry.offset + entry.length === shard.byteLength,
    ).length
    expect(await planeValues(await document.openDataset('image'), { width: 4, height: 4 })).toEqual(
      [...pixels],
    )
    expect(resolved.filter((name) => name === '0/c/0/0').length).toBe(afterOpen + 1)
    expect(
      reads.filter(
        (entry) => entry.name === '0/c/0/0' && entry.offset + entry.length === shard.byteLength,
      ).length,
    ).toBe(indexReadsBefore + 1)
    expect(
      reads.some(
        (entry) =>
          entry.name === '0/c/0/0' && entry.offset === 0 && entry.length === shard.byteLength,
      ),
    ).toBe(false)
  })

  it('warms a second readPlane of the same cacheable region', async () => {
    const { context, resolved } = trackingContext(regularStore())
    const document = await omeZarrReader.open(context)
    const dataset = await document.openDataset('image')
    const first = await planeValues(dataset, { x: 4, y: 0, width: 2, height: 2 })
    const afterFirst = resolved.filter((name) => name.startsWith('0/c/')).length
    const second = await planeValues(dataset, { x: 4, y: 0, width: 2, height: 2 })
    expect(second).toEqual(first)
    expect(resolved.filter((name) => name.startsWith('0/c/')).length).toBe(afterFirst)
  })

  it('retains at most one oversized shard transiently and rereads it later', async () => {
    const pixels = raster(4, 4)
    const shard = shardFromEntries([
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 0, 0, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 0, 2, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 2, 0, 2, 2) },
      { kind: 'payload', bytes: chunkOf(pixels, 4, 4, 2, 2, 2, 2) },
    ])
    const { context, resolved, reads } = readTrackingContext({
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }]),
      '0/zarr.json': arrayMeta([4, 4], [4, 4], shardingCodec([2, 2])),
      '0/c/0/0': shard,
    })
    const document = await createOmeZarrReader({
      limits: { maxCachedChunkBytes: 8, rowsPerBlock: 1 },
    }).open(context)
    const dataset = await document.openDataset('image')
    const afterOpen = resolved.filter((name) => name === '0/c/0/0').length
    expect(await planeValues(dataset, { width: 4, height: 4 })).toEqual([...pixels])
    const stats = lastZarrReadSessionStats()
    expect(stats?.chunkEntryHighWater).toBe(1)
    expect(stats?.chunkByteHighWater).toBe(shard.byteLength)
    expect(stats?.indexEntryHighWater).toBe(1)
    expect(stats?.indexByteHighWater).toBe(shard.byteLength - 16)
    expect(resolved.filter((name) => name === '0/c/0/0').length).toBe(afterOpen + 1)
    expect(
      reads.filter(
        (entry) => entry.name === '0/c/0/0' && entry.offset + entry.length === shard.byteLength,
      ).length,
    ).toBe(1)
    expect(await planeValues(dataset, { width: 4, height: 4 })).toEqual([...pixels])
    expect(resolved.filter((name) => name === '0/c/0/0').length).toBe(afterOpen + 2)
  })
})

describe('OME-Zarr 0.5 community conformance', () => {
  const float64Vector = (values: readonly number[]): Uint8Array => {
    const bytes = new Uint8Array(values.length * 8)
    const view = new DataView(bytes.buffer)
    for (const [index, value] of values.entries()) view.setFloat64(index * 8, value, true)
    return bytes
  }

  it('requires complete OMERO channel display metadata', async () => {
    const store = (channel: Readonly<Record<string, unknown>>) => ({
      ...regularStore(),
      'zarr.json': groupMeta([{ path: '0', scale: [1, 1] }], {
        omero: { channels: [channel] },
      }),
    })
    await expect(
      omeZarrReader.open(trackingContext(store({ color: '00FF00', label: 'DAPI' })).context),
    ).rejects.toThrow('window must be present')
    await expect(
      omeZarrReader.open(
        trackingContext(store({ label: 'DAPI', window: validOmeroWindow })).context,
      ),
    ).rejects.toThrow('color must be present')
    await expect(
      omeZarrReader.open(
        trackingContext(store({ color: 0x00ff00, label: 'DAPI', window: validOmeroWindow }))
          .context,
      ),
    ).rejects.toThrow('exactly six hexadecimal digits')
    await expect(
      omeZarrReader.open(
        trackingContext(store({ color: '00FF00', label: 'DAPI', window: { min: 0, max: 1 } }))
          .context,
      ),
    ).rejects.toThrow('window.start')
  })

  it('requires 0.5 plate versions and unique alphanumeric row and column names', async () => {
    const plateStore = (plate: Readonly<Record<string, unknown>>) => ({
      'zarr.json': v3Group({ plate }),
    })
    const base = {
      rows: [{ name: 'A' }],
      columns: [{ name: '1' }],
      wells: [{ path: 'A/1', rowIndex: 0, columnIndex: 0 }],
    }
    await expect(omeZarrReader.open(trackingContext(plateStore(base)).context)).rejects.toThrow(
      'plate.version must be present',
    )
    await expect(
      omeZarrReader.open(
        trackingContext(plateStore({ ...base, version: '0.5', rows: [{ name: 'A-1' }] })).context,
      ),
    ).rejects.toThrow('only alphanumeric')
    await expect(
      omeZarrReader.open(
        trackingContext(
          plateStore({ ...base, version: '0.5', columns: [{ name: '1' }, { name: '1' }] }),
        ).context,
      ),
    ).rejects.toThrow('is repeated')
  })

  it('reads path-backed transforms and preserves multiscale generation metadata', async () => {
    const files = {
      'zarr.json': text({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                name: 'calibrated',
                type: 'gaussian',
                metadata: { method: 'example.downsample', version: '1.2.3' },
                axes: [
                  { name: 'y', type: 'space', unit: 'micrometer' },
                  { name: 'x', type: 'space', unit: 'micrometer' },
                ],
                datasets: [
                  {
                    path: '0',
                    coordinateTransformations: [
                      { type: 'scale', path: 'coordinateTransformations/scale' },
                      { type: 'translation', path: 'coordinateTransformations/translation' },
                    ],
                  },
                ],
              },
            ],
          },
        },
      }),
      '0/zarr.json': arrayMeta([2, 2], [2, 2], bytesCodec),
      '0/c/0/0': Uint8Array.of(1, 2, 3, 4),
      'coordinateTransformations/scale/zarr.json': arrayMeta([2], [2], bytesCodec, {
        data_type: 'float64',
      }),
      'coordinateTransformations/scale/c/0': float64Vector([0.5, 0.25]),
      'coordinateTransformations/translation/zarr.json': arrayMeta([2], [2], bytesCodec, {
        data_type: 'float64',
      }),
      'coordinateTransformations/translation/c/0': float64Vector([10, 20]),
    }
    const document = await omeZarrReader.open(trackingContext(files).context)
    const dataset = await document.openDataset('image')
    expect(dataset.descriptor.axes.find((axis) => axis.id === 'y')?.coordinates).toEqual({
      type: 'linear',
      origin: 10,
      step: 0.5,
    })
    expect(dataset.descriptor.axes.find((axis) => axis.id === 'x')?.coordinates).toEqual({
      type: 'linear',
      origin: 20,
      step: 0.25,
    })
    expect(dataset.descriptor.metadata).toMatchObject({
      omeZarrMultiscaleType: 'gaussian',
      omeZarrMultiscaleMetadata: { method: 'example.downsample', version: '1.2.3' },
    })
  })

  it('honors an explicit OME.series list before numbered fallback discovery', async () => {
    const files = {
      'zarr.json': v3Group({ 'bioformats2raw.layout': 3 }),
      'OME/zarr.json': v3Group({ series: ['foo', 'bar'] }),
      ...tinyImage('foo', Uint8Array.of(1, 2, 3, 4)),
      ...tinyImage('bar', Uint8Array.of(5, 6, 7, 8)),
    }
    const document = await omeZarrReader.open(trackingContext(files).context)
    expect(document.datasets.map((dataset) => dataset.id)).toEqual(['foo', 'bar'])
    expect(document.metadata).toMatchObject({ bioformats2rawLayout: 3, seriesCount: 2 })
    expect(await planeValues(await document.openDataset('bar'))).toEqual([5, 6, 7, 8])
  })
})
