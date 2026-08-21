import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  geoCapabilityIds,
  parseGeoCapabilityManifest,
  readGeoCapabilityManifest,
} from '../scripts/geo-capability-manifest.ts'
import { geoReaders } from '../src/geo/readers/all.ts'

const packageExports = (): ReadonlyMap<string, unknown> => {
  const parsed: unknown = JSON.parse(readFileSync('package.json', 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('exports' in parsed)) {
    throw new Error('package.json does not contain exports')
  }
  const exportsValue = parsed.exports
  if (typeof exportsValue !== 'object' || exportsValue === null || Array.isArray(exportsValue)) {
    throw new Error('package.json exports must be an object')
  }
  return new Map(Object.entries(exportsValue))
}

describe('generated geo capability contract', () => {
  it('covers every public geo reader and the separate COG behavior profile', async () => {
    const manifest = await readGeoCapabilityManifest()
    const aliases: Readonly<Record<string, string>> = {
      netcdf: 'netcdf-cf',
      'world-file': 'world-file-image',
    }
    const runtimeIds = geoReaders.map(({ descriptor }) => {
      const id = descriptor.id.replace('purejsimage/geo/', '')
      return aliases[id] ?? id
    })
    const manifestIds = manifest.formats.map(({ id }) => id)

    expect(manifestIds).toContain('cog')
    expect(manifestIds.filter((id) => id !== 'cog').sort()).toEqual(runtimeIds.sort())
    for (const format of manifest.formats) {
      expect(
        packageExports().get(`./${format.publicEntry.replace('purejsimage/', '')}`),
      ).toBeDefined()
      expect(Object.keys(format.capabilities).sort()).toEqual([...geoCapabilityIds].sort())
    }
  })

  it('backs every positive claim with an existing evidence record', async () => {
    const manifest = await readGeoCapabilityManifest()
    const evidenceById = new Map(manifest.evidence.map((item) => [item.id, item]))
    const positiveStates = new Set([
      'implemented-tested',
      'implemented-fixture-limited',
      'metadata-only',
    ])

    for (const format of manifest.formats) {
      for (const capabilityId of geoCapabilityIds) {
        const claim = format.capabilities[capabilityId]
        if (positiveStates.has(claim.state)) {
          expect(claim.evidence.length, `${format.id}.${capabilityId}`).toBeGreaterThan(0)
        }
        for (const evidenceId of claim.evidence) {
          const evidence = evidenceById.get(evidenceId)
          expect(evidence, `${format.id}.${capabilityId}:${evidenceId}`).toBeDefined()
          expect(readFileSync(evidence?.path ?? '', 'utf8').length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('does not collapse unsupported states into a website supported flag', () => {
    const parsed: unknown = JSON.parse(
      readFileSync('docs-astro/src/data/geo-capabilities.json', 'utf8'),
    )
    expect(JSON.stringify(parsed)).not.toContain('"supported":true')
    expect(JSON.stringify(parsed)).toContain('"unsupported"')
    expect(JSON.stringify(parsed)).toContain('"out-of-scope"')
  })

  it('rejects missing capability rows and positive claims without evidence', async () => {
    const source: unknown = JSON.parse(readFileSync('capabilities/geo-manifest.json', 'utf8'))
    const missing = structuredClone(source)
    if (
      typeof missing !== 'object' ||
      missing === null ||
      !('formats' in missing) ||
      !Array.isArray(missing.formats)
    ) {
      throw new Error('Unexpected geo manifest fixture')
    }
    const first = missing.formats[0]
    if (typeof first !== 'object' || first === null || !('capabilities' in first)) {
      throw new Error('Unexpected geo manifest format fixture')
    }
    const capabilities = first.capabilities
    if (typeof capabilities !== 'object' || capabilities === null || Array.isArray(capabilities)) {
      throw new Error('Unexpected geo capabilities fixture')
    }
    delete capabilities.writer
    expect(() => parseGeoCapabilityManifest(missing)).toThrow(/capability keys differ/)

    const unsupportedPromotion = structuredClone(source)
    if (
      typeof unsupportedPromotion !== 'object' ||
      unsupportedPromotion === null ||
      !('formats' in unsupportedPromotion) ||
      !Array.isArray(unsupportedPromotion.formats)
    ) {
      throw new Error('Unexpected geo manifest fixture')
    }
    const format = unsupportedPromotion.formats[0]
    if (typeof format !== 'object' || format === null || !('capabilities' in format)) {
      throw new Error('Unexpected geo manifest format fixture')
    }
    const claims = format.capabilities
    if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
      throw new Error('Unexpected geo capability fixture')
    }
    claims.writer = {
      state: 'implemented-tested',
      detail: 'Invalid promotion without evidence.',
      evidence: [],
    }
    expect(() => parseGeoCapabilityManifest(unsupportedPromotion)).toThrow(/without evidence/)
  })
})
