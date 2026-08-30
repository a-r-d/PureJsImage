import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCapabilityManifest } from '../scripts/capability-manifest.ts'
import {
  candidateScientificBrowserReaders,
  loadCandidateScientificBrowserReaders,
  loadScientificBrowserReader,
  scientificBrowserReaderCatalog,
} from '../src/scientific/browser.ts'

const manifest = parseCapabilityManifest(
  JSON.parse(readFileSync('capabilities/manifest.json', 'utf8')),
)

describe('generated browser scientific reader catalog', () => {
  it('matches every authoritative manifest reader and package export', () => {
    expect(scientificBrowserReaderCatalog).toHaveLength(manifest.scientificReaders.length)
    expect(
      scientificBrowserReaderCatalog.map(({ id, packageExport }) => ({ id, packageExport })),
    ).toEqual(manifest.scientificReaders.map(({ id, packageExport }) => ({ id, packageExport })))
  })

  it('uses extensions and media types only to bound candidate chunks', () => {
    expect(candidateScientificBrowserReaders({ name: 'capture.MIB' }).map(({ id }) => id)).toEqual([
      'purejsimage/mib',
    ])
    expect(
      candidateScientificBrowserReaders({ name: 'ambiguous.emd' }).map(({ id }) => id),
    ).toEqual(['purejsimage/ncem-emd', 'purejsimage/velox-emd'])
    expect(candidateScientificBrowserReaders({ name: 'extensionless' })).toHaveLength(
      scientificBrowserReaderCatalog.length,
    )
    expect(
      candidateScientificBrowserReaders({ readerId: 'purejsimage/digital-micrograph' }).map(
        ({ id }) => id,
      ),
    ).toEqual(['purejsimage/digital-micrograph'])
  })

  it('loads the explicit first-party reader implementation without an aggregate import', async () => {
    const reader = await loadScientificBrowserReader('purejsimage/mib')
    expect(reader.descriptor.id).toBe('purejsimage/mib')
    const candidates = await loadCandidateScientificBrowserReaders({ name: 'example.dm4' })
    expect(candidates.map(({ descriptor }) => descriptor.id)).toEqual([
      'purejsimage/digital-micrograph',
    ])
  })

  it('fails closed for an unknown explicit reader', async () => {
    expect(() => candidateScientificBrowserReaders({ readerId: 'example/unknown' })).toThrow(
      /not in the browser catalog/u,
    )
    await expect(loadScientificBrowserReader('example/unknown')).rejects.toThrow(
      /not in the browser catalog/u,
    )
  })
})
