import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import generatedLossless from '../benchmark/jpegxl/generated-lossless-manifest.json' with {
  type: 'json',
}
import generatedVarDct from '../benchmark/jpegxl/generated-vardct-manifest.json' with {
  type: 'json',
}
import { jpegXlCorpus, jpegXlConformanceCommit } from '../benchmark/jpegxl/corpus.ts'
import { jpegXlOracles } from '../benchmark/jpegxl/oracles.ts'
import { inspectJpegXl } from '../src/jpegxl.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

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
      expect(fixture.expectedPureJsImageBehavior).toBe('unsupported')
      expect(fixture.options).toContain('--modular=0')
      expect(fixture.features.length).toBeGreaterThan(0)
      const encoded = new Uint8Array(readFileSync(fixture.jxl))
      const oracle = new Uint8Array(readFileSync(fixture.oracle))
      expect(encoded.byteLength).toBe(fixture.jxlBytes)
      expect(oracle.byteLength).toBe(fixture.oracleBytes)
      expect(sha256(encoded)).toBe(fixture.jxlSha256)
      expect(sha256(oracle)).toBe(fixture.oracleSha256)
      if (fixture.progressive) {
        await expect(inspectJpegXl(encoded)).rejects.toMatchObject({
          code: 'UNSUPPORTED_OPERATION',
        })
      } else {
        await expect(inspectJpegXl(encoded)).resolves.toMatchObject({
          width: fixture.width,
          height: fixture.height,
          bitDepth: fixture.bitDepth,
          encoding: 'vardct',
          jpegReconstruction: 'unavailable',
          expectedPixelFormat: fixture.colorEncoding.startsWith('grayscale') ? 'gray8' : 'rgb8',
        })
      }
    }
  })
})
