import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { readJpegXlFrameFeatures } from '../src/codecs/jpegxl-frame-features.ts'
import { writeDocumentPatchFeatures } from '../src/codecs/jpegxl-modular-encode.ts'
import { patchFeatureFixture, verifyJpegXlPatchFeatures } from './helpers/jpegxl-patch-features.ts'

describe('JPEG XL patch feature entropy', () => {
  it.each([0, 1] as const)(
    'preserves every patch field and adjoining bits with %i extra channels',
    (extraChannels) => {
      const result = verifyJpegXlPatchFeatures(extraChannels)
      expect(result.patches).toBe(1_152)
      expect(result.bytes).toBeLessThan(extraChannels === 0 ? 2_542 : 2_726)
      expect(result.ownedLive).toBe(0)
      expect(result.ownedAllocations).toBe(0)
    },
  )

  it.each([0, 1] as const)(
    'keeps the original small feature stream with %i extra channels',
    (extraChannels) => {
      const result = verifyJpegXlPatchFeatures(extraChannels, 1_048_576, false)
      expect(result.bytes).toBe(151)
      expect(result.encodedChecksum).toBe(extraChannels === 0 ? 3_757_068_713 : 988_280_171)
    },
  )

  it.each([0, 1] as const)(
    'returns the original stream at its prior minimum storage boundary with %i extra channels',
    (extraChannels) => {
      const limit = extraChannels === 0 ? 23_373 : 27_981
      const result = verifyJpegXlPatchFeatures(extraChannels, limit)
      expect(result.bytes).toBe(extraChannels === 0 ? 2_542 : 2_726)
      expect(result.encodedChecksum).toBe(extraChannels === 0 ? 555_703_487 : 2_363_837_144)
      expect(result.ownedPeak).toBeLessThanOrEqual(limit)
      expect(result.ownedLive).toBe(0)
      expect(result.ownedAllocations).toBe(0)
    },
  )

  it('preserves an empty dictionary and releases temporary feature models', () => {
    const memory = new JpegXlEncoderMemory(1_048_576)
    try {
      const encoded = writeDocumentPatchFeatures(new Uint8Array(0), [], memory)
      const features = readJpegXlFrameFeatures(encoded, 0, 2, 32, 32, 0)
      expect(features.patches).toEqual([])
      memory.release(encoded)
      expect(memory.liveBytes).toBe(0)
      expect(memory.liveAllocations).toBe(0)
    } finally {
      memory.close()
    }
  })

  it('preserves input and closes storage when required output exceeds its limit', () => {
    const fixture = patchFeatureFixture(),
      original = Uint8Array.from(fixture.section)
    const memory = new JpegXlEncoderMemory(1_048_576, 100)
    try {
      expect(() => writeDocumentPatchFeatures(fixture.section, fixture.groups, memory, 1)).toThrow(
        expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
      )
      expect(fixture.section).toEqual(original)
      expect(memory.liveBytes).toBe(0)
      expect(memory.liveAllocations).toBe(0)
    } finally {
      memory.close()
    }
  })
})
