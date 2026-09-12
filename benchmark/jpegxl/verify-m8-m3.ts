import { hashM8Sources } from './m8-output-digest.ts'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import baseline from './production-program/m3-common-static-report.json' with { type: 'json' }
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const nativeSha256 = digest(await readFile(native))
if (nativeSha256 !== '8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788')
  throw new Error('Native decoder hash differs')
const sourceSha256 = await hashM8Sources()
const cases = [
  ...baseline.results.map((result) => ({ id: result.id, encodedSha256: result.encodedSha256 })),
  {
    id: 'coco-val2017-000000001000-imazen-2',
    encodedSha256: 'c2ea5b81adbb39adda23cb3c0b67390c7769b91992c5bbbd7189034426c243fc',
  },
]
if (cases.length !== 300)
  throw new Error('M3 cohort must retain all 300 encodings of 100 photographs')
const directory = '.tmp/jpegxl-m8/m3-verification'
await mkdir(directory, { recursive: true })
const results = []
for (const entry of cases) {
  const inputPath = `.tmp/jpegxl-m3-common-static/${entry.id}.jxl`
  const input = await readFile(inputPath)
  if (digest(input) !== entry.encodedSha256)
    throw new Error(`${entry.id}: frozen input hash differs`)
  const oraclePath = `${directory}/current.ppm`
  execFileSync(native, [inputPath, oraclePath, '--bits_per_sample=8', '--num_threads=1'], {
    stdio: 'pipe',
    timeout: 120000,
  })
  const ppm = await readFile(oraclePath)
  const match = /^P6\n(\d+) (\d+)\n255\n/u.exec(ppm.subarray(0, 100).toString('ascii'))
  if (!match) throw new Error('Invalid native PPM')
  const width = Number(match[1]),
    height = Number(match[2]),
    start = match[0].length
  if (ppm.length !== start + width * height * 3) throw new Error('Invalid native sample extent')
  const began = performance.now()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (
    !decoder ||
    decoder.width !== width ||
    decoder.height !== height ||
    decoder.pixelFormat !== 'rgb8'
  )
    throw new Error(`${entry.id}: decoded geometry differs`)
  const hash = createHash('sha256')
  let count = 0,
    maximumError = 0,
    squaredError = 0
  for await (const block of decoder.decode()) {
    try {
      hash.update(block.data)
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width * 3; x++) {
          const difference = Math.abs(
            (block.data[y * block.stride + x] ?? 0) -
              (ppm[start + (block.y + y) * width * 3 + x] ?? 0),
          )
          maximumError = Math.max(maximumError, difference)
          squaredError += difference * difference
          count++
        }
    } finally {
      block.release?.()
    }
  }
  const rmsError = Math.sqrt(squaredError / count)
  const result = {
    ...entry,
    width,
    height,
    nativePpmSha256: digest(ppm),
    outputSha256: hash.digest('hex'),
    decodeAndCompareMilliseconds: performance.now() - began,
    maximumError,
    rmsError,
    passed: count === width * height * 3 && maximumError <= 1 && rmsError <= 0.55,
  }
  results.push(result)
  console.log(JSON.stringify(result))
}
const passed = results.every((result) => result.passed)
await writeFile(
  `${directory}/report.json`,
  `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), sourceSha256, nativeSha256, inputs: 'Frozen M3 inputs; 300 encodings of 100 resized COCO photographs, not 300 distinct originals', passed, results }, null, 2)}\n`,
)
if (!passed) throw new Error('M8 M3 revalidation failed')
