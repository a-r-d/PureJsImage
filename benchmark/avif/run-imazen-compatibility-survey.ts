import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import sharp from 'sharp'

interface ManifestSource {
  readonly contentClass: string
  readonly id: string
  readonly normalizedSha256: string
  readonly rawSha256: string
  readonly url: string
}

interface ManifestEncoding {
  readonly bytes: number
  readonly encoder: string
  readonly file: string
  readonly fileSha256: string
  readonly sourceId: string
}

interface SurveyManifest {
  readonly encoders: unknown
  readonly encodings: readonly ManifestEncoding[]
  readonly normalization: string
  readonly sourceCorpus: string
  readonly sources: readonly ManifestSource[]
}

interface WorkerDecodedResult {
  readonly outcome: 'decoded'
  readonly height: number
  readonly memory: unknown
  readonly metadata: unknown
  readonly outputBytes: number
  readonly rgbaSha256: string
  readonly wallMilliseconds: number
  readonly width: number
}

interface WorkerErrorResult {
  readonly code: string
  readonly memory: unknown
  readonly message: string
  readonly metadata?: unknown
  readonly outcome: 'error'
}

type WorkerResult = WorkerDecodedResult | WorkerErrorResult

interface Difference {
  readonly maximum: number
  readonly mean: number
  readonly p95: number
  readonly psnr: number | 'infinite'
  readonly rootMeanSquare: number
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const parseManifest = (value: unknown): SurveyManifest => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('sourceCorpus' in value) ||
    typeof value.sourceCorpus !== 'string' ||
    !('normalization' in value) ||
    typeof value.normalization !== 'string' ||
    !('encoders' in value) ||
    !('sources' in value) ||
    !Array.isArray(value.sources) ||
    !('encodings' in value) ||
    !Array.isArray(value.encodings)
  ) {
    throw new Error('Invalid Imazen compatibility manifest')
  }
  const sources: ManifestSource[] = value.sources.map((source) => {
    if (
      typeof source !== 'object' ||
      source === null ||
      !('contentClass' in source) ||
      typeof source.contentClass !== 'string' ||
      !('id' in source) ||
      typeof source.id !== 'string' ||
      !('normalizedSha256' in source) ||
      typeof source.normalizedSha256 !== 'string' ||
      !('rawSha256' in source) ||
      typeof source.rawSha256 !== 'string' ||
      !('url' in source) ||
      typeof source.url !== 'string'
    ) {
      throw new Error('Invalid Imazen compatibility source')
    }
    return source
  })
  const encodings: ManifestEncoding[] = value.encodings.map((encoding) => {
    if (
      typeof encoding !== 'object' ||
      encoding === null ||
      !('bytes' in encoding) ||
      !isFiniteNumber(encoding.bytes) ||
      !('encoder' in encoding) ||
      typeof encoding.encoder !== 'string' ||
      !('file' in encoding) ||
      typeof encoding.file !== 'string' ||
      !('fileSha256' in encoding) ||
      typeof encoding.fileSha256 !== 'string' ||
      !('sourceId' in encoding) ||
      typeof encoding.sourceId !== 'string'
    ) {
      throw new Error('Invalid Imazen compatibility encoding')
    }
    return encoding
  })
  return {
    sourceCorpus: value.sourceCorpus,
    normalization: value.normalization,
    encoders: value.encoders,
    sources,
    encodings,
  }
}

const parseWorkerResult = (value: unknown): WorkerResult => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'outcome' in value &&
    value.outcome === 'error' &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string' &&
    'memory' in value
  ) {
    return {
      outcome: 'error',
      code: value.code,
      message: value.message,
      memory: value.memory,
      ...('metadata' in value ? { metadata: value.metadata } : {}),
    }
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('metadata' in value) ||
    typeof value.metadata !== 'object' ||
    !('outcome' in value) ||
    value.outcome !== 'decoded' ||
    value.metadata === null ||
    !('width' in value.metadata) ||
    !isFiniteNumber(value.metadata.width) ||
    !('height' in value.metadata) ||
    !isFiniteNumber(value.metadata.height) ||
    !('memory' in value) ||
    typeof value.memory !== 'object' ||
    value.memory === null ||
    !('outputBytes' in value) ||
    !isFiniteNumber(value.outputBytes) ||
    !('rgbaSha256' in value) ||
    typeof value.rgbaSha256 !== 'string' ||
    !('wallMilliseconds' in value) ||
    !isFiniteNumber(value.wallMilliseconds)
  ) {
    throw new Error('Invalid Imazen compatibility worker result')
  }
  return {
    outcome: 'decoded',
    width: value.metadata.width,
    height: value.metadata.height,
    metadata: value.metadata,
    memory: value.memory,
    outputBytes: value.outputBytes,
    rgbaSha256: value.rgbaSha256,
    wallMilliseconds: value.wallMilliseconds,
  }
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const run = (application: string, args: readonly string[]): string => {
  const result = spawnSync(application, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1_024 * 1_024,
    timeout: 180_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${application} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout.trim()
}

const difference = (actual: Uint8Array, expected: Uint8Array): Difference => {
  if (actual.byteLength !== expected.byteLength) throw new Error('RGBA oracle length differs')
  const histogram = new Uint32Array(256)
  let maximum = 0
  let sum = 0
  let squared = 0
  let samples = 0
  for (let offset = 0; offset < actual.byteLength; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs((actual[offset + channel] ?? 0) - (expected[offset + channel] ?? 0))
      histogram[delta] = (histogram[delta] ?? 0) + 1
      maximum = Math.max(maximum, delta)
      sum += delta
      squared += delta * delta
      samples += 1
    }
  }
  const p95Target = Math.ceil(samples * 0.95)
  let cumulative = 0
  let p95 = 0
  for (; p95 < histogram.length; p95 += 1) {
    cumulative += histogram[p95] ?? 0
    if (cumulative >= p95Target) break
  }
  const meanSquare = squared / samples
  return {
    maximum,
    mean: sum / samples,
    p95,
    rootMeanSquare: Math.sqrt(meanSquare),
    psnr: meanSquare === 0 ? 'infinite' : 10 * Math.log10((255 * 255) / meanSquare),
  }
}

const inputFlag = process.argv.indexOf('--input')
const outputFlag = process.argv.indexOf('--output')
const inputArgument = inputFlag === -1 ? undefined : process.argv[inputFlag + 1]
const outputArgument = outputFlag === -1 ? undefined : process.argv[outputFlag + 1]
if (!inputArgument || !outputArgument) {
  throw new Error(
    'Usage: run-imazen-compatibility-survey.ts --input <directory> --output <report.json>',
  )
}
const inputRoot = resolve(inputArgument)
const manifestValue: unknown = JSON.parse(await readFile(join(inputRoot, 'manifest.json'), 'utf8'))
const manifest = parseManifest(manifestValue)
const worker = fileURLToPath(new URL('./imazen-compatibility-worker.ts', import.meta.url))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-imazen-avif-'))
const outcomes: Array<Readonly<Record<string, unknown>>> = []
try {
  for (const encoding of manifest.encodings) {
    const source = manifest.sources.find((candidate) => candidate.id === encoding.sourceId)
    if (!source) throw new Error(`Missing Imazen source ${encoding.sourceId}`)
    const inputPath = join(inputRoot, encoding.file)
    const input = new Uint8Array(await readFile(inputPath))
    const inputSha256 = sha256(input)
    if (inputSha256 !== encoding.fileSha256 || input.byteLength !== encoding.bytes) {
      throw new Error(`Generated encoding changed: ${encoding.file}`)
    }
    const stem = encoding.file.replaceAll('/', '-').replace(/\.avif$/i, '')
    const portablePath = join(temporaryDirectory, `${stem}.rgba`)
    const dav1dPath = join(temporaryDirectory, `${stem}-dav1d.png`)
    const aomPath = join(temporaryDirectory, `${stem}-aom.png`)
    const child = spawnSync(process.execPath, ['--expose-gc', worker, inputPath, portablePath], {
      encoding: 'utf8',
      maxBuffer: 4 * 1_024 * 1_024,
      timeout: 180_000,
    })
    if (child.error) throw child.error
    if (child.status !== 0) {
      outcomes.push({
        outcome: 'error',
        file: encoding.file,
        fileSha256: inputSha256,
        sourceId: source.id,
        contentClass: source.contentClass,
        encoder: encoding.encoder,
        message: child.stderr.trim(),
      })
      continue
    }
    const workerValue: unknown = JSON.parse(child.stdout)
    const portable = parseWorkerResult(workerValue)
    if (portable.outcome === 'error') {
      outcomes.push({
        outcome: 'error',
        file: encoding.file,
        fileSha256: inputSha256,
        sourceId: source.id,
        contentClass: source.contentClass,
        sourceUrl: source.url,
        sourceRawSha256: source.rawSha256,
        sourceNormalizedSha256: source.normalizedSha256,
        encoder: encoding.encoder,
        code: portable.code,
        message: portable.message,
        ...(portable.metadata === undefined ? {} : { metadata: portable.metadata }),
        memory: portable.memory,
      })
      continue
    }
    run('avifdec', [
      '--jobs',
      '1',
      '--codec',
      'dav1d',
      '--depth',
      '8',
      '--png-compress',
      '0',
      inputPath,
      dav1dPath,
    ])
    run('avifdec', [
      '--jobs',
      '1',
      '--codec',
      'aom',
      '--depth',
      '8',
      '--png-compress',
      '0',
      inputPath,
      aomPath,
    ])
    const portablePixels = new Uint8Array(await readFile(portablePath))
    const dav1d = PNG.sync.read(await readFile(dav1dPath))
    const aom = PNG.sync.read(await readFile(aomPath))
    if (
      dav1d.width !== portable.width ||
      dav1d.height !== portable.height ||
      aom.width !== portable.width ||
      aom.height !== portable.height
    ) {
      throw new Error(`Independent decoder dimensions differ for ${encoding.file}`)
    }
    const referenceMetadata = await sharp(inputPath).metadata()
    outcomes.push({
      outcome: 'decoded',
      file: encoding.file,
      fileSha256: inputSha256,
      sourceId: source.id,
      contentClass: source.contentClass,
      sourceUrl: source.url,
      sourceRawSha256: source.rawSha256,
      sourceNormalizedSha256: source.normalizedSha256,
      encoder: encoding.encoder,
      metadata: portable.metadata,
      referenceMetadata: {
        width: referenceMetadata.width,
        height: referenceMetadata.height,
        format: referenceMetadata.format,
        space: referenceMetadata.space,
        channels: referenceMetadata.channels,
        depth: referenceMetadata.depth,
        chromaSubsampling: referenceMetadata.chromaSubsampling,
        hasAlpha: referenceMetadata.hasAlpha,
      },
      rgbaSha256: portable.rgbaSha256,
      dav1dRgbaSha256: sha256(dav1d.data),
      aomRgbaSha256: sha256(aom.data),
      dav1dAomDifference: difference(aom.data, dav1d.data),
      portableDifference: difference(portablePixels, dav1d.data),
      outputBytes: portable.outputBytes,
      wallMilliseconds: portable.wallMilliseconds,
      memory: portable.memory,
    })
  }

  const decoded = outcomes.filter((outcome) => outcome.outcome === 'decoded')
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    sourceCorpus: manifest.sourceCorpus,
    normalization: manifest.normalization,
    encoders: manifest.encoders,
    oracle: 'libavif 1.3.0 with dav1d 1.5.1 and libaom 3.12.1 RGB output',
    memoryMethod:
      'One cold process per file; baseline after input load and five GC/event-loop turns; RSS, external, and ArrayBuffer samples after metadata, decoder creation, and every output block. Sampled RSS avoids inherited process.resourceUsage().maxRSS high-water marks.',
    summary: {
      sources: manifest.sources.length,
      files: outcomes.length,
      decoded: decoded.length,
      errors: outcomes.length - decoded.length,
      byEncoder: Object.fromEntries(
        [...new Set(manifest.encodings.map((encoding) => encoding.encoder))].map((encoder) => [
          encoder,
          {
            files: outcomes.filter((outcome) => outcome.encoder === encoder).length,
            decoded: decoded.filter((outcome) => outcome.encoder === encoder).length,
          },
        ]),
      ),
    },
    outcomes,
  }
  const serialized = `${JSON.stringify(report, undefined, 2)}\n`
  await writeFile(resolve(outputArgument), serialized)
  console.log(serialized.trim())
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
