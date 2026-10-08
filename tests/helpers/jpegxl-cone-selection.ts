import {
  createFineAllocationPhoto,
  fineAllocationWidth,
  fineAllocationHeight,
} from './jpegxl-fine-photo.ts'
import type { ImageCodec } from '../../src/codec.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { JpegXlCodestreamSource, inspectJpegXlSource } from '../../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { resolveJpegXlLimits } from '../../src/codecs/jpegxl-limits.ts'
import { JpegXlVarDctMemoryLedger } from '../../src/codecs/jpegxl-vardct-memory.ts'
import { prepareJpegXlVarDctLowFrequency } from '../../src/codecs/jpegxl-vardct-render.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource, readExactly } from '../../src/source.ts'

export const conePhotoWidth = 2057
export const conePhotoHeight = 2040

export const createConePhoto = (): Uint8Array => {
  const tile = new Uint8Array(128 * 128 * 4)
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const base = 128 + 40 * Math.sin(x * 0.13) + 30 * Math.cos(y * 0.17)
      const at = (y * 128 + x) * 4
      tile[at] = Math.round(base + 8 * Math.sin(y * 0.19))
      tile[at + 1] = Math.round(base + 5 * Math.cos(x * 0.21))
      tile[at + 2] = Math.round(base - 7 * Math.sin((x + y) * 0.11))
      tile[at + 3] = 255
    }
  }
  const pixels = new Uint8Array(conePhotoWidth * conePhotoHeight * 4)
  for (let y = 0; y < conePhotoHeight; y++) {
    for (let x = 0; x < conePhotoWidth; x++) {
      const source = ((y & 127) * 128 + (x & 127)) * 4
      const target = (y * conePhotoWidth + x) * 4
      for (let channel = 0; channel < 4; channel++) {
        pixels[target + channel] = tile[source + channel] ?? 0
      }
    }
  }
  return pixels
}

const checksum = (bytes: Uint8Array): number => {
  let value = 2166136261
  for (let at = 0; at < bytes.length; at++) {
    value = Math.imul(value ^ (bytes[at] ?? 0), 16777619) >>> 0
  }
  return value
}

const verifyPhoto = async (
  distance: number,
  sink: Uint8ArraySink,
  codec: Pick<ImageCodec, 'createEncoder' | 'createDecoder'>,
  width = conePhotoWidth,
  height = conePhotoHeight,
  pixels = createConePhoto(),
) => {
  const callerChecksum = checksum(pixels)
  const encoder = await codec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgba8',
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: {
      mode: 'lossy',
      effort: 7,
      distance,
      container: false,
      ...(distance <= 1 ? { maxWorkingBytes: 67_108_864 } : {}),
    },
    limits: defaultImageLimits,
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
  if (checksum(pixels) !== callerChecksum) throw new Error('JPEG XL changed caller pixels')
  if (
    !('managedLiveBytes' in encoder) ||
    encoder.managedLiveBytes !== 0 ||
    !('managedLiveAllocations' in encoder) ||
    encoder.managedLiveAllocations !== 0 ||
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number'
  )
    throw new Error('JPEG XL encoder ownership did not close')
  const bytes = sink.toUint8Array()
  const physical = new MemorySource(bytes)
  const structure = await inspectJpegXlSource(physical, resolveJpegXlLimits())
  const logical = new JpegXlCodestreamSource(physical, structure)
  const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
  const frame = frames[0]
  if (frames.length !== 1 || !frame || frame.encoding !== 'vardct') {
    throw new Error('JPEG XL photo must exercise VarDCT selection')
  }
  const sections: Uint8Array[] = []
  for (const section of frame.sections.slice(0, 1 + frame.dcGroupCount)) {
    sections.push(await readExactly(logical, section.offset, section.length))
  }
  const ledger = new JpegXlVarDctMemoryLedger(defaultImageLimits.maxDecodedBytes)
  const state = prepareJpegXlVarDctLowFrequency(sections, frame, ledger)
  let selectedDct16Blocks = 0
  const quantizers = new Set<number>()
  try {
    for (const strategy of state.dcGroup.strategies) if (strategy === 4) selectedDct16Blocks++
    if (distance <= 1) {
      if (
        frame.xQuantizationScale !== 0 ||
        frame.bQuantizationScale !== 1 ||
        frame.epfIterations !== 0
      )
        throw new Error('JPEG XL fine photo did not exercise its channel policy')
      for (const value of state.dcGroup.quantization) {
        if (!Number.isInteger(value) || value < 4 || value > 12)
          throw new Error('JPEG XL fine photo has an invalid quantizer')
        quantizers.add(value)
      }
      if (quantizers.size < 2)
        throw new Error('JPEG XL fine photo did not select spatial quantizers')
    }
  } finally {
    state.release()
  }
  if (ledger.liveBytes !== 0) throw new Error('JPEG XL LF ownership did not close')
  if (distance > 1 && selectedDct16Blocks === 0)
    throw new Error('JPEG XL photo did not select DCT16')
  const decoder = await codec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
  if (
    !decoder ||
    decoder.width !== width ||
    decoder.height !== height ||
    decoder.pixelFormat !== 'rgba8'
  ) {
    throw new Error('JPEG XL photo decoder layout changed')
  }
  let coveredRows = 0,
    decodedChecksum = 2166136261,
    colorError = 0,
    alphaError = 0,
    releasedBlocks = 0
  for await (const block of decoder.decode()) {
    try {
      if (
        block.x !== 0 ||
        block.y !== coveredRows ||
        block.width !== width ||
        block.height < 1 ||
        block.y + block.height > height
      ) {
        throw new Error('JPEG XL photo rows are missing or repeated')
      }
      for (let y = 0; y < block.height; y++) {
        for (let x = 0; x < width; x++) {
          const source = ((block.y + y) * width + x) * 4
          const target = y * block.stride + x * 4
          for (let channel = 0; channel < 4; channel++) {
            const value = block.data[target + channel]
            if (value === undefined || !Number.isFinite(value))
              throw new Error('JPEG XL photo sample is missing or nonfinite')
            decodedChecksum = Math.imul(decodedChecksum ^ value, 16777619) >>> 0
            const difference = Math.abs(value - (pixels[source + channel] ?? 0))
            if (channel === 3) alphaError = Math.max(alphaError, difference)
            else colorError += difference
          }
        }
      }
      coveredRows += block.height
    } finally {
      if (block.release) {
        block.release()
        releasedBlocks++
      }
    }
  }
  if (coveredRows !== height) throw new Error('JPEG XL photo decode is incomplete')
  if (alphaError !== 0) throw new Error('JPEG XL photo changed opaque alpha')
  if (checksum(pixels) !== callerChecksum) throw new Error('JPEG XL decode changed caller pixels')
  return {
    bytes: bytes.length,
    encodedChecksum: checksum(bytes),
    decodedChecksum,
    callerChecksum,
    selectedDct16Blocks,
    quantizers: [...quantizers].sort((a, b) => a - b),
    xScale: frame.xQuantizationScale,
    bScale: frame.bQuantizationScale,
    epfIterations: frame.epfIterations,
    coveredRows,
    releasedBlocks,
    lfOwnedLive: ledger.liveBytes,
    samples: width * height * 4,
    alphaError,
    meanColorError: colorError / (width * height * 3),
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: encoder.managedLiveBytes,
    ownedAllocations: encoder.managedLiveAllocations,
  }
}

export const verifyConePhoto = (sink = new Uint8ArraySink()) => verifyPhoto(1.25, sink, jpegxlCodec)

export const verifyFinePhoto = (
  sink = new Uint8ArraySink(),
  codec: Pick<ImageCodec, 'createEncoder' | 'createDecoder'> = jpegxlCodec,
) =>
  verifyPhoto(
    0.56,
    sink,
    codec,
    fineAllocationWidth,
    fineAllocationHeight,
    createFineAllocationPhoto(),
  )
