import { describe, expect, it } from 'vitest'

import type { RasterBlock } from '../src/raster.ts'
import {
  MemorySource,
  type ImageSource,
  sourceSessionEnd,
  sourceSessionStart,
} from '../src/source.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificCompanionRequest,
  ScientificDataset,
  ScientificDocument,
  ScientificOpenContext,
  ScientificPlaneReadRequest,
  ScientificProbeResult,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificRelativeName,
  ScientificReaderRegistry,
} from '../src/scientific/index.ts'

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 1,
  axes: [
    { id: 'x', kind: 'space', length: 2, coordinates: { type: 'index' } },
    { id: 'y', kind: 'space', length: 1, coordinates: { type: 'index' } },
  ],
  sampleType: 'uint8',
  components: [{ id: 'value', kind: 'scalar' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
})

class LazyDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  reads = 0

  constructor(datasetDescriptor = descriptor) {
    this.descriptor = datasetDescriptor
  }

  async *readPlane(_request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
    this.reads += 1
    yield {
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      stride: 2,
      format: { sampleType: 'uint8', channels: 1, planar: false },
      data: Uint8Array.of(1, 2),
    }
  }
}

const documentFor = (
  reader: ScientificReaderDescriptor,
  dataset: ScientificDataset = new LazyDataset(),
): ScientificDocument =>
  Object.freeze({
    reader: Object.freeze({ id: reader.id, version: reader.version }),
    format: reader.format,
    metadata: Object.freeze({ title: 'Synthetic document' }),
    datasets: Object.freeze([
      Object.freeze({
        id: 'image-0',
        name: 'Image 0',
        descriptor: dataset.descriptor,
        identity: Object.freeze({
          kind: 'scientific-dataset',
          reader: Object.freeze({ id: reader.id, version: reader.version }),
          datasetId: 'image-0',
          resources: Object.freeze([
            Object.freeze({
              id: 'primary',
              identity: Object.freeze({
                kind: 'session',
                strength: 'session',
                stability: 'instance',
                id: 'synthetic-reader-test',
                size: 2,
              }),
            }),
          ]),
        }),
      }),
    ]),
    async openDataset(id: string) {
      if (id !== 'image-0') throw new Error(`Unknown dataset ${id}`)
      return dataset
    },
  })

interface MockReaderOptions {
  readonly id: string
  readonly version?: string
  readonly confidence?: number
  readonly reason?: string
  readonly probe?: (context: Readonly<ScientificOpenContext>) => Promise<ScientificProbeResult>
  readonly open?: (context: Readonly<ScientificOpenContext>) => Promise<ScientificDocument>
}

const mockReader = (options: Readonly<MockReaderOptions>): ScientificReader => {
  const readerDescriptor: ScientificReaderDescriptor = Object.freeze({
    id: options.id,
    version: options.version ?? '1.0.0',
    format: `Format ${options.id}`,
    extensions: Object.freeze(['dat']),
    mediaTypes: Object.freeze(['application/x-scientific-test']),
    capabilities: Object.freeze({ multiResource: false }),
  })
  return Object.freeze({
    descriptor: readerDescriptor,
    probe:
      options.probe ??
      (async () =>
        Object.freeze({
          confidence: options.confidence ?? 0,
          ...(options.reason === undefined ? {} : { reason: options.reason }),
        })),
    open: options.open ?? (async () => documentFor(readerDescriptor)),
  })
}

const context = (
  source: ImageSource = new MemorySource(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)),
  overrides: Partial<ScientificOpenContext> = {},
): ScientificOpenContext => ({
  primary: { id: 'primary', name: 'sample.dat', source },
  ...overrides,
})

describe('ScientificReaderRegistry detection', () => {
  it('probes in registration order and selects the unique highest confidence', async () => {
    const order: string[] = []
    const first = mockReader({
      id: 'test/first',
      async probe(openContext) {
        order.push('first')
        await openContext.primary.source.read(0, 2)
        return { confidence: 0.4, reason: 'weak header' }
      },
    })
    const second = mockReader({
      id: 'test/second',
      async probe(openContext) {
        order.push('second')
        await openContext.primary.source.read(2, 2)
        return { confidence: 0.9, reason: 'strong header' }
      },
    })
    const registry = new ScientificReaderRegistry([first, second])

    await expect(registry.detect(context())).resolves.toEqual({
      reader: expect.objectContaining({ id: 'test/second', version: '1.0.0' }),
      confidence: 0.9,
      reason: 'strong header',
      stats: { readers: 2, reads: 2, bytes: 4, companionResolutions: 0 },
    })
    expect(order).toEqual(['first', 'second'])
    expect(registry.descriptors.map(({ id }) => id)).toEqual(['test/first', 'test/second'])
    expect(Object.isFrozen(registry.descriptors)).toBe(true)
    expect(Object.isFrozen(registry.descriptors[0]?.capabilities)).toBe(true)
  })

  it('rejects ambiguous top confidence and a complete no-match result', async () => {
    const ambiguous = new ScientificReaderRegistry([
      mockReader({ id: 'test/one', confidence: 0.75 }),
      mockReader({ id: 'test/two', confidence: 0.75 }),
      mockReader({ id: 'test/lower', confidence: 0.5 }),
    ])
    await expect(ambiguous.detect(context())).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
      message: expect.stringContaining('ambiguous'),
    })

    const noMatch = new ScientificReaderRegistry([mockReader({ id: 'test/zero', confidence: 0 })])
    await expect(noMatch.detect(context())).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
      message: expect.stringContaining('No registered scientific reader matched'),
    })
  })

  it('rejects duplicate reader id/version pairs and disambiguates explicit versions', async () => {
    const versionOne = mockReader({ id: 'test/versioned', version: '1.0.0', confidence: 0.4 })
    expect(() => new ScientificReaderRegistry([versionOne, versionOne])).toThrow(
      'Duplicate scientific reader test/versioned@1.0.0',
    )

    let probes = 0
    const versionTwo = mockReader({
      id: 'test/versioned',
      version: '2.0.0',
      async probe() {
        probes += 1
        return { confidence: 1 }
      },
    })
    const registry = new ScientificReaderRegistry([versionOne, versionTwo])
    await expect(
      registry.detect(context(undefined, { readerId: 'test/versioned' })),
    ).rejects.toThrow('multiple registered versions')
    await expect(
      registry.detect(context(undefined, { readerId: 'test/versioned', readerVersion: '2.0.0' })),
    ).resolves.toMatchObject({
      reader: { id: 'test/versioned', version: '2.0.0' },
      confidence: 1,
      stats: { readers: 0, reads: 0, bytes: 0, companionResolutions: 0 },
    })
    expect(probes).toBe(0)
  })
})

describe('scientific probe budgets', () => {
  it('shares byte and read budgets across readers before underlying I/O', async () => {
    let underlyingReads = 0
    const source: ImageSource = {
      size: 16,
      async read(offset, length) {
        underlyingReads += 1
        return new Uint8Array(length).fill(offset)
      },
    }
    const first = mockReader({
      id: 'budget/first',
      async probe(openContext) {
        await openContext.primary.source.read(0, 4)
        return { confidence: 0.1 }
      },
    })
    const second = mockReader({
      id: 'budget/second',
      async probe(openContext) {
        await openContext.primary.source.read(4, 5)
        return { confidence: 0.2 }
      },
    })
    const registry = new ScientificReaderRegistry([first, second])
    await expect(
      registry.detect(
        context(source, {
          probeLimits: {
            maxTotalBytes: 8,
            maxTotalReads: 2,
            maxReaders: 2,
            maxReadBytes: 8,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(underlyingReads).toBe(1)

    const twoReads = mockReader({
      id: 'budget/reads',
      async probe(openContext) {
        await openContext.primary.source.read(0, 1)
        await openContext.primary.source.read(0, 1)
        return { confidence: 1 }
      },
    })
    await expect(
      new ScientificReaderRegistry([twoReads]).detect(
        context(source, {
          probeLimits: { maxTotalReads: 1, maxTotalBytes: 8, maxReaders: 1, maxReadBytes: 8 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('enforces per-read and reader-count limits before probes can overrun them', async () => {
    let probes = 0
    const wholeFile = mockReader({
      id: 'budget/whole-file',
      async probe(openContext) {
        probes += 1
        await openContext.primary.source.read(0, openContext.primary.source.size)
        return { confidence: 1 }
      },
    })
    await expect(
      new ScientificReaderRegistry([wholeFile]).detect(
        context(new MemorySource(new Uint8Array(64)), {
          probeLimits: {
            maxReadBytes: 8,
            maxTotalBytes: 64,
            maxTotalReads: 8,
            maxReaders: 1,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(probes).toBe(1)

    probes = 0
    const counting = (id: string) =>
      mockReader({
        id,
        async probe() {
          probes += 1
          return { confidence: 0 }
        },
      })
    await expect(
      new ScientificReaderRegistry([counting('budget/a'), counting('budget/b')]).detect(
        context(undefined, { probeLimits: { maxReaders: 1 } }),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(probes).toBe(0)
  })

  it('counts primary and companion reads in the same detection budget', async () => {
    const requests: ScientificCompanionRequest[] = []
    const reader = mockReader({
      id: 'test/multi-resource',
      async probe(openContext) {
        await openContext.primary.source.read(0, 2)
        const companion = await openContext.companions?.resolve({
          kind: 'role',
          role: 'data',
          relativeName: 'folder/sample.raw',
        })
        if (companion === undefined) return { confidence: 0, reason: 'missing data' }
        await companion.source.read(0, 3)
        return { confidence: 1, reason: 'header and data' }
      },
    })
    const registry = new ScientificReaderRegistry([reader])
    const detection = await registry.detect(
      context(undefined, {
        companions: {
          async resolve(request) {
            requests.push(request)
            return {
              id: 'data',
              name: 'folder/sample.raw',
              source: new MemorySource(Uint8Array.of(9, 8, 7, 6)),
            }
          },
        },
      }),
    )
    expect(detection.stats).toEqual({ readers: 1, reads: 2, bytes: 5, companionResolutions: 1 })
    expect(requests).toEqual([{ kind: 'role', role: 'data', relativeName: 'folder/sample.raw' }])
  })

  it('rejects probe sources that return excess bytes and bounds companion resolution calls', async () => {
    const excess: ImageSource = {
      size: 16,
      async read() {
        return new Uint8Array(8)
      },
    }
    const reading = mockReader({
      id: 'test/excess-read',
      async probe(openContext) {
        await openContext.primary.source.read(0, 1)
        return { confidence: 1 }
      },
    })
    await expect(new ScientificReaderRegistry([reading]).detect(context(excess))).rejects.toThrow(
      'returned 8 bytes',
    )

    const resolving = mockReader({
      id: 'test/excess-companions',
      async probe(openContext) {
        await openContext.companions?.resolve({ kind: 'role', role: 'first' })
        await openContext.companions?.resolve({ kind: 'role', role: 'second' })
        return { confidence: 0 }
      },
    })
    await expect(
      new ScientificReaderRegistry([resolving]).detect(
        context(undefined, {
          companions: { resolve: async () => undefined },
          probeLimits: { maxCompanionResolutions: 1 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})

describe('scientific reader lifecycle', () => {
  it('propagates cancellation even when a probe omits per-read options', async () => {
    let started: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const source: ImageSource = {
      size: 8,
      async read(_offset, _length, options) {
        started?.()
        return new Promise<Uint8Array>((_resolve, reject) => {
          const signal = options?.signal
          if (signal === undefined) {
            reject(new Error('Expected bound AbortSignal'))
            return
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    }
    const reader = mockReader({
      id: 'test/cancellable',
      async probe(openContext) {
        await openContext.primary.source.read(0, 1)
        return { confidence: 1 }
      },
    })
    const controller = new AbortController()
    const detection = new ScientificReaderRegistry([reader]).detect(
      context(source, { signal: controller.signal }),
    )
    await readStarted
    controller.abort(new Error('stop detection'))
    await expect(detection).rejects.toThrow('stop detection')
  })

  it('holds and releases source sessions around detection and open', async () => {
    let starts = 0
    let ends = 0
    const source: ImageSource & {
      [sourceSessionStart](): void
      [sourceSessionEnd](): Promise<void>
    } = {
      size: 4,
      [sourceSessionStart]() {
        starts += 1
      },
      async [sourceSessionEnd]() {
        ends += 1
      },
      async read(offset, length) {
        return Uint8Array.of(1, 2, 3, 4).subarray(offset, offset + length)
      },
    }
    const reader = mockReader({
      id: 'test/session',
      async probe(openContext) {
        await openContext.primary.source.read(0, 1)
        return { confidence: 1 }
      },
    })
    await new ScientificReaderRegistry([reader]).open(context(source))
    expect({ starts, ends }).toEqual({ starts: 2, ends: 2 })
  })

  it('enumerates document summaries and opens a dataset without reading pixels', async () => {
    const dataset = new LazyDataset()
    let opens = 0
    const reader = mockReader({
      id: 'test/document',
      confidence: 1,
      async open() {
        opens += 1
        return documentFor(reader.descriptor, dataset)
      },
    })
    const registry = new ScientificReaderRegistry([reader])
    const document = await registry.open(context())
    expect(document.datasets).toEqual([
      {
        id: 'image-0',
        name: 'Image 0',
        descriptor: dataset.descriptor,
        identity: expect.objectContaining({
          kind: 'scientific-dataset',
          reader: { id: 'test/document', version: '1.0.0' },
          datasetId: 'image-0',
        }),
      },
    ])
    expect(dataset.reads).toBe(0)
    await expect(document.openDataset('image-0')).resolves.toBe(dataset)
    expect(dataset.reads).toBe(0)
    expect(opens).toBe(1)
  })

  it('rejects path traversal and absolute companion names in portable code', () => {
    expect(normalizeScientificRelativeName('folder/data.raw')).toBe('folder/data.raw')
    for (const unsafe of ['../data.raw', 'folder/../data.raw', '/data.raw', 'C:/data.raw']) {
      expect(() => normalizeScientificRelativeName(unsafe)).toThrow()
    }
  })
})
