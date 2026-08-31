import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

interface FixtureDefinition {
  readonly id: string
  readonly source: string
  readonly output: string
  readonly profile: string
}

const fixtures: readonly FixtureDefinition[] = Object.freeze([
  Object.freeze({
    id: 'progressive-yuv420-exif',
    source: 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-yuv420.jpg',
    output: 'benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/baseline-yuv420.jxl',
    profile: 'progressive 8-bit YCbCr 4:2:0 with Exif',
  }),
  Object.freeze({
    id: 'progressive-rgb-exif',
    source: 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-rgb.jpg',
    output: 'benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/progressive-rgb-exif.jxl',
    profile: 'progressive 8-bit RGB 4:4:4 with Exif and refinement scans',
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
  const source = await readFile(fixture.source)
  const output = await readFile(fixture.output)
  entries.push(
    Object.freeze({
      id: fixture.id,
      source: fixture.source,
      sourceSha256: sha256(source),
      jxl: fixture.output,
      jxlSha256: sha256(output),
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
