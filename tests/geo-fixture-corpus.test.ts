import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface FixtureEntry {
  readonly id: string
  readonly format: string
  readonly source: string
  readonly materializer: string
  readonly profiles: readonly string[]
  readonly oracle: string
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid fixture ${key}`)
  return value
}

const entries = (): readonly FixtureEntry[] => {
  const parsed: unknown = JSON.parse(readFileSync('tests/fixtures/geo/manifest.json', 'utf8'))
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error('Invalid geo fixture corpus manifest')
  }
  return parsed.entries.map((value) => {
    if (!isRecord(value) || !Array.isArray(value.profiles)) throw new Error('Invalid fixture entry')
    if (value.profiles.some((profile) => typeof profile !== 'string' || profile.length === 0)) {
      throw new Error('Invalid fixture profiles')
    }
    const profiles: readonly string[] = value.profiles.filter(
      (profile): profile is string => typeof profile === 'string',
    )
    return {
      id: requiredString(value, 'id'),
      format: requiredString(value, 'format'),
      source: requiredString(value, 'source'),
      materializer: requiredString(value, 'materializer'),
      profiles,
      oracle: requiredString(value, 'oracle'),
    }
  })
}

describe('geo fixture corpus', () => {
  it('covers every advertised format with deterministic, traceable materializers', () => {
    const fixtures = entries()
    expect(new Set(fixtures.map(({ id }) => id)).size).toBe(fixtures.length)
    expect([...new Set(fixtures.map(({ format }) => format))].sort()).toEqual([
      'envi',
      'esri-ascii-grid',
      'geotiff',
      'geozarr',
      'netcdf-cf',
      'srtm-hgt',
      'world-file-image',
    ])
    for (const fixture of fixtures) {
      expect(existsSync(fixture.source), `${fixture.id}: ${fixture.source}`).toBe(true)
      expect(fixture.materializer.length).toBeGreaterThan(0)
      expect(fixture.oracle.length).toBeGreaterThan(0)
    }
  })

  it('covers the required geometry, registration, sample, layout, and hostile profiles', () => {
    const profiles = new Set(entries().flatMap(({ profiles: entryProfiles }) => entryProfiles))
    for (const required of [
      'north-up',
      'negative-y',
      'rotated-affine',
      'pixel-is-area',
      'pixel-is-point',
      'uint8',
      'uint16',
      'int16',
      'float',
      'multiscale',
      'multidimensional',
      'time-band-y-x',
      'time-level-y-x',
      'malformed',
      'overflow',
      'unsupported-codec',
    ]) {
      expect(profiles.has(required), required).toBe(true)
    }
  })
})
