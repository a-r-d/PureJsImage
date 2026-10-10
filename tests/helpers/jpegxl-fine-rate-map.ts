import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import {
  encodeJpegXlVarDct8,
  encodeJpegXlVarDct8Async,
} from '../../src/codecs/jpegxl-vardct-encode.ts'
import { limitExceeded } from '../../src/errors.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'
import { jpegXlDcModelPixels } from './jpegxl-dc-model.ts'

type Owned = ReturnType<JpegXlEncoderMemory['allocate']>
class RefuseFineRateMap extends JpegXlEncoderMemory {
  refused = 0
  override allocate<T extends Owned>(
    arrayType: { new (length: number): T; readonly BYTES_PER_ELEMENT: number },
    length: number,
    scope = this.currentScope,
  ): T {
    if (Object.is(arrayType, Uint8Array) && length === 17 * 9) {
      this.refused++
      throw limitExceeded('Refused optional fine rate map')
    }
    return super.allocate(arrayType, length, scope)
  }
}

const sameBytes = (actual: Uint8Array, expected: Uint8Array): void => {
  if (actual.length !== expected.length) throw new Error('Fine-quality byte length changed')
  for (let at = 0; at < actual.length; at++)
    if (actual[at] !== expected[at]) throw new Error(`Fine-quality byte changed at ${at}`)
}

const copyParts = (parts: readonly Uint8Array[]): Uint8Array => {
  let length = 0
  for (const part of parts) length += part.length
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

const verifyPublicFineRateMap = async (pixels: Uint8Array, before: Uint8Array) => {
  const width = 129,
    height = 65,
    budget = 16_777_216
  const encode = async (): Promise<Uint8Array> => {
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width,
      height,
      pixelFormat: 'rgba8',
      limits: defaultImageLimits,
      options: { mode: 'lossy', effort: 7, distance: 0.54, maxWorkingBytes: budget },
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
    })
    if (!encoder) throw new Error('Missing public fine-map encoder')
    try {
      await encoder.write({
        x: 0,
        y: 0,
        width,
        height,
        stride: width * 4,
        format: 'rgba8',
        data: pixels,
      })
      sameBytes(pixels, before)
      await encoder.finish()
    } finally {
      sameBytes(pixels, before)
    }
    if (
      !('managedLiveBytes' in encoder) ||
      encoder.managedLiveBytes !== 0 ||
      !('managedLiveAllocations' in encoder) ||
      encoder.managedLiveAllocations !== 0 ||
      !('managedPeakBytes' in encoder) ||
      typeof encoder.managedPeakBytes !== 'number' ||
      encoder.managedPeakBytes > budget
    )
      throw new Error('Public fine-map ownership did not close within its budget')
    return sink.toUint8Array()
  }
  const baseline = await encode(),
    originalAllocate = JpegXlEncoderMemory.prototype.allocate
  let refusals = 0
  JpegXlEncoderMemory.prototype.allocate = function <T extends Owned>(
    this: JpegXlEncoderMemory,
    arrayType: { new (length: number): T; readonly BYTES_PER_ELEMENT: number },
    length: number,
    scope = this.currentScope,
  ): T {
    if (Object.is(arrayType, Uint8Array) && length === 17 * 9) {
      refusals++
      throw limitExceeded('Refused public optional fine rate map')
    }
    return (originalAllocate<T>).call(this, arrayType, length, scope)
  }
  let recovered: Uint8Array
  try {
    recovered = await encode()
  } finally {
    JpegXlEncoderMemory.prototype.allocate = originalAllocate
  }
  if (refusals !== 1) throw new Error('Public fine rate-map refusal changed')
  sameBytes(recovered, baseline)
  const encodedBefore = recovered.slice()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(recovered), defaultImageLimits)
  if (
    !decoder ||
    decoder.width !== width ||
    decoder.height !== height ||
    decoder.pixelFormat !== 'rgba8'
  )
    throw new Error('Public fine-map decoded layout changed')
  const decoded = new Uint8Array(pixels.length),
    visited = new Uint8Array(width * height)
  let covered = 0
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== 'rgba8' ||
        !Number.isInteger(block.x) ||
        !Number.isInteger(block.y) ||
        !Number.isInteger(block.width) ||
        !Number.isInteger(block.height) ||
        !Number.isInteger(block.stride) ||
        block.width <= 0 ||
        block.height <= 0 ||
        block.x < 0 ||
        block.y < 0 ||
        block.x + block.width > width ||
        block.y + block.height > height ||
        block.stride < block.width * 4 ||
        block.data.length < (block.height - 1) * block.stride + block.width * 4
      )
        throw new Error('Invalid public fine-map decoded block')
      for (let y = 0; y < block.height; y++) {
        for (let x = 0; x < block.width; x++) {
          const pixel = (block.y + y) * width + block.x + x,
            source = y * block.stride + x * 4
          if (visited[pixel] !== 0) throw new Error('Duplicate public fine-map pixel')
          visited[pixel] = 1
          covered++
          for (let channel = 0; channel < 4; channel++) {
            const value = block.data[source + channel]
            if (value === undefined) throw new Error('Missing public fine-map sample')
            decoded[pixel * 4 + channel] = value
          }
          if (decoded[pixel * 4 + 3] !== before[pixel * 4 + 3])
            throw new Error('Public fine-map alpha changed')
        }
      }
    } finally {
      block.release?.()
    }
  }
  if (covered !== width * height) throw new Error('Incomplete public fine-map coverage')
  sameBytes(recovered, encodedBefore)
  sameBytes(pixels, before)
  let checksum = 2166136261
  for (const value of decoded) checksum = Math.imul(checksum ^ value, 16777619) >>> 0
  return {
    bytes: recovered.length,
    refusals,
    samples: decoded.length,
    covered,
    decodedChecksum: checksum,
  }
}

export const verifyJpegXlFineRateMap = async () => {
  const pixels = jpegXlDcModelPixels(129, 65),
    before = pixels.slice()
  let reference: Uint8Array | undefined
  const rows: { asynchronous: boolean; bytes: number; checksum: number; refusals: number }[] = []
  for (const asynchronous of [false, true]) {
    const ordinary = new JpegXlEncoderMemory(16_777_216),
      refused = new RefuseFineRateMap(16_777_216)
    const encode = async (memory: JpegXlEncoderMemory): Promise<Uint8Array> =>
      copyParts(
        asynchronous
          ? await encodeJpegXlVarDct8Async(pixels, 129, 65, 0.54, memory, async () => {}, 4, 7)
          : encodeJpegXlVarDct8(pixels, 129, 65, 0.54, memory, 4, 7),
      )
    try {
      const baseline = await encode(ordinary),
        recovered = await encode(refused)
      sameBytes(recovered, baseline)
      if (reference) sameBytes(baseline, reference)
      else reference = baseline
      if (refused.refused !== 1) throw new Error('Optional fine rate-map refusal changed')
      sameBytes(pixels, before)
      let checksum = 2166136261
      for (const byte of baseline) checksum = Math.imul(checksum ^ byte, 16777619) >>> 0
      rows.push({ asynchronous, bytes: baseline.length, checksum, refusals: refused.refused })
    } finally {
      ordinary.close()
      refused.close()
    }
    if (
      ordinary.liveBytes !== 0 ||
      ordinary.liveAllocations !== 0 ||
      refused.liveBytes !== 0 ||
      refused.liveAllocations !== 0
    )
      throw new Error('Fine rate-map ownership did not close')
  }
  return {
    width: 129,
    height: 65,
    distance: 0.54,
    rows,
    publicResult: await verifyPublicFineRateMap(pixels, before),
  }
}
