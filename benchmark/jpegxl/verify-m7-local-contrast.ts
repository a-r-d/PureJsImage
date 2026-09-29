/** Small independent oracle check for the shared Node/browser source-quality regression. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { encodeJpegXlLocalContrast } from '../../tests/helpers/jpegxl-local-contrast.ts'
import { verifyM7QualityPixels } from './m7-quality-decoding.ts'

const root = process.argv[2]
if (!root || !root.startsWith('.tmp/jpegxl-m7/') || root.includes('..'))
  throw new Error('Supply a new output directory under .tmp/jpegxl-m7/')
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
await mkdir(root)
const run = (tool: string, args: string[]): void => {
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 1048576 })
  if (result.status !== 0) throw new Error(`${tool}: ${result.stderr}; ${result.error ?? ''}`)
}
const results: object[] = []
for (const progressive of [false, true])
  for (const distance of [1.5, 3, 4.5]) {
    const { encoded, pixels, width, height } = await encodeJpegXlLocalContrast(
      progressive,
      distance,
    )
    const path = `${root}/progressive-${progressive}-distance-${distance}`
    await writeFile(`${path}.jxl`, encoded)
    await writeFile(
      `${path}-source.ppm`,
      Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]),
    )
    run(native, [`${path}.jxl`, `${path}-native.ppm`, '--num_threads=1'])
    run(rust, [`${path}.jxl`, `${path}-rust.ppm`, '--num-threads', '1', '--data-type', 'u8'])
    const ppm = async (name: string): Promise<Uint8Array> => {
      const bytes = await readFile(name)
      const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(bytes.subarray(0, 100).toString('ascii'))
      if (
        !header ||
        Number(header[1]) !== width ||
        Number(header[2]) !== height ||
        bytes.length !== header[0].length + pixels.length
      )
        throw new Error('Invalid independently decoded RGB8 extent')
      return bytes.subarray(header[0].length)
    }
    const decoded = await ppm(`${path}-native.ppm`),
      other = await ppm(`${path}-rust.ppm`)
    let maximum = 0,
      error = 0
    for (let i = 0; i < decoded.length; i++) {
      maximum = Math.max(maximum, Math.abs((decoded[i] ?? -1000) - (other[i] ?? 1000)))
      error += ((decoded[i] ?? -1000) - (pixels[i] ?? 1000)) ** 2
    }
    if (maximum > 1) throw new Error('Independent decoders disagree')
    const rmse = Math.sqrt(error / pixels.length)
    if (rmse >= (distance <= 3 ? 3 : 4.5)) throw new Error('Source texture quality regressed')
    results.push({
      progressive,
      width,
      height,
      settings: { mode: 'lossy', effort: 7, distance },
      bytes: encoded.length,
      sourceSha256: hash(pixels),
      encodedSha256: hash(encoded),
      nativeDecodedSha256: hash(decoded),
      rustDecodedSha256: hash(other),
      independentMaximum: maximum,
      rmse,
      ownVerification: await verifyM7QualityPixels(encoded, decoded, width, height),
    })
  }
await writeFile(
  `${root}/report.json`,
  `${JSON.stringify({ source: { path: 'src/codecs/jpegxl-vardct-encode.ts', sha256: hash(await readFile('src/codecs/jpegxl-vardct-encode.ts')) }, tools: await Promise.all([native, rust].map(async (path) => ({ path, sha256: hash(await readFile(path)) }))), results }, null, 2)}\n`,
)
console.log(JSON.stringify(results))
