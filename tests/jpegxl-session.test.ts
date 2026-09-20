import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openJpegXlSession } from '../src/codecs/jpegxl-session.ts'
import { createEvidenceSession } from '../src/evidence.ts'
import { explainImage } from '../src/explain.ts'
import type { ImageSource } from '../src/source.ts'

const fixture = (): Uint8Array =>
  readFileSync('benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance2-progressive.jxl')

describe('JPEG XL progressive session', () => {
  it('uses the same planner for explanation and native execution and skips later passes', async () => {
    const session = await openJpegXlSession(fixture())
    const request = { until: 1, scaleDenominator: 4 } as const
    const plan = await explainImage(session, request)
    expect(plan).toEqual(session.plan(request))
    expect(session.managedPeakBytes).toBe(0)
    const completed: number[] = []
    for await (const event of session.native({ scaleDenominator: 4 }))
      if (event.type === 'stage-complete') completed.push(event.stage.completedPasses)
    expect(completed).toEqual([0, 1])
    expect(session.sourceSectionBytes).toBeLessThan(fixture().length)
    await session.close()
  })

  it('cancels DC computation from a timer and clears all session-owned memory', async () => {
    const evidence = createEvidenceSession({ mode: 'trace' })
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    evidence.subscribe((event) => {
      if (event.type === 'allocation' && event.category === 'jpegxl-vardct-dc-preview-restoration')
        timer = setTimeout(() => controller.abort(), 0)
    })
    const bytes = readFileSync(
      'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
    )
    const session = await openJpegXlSession(bytes, { evidence: evidence.context })
    try {
      await expect(
        (async () => {
          for await (const event of session.native({
            scaleDenominator: 8,
            signal: controller.signal,
          }))
            if (event.type === 'block') event.block.release?.()
        })(),
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(timer).toBeDefined()
      expect(session.managedLiveBytes).toBe(0)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      await session.close()
    }
  })

  it('keeps a large-fixture native 1/8 request below half the final managed working peak', async () => {
    const bytes = readFileSync(
      'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
    )
    const reduced = await openJpegXlSession(bytes)
    for await (const event of reduced.native({ scaleDenominator: 8 }))
      if (event.type === 'block') event.block.release?.()
    const previewPeak = reduced.managedPeakBytes
    if (previewPeak === null) throw new Error('Missing native-preview memory accounting')
    expect(reduced.sourceSectionBytes).toBeLessThan(bytes.length / 4)
    await reduced.close()
    const final = await openJpegXlSession(bytes)
    for await (const event of final.progressive())
      if (event.type === 'block') event.block.release?.()
    const finalPeak = final.managedPeakBytes
    if (finalPeak === null) throw new Error('Missing progressive memory accounting')
    expect(previewPeak).toBeLessThan(finalPeak / 2)
    await final.close()
  })

  it('opens without pixel allocations and emits independently checked stages under backpressure', async () => {
    const session = await openJpegXlSession(fixture())
    expect(session.managedPeakBytes).toBe(0)
    const stages: string[] = []
    let pixels = new Uint8Array()
    let offset = 0
    for await (const event of session.progressive()) {
      if (event.type === 'stage-start') {
        stages.push(event.stage.kind)
        pixels = new Uint8Array(event.stage.width * event.stage.height * 3)
        offset = 0
      } else if (event.type === 'block') {
        pixels.set(event.block.data, offset)
        offset += event.block.data.length
        event.block.release?.()
      } else if (event.type === 'stage-complete') {
        const expected = readFileSync(
          `tests/fixtures/jpegxl/m6-progressive/stage-${event.stage.completedPasses}.bin`,
        )
        expect(offset).toBe(expected.length)
        for (let index = 0; index < pixels.length; index += 1)
          expect(Math.abs((pixels[index] ?? 0) - (expected[index] ?? 0))).toBeLessThanOrEqual(1)
      }
    }
    expect(stages).toEqual(['dc', 'pass', 'pass', 'final'])
    await session.close()
    expect(session.managedLiveBytes).toBe(0)
  })

  it('reuses compressed sections and LF state across completed requests', async () => {
    const bytes = fixture()
    let reads = 0
    const source: ImageSource = {
      size: bytes.length,
      async read(offset, length) {
        reads += 1
        return bytes.slice(offset, offset + length)
      },
    }
    const evidence = createEvidenceSession({ mode: 'trace' })
    let lfDecodes = 0
    evidence.subscribe((event) => {
      if (event.type === 'allocation' && event.category === 'jpegxl-vardct-lf-metadata') lfDecodes++
    })
    const session = await openJpegXlSession(source, { evidence: evidence.context })
    for await (const event of session.progressive({ until: 'dc', scaleDenominator: 8 }))
      if (event.type === 'block') event.block.release?.()
    const firstReads = reads
    const firstBytes = session.sourceSectionBytes
    for await (const event of session.progressive({ until: 'dc', scaleDenominator: 8 }))
      if (event.type === 'block') event.block.release?.()
    expect(reads).toBe(firstReads)
    expect(session.sourceSectionBytes).toBe(firstBytes)
    for await (const event of session.decode()) if (event.type === 'block') event.block.release?.()
    expect(lfDecodes).toBe(1)
    await session.close()
  })

  it('releases an unused iterator and rejects concurrent requests without consuming either', async () => {
    const session = await openJpegXlSession(fixture())
    const unused = session.progressive()
    expect(() => session.progressive()).toThrow(/active request/)
    await unused.return(undefined)
    expect(session.managedPeakBytes).toBe(0)
    const next = session.progressive()
    expect((await next.next()).value).toMatchObject({ type: 'metadata' })
    await session.close()
    expect(session.managedLiveBytes).toBe(0)
    expect(() => session.progressive()).toThrow()
    await session.close()
  })

  it('closes a suspended block iterator without mutating previously released output', async () => {
    const session = await openJpegXlSession(fixture())
    const iterator = session.progressive({ until: 'dc', scaleDenominator: 8 })
    for (;;) {
      const result = await iterator.next()
      if (result.done) throw new Error('Missing output block')
      if (result.value.type !== 'block') continue
      const block = result.value.block
      const snapshot = block.data.slice()
      block.release?.()
      await session.close()
      expect(block.data).toEqual(snapshot)
      expect(session.managedLiveBytes).toBe(0)
      break
    }
  })
})

it('drops every owned cache when caching is disabled and supports a fresh request after abort', async () => {
  let reads = 0
  let suspend = false
  const bytes = fixture()
  const source: ImageSource = {
    size: bytes.length,
    async read(offset, length, options) {
      reads++
      if (suspend)
        await new Promise<void>((resolve, reject) => {
          if (options?.signal?.aborted) reject(new DOMException('Cancelled', 'AbortError'))
          else
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Cancelled', 'AbortError')),
              { once: true },
            )
        })
      return bytes.subarray(offset, offset + length)
    },
  }
  const session = await openJpegXlSession(source, { maxCachedBytes: 0 })
  suspend = true
  const controller = new AbortController()
  const iterator = session.native({ scaleDenominator: 8, signal: controller.signal })
  expect((await iterator.next()).value?.type).toBe('metadata')
  const pending = iterator.next()
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(session.managedLiveBytes).toBe(0)
  suspend = false
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = reads
    for await (const event of session.native({ scaleDenominator: 8 }))
      if (event.type === 'block') event.block.release?.()
    expect(reads).toBeGreaterThan(before)
    expect(session.managedLiveBytes).toBe(0)
  }
  await session.close()
})

it('preserves completed stage bytes when a later section fails and never emits final', async () => {
  const { readJpegXlSourceFrameStructures } = await import('../src/codecs/jpegxl-decode.ts')
  const { defaultImageLimits } = await import('../src/limits.ts')
  const { MemorySource } = await import('../src/source.ts')
  const bytes = fixture()
  const frames = await readJpegXlSourceFrameStructures(new MemorySource(bytes), defaultImageLimits)
  const finalSection = frames.at(-1)?.sections.at(-1)
  if (!finalSection) throw new Error('Missing final section')
  const source: ImageSource = {
    size: bytes.length,
    async read(offset, length) {
      if (offset === finalSection.offset && length === finalSection.length)
        throw new Error('Injected later section failure')
      return bytes.subarray(offset, offset + length)
    },
  }
  const session = await openJpegXlSession(source)
  let final = false,
    early: Uint8Array | undefined,
    copy: Uint8Array | undefined
  const completed: string[] = []
  await expect(
    (async () => {
      for await (const event of session.progressive()) {
        if (event.type === 'block') {
          early ??= event.block.data
          copy ??= event.block.data.slice()
          event.block.release?.()
        } else if (event.type === 'stage-complete') completed.push(event.stage.kind)
        else if (event.type === 'final') final = true
      }
    })(),
  ).rejects.toMatchObject({
    code: 'INVALID_INPUT',
    cause: { message: 'Injected later section failure' },
  })
  expect(completed).toEqual(['dc', 'pass', 'pass'])
  expect(final).toBe(false)
  expect(early).toEqual(copy)
  expect(session.managedLiveBytes).toBe(0)
  await session.close()
})

it('rejects a changed source validator before consulting cached decoded state', async () => {
  const { imageSourceIdentity } = await import('../src/source-identity.ts')
  const bytes = fixture()
  let version = 'one'
  const source: ImageSource = {
    size: bytes.length,
    [imageSourceIdentity]: () => ({
      kind: 'remote',
      strength: 'strong',
      stability: 'versioned',
      url: 'https://example.test/image.jxl',
      size: bytes.length,
      validator: { kind: 'etag', value: version },
    }),
    async read(offset, length) {
      return bytes.subarray(offset, offset + length)
    },
  }
  const session = await openJpegXlSession(source)
  for await (const event of session.native({ scaleDenominator: 8 }))
    if (event.type === 'block') event.block.release?.()
  version = 'two'
  await expect(session.native({ scaleDenominator: 8 }).next()).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  })
  expect(session.managedLiveBytes).toBe(0)
  await session.close()
})

it('reports unknown fallback accounting when decoder creation fails', async () => {
  const bytes = readFileSync('tests/fixtures/jpegxl/m4-color/srgb-8.jxl')
  let fail = false
  const source: ImageSource = {
    size: bytes.length,
    async read(offset, length) {
      if (fail) throw new Error('Read failure')
      return bytes.subarray(offset, offset + length)
    },
  }
  const session = await openJpegXlSession(source)
  fail = true
  await expect(
    (async () => {
      for await (const event of session.decode())
        if (event.type === 'block') event.block.release?.()
    })(),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(session.managedPeakBytes).toBeNull()
  expect(session.managedLiveBytes).toBe(0)
  await session.close()
})

it('keeps final downsampling distinct from the native DC boundary', async () => {
  const session = await openJpegXlSession(fixture())
  const outputs: number[][] = []
  for (const until of ['dc', 'final'] as const) {
    const output: number[] = []
    for await (const event of session.decode({ until, scaleDenominator: 8 }))
      if (event.type === 'block') {
        output.push(...event.block.data)
        event.block.release?.()
      }
    outputs.push(output)
  }
  expect(outputs[0]).not.toEqual(outputs[1])
  await session.close()
})

it('rejects invalid regions, pass counts, and missing native boundaries before output', async () => {
  const session = await openJpegXlSession(fixture())
  for (const request of [
    { until: -1 },
    { until: 999 },
    { until: 0.5 },
    { region: { x: -1, y: 0, width: 1, height: 1 } },
    { region: { x: 0, y: 0, width: 0, height: 1 } },
    { region: { x: 40, y: 0, width: 4, height: 1 } },
  ])
    expect(() => session.decode(request)).toThrow()
  expect(session.managedLiveBytes).toBe(0)
  await session.close()
  const single = await openJpegXlSession(
    readFileSync('benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-effort1.jxl'),
  )
  expect(() => single.native({ scaleDenominator: 4 })).toThrow()
  expect(single.stages.find((stage) => stage.kind === 'dc')?.status).toBe('unavailable')
  await expect(
    (async () => {
      for await (const event of single.native({ scaleDenominator: 8 }))
        if (event.type === 'block') event.block.release?.()
    })(),
  ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  expect(() => single.decode({ fallback: 'reject' })).toThrow()
  await single.close()
})

it('declares full-resolution storage for selective passes and rejects it under strict policy', async () => {
  const session = await openJpegXlSession(fixture())
  expect(session.plan({ region: { x: 2, y: 3, width: 10, height: 12 } }).fullFrameFallback).toBe(
    'working-planes',
  )
  expect(() =>
    session.decode({ region: { x: 2, y: 3, width: 10, height: 12 }, fallback: 'reject' }),
  ).toThrow('full-frame')
  for await (const event of session.native({ scaleDenominator: 8, fallback: 'reject' }))
    if (event.type === 'block') event.block.release?.()
  await session.close()
})
