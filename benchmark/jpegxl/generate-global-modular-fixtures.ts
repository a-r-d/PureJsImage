/** Independent development oracle for global Modular transforms. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const bin = resolve('.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools')
const work = resolve('.tmp/jpegxl-global-modular')
const output = resolve('tests/fixtures/jpegxl/global-modular')
await mkdir(work, { recursive: true })
await mkdir(output, { recursive: true })
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const width = 513,
  height = 259
const fixtures: {
  id: string
  bitDepth: number
  options: string[]
  inputSha256: string
  sha256: string
  referenceSha256: string
}[] = []
for (const kind of ['palette', 'squeeze'])
  for (const bitDepth of [8, 16]) {
    const id = `${kind}-${bitDepth}`
    const bytesPerSample = bitDepth / 8
    const raster = new Uint8Array(width * height * 3 * bytesPerSample)
    const view = new DataView(raster.buffer)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        for (let c = 0; c < 3; c++) {
          const v = (Math.floor(x / 7) + Math.floor(y / 11)) % 16
          const sample =
            kind === 'palette'
              ? ((v * (c * 4 + 9) + c * 31) % 256) * (bitDepth === 16 ? 257 : 1)
              : bitDepth === 8
                ? (x * (31 + c * 6) + y * (17 + c * 10) + (x % 9) * 19) % 256
                : (x * (2111 + c * 113) + y * (257 + c * 17) + c * 977 + (x % 9) * 1103) % 65536
          const offset = ((y * width + x) * 3 + c) * bytesPerSample
          if (bitDepth === 8) raster[offset] = sample
          else view.setUint16(offset, sample, false)
        }
    const head = new TextEncoder().encode(`P6\n${width} ${height}\n${2 ** bitDepth - 1}\n`)
    const ppm = new Uint8Array(head.length + raster.length)
    ppm.set(head)
    ppm.set(raster, head.length)
    await writeFile(`${work}/${id}.ppm`, ppm)
    const options =
      kind === 'palette'
        ? ['-X', '100', '-Y', '100', '--modular_palette_colors=256']
        : ['--responsive=1']
    execFileSync(
      `${bin}/cjxl`,
      [
        `${work}/${id}.ppm`,
        `${output}/${id}.jxl`,
        '-d',
        '0',
        '-e',
        '7',
        '--num_threads=1',
        ...options,
      ],
      { stdio: 'inherit' },
    )
    execFileSync(
      `${bin}/djxl`,
      [`${output}/${id}.jxl`, `${work}/${id}.reference.ppm`, '--num_threads=1'],
      { stdio: 'inherit' },
    )
    const reference = await readFile(`${work}/${id}.reference.ppm`)
    if (
      !reference.subarray(0, head.length).equals(head) ||
      !reference.subarray(head.length).equals(raster)
    )
      throw new Error(`Independent lossless samples differ for ${id}`)
    await writeFile(`${output}/${id}.rgb.gz`, gzipSync(raster))
    fixtures.push({
      id,
      bitDepth,
      options,
      inputSha256: sha256(ppm),
      sha256: sha256(await readFile(`${output}/${id}.jxl`)),
      referenceSha256: sha256(raster),
    })
  }
await writeFile(
  `${output}/manifest.json`,
  `${JSON.stringify({ schemaVersion: 1, width, height, oracle: 'libjxl 0.12.0 8cb67e2; unmodified cjxl and djxl', fixtures }, null, 2)}\n`,
)
