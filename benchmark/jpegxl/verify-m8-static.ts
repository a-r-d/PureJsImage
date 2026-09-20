import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import { hashM8Sources } from './m8-output-digest.ts'

const sourceSha256 = await hashM8Sources()
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const nativeHash = digest(await readFile(native))
if (nativeHash !== '8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788')
  throw new Error('Native decoder hash differs')
const directory = '.tmp/jpegxl-m8/static-verification'
await mkdir(directory, { recursive: true })
const cases = [
  'bicycles',
  'bike',
  'bike_5',
  'noise',
  'noise_5',
  'opsin_inverse',
  'opsin_inverse_5',
  'grayscale_public_university',
  'patches',
  'patches_5',
  'patches_lossless',
  'progressive',
  'progressive_5',
  'custom-upsampling',
  'custom-filters-lossless',
  'custom-filters-lossy',
  'noise-upsampling',
  'modular-upsampling',
  'modular-ycbcr-444',
  'modular-ycbcr-422',
  'modular-ycbcr-420',
  'modular-ycbcr-noise',
  'modular-ycbcr-splines',
]
const results = []
for (const id of cases.filter(
  (id) => process.argv.length <= 2 || process.argv.slice(2).includes(id),
)) {
  const path =
    id === 'modular-upsampling'
      ? 'tests/fixtures/jpegxl/m8-native/modular-upsampling.jxl'
      : id.startsWith('custom-') || id.startsWith('modular-ycbcr-') || id === 'noise-upsampling'
        ? `tests/fixtures/jpegxl/m8-static/${id}.jxl`
        : `.tmp/jpegxl-conformance/testcases/${id}/input.jxl`
  const input = await readFile(path)
  const outputPath = `${directory}/${id}.png`
  execFileSync(
    native,
    [
      path,
      outputPath,
      '--color_space=RGB_D65_SRG_Rel_SRG',
      '--bits_per_sample=8',
      '--num_threads=1',
    ],
    { stdio: 'pipe', timeout: 120000 },
  )
  const png = await readFile(outputPath)
  const reference = PNG.sync.read(png)
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits, {
    colorOutput: 'srgb',
    frame: 0,
  })
  if (
    !decoder ||
    decoder.width !== reference.width ||
    decoder.height !== reference.height ||
    !['gray8', 'rgb8', 'rgba8'].includes(decoder.pixelFormat)
  )
    throw new Error(`${id}: output description differs`)
  const channels = decoder.pixelFormat === 'gray8' ? 1 : decoder.pixelFormat === 'rgb8' ? 3 : 4
  const hash = createHash('sha256')
  let samples = 0,
    maximumError = 0,
    squaredError = 0,
    differingSamples = 0
  for await (const block of decoder.decode()) {
    try {
      hash.update(block.data)
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width; x++)
          for (let c = 0; c < channels; c++) {
            const difference = Math.abs(
              (block.data[y * block.stride + x * channels + c] ?? 0) -
                (reference.data[((block.y + y) * decoder.width + x) * 4 + c] ?? 0),
            )
            maximumError = Math.max(maximumError, difference)
            squaredError += difference * difference
            if (difference) differingSamples++
            samples++
          }
    } finally {
      block.release?.()
    }
  }
  const result = {
    id,
    inputSha256: digest(input),
    nativePngSha256: digest(png),
    outputSha256: hash.digest('hex'),
    width: decoder.width,
    height: decoder.height,
    pixelFormat: decoder.pixelFormat,
    colorOutput: 'srgb',
    samples,
    differingSamples,
    maximumError,
    rmsError: Math.sqrt(squaredError / samples),
    passed: maximumError <= 2,
  }
  results.push(result)
  console.log(JSON.stringify(result))
}
const passed = results.every((result) => result.passed)
await writeFile(
  `${directory}/report.json`,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      sourceSha256,
      nativeHash,
      colorDomain:
        'Explicit sRGB, 8-bit output; exact dimensions and a maximum two-code-value difference per sample',
      maximumAllowedError: 2,
      passed,
      results,
    },
    null,
    2,
  )}\n`,
)
if (!passed) throw new Error('M8 static native comparison failed')
