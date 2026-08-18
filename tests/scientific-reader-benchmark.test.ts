import { describe, expect, it } from 'vitest'

import { prepareScientificFixture } from '../benchmark/scientific-readers/catalog.ts'
import { allScientificReaders } from '../benchmark/scientific-readers/registry.ts'
import {
  CountingImageSource,
  FragmentingImageSource,
  LatencyImageSource,
} from '../benchmark/scientific-readers/sources.ts'
import { scientificReaderWorkloads } from '../benchmark/scientific-readers/workloads.ts'
import { type ImageSource, type ImageSourceReadOptions, MemorySource } from '../src/source.ts'

class CountingBackingSource implements ImageSource {
  readonly size: number
  readonly reads: { readonly offset: number; readonly length: number }[] = []
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  async read(
    offset: number,
    length: number,
    _options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    this.reads.push(Object.freeze({ offset, length }))
    return this.#bytes.slice(offset, Math.min(this.size, offset + length))
  }
}

describe('scientific reader benchmark harness', () => {
  it('records unique source coverage separately from requested bytes', async () => {
    const counted = new CountingImageSource(new MemorySource(Uint8Array.from([1, 2, 3, 4, 5, 6])))
    await counted.read(0, 4)
    await counted.read(2, 4)
    expect(counted.snapshot).toMatchObject({
      readCalls: 2,
      requestedBytes: 8,
      returnedBytes: 8,
      uniqueSourceBytesTouched: 6,
      largestIndividualReadBytes: 4,
    })
  })

  it('fragments reads without changing the ImageSource contract', async () => {
    const backing = new CountingBackingSource(Uint8Array.from([10, 11, 12, 13, 14]))
    const fragmented = new FragmentingImageSource(backing, 2)
    await expect(fragmented.read(1, 4)).resolves.toEqual(Uint8Array.from([11, 12, 13, 14]))
    expect(backing.reads).toEqual([
      { offset: 1, length: 2 },
      { offset: 3, length: 2 },
    ])
  })

  it('applies latency once to coalesced exact reads and returns stable copies', async () => {
    const backing = new CountingBackingSource(Uint8Array.from([1, 2, 3, 4]))
    const source = new LatencyImageSource(backing, 1)
    const [first, second] = await Promise.all([source.read(0, 4), source.read(0, 4)])
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(backing.reads).toHaveLength(1)
    first[0] = 99
    await expect(source.read(0, 4)).resolves.toEqual(Uint8Array.from([1, 2, 3, 4]))
    expect(backing.reads).toHaveLength(2)
  })

  it('keeps source-I/O metrics identical at 0 ms and 25 ms latency', async () => {
    const sequence = async (latency: number) => {
      const backing = new CountingBackingSource(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))
      const source = new LatencyImageSource(backing, latency)
      await source.read(0, 4)
      await source.read(2, 4)
      await source.read(0, 4)
      return backing.reads
    }
    expect(await sequence(0)).toEqual(await sequence(25))
  })

  it('keeps the public reader inventory and workload coverage explicit', () => {
    const workloadReaders = new Set(scientificReaderWorkloads.map((workload) => workload.readerId))
    for (const reader of allScientificReaders)
      expect(workloadReaders).toContain(reader.descriptor.id)
    expect(allScientificReaders).toHaveLength(32)
  })

  it('keeps microfixtures as contract tests and isolates representative scaling workloads', () => {
    const scaling = scientificReaderWorkloads.filter(({ profiles }) => profiles.includes('scaling'))
    const baselineOnly = scientificReaderWorkloads.filter(
      ({ profiles }) => profiles.includes('baseline') && !profiles.includes('scaling'),
    )
    expect(scaling.length).toBeGreaterThanOrEqual(10)
    expect(
      scaling.every(
        ({ detectionMode, measurementClass }) =>
          detectionMode === 'explicit' && measurementClass === 'representative',
      ),
    ).toBe(true)
    expect(
      baselineOnly.every(({ measurementClass }) => measurementClass === 'correctness-only'),
    ).toBe(true)
  })

  it('prepares deterministic generated companion fixtures with hashes', async () => {
    const fixture = await prepareScientificFixture('meta-image-mhd')
    expect(fixture.resources).toHaveLength(2)
    expect(fixture.resources[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(fixture.resources[1]?.sizeBytes).toBe(4)
  })
})
