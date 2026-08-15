import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import { createGeneratedNcemEmdFixture } from '../benchmark/ncem-emd/generated-fixture.ts'
import { createGeneratedVeloxEmdFixture } from '../benchmark/velox-emd/generated-fixture.ts'
import { probeHdf5Signature } from '../src/scientific/formats/hdf5.ts'
import {
  type ScientificOpenContext,
  type ScientificReader,
  ScientificReaderRegistry,
} from '../src/scientific/reader.ts'
import * as allScientificReaders from '../src/scientific/readers/all.ts'
import { ncemEmdReader } from '../src/scientific/readers/ncem-emd.ts'
import { veloxEmdReader } from '../src/scientific/readers/velox-emd.ts'
import { MemorySource, type ImageSource, type ImageSourceReadOptions } from '../src/source.ts'

class SparseZeroSource implements ImageSource {
  readonly size: number
  readonly reads: Array<Readonly<{ readonly offset: number; readonly length: number }>> = []

  constructor(size: number) {
    this.size = size
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    if (options.signal?.aborted === true) throw options.signal.reason
    this.reads.push(Object.freeze({ offset, length }))
    return new Uint8Array(Math.max(0, Math.min(length, this.size - offset)))
  }
}

const reader = (id: string, confidence = 0): ScientificReader =>
  Object.freeze({
    descriptor: Object.freeze({
      id,
      version: '1.0.0',
      format: id,
      extensions: Object.freeze([]),
      mediaTypes: Object.freeze([]),
      capabilities: Object.freeze({}),
    }),
    async probe(context: Readonly<ScientificOpenContext>) {
      await context.primary.source.read(0, 1)
      return Object.freeze({ confidence })
    },
    async open() {
      throw new Error('Probe-only test reader cannot open documents')
    },
  })

const isScientificReader = (value: unknown): value is ScientificReader =>
  typeof value === 'object' &&
  value !== null &&
  'descriptor' in value &&
  'probe' in value &&
  'open' in value

const allReaders = Object.values(allScientificReaders).filter(isScientificReader)

describe('HDF5 dialect probe budget', () => {
  it('checks legal signature offsets directly and honors a strict offset ceiling', async () => {
    const fixture = createGeneratedHdf5Fixture({ version: 2, userBlockBytes: 2_048 })
    const source = new MemorySource(fixture.bytes)
    await expect(probeHdf5Signature(source, { maxOffsets: 3 })).resolves.toBeUndefined()
    await expect(probeHdf5Signature(source, { maxOffsets: 4 })).resolves.toBe(2_048)
  })

  it('rejects a sparse 256 MiB non-HDF5 source without exhausting shared detection limits', async () => {
    const source = new SparseZeroSource(256 * 1_024 * 1_024)
    const registry = new ScientificReaderRegistry([ncemEmdReader, veloxEmdReader])
    await expect(
      registry.detect({ primary: { id: 'large', name: 'large.mrc', source } }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
    expect(source.reads).toEqual([
      { offset: 0, length: 8 },
      { offset: 0, length: 8 },
    ])
  })

  it('detects NCEM and Velox fixtures with both dialect readers under default limits', async () => {
    const registry = new ScientificReaderRegistry([ncemEmdReader, veloxEmdReader])
    const ncem = createGeneratedNcemEmdFixture({ acquisitionMetadata: true })
    await expect(
      registry.detect({
        primary: { id: 'ncem', name: 'ncem.emd', source: new MemorySource(ncem.bytes) },
      }),
    ).resolves.toMatchObject({ reader: { id: 'purejsimage/ncem-emd' } })

    const velox = createGeneratedVeloxEmdFixture()
    await expect(
      registry.detect({
        primary: { id: 'velox', name: 'velox.emd', source: new MemorySource(velox.bytes) },
      }),
    ).resolves.toMatchObject({ reader: { id: 'purejsimage/velox-emd' } })
  })

  it('passes a discovered 32 KiB user-block offset through both dialect openers', async () => {
    const registry = new ScientificReaderRegistry([ncemEmdReader, veloxEmdReader])
    const ncem = createGeneratedNcemEmdFixture({ userBlockBytes: 32_768 })
    await expect(
      registry.detect({
        primary: { id: 'ncem-user-block', name: 'ncem.emd', source: new MemorySource(ncem.bytes) },
      }),
    ).resolves.toMatchObject({ reader: { id: 'purejsimage/ncem-emd' } })

    const velox = createGeneratedVeloxEmdFixture({ userBlockBytes: 32_768 })
    await expect(
      registry.detect({
        primary: {
          id: 'velox-user-block',
          name: 'velox.emd',
          source: new MemorySource(velox.bytes),
        },
      }),
    ).resolves.toMatchObject({ reader: { id: 'purejsimage/velox-emd' } })
  })

  it('rejects a valid unrelated HDF5 hierarchy without exhausting detection limits', async () => {
    const registry = new ScientificReaderRegistry([ncemEmdReader, veloxEmdReader])
    const fixture = createGeneratedHdf5Fixture({ version: 2, userBlockBytes: 32_768 })
    await expect(
      registry.detect({
        primary: {
          id: 'generic-hdf5',
          name: 'generic.h5',
          source: new MemorySource(fixture.bytes),
        },
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
  })

  it('preserves enough default read budget for a format at the end of a broad registry', async () => {
    const readers: ScientificReader[] = [ncemEmdReader, veloxEmdReader]
    for (let index = 0; index < 29; index += 1) readers.push(reader(`test/no-match-${index}`))
    readers.push(reader('test/final-match', 1))
    const detection = await new ScientificReaderRegistry(readers).detect({
      primary: { id: 'late', name: 'late.bin', source: new SparseZeroSource(1_024) },
    })
    expect(detection).toMatchObject({
      reader: { id: 'test/final-match' },
      stats: { readers: 32, reads: 32 },
    })
  })

  it('runs the actual all-reader registry against a late X3P match within defaults', async () => {
    expect(allReaders).toHaveLength(31)
    const bytes = Uint8Array.from(
      readFileSync('tests/fixtures/scientific-surface/iso5436-sample1.x3p'),
    )
    const detection = await new ScientificReaderRegistry(allReaders).detect({
      primary: {
        id: 'surface',
        name: 'iso5436-sample1.x3p',
        source: new MemorySource(bytes),
      },
    })
    expect(detection).toMatchObject({
      reader: { id: 'purejsimage/x3p' },
      stats: { readers: 31, reads: 31 },
    })
  })
})
