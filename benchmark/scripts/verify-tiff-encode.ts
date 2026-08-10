import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { allCodecs } from '../../dist/codec-entries/all.js'
import { createImageLibrary } from '../../dist/index.js'

interface OracleCase {
  readonly name: 'rgb' | 'rgba'
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
  readonly expected: Uint8Array
}

interface TiffInspection {
  readonly compression: number
  readonly photometric: number
  readonly samplesPerPixel: number
  readonly rowsPerStrip: number
  readonly stripCount: number
  readonly predictor: number
}

const run = (arguments_: readonly string[]): string => {
  const result = spawnSync('magick', arguments_, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
  })
  if (result.status !== 0) {
    throw new Error(`ImageMagick failed: magick ${arguments_.join(' ')}\n${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

const tiffValues = (input: Uint8Array, targetTag: number): readonly number[] => {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  if (input[0] !== 0x49 || input[1] !== 0x49 || view.getUint16(2, true) !== 42) {
    throw new Error('Encoder did not produce little-endian Classic TIFF')
  }
  const ifdOffset = view.getUint32(4, true)
  const entryCount = view.getUint16(ifdOffset, true)
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (view.getUint16(entryOffset, true) !== targetTag) continue
    const type = view.getUint16(entryOffset + 2, true)
    const count = view.getUint32(entryOffset + 4, true)
    const bytesPerValue = type === 3 ? 2 : type === 4 ? 4 : 0
    if (bytesPerValue === 0) throw new Error(`Unsupported TIFF field type ${type}`)
    const valuesOffset =
      count * bytesPerValue <= 4 ? entryOffset + 8 : view.getUint32(entryOffset + 8, true)
    const values: number[] = []
    for (let value = 0; value < count; value += 1) {
      const offset = valuesOffset + value * bytesPerValue
      values.push(type === 3 ? view.getUint16(offset, true) : view.getUint32(offset, true))
    }
    return values
  }
  throw new Error(`TIFF tag ${targetTag} is missing`)
}

const value = (input: Uint8Array, tag: number): number => {
  const result = tiffValues(input, tag)[0]
  if (result === undefined) throw new Error(`TIFF tag ${tag} has no value`)
  return result
}

const inspect = (input: Uint8Array): TiffInspection => ({
  compression: value(input, 259),
  photometric: value(input, 262),
  samplesPerPixel: value(input, 277),
  rowsPerStrip: value(input, 278),
  stripCount: tiffValues(input, 273).length,
  predictor: value(input, 317),
})

const rgbCase = (): OracleCase => {
  const width = 1024
  const height = 100
  const expected = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      expected[offset] = x & 0xff
      expected[offset + 1] = y & 0xff
      expected[offset + 2] = (x * 3 + y * 5) & 0xff
    }
  }
  return { name: 'rgb', width, height, channels: 3, expected }
}

const rgbaCase = (): OracleCase => {
  const width = 31
  const height = 17
  const expected = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      expected[offset] = (x * 11) & 0xff
      expected[offset + 1] = (y * 17) & 0xff
      expected[offset + 2] = (x * 7 + y * 13) & 0xff
      expected[offset + 3] = (x * 19 + y * 23) & 0xff
    }
  }
  return { name: 'rgba', width, height, channels: 4, expected }
}

const images = createImageLibrary(allCodecs)
const directory = await mkdtemp(join(tmpdir(), 'purejsimage-tiff-encode-'))
const results: {
  name: string
  width: number
  height: number
  encodedBytes: number
  inspection: TiffInspection
  exactPixels: boolean
}[] = []
try {
  for (const testCase of [rgbCase(), rgbaCase()]) {
    const rawPath = join(directory, `${testCase.name}.raw`)
    const pngPath = join(directory, `${testCase.name}.png`)
    const tiffPath = join(directory, `${testCase.name}.tiff`)
    const decodedPath = join(directory, `${testCase.name}-decoded.raw`)
    await writeFile(rawPath, testCase.expected)
    const pixelName = testCase.channels === 3 ? 'RGB' : 'RGBA'
    const pngName = testCase.channels === 3 ? 'PNG24' : 'PNG32'
    run([
      '-size',
      `${testCase.width}x${testCase.height}`,
      '-depth',
      '8',
      `${pixelName}:${rawPath}`,
      `${pngName}:${pngPath}`,
    ])
    const encoded = await (await images.open(await readFile(pngPath))).tiff().toUint8Array()
    await writeFile(tiffPath, encoded)
    run([tiffPath, '-depth', '8', `${pixelName}:${decodedPath}`])
    const decoded = await readFile(decodedPath)
    if (Buffer.compare(decoded, testCase.expected) !== 0) {
      throw new Error(`ImageMagick decoded ${testCase.name} TIFF pixels differently`)
    }
    const inspection = inspect(encoded)
    if (
      inspection.compression !== 8 ||
      inspection.photometric !== 2 ||
      inspection.samplesPerPixel !== testCase.channels ||
      inspection.predictor !== 2 ||
      inspection.stripCount < 1
    ) {
      throw new Error(`${testCase.name} TIFF does not match the canonical output profile`)
    }
    results.push({
      name: testCase.name,
      width: testCase.width,
      height: testCase.height,
      encodedBytes: encoded.byteLength,
      inspection,
      exactPixels: true,
    })
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}

const output = resolve('benchmark/results/tiff-encode-compatibility.json')
const imageMagick = run(['-version']).split('\n')[0] ?? 'ImageMagick version unavailable'
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  oracle: imageMagick,
  pixelValidation: 'Exact raw RGB/RGBA decode through ImageMagick/LibTIFF',
  results,
}
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
await writeFile(
  output.replace(/\.json$/u, '.md'),
  `# TIFF encode compatibility\n\n` +
    `${imageMagick} independently decoded the generated TIFF files to exact raw pixels.\n\n` +
    `| Case | Size | Samples | Compression | Predictor | Rows/strip | Strips | Output | Pixels |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n` +
    results
      .map(
        (result) =>
          `| ${result.name.toUpperCase()} | ${result.width}×${result.height} | ${result.inspection.samplesPerPixel} | ${result.inspection.compression} | ${result.inspection.predictor} | ${result.inspection.rowsPerStrip} | ${result.inspection.stripCount} | ${result.encodedBytes.toLocaleString()} bytes | exact |`,
      )
      .join('\n') +
    `\n`,
)
console.log(JSON.stringify({ output, oracle: imageMagick, results }, null, 2))
