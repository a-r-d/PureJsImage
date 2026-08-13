import { describe, expect, it } from 'vitest'

import type { RasterBlock } from '../src/raster.ts'
import { remapMrcYzRasterBlock } from '../src/scientific/readers/mrc-internal.ts'

describe('MRC cross-section lifecycle', () => {
  it('forwards the underlying YZ RasterBlock release callback', () => {
    let releases = 0
    const data = new Uint16Array([1, 2, 3])
    const block: RasterBlock = Object.freeze({
      x: 4,
      y: 5,
      width: 1,
      height: 3,
      stride: 2,
      format: Object.freeze({
        sampleType: 'uint16',
        channels: 1,
        planar: false,
      }),
      data: new Uint8Array(data.buffer),
      release() {
        releases += 1
      },
    })

    const remapped = remapMrcYzRasterBlock(block, 7)
    expect(remapped).toMatchObject({ x: 5, y: 7, width: 3, height: 1, stride: 6 })
    expect(remapped.data).toBe(block.data)
    expect(remapped.format).toBe(block.format)
    remapped.release?.()
    expect(releases).toBe(1)
  })
})
