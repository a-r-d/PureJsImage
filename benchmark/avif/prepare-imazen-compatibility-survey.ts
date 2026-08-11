import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

import { imazenCompatibilitySources } from './imazen-compatibility-sources.ts'

interface PreparedSource {
  readonly contentClass: string
  readonly height: number
  readonly id: string
  readonly normalizedFile: string
  readonly normalizedSha256: string
  readonly rawSha256: string
  readonly url: string
  readonly width: number
}

interface PreparedEncoding {
  readonly bytes: number
  readonly encoder: 'ImageMagick' | 'rav1e' | 'SVT-AV1'
  readonly file: string
  readonly fileSha256: string
  readonly sourceId: string
}

const outputFlag = process.argv.indexOf('--output')
const outputArgument = outputFlag === -1 ? undefined : process.argv[outputFlag + 1]
if (!outputArgument) {
  throw new Error('Usage: prepare-imazen-compatibility-survey.ts --output <directory>')
}
const outputRoot = resolve(outputArgument)
const sourceDirectory = join(outputRoot, 'sources')
const encodedDirectory = join(outputRoot, 'encoded')
await mkdir(sourceDirectory, { recursive: true })
await mkdir(encodedDirectory, { recursive: true })
sharp.concurrency(1)

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const run = (application: string, args: readonly string[]): string => {
  const result = spawnSync(application, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1_024 * 1_024,
    timeout: 180_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${application} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`,
    )
  }
  return result.stdout.trim()
}

const sources: PreparedSource[] = []
const encodings: PreparedEncoding[] = []
for (const source of imazenCompatibilitySources) {
  const response = await fetch(source.url)
  if (!response.ok)
    throw new Error(`Imazen source request failed (${response.status}): ${source.url}`)
  const raw = new Uint8Array(await response.arrayBuffer())
  const rawSha256 = sha256(raw)
  if (rawSha256 !== source.rawSha256) {
    throw new Error(`Imazen source checksum changed for ${source.id}: ${rawSha256}`)
  }
  const normalized = await sharp(raw)
    .resize({
      width: 512,
      height: 512,
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .removeAlpha()
    .toColourspace('srgb')
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true })
  const normalizedFile = `sources/${source.id}.png`
  await writeFile(join(outputRoot, normalizedFile), normalized.data)
  sources.push({
    id: source.id,
    contentClass: source.contentClass,
    url: source.url,
    rawSha256,
    normalizedFile,
    normalizedSha256: sha256(normalized.data),
    width: normalized.info.width,
    height: normalized.info.height,
  })

  const variants = [
    {
      encoder: 'rav1e' as const,
      suffix: 'rav1e-q60-420',
      application: 'avifenc',
      args: [
        '--codec',
        'rav1e',
        '--qcolor',
        '60',
        '--speed',
        '6',
        '--jobs',
        '1',
        '--depth',
        '8',
        '--yuv',
        '420',
        '--ignore-exif',
        '--ignore-xmp',
        '--ignore-icc',
      ],
    },
    {
      encoder: 'SVT-AV1' as const,
      suffix: 'svt-q60-420',
      application: 'avifenc',
      args: [
        '--codec',
        'svt',
        '--qcolor',
        '60',
        '--speed',
        '8',
        '--jobs',
        '1',
        '--depth',
        '8',
        '--yuv',
        '420',
        '--ignore-exif',
        '--ignore-xmp',
        '--ignore-icc',
      ],
    },
    {
      encoder: 'ImageMagick' as const,
      suffix: 'imagemagick-q60',
      application: 'magick',
      args: ['-strip', '-quality', '60', '-define', 'heic:speed=6'],
    },
  ]
  for (const variant of variants) {
    const file = `encoded/${source.id}-${variant.suffix}.avif`
    const inputPath = join(outputRoot, normalizedFile)
    const outputPath = join(outputRoot, file)
    run(variant.application, [inputPath, ...variant.args, outputPath])
    const encoded = new Uint8Array(await readFile(outputPath))
    encodings.push({
      sourceId: source.id,
      encoder: variant.encoder,
      file,
      bytes: encoded.byteLength,
      fileSha256: sha256(encoded),
    })
  }
}

const avifencVersion = run('avifenc', ['--version'])
const imageMagickVersion = run('magick', ['-version']).split('\n')[0] ?? 'unknown'
const manifest = {
  generatedAt: new Date().toISOString(),
  sourceCorpus: 'Imazen imazen-26 representative K300 subset',
  normalization: 'sRGB PNG, metadata removed, fit within a white 512x512 canvas',
  encoders: { avifenc: avifencVersion, imageMagick: imageMagickVersion },
  sources,
  encodings,
}
await writeFile(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
console.log(
  JSON.stringify({
    output: outputRoot,
    sources: sources.length,
    encodings: encodings.length,
    byEncoder: Object.fromEntries(
      ['rav1e', 'SVT-AV1', 'ImageMagick'].map((encoder) => [
        encoder,
        encodings.filter((encoding) => encoding.encoder === encoder).length,
      ]),
    ),
  }),
)
