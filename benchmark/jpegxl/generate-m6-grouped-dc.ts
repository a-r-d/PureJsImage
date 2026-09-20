import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

const directory = 'tests/fixtures/jpegxl/m6-grouped-dc'
const temporary = '.tmp/jpegxl-m6-grouped-dc'
await mkdir(directory, { recursive: true })
await mkdir(temporary, { recursive: true })
const encoder = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/cjxl'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const encoderHash = hash(await readFile(encoder))
if (encoderHash !== '5c9dd3d879b81545b77947f9a6f1f7a4e58bbe2e4f3c2a52ca70365544939762')
  throw new Error('Pinned encoder required')
const width = 4097,
  height = 513
const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
const input = new Uint8Array(header.length + width * height * 3)
input.set(header)
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const offset = header.length + (y * width + x) * 3
    input[offset] = (x * 5 + y * 3) % 256
    input[offset + 1] = (x + y * 7) % 256
    input[offset + 2] = (x * 3 + y) % 256
  }
await writeFile(`${temporary}/input.ppm`, input)
const flags = [
  '--modular=0',
  '--distance=1',
  '--effort=3',
  '--num_threads=1',
  '--progressive_ac',
  '--progressive_dc=1',
  '--patches=0',
  '--dots=0',
]
const encoded = spawnSync(
  encoder,
  [`${temporary}/input.ppm`, `${directory}/progressive.jxl`, ...flags],
  { encoding: 'utf8' },
)
if (encoded.status !== 0) throw new Error(encoded.stderr)
const bytes = new Uint8Array(await readFile(`${directory}/progressive.jxl`))
const frames = await readJpegXlSourceFrameStructures(new MemorySource(bytes), defaultImageLimits)
const dc = frames[0]
if (
  !dc ||
  dc.frameType !== 'dc' ||
  dc.passCount < 2 ||
  dc.sections.slice(1).every((section) => section.length === 0)
)
  throw new Error('Fixture does not exercise grouped progressive DC')
const native = spawnSync(
  process.env.PUREJSIMAGE_BUN_BINARY ?? 'bun',
  [
    'benchmark/jpegxl/flush-progressive-oracle.ts',
    `${directory}/progressive.jxl`,
    `${temporary}/oracle`,
  ],
  { encoding: 'utf8' },
)
if (native.status !== 0) throw new Error(native.stderr || String(native.error))
const stages = []
for (let stage = 0; stage < 4; stage++) {
  const full = new Uint8Array(await readFile(`${temporary}/oracle/stage-${stage}.bin`))
  const scale = stage === 0 ? 8 : stage === 1 ? 4 : stage === 2 ? 2 : 1
  // Pin small crops to retain stage-specific oracle evidence without four full rasters.
  const region = { x: 100, y: 120, width: 31, height: 27 }
  const outputWidth = Math.ceil(region.width / scale),
    outputHeight = Math.ceil(region.height / scale)
  const data = new Uint8Array(outputWidth * outputHeight * 3)
  for (let y = 0; y < outputHeight; y++)
    for (let x = 0; x < outputWidth; x++) {
      const sourceY = region.y + Math.min(region.height - 1, y * scale + Math.floor(scale / 2))
      const sourceX = region.x + Math.min(region.width - 1, x * scale + Math.floor(scale / 2))
      data.set(
        full.subarray((sourceY * width + sourceX) * 3, (sourceY * width + sourceX) * 3 + 3),
        (y * outputWidth + x) * 3,
      )
    }
  const file = `stage-${stage}.bin`
  await writeFile(`${directory}/${file}`, data)
  stages.push({
    stage,
    scale,
    region,
    width: outputWidth,
    height: outputHeight,
    file,
    sha256: hash(data),
    fullOracleSha256: hash(full),
  })
}
await writeFile(
  `${directory}/manifest.json`,
  JSON.stringify(
    {
      encoderHash,
      flags,
      width,
      height,
      inputSha256: hash(bytes),
      sourceSha256: hash(input),
      source:
        'First-party analytical RGB pattern; native libjxl encoder and C API flush oracle, followed by integer sample selection.',
      stages,
    },
    null,
    2,
  ) + '\n',
)
