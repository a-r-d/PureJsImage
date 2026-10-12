import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { encodeForwardModularColorGroup } from '../../src/codecs/jpegxl-modular-encode.ts'

export const jpegXlDcColorPlanes = () => {
  const width = 64
  const height = 64
  const values = [
    new Int32Array(width * height),
    new Int32Array(width * height),
    new Int32Array(width * height),
  ]
  for (let channel = 0; channel < values.length; channel++) {
    const plane = values[channel]
    if (!plane) throw new Error('Missing color plane')
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) plane[y * width + x] = (channel + 1) * (x + y) + ((x ^ y) & 7)
    }
  }
  return { values, widths: [width, width, width], heights: [height, height, height] }
}

export const verifyJpegXlDcColorModel = () => {
  const planes = jpegXlDcColorPlanes()
  const before = planes.values.map((plane) => plane.slice())
  const memory = new JpegXlEncoderMemory(16_777_216)
  try {
    const candidate = encodeForwardModularColorGroup(planes, 1_000_000, memory, 134_217_728)
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
    const rejected = encodeForwardModularColorGroup(planes, 1, memory, 134_217_728)
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
