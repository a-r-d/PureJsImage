import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { encodeJpegXlVarDct8 } from '../../src/codecs/jpegxl-vardct-encode.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'
import { m7DiagnosticCases, m7DiagnosticGeometry } from './m7-diagnostic-cases.ts'
import { verifyM7QualityPixels } from './m7-quality-decoding.ts'
import corpus from './production-program/m7-corpus-selection.json' with { type: 'json' }

sharp.concurrency(1)
sharp.cache(false)
const [mode, runId] = process.argv.slice(2)
if (
  (mode !== 'prepare' && mode !== 'own' && mode !== 'baseline' && mode !== 'experimental-dct16') ||
  (mode !== 'prepare' && (!runId || !/^[a-z0-9-]+$/u.test(runId)))
)
  throw new Error(
    'Usage: run-m7-diagnostic.ts prepare | baseline|own|experimental-dct16 unique-run-id',
  )
const fixtures = '.tmp/jpegxl-m7/diagnostic-fixtures-v1'
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const metrics = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-m7-metrics/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const run = (path: string, args: readonly string[]): string => {
  const result = spawnSync(path, args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`${path}: ${result.stderr}; ${result.error ?? ''}`)
  return result.stdout
}
const ppm = (bytes: Uint8Array, width: number, height: number): Uint8Array => {
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(
    new TextDecoder().decode(bytes.subarray(0, 100)),
  )
  if (
    !header ||
    Number(header[1]) !== width ||
    Number(header[2]) !== height ||
    bytes.length !== header[0].length + width * height * 3
  )
    throw new Error('Diagnostic PPM extent mismatch')
  return bytes.subarray(header[0].length)
}
const writePpm = async (
  path: string,
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<void> => {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
  const bytes = new Uint8Array(header.length + pixels.length)
  bytes.set(header)
  bytes.set(pixels, header.length)
  await writeFile(path, bytes, { flag: 'wx' })
}
const policy =
  'Small development diagnostic only: four native-scale text/map crops and four photographic derivatives, maximum edge 1024. Effort 7 at distances 1, 2 and 3. Baseline native controls are measured once; candidate loops measure only first-party output. No AVIF, no held-out selection, no original-size or Stable qualification claim. Equal distance is not matched quality. Keep every failure.'
if (mode === 'prepare') {
  await mkdir(fixtures)
  const results = []
  for (const entry of m7DiagnosticCases) {
    const source = corpus.cases.find((row) => row.id === entry.id && row.split === 'development')
    if (!source) throw new Error('Diagnostic source is not in the development split')
    const path = `.tmp/jpegxl-m7/lossy-development-integrated054-fast/${entry.id}/input.ppm`
    const pixels = ppm(await readFile(path), source.width, source.height)
    const geometry = m7DiagnosticGeometry(source.width, source.height, entry.preparation)
    const image = sharp(pixels, {
      raw: { width: source.width, height: source.height, channels: 3 },
    })
    const prepared = await (entry.preparation.kind === 'crop'
      ? image.extract(geometry)
      : image.resize(geometry.width, geometry.height, { kernel: 'lanczos3' })
    )
      .raw()
      .toBuffer()
    await writePpm(`${fixtures}/${entry.id}.ppm`, prepared, geometry.width, geometry.height)
    results.push({
      ...entry,
      geometry,
      originalWidth: source.width,
      originalHeight: source.height,
      sourceSha256: source.sourceSha256,
      normalizedSourceSha256: hash(pixels),
      pixelsSha256: hash(prepared),
    })
  }
  await writeFile(
    `${fixtures}/manifest.json`,
    `${JSON.stringify({ policy, sharp: sharp.versions, results }, null, 2)}\n`,
    { flag: 'wx' },
  )
  console.log(`Prepared ${results.length} development derivatives`)
} else {
  const directory = `.tmp/jpegxl-m7/diagnostic-${runId}`
  await mkdir(directory)
  const manifest = await readFile(`${fixtures}/manifest.json`)
  const sources = []
  for (const name of [
    'jpegxl-vardct-encode.ts',
    'jpegxl-vardct-forward-transforms.ts',
    'jpegxl-jpeg-encode.ts',
    'jpegxl-modular-encode.ts',
    'jpegxl-decode.ts',
  ]) {
    const bytes = await readFile(new URL(`../../src/codecs/${name}`, import.meta.url))
    sources.push({ name, sha256: hash(bytes) })
  }
  const toolHashes = []
  for (const path of [
    `${native}/cjxl`,
    `${native}/djxl`,
    rust,
    `${metrics}/ssimulacra2`,
    `${metrics}/butteraugli_main`,
  ])
    toolHashes.push({ path, sha256: hash(await readFile(path)) })
  const protocol = {
    policy,
    mode,
    runtime: process.version,
    fixtureManifestSha256: hash(manifest),
    sources,
    toolHashes,
    harnessSha256: hash(await readFile(import.meta.filename)),
  }
  await writeFile(`${directory}/protocol.json`, `${JSON.stringify(protocol, null, 2)}\n`)
  const results: object[] = []
  for (const entry of m7DiagnosticCases) {
    const source = corpus.cases.find((row) => row.id === entry.id && row.split === 'development')
    if (!source) throw new Error('Invalid development source')
    const { width, height } = m7DiagnosticGeometry(source.width, source.height, entry.preparation)
    const input = `${fixtures}/${entry.id}.ppm`
    const pixels = ppm(await readFile(input), width, height)
    for (const engine of mode === 'baseline' ? ['purejsimage', 'libjxl'] : ['purejsimage']) {
      for (const distance of [1, 2, 3]) {
        const path = `${directory}/${entry.id}-${engine}-${distance}`
        try {
          if (engine === 'purejsimage') {
            const sink = new Uint8ArraySink()
            for (const part of encodeJpegXlVarDct8(
              pixels,
              width,
              height,
              distance,
              undefined,
              3,
              7,
              undefined,
              8,
              false,
              undefined,
              mode === 'experimental-dct16',
            ))
              await sink.write(part)
            await writeFile(`${path}.jxl`, sink.toUint8Array(), { flag: 'wx' })
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
          run(`${native}/djxl`, [
            `${path}.jxl`,
            `${path}.ppm`,
            '--num_threads=1',
            '--bits_per_sample=8',
          ])
          const decoded = ppm(await readFile(`${path}.ppm`), width, height)
          let independentMaximum: number | undefined
          if (engine === 'purejsimage') {
            run(rust, [
              `${path}.jxl`,
              `${path}-rust.ppm`,
              '--num-threads',
              '1',
              '--data-type',
              'u8',
            ])
            const other = ppm(await readFile(`${path}-rust.ppm`), width, height)
            independentMaximum = 0
            for (let index = 0; index < decoded.length; index++)
              independentMaximum = Math.max(
                independentMaximum,
                Math.abs((decoded[index] ?? -1000) - (other[index] ?? 1000)),
              )
            if (independentMaximum > 2) throw new Error('Independent decoder mismatch')
          }
          const ssimText = run(`${metrics}/ssimulacra2`, [input, `${path}.ppm`])
          const baText = run(`${metrics}/butteraugli_main`, [input, `${path}.ppm`])
          const ssimulacra2 = Number.parseFloat(ssimText),
            butteraugli = Number.parseFloat(baText)
          if (!Number.isFinite(ssimulacra2) || !Number.isFinite(butteraugli))
            throw new Error('Nonfinite diagnostic score')
          const frames = await readJpegXlSourceFrameStructures(
            new MemorySource(encoded),
            defaultImageLimits,
          )
          results.push({
            id: entry.id,
            width,
            height,
            inputPixelsSha256: hash(pixels),
            engine,
            distance,
            status: 'measured',
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
            frames: frames.map((frame) => ({
              type: frame.frameType,
              encoding: frame.encoding,
              width: frame.frameWidth,
              height: frame.frameHeight,
              flags: frame.frameFlags,
              upsampling: frame.upsampling,
            })),
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
          `${directory}/report.json`,
          `${JSON.stringify({ protocol, results }, null, 2)}\n`,
        )
      }
    }
    console.log(entry.id, results.length)
    if (process.exitCode) break
  }
}
