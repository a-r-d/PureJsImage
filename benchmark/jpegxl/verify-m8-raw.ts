import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { convertJpegXlNativeXybPlanes } from '../../src/codecs/jpegxl-vardct-render.ts'
import { type JpegXlNativeLayer, openJpegXlSequence } from '../../src/jpegxl.ts'
import { hashM8Layer, hashM8Sources } from './m8-output-digest.ts'

const sourceSha256 = await hashM8Sources()
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const nativeSha256 = digest(await readFile(native))
if (nativeSha256 !== '8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788')
  throw new Error('Native decoder differs')
const directory = '.tmp/jpegxl-m8/raw-verification'
await mkdir(directory, { recursive: true })
const results = []
for (const id of ['patches', 'progressive', 'noise-upsampling', 'weighted-patches-lossy']) {
  const path = `tests/fixtures/jpegxl/m8-static/${id}.jxl`
  const input = await readFile(path)
  const output = `${directory}/${id}.npy`
  execFileSync(native, [path, output, '--color_space=RGB_D65_SRG_Rel_SRG', '--num_threads=1'], {
    stdio: 'pipe',
    timeout: 120000,
  })
  const reference = await readFile(output)
  const offset = 10 + reference.readUInt16LE(8)
  const description = reference.toString('ascii', 10, offset)
  if (!description.includes("'<f4'") || !description.includes("'fortran_order': False"))
    throw new Error('Native array representation differs')
  const shape = /'shape': \(([^)]+)\)/
    .exec(description)?.[1]
    ?.split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => value > 0)
  if (!shape || shape.length !== 4) throw new Error('Native array dimensions differ')
  const channels = shape[3]!,
    width = shape[2]!,
    height = shape[1]!,
    frames = shape[0]!
  if (reference.length !== offset + frames * width * height * channels * 4)
    throw new Error('Native array extent differs')
  const sequence = await openJpegXlSequence(input)
  let last: JpegXlNativeLayer | undefined,
    count = 0
  try {
    for await (const layer of sequence.layers()) {
      last = layer
      count++
    }
  } finally {
    await sequence.close()
  }
  const x = last?.planes[0],
    y = last?.planes[1],
    b = last?.planes[2]
  if (
    !last ||
    last.domain !== 'xyb' ||
    !(x instanceof Float64Array) ||
    !(y instanceof Float64Array) ||
    !(b instanceof Float64Array) ||
    x.length !== width * height
  )
    throw new Error('Native XYB layer layout differs')
  const rgb = convertJpegXlNativeXybPlanes([x, y, b], last.header.opsinInverse)
  const hash = createHash('sha256')
  hashM8Layer(hash, last)
  let maximumError = 0,
    sum = 0
  for (let i = 0; i < width * height; i++)
    for (let c = 0; c < 3; c++) {
      const expected = reference.readFloatLE(
        offset + ((frames - 1) * width * height * channels + i * channels + c) * 4,
      )
      const difference = Math.abs(rgb[c]![i]! - expected)
      maximumError = Math.max(maximumError, difference)
      sum += difference * difference
    }
  const rmsError = Math.sqrt(sum / (width * height * 3))
  const result = {
    id,
    inputSha256: digest(input),
    nativeNpySha256: digest(reference),
    rawLayerSha256: hash.digest('hex'),
    codingLayers: count,
    width,
    height,
    maximumError,
    rmsError,
    passed: maximumError <= 0.004 && rmsError <= 0.0001,
  }
  results.push(result)
  console.log(JSON.stringify(result))
}
const passed = results.every((result) => result.passed)
await writeFile(
  `${directory}/report.json`,
  `${JSON.stringify({ sourceSha256, nativeSha256, passed, results }, null, 2)}\n`,
)
if (!passed) throw new Error('Native layer reconstruction differs')
