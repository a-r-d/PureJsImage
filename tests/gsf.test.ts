import { describe, expect, it } from 'vitest'
import { encodeGsf, openGsf } from '../src/scientific/formats/gsf.ts'
import type { RasterBlock } from '../src/raster.ts'

const collectValues = async (dataset: Awaited<ReturnType<typeof openGsf>>): Promise<number[]> => {
  const values: number[] = []
  for await (const block of dataset.readPlane({ z: 0, c: 0, t: 0 })) {
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let offset = 0; offset < block.data.byteLength; offset += 4) {
      values.push(view.getFloat32(offset, false))
    }
  }
  return values
}

describe('Gwyddion Simple Field scientific rasters', () => {
  it('round-trips float32 samples and preserves physical/custom metadata', async () => {
    const encoded = encodeGsf({
      width: 3,
      height: 2,
      values: new Float32Array([1.25, -2.5, Number.NaN, Number.POSITIVE_INFINITY, -0, 9]),
      xReal: 6e-6,
      yReal: 8e-6,
      xOffset: -1e-6,
      yOffset: 2e-6,
      xyUnit: 'm',
      valueUnit: 'V',
      title: 'AFM Δ signal',
      metadata: { Comment: 'deterministic synthetic fixture', Direction: 'Forward' },
    })
    const dataset = await openGsf(encoded, { rowsPerBlock: 1 })
    expect({
      dimensions: [dataset.sizeX, dataset.sizeY, dataset.sizeZ, dataset.sizeC, dataset.sizeT],
      sampleType: dataset.sampleType,
      physicalSizeX: dataset.physicalSizeX,
      physicalSizeY: dataset.physicalSizeY,
      originX: dataset.originX,
      originY: dataset.originY,
      channel: dataset.channels[0],
      comment: dataset.metadata.Comment,
    }).toEqual({
      dimensions: [3, 2, 1, 1, 1],
      sampleType: 'float32',
      physicalSizeX: { value: 2e-6, unit: 'm' },
      physicalSizeY: { value: 4e-6, unit: 'm' },
      originX: { value: -1e-6, unit: 'm' },
      originY: { value: 2e-6, unit: 'm' },
      channel: { name: 'AFM Δ signal', samplesPerPixel: 1, unit: 'V' },
      comment: 'deterministic synthetic fixture',
    })
    const values = await collectValues(dataset)
    expect(values.slice(0, 2)).toEqual([1.25, -2.5])
    expect(Number.isNaN(values[2])).toBe(true)
    expect(values[3]).toBe(Number.POSITIVE_INFINITY)
    expect(Object.is(values[4], -0)).toBe(true)
    expect(values[5]).toBe(9)
  })

  it('reads only requested ROI rows and emits canonical big-endian float32 blocks', async () => {
    const encoded = encodeGsf({
      width: 4,
      height: 3,
      values: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    })
    const dataset = await openGsf(encoded)
    const blocks: RasterBlock[] = []
    for await (const block of dataset.readPlane({
      z: 0,
      c: 0,
      t: 0,
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    })) {
      blocks.push(block)
    }
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ x: 1, y: 1, width: 2, height: 2, stride: 8 })
    const data = blocks[0]?.data
    if (!data) throw new Error('GSF ROI block is missing')
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    expect([0, 4, 8, 12].map((offset) => view.getFloat32(offset, false))).toEqual([5, 6, 9, 10])
  })

  it('rejects malformed, truncated, trailing, and allocation-hostile files', async () => {
    const valid = encodeGsf({ width: 2, height: 1, values: new Float32Array([1, 2]) })
    await expect(openGsf(valid.subarray(0, valid.byteLength - 1))).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
    const trailing = new Uint8Array(valid.byteLength + 1)
    trailing.set(valid)
    await expect(openGsf(trailing)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      openGsf(new TextEncoder().encode('Gwyddion Simple Field 1.0\nXRes = 2\0')),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    const malformedUtf8 = Uint8Array.from([
      ...new TextEncoder().encode('Gwyddion Simple Field 1.0\nXRes = 1\nYRes = 1\nTitle = '),
      0xc3,
      0x28,
      0,
      0,
      0,
      0,
    ])
    await expect(openGsf(malformedUtf8)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      openGsf(encodeGsf({ width: 4, height: 4, values: new Float32Array(16) }), { maxPixels: 8 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('rejects invalid write dimensions and sample lengths', () => {
    expect(() => encodeGsf({ width: 2, height: 2, values: new Float32Array(3) })).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
    expect(() =>
      encodeGsf({ width: 2, height: 2, values: new Float32Array(4), maxPixels: 3 }),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
  })
})
