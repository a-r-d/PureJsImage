import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { MemorySource } from '../src/source.ts'
import { createScientificLibrary, type ScientificDataset } from '../src/scientific/index.ts'
import { aperioSvsReader } from '../src/scientific/readers/aperio-svs.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'

const fixturePath = 'tests/fixtures/aperio-cmu-1-small-region.svs'

const firstRegionHash = async (dataset: ScientificDataset): Promise<string> => {
  const hash = createHash('sha256')
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
    x: 0,
    y: 0,
    width: 64,
    height: 48,
  })) {
    try {
      hash.update(block.data)
    } finally {
      block.release?.()
    }
  }
  return hash.digest('hex')
}

describe('Aperio scientific reader bridge', () => {
  it('exposes calibrated RGB pyramid and separate associated datasets with range parity', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const fetchRange: typeof fetch = async (_input, init) => {
      const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
      if (match === undefined || match === null) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Math.min(Number(match[2]), bytes.byteLength - 1)
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
      })
    }
    const range = await HttpRangeSource.open('https://fixtures.invalid/aperio.svs', {
      blockBytes: 64 * 1_024,
      maxCacheBytes: 512 * 1_024,
      fetch: fetchRange,
    })
    const library = createScientificLibrary({ readers: [aperioSvsReader] })
    const [local, remote] = await Promise.all([
      library.open({
        primary: { id: 'local-slide', name: 'slide.svs', source: new MemorySource(bytes) },
        readerId: aperioSvsReader.descriptor.id,
      }),
      library.open({
        primary: { id: 'remote-slide', name: 'slide.svs', source: range },
        readerId: aperioSvsReader.descriptor.id,
      }),
    ])
    expect(local.datasets.map(({ id }) => id)).toEqual([
      'pyramid',
      'associated/thumbnail',
      'associated/label',
      'associated/macro',
    ])
    expect(new Set(local.datasets.map(({ identity }) => JSON.stringify(identity))).size).toBe(4)
    for (let index = 0; index < local.datasets.length; index += 1) {
      const localSummary = local.datasets[index]
      const remoteSummary = remote.datasets[index]
      expect(remoteSummary?.id).toBe(localSummary?.id)
      expect(remoteSummary?.descriptor).toMatchObject({
        axes: localSummary?.descriptor.axes,
        sampleType: localSummary?.descriptor.sampleType,
        components: localSummary?.descriptor.components,
        levels: localSummary?.descriptor.levels,
        capabilities: localSummary?.descriptor.capabilities,
      })
      const { source: _localSource, ...localMetadata } = localSummary?.descriptor.metadata ?? {}
      const { source: _remoteSource, ...remoteMetadata } = remoteSummary?.descriptor.metadata ?? {}
      expect(remoteMetadata).toEqual(localMetadata)
    }
    const summary = local.datasets[0]
    expect(summary?.descriptor).toMatchObject({
      sampleType: 'uint8',
      components: [{ kind: 'red' }, { kind: 'green' }, { kind: 'blue' }],
      axes: [
        { id: 'x', length: 2_220, unit: 'µm', coordinates: { step: 0.499 } },
        { id: 'y', length: 2_967, unit: 'µm', coordinates: { step: 0.499 } },
      ],
      capabilities: { resolutionLevels: false },
    })
    const [localPyramid, remotePyramid] = await Promise.all([
      local.openDataset('pyramid'),
      remote.openDataset('pyramid'),
    ])
    const metadataBytes = range.stats.bytesFetched
    expect(metadataBytes).toBeLessThan(bytes.byteLength)
    expect(await firstRegionHash(remotePyramid)).toBe(await firstRegionHash(localPyramid))
    expect(range.stats.bytesFetched).toBeLessThan(bytes.byteLength)
    expect(range.stats.bytesFetched - metadataBytes).toBeLessThan(bytes.byteLength)
  })
})
