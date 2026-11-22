import { afterEach, expect, it, vi } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { jpegXlLibjxlPolicyDistance } from '../src/codecs/jpegxl-libjxl-quant-field.ts'
import { limitExceeded } from '../src/errors.ts'
import { establishedJpegXlCodec } from './helpers/jpegxl-established-encoder.ts'
import {
  createPolicyArtwork,
  createPolicyPhoto,
  encodePolicyImage,
} from './helpers/jpegxl-libjxl-policy.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

it('encodes opaque sRGB photos with the libjxl-derived effort-7 policy', async () => {
  const photo = createPolicyPhoto()
  const result = await encodePolicyImage(photo, 1)
  expect(result).toMatchObject({
    bytes: 6873,
    encodedChecksum: 3990350626,
    decodedChecksum: 27944971,
    alphaError: 0,
    managedLiveBytes: 0,
  })
  expect(result.meanColorError).toBeLessThan(3.6)
  expect(result.maxColorError).toBeLessThanOrEqual(32)
  // The policy is calibrated to libjxl's distance scale; the established encoder spends about
  // twice the bytes on this photo at the same distance.
  const established = await encodePolicyImage(photo, 1, establishedJpegXlCodec)
  expect(established.bytes).toBe(14892)
  expect(result.bytes * 2).toBeLessThan(established.bytes + 100)
})

it('shrinks the file at each larger distance through the Gaborish fade', async () => {
  const photo = createPolicyPhoto()
  let previous = Number.POSITIVE_INFINITY
  for (const distance of [1.3, 1.5, 1.7, 1.85, 2, 2.2, 2.5, 3]) {
    const result = await encodePolicyImage(photo, distance)
    expect(result.bytes).toBeLessThan(previous)
    expect(result.alphaError).toBe(0)
    expect(result.meanColorError).toBeLessThan(5)
    previous = result.bytes
  }
})

it('maps requested distances to rising internal distances and fades Gaborish in', () => {
  let previous = 0
  for (let distance = 0.25; distance <= 25; distance *= 1.02) {
    const mapped = jpegXlLibjxlPolicyDistance(distance)
    expect(mapped.distance).toBeGreaterThan(previous)
    expect(mapped.distance).toBeLessThanOrEqual(25)
    if (distance <= 1.5) expect(mapped.gaborishStrength).toBe(0)
    if (distance >= 2.5) expect(mapped.gaborishStrength).toBe(1)
    previous = mapped.distance
  }
  expect(jpegXlLibjxlPolicyDistance(2).gaborishStrength).toBeCloseTo(0.563, 3)
  expect(jpegXlLibjxlPolicyDistance(25).distance).toBe(25)
  expect(() => jpegXlLibjxlPolicyDistance(0.2)).toThrowError(
    expect.objectContaining({ code: 'INVALID_INPUT' }),
  )
})

it('keeps exact palette output for flat artwork', async () => {
  const result = await encodePolicyImage(createPolicyArtwork(), 1)
  expect(result).toMatchObject({ bytes: 152, maxColorError: 0, alphaError: 0, managedLiveBytes: 0 })
  // About 1.3 s alone; the full parallel suite can push it past the default 5 s.
}, 20_000)

it('falls back to the established encoder when the policy cannot fit its working storage', async () => {
  const photo = createPolicyPhoto()
  const established = await encodePolicyImage(photo, 1, establishedJpegXlCodec)
  const allocate = JpegXlEncoderMemory.prototype.allocate
  let refused = 0
  vi.spyOn(JpegXlEncoderMemory.prototype, 'allocate').mockImplementation(function (
    this: JpegXlEncoderMemory,
    ...args: Parameters<JpegXlEncoderMemory['allocate']>
  ) {
    // Refuse storage requested by the libjxl policy modules only.
    if (new Error().stack?.includes('src/codecs/jpegxl-libjxl-')) {
      refused++
      throw limitExceeded('Test refused libjxl policy storage')
    }
    return allocate.apply(this, args)
  })
  const result = await encodePolicyImage(photo, 1)
  expect(refused).toBeGreaterThan(0)
  expect(result).toEqual(established)
})
