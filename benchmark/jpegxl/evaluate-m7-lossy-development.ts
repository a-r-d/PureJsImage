import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { encodeJpegXlVarDct8 } from '../../src/codecs/jpegxl-vardct-encode.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import {
  loadM7QualityCache,
  reuseM7QualityPoint,
  revalidateM7EncodedPoint,
  writeM7QualityReport,
} from './m7-quality-cache.ts'
import { verifyM7QualityPixels } from './m7-quality-decoding.ts'
import {
  assertM7ParallelMemoryGuard,
  m7QualityBatchSize,
  m7QualityDimensions,
  runM7CappedQualityPool,
} from './m7-quality-scheduling.ts'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

const runId = process.env.PUREJSIMAGE_M7_LOSSY_RUN
const split = process.env.PUREJSIMAGE_M7_LOSSY_SPLIT ?? 'development'
if (split !== 'development' && split !== 'holdout') throw new Error('Invalid M7 lossy split')
const ownOnly = process.argv.includes('--own-only')
const resolution = process.env.PUREJSIMAGE_M7_QUALITY_RESOLUTION ?? 'original'
if (resolution !== 'original' && resolution !== '2mp') throw new Error('Invalid quality resolution')
const capped = resolution === '2mp'
if (runId !== undefined && !/^[a-z0-9-]+$/u.test(runId))
  throw new Error('Invalid M7 lossy run identifier')
const directory = `.tmp/jpegxl-m7/lossy-${split}${runId ? `-${runId}` : ''}`
const workers = Number(process.env.PUREJSIMAGE_M7_LOSSY_WORKERS ?? 1)
if (
  capped ? !Number.isInteger(workers) || workers < 1 || workers > 8 : workers !== 1 && workers !== 2
)
  throw new Error('Invalid admitted quality worker count')
if (workers > 1) await assertM7ParallelMemoryGuard(capped)
sharp.concurrency(1)
sharp.cache(false)
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const metrics = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-m7-metrics/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const cases = selection.cases.filter((entry) => entry.split === split)
const caseId = process.argv.slice(2).find((argument) => argument !== '--own-only')
const engines = ownOnly
  ? (['purejsimage'] as const)
  : (['purejsimage', 'libjxl', 'mozjpeg', 'webp', 'avif'] as const)
const distances = [0.25, 0.5, 1, 2, 3, 5]
const qualities = [40, 55, 70, 80, 90, 97]
const policy = {
  split,
  engines,
  cohort: `All 120 frozen Imazen SDR ${split} families; no result-based exclusions`,
  comparatorPolicy: ownOnly
    ? 'Only first-party points are measured in this run. Comparator curves require separately verified matching-source evidence; this run alone cannot establish comparative qualification.'
    : 'All five engines are measured in this run.',
  preprocessing: capped
    ? 'User-approved 2 MP qualification: stored orientation, embedded-profile conversion to sRGB, Lanczos3 reduction to at most 2000000 pixels with floored dimensions and no enlargement; RGB8 with audited opaque alpha omitted. All engines receive identical pixels. All frozen sources retained. Original-size checks and HDR/alpha are separate; this does not establish original-resolution quality for the full corpus.'
    : 'Native stored dimensions, no resize or auto-orientation. Sharp/libvips embedded-profile conversion to canonical sRGB RGB8; independently audited constant opaque alpha omitted. Metadata stripped identically. Same normalization as the M7 lossless development matrix. Transparent/HDR expansion is a separate required cohort, not covered here.',
  evaluation:
    'PureJsImage effort 7 and libjxl effort 7 at distances 0.25/0.5/1/2/3/5. Mozjpeg/WebP/AVIF quality 40/55/70/80/90/97 are curve coordinates, never equated with JXL distance. Both SSIMULACRA2 and Butteraugli are measured on independently decoded canonical RGB. No timing promotion from these concurrent runs.',
  matching:
    'Frozen SSIMULACRA2 bands 70/80/90 and Butteraugli 1/2. Use non-dominated curves and log-byte interpolation; unbracketed scores are not-run, no extrapolation.',
}
await mkdir(directory, { recursive: true })
const run = (tool: string, args: readonly string[]): string => {
  const result = spawnSync(tool, args, {
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`${tool}: ${result.stderr}; ${result.error ?? ''}`)
  return result.stdout
}
const writePpm = (path: string, pixels: Uint8Array, width: number, height: number) =>
  writeFile(path, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]))
function ppmPixels(bytes: Uint8Array, width: number, height: number) {
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(
    new TextDecoder().decode(bytes.subarray(0, 100)),
  )
  if (
    !header ||
    Number(header[1]) !== width ||
    Number(header[2]) !== height ||
    bytes.length !== header[0].length + width * height * 3
  )
    throw new Error('Invalid decoded PPM extent')
  return bytes.subarray(header[0].length)
}
const sourcePaths = [
  'src/codecs/jpegxl-vardct-encode.ts',
  'src/codecs/jpegxl-vardct-quantization.ts',
  'src/codecs/jpegxl-vardct-forward-transforms.ts',
  'src/codecs/jpegxl-jpeg-encode.ts',
  'src/codecs/jpegxl-modular-encode.ts',
  'src/codecs/jpegxl-encoder-memory.ts',
  'src/codecs/icc.ts',
]
const sourceFingerprint = hash(
  new TextEncoder().encode(
    JSON.stringify(
      await Promise.all(
        sourcePaths.map(async (path) => ({
          path,
          sha256: hash(await readFile(new URL(`../../${path}`, import.meta.url))),
        })),
      ),
    ),
  ),
)
const cacheDirectory = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined
  if (!/^[a-z0-9-]+$/u.test(value)) throw new Error('Invalid M7 cache run identifier')
  return `.tmp/jpegxl-m7/lossy-${split}-${value}`
}
const ownCacheDirectory = cacheDirectory(process.env.PUREJSIMAGE_M7_OWN_CACHE)
const revalidateOwnCacheDirectory = cacheDirectory(process.env.PUREJSIMAGE_M7_REVALIDATE_OWN_CACHE)
if (ownCacheDirectory && revalidateOwnCacheDirectory)
  throw new Error('Choose either fingerprint-matched own cache or fresh-byte revalidation')
const comparatorCacheDirectory = cacheDirectory(process.env.PUREJSIMAGE_M7_COMPARATOR_CACHE)
const comparatorFallbackDirectory = cacheDirectory(
  process.env.PUREJSIMAGE_M7_COMPARATOR_FALLBACK_CACHE,
)
const protocol = {
  ...policy,
  resolution,
  startedAt: new Date().toISOString(),
  harnessSha256: hash(await readFile(import.meta.filename)),
  cacheHarnessSha256: hash(await readFile(new URL('./m7-quality-cache.ts', import.meta.url))),
  ownVerification: {
    policy:
      'Fresh first-party points also compare complete ordered repository RGB8 rows with the scored independent raster, tolerance 2. Cached points without this evidence still require separate verification.',
    harnessSha256: hash(await readFile(new URL('./m7-quality-decoding.ts', import.meta.url))),
    decoderSha256: hash(
      await readFile(new URL('../../src/codecs/jpegxl-decode.ts', import.meta.url)),
    ),
  },
  sourceFingerprint,
  scheduling: {
    workers,
    maximumPairedPixelsPerImage: capped ? 2_000_000 : 12_000_000,
    policy: capped
      ? 'At most eight sources capped at 2 MP each, in one 8 GiB zero-swap process tree. Original codec thread settings unchanged. Quality-only measurements, never runtime qualification.'
      : 'At most two sources of at most 12 MP each; larger sources run alone. Every codec retains its original single-thread configuration. Quality-only measurements, never runtime qualification.',
  },
  runtime: process.version,
  sharp: sharp.versions,
  ownCacheDirectory,
  revalidateOwnCacheDirectory,
  comparatorCacheDirectory,
  comparatorFallbackDirectory,
  tools: await Promise.all(
    [
      `${tools}/cjxl`,
      `${tools}/djxl`,
      rust,
      `${metrics}/ssimulacra2`,
      `${metrics}/butteraugli_main`,
    ].map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
  ),
}
if (caseId) {
  const entry = cases.find((candidate) => candidate.id === caseId)
  if (!entry) throw new Error('Case is outside frozen selection')
  const points: object[] = []
  const outputDirectory = `${directory}/${entry.id}`
  await mkdir(outputDirectory, { recursive: true })
  await writeM7QualityReport(`${outputDirectory}/execution-protocol.json`, protocol)
  try {
    const source = await readFile(`.tmp/jpegxl-m7/sources/${entry.id}.${entry.format}`)
    if (hash(source) !== entry.sourceSha256) throw new Error('Source hash mismatch')
    const dimensions = m7QualityDimensions(entry.width, entry.height, capped)
    let image = sharp(source).withIccProfile('srgb')
    if (dimensions.width !== entry.width || dimensions.height !== entry.height)
      image = image.resize(dimensions.width, dimensions.height, { kernel: 'lanczos3', fit: 'fill' })
    const { data: pixels, info } = await image
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.width !== dimensions.width || info.height !== dimensions.height || info.channels !== 3)
      throw new Error('Canonical raster extent changed')
    const input = `${outputDirectory}/input.ppm`
    await writePpm(input, pixels, info.width, info.height)
    const identity = {
      id: entry.id,
      sourceSha256: entry.sourceSha256,
      normalizedSha256: hash(pixels),
      width: info.width,
      height: info.height,
    }
    const ownCache = await loadM7QualityCache(
      ownCacheDirectory,
      identity,
      protocol,
      sourceFingerprint,
    )
    const comparatorCache = await loadM7QualityCache(comparatorCacheDirectory, identity, protocol)
    const comparatorFallback = await loadM7QualityCache(
      comparatorFallbackDirectory,
      identity,
      protocol,
    )
    const revalidationCache = await loadM7QualityCache(
      revalidateOwnCacheDirectory,
      identity,
      protocol,
    )
    for (const engine of engines) {
      for (const setting of engine === 'purejsimage' || engine === 'libjxl'
        ? distances
        : qualities) {
        try {
          const reused =
            (await reuseM7QualityPoint(
              engine === 'purejsimage' ? ownCache : comparatorCache,
              entry.id,
              engine,
              setting,
              outputDirectory,
            )) ??
            (engine !== 'purejsimage'
              ? await reuseM7QualityPoint(
                  comparatorFallback,
                  entry.id,
                  engine,
                  setting,
                  outputDirectory,
                )
              : undefined)
          if (reused) {
            points.push(reused)
            await writeM7QualityReport(`${outputDirectory}/report.json`, {
              ...identity,
              category: entry.category,
              sourceFingerprint,
              points,
            })
            continue
          }
          const path = `${outputDirectory}/${engine}-${setting}`
          const decoded = `${path}.ppm`
          const pointStarted = performance.now()
          let encodingFinished = pointStarted
          let encoded: Uint8Array,
            maximumIndependentDifference: number | null = null
          if (engine === 'purejsimage' || engine === 'libjxl') {
            const output = `${path}.jxl`
            if (engine === 'purejsimage') {
              const sink = new Uint8ArraySink()
              for (const part of encodeJpegXlVarDct8(
                pixels,
                info.width,
                info.height,
                setting,
                undefined,
                3,
                7,
              ))
                await sink.write(part)
              encoded = sink.toUint8Array()
              await writeFile(output, encoded)
              const revalidated = await revalidateM7EncodedPoint(
                revalidationCache,
                entry.id,
                setting,
                encoded,
                sourceFingerprint,
                outputDirectory,
              )
              if (revalidated) {
                points.push(revalidated)
                await writeM7QualityReport(`${outputDirectory}/report.json`, {
                  ...identity,
                  category: entry.category,
                  sourceFingerprint,
                  points,
                })
                continue
              }
            } else {
              run(`${tools}/cjxl`, [
                input,
                output,
                '-d',
                String(setting),
                '-e',
                '7',
                '--num_threads=1',
                '--container=0',
              ])
              encoded = await readFile(output)
            }
            encodingFinished = performance.now()
            run(`${tools}/djxl`, [output, decoded, '--num_threads=1', '--bits_per_sample=8'])
            if (engine === 'purejsimage') {
              const rustOutput = `${path}-jxl-rs.ppm`
              run(rust, [output, rustOutput, '--num-threads', '1', '--data-type', 'u8'])
              const nativePixels = ppmPixels(await readFile(decoded), info.width, info.height)
              const rustPixels = ppmPixels(await readFile(rustOutput), info.width, info.height)
              maximumIndependentDifference = 0
              for (let index = 0; index < nativePixels.length; index++)
                maximumIndependentDifference = Math.max(
                  maximumIndependentDifference,
                  Math.abs((nativePixels[index] ?? 0) - (rustPixels[index] ?? 0)),
                )
              if (maximumIndependentDifference > 2)
                throw new Error(`Independent decoder difference ${maximumIndependentDifference}`)
            }
          } else {
            const image = sharp(pixels, {
              raw: { width: info.width, height: info.height, channels: 3 },
            })
            encoded = await (engine === 'mozjpeg'
              ? image.jpeg({ quality: setting, mozjpeg: true, chromaSubsampling: '4:2:0' })
              : engine === 'webp'
                ? image.webp({ quality: setting, effort: 6 })
                : image.avif({ quality: setting, effort: 6, chromaSubsampling: '4:2:0' })
            ).toBuffer()
            await writeFile(`${path}.${engine === 'mozjpeg' ? 'jpg' : engine}`, encoded)
            encodingFinished = performance.now()
            const reopened = await sharp(encoded)
              .toColourspace('srgb')
              .removeAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true })
            if (
              reopened.info.width !== info.width ||
              reopened.info.height !== info.height ||
              reopened.info.channels !== 3
            )
              throw new Error('Comparator changed decoded geometry')
            await writePpm(decoded, reopened.data, info.width, info.height)
          }
          const independentDecodingFinished = performance.now()
          const ssimulacra2Text = run(`${metrics}/ssimulacra2`, [input, decoded])
          const ssimulacra2Finished = performance.now()
          const butteraugliText = run(`${metrics}/butteraugli_main`, [input, decoded])
          const butteraugliFinished = performance.now()
          const ssimulacra2 = Number.parseFloat(ssimulacra2Text),
            butteraugli = Number.parseFloat(butteraugliText)
          if (!Number.isFinite(ssimulacra2) || !Number.isFinite(butteraugli))
            throw new Error('Nonfinite perceptual score')
          const outputPixels = ppmPixels(await readFile(decoded), info.width, info.height)
          const ownVerification =
            engine === 'purejsimage'
              ? await verifyM7QualityPixels(encoded, outputPixels, info.width, info.height)
              : undefined
          const repositoryDecodingFinished = performance.now()
          let squares = 0,
            maximumError = 0
          for (let index = 0; index < pixels.length; index++) {
            const delta = (pixels[index] ?? 0) - (outputPixels[index] ?? 0)
            squares += delta * delta
            maximumError = Math.max(maximumError, Math.abs(delta))
          }
          points.push({
            engine,
            setting,
            status: 'measured',
            bytes: encoded.length,
            encodedSha256: hash(encoded),
            ssimulacra2,
            butteraugli,
            decodedSha256: hash(outputPixels),
            rmse: Math.sqrt(squares / pixels.length),
            maximumError,
            maximumIndependentDifference,
            ...(ownVerification ? { ownVerification } : {}),
            rawMetrics: { ssimulacra2Text, butteraugliText },
            stageMilliseconds: {
              encoding: encodingFinished - pointStarted,
              independentDecoding: independentDecodingFinished - encodingFinished,
              ssimulacra2: ssimulacra2Finished - independentDecodingFinished,
              butteraugli: butteraugliFinished - ssimulacra2Finished,
              repositoryDecoding: repositoryDecodingFinished - butteraugliFinished,
              numericErrors: performance.now() - repositoryDecodingFinished,
              scope:
                'Observed serial wall time including associated file I/O; not an isolated codec speed comparison',
            },
          })
          // Encoded outputs, sample hashes and raw metrics retain reproducible evidence.
          // Avoid retaining thirty full decoded bitmaps per source family.
          await unlink(decoded)
          if (engine === 'purejsimage') await unlink(`${path}-jxl-rs.ppm`)
        } catch (error) {
          process.exitCode = 1
          points.push({
            engine,
            setting,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        }
        await writeM7QualityReport(`${outputDirectory}/report.json`, {
          ...identity,
          category: entry.category,
          sourceFingerprint,
          points,
        })
      }
    }
  } catch (error) {
    await writeM7QualityReport(`${outputDirectory}/report.json`, {
      id: entry.id,
      sourceFingerprint,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
  }
} else {
  try {
    await readFile(`${directory}/protocol.json`)
    throw new Error('Run already exists; choose a new PUREJSIMAGE_M7_LOSSY_RUN')
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  await writeFile(`${directory}/protocol.json`, `${JSON.stringify(protocol, null, 2)}\n`)
  let cursor = 0,
    completed = 0
  async function worker(entry: (typeof cases)[number]) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [import.meta.filename, entry.id, ...(ownOnly ? ['--own-only'] : [])],
        {
          stdio: ['ignore', 'inherit', 'inherit'],
        },
      )
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (code === 0) resolve()
        else reject(new Error(`${entry.id}: quality worker failed (${signal ?? code})`))
      })
    })
    console.log(`${++completed}/${cases.length}: ${entry.id}`)
  }
  if (capped) await runM7CappedQualityPool(cases, workers, worker)
  else
    while (cursor < cases.length) {
      const entry = cases[cursor]
      if (!entry) throw new Error('Missing case')
      const count = m7QualityBatchSize(entry, cases[cursor + 1], workers === 1 ? 1 : 2)
      const batch = cases.slice(cursor, cursor + count)
      cursor += count
      const results = await Promise.allSettled(batch.map(worker))
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
}
