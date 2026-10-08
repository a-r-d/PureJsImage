import {
  createFineAllocationPhoto,
  fineAllocationWidth,
  fineAllocationHeight,
} from './helpers/jpegxl-fine-photo.ts'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import * as memory from '../src/codecs/jpegxl-encoder-memory.ts'
import { limitExceeded } from '../src/errors.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'

// The complete original stream was independently reproduced in JXLENC-2231.
// Inject only the optional nine-Q allocation; keep the original 32-MiB cap.
it('retains original JPEG XL bytes when optional fine quantizer scratch is unavailable', async () => {
  const width = fineAllocationWidth,
    height = fineAllocationHeight,
    maxWorkingBytes = 33_554_432
  const pixels = createFineAllocationPhoto()
  const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
  const inputHash = digest(pixels)
  expect(inputHash).toBe('6b878fb9d6c885283a4f7a29cd576b66327a0cd653112736455cbd1842a22bbc')
  const originalAllocate = memory.allocateJpegXlArray
  let rejectedMenus = 0
  const rejectMenu: typeof originalAllocate = (owner, arrayType, length) => {
    if (
      arrayType.BYTES_PER_ELEMENT === 8 &&
      length === Math.ceil(width / 8) * Math.ceil(height / 8) * 9
    ) {
      rejectedMenus++
      throw limitExceeded('Test optional JPEG XL nine-Q allocation')
    }
    return originalAllocate(owner, arrayType, length)
  }
  const allocation = vi.spyOn(memory, 'allocateJpegXlArray').mockImplementation(rejectMenu)
  try {
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width,
      height,
      pixelFormat: 'rgba8',
      limits: defaultImageLimits,
      options: { mode: 'lossy', effort: 7, distance: 0.54, maxWorkingBytes },
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'straight',
        provenance: 'container-signaled',
        renderingIntent: 'relative',
      },
    })
    if (!encoder) throw new Error('JPEG XL encoder is unavailable')
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * 4,
      format: 'rgba8',
      data: pixels,
    })
    await encoder.finish()
    expect(rejectedMenus).toBe(1)
    expect(digest(pixels)).toBe(inputHash)
    const encoded = sink.toUint8Array()
    expect(encoded.length).toBe(303446)
    expect(digest(encoded)).toBe('c45efd9ac2c9b13957554e9a095d582f896e8d717792461eb4a74157c0cb7510')
    if (
      !('managedLiveBytes' in encoder) ||
      !('managedLiveAllocations' in encoder) ||
      !('managedPeakBytes' in encoder)
    )
      throw new Error('JPEG XL ownership evidence is missing')
    expect(encoder.managedLiveBytes).toBe(0)
    expect(encoder.managedLiveAllocations).toBe(0)
    expect(encoder.managedPeakBytes).toBeLessThanOrEqual(maxWorkingBytes)
  } finally {
    allocation.mockRestore()
  }
}, 180_000)
