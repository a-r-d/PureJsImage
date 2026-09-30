/** First-party raster inputs and independently decoded libjxl alpha references. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { encodeJpegXlVarDct8 } from '../../src/codecs/jpegxl-vardct-encode.ts'

const tools = resolve('.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools')
const work = resolve('.tmp/jpegxl-grouped-alpha-fixtures')
const output = resolve('tests/fixtures/jpegxl/grouped-alpha')
await mkdir(work, { recursive: true })
await mkdir(output, { recursive: true })
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const fixtures: {
  id: string
  file: string
  width: number
  height: number
  format: string
  encoder: string
  referenceColorScale: number
  sha256: string
  referenceSha256: string
  options: readonly string[]
  inputSha256?: string
}[] = []
for (const item of [
  { id: 'sdr8', depth: 8, linear: false, associated: false, options: ['--responsive=0'] },
  { id: 'sdr8-direct', depth: 8, linear: false, associated: false, options: [] },
  { id: 'sdr16-squeeze', depth: 16, linear: false, associated: false, options: ['--responsive=1'] },
  {
    id: 'linear16-shift1-associated',
    depth: 16,
    linear: true,
    associated: true,
    options: [
      '--responsive=0',
      '--premultiply=1',
      '--ec_resampling=2',
      '-x',
      'color_space=RGB_D65_SRG_Rel_Lin',
    ],
  },
  { id: 'pq16-squeeze', depth: 16, linear: true, associated: false, options: [] },
]) {
  const width = item.id === 'pq16-squeeze' ? 300 : item.associated ? 1025 : 513
  const height = item.id === 'pq16-squeeze' ? 270 : 259
  let inputSha256: string | undefined
  const file =
    item.id === 'pq16-squeeze' ? '../practical-progressive/pq-rgba16-grouped.jxl' : `${item.id}.jxl`
  if (item.id !== 'pq16-squeeze') {
    const maximum = 2 ** item.depth - 1
    const header = new TextEncoder().encode(
      `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL ${maximum}\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
    )
    const input = new Uint8Array(header.length + (width * height * 4 * item.depth) / 8)
    input.set(header)
    const view = new DataView(input.buffer)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const alpha = 0.5 + 0.2 * Math.sin(x / 23) + 0.15 * Math.cos(y / 17)
        for (let c = 0; c < 4; c++) {
          const value =
            c === 3
              ? alpha
              : (0.45 + 0.2 * Math.sin(x / (13 + c * 7)) + 0.15 * Math.cos(y / (9 + c * 11))) *
                (item.associated ? alpha : 1)
          const sample = Math.round(value * maximum)
          const offset = header.length + (((y * width + x) * 4 + c) * item.depth) / 8
          if (item.depth === 8) input[offset] = sample
          else view.setUint16(offset, sample, false)
        }
      }
    inputSha256 = digest(input)
    await writeFile(`${work}/${item.id}.pam`, input)
    if (item.id === 'sdr8-direct') {
      const parts = encodeJpegXlVarDct8(
        input.subarray(header.length),
        width,
        height,
        1,
        undefined,
        4,
        3,
        undefined,
        8,
        true,
      )
      const encoded = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
      let position = 0
      for (const part of parts) {
        encoded.set(part, position)
        position += part.length
      }
      await writeFile(`${output}/${file}`, encoded)
    } else
      execFileSync(
        `${tools}/cjxl`,
        [
          `${work}/${item.id}.pam`,
          `${output}/${file}`,
          '-d',
          '1',
          '-e',
          '7',
          '--num_threads=1',
          '--progressive_ac',
          '--progressive_dc=0',
          ...item.options,
        ],
        { stdio: 'inherit' },
      )
  }
  const oracle = `${work}/${item.id}`
  execFileSync(
    'bun',
    [
      'benchmark/jpegxl/flush-progressive-oracle.ts',
      `${output}/${file}`,
      oracle,
      ...(item.linear ? ['linear-float32'] : []),
    ],
    { stdio: 'inherit' },
  )
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null
  const report: unknown = JSON.parse(await readFile(`${oracle}/manifest.json`, 'utf8'))
  if (!record(report) || !Array.isArray(report.stages)) throw new Error('Invalid oracle report')
  const final: unknown = report.stages.at(-1)
  if (
    !record(final) ||
    final.kind !== 'final' ||
    typeof final.file !== 'string' ||
    !/^stage-\d+\.bin$/.test(final.file) ||
    typeof final.sha256 !== 'string'
  )
    throw new Error('Missing independent final pixels')
  const reference = new Uint8Array(await readFile(`${oracle}/${final.file}`))
  if (digest(reference) !== final.sha256) throw new Error('Independent reference hash differs')
  const bytesPerSample = item.linear ? 4 : item.depth / 8
  if (reference.length !== width * height * 4 * bytesPerSample)
    throw new Error('Independent reference dimensions differ')
  await writeFile(`${output}/${item.id}.rgba.gz`, gzipSync(reference))
  fixtures.push({
    id: item.id,
    file,
    width,
    height,
    format: item.linear ? 'rgbaf32' : item.depth === 8 ? 'rgba8' : 'rgba16',
    encoder:
      item.id === 'sdr8-direct'
        ? 'PureJsImage first-party forward VarDCT, effort 3, two passes'
        : 'unmodified cjxl 0.12.0 8cb67e2',
    referenceColorScale: item.id === 'pq16-squeeze' ? 10_000 / 203 : 1,
    sha256: digest(await readFile(`${output}/${file}`)),
    referenceSha256: digest(reference),
    options: item.options,
    ...(inputSha256 ? { inputSha256 } : {}),
  })
}
await writeFile(
  `${output}/manifest.json`,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      encoder: 'unmodified cjxl 0.12.0 8cb67e2',
      encoderSha256: digest(await readFile(`${tools}/cjxl`)),
      oracle:
        'unmodified libjxl 0.12.0 a7a9c787341cf703dede03c2009fa460cae5e5df C API; full-image output',
      librarySha256: '29eea9f83a05f1851e18fc5f414916ca6c28e278f68622969bea68d7516ecdc5',
      fixtures,
    },
    null,
    2,
  )}\n`,
)
