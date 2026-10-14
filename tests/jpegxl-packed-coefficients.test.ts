import { expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import {
  packCoefficients,
  unpackCoefficients,
} from '../benchmark/jpegxl/lossy-lab/packed-coefficients.ts'

it('roundtrips the full signed coefficient domain including the escape value', () => {
  const memory = new JpegXlEncoderMemory(1000000)
  try {
    const input = Int16Array.from({ length: 65536 }, (_, i) => i - 32768)
    const packed = packCoefficients(input, memory)
    const output = new Int16Array(input.length)
    unpackCoefficients(packed, output)
    expect(output).toEqual(input)
    expect(packed.values).toBe(input)
    expect(packed.exceptions).toBeNull()
    expect(() => unpackCoefficients(packed, new Int16Array(1))).toThrow('too short')
  } finally {
    memory.close()
  }
})

it('stores sparse groups compactly and rejects inconsistent exception streams', () => {
  const memory = new JpegXlEncoderMemory(1000000)
  try {
    const input = new Int16Array(65536)
    input[0] = -128
    input[1] = -127
    input[65535] = 4095
    const packed = packCoefficients(input, memory)
    expect(memory.liveBytes).toBe(65540)
    const output = new Int16Array(input.length)
    unpackCoefficients(packed, output)
    expect(output).toEqual(input)
    expect(() =>
      unpackCoefficients({ values: Int8Array.of(-128), exceptions: new Int16Array(0) }, output),
    ).toThrow('Missing')
    expect(() =>
      unpackCoefficients({ values: new Int8Array(1), exceptions: Int16Array.of(1) }, output),
    ).toThrow('Unused')
  } finally {
    memory.close()
  }
})
