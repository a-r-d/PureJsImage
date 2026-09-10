import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { encodeJpegXlVarDct8 } from '../../src/codecs/jpegxl-vardct-encode.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

const directory = '.tmp/jpegxl-m7/forward-alpha-oracle'
await mkdir(directory, { recursive: true })
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const results: object[] = []
let failures = 0
for (const [width, height] of [
  [17, 13],
  [257, 33],
  [33, 257],
  [513, 517],
  [2051, 257],
  [2051, 9],
]) {
  if (!width || !height) throw new Error('Missing alpha verifier dimensions')
  const input = Uint8Array.from({ length: width * height * 4 }, (_, index) => {
    const x = Math.floor(index / 4) % width,
      y = Math.floor(index / (width * 4))
    return index % 4 === 3
      ? Math.floor(index / 4) % 256
      : index % 4 === 0
        ? Math.round((x * 255) / Math.max(1, width - 1))
        : index % 4 === 1
          ? Math.round((y * 255) / Math.max(1, height - 1))
          : 64
  })
  for (const distance of [0.25, 1, 3]) {
    const id: string = `${width}x${height}-d${distance}`
    try {
      const sink = new Uint8ArraySink()
      for (const part of encodeJpegXlVarDct8(input, width, height, distance, undefined, 4))
        await sink.write(part)
      const bytes = sink.toUint8Array(),
        path = `${directory}/${id}.jxl`
      await writeFile(path, bytes)
      const oracles: object[] = []
      let reference: Uint8Array | undefined
      for (const oracle of ['libjxl', 'jxl-rs']) {
        const output = `${directory}/${id}-${oracle}.png`
        const decoded = spawnSync(
          oracle === 'libjxl'
            ? '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
            : '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli',
          oracle === 'libjxl'
            ? [path, output, '--num_threads=1', '--bits_per_sample=8']
            : [path, output, '--num-threads', '1', '--data-type', 'u8'],
          { encoding: 'utf8', timeout: 120_000 },
        )
        if (decoded.status !== 0)
          throw new Error(`${oracle}: ${decoded.stderr}; ${decoded.error ?? ''}`)
        const png = await readFile(output)
        const { data, info } = await sharp(png)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        if (
          info.width !== width ||
          info.height !== height ||
          info.channels !== 4 ||
          data.length !== input.length
        )
          throw new Error(`${oracle}: incorrect RGBA extent`)
        let maximumRgbDifference = 0
        for (let pixel = 0; pixel < width * height; pixel++) {
          if (data[pixel * 4 + 3] !== input[pixel * 4 + 3])
            throw new Error(`${oracle}: alpha changed at pixel ${pixel}`)
          if (reference)
            for (let channel = 0; channel < 3; channel++)
              maximumRgbDifference = Math.max(
                maximumRgbDifference,
                Math.abs((data[pixel * 4 + channel] ?? 0) - (reference[pixel * 4 + channel] ?? 0)),
              )
        }
        if (maximumRgbDifference > 2)
          throw new Error(`${oracle}: RGB differs by ${maximumRgbDifference}`)
        reference ??= data
        oracles.push({
          oracle,
          status: 'exact-alpha',
          decodedSha256: hash(data),
          maximumRgbDifference,
        })
      }
      results.push({
        id,
        width,
        height,
        distance,
        status: 'verified',
        bytes: bytes.length,
        sourceSha256: hash(input),
        encodedSha256: hash(bytes),
        oracles,
      })
      console.log(id, 'exact alpha')
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
      failures,
      results,
      scope: 'Procedural alpha conformance, excluded from real-asset quality gates.',
    },
    null,
    2,
  ) + '\n',
)
if (failures) process.exitCode = 1
