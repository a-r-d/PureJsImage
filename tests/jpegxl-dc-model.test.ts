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
  // Expanded color DC saves 3,534 bytes; both decoders retain exact grids and recovery bounds.
  expect(result.bytes).toBe(56962)
  expect(result.encodedChecksum).toBe(2841516987)
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
  // Expanded color DC saves 3,635 bytes; both decoders retain exact grids and the memory bound.
  expect(result.bytes).toBe(43736)
  expect(result.encodedChecksum).toBe(1447552200)
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
  // Expanded color DC saves 4,644 fine bytes; both decoder grids and all hard bounds are unchanged.
  expect(result.bytes).toBe(1497124)
  expect(result.encodedChecksum).toBe(2751884134)
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
  // Expanded color DC saves 4,644 recovery bytes; both grids and all fallback bounds are unchanged.
  expect(result.bytes).toBe(1497084)
  expect(result.encodedChecksum).toBe(2725775188)
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
  // Expanded color DC saves 35 bytes; complete pixels and both independent grids match the baseline.
  expect(result.bytes).toBe(2393)
  expect(result.encodedChecksum).toBe(1569612896)
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
      // Ordinary AC model reuse saves 168 bytes in each recovery stream; native/Rust retain these pixels.
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
