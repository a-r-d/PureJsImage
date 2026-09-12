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
  if (frame.passCount !== 1 || frame.upsampling !== 1 || frame.gaborish || frame.frameFlags & ~147)
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
  if (frame.colorTransform !== 'xyb') writer.writeBits(frame.colorTransform === 'ycbcr' ? 1 : 0, 1)
  if (frame.colorTransform === 'ycbcr')
    for (const mode of frame.chromaSubsampling) writer.writeBits(mode, 2)
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

const width = 16,
  height = 12
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
  encoding: { mode: 'lossless' },
}
const input = { width, height, data: new Uint8Array(width * height * 3), durationTicks: 1 }
async function* seed() {
  yield input
}
const chunks: Uint8Array[] = []
for await (const chunk of encodeJpegXlAnimation(seed(), options)) chunks.push(chunk)
const original = Buffer.concat(chunks)
let parsed: JpegXlFrameStructure | undefined
for await (const header of iterateJpegXlFrameStructures(
  new MemorySource(original),
  defaultImageLimits,
  {},
  16777216,
))
  parsed = header
if (!parsed) throw new Error('Missing seed frame')
for (const sampling of ['444', '422', '420', 'noise', 'splines'] as const) {
  const section = new JpegXlBitWriter()
  if (sampling === 'splines') {
    const features = [0, 2, 3, 0, 1, packSigned(11), packSigned(5)]
    for (let c = 0; c < 4; c++)
      for (let i = 0; i < 32; i++)
        features.push(i === 0 ? packSigned(c === 3 ? 8 : c === 1 ? 3 : 0) : 0)
    const frequency = new Uint32Array(256)
    for (const value of features) frequency[value] = (frequency[value] ?? 0) + 1
    const entropy = writePrefixCode(section, 6, frequency)
    for (const value of features) writeHybridUint(section, value, entropy)
  }

  if (sampling === 'noise') for (let i = 0; i < 8; i++) section.writeBits(20 + i * 15, 10)
  section.writeBits(1, 1)
  section.writeBits(0, 1)
  writeModularHeader(section, false)
  writeModularTree(section, 0)
  const values: number[] = []
  for (let c = 0; c < 3; c++) {
    const w =
        c === 1 || sampling === '444' || sampling === 'noise' || sampling === 'splines'
          ? width
          : width / 2,
      h = c === 1 || sampling !== '420' ? height : height / 2
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        values.push(packSigned(c === 1 ? y * 8 - 48 : c === 0 ? x * 4 - 24 : x * 2 + y * 3 - 20))
  }
  const counts = new Uint32Array(280)
  for (const value of values) {
    const token = value < 256 ? value : 248 + Math.floor(Math.log2(value))
    counts[token] = (counts[token] ?? 0) + 1
  }
  const code = writePrefixCode(section, 1, counts)
  for (const value of values) writeHybridUint(section, value, code)
  const payload = section.finish()
  const header = frameHeader(
    {
      ...parsed,
      frameFlags: sampling === 'noise' ? 1 : sampling === 'splines' ? 16 : 0,
      colorTransform: 'ycbcr',
      chromaSubsampling: [
        0,
        sampling === '444' || sampling === 'noise' || sampling === 'splines'
          ? 0
          : sampling === '422'
            ? 2
            : 1,
        0,
      ],
      sections: [{ offset: 0, length: payload.length }],
    },
    input,
    options,
    true,
  )
  await writeFile(
    `tests/fixtures/jpegxl/m8-static/modular-ycbcr-${sampling}.jxl`,
    Buffer.concat([original.subarray(0, parsed.frameHeaderOffset), header, payload]),
  )
}
