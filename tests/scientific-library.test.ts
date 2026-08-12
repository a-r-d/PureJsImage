import { describe, expect, it } from 'vitest'

import {
  createScientificLibrary,
  encodeGsf,
  gsfReader,
  mrcReader,
} from '../src/scientific/index.ts'
import {
  createScientificFileCompanionResolver,
  createScientificFileContext,
} from '../src/scientific/browser.ts'
import { MemorySource } from '../src/source.ts'
import { getImageSourceIdentity } from '../src/source-identity.ts'

describe('explicit scientific library facade', () => {
  it('enumerates a frozen JSON-safe subset and opens a dataset lazily', async () => {
    const science = createScientificLibrary({ readers: [gsfReader, mrcReader] })
    const capabilities = science.capabilities()
    expect(capabilities.readers.map(({ id }) => id)).toEqual(['purejsimage/gsf', 'purejsimage/mrc'])
    expect(capabilities.resourcePatterns).toEqual([
      {
        readerId: 'purejsimage/gsf',
        readerVersion: '1.0.0',
        extensions: ['gsf'],
        mediaTypes: ['application/x-gwyddion-spm'],
      },
      {
        readerId: 'purejsimage/mrc',
        readerVersion: '1.0.0',
        extensions: ['mrc', 'map', 'ccp4'],
        mediaTypes: ['application/x-mrc', 'application/x-ccp4'],
      },
    ])
    expect(Object.isFrozen(capabilities)).toBe(true)
    expect(Object.isFrozen(capabilities.resourcePatterns)).toBe(true)
    expect(JSON.parse(JSON.stringify(capabilities))).toEqual(capabilities)

    const document = await science.open({
      primary: {
        id: 'surface',
        source: new MemorySource(encodeGsf({ width: 2, height: 1, values: [2, 4] })),
      },
    })
    expect(document.datasets.map(({ id }) => id)).toEqual(['surface'])
    await expect(document.openDataset('surface')).resolves.toMatchObject({
      descriptor: { sampleType: 'float32' },
    })
  })

  it('builds browser File contexts with deterministic relative-name companions', async () => {
    const header = new File(['ENVI\nsamples = 1\n'], 'scene.hdr', {
      type: 'application/x-envi',
      lastModified: 10,
    })
    const data = new File([Uint8Array.of(7)], 'scene', { lastModified: 11 })
    const context = createScientificFileContext(header, { companions: [data] })
    expect(context.primary).toMatchObject({
      id: 'scene.hdr',
      name: 'scene.hdr',
      mediaType: 'application/x-envi',
    })
    await expect(getImageSourceIdentity(context.primary.source)).resolves.toMatchObject({
      kind: 'local-file',
      strength: 'weak',
      nameOrPath: 'scene.hdr',
      lastModified: 10,
    })
    await expect(
      context.companions?.resolve({ kind: 'role', role: 'data', relativeName: 'scene' }),
    ).resolves.toMatchObject({ id: 'scene', name: 'scene' })
    expect(() => createScientificFileCompanionResolver([data, data])).toThrow('ambiguous')
  })
})
