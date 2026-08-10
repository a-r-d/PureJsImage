import { describe, expect, it } from 'vitest'
import { validateExecution } from '../benchmark/lib/validate-output.ts'
import { inspectTiffDependencies } from '../scripts/analyze-tiff-dependencies.ts'
import type { Workflow } from '../benchmark/types.ts'

import { identifyTiff } from '../benchmark/lib/tiff.ts'

const tiffDimensionsFixture = (
  width: number,
  height: number,
  littleEndian: boolean,
): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(38)
  const view = new DataView(bytes.buffer)
  bytes.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d])
  view.setUint16(2, 42, littleEndian)
  view.setUint32(4, 8, littleEndian)
  view.setUint16(8, 2, littleEndian)

  view.setUint16(10, 256, littleEndian)
  view.setUint16(12, 4, littleEndian)
  view.setUint32(14, 1, littleEndian)
  view.setUint32(18, width, littleEndian)

  view.setUint16(22, 257, littleEndian)
  view.setUint16(24, 4, littleEndian)
  view.setUint32(26, 1, littleEndian)
  view.setUint32(30, height, littleEndian)
  return bytes
}
const bigTiffDimensionsFixture = (width: number, height: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(72)
  const view = new DataView(bytes.buffer)
  bytes.set([0x49, 0x49])
  view.setUint16(2, 43, true)
  view.setUint16(4, 8, true)
  view.setBigUint64(8, 16n, true)
  view.setBigUint64(16, 2n, true)
  for (const [index, tag, value] of [
    [0, 256, width],
    [1, 257, height],
  ] as const) {
    const entry = 24 + index * 20
    view.setUint16(entry, tag, true)
    view.setUint16(entry + 2, 4, true)
    view.setBigUint64(entry + 4, 1n, true)
    view.setUint32(entry + 12, value, true)
  }
  return bytes
}
const unsupportedDependencyFixture = (): Uint8Array<ArrayBuffer> => {
  const entries = [
    [256, 4, 32],
    [257, 4, 16],
    [258, 3, 12],
    [259, 3, 50_000],
    [262, 3, 1],
    [277, 3, 1],
    [317, 3, 3],
    [339, 3, 2],
  ] as const
  const bytes = new Uint8Array(8 + 2 + entries.length * 12 + 4)
  const view = new DataView(bytes.buffer)
  bytes.set([0x49, 0x49])
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)
  view.setUint16(8, entries.length, true)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = 10 + index * 12
    const [tag, type, value] = entries[index] ?? [0, 0, 0]
    view.setUint16(entry, tag, true)
    view.setUint16(entry + 2, type, true)
    view.setUint32(entry + 4, 1, true)
    if (type === 3) view.setUint16(entry + 8, value, true)
    else view.setUint32(entry + 8, value, true)
  }
  return bytes
}

describe('TIFF benchmark inspection', () => {
  it('reads classic TIFF and BigTIFF dimensions', () => {
    expect(identifyTiff(tiffDimensionsFixture(4000, 3000, true))).toEqual({
      type: 'tiff',
      width: 4000,
      height: 3000,
    })
    expect(identifyTiff(tiffDimensionsFixture(157, 151, false))).toEqual({
      type: 'tiff',
      width: 157,
      height: 151,
    })
    expect(identifyTiff(bigTiffDimensionsFixture(1024, 768))).toEqual({
      type: 'tiff',
      width: 1024,
      height: 768,
    })
  })

  it('rejects truncated and invalid TIFF headers', () => {
    expect(identifyTiff(Uint8Array.of(0x49, 0x49, 0x2a, 0))).toBeUndefined()
    expect(identifyTiff(new Uint8Array(38))).toBeUndefined()

    const invalidOffset = tiffDimensionsFixture(10, 10, true)
    new DataView(invalidOffset.buffer).setUint32(4, 0xfffffff0, true)
    expect(identifyTiff(invalidOffset)).toBeUndefined()
  })

  it('validates independently pinned raw decode output', async () => {
    const workflow: Workflow = {
      id: 'raw',
      title: 'raw',
      tier: 'tiff',
      input: 'fixture',
      operations: [{ type: 'raw' }],
      expected: {
        format: 'tiff',
        width: 2,
        height: 1,
        pixelFormat: 'rgb8',
        decodedBytes: 6,
        rawSha256: 'pinned',
      },
    }
    await expect(
      validateExecution({
        workflow,
        execution: {
          decoded: {
            format: 'tiff',
            width: 2,
            height: 1,
            pixelFormat: 'rgb8',
            bytes: 6,
            sha256: 'pinned',
          },
        },
      }),
    ).resolves.toMatchObject({ valid: true, outputBytes: 6 })
  })

  it('reports every visible unsupported TIFF dependency', () => {
    const matrix = inspectTiffDependencies(unsupportedDependencyFixture(), 'fixture.tif')
    expect(matrix.dependencies).toEqual([
      'compression:50000',
      'display-range-unspecified',
      'grayscale-depth:12',
      'predictor:3',
      'sample-format:2',
    ])
  })
})
