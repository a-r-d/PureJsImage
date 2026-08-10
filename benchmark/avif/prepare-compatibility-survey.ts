import { spawnSync } from 'node:child_process'
import { mkdir, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import sharp from 'sharp'

const sourceFlag = process.argv.indexOf('--source')
const outputFlag = process.argv.indexOf('--output')
const sourceDirectory = sourceFlag === -1 ? undefined : process.argv[sourceFlag + 1]
const outputDirectory = outputFlag === -1 ? undefined : process.argv[outputFlag + 1]
if (!sourceDirectory || !outputDirectory) {
  throw new Error(
    'Usage: prepare-compatibility-survey.ts --source <GB82 PNG directory> --output <directory>',
  )
}
const sourceRoot = resolve(sourceDirectory)
const outputRoot = resolve(outputDirectory)
await mkdir(outputRoot, { recursive: true })
sharp.concurrency(1)
const sources = (await readdir(sourceRoot)).filter((file) => file.endsWith('.png')).sort()
if (sources.length === 0) throw new Error('Compatibility survey source directory has no PNG files')

const ffmpeg = (
  input: string,
  output: string,
  crf: number,
  pixelFormat: 'yuv420p' | 'yuv444p',
): void => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input,
      '-frames:v',
      '1',
      '-c:v',
      'libaom-av1',
      '-still-picture',
      '1',
      '-threads',
      '1',
      '-crf',
      `${crf}`,
      '-b:v',
      '0',
      '-pix_fmt',
      pixelFormat,
      output,
    ],
    { encoding: 'utf8' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.trim()}`)
}

for (const file of sources) {
  const source = join(sourceRoot, file)
  const stem = basename(file, '.png')
  await sharp(source)
    .avif({ quality: 50, effort: 4, chromaSubsampling: '4:2:0' })
    .toFile(join(outputRoot, `${stem}-sharp-q50-420.avif`))
  await sharp(source)
    .avif({ quality: 80, effort: 4, chromaSubsampling: '4:4:4' })
    .toFile(join(outputRoot, `${stem}-sharp-q80-444.avif`))
  ffmpeg(source, join(outputRoot, `${stem}-ffmpeg-crf30-420.avif`), 30, 'yuv420p')
  ffmpeg(source, join(outputRoot, `${stem}-ffmpeg-crf45-444.avif`), 45, 'yuv444p')
}
console.log(
  JSON.stringify({
    encodings: sources.length * 4,
    ffmpeg: 'libaom-av1, CRF 30 4:2:0 and CRF 45 4:4:4, one thread',
    sharp: `${sharp.versions.sharp}/libvips ${sharp.versions.vips}/libaom ${sharp.versions.aom}`,
    sources: sources.length,
  }),
)
