import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createGeneratedChunkedLayoutMessage,
  createGeneratedCompactLayoutMessage,
  createGeneratedContiguousLayoutMessage,
  createGeneratedDataspaceMessage,
  createGeneratedIntegerDatatypeMessage,
  createGeneratedStringDatatypeMessage,
  createGeneratedVariableStringDatatypeMessage,
} from '../benchmark/hdf5/generated-dataset-fixture.ts'
import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import { independentHdf5D6Fixture } from '../benchmark/hdf5/independent-d6-fixture.ts'
import {
  createGeneratedSharedMessageLocator,
  createGeneratedVersion2ObjectHeader,
  type GeneratedHdf5ObjectMessage,
} from '../benchmark/hdf5/generated-object-fixture.ts'
import { independentHdf5ChunkIndexFixture } from '../benchmark/hdf5/independent-chunk-fixture.ts'
import { openHdf5File, type Hdf5Block } from '../src/scientific/formats/hdf5-file.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'

const datasetMessages = (
  dimensions: readonly bigint[],
  layout: Uint8Array,
  elementBytes: number,
): readonly GeneratedHdf5ObjectMessage[] =>
  Object.freeze([
    {
      type: 0x0001,
      data: createGeneratedDataspaceMessage({ version: 2, lengthSize: 8, dimensions }),
    },
    {
      type: 0x0003,
      data: createGeneratedIntegerDatatypeMessage({ byteLength: elementBytes }),
    },
    { type: 0x0008, data: layout },
  ])

const rootDataset = (
  messages: readonly GeneratedHdf5ObjectMessage[],
  raw?: Readonly<{ readonly address: number; readonly data: Uint8Array }>,
  fileBytes = 8_192,
): Uint8Array<ArrayBuffer> => {
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes })
  if (fixture.rootObjectOffset === undefined)
    throw new Error('Generated root offset is unavailable')
  fixture.bytes.set(createGeneratedVersion2ObjectHeader(messages), fixture.rootObjectOffset)
  if (raw !== undefined) fixture.bytes.set(raw.data, raw.address)
  return fixture.bytes
}

const collect = async (blocks: AsyncIterable<Hdf5Block>): Promise<readonly Hdf5Block[]> => {
  const output: Hdf5Block[] = []
  for await (const block of blocks) output.push(block)
  return output
}

const uint16Bytes = (values: readonly number[]): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(values.length * 2)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setUint16(index * 2, values[index] ?? 0, true)
  }
  return output
}

const writeUint64 = (bytes: Uint8Array, offset: number, value: bigint): void => {
  new DataView(bytes.buffer).setBigUint64(offset, value, true)
}

const scalarStringDataset = (
  datatype: Uint8Array,
  data: Uint8Array,
): readonly GeneratedHdf5ObjectMessage[] =>
  Object.freeze([
    {
      type: 0x0001,
      data: createGeneratedDataspaceMessage({ version: 2, lengthSize: 8, dimensions: [1n] }),
    },
    { type: 0x0003, data: datatype },
    {
      type: 0x0008,
      data: createGeneratedCompactLayoutMessage({ version: 4, dimensions: [], data }),
    },
  ])

const variableStringFixture = (value: string, heapIndex = 1): Uint8Array<ArrayBuffer> => {
  const heapAddress = 4_096n
  const encoded = new TextEncoder().encode(value)
  const descriptor = new Uint8Array(16)
  const descriptorView = new DataView(descriptor.buffer)
  descriptorView.setUint32(0, encoded.byteLength, true)
  descriptorView.setBigUint64(4, heapAddress, true)
  descriptorView.setUint32(12, heapIndex, true)
  const bytes = rootDataset(
    scalarStringDataset(
      createGeneratedVariableStringDatatypeMessage({
        descriptorBytes: 16,
        characterSet: 'utf-8',
      }),
      descriptor,
    ),
  )
  const heap = new Uint8Array(512)
  heap.set([0x47, 0x43, 0x4f, 0x4c, 1])
  writeUint64(heap, 8, BigInt(heap.byteLength))
  const view = new DataView(heap.buffer)
  view.setUint16(16, 1, true)
  writeUint64(heap, 24, BigInt(encoded.byteLength))
  heap.set(encoded, 32)
  const next = 32 + Math.ceil(encoded.byteLength / 8) * 8
  writeUint64(heap, next + 8, BigInt(heap.byteLength - next))
  bytes.set(heap, Number(heapAddress))
  return bytes
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

class PausableSource implements ImageSource {
  readonly size: number
  readonly #bytes: Uint8Array
  #gate: Promise<void> = Promise.resolve()
  #release: (() => void) | undefined
  #started: Promise<void> = Promise.resolve()
  #markStarted: (() => void) | undefined
  #paused = false
  reads = 0

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  pause(): void {
    this.#paused = true
    this.#gate = new Promise<void>((resolve) => {
      this.#release = resolve
    })
    this.#started = new Promise<void>((resolve) => {
      this.#markStarted = resolve
    })
  }

  waitForRead(): Promise<void> {
    return this.#started
  }

  resume(): void {
    this.#paused = false
    this.#release?.()
    this.#release = undefined
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.reads += 1
    this.#markStarted?.()
    this.#markStarted = undefined
    if (this.#paused) await this.#gate
    return this.#bytes.slice(offset, offset + length)
  }
}

const largeImplicitFixture = (): Uint8Array<ArrayBuffer> => {
  const chunk = new Uint8Array(16 * 16 * 4)
  const view = new DataView(chunk.buffer)
  for (let row = 0; row < 16; row += 1) {
    for (let column = 0; column < 16; column += 1) {
      view.setInt32((row * 16 + column) * 4, row * 1_000 + column, true)
    }
  }
  return rootDataset(
    datasetMessages(
      [1_000_000n, 1_000_000n],
      createGeneratedChunkedLayoutMessage({
        version: 4,
        offsetSize: 8,
        lengthSize: 8,
        chunkDimensions: [16, 16],
        elementBytes: 4,
        address: 4_096n,
        index: { kind: 'implicit' },
      }),
      4,
    ),
    { address: 4_096, data: chunk },
  )
}

describe('HDF5 D6 low-level file API', () => {
  it('describes and lists graph objects without exposing a package entry point', async () => {
    const file = await openHdf5File(new MemorySource(independentHdf5ChunkIndexFixture.bytes()))
    await expect(file.get('/')).resolves.toMatchObject({ kind: 'group', path: '/' })
    await expect(file.get('/single')).resolves.toMatchObject({
      kind: 'dataset',
      path: '/single',
      metadata: { layout: { kind: 'chunked' } },
    })
    expect((await file.list('/')).map((link) => link.name)).toEqual([
      'single',
      'extensible',
      'btree-v2',
      'filtered-fixed',
      'fixed',
      'implicit',
    ])
    await expect(file.get('/missing')).resolves.toBeUndefined()
    await expect(file.list('/missing')).resolves.toEqual([])
    file.close()
    await expect(file.get('/')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('isolates cancellation between callers sharing one dataset-metadata load', async () => {
    const sharedAddress = 8_192n
    const datatype = createGeneratedIntegerDatatypeMessage({ byteLength: 1 })
    const bytes = rootDataset(
      [
        {
          type: 0x0001,
          data: createGeneratedDataspaceMessage({
            version: 2,
            lengthSize: 8,
            dimensions: [2n, 2n],
          }),
        },
        {
          type: 0x0003,
          flags: 2,
          data: createGeneratedSharedMessageLocator({
            version: 3,
            offsetSize: 8,
            lengthSize: 8,
            address: sharedAddress,
          }),
        },
        {
          type: 0x0008,
          data: createGeneratedCompactLayoutMessage({
            version: 4,
            dimensions: [],
            data: Uint8Array.of(1, 2, 3, 4),
          }),
        },
      ],
      undefined,
      16_384,
    )
    bytes.set(
      createGeneratedVersion2ObjectHeader([{ type: 0x0003, data: datatype }]),
      Number(sharedAddress),
    )
    const source = new PausableSource(bytes)
    const file = await openHdf5File(source)
    source.pause()
    const readsBefore = source.reads
    const controller = new AbortController()
    const cancelled = file.get('/', { signal: controller.signal })
    const successful = file.get('/')
    await source.waitForRead()
    controller.abort(new Error('cancel only this dataset metadata waiter'))
    await expect(cancelled).rejects.toThrow('cancel only this dataset metadata waiter')
    source.resume()
    await expect(successful).resolves.toMatchObject({
      kind: 'dataset',
      metadata: { datatype: { kind: 'integer', byteLength: 1 } },
    })
    expect(source.reads - readsBefore).toBe(1)
  })

  it('reads bounded fixed and global-heap scalar strings for dialect metadata', async () => {
    const fixedValue = new TextEncoder().encode('Velox   ')
    const fixed = await openHdf5File(
      new MemorySource(
        rootDataset(
          scalarStringDataset(
            createGeneratedStringDatatypeMessage({
              byteLength: fixedValue.byteLength,
              padding: 'space-padded',
            }),
            fixedValue,
          ),
        ),
      ),
    )
    await expect(fixed.readScalarString('/')).resolves.toBe('Velox')
    fixed.close()

    const variableBytes = variableStringFixture('{"bincount":"4096"}\n')
    const variable = await openHdf5File(new MemorySource(variableBytes))
    await expect(variable.readScalarString('/')).resolves.toBe('{"bincount":"4096"}\n')
    await expect(variable.readScalarString('/', { maxStringBytes: 8 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(
      variable.readScalarString('/', { maxGlobalHeapCollectionBytes: 128 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const controller = new AbortController()
    controller.abort(new Error('stop HDF5 scalar string'))
    await expect(variable.readScalarString('/', { signal: controller.signal })).rejects.toThrow(
      'stop HDF5 scalar string',
    )
    variable.close()

    const missing = await openHdf5File(
      new MemorySource(variableStringFixture('{"bincount":"4096"}', 2)),
    )
    await expect(missing.readScalarString('/')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    missing.close()
  })

  it('reads exact rectangular blocks from compact and contiguous datasets', async () => {
    const values = Array.from({ length: 12 }, (_value, index) => index)
    const raw = uint16Bytes(values)
    const compactBytes = rootDataset(
      datasetMessages(
        [3n, 4n],
        createGeneratedCompactLayoutMessage({ version: 4, dimensions: [], data: raw }),
        2,
      ),
    )
    const contiguousBytes = rootDataset(
      datasetMessages(
        [3n, 4n],
        createGeneratedContiguousLayoutMessage({
          version: 4,
          offsetSize: 8,
          lengthSize: 8,
          dimensions: [],
          address: 4_096n,
          storageBytes: BigInt(raw.byteLength),
        }),
        2,
      ),
      { address: 4_096, data: raw },
    )
    for (const bytes of [compactBytes, contiguousBytes]) {
      const file = await openHdf5File(new MemorySource(bytes))
      const blocks = await collect(file.readDataset('/', { start: [1, 1], shape: [2, 2] }))
      expect(blocks.map(({ start, shape }) => ({ start, shape }))).toEqual([
        { start: [1, 1], shape: [2, 2] },
      ])
      expect(blocks.map(({ data }) => Array.from(data))).toEqual([
        Array.from(uint16Bytes([5, 6, 9, 10])),
      ])
      file.close()
    }
  })

  it('assembles exact selected bytes from allocated and fill-backed chunks', async () => {
    const file = await openHdf5File(new MemorySource(largeImplicitFixture()))
    const blocks = await collect(file.readDataset('/', { start: [4, 5], shape: [2, 3] }))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ start: [4, 5], shape: [2, 3] })
    const data = blocks[0]?.data
    if (data === undefined) throw new Error('Expected a selected HDF5 block')
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    expect(Array.from({ length: 6 }, (_value, index) => view.getInt32(index * 4, true))).toEqual([
      4_005, 4_006, 4_007, 5_005, 5_006, 5_007,
    ])

    const unallocated = rootDataset(
      datasetMessages(
        [4n, 4n],
        createGeneratedChunkedLayoutMessage({
          version: 4,
          offsetSize: 8,
          lengthSize: 8,
          chunkDimensions: [2, 2],
          elementBytes: 2,
          index: { kind: 'fixed-array', pageBits: 0 },
        }),
        2,
      ),
    )
    const fillFile = await openHdf5File(new MemorySource(unallocated))
    const fillBlocks = await collect(fillFile.readDataset('/', { start: [1, 1], shape: [2, 2] }))
    expect(fillBlocks).toHaveLength(4)
    expect(fillBlocks.every(({ data: bytes }) => bytes.every((value) => value === 0))).toBe(true)
  })

  it('returns exact per-chunk intersections across a filtered dataset', async () => {
    const file = await openHdf5File(new MemorySource(independentHdf5ChunkIndexFixture.bytes()))
    const blocks = await collect(
      file.readDataset('/filtered-fixed', { start: [3, 3], shape: [3, 3] }),
    )
    expect(blocks.map(({ start, shape }) => ({ start, shape }))).toEqual([
      { start: [3, 3], shape: [1, 1] },
      { start: [3, 4], shape: [1, 2] },
      { start: [4, 3], shape: [2, 1] },
      { start: [4, 4], shape: [2, 2] },
    ])
    const values = blocks.map(({ data }) => {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      return Array.from({ length: data.byteLength / 4 }, (_value, index) =>
        view.getInt32(index * 4, true),
      )
    })
    expect(values).toEqual([[27], [28, 29], [35, 43], [36, 37, 44, 45]])
  })

  it('cross-checks a second independently generated HDF5 library version', async () => {
    const bytes = independentHdf5D6Fixture.bytes()
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(independentHdf5D6Fixture.sha256)
    const file = await openHdf5File(new MemorySource(bytes))
    const object = await file.get(independentHdf5D6Fixture.path)
    expect(object).toMatchObject({
      kind: 'dataset',
      metadata: {
        dataspace: { dimensions: [3, 4] },
        datatype: { kind: 'integer', signed: true, byteLength: 2 },
        layout: { kind: 'chunked', chunkDimensions: [2, 2] },
        filterPipeline: { filters: [{ id: 2 }, { id: 1 }, { id: 3 }] },
      },
    })
    const blocks = await collect(
      file.readDataset(independentHdf5D6Fixture.path, independentHdf5D6Fixture.selection),
    )
    const values: number[] = []
    for (const { data } of blocks) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      for (let offset = 0; offset < data.byteLength; offset += 2) {
        values.push(view.getInt16(offset, true))
      }
    }
    expect(values).toEqual(independentHdf5D6Fixture.expected)
  })

  it('enforces cancellation, operation, and output-block limits', async () => {
    const raw = uint16Bytes(Array.from({ length: 12 }, (_value, index) => index))
    const bytes = rootDataset(
      datasetMessages(
        [3n, 4n],
        createGeneratedCompactLayoutMessage({ version: 4, dimensions: [], data: raw }),
        2,
      ),
    )
    const constrained = await openHdf5File(new MemorySource(bytes), {
      reads: { maxReadOperations: 1, maxOutputBlockBytes: 4 },
    })
    await expect(
      collect(constrained.readDataset('/', { start: [0, 1], shape: [2, 2] })),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(
      collect(constrained.readDataset('/', { start: [0, 0], shape: [1, 3] })),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const chunkConstrained = await openHdf5File(
      new MemorySource(independentHdf5ChunkIndexFixture.bytes()),
      { reads: { maxReadOperations: 1 } },
    )
    await expect(
      collect(chunkConstrained.readDataset('/filtered-fixed', { start: [3, 3], shape: [3, 3] })),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const controller = new AbortController()
    controller.abort(new Error('stop HDF5 dataset blocks'))
    await expect(
      collect(
        constrained.readDataset(
          '/',
          { start: [0, 0], shape: [1, 1] },
          { signal: controller.signal },
        ),
      ),
    ).rejects.toThrow('stop HDF5 dataset blocks')
  })

  it('batches a large strided column behind an explicit input-span cap', async () => {
    const rows = 100_000
    const raw = new Uint8Array(rows * 2)
    for (let row = 0; row < rows; row += 1) {
      raw[row * 2] = row & 0xff
      raw[row * 2 + 1] = (row + 17) & 0xff
    }
    const bytes = rootDataset(
      datasetMessages(
        [BigInt(rows), 2n],
        createGeneratedContiguousLayoutMessage({
          version: 4,
          offsetSize: 8,
          lengthSize: 8,
          dimensions: [],
          address: 4_096n,
          storageBytes: BigInt(raw.byteLength),
        }),
        1,
      ),
      { address: 4_096, data: raw },
      4_096 + raw.byteLength,
    )
    const source = new CountingSource(bytes)
    const file = await openHdf5File(source, {
      reads: { maxInputBlockBytes: raw.byteLength, maxReadOperations: 1 },
    })
    const readsBeforeSelection = source.reads.length
    const blocks = await collect(file.readDataset('/', { start: [0, 1], shape: [rows, 1] }))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ start: [0, 1], shape: [rows, 1] })
    expect(blocks[0]?.data[0]).toBe(17)
    expect(blocks[0]?.data[rows - 1]).toBe((rows - 1 + 17) & 0xff)
    expect(source.reads.slice(readsBeforeSelection)).toEqual([
      { offset: 4_097, length: raw.byteLength - 1 },
    ])
  })

  it('keeps a small region in a huge declared dataset within exact local and HTTP budgets', async () => {
    const bytes = largeImplicitFixture()
    const counting = new CountingSource(bytes)
    const local = await openHdf5File(counting)
    const localBlocks = await collect(local.readDataset('/', { start: [4, 5], shape: [1, 1] }))
    expect(counting.reads).toEqual([
      { offset: 0, length: 4_096 },
      { offset: 4_096, length: 1_024 },
    ])

    const requests: string[] = []
    const fetchRange: typeof fetch = async (_input, init): Promise<Response> => {
      const range = new Headers(init?.headers).get('range') ?? ''
      requests.push(range)
      const match = range.match(/^bytes=(\d+)-(\d+)$/)
      if (match === null) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Math.min(Number(match[2]), bytes.byteLength - 1)
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
          etag: '"hdf5-d6"',
        },
      })
    }
    const remoteSource = await HttpRangeSource.open('https://example.test/huge.h5', {
      blockBytes: 4_096,
      maxCacheBytes: 8_192,
      fetch: fetchRange,
    })
    const remote = await openHdf5File(remoteSource)
    const remoteBlocks = await collect(remote.readDataset('/', { start: [4, 5], shape: [1, 1] }))
    expect(remoteBlocks).toEqual(localBlocks)
    expect(requests).toEqual(['bytes=0-0', 'bytes=0-4095', 'bytes=4096-8191'])
    expect(remoteSource.stats).toEqual({ requests: 3, bytesFetched: 8_193, cacheBytes: 8_192 })
  })
})
