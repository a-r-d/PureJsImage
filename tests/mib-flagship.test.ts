import { describe, expect, it } from 'vitest'
import { createGeneratedFourDStemFixture } from '../benchmark/four-d-stem/generated-fixture.ts'
import { createMibReader, mibReader } from '../src/scientific/readers/mib.ts'
import { getScientificDatasetIdentity, type ScientificResource } from '../src/scientific/reader.ts'
import { readRasterSample } from '../src/scientific/samples.ts'
import { MemorySource, type ImageSource, type ImageSourceReadOptions } from '../src/source.ts'

class TrackingSource implements ImageSource {
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
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    options.signal?.throwIfAborted()
    this.reads.push(Object.freeze({ offset, length }))
    return this.#bytes.slice(offset, offset + length)
  }
}

const resource = (id: string, name: string, bytes: Uint8Array): ScientificResource =>
  Object.freeze({ id, name, source: new MemorySource(bytes) })

const openFixture = async (tracking = false) => {
  const fixture = createGeneratedFourDStemFixture()
  const source = tracking ? new TrackingSource(fixture.mib) : new MemorySource(fixture.mib)
  const hdr = resource('hdr', 'fixture.hdr', fixture.hdr)
  const document = await mibReader.open({
    primary: { id: 'mib', name: 'fixture.mib', source },
    companions: {
      async resolve(request) {
        return request.kind === 'relative-name' && request.name === 'fixture.hdr' ? hdr : undefined
      },
    },
  })
  return { fixture, source, document, dataset: await document.openDataset('diffraction') }
}

const values = async (
  dataset: Awaited<ReturnType<typeof openFixture>>['dataset'],
  request: {
    readonly fixedIndices: readonly { readonly axisId: string; readonly index: number }[]
    readonly x?: number
    readonly y?: number
    readonly width?: number
    readonly height?: number
  },
): Promise<number[]> => {
  const output: number[] = []
  for await (const block of dataset.readPlane({
    displayAxes: ['kx', 'ky'],
    ...request,
  })) {
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    const bytes = block.data.byteLength / (block.width * block.height)
    for (let y = 0; y < block.height; y += 1) {
      for (let x = 0; x < block.width; x += 1) {
        output.push(
          readRasterSample(block.data, view, y * block.stride + x * bytes, block.format.sampleType),
        )
      }
    }
  }
  return output
}

const scalarMib = (code: 'U08' | 'U16' | 'U32', topDown: readonly number[]): Uint8Array => {
  const sampleBytes = code === 'U08' ? 1 : code === 'U16' ? 2 : 4
  const output = new Uint8Array(384 + topDown.length * sampleBytes)
  output.fill(0x20, 0, 384)
  output.set(new TextEncoder().encode(`MQ1,1,384,1,2,2,${code},1x1,2026-01-01,100ns,0,0`))
  const view = new DataView(output.buffer)
  const stored = [topDown[2] ?? 0, topDown[3] ?? 0, topDown[0] ?? 0, topDown[1] ?? 0]
  for (let index = 0; index < stored.length; index += 1) {
    const offset = 384 + index * sampleBytes
    if (code === 'U08') view.setUint8(offset, stored[index] ?? 0)
    else if (code === 'U16') view.setUint16(offset, stored[index] ?? 0, false)
    else view.setUint32(offset, stored[index] ?? 0, false)
  }
  return output
}

describe('flagship MIB reader matrix', () => {
  it('uses the HDR sidecar for four semantic axes and exact frame and region reads', async () => {
    const { fixture, dataset } = await openFixture()
    expect(dataset.descriptor.axes.map(({ id, kind, length }) => ({ id, kind, length }))).toEqual([
      { id: 'kx', kind: 'reciprocal-space', length: 17 },
      { id: 'ky', kind: 'reciprocal-space', length: 15 },
      { id: 'scanX', kind: 'space', length: 7 },
      { id: 'scanY', kind: 'space', length: 5 },
    ])
    await expect(
      values(dataset, {
        fixedIndices: [
          { axisId: 'scanX', index: 4 },
          { axisId: 'scanY', index: 3 },
        ],
        x: 5,
        y: 6,
        width: 3,
        height: 2,
      }),
    ).resolves.toEqual([
      fixture.valueAt(4, 3, 5, 6),
      fixture.valueAt(4, 3, 6, 6),
      fixture.valueAt(4, 3, 7, 6),
      fixture.valueAt(4, 3, 5, 7),
      fixture.valueAt(4, 3, 6, 7),
      fixture.valueAt(4, 3, 7, 7),
    ])
  })

  it.each(['U08', 'U16', 'U32'] as const)(
    'preserves %s native samples and normalizes stored bottom-up rows',
    async (code) => {
      const input = scalarMib(code, [1, 2, 70_000, 90_000])
      const document = await mibReader.open({
        primary: resource('mib', `samples-${code}.mib`, input),
      })
      const dataset = await document.openDataset('diffraction')
      const expected =
        code === 'U08'
          ? [1, 2, 112, 144]
          : code === 'U16'
            ? [1, 2, 4_464, 24_464]
            : [1, 2, 70_000, 90_000]
      await expect(
        values(dataset, { fixedIndices: [{ axisId: 'frame', index: 0 }] }),
      ).resolves.toEqual(expected)
    },
  )

  it('preserves primary and sidecar identity and performs bounded selected reads', async () => {
    const { fixture, source, document, dataset } = await openFixture(true)
    expect(document.datasets[0]?.identity.resources.map(({ id }) => id)).toEqual(['hdr', 'mib'])
    expect(getScientificDatasetIdentity(dataset)).toBe(document.datasets[0]?.identity)
    await values(dataset, {
      fixedIndices: [
        { axisId: 'scanX', index: 2 },
        { axisId: 'scanY', index: 1 },
      ],
      x: 3,
      y: 4,
      width: 2,
      height: 2,
    })
    if (!(source instanceof TrackingSource)) throw new Error('Expected tracking source')
    expect(source.reads.reduce((sum, read) => sum + read.length, 0)).toBeLessThan(
      fixture.mib.byteLength,
    )
    expect(Math.max(...source.reads.map(({ length }) => length))).toBeLessThanOrEqual(384)
  })

  it('rejects inconsistent frames, truncation, limits, and cancellation', async () => {
    const fixture = createGeneratedFourDStemFixture()
    const inconsistent = fixture.mib.slice()
    const recordBytes = 384 + 17 * 15 * 2
    inconsistent.set(new TextEncoder().encode('U32'), recordBytes + 'MQ1,2,384,1,17,15,'.length)
    const document = await mibReader.open({ primary: resource('mib', 'bad.mib', inconsistent) })
    const dataset = await document.openDataset('diffraction')
    await expect(
      values(dataset, { fixedIndices: [{ axisId: 'frame', index: 1 }] }),
    ).rejects.toThrow(/frame headers disagree/u)
    await expect(
      mibReader.open({ primary: resource('mib', 'truncated.mib', fixture.mib.slice(0, -1)) }),
    ).rejects.toThrow(/incomplete frame/u)
    await expect(
      createMibReader({ limits: { maxFrames: 2 } }).open({
        primary: resource('mib', 'limited.mib', fixture.mib),
      }),
    ).rejects.toThrow(/frame count/u)
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      mibReader.open({
        primary: resource('mib', 'cancelled.mib', fixture.mib),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
