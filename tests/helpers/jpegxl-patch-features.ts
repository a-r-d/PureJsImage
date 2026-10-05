import { JpegXlBitReader } from '../../src/codecs/jpegxl-bitstream.ts'
import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { readJpegXlFrameFeatures } from '../../src/codecs/jpegxl-frame-features.ts'
import { writeDocumentPatchFeatures } from '../../src/codecs/jpegxl-modular-encode.ts'

export const patchFeatureFixture = (dense = true) => {
  const groups: Parameters<typeof writeDocumentPatchFeatures>[1][number][] = []
  for (let index = 0; index < (dense ? 24 : 1); index++) {
    const width = 3 + (index % 7),
      height = 4 + (index % 5)
    const placements = []
    for (let placement = 0; placement < (dense ? 48 : 2); placement++)
      placements.push({
        x: 16 + ((placement * 173 + index * 7) % 960),
        y: 16 + ((placement * 97 + index * 13) % 960),
        width,
        height,
      })
    const source = placements[0]
    if (!source) throw new Error('Missing patch feature fixture')
    groups.push({ source, placements, atlasX: index * 11, atlasY: index * 9 })
  }
  return { groups, section: new Uint8Array([0xd3, 0x7b, 0x00, 0xff, 0x91, 0x2a, 0x6e]) }
}

const checksum = (bytes: Uint8Array): number => {
  let value = 2_166_136_261
  for (let index = 0; index < bytes.length; index++)
    value = Math.imul(value ^ (bytes[index] ?? 0), 16_777_619) >>> 0
  return value
}

export const verifyJpegXlPatchFeatures = (
  extraChannels: 0 | 1 = 1,
  maxWorkingBytes = 1_048_576,
  dense = true,
) => {
  const fixture = patchFeatureFixture(dense),
    memory = new JpegXlEncoderMemory(maxWorkingBytes)
  try {
    const encoded = writeDocumentPatchFeatures(
      fixture.section,
      fixture.groups,
      memory,
      extraChannels,
    )
    const features = readJpegXlFrameFeatures(encoded, 0, 2, 1_024, 1_024, extraChannels)
    let index = 0
    for (const group of fixture.groups)
      for (const expected of group.placements) {
        const actual = features.patches[index++]
        if (
          actual?.referenceId !== 3 ||
          actual.referenceX !== group.atlasX ||
          actual.referenceY !== group.atlasY ||
          actual.x !== expected.x ||
          actual.y !== expected.y ||
          actual.width !== expected.width ||
          actual.height !== expected.height ||
          actual.blendMode !== 1 ||
          actual.blending?.length !== extraChannels + 1 ||
          actual.blending.some(
            (blend) => blend.mode !== 1 || blend.alphaChannel !== 0 || blend.clamp,
          )
        )
          throw new Error('Patch feature fields changed')
      }
    if (features.patches.length !== index) throw new Error('Patch count changed')
    const reader = new JpegXlBitReader(encoded, features.endingBitPosition)
    for (const byte of fixture.section)
      if (reader.readBits(8) !== byte) throw new Error('Patch payload changed')
    const padding = encoded.length * 8 - reader.bitPosition
    if (padding && reader.readBits(padding) !== 0) throw new Error('Patch section padding changed')
    const result = {
      bytes: encoded.length,
      encodedChecksum: checksum(encoded),
      featureBits: features.endingBitPosition,
      patches: index,
      ownedPeak: memory.peakBytes,
    }
    memory.release(encoded)
    if (memory.liveBytes !== 0 || memory.liveAllocations !== 0)
      throw new Error('Patch feature storage did not unwind')
    return { ...result, ownedLive: memory.liveBytes, ownedAllocations: memory.liveAllocations }
  } finally {
    memory.close()
  }
}
