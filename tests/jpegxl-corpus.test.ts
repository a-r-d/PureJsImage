import { describe, expect, it } from 'vitest'
import generatedLossless from '../benchmark/jpegxl/generated-lossless-manifest.json' with {
  type: 'json',
}
import { jpegXlCorpus, jpegXlConformanceCommit } from '../benchmark/jpegxl/corpus.ts'
import { jpegXlOracles } from '../benchmark/jpegxl/oracles.ts'

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
    expect(generatedLossless.fixtures).toHaveLength(30)
    expect(new Set(generatedLossless.fixtures.map(({ id }) => id)).size).toBe(30)
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
})
