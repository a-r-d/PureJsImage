import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'
import { verifyM7QualityPixels } from './m7-quality-decoding.ts'
import fixturesManifest from './production-program/m7-visual-defects-original-size.json' with {
  type: 'json',
}
import mapManifest from './production-program/m7-visual-defects-map-original.json' with {
  type: 'json',
}

const [mode, runId, selectedId] = process.argv.slice(2)
const originalIds = [
  'im26-1030',
  'im26-1416',
  'im26-5034',
  'im26-5052',
  'im26-1009',
  'im26-1221',
  'im26-5337',
  'im26-8160',
] as const
const caseIds: readonly string[] = selectedId ? [selectedId] : originalIds
if (
  selectedId &&
  selectedId !== 'im26-5032' &&
  !originalIds.includes(selectedId as (typeof originalIds)[number])
)
  throw new Error('Case is outside the fixed eight or registered map supplement')
if ((mode !== 'own' && mode !== 'baseline') || !runId || !/^[a-z0-9-]+$/u.test(runId))
  throw new Error('Usage: run-m7-public-original.ts own|baseline unique-run-id [case-id]')
const fixtures = '.tmp/jpegxl-m7/visual-final-20260928-fixtures'
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
const policy =
  'Fixed eight original-size sources plus an explicit registered map supplement, effort 7 distances 1 and 3. All first-party streams use native, Rust and repository decoding. The observed cases are regression evidence. This probe does not replace the approved capped matrix.'
const directory = `.tmp/jpegxl-m7/public-original-${runId}`
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
for (const id of caseIds) {
  const entry = { id }
  const source =
    id === 'im26-5032'
      ? mapManifest.results.find((row) => row.id === id && row.engine === 'purejsimage')
      : fixturesManifest.results.find((row) => row.id === id)
  if (!source) throw new Error('Missing pinned original-size source')
  const { width, height } = source
  const input =
    entry.id === 'im26-5032'
      ? `.tmp/jpegxl-m7/lossy-development-integrated054-fast/${entry.id}/input.ppm`
      : `${fixtures}/${entry.id}.ppm`
  const pixels = ppm(await readFile(input), width, height)
  if (hash(pixels) !== source.inputPixelsSha256)
    throw new Error(`Original-size fixture hash mismatch: ${id}`)
  for (const engine of mode === 'baseline' ? ['purejsimage', 'libjxl'] : ['purejsimage']) {
    for (const distance of [1, 3]) {
      const path = `${directory}/${entry.id}-${engine}-${distance}`
      try {
        if (engine === 'purejsimage') {
          const sink = new Uint8ArraySink()
          const encoder = await jpegxlCodec.createEncoder?.(sink, {
            width,
            height,
            pixelFormat: 'rgb8',
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
            limits: defaultImageLimits,
          })
          if (!encoder) throw new Error('Missing public JPEG XL encoder')
          await encoder.write({
            x: 0,
            y: 0,
            width,
            height,
            stride: width * 3,
            format: 'rgb8',
            data: pixels,
          })
          await encoder.finish()
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
          run(rust, [`${path}.jxl`, `${path}-rust.ppm`, '--num-threads', '1', '--data-type', 'u8'])
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
