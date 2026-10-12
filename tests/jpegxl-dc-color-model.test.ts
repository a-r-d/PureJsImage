import { expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { encodeForwardModularColorGroup } from '../src/codecs/jpegxl-modular-encode.ts'
import { jpegXlDcColorPlanes as colorPlanes } from './helpers/jpegxl-dc-color-model.ts'
import { verifyJpegXlDcModel } from './helpers/jpegxl-dc-model.ts'

it('keeps only selected color metadata and leaves caller planes unchanged', () => {
  const planes = colorPlanes()
  const before = planes.values.map((plane) => plane.slice())
  const memory = new JpegXlEncoderMemory(16_777_216)
  try {
    const candidate = encodeForwardModularColorGroup(planes, 1_000_000, memory, 134_217_728)
    expect(candidate).toBeDefined()
    if (!candidate) throw new Error('Missing color candidate')
    expect(candidate.bitLength).toBeGreaterThan(0)
    expect(candidate.bitLength).toBeLessThan(1_000_000)
    expect(planes.values).toEqual(before)
    expect(memory.liveBytes).toBe(candidate.bytes.byteLength)
    memory.release(candidate.bytes)
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
  } finally {
    memory.close()
  }
})

it('keeps the existing color floor and releases a rejected model', () => {
  const memory = new JpegXlEncoderMemory(16_777_216)
  try {
    expect(encodeForwardModularColorGroup(colorPlanes(), 1, memory, 134_217_728)).toBeUndefined()
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
  } finally {
    memory.close()
  }
})

it('releases color model storage after scratch or output refusal', () => {
  for (const [workingBytes, outputBytes] of [
    [1, 134_217_728],
    [8192, 134_217_728],
    [16_777_216, 1],
  ]) {
    if (workingBytes === undefined || outputBytes === undefined) throw new Error('Missing limits')
    const memory = new JpegXlEncoderMemory(workingBytes, outputBytes)
    try {
      expect(() =>
        encodeForwardModularColorGroup(colorPlanes(), 1_000_000, memory, outputBytes),
      ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
      expect(memory.liveBytes).toBe(0)
      expect(memory.liveAllocations).toBe(0)
    } finally {
      memory.close()
    }
  }
})

it('keeps public gradient pixels, exact alpha and the original owner ceiling', async () => {
  const result = await verifyJpegXlDcModel()
  expect(result.inputChecksum).toBe(3720133924)
  expect(result.decodedChecksum).toBe(4003423285)
  expect(result.alphaError).toBe(0)
  expect(result.ownedPeak).toBeLessThanOrEqual(16_777_216)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
})
