/** Assemble a preview-bearing image from two independently encoded native frames. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { JpegXlBitReader } from '../../src/codecs/jpegxl-bitstream.ts'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { JpegXlBitWriter } from '../../src/codecs/jpegxl-modular-encode.ts'
import { resolveLimits } from '../../src/limits.ts'
import { createImageSource } from '../../src/source.ts'

const modular = process.argv[2] === 'modular'
const directory = modular
  ? 'tests/fixtures/jpegxl/m6-preview-modular'
  : 'tests/fixtures/jpegxl/m6-preview'
const temporary = '.tmp/jpegxl-m6-preview'
await mkdir(directory, { recursive: true })
await mkdir(temporary, { recursive: true })
const encoder = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/cjxl'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const encoderHash = hash(await readFile(encoder))
if (encoderHash !== '5c9dd3d879b81545b77947f9a6f1f7a4e58bbe2e4f3c2a52ca70365544939762')
  throw new Error('Pinned encoder required')
const width = 333,
  height = 77
const pixels = new Uint8Array(width * height * 3)
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 3
    pixels[index] = x % 256
    pixels[index + 1] = y * 3
    pixels[index + 2] = (x + y) % 256
  }
const ppm = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
await writeFile(`${temporary}/preview.ppm`, new Uint8Array([...ppm, ...pixels]))
const flags = [
  modular ? '--modular=1' : '--modular=0',
  modular ? '--distance=0' : '--distance=2',
  '--effort=3',
  '--num_threads=1',
  '--progressive_dc=0',
  '--patches=0',
  '--dots=0',
]
const result = spawnSync(
  encoder,
  [`${temporary}/preview.ppm`, `${temporary}/preview.jxl`, ...flags],
  { encoding: 'utf8' },
)
if (result.status !== 0) throw new Error(result.stderr)
const main = new Uint8Array(
  await readFile(
    modular
      ? 'tests/fixtures/jpegxl/m4-color/srgb-8.jxl'
      : 'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance2-progressive.jxl',
  ),
)
const preview = new Uint8Array(await readFile(`${temporary}/preview.jxl`))
const mainFrames = await readJpegXlSourceFrameStructures(
  await createImageSource(main, resolveLimits()),
  resolveLimits(),
)
const previewFrames = await readJpegXlSourceFrameStructures(
  await createImageSource(preview, resolveLimits()),
  resolveLimits(),
)
const mainFrame = mainFrames[0],
  previewFrame = previewFrames[0]
if (!mainFrame || !previewFrame || previewFrames.length !== 1) throw new Error('One frame required')
const reader = new JpegXlBitReader(main, 16)
const small = reader.readBits(1)
const dimension = (): void => {
  if (small) reader.readBits(5)
  else reader.readBits([9, 13, 18, 30][reader.readBits(2)] ?? 0)
}
dimension()
if (reader.readBits(3) === 0) dimension()
if (reader.readBits(1) !== 0) throw new Error('Explicit metadata required')
const extraOffset = reader.bitPosition
if (reader.readBits(1) !== 0) throw new Error('Original extra metadata must be absent')
if (reader.readBits(1) !== 0 || reader.readBits(2) !== 0)
  throw new Error('8-bit integer input required')
reader.readBits(1)
if (reader.readBits(2) !== 0) throw new Error('No extra channels required')
reader.readBits(1) // XYB metadata is inherited from the independently encoded main image.
if (mainFrame.colorTransform !== previewFrame.colorTransform)
  throw new Error('Preview and main color transforms must agree')
const enumeration = (): number => {
  const selector = reader.readBits(2)
  return selector < 2
    ? selector
    : reader.readBits(selector === 2 ? 4 : 6) + (selector === 2 ? 2 : 18)
}
if (reader.readBits(1) === 0) {
  if (
    reader.readBits(1) !== 0 ||
    enumeration() !== 0 ||
    enumeration() !== 1 ||
    enumeration() !== 1 ||
    reader.readBits(1) !== 0 ||
    enumeration() !== 13
  )
    throw new Error('Explicit sRGB required')
  enumeration()
}
const toneOffset = reader.bitPosition
if (reader.readBits(2) !== 0 || reader.readBits(1) !== 1)
  throw new Error('Default extensions and transforms required')
const metadataEnd = reader.bitPosition
const writer = new JpegXlBitWriter()
const copy = (start: number, end: number): void => {
  for (let bit = start; bit < end; bit++)
    writer.writeBits(((main[bit >>> 3] ?? 0) >>> (bit & 7)) & 1, 1)
}
copy(0, extraOffset)
writer.writeBits(1, 1) // extra_fields
writer.writeBits(0, 3) // orientation 1
writer.writeBits(0, 1) // no intrinsic dimensions
writer.writeBits(1, 1) // preview
writer.writeBits(0, 1) // direct dimensions
writer.writeBits(1, 2)
writer.writeBits(height - 65, 8)
writer.writeBits(0, 3) // explicit aspect ratio
writer.writeBits(2, 2)
writer.writeBits(width - 321, 10)
writer.writeBits(0, 1) // no animation
copy(extraOffset + 1, toneOffset)
writer.writeBits(1, 1) // default tone mapping
copy(toneOffset, metadataEnd)
writer.alignToByte()
const header = writer.finish()
const output = new Uint8Array(
  header.length +
    preview.length -
    previewFrame.frameHeaderOffset +
    main.length -
    mainFrame.frameHeaderOffset,
)
output.set(header)
output.set(preview.subarray(previewFrame.frameHeaderOffset), header.length)
output.set(
  main.subarray(mainFrame.frameHeaderOffset),
  header.length + preview.length - previewFrame.frameHeaderOffset,
)
await writeFile(`${directory}/embedded-preview.jxl`, output)
await writeFile(
  `${directory}/provenance.json`,
  JSON.stringify(
    {
      encoderHash,
      orientationBitOffset: extraOffset + 1,
      flags,
      mainSha256: hash(main),
      previewSha256: hash(preview),
      inputSha256: hash(output),
      assembly:
        'Native independent frames, first-party image-header composition. Expected pixels must come from the pinned C decoder.',
    },
    null,
    2,
  ) + '\n',
)
console.log(
  await readJpegXlSourceFrameStructures(
    await createImageSource(output, resolveLimits()),
    resolveLimits(),
  ).then((frames) => frames.map(({ isPreview, width, height }) => ({ isPreview, width, height }))),
)
