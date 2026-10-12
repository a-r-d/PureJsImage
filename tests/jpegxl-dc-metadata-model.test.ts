import { expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { encodeForwardModularMetadataGroup } from '../src/codecs/jpegxl-modular-encode.ts'
import { jpegXlDcMetadataPlanes as metadata } from './helpers/jpegxl-dc-metadata-model.ts'
import { verifyJpegXlDcModel } from './helpers/jpegxl-dc-model.ts'

it('owns only the selected metadata bytes and preserves its input planes', () => {
  const planes = metadata()
  const before = planes.values.map((plane) => plane.slice())
  const memory = new JpegXlEncoderMemory(16_777_216)
  try {
    const candidate = encodeForwardModularMetadataGroup(planes, 1_000_000, memory, 134_217_728)
    expect(candidate).toBeDefined()
    if (!candidate) throw new Error('Missing learned metadata candidate')
    expect(candidate.bitLength).toBeGreaterThan(0)
    expect(candidate.bitLength).toBeLessThan(1_000_000)
    expect(candidate.bytes.length).toBe(Math.ceil(candidate.bitLength / 8))
    expect(planes.values).toEqual(before)
    expect(memory.liveBytes).toBe(candidate.bytes.byteLength)
    memory.release(candidate.bytes)
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
  } finally {
    memory.close()
  }
})

it('rejects a metadata model above the existing bit floor without retaining scratch', () => {
  const memory = new JpegXlEncoderMemory(16_777_216)
  try {
    expect(encodeForwardModularMetadataGroup(metadata(), 1, memory, 134_217_728)).toBeUndefined()
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
  } finally {
    memory.close()
  }
})

it('unwinds metadata model allocations when the owner refuses scratch or output', () => {
  for (const [workingBytes, outputBytes] of [
    [1, 134_217_728],
    [8192, 134_217_728],
    [16_777_216, 1],
  ]) {
    if (workingBytes === undefined || outputBytes === undefined) throw new Error('Missing limits')
    const memory = new JpegXlEncoderMemory(workingBytes, outputBytes)
    try {
      expect(() =>
        encodeForwardModularMetadataGroup(metadata(), 1_000_000, memory, outputBytes),
      ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
      expect(memory.liveBytes).toBe(0)
      expect(memory.liveAllocations).toBe(0)
    } finally {
      memory.close()
    }
  }
})

it('preserves the public textured gradient pixels and exact alpha with learned metadata', async () => {
  const result = await verifyJpegXlDcModel()
  expect(result.inputChecksum).toBe(3720133924)
  expect(result.decodedChecksum).toBe(4003423285)
  expect(result.samples).toBe(513 * 257 * 4)
  expect(result.alphaError).toBe(0)
  expect(result.ownedPeak).toBeLessThanOrEqual(16_777_216)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
})
