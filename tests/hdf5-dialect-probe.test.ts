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
})
