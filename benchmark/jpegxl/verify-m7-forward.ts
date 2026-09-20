import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { encodeJpegXlVarDct8 } from '../../src/codecs/jpegxl-vardct-encode.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

const directory = '.tmp/jpegxl-m7/forward-oracle'
await mkdir(directory, { recursive: true })
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function ppm(path: string, width: number, height: number): Promise<Uint8Array> {
  const bytes = await readFile(path)
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(bytes.subarray(0, 1024).toString('ascii'))
  if (
    !header ||
    Number(header[1]) !== width ||
    Number(header[2]) !== height ||
    bytes.length !== header[0].length + width * height * 3
  )
    throw new Error('Unexpected oracle PPM extent')
  return bytes.subarray(header[0].length)
}
function difference(reference: Uint8Array, actual: Uint8Array) {
  if (reference.length !== actual.length) throw new Error('Pixel extents differ')
  let total = 0,
    squares = 0,
    maximum = 0
  for (let index = 0; index < reference.length; index++) {
    const delta = Math.abs((reference[index] ?? 0) - (actual[index] ?? 0))
    total += delta
    squares += delta * delta
    maximum = Math.max(maximum, delta)
  }
  return {
    meanAbsoluteError: total / reference.length,
    rmse: Math.sqrt(squares / reference.length),
    maximum,
  }
}
const results: object[] = []
let failures = 0
for (const [width, height] of [
  [1, 1],
  [31, 19],
  [257, 33],
  [33, 257],
  [513, 517],
  [2051, 9],
]) {
  if (!width || !height) throw new Error('Invalid verifier dimensions')
  const input = Uint8Array.from({ length: width * height * 3 }, (_, index) => {
    const x = Math.floor(index / 3) % width,
      y = Math.floor(index / (width * 3))
    return index % 3 === 0
      ? Math.round((x * 255) / Math.max(1, width - 1))
      : index % 3 === 1
        ? Math.round((y * 255) / Math.max(1, height - 1))
        : 64
  })
  for (const distance of [0.25, 1, 3]) {
    const id = `${width}x${height}-d${distance}`
    try {
      const sink = new Uint8ArraySink()
      for (const part of encodeJpegXlVarDct8(input, width, height, distance)) await sink.write(part)
      const bytes = sink.toUint8Array()
      const path = `${directory}/${id}.jxl`
      await writeFile(path, bytes)
      const independent: object[] = []
      let native: Uint8Array | undefined
      for (const oracle of ['libjxl', 'jxl-rs']) {
        const output = `${directory}/${id}-${oracle}.ppm`
        const result = spawnSync(
          oracle === 'libjxl'
            ? '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
            : '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli',
          oracle === 'libjxl'
            ? [path, output, '--num_threads=1', '--bits_per_sample=8']
            : [path, output, '--num-threads', '1', '--data-type', 'u8'],
          { encoding: 'utf8', timeout: 120_000 },
        )
        if (result.status !== 0)
          throw new Error(`${oracle}: ${result.stderr}; ${result.error ?? ''}`)
        const pixels = await ppm(output, width, height)
        if (!native) native = pixels
        const delta = difference(native, pixels)
        if (delta.maximum > 2)
          throw new Error(`${oracle} differs from libjxl: ${JSON.stringify(delta)}`)
        independent.push({
          oracle,
          status: 'decoded',
          decodedSha256: hash(pixels),
          vsLibjxl: delta,
        })
      }
      if (!native) throw new Error('No native result')
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('No first-party decoder')
      const decoded = new Uint8Array(input.length)
      let rows = 0
      for await (const block of decoder.decode()) {
        if (block.format !== 'rgb8' || block.y !== rows || block.width !== width)
          throw new Error('Invalid first-party output geometry')
        for (let y = 0; y < block.height; y++)
          decoded.set(
            block.data.subarray(y * block.stride, y * block.stride + width * 3),
            (block.y + y) * width * 3,
          )
        rows += block.height
        block.release?.()
      }
      if (rows !== height) throw new Error('Incomplete first-party output')
      const ownDifference = difference(native, decoded)
      if (ownDifference.maximum > 2)
        throw new Error(`First-party output differs: ${JSON.stringify(ownDifference)}`)
      results.push({
        id,
        width,
        height,
        distance,
        status: 'verified',
        bytes: bytes.length,
        inputSha256: hash(input),
        encodedSha256: hash(bytes),
        independent,
        firstPartyVsLibjxl: ownDifference,
        nativeVsSource: difference(input, native),
      })
      console.log(id, 'verified', bytes.length)
    } catch (error) {
      failures++
      results.push({ id, width, height, distance, status: 'failed', error: String(error) })
      console.error(id, String(error))
    }
  }
}
await writeFile(
  `${directory}/report.json`,
  JSON.stringify(
    {
      schemaVersion: 1,
      scope: 'Procedural forward-path conformance only; excluded from real-image quality gates.',
      failures,
      results,
    },
    null,
    2,
  ) + '\n',
)
if (failures) process.exitCode = 1
