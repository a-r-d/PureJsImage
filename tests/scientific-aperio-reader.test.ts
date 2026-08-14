import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource, type ImageSource, type ImageSourceReadOptions } from '../src/source.ts'
import { createScientificLibrary, type ScientificDataset } from '../src/scientific/index.ts'
import { aperioSvsReader, createAperioSvsReader } from '../src/scientific/readers/aperio-svs.ts'
import { tiffReader } from '../src/scientific/readers/tiff.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'

const fixturePath = 'tests/fixtures/aperio-cmu-1-small-region.svs'

class SparseVirtualSource implements ImageSource {
  readonly size: number
  readonly reads: { readonly offset: number; readonly length: number }[] = []
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array, size: number) {
    this.#bytes = bytes
    this.size = size
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    options.signal?.throwIfAborted()
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0
    ) {
      throw new Error('Invalid sparse source read')
    }
    const available = offset >= this.size ? 0 : Math.min(length, this.size - offset)
    this.reads.push({ offset, length: available })
    const output = new Uint8Array(available)
    if (offset < this.#bytes.byteLength) {
      output.set(this.#bytes.subarray(offset, Math.min(offset + available, this.#bytes.byteLength)))
    }
    return output
  }
}

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
  it('detects and lazily reads a virtual slide larger than ordinary image limits', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const source = new SparseVirtualSource(bytes, defaultImageLimits.maxInputBytes + 1)
    const library = createScientificLibrary({ readers: [tiffReader, aperioSvsReader] })
    const document = await library.open({
      primary: { id: 'large-slide', name: 'large.svs', source },
      probeLimits: {
        maxTotalBytes: 4 * 1_024 * 1_024,
        maxTotalReads: 4_096,
        maxReadBytes: 1_048_576,
      },
    })
    expect(document.reader.id).toBe(aperioSvsReader.descriptor.id)
    const pyramid = await document.openDataset('pyramid')
    expect(await firstRegionHash(pyramid)).toBe(
      await firstRegionHash(
        await createScientificLibrary({ readers: [aperioSvsReader] })
          .open({
            primary: { id: 'small-slide', name: 'small.svs', source: new MemorySource(bytes) },
            readerId: aperioSvsReader.descriptor.id,
          })
          .then((opened) => opened.openDataset('pyramid')),
      ),
    )
    expect(source.reads.length).toBeGreaterThan(0)
    expect(Math.max(...source.reads.map(({ length }) => length))).toBeLessThanOrEqual(1_048_576)
    expect(source.reads.reduce((total, { length }) => total + length, 0)).toBeLessThan(source.size)
  })

  it('propagates probe cancellation and rejects oversized regions before TIFF decode', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const abort = new AbortController()
    abort.abort(new DOMException('cancel Aperio probe', 'AbortError'))
    await expect(
      aperioSvsReader.probe({
        primary: { id: 'cancelled', name: 'cancelled.svs', source: new MemorySource(bytes) },
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    const source = new SparseVirtualSource(bytes, bytes.byteLength)
    const reader = createAperioSvsReader({ limits: { maxRegionPixels: 100 } })
    const document = await createScientificLibrary({ readers: [reader] }).open({
      primary: { id: 'limited', name: 'limited.svs', source },
      readerId: reader.descriptor.id,
    })
    const pyramid = await document.openDataset('pyramid')
    const readsBefore = source.reads.length
    const oversized = async (): Promise<void> => {
      for await (const block of pyramid.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        width: 64,
        height: 48,
      })) {
        block.release?.()
      }
    }
    await expect(oversized()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(source.reads).toHaveLength(readsBefore)
  })

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
    expect(summary?.descriptor.axes.map(({ id, calibration }) => ({ id, calibration }))).toEqual([
      {
        id: 'x',
        calibration: {
          kind: 'embedded',
          resourceId: 'local-slide',
          locator: 'tiff:ifd:0/tag:270/aperio.MPP',
        },
      },
      {
        id: 'y',
        calibration: {
          kind: 'embedded',
          resourceId: 'local-slide',
          locator: 'tiff:ifd:0/tag:270/aperio.MPP',
        },
      },
    ])
    expect(remote.datasets[0]?.descriptor.axes[0]?.calibration?.resourceId).toBe('remote-slide')
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
