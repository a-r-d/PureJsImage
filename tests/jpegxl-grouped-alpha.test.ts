import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { inspectJpegXlStructure } from '../src/codecs/jpegxl.ts'
import { JpegXlCodestreamSource } from '../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../src/codecs/jpegxl-decode.ts'
import { createEvidenceSession } from '../src/evidence.ts'
import { openJpegXlSession } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import manifest from './fixtures/jpegxl/grouped-alpha/manifest.json' with { type: 'json' }
import { verifyJpegXlGroupedAlpha } from './helpers/jpegxl-grouped-alpha.ts'

const root = new URL('./fixtures/jpegxl/grouped-alpha/', import.meta.url)
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
describe('JPEG XL grouped alpha progressive dependencies', () => {
  it('keeps non-alpha extra-channel stages behind the explicit dependency boundary', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('../m8-native/grouped-alpha-depth.jxl', root)),
    )
    const session = await openJpegXlSession(bytes)
    try {
      expect(session.stages.find((stage) => stage.kind === 'dc')?.status).toBe('unavailable')
      expect(session.plan({ until: 'dc' }).fallbackReasons).toContain(
        'Extra channels require their complete dependencies',
      )
      expect(() => session.plan({ until: 'dc', fallback: 'reject' })).toThrow(
        'selective decode rejected',
      )
    } finally {
      await session.close()
    }
  })

  it('evicts grouped alpha state under a small cache and reconstructs the same stage again', async () => {
    const bytes = new Uint8Array(await readFile(new URL('sdr8-direct.jxl', root)))
    const session = await openJpegXlSession(bytes, { maxCachedBytes: 65_536 })
    const hashes: string[] = []
    try {
      for (let run = 0; run < 2; run++) {
        const hash = createHash('sha256')
        for await (const event of session.decode({ until: 'dc', scaleDenominator: 8 }))
          if (event.type === 'block') {
            hash.update(event.block.data)
            event.block.release?.()
          }
        hashes.push(hash.digest('hex'))
        expect(session.managedLiveBytes).toBeLessThanOrEqual(65_536)
        expect(session.stages.find((stage) => stage.kind === 'dc')?.status).toBe(
          'requires-validation',
        )
      }
      expect(hashes[1]).toBe(hashes[0])
    } finally {
      await session.close()
    }
    expect(session.managedLiveBytes).toBe(0)
  })
  it('reuses alpha dependencies across changing viewports and immutable output blocks', async () => {
    const bytes = new Uint8Array(await readFile(new URL('sdr8-direct.jxl', root)))
    const session = await openJpegXlSession(bytes, { maxCachedBytes: 32 * 1024 * 1024 })
    const region = { x: 10, y: 10, width: 5, height: 5 }
    let original: Uint8Array | undefined
    try {
      for await (const event of session.decode({ until: 'dc', region }))
        if (event.type === 'block') {
          if (event.block.y === 0) original = event.block.data
          event.block.release?.()
        }
      const firstBytes = session.sourceSectionBytes
      const snapshot = original?.slice()
      const selected = session.plan({ until: 'dc', region })
      expect(selected.dependencyValidation).toBe('complete')
      expect(selected.sectionIds.length).toBeLessThan(
        session.plan({ until: 'dc' }).sectionIds.length,
      )
      for await (const event of session.decode({
        until: 'dc',
        region: { x: 512, y: 256, width: 1, height: 3 },
      }))
        if (event.type === 'block') event.block.release?.()
      expect(session.sourceSectionBytes).toBeGreaterThan(firstBytes)
      const secondBytes = session.sourceSectionBytes
      for await (const event of session.decode({ until: 'dc', region }))
        if (event.type === 'block') {
          if (event.block.y === 0) expect(event.block.data).toEqual(snapshot)
          event.block.release?.()
        }
      expect(session.sourceSectionBytes).toBe(secondBytes)
      expect(original).toEqual(snapshot)
    } finally {
      await session.close()
    }
    expect(session.managedLiveBytes).toBe(0)
  })

  it('cancels while locating an alpha trailer, clears memory and permits replay', async () => {
    const bytes = new Uint8Array(await readFile(new URL('sdr16-squeeze.jxl', root)))
    const evidence = createEvidenceSession({ mode: 'trace' })
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    evidence.subscribe((event) => {
      if (
        event.type === 'allocation' &&
        event.category === 'jpegxl-selective-alpha-coefficient-scratch' &&
        timer === undefined
      )
        timer = setTimeout(() => controller.abort(), 0)
    })
    const session = await openJpegXlSession(bytes, { evidence: evidence.context })
    try {
      await expect(
        (async () => {
          for await (const event of session.decode({ until: 'dc', signal: controller.signal }))
            if (event.type === 'block') throw new Error('Cancellation emitted a row')
        })(),
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(timer).toBeDefined()
      expect(session.managedLiveBytes).toBe(0)
      let completed = false
      for await (const event of session.decode({ until: 'dc' }))
        if (event.type === 'stage-complete') completed = true
        else if (event.type === 'block') event.block.release?.()
      expect(completed).toBe(true)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      await session.close()
    }
    expect(session.managedLiveBytes).toBe(0)
  })

  it('rejects incomplete alpha dependencies before emitting DC pixels', async () => {
    const bytes = new Uint8Array(await readFile(new URL('sdr8.jxl', root)))
    const source = new MemorySource(bytes)
    const logical = new JpegXlCodestreamSource(source, await inspectJpegXlStructure(source))
    const frame = (await readJpegXlSourceFrameStructures(logical, defaultImageLimits)).at(-1)
    const part = frame?.sections.at(-1)
    if (!part) throw new Error('Missing alpha pass section')
    bytes[part.offset + part.length - 1] = (bytes[part.offset + part.length - 1] ?? 0) ^ 128
    const session = await openJpegXlSession(bytes)
    try {
      await expect(
        (async () => {
          for await (const event of session.decode({ until: 'dc' }))
            if (event.type === 'block') throw new Error('Invalid alpha emitted a row')
        })(),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
      expect(session.managedLiveBytes).toBe(0)
    } finally {
      await session.close()
    }
  })

  it.each([2_000_000, 5_000_000])(
    'enforces the %i-byte alpha working budget before emitting pixels',
    async (maxDecodedBytes) => {
      const bytes = new Uint8Array(await readFile(new URL('sdr8.jxl', root)))
      const session = await openJpegXlSession(bytes, { limits: { maxDecodedBytes } })
      try {
        await expect(
          (async () => {
            for await (const event of session.decode({ until: 'dc' }))
              if (event.type === 'block') throw new Error('Exceeded alpha budget emitted a row')
          })(),
        ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
        expect(session.managedLiveBytes).toBe(0)
      } finally {
        await session.close()
      }
    },
  )
  for (const fixture of manifest.fixtures)
    it(`retains independent alpha in every ${fixture.id} stage and cross-group viewport`, async () => {
      const bytes = new Uint8Array(await readFile(new URL(fixture.file, root)))
      const reference = new Uint8Array(
        gunzipSync(await readFile(new URL(`${fixture.id}.rgba.gz`, root))),
      )
      expect(digest(bytes)).toBe(fixture.sha256)
      expect(digest(reference)).toBe(fixture.referenceSha256)
      const result = await verifyJpegXlGroupedAlpha(
        bytes,
        reference,
        fixture.width,
        fixture.height,
        fixture.format,
        fixture.referenceColorScale,
      )
      expect(result.maximumColor).toBeLessThanOrEqual(
        fixture.format === 'rgba8'
          ? 1 / 255 + 1e-12
          : fixture.format === 'rgba16'
            ? 4 / 65_535
            : 0.00012,
      )
      expect(result.maximumAlpha).toBeLessThanOrEqual(fixture.format === 'rgbaf32' ? 0.000001 : 0)
      expect(result.maximumViewport).toBeLessThanOrEqual(
        fixture.format === 'rgba8'
          ? 1 / 255 + 1e-12
          : fixture.format === 'rgba16'
            ? 1 / 65_535 + 1e-12
            : 0.000001,
      )
    }, 30_000)
  it('reports full native alpha storage for DC viewports and rejects it under a strict policy', async () => {
    const bytes = new Uint8Array(await readFile(new URL('sdr8.jxl', root)))
    const session = await openJpegXlSession(bytes)
    try {
      const plan = session.plan({ until: 'dc', region: { x: 10, y: 10, width: 10, height: 10 } })
      expect(plan.groupIds).toEqual([0])
      expect(plan.sectionIds.length).toBeGreaterThan(2)
      expect(plan.fullFrameFallback).toBe('working-planes')
      expect(plan.workingMemoryClass).toBe('full-native-alpha-and-dc-restoration')
      expect(() =>
        session.plan({ until: 'dc', region: plan.outputRegion, fallback: 'reject' }),
      ).toThrow('selective decode rejected')
    } finally {
      await session.close()
    }
  })
})
