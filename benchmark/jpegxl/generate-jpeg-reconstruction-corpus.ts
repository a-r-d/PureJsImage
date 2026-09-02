import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

interface FixtureDefinition {
  readonly id: string
  readonly source: string
  readonly output: string
  readonly pixelOracle: string
  readonly profile: string
  readonly maximumAbsoluteError: number
  readonly maximumRmse: number
}

const fixtures: readonly FixtureDefinition[] = Object.freeze([
  Object.freeze({
    id: 'progressive-yuv420-exif',
    source: 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-yuv420.jpg',
    output: 'benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/baseline-yuv420.jxl',
    pixelOracle:
      'benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/progressive-yuv420-exif.oracle.ppm',
    profile: 'progressive 8-bit YCbCr 4:2:0 with Exif',
    maximumAbsoluteError: 24,
    maximumRmse: 0.86,
  }),
  Object.freeze({
    id: 'progressive-rgb-exif',
    source: 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-rgb.jpg',
    output: 'benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/progressive-rgb-exif.jxl',
    pixelOracle:
      'benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/progressive-rgb-exif.oracle.ppm',
    profile: 'progressive 8-bit RGB 4:4:4 with Exif and refinement scans',
    maximumAbsoluteError: 1,
    maximumRmse: 0.27,
  }),
])

const run = async (command: string, arguments_: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with status ${code ?? 'unknown'}`))
    })
  })

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const binaryDirectory = process.argv[2]
if (!binaryDirectory) {
  throw new Error('Usage: node generate-jpeg-reconstruction-corpus.ts <libjxl-tools-directory>')
}

const entries = []
for (const fixture of fixtures) {
  await mkdir(dirname(fixture.output), { recursive: true })
  await run(join(binaryDirectory, 'cjxl'), [
    fixture.source,
    fixture.output,
    '--lossless_jpeg=1',
    '--compress_boxes=0',
    '--effort=1',
  ])
  await run(join(binaryDirectory, 'djxl'), [
    fixture.output,
    fixture.pixelOracle,
    '--bits_per_sample=8',
  ])
  const source = await readFile(fixture.source)
  const output = await readFile(fixture.output)
  const pixelOracle = await readFile(fixture.pixelOracle)
  entries.push(
    Object.freeze({
      id: fixture.id,
      source: fixture.source,
      sourceSha256: sha256(source),
      jxl: fixture.output,
      jxlSha256: sha256(output),
      pixelOracle: fixture.pixelOracle,
      pixelOracleSha256: sha256(pixelOracle),
      pixelOracleTolerance: Object.freeze({
        maximumAbsoluteError: fixture.maximumAbsoluteError,
        maximumRmse: fixture.maximumRmse,
      }),
      reconstructedJpegSha256: sha256(source),
      profile: fixture.profile,
      exact: true,
    }),
  )
}

const manifest = Object.freeze({
  generator: 'libjxl cjxl --lossless_jpeg=1 --compress_boxes=0 --effort=1',
  oracle: 'libjxl-0.12.0',
  revision: 'a7a9c787341cf703dede03c2009fa460cae5e5df',
  sourceArchiveSha256: '818398895831069902e3677d285054a7d1255b11b221e94c6aaa1cb83b0a3f29',
  fixtures: Object.freeze(entries),
})

await writeFile(
  'benchmark/jpegxl/jpeg-reconstruction-manifest.json',
  `${JSON.stringify(manifest, undefined, 2)}\n`,
)
