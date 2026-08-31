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
import { inspectJpegXl } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const pnmPixels = (data: Uint8Array): Uint8Array => {
  const marker = Uint8Array.of(0x32, 0x35, 0x35, 0x0a)
  for (let offset = 0; offset <= data.length - marker.length; offset += 1) {
    if (marker.every((value, index) => data[offset + index] === value)) {
      return data.subarray(offset + marker.length)
    }
  }
  throw new Error('PNM maximum sample marker is missing')
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
    expect(generatedLossless.fixtures).toHaveLength(33)
    expect(new Set(generatedLossless.fixtures.map(({ id }) => id)).size).toBe(33)
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

  it('pins a common static VarDCT development matrix with pixel oracles', async () => {
    expect(generatedVarDct.revision).toMatch(/^[0-9a-f]{40}$/u)
    expect(generatedVarDct.sourceArchiveSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(generatedVarDct.fixtures).toHaveLength(5)
    expect(new Set(generatedVarDct.fixtures.map(({ id }) => id)).size).toBe(5)
    for (const fixture of generatedVarDct.fixtures) {
      expect(fixture.generator).toBe('benchmark/jpegxl/generate-vardct-corpus.ts')
      expect(fixture.coding).toBe('vardct')
      expect(['supported', 'unsupported']).toContain(fixture.expectedPureJsImageBehavior)
      expect(fixture.options).toContain('--modular=0')
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
        encoding: 'vardct',
        progressivePasses: fixture.progressive ? 3 : 1,
        jpegReconstruction: 'unavailable',
        expectedPixelFormat: fixture.colorEncoding.startsWith('grayscale') ? 'gray8' : 'rgb8',
      })
      if (fixture.expectedPureJsImageBehavior === 'supported') {
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(encoded),
          defaultImageLimits,
        )
        if (!decoder) throw new Error('JPEG XL decoder is unavailable')
        const blocks = []
        for await (const block of decoder.decode()) blocks.push(block)
        expect(blocks).toHaveLength(1)
        const block = blocks[0]
        if (!block) throw new Error('JPEG XL VarDCT block is missing')
        expect(block).toMatchObject({
          x: 0,
          y: 0,
          width: fixture.width,
          height: fixture.height,
          format: fixture.colorEncoding.startsWith('grayscale') ? 'gray8' : 'rgb8',
        })
        const comparison = comparePixels(block.data, pnmPixels(oracle))
        expect(comparison.maximumError).toBeLessThanOrEqual(1)
        expect(comparison.rmse).toBeLessThan(0.5)
      } else {
        await expect(
          jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
      }
    }
  })
})
