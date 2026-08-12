import { describe, expect, it } from 'vitest'
import { createExtensionHost } from '../src/extensions/index.ts'
import {
  createOperationDefinition,
  createOperationProvider,
  createValueTypeDefinition,
} from '../src/operations/index.ts'
import type { ScientificReader } from '../src/scientific/index.ts'

const reader: ScientificReader = Object.freeze({
  descriptor: Object.freeze({
    id: 'example/readers/cube',
    version: '1.0.0',
    format: 'Example cube',
    extensions: Object.freeze(['cube']),
    mediaTypes: Object.freeze(['application/x-example-cube']),
    capabilities: Object.freeze({ tiled: true }),
  }),
  probe: async () => ({ confidence: 0 }),
  open: async () => {
    throw new Error('Not used by capability test')
  },
})

const valueType = createValueTypeDefinition({
  descriptor: { id: 'example.data.cube', version: 1, title: 'Example cube' },
})
const resultType = createValueTypeDefinition({
  descriptor: { id: 'example.result.mean', version: 1, title: 'Example mean' },
})

const operation = createOperationDefinition({
  descriptor: {
    id: 'example.analysis.mean',
    version: 1,
    title: 'Mean',
    category: 'analysis',
    tags: ['analysis'],
    inputs: [{ name: 'cube', valueType: { id: 'example.data.cube', version: 1 } }],
    outputs: [{ name: 'mean', valueType: { id: 'example.result.mean', version: 1 } }],
    parameters: { type: 'object', properties: {}, closed: true },
    execution: 'reduction',
    reproducibility: { class: 'backend-stable' },
  },
})

const provider = createOperationProvider({
  descriptor: {
    id: 'example.reference',
    version: 1,
    kind: 'reference',
    buildFingerprint: 'example-reference-1',
  },
  prepare: async () => [],
})

describe('trusted extension bundles', () => {
  it('installs explicitly and builds a JSON-only manifest after provider preparation', async () => {
    const host = createExtensionHost({
      extensions: [
        {
          descriptor: {
            id: 'example.science',
            version: 1,
            apiVersion: 1,
            migrations: { graphSchema: 1 },
          },
          readers: [reader],
          valueTypes: [valueType, resultType],
          operations: [operation],
          providers: [provider],
        },
      ],
    })
    expect(host.manifest.providers).toEqual([])
    const prepared = await host.prepare()
    expect(prepared.manifest.providers.map((entry) => entry.id)).toEqual(['example.reference'])
    const json = JSON.stringify(prepared.manifest)
    expect(json).not.toContain('normalizeParameters')
    expect(json).not.toContain('prepare')
    expect(JSON.parse(json)).toEqual(prepared.manifest)
  })

  it('rejects collisions and incompatible API versions without mutating another host', () => {
    const original = createExtensionHost({
      extensions: [{ descriptor: { id: 'example.one', version: 1, apiVersion: 1 } }],
    })
    expect(() =>
      createExtensionHost({
        extensions: [
          { descriptor: { id: 'example.same', version: 1, apiVersion: 1 } },
          { descriptor: { id: 'example.same', version: 2, apiVersion: 1 } },
        ],
      }),
    ).toThrow('already installed')
    expect(() =>
      createExtensionHost({
        extensions: [
          {
            descriptor: {
              id: 'example.future',
              version: 1,
              apiVersion: 2,
            },
          },
        ],
      }),
    ).toThrow('incompatible API version')
    expect(original.manifest.extensions.map((entry) => entry.id)).toEqual(['example.one'])
  })
})
