import { describe, expect, it } from 'vitest'

import {
  classifyOmeZarrCompatibilityFailure,
  parseOmeZarrCompatibilityCorpus,
  runOmeZarrCompatibilitySample,
} from '../benchmark/ome-zarr/compatibility.ts'
import { invalidInput, unsupportedOperation } from '../src/errors.ts'

const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const mockFetch =
  (files: Readonly<Record<string, Uint8Array>>): typeof fetch =>
  async (input, init) => {
    const path = new URL(String(input)).pathname.replace('/store/', '')
    const bytes = files[path]
    if (bytes === undefined) return new Response(null, { status: 404 })
    if (init?.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) },
      })
    }
    const range = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
    if (range === undefined || range === null) return new Response(null, { status: 400 })
    const start = Number(range[1])
    const end = Math.min(Number(range[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
    })
  }

describe('OME-Zarr compatibility runner', () => {
  it('probes, enumerates, inspects every level, and reads deterministic tiny regions', async () => {
    const files = {
      'zarr.json': json({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                axes: [
                  { name: 'y', type: 'space' },
                  { name: 'x', type: 'space' },
                ],
                datasets: [
                  { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
                  { path: '1', coordinateTransformations: [{ type: 'scale', scale: [2, 2] }] },
                ],
              },
            ],
          },
        },
      }),
      '0/zarr.json': json({
        zarr_format: 3,
        node_type: 'array',
        shape: [4, 4],
        data_type: 'uint8',
        chunk_grid: { name: 'regular', configuration: { chunk_shape: [2, 2] } },
        chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
        fill_value: 0,
        codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
        dimension_names: ['y', 'x'],
        attributes: {},
      }),
      '0/c/0/0': Uint8Array.of(1, 2, 5, 6),
      '0/c/0/1': Uint8Array.of(3, 4, 7, 8),
      '0/c/1/0': Uint8Array.of(9, 10, 13, 14),
      '0/c/1/1': Uint8Array.of(11, 12, 15, 16),
      '1/zarr.json': json({
        zarr_format: 3,
        node_type: 'array',
        shape: [2, 2],
        data_type: 'uint8',
        chunk_grid: { name: 'regular', configuration: { chunk_shape: [2, 2] } },
        chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
        fill_value: 0,
        codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
        dimension_names: ['y', 'x'],
        attributes: {},
      }),
      '1/c/0/0': Uint8Array.of(9, 10, 11, 12),
    }
    const result = await runOmeZarrCompatibilitySample(
      { id: 'tiny', collection: 'test', url: 'https://example.test/store/' },
      { fetch: mockFetch(files) },
    )
    expect(result).toMatchObject({
      classification: 'PASS',
      probeConfidence: 0.95,
      datasets: [
        {
          id: 'image',
          sampleType: 'uint8',
          levels: 2,
          selections: 6,
          bytesRead: 24,
          levelStorage: [
            {
              level: 0,
              codecs: ['bytes'],
              logicalChunkShape: [2, 2],
              storageChunkShape: [2, 2],
            },
            {
              level: 1,
              codecs: ['bytes'],
              logicalChunkShape: [2, 2],
              storageChunkShape: [2, 2],
            },
          ],
        },
      ],
    })
  })

  it('classifies stable consumer-facing failure categories', () => {
    expect(classifyOmeZarrCompatibilityFailure(unsupportedOperation('Zarr codec jpeg'))).toBe(
      'UNSUPPORTED_CODEC',
    )
    expect(
      classifyOmeZarrCompatibilityFailure(unsupportedOperation('Zarr data type complex64')),
    ).toBe('UNSUPPORTED_DTYPE')
    expect(classifyOmeZarrCompatibilityFailure(unsupportedOperation('OME-NGFF 0.6 metadata'))).toBe(
      'UNSUPPORTED_METADATA',
    )
    expect(classifyOmeZarrCompatibilityFailure(invalidInput('Malformed Zarr array'))).toBe(
      'INVALID',
    )
    expect(classifyOmeZarrCompatibilityFailure(new TypeError('fetch failed'))).toBe(
      'NETWORK_FAILURE',
    )
    expect(classifyOmeZarrCompatibilityFailure(new TypeError('Unexpected internal state'))).toBe(
      'INVALID',
    )
    expect(
      classifyOmeZarrCompatibilityFailure(
        new Error('Reader open failed', {
          cause: unsupportedOperation('OME-NGFF 0.6 metadata'),
        }),
      ),
    ).toBe('UNSUPPORTED_METADATA')
    expect(classifyOmeZarrCompatibilityFailure(invalidInput('Object returned status 503'))).toBe(
      'NETWORK_FAILURE',
    )
  })

  it('validates corpus entries, expected classifications, and unique ids', () => {
    expect(
      parseOmeZarrCompatibilityCorpus({
        schemaVersion: 1,
        samples: [
          {
            id: 'legacy',
            collection: 'test',
            url: 'https://example.test/store/.zgroup',
            expectedClassification: 'UNSUPPORTED_METADATA',
          },
        ],
      }).samples[0],
    ).toEqual({
      id: 'legacy',
      collection: 'test',
      url: 'https://example.test/store/.zgroup',
      expectedClassification: 'UNSUPPORTED_METADATA',
    })
    expect(() =>
      parseOmeZarrCompatibilityCorpus({
        schemaVersion: 1,
        samples: [
          { id: 'same', collection: 'a', url: 'https://example.test/a/' },
          { id: 'same', collection: 'b', url: 'https://example.test/b/' },
        ],
      }),
    ).toThrow(/repeated/u)
    expect(() =>
      parseOmeZarrCompatibilityCorpus({
        schemaVersion: 1,
        samples: [
          {
            id: 'bad',
            collection: 'test',
            url: 'https://example.test/store/',
            expectedClassification: 'UNKNOWN',
          },
        ],
      }),
    ).toThrow(/expectedClassification/u)
  })
})
