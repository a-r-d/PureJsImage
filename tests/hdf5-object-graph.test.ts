import { describe, expect, it } from 'vitest'
import { createGeneratedHdf5GraphFixture } from '../benchmark/hdf5/generated-graph-fixture.ts'
import { openHdf5ObjectGraph } from '../src/scientific/formats/hdf5-graph.ts'
import { openHdf5FileLayer } from '../src/scientific/formats/hdf5.ts'
import { HostileSource } from './hostile-source.ts'

const openGraph = async (graphOptions: Parameters<typeof openHdf5ObjectGraph>[1] = {}) => {
  const fixture = createGeneratedHdf5GraphFixture()
  const file = await openHdf5FileLayer(new HostileSource(fixture.bytes), {
    pageBytes: 64,
    maxBytes: 2_048,
  })
  return { fixture, graph: await openHdf5ObjectGraph(file, graphOptions) }
}

describe('HDF5 bounded object graph', () => {
  it('resolves compact, legacy, and dense hard links through one path API', async () => {
    const { fixture, graph } = await openGraph()

    await expect(graph.get('/compact/item')).resolves.toMatchObject({
      path: '/compact/item',
      address: fixture.addresses.compactLeaf,
    })
    await expect(graph.get('/legacy/leaf')).resolves.toMatchObject({
      address: fixture.addresses.legacyLeaf,
    })
    await expect(graph.get('/dense/leaf')).resolves.toMatchObject({
      address: fixture.addresses.denseLeaf,
    })
    await expect(graph.get('/legacy/root/dense/leaf')).resolves.toMatchObject({
      address: fixture.addresses.denseLeaf,
    })
    await expect(graph.get('/missing')).resolves.toBeUndefined()

    expect((await graph.list('/legacy'))?.map(({ name }) => name)).toEqual([
      'leaf',
      'alias',
      'root',
    ])
    expect((await graph.list('/dense'))?.map(({ name }) => name).sort()).toEqual([
      'alias',
      'leaf',
      'root',
    ])
    expect(graph.stats()).toMatchObject({ objects: 7, groups: 4, links: 15 })
  })

  it('resolves absolute and containing-group-relative soft links and preserves dangling links', async () => {
    const { fixture, graph } = await openGraph()

    await expect(graph.get('/absolute')).resolves.toMatchObject({
      path: '/absolute',
      address: fixture.addresses.legacyLeaf,
    })
    await expect(graph.get('/compact/relative')).resolves.toMatchObject({
      address: fixture.addresses.compactLeaf,
    })
    await expect(graph.get('/legacy/alias')).resolves.toMatchObject({
      address: fixture.addresses.compactLeaf,
    })
    await expect(graph.get('/dense/alias')).resolves.toMatchObject({
      address: fixture.addresses.legacyLeaf,
    })
    await expect(graph.get('/dangling')).resolves.toBeUndefined()
  })

  it('detects soft-link cycles and bounds hard and soft traversal depth', async () => {
    const { graph } = await openGraph()
    await expect(graph.get('/loop')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('cyclic soft link'),
    })

    const shallow = await openGraph({ maxLinkDepth: 2 })
    await expect(shallow.graph.get('/self/self/self')).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('link depth'),
    })

    const oneSoft = await openGraph({ maxSoftLinkTraversals: 1 })
    await expect(oneSoft.graph.get('/legacy/alias')).resolves.toMatchObject({
      address: oneSoft.fixture.addresses.compactLeaf,
    })
    await expect(oneSoft.graph.get('/loop')).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('soft-link traversals'),
    })
  })

  it('enforces graph-wide object, link, metadata, and path limits', async () => {
    const objectLimited = await openGraph({ maxObjects: 2 })
    await expect(objectLimited.graph.get('/compact/item')).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('objects'),
    })

    const linkLimited = await openGraph({ maxLinks: 6 })
    await expect(linkLimited.graph.get('/compact')).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('links'),
    })

    await expect(openGraph({ maxMetadataBytes: 1 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('metadata bytes'),
    })

    const pathLimited = await openGraph({ maxPathBytes: 8 })
    await expect(pathLimited.graph.get('/compact/item')).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('path'),
    })
  })

  it('rejects relative, parent, and NUL paths and honors cancellation', async () => {
    const { graph } = await openGraph()
    await expect(graph.get('compact/item')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(graph.get('/compact/../item')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(graph.get('/compact\0item')).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const controller = new AbortController()
    controller.abort(new Error('stop HDF5 graph'))
    await expect(graph.get('/compact/item', { signal: controller.signal })).rejects.toThrow(
      'stop HDF5 graph',
    )
  })

  it('coalesces concurrent graph loads without double-counting limits', async () => {
    const baseline = await openGraph()
    await baseline.graph.get('/compact/item')
    const expected = baseline.graph.stats()

    const concurrent = await openGraph({
      maxObjects: expected.objects,
      maxLinks: expected.links,
      maxMetadataBytes: expected.metadataBytes,
    })
    const controller = new AbortController()
    const cancelled = concurrent.graph.get('/compact/item', { signal: controller.signal })
    const successful = concurrent.graph.get('/compact/item')
    controller.abort(new Error('cancel only this graph waiter'))
    await expect(cancelled).rejects.toThrow('cancel only this graph waiter')
    await expect(successful).resolves.toMatchObject({
      address: concurrent.fixture.addresses.compactLeaf,
    })
    expect(concurrent.graph.stats()).toEqual(expected)
  })
})
