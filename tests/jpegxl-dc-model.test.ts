import { expect, it } from 'vitest'
import { verifyJpegXlDcAllocationRecovery, verifyJpegXlDcModel } from './helpers/jpegxl-dc-model.ts'

it('encodes textured gradients with learned DC models and the photo filter', async () => {
  const result = await verifyJpegXlDcModel()
  // Native and Rust decoders independently qualify the current filtered pixels.
  expect(result.bytes).toBe(4191)
  expect(result.encodedChecksum).toBe(1900552218)
  expect(result.inputChecksum).toBe(3720133924)
  expect(result.decodedChecksum).toBe(142860718)
  expect(result.samples).toBe(513 * 257 * 4)
  expect(result.alphaError).toBe(0)
  expect(result.ownedPeak).toBeLessThanOrEqual(16_777_216)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
})

for (const asynchronous of [false, true]) {
  it(
    'preserves filtered pixels and releases scratch after optional DC allocation failure, async=' +
      asynchronous,
    async () => {
      const result = await verifyJpegXlDcAllocationRecovery(asynchronous)
      expect(result.bytes).toBe(4829)
      expect(result.encodedChecksum).toBe(728017318)
      expect(result.inputChecksum).toBe(3720133924)
      expect(result.decodedChecksum).toBe(142860718)
      expect(result.samples).toBe(513 * 257 * 4)
      expect(result.alphaError).toBe(0)
      expect(result.rejectedAllocations).toBeGreaterThan(0)
      expect(result.ownedPeak).toBeLessThanOrEqual(16_777_216)
      expect(result.ownedLive).toBe(0)
      expect(result.ownedAllocations).toBe(0)
      if (asynchronous) expect(result.checkpoints).toBeGreaterThan(0)
      else expect(result.checkpoints).toBe(0)
    },
  )
}
