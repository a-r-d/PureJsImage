/** First-party inputs and pinned independent references for Modular DC extra channels. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import { initialize } from './comparison/adapters.ts'
import { object, string } from './comparison/model.ts'

const output = 'tests/fixtures/jpegxl/modular-dc-alpha'
const temporary = '.tmp/jpegxl-modular-dc-alpha-fixtures'
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const encoderPackage = object(
  JSON.parse(await readFile('node_modules/@jsquash/jxl/package.json', 'utf8')),
)
if (encoderPackage.version !== '1.3.0') throw new Error('Pinned independent encoder required')
const assets = '.tmp/jpegxl-comparison-v1/assets'
const encoderSha256 = digest(await readFile(`${assets}/jsquash-enc.wasm`))
if (encoderSha256 !== '3c6c02df45c0dededab146888789d541b23b9a299cb16d497dce412a3a4bc7d3')
  throw new Error('Pinned independent WASM asset required')
if (!('ImageData' in globalThis))
  Object.defineProperty(globalThis, 'ImageData', {
    value: class {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    },
  })
const adapter = await initialize(
  'jsquash',
  async (name) => new Uint8Array(await readFile(`${assets}/${name}`)).buffer,
)
if (!adapter.encode) throw new Error('Published independent encoder missing')
await mkdir(output, { recursive: true })
await mkdir(temporary, { recursive: true })
const flags = { lossless: false, effort: 7, value: 42.1 }
const fixtures: object[] = []
for (const fixture of [
  { id: 'single', width: 131, height: 101, grouped: false },
  { id: 'grouped', width: 37, height: 2057, grouped: true },
]) {
  const { id, width, height } = fixture
  const header = new TextEncoder().encode(
    `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
  )
  const input = new Uint8Array(header.length + width * height * 4)
  input.set(header)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = header.length + (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++)
        input[at + channel] = Math.round(
          128 + 55 * Math.sin(x / (7 + channel * 3)) + 45 * Math.cos(y / (11 + channel * 5)),
        )
      input[at + 3] = 255
    }
  const source = `${temporary}/${id}.pam`,
    file = `${id}.jxl`
  await writeFile(source, input)
  const result = await adapter.encode(
    { width, height, channels: 4, data: input.subarray(header.length), interpretation: 'srgb' },
    flags,
  )
  if (result.kind !== 'jxl') throw new Error('Independent encoded bytes missing')
  const encoded = result.bytes
  await writeFile(`${output}/${file}`, encoded)
  const frames = await readJpegXlSourceFrameStructures(
    new MemorySource(encoded),
    defaultImageLimits,
  )
  const dc = frames.find((frame) => frame.frameType === 'dc')
  if (
    !dc ||
    dc.encoding !== 'modular' ||
    dc.extraChannels.length !== 1 ||
    dc.extraChannels[0]?.type !== 0 ||
    dc.sections.slice(1).some((section) => section.length > 0) !== fixture.grouped
  )
    throw new Error(
      'Fixture does not exercise its declared Modular DC alpha dependency: ' +
        JSON.stringify(
          frames.map((frame) => ({
            frameType: frame.frameType,
            encoding: frame.encoding,
            sections: frame.sections.map((section) => section.length),
            extras: frame.extraChannels.length,
          })),
        ),
    )
  const oracleDirectory = `${temporary}/${id}-oracle`
  execFileSync(
    process.env.PUREJSIMAGE_BUN_BINARY ?? 'bun',
    ['benchmark/jpegxl/flush-progressive-oracle.ts', `${output}/${file}`, oracleDirectory],
    { stdio: 'inherit' },
  )
  const oracle = object(JSON.parse(await readFile(`${oracleDirectory}/manifest.json`, 'utf8')))
  if (
    oracle.width !== width ||
    oracle.height !== height ||
    oracle.channels !== 4 ||
    !Array.isArray(oracle.stages)
  )
    throw new Error('Complete independent RGBA oracle required')
  const final = object(oracle.stages.at(-1))
  const referenceFile = string(final.file)
  if (final.kind !== 'final' || !/^stage-\d+\.bin$/u.test(referenceFile))
    throw new Error('Independent final stage missing')
  const reference = await readFile(`${oracleDirectory}/${referenceFile}`)
  if (reference.length !== width * height * 4 || digest(reference) !== final.sha256)
    throw new Error('Independent complete pixels differ')
  for (let pixel = 0; pixel < width * height; pixel++)
    if (reference[pixel * 4 + 3] !== input[header.length + pixel * 4 + 3])
      throw new Error('Independent alpha is not exact')
  const compressed = gzipSync(reference, { level: 9 })
  await writeFile(`${output}/${id}.rgba.gz`, compressed)
  fixtures.push({
    ...fixture,
    file,
    inputSha256: digest(input),
    encodedSha256: digest(encoded),
    referenceSha256: digest(reference),
    compressedReferenceSha256: digest(compressed),
    dcWidth: dc.codedWidth,
    dcHeight: dc.codedHeight,
    dcLevel: dc.dcLevel,
    dcSections: dc.sections.map((section) => section.length),
  })
}
await writeFile(
  `${output}/manifest.json`,
  `${JSON.stringify({ schemaVersion: 1, encoder: 'Published @jsquash/jxl 1.3.0', encoderSha256, flags, oracle: 'Pinned libjxl C API final RGBA8 output', tolerance: { color: 1, alpha: 0 }, fixtures }, null, 2)}\n`,
)
adapter.close()
