import { expect, it } from 'vitest'
import {
  verifyJpegXlDcAllocationRecovery,
  verifyJpegXlDcModel,
  verifyLargeJpegXlDcAllocationRecovery,
} from './helpers/jpegxl-dc-model.ts'

it('recovers large opaque images after optional filter-map allocation failure', async () => {
  const result = await verifyLargeJpegXlDcAllocationRecovery()
  expect(result.bytes).toBe(66_242)
  expect(result.encodedChecksum).toBe(3714271240)
  expect(result.inputChecksum).toBe(2068954295)
  expect(result.decodedChecksum).toBe(3313955893)
  expect(result.samples).toBe(2049 * 2048 * 4)
  expect(result.alphaError).toBe(0)
  expect(result.meanColorError).toBeLessThan(2.43)
  expect(result.rejectedAllocations).toBe(1)
  expect(result.ownedPeak).toBeLessThanOrEqual(67_108_864)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
}, 120_000)

it('preserves opaque gradient precision above four megapixels within its working budget', async () => {
  const result = await verifyJpegXlDcModel(67_108_864, 2049, 2048)
  // Complete native and Rust grids independently qualify this cutoff regression.
  expect(result.bytes).toBe(91_497)
  expect(result.encodedChecksum).toBe(2356709964)
  expect(result.inputChecksum).toBe(2068954295)
  expect(result.decodedChecksum).toBe(916522992)
  expect(result.samples).toBe(2049 * 2048 * 4)
  expect(result.alphaError).toBe(0)
  expect(result.meanColorError).toBeLessThan(2.35)
  expect(result.ownedPeak).toBeLessThanOrEqual(67_108_864)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
}, 120_000)

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
