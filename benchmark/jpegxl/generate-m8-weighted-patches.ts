import { writeFile } from 'node:fs/promises'
import {
  iterateJpegXlFrameStructures,
  type JpegXlFrameStructure,
  readJpegXlSourceFrameStructure,
} from '../../src/codecs/jpegxl-decode.ts'
import {
  JpegXlBitWriter,
  packSigned,
  writeHybridUint,
  writeModularHeader,
  writeModularTree,
  writePositiveF16,
  writePrefixCode,
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
  if (frame.passCount !== 1 || frame.upsampling !== 1 || frame.gaborish || frame.frameFlags & ~130)
    throw unsupportedOperation('JPEG XL animation writer frame coding configuration is unsupported')
  if (
    input.saveBeforeColorTransform &&
    (last ||
      (input.blend ?? 'replace') !== 'replace' ||
      (input.durationTicks !== 0 && (input.saveAsReference ?? 1) === 0) ||
      (input.x ?? 0) > 0 ||
      (input.y ?? 0) > 0 ||
      (input.x ?? 0) + input.width < options.width ||
      (input.y ?? 0) + input.height < options.height)
  )
    throw invalidInput('JPEG XL pre-transform reference requires a nonfinal full replacement frame')
  const writer = new JpegXlBitWriter()
  writer.writeBits(0, 1)
  writeU32(writer, 0, enums)
  writer.writeBits(frame.encoding === 'modular' ? 1 : 0, 1)
  if (frame.frameFlags === 0) writer.writeBits(0, 2)
  else if (frame.frameFlags <= 16) {
    writer.writeBits(1, 2)
    writer.writeBits(frame.frameFlags - 1, 4)
  } else {
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
  writer.writeBits(0, 1)
  writer.writeBits(frame.epfIterations, 2)
  if (frame.epfIterations) {
    if (frame.encoding !== 'vardct')
      throw unsupportedOperation('JPEG XL Modular animation filtering is unsupported')
    writer.writeBits(0, 3)
  }
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
  const width = 16,
    height = 8
  const back = new Uint8Array(width * height * 4),
    front = new Uint8Array(back.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 4; c++) {
        const i = (y * width + x) * 4 + c
        back[i] = c === 3 ? 160 : (20 + x * 5 + y * 9 + c * 30) & 255
        front[i] = c === 3 ? 96 : (190 - x * 3 - y * 5 - c * 20) & 255
      }
  const inputs = [
    { width, height, data: back, durationTicks: 1, saveBeforeColorTransform: true },
    { width, height, data: front, durationTicks: 1 },
  ]
  const options: EncodeJpegXlAnimationOptions = {
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
    for (const frame of inputs) yield frame
  }
  const chunks: Uint8Array[] = []
  for await (const part of encodeJpegXlAnimation(source(), options)) chunks.push(part)
  const original = Buffer.concat(chunks)
  const headers = []
  for await (const header of iterateJpegXlFrameStructures(
    new MemorySource(original),
    defaultImageLimits,
    {},
    16777216,
  ))
    headers.push(header)
  const section = new JpegXlBitWriter()
  const values = [8]
  for (let mode = 0; mode < 8; mode++) {
    values.push(1, mode * 2, 0, 1, height - 1, 0, mode * 2, 0, mode)
    if (mode >= 3) values.push(1)
    values.push(mode)
    if (mode >= 3) values.push(1)
  }
  const freq = new Uint32Array(256)
  for (const value of values) freq[value] = (freq[value] ?? 0) + 1
  const encoding = writePrefixCode(section, 10, freq)
  for (const value of values) writeHybridUint(section, value, encoding)
  if (mode === 'lossless') {
    section.writeBits(1, 1)
    section.writeBits(0, 1)
    writeModularHeader(section, false)
    writeModularTree(section, 0)
    const samples = []
    for (let c = 0; c < 4; c++)
      for (let i = c; i < front.length; i += 4) samples.push(packSigned(front[i]!))
    const counts = new Uint32Array(280)
    for (const sample of samples) {
      const token = sample < 256 ? sample : 248 + Math.floor(Math.log2(sample))
      counts[token] = (counts[token] ?? 0) + 1
    }
    const code = writePrefixCode(section, 1, counts)
    for (const sample of samples) writeHybridUint(section, sample, code)
  } else {
    const sourceSection = headers[1]?.sections[0]
    if (!sourceSection || headers[1]?.sections.length !== 1)
      throw new Error('Expected one lossy section')
    for (const byte of original.subarray(
      sourceSection.offset,
      sourceSection.offset + sourceSection.length,
    ))
      section.writeBits(byte, 8)
  }
  const payload = section.finish()
  const second = headers[1]!
  const encoded = Buffer.concat([
    original.subarray(0, second.frameHeaderOffset),
    frameHeader(
      { ...second, frameFlags: 2, sections: [{ offset: 0, length: payload.length }] },
      inputs[1]!,
      options,
      true,
    ),
    payload,
  ])
  await writeFile(
    `tests/fixtures/jpegxl/m8-static/weighted-patches${mode === 'lossy' ? '-lossy' : ''}.jxl`,
    encoded,
  )
}
