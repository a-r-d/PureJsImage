import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { MemorySource } from '../../../src/source.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
const root = process.argv[2] ?? '.tmp/jpegxl-conformance'
const tools = process.argv[3] ?? '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const definitions = ['bench_oriented_brg', 'cafe', 'grayscale', 'grayscale_jpeg', 'lz77_flower']
const results = []
for (const id of definitions) {
  const path = `${root}/testcases/${id}/input.jxl`
  const output = `.tmp/jpegxl-m4-color/conformance-${id}.png`
  const args = [
    path,
    output,
    '--num_threads=1',
    ...(id === 'grayscale' ? ['--color_space=RGB_D65_SRG_Rel_SRG'] : []),
  ]
  const native = spawnSync(`${tools}/djxl`, args, { encoding: 'utf8' })
  if (native.status !== 0) throw new Error(native.stderr)
  const expected = PNG.sync.read(await readFile(output))
  const input = await readFile(path)
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(input),
    { ...defaultImageLimits, maxDecodedBytes: 256 * 1024 * 1024 },
    { colorOutput: 'preserve' },
  )
  if (!decoder) throw new Error('Decoder unavailable')
  const digest = createHash('sha256')
  let maximumError = 0,
    squared = 0,
    samples = 0,
    rows = 0
  for await (const block of decoder.decode()) {
    try {
      digest.update(block.data)
      rows += block.height
      const channels = block.format === 'gray8' ? 1 : 3
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width; x++)
          for (let c = 0; c < 3; c++) {
            const sx = block.x + x,
              sy = block.y + y
            const target =
              id === 'bench_oriented_brg'
                ? (sx * expected.width + sy) * 4 + c
                : (sy * expected.width + sx) * 4 + c
            const actual =
              block.data[y * block.stride + x * channels + (channels === 1 ? 0 : c)] ?? 0
            const error = Math.abs(actual - (expected.data[target] ?? 0))
            maximumError = Math.max(maximumError, error)
            squared += error * error
            samples++
          }
    } finally {
      block.release?.()
    }
  }
  const rmse = Math.sqrt(squared / samples)
  if (rows !== decoder.height || maximumError > 1 || rmse > 0.55)
    throw new Error(`${id}: independent comparison failed (${maximumError}, ${rmse})`)
  results.push({
    id,
    inputSha256: createHash('sha256').update(input).digest('hex'),
    outputSha256: digest.digest('hex'),
    outputFormat: decoder.pixelFormat,
    rows,
    colorSemantics: decoder.colorSemantics,
    decoderOptions: { colorOutput: 'preserve' },
    comparison:
      id === 'grayscale'
        ? 'sRGB output from XYB; oracle explicitly converted to sRGB'
        : 'Native source-profile samples; codestream orientation applied to comparison coordinates',
    maximumError,
    rmse,
  })
}
await writeFile(
  'benchmark/jpegxl/production-program/m4-conformance-validation.json',
  `${JSON.stringify({ schemaVersion: 1, libjxlRevision: 'a7a9c787341cf703dede03c2009fa460cae5e5df', maximumError: 1, maximumRmse: 0.55, roundingPolicy: 'M3 independently approved eight-bit rounding threshold retained', results }, null, 2)}\n`,
)
console.log(`${results.length} distinct M4 conformance cases independently validated`)
