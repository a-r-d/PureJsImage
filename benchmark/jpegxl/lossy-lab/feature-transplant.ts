import {
  inspectJpegXlSource,
  JpegXlCodestreamSource,
} from '../../../src/codecs/jpegxl-container.ts'
import {
  decodeJpegXlNativeModularPlanes,
  readJpegXlSourceFrameStructures,
} from '../../../src/codecs/jpegxl-decode.ts'
import type { JpegXlPatch } from '../../../src/codecs/jpegxl-frame-features.ts'
import { writeJpegXlDevelopmentF16 } from '../../../src/codecs/jpegxl-jpeg-encode.ts'
import { resolveJpegXlLimits } from '../../../src/codecs/jpegxl-limits.ts'
import { JpegXlEncoderMemory } from '../../../src/codecs/jpegxl-encoder-memory.ts'
import {
  encodeJpegXlDevelopmentModularGroup,
  JpegXlBitWriter,
  jpegXlBitDepthDistribution,
  jpegXlDimensionDistribution,
  jpegXlExtraChannelCountDistribution,
  jpegXlFrameSizeDistribution,
  jpegXlNameLengthDistribution,
  jpegXlSectionSizeDistribution,
  jpegXlUpsamplingDistribution,
  jpegXlZeroToThreeDistribution,
  writeHybridUint,
  writePrefixCode,
  writeU32,
} from '../../../src/codecs/jpegxl-modular-encode.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'

export interface DevelopmentReference {
  readonly width: number
  readonly height: number
  readonly id: 0 | 1 | 2 | 3
  readonly planes: readonly Int32Array[]
  readonly dcQuantization: readonly [number, number, number]
}

/** Read reconstructed native reference samples, never peer compressed payloads. */
export async function extractDevelopmentReferences(
  bytes: Uint8Array,
): Promise<DevelopmentReference[]> {
  const source = new MemorySource(bytes)
  const structure = await inspectJpegXlSource(source, resolveJpegXlLimits())
  const logical = new JpegXlCodestreamSource(source, structure)
  const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
  const result: DevelopmentReference[] = []
  for (const frame of frames.slice(0, -1)) {
    if (
      frame.frameType !== 'reference' ||
      frame.encoding !== 'modular' ||
      frame.colorTransform !== 'xyb' ||
      !frame.saveBeforeColorTransform ||
      frame.upsampling !== 1 ||
      frame.gaborish ||
      frame.epfIterations
    )
      throw new Error('Development reference requires an unfiltered native Modular XYB frame')
    const sections = await Promise.all(frame.sections.map((s) => logical.read(s.offset, s.length)))
    const native = decodeJpegXlNativeModularPlanes(sections, frame, defaultImageLimits)
    if (
      native.planes.length !== 4 ||
      native.layouts.some((p) => p.width !== frame.frameWidth || p.height !== frame.frameHeight)
    )
      throw new Error('Development reference layout differs from RGBA crops')
    result.push({
      width: frame.frameWidth,
      height: frame.frameHeight,
      id: frame.saveAsReference,
      planes: native.planes,
      dcQuantization: native.dcQuantization,
    })
  }
  return result
}

/** The same normative image-header fields as our ordinary forward encoder. */
export function developmentImageHeader(
  width: number,
  height: number,
  memory: JpegXlEncoderMemory,
): Uint8Array {
  const writer = new JpegXlBitWriter(memory)
  writer.writeBits(0xff, 8)
  writer.writeBits(0x0a, 8)
  writer.writeBits(0, 1)
  writeU32(writer, height, jpegXlDimensionDistribution)
  writer.writeBits(0, 3)
  writeU32(writer, width, jpegXlDimensionDistribution)
  writer.writeBits(0, 3)
  writeU32(writer, 8, jpegXlBitDepthDistribution)
  writer.writeBits(1, 1)
  writeU32(writer, 1, jpegXlExtraChannelCountDistribution)
  writer.writeBits(1, 1) // Default alpha channel.
  writer.writeBits(1, 1) // XYB.
  writer.writeBits(1, 1) // Default sRGB color encoding.
  writer.writeBits(0, 2) // No extensions.
  writer.writeBits(1, 1) // Default transform metadata.
  writer.alignToByte()
  return writer.finish()
}

export async function encodeDevelopmentReference(
  reference: DevelopmentReference,
  memory: JpegXlEncoderMemory,
): Promise<readonly Uint8Array[]> {
  const group = await encodeJpegXlDevelopmentModularGroup(
    {
      values: reference.planes,
      widths: reference.planes.map(() => reference.width),
      heights: reference.planes.map(() => reference.height),
    },
    memory,
  )
  const global = new JpegXlBitWriter(memory)
  global.writeBits(0, 1) // Explicit DC quantization.
  for (const q of reference.dcQuantization) writeJpegXlDevelopmentF16(global, q * 128)
  global.writeBits(0, 1) // Local tree.
  for (const byte of group) global.writeBits(byte, 8)
  const section = global.finish()
  const header = new JpegXlBitWriter(memory)
  header.writeBits(0, 1)
  writeU32(header, 2, jpegXlZeroToThreeDistribution)
  header.writeBits(1, 1) // Modular.
  header.writeBits(0, 2) // No flags.
  writeU32(header, 1, jpegXlUpsamplingDistribution)
  writeU32(header, 1, jpegXlUpsamplingDistribution) // Alpha.
  header.writeBits(3, 2) // One 1024x1024 group.
  header.writeBits(1, 1) // Reference dimensions.
  writeU32(header, reference.width, jpegXlFrameSizeDistribution)
  writeU32(header, reference.height, jpegXlFrameSizeDistribution)
  writeU32(header, reference.id, jpegXlZeroToThreeDistribution)
  header.writeBits(1, 1) // Store XYB before color conversion.
  writeU32(header, 0, jpegXlNameLengthDistribution)
  header.writeBits(0, 1) // Explicit filters.
  header.writeBits(0, 1) // No Gaborish.
  header.writeBits(0, 2) // No EPF.
  header.writeBits(0, 2) // Filter extensions.
  header.writeBits(0, 2) // Frame extensions.
  header.writeBits(0, 1) // Default TOC order.
  header.alignToByte()
  writeU32(header, section.length, jpegXlSectionSizeDistribution)
  header.alignToByte()
  return [header.finish(), section]
}

/** One reference group per placement preserves decoded decisions exactly. */
export function writeDevelopmentPatches(
  section: Uint8Array,
  patches: readonly JpegXlPatch[],
  memory: JpegXlEncoderMemory,
): Uint8Array {
  const values = memory.allocate(Uint32Array, 1 + patches.length * 10)
  let count = 0
  values[count++] = patches.length
  for (const patch of patches) {
    values[count++] = patch.referenceId
    values[count++] = patch.referenceX
    values[count++] = patch.referenceY
    values[count++] = patch.width - 1
    values[count++] = patch.height - 1
    values[count++] = 0 // One placement.
    values[count++] = patch.x
    values[count++] = patch.y
    const color = patch.blending?.[0]?.mode ?? patch.blendMode
    const alpha = patch.blending?.[1]?.mode ?? 0
    if (color > 2 || alpha > 2)
      throw new Error('Development patch replay supports replace and add modes')
    values[count++] = color
    values[count++] = alpha
  }
  const frequencies = memory.allocate(Uint32Array, 512)
  for (const value of values) {
    const token = value < 256 ? value : 248 + Math.floor(Math.log2(value))
    frequencies[token] = (frequencies[token] ?? 0) + 1
  }
  const writer = new JpegXlBitWriter(memory)
  const encoding = writePrefixCode(writer, 10, frequencies)
  for (const value of values) writeHybridUint(writer, value, encoding)
  for (const byte of section) writer.writeBits(byte, 8)
  return writer.finish()
}
