import { writeFile } from 'node:fs/promises'
import {
  type JpegXlFrameStructure,
  readJpegXlSourceFrameStructure,
} from '../../src/codecs/jpegxl-decode.ts'
import {
  JpegXlBitWriter,
  writePositiveF16,
  writeU32,
} from '../../src/codecs/jpegxl-modular-encode.ts'
import {
  type EncodeJpegXlAnimationOptions,
  encodeJpegXlAnimation,
  type JpegXlAnimationInputFrame,
} from '../../src/codecs/jpegxl-sequence-encode.ts'
import { invalidInput, unsupportedOperation } from '../../src/errors.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

const enums = [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }] as const
const geometry = [
  { bits: 8, offset: 0 },
  { bits: 11, offset: 256 },
  { bits: 14, offset: 2304 },
  { bits: 30, offset: 18688 },
] as const
const positive = (value: number, name: string, allowZero = false): void => {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw invalidInput(`JPEG XL ${name} is invalid`)
}

const frameHeader = (
  frame: Readonly<JpegXlFrameStructure>,
  input: Readonly<JpegXlAnimationInputFrame>,
  options: Readonly<EncodeJpegXlAnimationOptions>,
  last: boolean,
): Uint8Array => {
  if (frame.passCount !== 1 || frame.upsampling !== 1 || frame.gaborish || frame.frameFlags & ~128)
    throw unsupportedOperation('JPEG XL animation writer frame coding configuration is unsupported')
  const writer = new JpegXlBitWriter()
  writer.writeBits(0, 1)
  writeU32(writer, 0, enums)
  writer.writeBits(frame.encoding === 'modular' ? 1 : 0, 1)
  if (frame.frameFlags === 0) writer.writeBits(0, 2)
  else {
    writer.writeBits(2, 2)
    writer.writeBits(frame.frameFlags - 17, 8)
  }
  // U64 values above 16 use selector 2 and an eight-bit payload offset by 17.
  // The forward VarDCT encoder sets only the skip-adaptive-LF-smoothing flag (128).
  if (frame.colorTransform !== 'xyb') writer.writeBits(0, 1)
  writer.writeBits(0, 2)
  for (const _channel of frame.extraChannels) writer.writeBits(0, 2)
  if (frame.encoding === 'modular') writer.writeBits(Math.log2(frame.groupDimension / 128), 2)
  else if (frame.colorTransform === 'xyb') {
    writer.writeBits(frame.xQuantizationScale, 3)
    writer.writeBits(frame.bQuantizationScale, 3)
  }
  writer.writeBits(0, 2)
  const x = input.x ?? 0,
    y = input.y ?? 0
  const custom =
    x !== 0 || y !== 0 || input.width !== options.width || input.height !== options.height
  writer.writeBits(custom ? 1 : 0, 1)
  if (custom) {
    writeU32(writer, x < 0 ? -2 * x - 1 : 2 * x, geometry)
    writeU32(writer, y < 0 ? -2 * y - 1 : 2 * y, geometry)
    writeU32(writer, input.width, geometry)
    writeU32(writer, input.height, geometry)
  }
  const mode =
    input.blend === 'add' ? 1 : input.blend === 'blend' ? 2 : input.blend === 'multiply' ? 4 : 0
  const partial =
    x > 0 || y > 0 || x + input.width < options.width || y + input.height < options.height
  for (let channel = 0; channel <= frame.extraChannels.length; channel++) {
    writeU32(writer, mode, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 2, offset: 3 }])
    if (mode === 2 && frame.extraChannels.length) writer.writeBits(0, 2)
    if (mode === 4 || (mode === 2 && frame.extraChannels.length)) writer.writeBits(1, 1)
    if (mode !== 0 || partial) writeU32(writer, input.source ?? 0, enums)
  }
  writeU32(writer, input.durationTicks, [
    { value: 0 },
    { value: 1 },
    { bits: 8, offset: 0 },
    { bits: 32, offset: 0 },
  ])
  if (options.animation.haveTimecodes) writer.writeBits(input.timecode ?? 0, 32)
  writer.writeBits(last ? 1 : 0, 1)
  if (!last) {
    writeU32(writer, input.saveAsReference ?? 1, enums)
    if ((input.durationTicks === 0 || (input.saveAsReference ?? 1) !== 0) && mode === 0 && !partial)
      writer.writeBits(input.saveBeforeColorTransform ? 1 : 0, 1)
  }
  writer.writeBits(0, 2) // Empty frame name.
  writer.writeBits(0, 1)
  writer.writeBits(1, 1)
  writer.writeBits(1, 1)
  for (const weight of [0.1, 0.04, 0.12, 0.06, 0.08, 0.03]) writePositiveF16(writer, weight)
  writer.writeBits(3, 2)
  if (frame.encoding === 'vardct') {
    writer.writeBits(1, 1)
    for (const value of [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]) writePositiveF16(writer, value)
  }
  writer.writeBits(1, 1)
  for (const value of [30, 6, 4, 0.5, 0.7]) writePositiveF16(writer, value)
  writer.writeBits(1, 1)
  if (frame.encoding === 'vardct') writePositiveF16(writer, 0.5)
  for (const value of [0.8, 5, 0.7]) writePositiveF16(writer, value)
  if (frame.encoding === 'modular') writePositiveF16(writer, 1)
  writer.writeBits(0, 2)
  writer.writeBits(0, 2)
  writer.writeBits(0, 1)
  writer.alignToByte()
  for (const section of frame.sections)
    writeU32(writer, section.length, [
      { bits: 10, offset: 0 },
      { bits: 14, offset: 1024 },
      { bits: 22, offset: 17408 },
      { bits: 30, offset: 4211712 },
    ])
  return writer.finish()
}

for (const mode of ['lossless', 'lossy'] as const) {
  const width = 32,
    height = 24,
    data = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      data[i] = (x * 17 + y * 3) & 255
      data[i + 1] = (x * 3 + y * 13) & 255
      data[i + 2] = (x * x + y * 7) & 255
    }
  const input = { width, height, data, durationTicks: 1 }
  const options: EncodeJpegXlAnimationOptions = {
    width,
    height,
    pixelFormat: 'rgb8',
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'none',
      provenance: 'container-signaled',
      renderingIntent: 'relative',
    },
    animation: {
      ticksPerSecondNumerator: 30,
      ticksPerSecondDenominator: 1,
      loops: 0,
      haveTimecodes: false,
    },
    encoding: { mode, effort: 3 },
  }
  async function* source() {
    yield input
  }
  const chunks: Uint8Array[] = []
  for await (const chunk of encodeJpegXlAnimation(source(), options)) chunks.push(chunk)
  const original = Buffer.concat(chunks)
  const header = await readJpegXlSourceFrameStructure(
    new MemorySource(original),
    defaultImageLimits,
  )
  const encoded = Buffer.concat([
    original.subarray(0, header.frameHeaderOffset),
    frameHeader(header, input, options, true),
    ...header.sections.map((section) =>
      original.subarray(section.offset, section.offset + section.length),
    ),
  ])
  await writeFile(`tests/fixtures/jpegxl/m8-static/custom-filters-${mode}.jxl`, encoded)
}
