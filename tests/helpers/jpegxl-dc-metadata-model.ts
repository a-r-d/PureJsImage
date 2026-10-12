import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { encodeForwardModularMetadataGroup } from '../../src/codecs/jpegxl-modular-encode.ts'

export const jpegXlDcMetadataPlanes = () => {
  const widths = [8, 8, 937, 64]
  const heights = [8, 8, 2, 64]
  const values = widths.map((width, channel) => {
    const height = heights[channel] ?? 0
    const plane = new Int32Array(width * height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        plane[y * width + x] =
          channel === 3
            ? 120 + Math.floor(x / 8) + (y < height / 2 ? (x + y) % 3 : (x * 11 + y * 7) % 47)
            : channel === 2
              ? x % 5 === 0
                ? x % 8
                : 0
              : (x + y) % 4
    return plane
  })
  return { values, widths, heights }
}

export const verifyJpegXlDcMetadataModel = () => {
  const planes = jpegXlDcMetadataPlanes()
  const before = planes.values.map((plane) => plane.slice())
  const memory = new JpegXlEncoderMemory(16_777_216)
  try {
    const candidate = encodeForwardModularMetadataGroup(planes, 1_000_000, memory, 134_217_728)
    if (!candidate || candidate.bitLength >= 1_000_000)
      throw new Error('Missing useful metadata candidate')
    let checksum = 2166136261
    for (const value of candidate.bytes) checksum = Math.imul(checksum ^ value, 16777619) >>> 0
    for (let channel = 0; channel < planes.values.length; channel++) {
      const plane = planes.values[channel],
        original = before[channel]
      if (!plane || !original) throw new Error('Missing metadata plane')
      for (let sample = 0; sample < plane.length; sample++)
        if (plane[sample] !== original[sample]) throw new Error('Metadata input changed')
    }
    if (memory.liveBytes !== candidate.bytes.byteLength)
      throw new Error('Metadata scratch escaped its scope')
    const rejected = encodeForwardModularMetadataGroup(planes, 1, memory, 134_217_728)
    if (rejected || memory.liveBytes !== candidate.bytes.byteLength)
      throw new Error('Rejected metadata retained scratch')
    memory.release(candidate.bytes)
    if (memory.liveBytes !== 0 || memory.liveAllocations !== 0)
      throw new Error('Metadata storage was not released')
    return {
      bytes: candidate.bytes.length,
      bitLength: candidate.bitLength,
      checksum,
      ownedPeak: memory.peakBytes,
      ownedLive: memory.liveBytes,
      ownedAllocations: memory.liveAllocations,
      callerPreserved: true,
      floorRejected: true,
    }
  } finally {
    memory.close()
  }
}
