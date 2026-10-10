import { expect, it } from 'vitest'
import {
  verifyJpegXlDcAllocationRecovery,
  verifyJpegXlDcModel,
  verifyLargeJpegXlDcAllocationRecovery,
} from './helpers/jpegxl-dc-model.ts'

it('keeps the shared opaque path usable when every optional sharpness-map allocation fails', async () => {
  const result = await verifyLargeJpegXlDcAllocationRecovery(4, 33, 65)
  expect(result.bytes).toBeGreaterThan(0)
  expect(result.samples).toBe(33 * 65 * 4)
  expect(result.alphaError).toBe(0)
  expect(result.meanColorError).toBeLessThan(3)
  expect(result.rejectedAllocations).toBeGreaterThan(0)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
})

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
  // Complete native and Rust grids qualify the large-transform stream at the same error limit.
  expect(result.bytes).toBe(43_823)
  expect(result.encodedChecksum).toBe(2148818418)
  expect(result.inputChecksum).toBe(2068954295)
  expect(result.decodedChecksum).toBe(2560759752)
  expect(result.samples).toBe(2049 * 2048 * 4)
  expect(result.alphaError).toBe(0)
  expect(result.meanColorError).toBeLessThan(2.35)
  expect(result.ownedPeak).toBeLessThanOrEqual(67_108_864)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
}, 420_000)

it('preserves fine-quality opaque gradients within the original working budget', async () => {
  const result = await verifyJpegXlDcModel(67_108_864, 2049, 2048, 0.54)
  // Complete native and Rust grids qualify this fine-quality original-size path.
  expect(result.bytes).toBe(1_409_128)
  expect(result.encodedChecksum).toBe(1699746178)
  expect(result.inputChecksum).toBe(2068954295)
  expect(result.decodedChecksum).toBe(2231790086)
  expect(result.samples).toBe(2049 * 2048 * 4)
  expect(result.alphaError).toBe(0)
  expect(result.meanColorError).toBeLessThan(1.6)
  expect(result.ownedPeak).toBeLessThanOrEqual(67_108_864)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
}, 420_000)

it('returns the preceding fine-quality stream after optional rate-map allocation failure', async () => {
  const result = await verifyLargeJpegXlDcAllocationRecovery(0.54)
  // The raw stream matches the preceding direct encoder and public container payload.
  expect(result.bytes).toBe(1_490_466)
  expect(result.encodedChecksum).toBe(3813454611)
  expect(result.inputChecksum).toBe(2068954295)
  expect(result.decodedChecksum).toBe(2867919960)
  expect(result.samples).toBe(2049 * 2048 * 4)
  expect(result.alphaError).toBe(0)
  expect(result.meanColorError).toBeLessThan(1.6)
  expect(result.rejectedAllocations).toBe(1)
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
