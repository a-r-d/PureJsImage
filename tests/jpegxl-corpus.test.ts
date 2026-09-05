import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { jpegXlConformanceCommit, jpegXlCorpus } from '../benchmark/jpegxl/corpus.ts'
import generatedLossless from '../benchmark/jpegxl/generated-lossless-manifest.json' with {
  type: 'json',
}
import generatedVarDct from '../benchmark/jpegxl/generated-vardct-manifest.json' with {
  type: 'json',
}
import { jpegXlOracles } from '../benchmark/jpegxl/oracles.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { readJpegXlSourceFrameStructures } from '../src/codecs/jpegxl-decode.ts'
import { estimateJpegXlVarDctWorkingMemory } from '../src/codecs/jpegxl-vardct-memory.ts'
import {
  jpegXlSupportedVarDctStrategyIds,
  supportsJpegXlVarDctStrategy,
} from '../src/codecs/jpegxl-vardct-render.ts'
import { createEvidenceSession } from '../src/evidence.ts'
import { inspectJpegXl } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const pnmPixels = (data: Uint8Array): Uint8Array => {
  if (data[0] === 0x50 && data[1] === 0x37) {
    const marker = new TextEncoder().encode('ENDHDR\n')
    for (let offset = 0; offset <= data.byteLength - marker.byteLength; offset += 1) {
      if (marker.every((value, index) => data[offset + index] === value)) {
        return data.subarray(offset + marker.byteLength)
      }
    }
    throw new Error('PAM header is invalid')
  }
  let offset = 0
  let tokens = 0
  while (offset < data.byteLength && tokens < 4) {
    while (offset < data.byteLength && (data[offset] ?? 0) <= 0x20) offset += 1
    if (data[offset] === 0x23) {
      while (offset < data.byteLength && data[offset] !== 0x0a) offset += 1
      continue
    }
    while (offset < data.byteLength && (data[offset] ?? 0) > 0x20) offset += 1
    tokens += 1
  }
  if (tokens !== 4 || offset >= data.byteLength) throw new Error('PNM header is invalid')
  return data.subarray(offset + 1)
}

const comparePixels = (
  actual: Uint8Array,
  expected: Uint8Array,
): Readonly<{ maximumError: number; rmse: number }> => {
  expect(actual).toHaveLength(expected.length)
  let maximumError = 0
  let squaredError = 0
  for (let index = 0; index < actual.length; index += 1) {
    const difference = Math.abs((actual[index] ?? 0) - (expected[index] ?? 0))
    maximumError = Math.max(maximumError, difference)
    squaredError += difference * difference
  }
  return Object.freeze({ maximumError, rmse: Math.sqrt(squaredError / actual.length) })
}

describe('JPEG XL corpus and development-oracle manifest', () => {
  it('keeps the VarDCT strategy manifest aligned with independently checked renderers', () => {
    expect(jpegXlSupportedVarDctStrategyIds).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ])
    expect(generatedVarDct.implementedStrategyIds).toEqual(jpegXlSupportedVarDctStrategyIds)
    expect(generatedVarDct.unsupportedStrategyIds).toEqual([8, 9, 21, 22, 23, 24, 25, 26])
    expect(supportsJpegXlVarDctStrategy(1)).toBe(true)
    expect(supportsJpegXlVarDctStrategy(3)).toBe(true)
  })

  it('pins unique external oracle revisions and roles', () => {
    expect(new Set(jpegXlOracles.map(({ id }) => id)).size).toBe(jpegXlOracles.length)
    for (const oracle of jpegXlOracles) {
      expect(oracle.source).toMatch(/^https:\/\//u)
      expect(oracle.revision).not.toMatch(/^(main|master|HEAD)$/u)
      expect(oracle.roles.length).toBeGreaterThan(0)
    }
  })

  it('records the required classification fields for every fixture', () => {
    expect(jpegXlConformanceCommit).toMatch(/^[0-9a-f]{40}$/u)
    expect(new Set(jpegXlCorpus.map(({ id }) => id)).size).toBe(jpegXlCorpus.length)
    for (const entry of jpegXlCorpus) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(entry.width).toBeGreaterThan(0)
      expect(entry.height).toBeGreaterThan(0)
      expect(entry.bitDepth).toBeGreaterThan(0)
      expect(entry.encoder.revision).not.toMatch(/^(main|master|HEAD)$/u)
      expect(entry.oracleOutput.value.length).toBeGreaterThan(0)
      expect(entry.features.length).toBeGreaterThan(0)
    }
  })

  it('pins deterministic libjxl lossless generator outputs and taxonomy', () => {
    expect(generatedLossless.revision).toMatch(/^[0-9a-f]{40}$/u)
    expect(generatedLossless.sourceArchiveSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(generatedLossless.fixtures).toHaveLength(36)
    expect(new Set(generatedLossless.fixtures.map(({ id }) => id)).size).toBe(36)
    for (const fixture of generatedLossless.fixtures) {
      expect(fixture.generator).toBe('benchmark/jpegxl/generate-lossless-corpus.ts')
      expect(fixture.jxlSha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(fixture.djxlOutputSha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(fixture.width).toBeGreaterThan(0)
      expect(fixture.height).toBeGreaterThan(0)
      expect(fixture.features.length).toBeGreaterThan(0)
      expect(fixture.options).toContain('--distance=0')
      expect(fixture.coding).toBe('modular')
      expect(['raw', 'jxlc', 'jxlp']).toContain(fixture.container)
    }
  })

  it.each(['gray8-linear', 'rgb8-linear', 'rgb10-linear'] as const)(
    'preserves exact samples and truthful semantics for %s',
    async (id) => {
      const fixture = generatedLossless.fixtures.find((candidate) => candidate.id === id)
      if (!fixture) throw new Error(`Pinned JPEG XL fixture ${id} is missing`)
      const directory = 'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0'
      const encoded = new Uint8Array(readFileSync(`${directory}/${id}.jxl`))
      const source = new Uint8Array(readFileSync(`${directory}/input/${fixture.source}.pnm`))
      const oracle = new Uint8Array(readFileSync(`${directory}/${id}.oracle.pnm`))
      expect(sha256(encoded)).toBe(fixture.jxlSha256)
      expect(sha256(source)).toBe(fixture.inputSha256)
      expect(sha256(oracle)).toBe(fixture.djxlOutputSha256)

      const metadata = await jpegxlCodec.metadata(new MemorySource(encoded), defaultImageLimits)
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(encoded),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('JPEG XL decoder is unavailable')
      const expectedFamily = id.startsWith('gray') ? 'gray' : 'rgb'
      expect(metadata.colorSemantics).toEqual({
        family: expectedFamily,
        primaries: 'srgb',
        transfer: { kind: 'linear' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'container-signaled',
        renderingIntent: 'relative',
      })
      expect(decoder.colorSemantics).toEqual(metadata.colorSemantics)
      const rows: Uint8Array[] = []
      for await (const block of decoder.decode()) rows.push(block.data.slice())
      const pixels = new Uint8Array(rows.reduce((sum, row) => sum + row.byteLength, 0))
      let offset = 0
      for (const row of rows) {
        pixels.set(row, offset)
        offset += row.byteLength
      }
      expect(pixels).toEqual(pnmPixels(source))
      expect(pixels).toEqual(pnmPixels(oracle))
    },
  )

  it('pins a common static VarDCT development matrix with pixel oracles', async () => {
    expect(generatedVarDct.revision).toMatch(/^[0-9a-f]{40}$/u)
    expect(generatedVarDct.sourceArchiveSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(generatedVarDct.fixtures).toHaveLength(19)
    expect(new Set(generatedVarDct.fixtures.map(({ id }) => id)).size).toBe(19)
    for (const fixture of generatedVarDct.fixtures) {
      expect(fixture.generator).toBe('benchmark/jpegxl/generate-vardct-corpus.ts')
      expect(['vardct', 'modular']).toContain(fixture.coding)
      expect(['supported', 'unsupported']).toContain(fixture.expectedPureJsImageBehavior)
      if (fixture.coding === 'vardct') expect(fixture.options).toContain('--modular=0')
      expect(fixture.features.length).toBeGreaterThan(0)
      const encoded = new Uint8Array(readFileSync(fixture.jxl))
      const oracle = new Uint8Array(readFileSync(fixture.oracle))
      expect(encoded.byteLength).toBe(fixture.jxlBytes)
      expect(oracle.byteLength).toBe(fixture.oracleBytes)
      expect(sha256(encoded)).toBe(fixture.jxlSha256)
      expect(sha256(oracle)).toBe(fixture.oracleSha256)
      await expect(inspectJpegXl(encoded)).resolves.toMatchObject({
        width: fixture.width,
        height: fixture.height,
        bitDepth: fixture.bitDepth,
        encoding: fixture.coding,
        progressivePasses: fixture.progressive ? 3 : 1,
        jpegReconstruction: 'unavailable',
        expectedPixelFormat:
          fixture.alpha === 'none'
            ? fixture.colorEncoding.startsWith('grayscale')
              ? 'gray8'
              : 'rgb8'
            : 'rgba8',
        unsupportedFeatures: expect.not.arrayContaining(['VarDCT pixel decode']),
      })
      if (fixture.expectedPureJsImageBehavior === 'supported') {
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(encoded),
          defaultImageLimits,
        )
        if (!decoder) throw new Error('JPEG XL decoder is unavailable')
        expect(decoder.colorSemantics).toMatchObject({
          family: fixture.colorEncoding.startsWith('grayscale') ? 'gray' : 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'srgb' },
          matrix: 'identity',
          range: 'full',
          alpha: fixture.alpha === 'none' ? 'none' : 'straight',
          provenance: fixture.coding === 'vardct' ? 'decoder-converted' : 'assumed-default',
        })
        expect(decoder.capabilities).toMatchObject({
          regionDecode: fixture.coding === 'modular',
          scaledDecode: false,
        })
        const blocks = []
        for await (const block of decoder.decode()) blocks.push(block)
        expect(blocks).toHaveLength(fixture.height)
        expect(
          blocks.every(
            (block, row) =>
              block.x === 0 &&
              block.y === row &&
              block.width === fixture.width &&
              block.height === 1 &&
              block.data.byteLength <= fixture.width * (fixture.alpha === 'none' ? 3 : 4),
          ),
        ).toBe(true)
        const pixels = new Uint8Array(blocks.reduce((sum, block) => sum + block.data.byteLength, 0))
        let offset = 0
        for (const block of blocks) {
          pixels.set(block.data, offset)
          offset += block.data.byteLength
        }
        const comparison = comparePixels(pixels, pnmPixels(oracle))
        expect(comparison.maximumError).toBeLessThanOrEqual(1)
        expect(comparison.rmse).toBeLessThan(0.5)
      } else {
        await expect(
          jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
      }
    }
  }, 15_000)

  it('preflights every selected VarDCT large allocation before decode', async () => {
    const supported = generatedVarDct.fixtures.filter(
      ({ expectedPureJsImageBehavior }) => expectedPureJsImageBehavior === 'supported',
    )
    const estimates = []
    for (const fixture of supported) {
      const encoded = new Uint8Array(readFileSync(fixture.jxl))
      const frames = await readJpegXlSourceFrameStructures(
        new MemorySource(encoded),
        defaultImageLimits,
      )
      const frame = frames.at(-1)
      if (!frame) throw new Error('Selected VarDCT fixture has no display frame')
      const estimate = estimateJpegXlVarDctWorkingMemory(frame)
      estimates.push({ fixture, encoded, estimate })

      expect(estimate).toMatchObject({
        retainedCompressedSectionsBytes: expect.any(BigInt),
        dcPlanesBytes: expect.any(BigInt),
        lfAndHfMetadataBytes: expect.any(BigInt),
        coefficientBlocksBytes: expect.any(BigInt),
        primaryPlanesBytes: expect.any(BigInt),
        gaborishScratchBytes: expect.any(BigInt),
        epfOutputPlaneSetsBytes: expect.any(BigInt),
        syntheticNoiseAndConvolutionBytes: expect.any(BigInt),
        outputBytes: expect.any(BigInt),
        rowBlockCopyBytes: expect.any(BigInt),
        progressiveAccumulationBytes: expect.any(BigInt),
        externalDcFrameStateBytes: expect.any(BigInt),
      })
      expect(estimate.requiredBytes).toBeLessThan(BigInt(defaultImageLimits.maxDecodedBytes))
      expect(estimate.primaryPlanesBytes).toBeGreaterThan(0n)
      expect(estimate.syntheticNoiseAndConvolutionBytes).toBeGreaterThan(0n)
    }

    const progressive = estimates.find(({ fixture }) => fixture.progressive)
    expect(progressive?.estimate.progressiveAccumulationBytes).toBeGreaterThan(0n)
    const boundary = estimates[0]
    if (!boundary) throw new Error('Selected VarDCT fixture matrix is empty')
    const acceptedLimit = Number(boundary.estimate.requiredBytes)
    const accepted = await jpegxlCodec.createDecoder?.(new MemorySource(boundary.encoded), {
      ...defaultImageLimits,
      maxDecodedBytes: acceptedLimit,
    })
    expect(accepted).toBeDefined()
    await expect(
      jpegxlCodec.createDecoder?.(new MemorySource(boundary.encoded), {
        ...defaultImageLimits,
        maxDecodedBytes: acceptedLimit - 1,
      }),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('conservative working-memory preflight'),
    })
  })

  it.each(['summary', 'trace'] as const)(
    'reports selected VarDCT managed memory in %s evidence mode',
    async (mode) => {
      const fixture = generatedVarDct.fixtures.find(({ id }) => id === 'rgb8-distance4-noise')
      if (!fixture) throw new Error('Selected VarDCT noise fixture is missing')
      const encoded = new Uint8Array(readFileSync(fixture.jxl))
      const oracle = pnmPixels(new Uint8Array(readFileSync(fixture.oracle)))
      const session = createEvidenceSession({ mode })
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(encoded),
        defaultImageLimits,
        { evidence: session.context },
      )
      if (!decoder) throw new Error('JPEG XL decoder is unavailable')
      const rows: Uint8Array[] = []
      let outputBytes = 0
      for await (const block of decoder.decode()) {
        rows.push(block.data.slice())
        outputBytes += block.data.byteLength
        block.release?.()
      }
      const report = session.finalize()
      const managedPeakBytes =
        'managedPeakBytes' in decoder && typeof decoder.managedPeakBytes === 'number'
          ? decoder.managedPeakBytes
          : 0

      const pixels = new Uint8Array(outputBytes)
      let outputOffset = 0
      for (const row of rows) {
        pixels.set(row, outputOffset)
        outputOffset += row.byteLength
      }
      const comparison = comparePixels(pixels, oracle)
      expect(comparison.maximumError).toBeLessThanOrEqual(1)
      expect(comparison.rmse).toBeLessThan(0.5)
      expect(managedPeakBytes).toBeGreaterThan(0)
      expect(report.managedMemory).toMatchObject({
        currentLiveBytes: 0,
        stillLiveLeases: 0,
        peakLiveBytes: managedPeakBytes,
      })
      expect(Object.keys(report.managedMemory.categories)).toEqual(
        expect.arrayContaining([
          'jpegxl-vardct-compressed-section',
          'jpegxl-vardct-coefficients-pass-0',
          'jpegxl-vardct-primary-float32-planes',
          'jpegxl-vardct-gaborish-scratch',
          'jpegxl-vardct-epf-stage-1-output',
          'jpegxl-vardct-synthetic-noise-and-convolution',
          'jpegxl-vardct-output-pixels',
          'jpegxl-vardct-row-block-copy',
        ]),
      )
      if (mode === 'summary') expect(report.events).toBeUndefined()
      else {
        expect(report.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'allocation' }),
            expect.objectContaining({ type: 'release' }),
          ]),
        )
      }
    },
  )

  it('releases multi-group progressive VarDCT output on early return and cancellation', async () => {
    const fixture = generatedVarDct.fixtures.find(
      ({ id }) => id === 'rgb8-distance1-multi-group-progressive',
    )
    if (!fixture) throw new Error('Selected VarDCT fixture is missing')
    const encoded = new Uint8Array(readFileSync(fixture.jxl))

    const earlySession = createEvidenceSession({ mode: 'summary' })
    const earlyDecoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded),
      defaultImageLimits,
      { evidence: earlySession.context },
    )
    if (!earlyDecoder) throw new Error('JPEG XL decoder is unavailable')
    const earlyIterator = earlyDecoder.decode()[Symbol.asyncIterator]()
    const first = await earlyIterator.next()
    if (first.done) throw new Error('Selected VarDCT fixture emitted no rows')
    first.value.release?.()
    await earlyIterator.return?.()
    expect(earlySession.finalize('cancelled').managedMemory).toMatchObject({
      currentLiveBytes: 0,
      stillLiveLeases: 0,
    })

    const cancelSession = createEvidenceSession({ mode: 'trace' })
    const cancelDecoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded),
      defaultImageLimits,
      { evidence: cancelSession.context },
    )
    if (!cancelDecoder) throw new Error('JPEG XL decoder is unavailable')
    const controller = new AbortController()
    const cancelIterator = cancelDecoder
      .decode({ signal: controller.signal })
      [Symbol.asyncIterator]()
    const emitted = await cancelIterator.next()
    if (emitted.done) throw new Error('Selected VarDCT fixture emitted no rows')
    emitted.value.release?.()
    controller.abort()
    await expect(cancelIterator.next()).rejects.toMatchObject({ name: 'AbortError' })
    const cancelled = cancelSession.finalize('cancelled')
    expect(cancelled.managedMemory).toMatchObject({ currentLiveBytes: 0, stillLiveLeases: 0 })
    expect(cancelled.cancellations).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: 'selected-vardct-row-emission' })]),
    )
  })
})
