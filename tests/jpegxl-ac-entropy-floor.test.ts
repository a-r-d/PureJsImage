import { describe, expect, it } from 'vitest'
import { verifyCoefficientEntropyFloor } from './helpers/jpegxl-ac-entropy-floor.ts'

describe('JPEG XL optional AC entropy search', () => {
  for (const asynchronous of [false, true]) {
    it(`keeps the complete file floor and exact decoded RGBA, async=${asynchronous}`, async () => {
      const baseline = await verifyCoefficientEntropyFloor(asynchronous, false)
      const refined = await verifyCoefficientEntropyFloor(asynchronous, true)
      expect(baseline.bytes).toBe(50_599)
      expect(refined.bytes).toBe(48_693)
      expect(refined.bytes).toBeLessThanOrEqual(baseline.bytes)
      expect(refined.encodedChecksum).toBe(3330522328)
      expect(refined.decodedChecksum).toBe(baseline.decodedChecksum)
      expect(refined.decodedChecksum).toBe(1720027354)
      expect(refined.samples).toBe(513 * 129 * 4)
      expect(refined.alphaError).toBe(0)
      expect(refined.callerPreserved).toBe(true)
      expect(refined.ownedLive).toBe(0)
      expect(refined.ownedAllocations).toBe(0)
      expect(refined.ownedPeak).toBeLessThanOrEqual(16_777_216)
    })

    it(`returns the exact preceding stream after optional histogram LIMIT, async=${asynchronous}`, async () => {
      const baseline = await verifyCoefficientEntropyFloor(asynchronous, false)
      const recovered = await verifyCoefficientEntropyFloor(asynchronous, true, 'limit')
      expect(recovered.bytes).toBe(baseline.bytes)
      expect(recovered.encodedChecksum).toBe(baseline.encodedChecksum)
      expect(recovered.decodedChecksum).toBe(baseline.decodedChecksum)
      expect(recovered.samples).toBe(513 * 129 * 4)
      expect(recovered.alphaError).toBe(0)
      expect(recovered.hits).toBe(1)
      expect(recovered.callerPreserved).toBe(true)
      expect(recovered.ownedLive).toBe(0)
      expect(recovered.ownedAllocations).toBe(0)
    })

    it(`propagates other allocation errors and releases both candidates, async=${asynchronous}`, async () => {
      const result = await verifyCoefficientEntropyFloor(asynchronous, true, 'invalid')
      expect(result.propagated).toBe(true)
      expect(result.hits).toBe(1)
      expect(result.callerPreserved).toBe(true)
      expect(result.ownedLive).toBe(0)
      expect(result.ownedAllocations).toBe(0)
    })
  }

  it('propagates cancellation after optional histogram allocation and releases both streams', async () => {
    const result = await verifyCoefficientEntropyFloor(true, true, 'cancel')
    expect(result.propagated).toBe(true)
    expect(result.hits).toBeGreaterThan(0)
    expect(result.callerPreserved).toBe(true)
    expect(result.ownedLive).toBe(0)
    expect(result.ownedAllocations).toBe(0)
  })
})
