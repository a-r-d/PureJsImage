import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { createEvidenceSession } from '../src/evidence.ts'
import { explainImage } from '../src/explain.ts'
import { createImageLibrary } from '../src/index.ts'
import { openJpegXlSession } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { type ImageSource, MemorySource } from '../src/source.ts'

const fixture = (): Uint8Array =>
  new Uint8Array(
    readFileSync(
      'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
    ),
  )

describe('JPEG XL lazy VarDCT opening', () => {
  for (const bufferKind of ['typed-array', 'node-buffer'])
    it(`owns retained compressed bytes when the source recycles a ${bufferKind}`, async () => {
      const bytes = fixture()
      const scratch =
        bufferKind === 'node-buffer' ? Buffer.alloc(bytes.length) : new Uint8Array(bytes.length)
      const source: ImageSource = {
        size: bytes.length,
        async read(offset, length) {
          scratch.fill(0)
          const selected = bytes.subarray(offset, offset + length)
          scratch.set(selected)
          return scratch.subarray(0, selected.length)
        },
      }
      const recycled = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
      const stable = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!recycled || !stable) throw new Error('Missing decoder')
      const expected = stable.decode()[Symbol.asyncIterator]()
      const referenceHash = createHash('sha256')
      const recycledHash = createHash('sha256')
      for await (const block of recycled.decode()) {
        const reference = await expected.next()
        if (reference.done) throw new Error('Missing reference row')
        recycledHash.update(block.data)
        referenceHash.update(reference.value.data)
        block.release?.()
        reference.value.release?.()
      }
      expect((await expected.next()).done).toBe(true)
      const referenceDigest = referenceHash.digest('hex')
      expect(recycledHash.digest('hex')).toBe(referenceDigest)
      const session = await openJpegXlSession(source)
      const sessionHash = createHash('sha256')
      for await (const event of session.decode())
        if (event.type === 'block') {
          sessionHash.update(event.block.data)
          event.block.release?.()
        }
      expect(sessionHash.digest('hex')).toBe(referenceDigest)
      await session.close()
    })

  it('accepts a timer cancellation during coefficient reconstruction and releases its working memory', async () => {
    const controller = new AbortController()
    const session = createEvidenceSession({ mode: 'trace' })
    let reconstructedGroup = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = session.subscribe((event) => {
      if (event.type !== 'allocation' || !event.category.includes('coefficients-group-')) return
      if (reconstructedGroup) return
      reconstructedGroup = true
      timer = setTimeout(() => controller.abort(), 0)
    })
    try {
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(fixture()),
        defaultImageLimits,
        {
          evidence: session.context,
        },
      )
      if (!decoder) throw new Error('Missing decoder')
      await expect(
        decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(reconstructedGroup).toBe(true)
      expect(session.finalize().managedMemory).toMatchObject({
        currentLiveBytes: 0,
        stillLiveLeases: 0,
      })
    } finally {
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
    }
  })

  it('opens without pixel allocation or materialization and defers final output until iteration', async () => {
    const bytes = fixture()
    let readBytes = 0
    const source: ImageSource = {
      size: bytes.length,
      async read(offset, length) {
        readBytes += length
        return bytes.slice(offset, offset + length)
      },
    }
    const session = createEvidenceSession({ mode: 'trace' })
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits, {
      evidence: session.context,
    })
    if (!decoder || !('managedPeakBytes' in decoder)) throw new Error('Missing measured decoder')
    expect(decoder.managedPeakBytes).toBe(0)
    expect(decoder.execution?.decodeDuringOpen).toBe(false)
    expect(decoder.capabilities.progressive).toBe(false)
    expect(readBytes).toBeLessThan(bytes.length / 4)
    let rows = 0
    for await (const block of decoder.decode()) {
      expect(block.format).toBe(decoder.pixelFormat)
      block.release?.()
      rows += block.height
    }
    expect(rows).toBe(decoder.height)
    expect(decoder.managedPeakBytes).toBeGreaterThan(0)
    expect(session.finalize().managedMemory).toMatchObject({
      currentLiveBytes: 0,
      stillLiveLeases: 0,
      peakLiveBytes: decoder.managedPeakBytes,
    })
  })

  it('explains a VarDCT pipeline without materializing pixels', async () => {
    const image = await createImageLibrary([jpegxlCodec]).open(fixture())
    const plan = await explainImage(image.jpegxl())
    expect(plan.io.pixelDecode).toBe(false)
    expect(plan.decoderExecution?.decodeDuringOpen).toBe(false)
    expect(plan.fullFrameFallbackReasons).toContain(
      'VarDCT retains a full output frame; eligible 8-bit images use bounded restoration bands',
    )
  })

  it('does not allocate when an unopened iterator is returned or an invalid request is rejected', async () => {
    const session = createEvidenceSession({ mode: 'summary' })
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(fixture()),
      defaultImageLimits,
      {
        evidence: session.context,
      },
    )
    if (!decoder) throw new Error('Missing decoder')
    const unused = decoder.decode()[Symbol.asyncIterator]()
    await unused.return?.()
    await expect(decoder.decode({ x: -1 })[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    const aborted = new AbortController()
    aborted.abort()
    await expect(
      decoder.decode({ signal: aborted.signal })[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.finalize().managedMemory).toMatchObject({
      currentLiveBytes: 0,
      peakLiveBytes: 0,
      stillLiveLeases: 0,
    })
  })

  it('rejects concurrent and repeated consumption without duplicating decoder work', async () => {
    const session = createEvidenceSession({ mode: 'summary' })
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(fixture()),
      defaultImageLimits,
      {
        evidence: session.context,
      },
    )
    if (!decoder) throw new Error('Missing decoder')
    const first = decoder.decode()[Symbol.asyncIterator]()
    const pending = first.next()
    await expect(decoder.decode()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    const row = await pending
    if (row.done) throw new Error('Missing first row')
    row.value.release?.()
    await first.return?.()
    await expect(decoder.decode()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    expect(session.finalize('cancelled').managedMemory).toMatchObject({
      currentLiveBytes: 0,
      stillLiveLeases: 0,
    })
  })

  it('propagates request cancellation during deferred section reads and releases ownership', async () => {
    const bytes = fixture()
    const controller = new AbortController()
    let cancelReads = false
    const source: ImageSource = {
      size: bytes.length,
      async read(offset, length, options) {
        if (cancelReads) {
          expect(options?.signal).toBe(controller.signal)
          controller.abort()
          options?.signal?.throwIfAborted()
        }
        return bytes.slice(offset, offset + length)
      },
    }
    const session = createEvidenceSession({ mode: 'summary' })
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits, {
      evidence: session.context,
    })
    if (!decoder) throw new Error('Missing decoder')
    cancelReads = true
    await expect(
      decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.finalize('cancelled').managedMemory).toMatchObject({
      currentLiveBytes: 0,
      stillLiveLeases: 0,
    })
  })

  it('reports malformed entropy at decode without treating successful opening as verified pixels', async () => {
    const bytes = fixture()
    // Preserve both headers and their TOCs while replacing the display-frame LF global payload.
    bytes.fill(0, 10_887)
    const session = createEvidenceSession({ mode: 'summary' })
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, {
      evidence: session.context,
    })
    if (!decoder) throw new Error('Missing decoder')
    expect(decoder.execution?.decodeDuringOpen).toBe(false)
    await expect(decoder.decode()[Symbol.asyncIterator]().next()).rejects.toThrow()
    expect(session.finalize('failed').managedMemory).toMatchObject({
      currentLiveBytes: 0,
      stillLiveLeases: 0,
    })
  })
})
