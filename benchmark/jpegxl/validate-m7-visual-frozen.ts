/** Manual, frozen-source supplement. Keep separate from the approved 240-source matrix. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import { verifyM7QualityPixels } from './m7-quality-decoding.ts'
import { m7QualityDimensions } from './m7-quality-scheduling.ts'
import selection from './production-program/m7-visual-validation-selection.json' with {
  type: 'json',
}

const runId = process.argv[2]
if (!runId || !/^[a-z0-9-]+$/u.test(runId)) throw new Error('Supply a unique validation run ID')
const root = `.tmp/jpegxl-m7/visual-validation-${runId}`
const sourceDirectory = '.tmp/jpegxl-m7/visual-validation-sources'
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const metrics = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-m7-metrics/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
for (const source of selection.codecSources)
  if (hash(await readFile(source.path)) !== source.sha256)
    throw new Error('Frozen implementation changed before unobserved validation')
await mkdir(root)
await mkdir(sourceDirectory, { recursive: true })
sharp.concurrency(1)
sharp.cache(false)
const run = (path: string, args: string[]): string => {
  const result = spawnSync(path, args, {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`${path}: ${result.stderr}; ${result.error ?? ''}`)
  return result.stdout
}
const ppmPixels = (bytes: Uint8Array, width: number, height: number): Uint8Array => {
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(
    new TextDecoder().decode(bytes.subarray(0, 100)),
  )
  if (
    !header ||
    Number(header[1]) !== width ||
    Number(header[2]) !== height ||
    bytes.length !== header[0].length + width * height * 3
  )
    throw new Error('Invalid RGB8 PPM')
  return bytes.subarray(header[0].length)
}
const toolHashes = await Promise.all(
  [
    `${native}/cjxl`,
    `${native}/djxl`,
    rust,
    `${metrics}/ssimulacra2`,
    `${metrics}/butteraugli_main`,
  ].map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
)
const protocol = {
  selection,
  toolHashes,
  harnessSha256: hash(await readFile(import.meta.filename)),
  node: process.version,
  sharp: sharp.versions,
  distances: [0.25, 0.5, 1, 2, 3, 5],
  policy:
    'Public effort-7 encoder and pinned native effort 7, identical normalized RGB8 pixels capped at 2 MP using the approved preprocessing. New family-disjoint supplement only. Keep every failure and missing bracket. No HDR or complete-original claim. No tuning after inspection.',
}
await writeFile(`${root}/protocol.json`, `${JSON.stringify(protocol, null, 2)}\n`)
const results: object[] = []
for (const entry of selection.cases) {
  const sourcePath = `${sourceDirectory}/${entry.id}.${entry.format}`
  try {
    let source: Uint8Array
    try {
      source = await readFile(sourcePath)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      await downloadPinnedFile({
        allowedDirectory: sourceDirectory,
        allowedHosts: new Set(['codec-corpus.r2.imazen.org']),
        destination: sourcePath,
        expectedSha256: entry.sourceSha256,
        maximumBytes: entry.bytes,
        url: entry.sourceUrl,
      })
      source = await readFile(sourcePath)
    }
    if (source.length !== entry.bytes || hash(source) !== entry.sourceSha256)
      throw new Error('Source identity mismatch')
    const dimensions = m7QualityDimensions(entry.width, entry.height, true)
    let image = sharp(source).withIccProfile('srgb')
    if (dimensions.width !== entry.width || dimensions.height !== entry.height)
      image = image.resize(dimensions.width, dimensions.height, { kernel: 'lanczos3', fit: 'fill' })
    const { data: pixels, info } = await image
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 3) throw new Error('Expected opaque RGB')
    const { width, height } = info
    const input = `${root}/${entry.id}-input.ppm`
    await writeFile(input, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]))
    for (const engine of ['purejsimage', 'libjxl'] as const)
      for (const distance of protocol.distances) {
        const path = `${root}/${entry.id}-${engine}-${distance}`
        try {
          if (engine === 'purejsimage') {
            const sink = new Uint8ArraySink()
            const encoder = await jpegxlCodec.createEncoder?.(sink, {
              width,
              height,
              pixelFormat: 'rgb8',
              limits: defaultImageLimits,
              colorSemantics: {
                family: 'rgb',
                primaries: 'srgb',
                transfer: { kind: 'srgb' },
                matrix: 'identity',
                range: 'full',
                alpha: 'none',
                provenance: 'assumed-default',
                renderingIntent: 'relative',
              },
              options: { mode: 'lossy', distance, effort: 7, container: false },
            })
            if (!encoder) throw new Error('Missing public encoder')
            await encoder.write({
              x: 0,
              y: 0,
              width,
              height,
              format: 'rgb8',
              stride: width * 3,
              data: pixels,
            })
            await encoder.finish()
            await writeFile(`${path}.jxl`, sink.toUint8Array())
          } else
            run(`${native}/cjxl`, [
              input,
              `${path}.jxl`,
              '-d',
              String(distance),
              '-e',
              '7',
              '--num_threads=1',
            ])
          const encoded = await readFile(`${path}.jxl`)
          run(`${native}/djxl`, [`${path}.jxl`, `${path}.ppm`, '--num_threads=1'])
          const decoded = ppmPixels(await readFile(`${path}.ppm`), width, height)
          run(rust, [`${path}.jxl`, `${path}-rust.ppm`, '--num-threads', '1', '--data-type', 'u8'])
          const other = ppmPixels(await readFile(`${path}-rust.ppm`), width, height)
          let independentMaximum = 0
          for (let index = 0; index < decoded.length; index++)
            independentMaximum = Math.max(
              independentMaximum,
              Math.abs((decoded[index] ?? -1000) - (other[index] ?? 1000)),
            )
          if (independentMaximum > 2) throw new Error('Independent decoder mismatch')
          const ssimText = run(`${metrics}/ssimulacra2`, [input, `${path}.ppm`])
          const baText = run(`${metrics}/butteraugli_main`, [input, `${path}.ppm`])
          const ssimulacra2 = Number.parseFloat(ssimText),
            butteraugli = Number.parseFloat(baText)
          if (!Number.isFinite(ssimulacra2) || !Number.isFinite(butteraugli))
            throw new Error('Invalid metric')
          results.push({
            id: entry.id,
            engine,
            distance,
            width,
            height,
            status: 'measured',
            inputPixelsSha256: hash(pixels),
            bytes: encoded.length,
            encodedSha256: hash(encoded),
            decodedSha256: hash(decoded),
            independentMaximum,
            ownVerification:
              engine === 'purejsimage'
                ? await verifyM7QualityPixels(encoded, decoded, width, height)
                : undefined,
            ssimulacra2,
            butteraugli,
            rawMetrics: { ssimText, baText },
          })
        } catch (error) {
          results.push({
            id: entry.id,
            engine,
            distance,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
          process.exitCode = 1
        }
        await writeFile(
          `${root}/report.json`,
          `${JSON.stringify({ protocol, results }, null, 2)}\n`,
        )
      }
  } catch (error) {
    results.push({
      id: entry.id,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
  }
  await writeFile(`${root}/report.json`, `${JSON.stringify({ protocol, results }, null, 2)}\n`)
  console.log(entry.id, results.length)
}
