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
  // Refused optional maps retain preceding geometry, qualified by both independent decoders.
  expect(result.bytes).toBe(56490)
  expect(result.encodedChecksum).toBe(1025777929)
  expect(result.inputChecksum).toBe(2068954295)
  expect(result.decodedChecksum).toBe(164368939)
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
  // Shared color/order selection changes this stream; both decoders qualify the same error limit.
  expect(result.bytes).toBe(43663)
  expect(result.encodedChecksum).toBe(3098140889)
  expect(result.inputChecksum).toBe(2068954295)
  expect(result.decodedChecksum).toBe(1202901999)
  expect(result.samples).toBe(2049 * 2048 * 4)
  expect(result.alphaError).toBe(0)
  expect(result.meanColorError).toBeLessThan(2.35)
  expect(result.ownedPeak).toBeLessThanOrEqual(67_108_864)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
}, 420_000)

it('preserves fine-quality opaque gradients within the original working budget', async () => {
  const result = await verifyJpegXlDcModel(67_108_864, 2049, 2048, 0.54)
  // Shared fine photo precision changes these pixels, qualified by native and Rust decoders.
  expect(result.bytes).toBe(1497094)
  expect(result.encodedChecksum).toBe(3270274125)
  expect(result.inputChecksum).toBe(2068954295)
  expect(result.decodedChecksum).toBe(216671879)
  expect(result.samples).toBe(2049 * 2048 * 4)
  expect(result.alphaError).toBe(0)
  expect(result.meanColorError).toBeLessThan(1.6)
  expect(result.ownedPeak).toBeLessThanOrEqual(67_108_864)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
}, 420_000)

it('returns the preceding fine-quality stream after optional rate-map allocation failure', async () => {
  const result = await verifyLargeJpegXlDcAllocationRecovery(0.54)
  // Recomputing the refused optional map preserves the normal fine-quality pixels.
  expect(result.bytes).toBe(1_497_054)
  expect(result.encodedChecksum).toBe(1404451838)
  expect(result.inputChecksum).toBe(2068954295)
  expect(result.decodedChecksum).toBe(216671879)
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
  // Content-qualified photo precision changes this small stream, verified by both decoders.
  expect(result.bytes).toBe(2383)
  expect(result.encodedChecksum).toBe(792771564)
  expect(result.inputChecksum).toBe(3720133924)
  expect(result.decodedChecksum).toBe(4003423285)
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
      // Shared precision changes the same verified preceding pixels in both recovery modes.
      expect(result.bytes).toBe(3008)
      expect(result.encodedChecksum).toBe(3595891780)
      expect(result.inputChecksum).toBe(3720133924)
      expect(result.decodedChecksum).toBe(4003423285)
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
