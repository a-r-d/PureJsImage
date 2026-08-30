import { describe, expect, it } from 'vitest'
import {
  createEvidenceSession,
  explainImage,
  instrumentImageSource,
  type EvidenceClock,
} from '../src/evidence.ts'
import {
  bindImageSourceSignal,
  drainSourceEvidenceDependencies,
  MemorySource,
  sourceSessionEnd,
  sourceSessionStart,
  stableSourceBuffers,
} from '../src/source.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'
import { imageSourceIdentity } from '../src/source-identity.ts'
import { createImageLibrary } from '../src/image.ts'
import { netpbmCodec } from '../src/codecs/netpbm.ts'
import { pngCodec } from '../src/codecs/png.ts'

class FakeClock implements EvidenceClock {
  value = 1
  now(): number {
    return this.value
  }
}

describe('execution evidence', () => {
  it('validates public limits and event fields before retaining them', () => {
    expect(() => createEvidenceSession({ limits: { maxEvents: 0 } })).toThrow(
      'positive safe integer',
    )
    const session = createEvidenceSession({ mode: 'trace' })
    expect(() =>
      session.context.logicalRead({
        offset: Number.NaN,
        requestedBytes: 1,
        returnedBytes: 1,
        outcome: 'complete',
      }),
    ).toThrow('Logical read offset')
    expect(() =>
      session.context.operation({
        operationId: 'decode',
        phase: 'planned',
        detail: 'x'.repeat(1_025),
      }),
    ).toThrow('1 to 1024 characters')
    session.context.dependency({
      outputId: 'tile',
      inputIds: Array<string>(257).fill('block'),
      granularity: 'tile',
    })
    expect(() =>
      session.context.operation({
        operationId: 'decode',
        phase: 'complete',
        failureCode: 'INVALID_INPUT',
      }),
    ).toThrow('requires the failed phase')
    const report = session.finalize()
    expect(report.dependencies[0]?.inputIds).toHaveLength(256)
    expect(report.session.droppedEvents).toBe(1)
    expect(report.session.warnings).toContain(
      'dependency-input-limit: Evidence dependency input detail was truncated',
    )
  })

  it('aggregates deterministic logical reads without retaining events in summary mode', async () => {
    const clock = new FakeClock()
    const session = createEvidenceSession({ mode: 'summary', id: 'summary', clock })
    const source = instrumentImageSource(
      new MemorySource(Uint8Array.of(1, 2, 3, 4)),
      session.context,
    )
    expect([...(await source.read(1, 2))]).toEqual([2, 3])
    clock.value = 2
    const report = session.finalize()
    expect(report.session.endMicroseconds).toBe(1_000)
    expect(report.logicalReads).toMatchObject({
      count: 1,
      requestedBytes: 2,
      returnedBytes: 2,
      uniqueBytes: 2,
    })
    expect(report.events).toBeUndefined()
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
  })

  it('retains bounded operation, provider, and cancellation aggregates in summary mode', () => {
    const session = createEvidenceSession({ mode: 'summary' })
    session.context.operation({ operationId: 'decode', phase: 'start' })
    session.context.operation({ operationId: 'decode', phase: 'complete' })
    session.context.provider({
      operationId: 'decode',
      semanticVersion: 1,
      providerId: 'pure-js',
      buildFingerprint: 'fixture',
      reproducibilityClass: 'bit-exact',
    })
    session.context.cancellation('viewport-read')
    const report = session.finalize('cancelled')
    expect(report.events).toBeUndefined()
    expect(report.operations).toEqual([
      expect.objectContaining({ operationId: 'decode', phase: 'start', count: 1 }),
      expect.objectContaining({ operationId: 'decode', phase: 'complete', count: 1 }),
    ])
    expect(report.providers).toEqual([
      expect.objectContaining({ operationId: 'decode', providerId: 'pure-js', count: 1 }),
    ])
    expect(report.cancellations).toEqual([
      expect.objectContaining({ target: 'viewport-read', count: 1 }),
    ])
  })

  it('rejects invalid final status and all collector reuse after finalization', () => {
    const session = createEvidenceSession({ mode: 'trace' })
    const lease = session.context.allocate('working-row', 16)
    expect(() => Reflect.apply(session.finalize, undefined, ['invalid'])).toThrow(
      'status must be complete, cancelled, or failed',
    )

    session.finalize()

    expect(() => session.context.nowMicroseconds()).toThrow('already finalized')
    expect(() => session.context.child('late-work')).toThrow('already finalized')
    expect(() => session.context.operation({ operationId: 'late-work', phase: 'start' })).toThrow(
      'already finalized',
    )
    expect(() => lease.release()).toThrow('already finalized')
    expect(() => session.subscribe(() => undefined)).toThrow('already finalized')
    expect(() => session.finalize()).toThrow('already finalized')
  })

  it('bounds trace events while aggregate counters continue', async () => {
    const session = createEvidenceSession({ mode: 'trace', limits: { maxEvents: 1 } })
    const source = instrumentImageSource(new MemorySource(Uint8Array.of(1, 2, 3)), session.context)
    await source.read(0, 1)
    await source.read(1, 1)
    const report = session.finalize()
    expect(report.logicalReads.count).toBe(2)
    expect(report.sources).toHaveLength(1)
    expect(report.events).toHaveLength(1)
    expect(report.session.droppedEvents).toBe(1)
    expect(report.session.warnings).toContain(
      'event-limit: Detailed evidence limit reached; aggregates remain active',
    )
  })

  it('removes a failing live subscriber without failing image work', async () => {
    const session = createEvidenceSession({ mode: 'trace' })
    let calls = 0
    session.subscribe(() => {
      calls += 1
      throw new Error('viewer closed')
    })
    const source = instrumentImageSource(new MemorySource(Uint8Array.of(1, 2)), session.context)
    await expect(source.read(0, 1)).resolves.toEqual(Uint8Array.of(1))
    await expect(source.read(1, 1)).resolves.toEqual(Uint8Array.of(2))
    const report = session.finalize()
    expect(calls).toBe(1)
    expect(report.session.warnings).toContain(
      'subscriber-failure: A failing evidence subscriber was removed',
    )
  })

  it('bounds child scopes and interned labels without failing instrumented work', () => {
    const session = createEvidenceSession({
      mode: 'trace',
      limits: { maxChildSpans: 2, maxLabels: 1 },
    })
    const first = session.context.child('decode')
    const second = session.context.child('resize')
    const overflow = second.child('encode')
    first.operation({ operationId: 'decode', phase: 'start' })
    overflow.operation({ operationId: 'encode', phase: 'complete' })
    const report = session.finalize()
    expect(report.scopes).toEqual([
      { id: 1, parentId: 0, label: 'decode' },
      { id: 2, parentId: 0 },
    ])
    expect(report.session).toMatchObject({ droppedLabels: 1, droppedChildSpans: 1 })
    expect(report.session.warnings).toEqual(
      expect.arrayContaining([
        'label-limit: Evidence label limit reached',
        'child-span-limit: Child evidence span limit reached',
      ]),
    )
    expect(report.events?.at(-1)).toMatchObject({ scopeId: 2, operationId: 'encode' })
  })

  it('marks unique coverage as estimated when bounded range detail overflows', () => {
    const session = createEvidenceSession({ mode: 'summary', limits: { maxSourceRanges: 1 } })
    session.context.logicalRead({
      offset: 0,
      requestedBytes: 1,
      returnedBytes: 1,
      outcome: 'complete',
    })
    session.context.logicalRead({
      offset: 4,
      requestedBytes: 1,
      returnedBytes: 1,
      outcome: 'complete',
    })
    const report = session.finalize()
    expect(report.logicalReads).toMatchObject({
      count: 2,
      returnedBytes: 2,
      uniqueBytes: 1,
      uniqueBytesMeasurement: 'estimated',
    })
    expect(report.session.droppedRanges).toBe(1)
    expect(report.session.warnings).toContain('range-limit: Source range detail was truncated')
  })

  it('measures overfetch as physical coverage outside the logical union', () => {
    const session = createEvidenceSession({ mode: 'summary' })
    session.context.logicalRead({
      offset: 20,
      requestedBytes: 5,
      returnedBytes: 5,
      outcome: 'complete',
    })
    session.context.physicalTransfer({
      start: 0,
      end: 10,
      transferredBytes: 10,
      status: 206,
      durationMicroseconds: 5,
      firstByteMicroseconds: 2,
      outcome: 'complete',
    })
    const report = session.finalize()
    expect(report.physicalTransfers).toMatchObject({
      uniqueBytes: 10,
      overfetchBytes: 10,
      firstByte: { measurement: 'measured', minimumMicroseconds: 2 },
    })
  })

  it('accounts managed leases and detects double release and leaks', () => {
    const session = createEvidenceSession({
      mode: 'trace',
      limits: { maxAllocationLeases: 1 },
    })
    const released = session.context.allocate('tile-cache', 64)
    const leaked = session.context.allocate('decoded-pixel-block', 32)
    released.release()
    expect(() => released.release()).toThrow('released twice')
    const report = session.finalize()
    expect(report.managedMemory).toMatchObject({
      allocationCount: 2,
      releaseCount: 1,
      currentLiveBytes: 32,
      peakLiveBytes: 96,
      stillLiveLeases: 1,
    })
    expect(report.session.droppedAllocations).toBe(1)
    expect(leaked.bytes).toBe(32)
  })

  it('keeps mixed managed allocation kinds safe after the label cap fills', () => {
    const session = createEvidenceSession({ mode: 'summary', limits: { maxLabels: 1 } })
    const buffer = session.context.allocate('buffer-a', 4)
    const cache = session.context.allocate('cache-b', 8, 'cache')
    const temporary = session.context.allocate('temporary-c', 16, 'temporary-storage')
    buffer.release()
    cache.release()
    temporary.release()
    const report = session.finalize()
    expect(report.managedMemory.currentLiveBytes).toBe(0)
    expect(Object.keys(report.managedMemory.categories)).toEqual([
      '[other-cache]',
      '[other-temporary-storage]',
      'buffer-a',
    ])
    expect(report.session.warnings).toContain('label-limit: Evidence label limit reached')
  })

  it('redacts signed URL queries and local paths by default', () => {
    const session = createEvidenceSession({ mode: 'summary' })
    session.context.source({
      kind: 'remote',
      strength: 'weak',
      stability: 'best-effort',
      url: 'https://example.test/image.tif?X-Amz-Signature=secret',
      size: 12,
    })
    session.context.source({
      kind: 'local-file',
      strength: 'weak',
      stability: 'metadata',
      nameOrPath: '/private/patient/alice.tif',
      size: 12,
      lastModified: 1,
    })
    const json = JSON.stringify(session.finalize())
    expect(json).not.toContain('secret')
    expect(json).not.toContain('/private/')
    expect(json).not.toContain('alice.tif')
  })

  it('records a bounded asynchronously inherited source identity', async () => {
    const session = createEvidenceSession({ mode: 'summary' })
    instrumentImageSource(
      {
        size: 3,
        async [imageSourceIdentity]() {
          return {
            kind: 'session' as const,
            strength: 'session' as const,
            stability: 'instance' as const,
            id: 'fixture-session',
            size: 3,
          }
        },
        async read(offset, length) {
          return Uint8Array.of(1, 2, 3).subarray(offset, offset + length)
        },
      },
      session.context,
    )
    await Promise.resolve()
    expect(session.finalize().sources).toEqual([
      expect.objectContaining({ kind: 'session', size: 3, strength: 'session' }),
    ])
  })

  it('preserves source sessions and stable-buffer semantics', async () => {
    let starts = 0
    let ends = 0
    const data = Uint8Array.of(1, 2)
    const source = {
      size: data.byteLength,
      [stableSourceBuffers]: true as const,
      [sourceSessionStart](): void {
        starts += 1
      },
      async [sourceSessionEnd](): Promise<void> {
        ends += 1
      },
      async read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
        return data.subarray(offset, offset + length)
      },
    }
    const session = createEvidenceSession()
    const wrapped = instrumentImageSource(source, session.context)
    const contracted = wrapped as typeof source
    expect(contracted[stableSourceBuffers]).toBe(true)
    const returned = await contracted.read(0, 2)
    expect(returned.buffer).toBe(data.buffer)
    expect(returned.byteOffset).toBe(data.byteOffset)
    contracted[sourceSessionStart]()
    await contracted[sourceSessionEnd]()
    expect({ starts, ends }).toEqual({ starts: 1, ends: 1 })
    session.finalize()
  })

  it('preserves evidence correlation through a signal-bound source', async () => {
    const session = createEvidenceSession({ mode: 'trace' })
    const instrumented = instrumentImageSource(
      new MemorySource(Uint8Array.of(1, 2, 3)),
      session.context,
    )
    const bound = bindImageSourceSignal(instrumented, new AbortController().signal)
    await expect(bound.read(0, 2)).resolves.toEqual(Uint8Array.of(1, 2))
    expect(bound[drainSourceEvidenceDependencies]?.()).toEqual([
      expect.stringMatching(/^logical-read:/u),
    ])
    session.finalize()
  })

  it('records failed and cancelled logical reads without retaining source bytes', async () => {
    const session = createEvidenceSession({ mode: 'trace' })
    const source = instrumentImageSource(
      {
        size: 4,
        async read(_offset, _length, options = {}): Promise<Uint8Array> {
          if (options.signal?.aborted === true) throw options.signal.reason
          throw new Error('fixture read failed')
        },
      },
      session.context,
    )
    await expect(source.read(0, 1)).rejects.toThrow('fixture read failed')
    const controller = new AbortController()
    controller.abort(new Error('fixture cancelled'))
    await expect(source.read(1, 1, { signal: controller.signal })).rejects.toThrow(
      'fixture cancelled',
    )
    const report = session.finalize()
    expect(report.logicalReads).toMatchObject({ failedReads: 1, abortedReads: 1 })
    expect(report.events).toContainEqual(
      expect.objectContaining({ type: 'cancellation', target: 'source-read' }),
    )
    expect(JSON.stringify(report)).not.toContain('fixture read failed')
  })

  it('distinguishes logical source reads from physical HTTP transfers and cache hits', async () => {
    const bytes = Uint8Array.from({ length: 8 }, (_, index) => index)
    const fetcher: typeof fetch = async (_input, init) => {
      const range = new Headers(init?.headers).get('range') ?? ''
      const match = /^bytes=(\d+)-(\d+)$/u.exec(range)
      if (match === null) throw new Error('missing range')
      const start = Number(match[1])
      const end = Number(match[2])
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}`, etag: '"fixture"' },
      })
    }
    const session = createEvidenceSession({ mode: 'trace' })
    const remote = await HttpRangeSource.open('https://example.test/a.tif?token=secret', {
      blockBytes: 4,
      maxCacheBytes: 8,
      fetch: fetcher,
      evidence: session.context,
    })
    const source = instrumentImageSource(remote, session.context)
    await source.read(1, 2)
    await source.read(1, 2)
    remote.clearCache()
    const report = session.finalize()
    expect(report.logicalReads.count).toBe(2)
    expect(report.physicalTransfers).toMatchObject({
      availability: 'measured',
      requestCount: 2,
      transferBytes: 5,
      uniqueBytes: 4,
      cacheHits: 1,
      totalDurationMicroseconds: expect.any(Number),
      firstByte: { measurement: 'measured', minimumMicroseconds: expect.any(Number) },
      statusClasses: { successful: 2 },
    })
    expect(report.events).toContainEqual(
      expect.objectContaining({
        type: 'logical-read',
        physicalTransferIds: expect.arrayContaining([
          expect.stringMatching(/^physical-transfer:/u),
        ]),
      }),
    )
    expect(
      report.events
        ?.filter((event) => event.type === 'logical-read')
        .flatMap((event) => event.physicalTransferIds ?? [])
        .every((id) => id.startsWith('physical-transfer:')),
    ).toBe(true)
    expect(report.managedMemory.categories['http-range-source-cache']).toMatchObject({
      kind: 'cache',
      currentBytes: 0,
      peakBytes: 4,
    })
    expect(report.managedMemory.retainedCacheBytes).toBe(0)
    expect(JSON.stringify(report)).not.toContain('token=secret')
  })

  it('keeps failed transfer and validator evidence visible without retaining response data', async () => {
    const bytes = Uint8Array.of(0, 1, 2, 3)
    let requests = 0
    const fetcher: typeof fetch = async (_input, init) => {
      requests += 1
      const match = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init?.headers).get('range') ?? '')
      if (match === null) throw new Error('missing range')
      const start = Number(match[1])
      const end = Number(match[2])
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${bytes.length}`,
          etag: requests === 1 ? '"first"' : '"changed"',
        },
      })
    }
    const session = createEvidenceSession({ mode: 'trace' })
    const remote = await HttpRangeSource.open('https://example.test/changed.tif', {
      blockBytes: 4,
      maxCacheBytes: 4,
      fetch: fetcher,
      evidence: session.context,
    })
    const source = instrumentImageSource(remote, session.context)
    await expect(source.read(0, 2)).rejects.toThrow('etag changed')
    const report = session.finalize('failed')
    expect(report.logicalReads.failedReads).toBe(1)
    expect(report.physicalTransfers).toMatchObject({
      requestCount: 2,
      transferBytes: 1,
      validatorFailures: 1,
    })
    expect(report.events).toContainEqual(
      expect.objectContaining({
        type: 'physical-transfer',
        outcome: 'failed',
        validatorFailure: true,
        transferredBytes: 0,
      }),
    )
    expect(JSON.stringify(report)).not.toContain('changed.tif')
  })

  it('keeps adaptive range growth explicit, bounded, and opt-in', async () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, index) => index)
    const fetcher: typeof fetch = async (_input, init) => {
      const match = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init?.headers).get('range') ?? '')
      if (match === null) throw new Error('missing range')
      const start = Number(match[1])
      const end = Number(match[2])
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` },
      })
    }
    const session = createEvidenceSession({ mode: 'trace' })
    const source = await HttpRangeSource.open('https://example.test/sequential.bin', {
      blockBytes: 4,
      maxCacheBytes: 16,
      rangePolicy: { kind: 'adaptive', maxBlockBytes: 8, sequentialReadsBeforeGrowth: 1 },
      fetch: fetcher,
      evidence: session.context,
    })
    await source.read(0, 4)
    await source.read(4, 4)
    await source.read(8, 4)
    const report = session.finalize()
    expect(report.events).toContainEqual(
      expect.objectContaining({
        type: 'operation',
        operationId: 'http-range-policy',
        detail: 'sequential reads increased block bytes from 4 to 8',
      }),
    )
    expect(
      report.events
        ?.filter((event) => event.type === 'physical-transfer')
        .every((event) => event.end - event.start <= 8),
    ).toBe(true)
  })

  it('explains and records the ordinary pipeline from shared planner data', async () => {
    const pgm = new TextEncoder().encode('P5\n4 2\n255\n\x00\x20\x40\x60\x80\xa0\xc0\xff')
    const image = await createImageLibrary([netpbmCodec, pngCodec]).open(pgm)
    const pipeline = image.crop({ x: 1, y: 0, width: 2, height: 2 }).resize({ width: 1 }).png()
    const explanation = await explainImage(pipeline)
    expect(explanation).toMatchObject({
      version: 1,
      pushedOperations: ['crop'],
      remainingStages: ['resize'],
      output: { format: 'png', width: 1, height: 1 },
      io: { pixelDecode: false },
    })
    const session = createEvidenceSession({ mode: 'trace' })
    const output = await pipeline.toBuffer({ evidence: session.context })
    const report = session.finalize()
    expect(output.byteLength).toBeGreaterThan(0)
    expect(report.events).toContainEqual(
      expect.objectContaining({ type: 'operation', operationId: 'resize', phase: 'planned' }),
    )
    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operationId: 'decoder-open', phase: 'complete' }),
        expect.objectContaining({ operationId: 'first-decoded-block', phase: 'complete' }),
        expect.objectContaining({ operationId: 'resize', phase: 'start' }),
        expect.objectContaining({ operationId: 'resize', phase: 'complete' }),
        expect.objectContaining({ operationId: 'first-output-block', phase: 'complete' }),
        expect.objectContaining({ operationId: 'pipeline', phase: 'complete' }),
      ]),
    )
    expect(report.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outputId: 'decoded-block:0', granularity: 'block' }),
        expect.objectContaining({ outputId: 'encoded-block:0', granularity: 'block' }),
      ]),
    )
    expect(report.execution).toMatchObject({
      decodedBlocks: expect.any(Number),
      decodedPixels: 4,
      encodedBlocks: 1,
      encodedPixels: 1,
      firstDecodedBlockMicroseconds: expect.any(Number),
      firstOutputBlockMicroseconds: expect.any(Number),
    })
    expect(report.managedMemory.currentLiveBytes).toBe(0)
  })

  it('records a structured failure code without retaining an error message', async () => {
    const pgm = new TextEncoder().encode('P5\n2 1\n255\n\x00\xff')
    const image = await createImageLibrary([netpbmCodec, pngCodec]).open(pgm)
    const session = createEvidenceSession({ mode: 'trace' })
    await expect(
      image.crop({ x: 1, y: 0, width: 2, height: 1 }).png().toBuffer({
        evidence: session.context,
      }),
    ).rejects.toThrow('exceeds')
    const report = session.finalize('failed')
    expect(report.operations).toContainEqual(
      expect.objectContaining({
        operationId: 'pipeline',
        phase: 'failed',
        failureCode: 'INVALID_INPUT',
      }),
    )
    expect(JSON.stringify(report)).not.toContain('Crop 1,0')
  })
})
