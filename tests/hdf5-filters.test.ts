import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { independentHdf5ChunkIndexFixture } from '../benchmark/hdf5/independent-chunk-fixture.ts'
import { createGeneratedFilterPipelineMessage } from '../benchmark/hdf5/generated-dataset-fixture.ts'
import { readHdf5DatasetMetadata } from '../src/scientific/formats/hdf5-dataset.ts'
import {
  decodeHdf5ChunkFilters,
  hdf5Fletcher32,
  readHdf5DecodedChunkBlocks,
} from '../src/scientific/formats/hdf5-filters.ts'
import {
  parseHdf5FilterPipelineMessage,
  type Hdf5FilterPipeline,
} from '../src/scientific/formats/hdf5-filter-message.ts'
import { openHdf5ObjectGraph } from '../src/scientific/formats/hdf5-graph.ts'
import { openHdf5FileLayer } from '../src/scientific/formats/hdf5.ts'
import { MemorySource } from '../src/source.ts'

const pipeline = (filters: Hdf5FilterPipeline['filters'], version: 1 | 2 = 2): Hdf5FilterPipeline =>
  Object.freeze({ version, filters: Object.freeze(filters) })

const filter = (
  id: number,
  clientData: readonly number[] = [],
): Hdf5FilterPipeline['filters'][number] =>
  Object.freeze({ id, optional: false, name: undefined, clientData: Object.freeze(clientData) })

const shuffle = (bytes: Uint8Array, elementBytes: number): Uint8Array<ArrayBuffer> => {
  const elements = bytes.byteLength / elementBytes
  const output = new Uint8Array(bytes.byteLength)
  for (let byte = 0; byte < elementBytes; byte += 1) {
    for (let element = 0; element < elements; element += 1) {
      output[byte * elements + element] = bytes[element * elementBytes + byte] ?? 0
    }
  }
  return output
}

const appendFletcher32 = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(bytes.byteLength + 4)
  output.set(bytes)
  new DataView(output.buffer).setUint32(bytes.byteLength, hdf5Fletcher32(bytes), true)
  return output
}

describe('HDF5 D5 filter-pipeline metadata', () => {
  it('parses version 1 and version 2 descriptions exactly', () => {
    const version1 = parseHdf5FilterPipelineMessage(
      createGeneratedFilterPipelineMessage({
        version: 1,
        filters: [
          { id: 1, optional: true, name: 'deflate', clientData: [6] },
          { id: 32001, name: 'private', clientData: [1, 2] },
        ],
      }),
    )
    expect(version1).toEqual({
      version: 1,
      filters: [
        { id: 1, optional: true, name: 'deflate', clientData: [6] },
        { id: 32001, optional: false, name: 'private', clientData: [1, 2] },
      ],
    })

    const version2 = parseHdf5FilterPipelineMessage(
      createGeneratedFilterPipelineMessage({
        version: 2,
        filters: [
          { id: 2, optional: true, clientData: [4] },
          { id: 300, name: 'custom', clientData: [] },
        ],
      }),
    )
    expect(version2).toEqual({
      version: 2,
      filters: [
        { id: 2, optional: true, name: undefined, clientData: [4] },
        { id: 300, optional: false, name: 'custom', clientData: [] },
      ],
    })
  })

  it('rejects unsupported versions, truncation, reserved fields, and non-ASCII names', () => {
    expect(() => parseHdf5FilterPipelineMessage(Uint8Array.of(3, 0))).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_OPERATION' }),
    )
    expect(() => parseHdf5FilterPipelineMessage(Uint8Array.of(1, 33))).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
    const reserved = createGeneratedFilterPipelineMessage({ version: 1, filters: [] })
    reserved[2] = 1
    expect(() => parseHdf5FilterPipelineMessage(reserved)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
    const badFlags = createGeneratedFilterPipelineMessage({
      version: 2,
      filters: [{ id: 2, clientData: [4] }],
    })
    badFlags[4] = 2
    expect(() => parseHdf5FilterPipelineMessage(badFlags)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
    const badName = createGeneratedFilterPipelineMessage({
      version: 2,
      filters: [{ id: 300, name: 'custom' }],
    })
    badName[10] = 0xff
    expect(() => parseHdf5FilterPipelineMessage(badName)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
  })

  it('reads the filter message from an independent h5py/HDF5 file', async () => {
    const file = await openHdf5FileLayer(new MemorySource(independentHdf5ChunkIndexFixture.bytes()))
    const graph = await openHdf5ObjectGraph(file)
    const object = await graph.get('/filtered-fixed')
    if (object === undefined) throw new Error('Independent HDF5 fixture lacks /filtered-fixed')
    const metadata = await readHdf5DatasetMetadata(file, object.header, {
      objectPath: '/filtered-fixed',
    })
    expect(metadata.filterPipeline).toEqual({
      version: 2,
      filters: [{ id: 2, optional: true, name: undefined, clientData: [4] }],
    })
  })
})

describe('HDF5 D5 filter decoding', () => {
  it('decodes raw chunks and composed pipelines in reverse order', async () => {
    const raw = new Uint8Array(64)
    const view = new DataView(raw.buffer)
    for (let index = 0; index < 16; index += 1) view.setInt32(index * 4, index * 7 - 20, true)

    await expect(decodeHdf5ChunkFilters(raw, 64, 4, undefined, 0)).resolves.toEqual(raw)
    const encoded = appendFletcher32(deflateSync(shuffle(raw, 4)))
    await expect(
      decodeHdf5ChunkFilters(
        encoded,
        raw.byteLength,
        4,
        pipeline([filter(2, [4]), filter(1, [6]), filter(3)]),
        0,
      ),
    ).resolves.toEqual(raw)
  })

  it('honors per-chunk masks while rejecting mask bits outside the pipeline', async () => {
    const raw = Uint8Array.of(1, 2, 3, 4)
    const value = pipeline([filter(4), filter(2, [1])])
    await expect(decodeHdf5ChunkFilters(raw, 4, 1, value, 1)).resolves.toEqual(raw)
    await expect(decodeHdf5ChunkFilters(raw, 4, 1, value, 4)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(decodeHdf5ChunkFilters(raw, 4, 1, undefined, 1)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('verifies Fletcher32 and rejects corrupt data', async () => {
    const raw = Uint8Array.of(0x01, 0x02, 0x03, 0x04, 0x05)
    expect(hdf5Fletcher32(raw)).toBe(0x0e0e_0906)
    const encoded = appendFletcher32(raw)
    await expect(
      decodeHdf5ChunkFilters(encoded, raw.byteLength, 1, pipeline([filter(3)]), 0),
    ).resolves.toEqual(raw)
    encoded[1] = (encoded[1] ?? 0) ^ 0xff
    await expect(
      decodeHdf5ChunkFilters(encoded, raw.byteLength, 1, pipeline([filter(3)]), 0),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects unsupported active filters and malformed built-in parameters', async () => {
    const raw = Uint8Array.of(1, 2, 3, 4)
    for (const id of [4, 5, 6, 32000]) {
      await expect(
        decodeHdf5ChunkFilters(raw, 4, 1, pipeline([filter(id)]), 0),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    }
    await expect(
      decodeHdf5ChunkFilters(raw, 4, 1, pipeline([filter(1, [10])]), 0),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      decodeHdf5ChunkFilters(raw, 4, 1, pipeline([filter(2, [4])]), 0),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('bounds decompression and observes cancellation', async () => {
    const encoded = deflateSync(new Uint8Array(64))
    await expect(
      decodeHdf5ChunkFilters(encoded, 64, 1, pipeline([filter(1, [6])]), 0, {
        maxFilterScratchBytes: 32,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const controller = new AbortController()
    controller.abort(new Error('stop filters'))
    await expect(
      decodeHdf5ChunkFilters(encoded, 64, 1, pipeline([filter(1, [6])]), 0, {
        signal: controller.signal,
      }),
    ).rejects.toThrow('stop filters')
  })

  it('streams decoded chunks from an independent shuffled dataset', async () => {
    const file = await openHdf5FileLayer(new MemorySource(independentHdf5ChunkIndexFixture.bytes()))
    const graph = await openHdf5ObjectGraph(file)
    const object = await graph.get('/filtered-fixed')
    if (object === undefined) throw new Error('Independent HDF5 fixture lacks /filtered-fixed')
    const metadata = await readHdf5DatasetMetadata(file, object.header, {
      objectPath: '/filtered-fixed',
    })
    const blocks = []
    for await (const block of readHdf5DecodedChunkBlocks(
      file,
      metadata,
      { start: [4, 4], shape: [1, 1] },
      { objectPath: '/filtered-fixed', maxDecodedChunkBytes: 64, maxFilterScratchBytes: 64 },
    )) {
      blocks.push(block)
    }
    expect(blocks).toHaveLength(1)
    const decoded = blocks[0]?.decoded
    if (decoded === undefined) throw new Error('Expected an allocated decoded HDF5 chunk')
    expect(
      new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength).getInt32(0, true),
    ).toBe(36)
  })
})
