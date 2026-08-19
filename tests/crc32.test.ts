import { crc32 as zlibCrc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { crc32, updateCrc32 } from '../src/codecs/crc32.ts'

describe('CRC-32', () => {
  it('matches ISO-HDLC vectors used by PNG and ZIP', () => {
    expect(crc32(new Uint8Array())).toBe(0)
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf4_3926)
    expect(crc32(Uint8Array.of(0))).toBe(0xd202_ef8d)
  })

  it('matches Node zlib CRC-32 for whole buffers and incremental IDAT-sized chunks', () => {
    const data = new Uint8Array(65_536)
    for (let index = 0; index < data.byteLength; index += 1) data[index] = (index * 37 + 11) & 255
    const first = data.subarray(0, 20_000)
    const second = data.subarray(20_000, 50_000)
    const third = data.subarray(50_000)
    const whole = crc32(data)

    expect(whole).toBe(zlibCrc32(data) >>> 0)
    expect(crc32(first, second, third)).toBe(whole)
    expect(
      (updateCrc32(updateCrc32(updateCrc32(0xff_ff_ff_ff, first), second), third) ^
        0xff_ff_ff_ff) >>>
        0,
    ).toBe(whole)
    expect(zlibCrc32(third, zlibCrc32(second, zlibCrc32(first))) >>> 0).toBe(whole)
  })
})
