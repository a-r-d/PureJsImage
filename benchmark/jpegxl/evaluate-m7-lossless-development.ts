import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

sharp.concurrency(1)
const runId = process.env.PUREJSIMAGE_M7_LOSSLESS_RUN
if (runId !== undefined && !/^[a-z0-9-]+$/u.test(runId)) throw new Error('Invalid run identifier')
const split = process.env.PUREJSIMAGE_M7_LOSSLESS_SPLIT ?? 'development'
if (split !== 'development' && split !== 'holdout') throw new Error('Invalid frozen split')
const directory = `.tmp/jpegxl-m7/lossless-${split}${runId ? `-${runId}` : ''}`
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const cases = selection.cases.filter((entry) => entry.split === split)
const caseId = process.argv[2]
const nativeTools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const rustTool = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const policy = {
  cohort: `All ${cases.length} frozen Imazen ${split} source families, no replacements or exclusions after encoding`,
  split,
  preprocessing:
    'Sharp/libvips dev oracle converts embedded-profile source samples to sRGB RGB8, retaining the stored raster dimensions without resize or auto-orientation. All source alpha is independently audited fully opaque; RGB comparison omits that constant channel. Metadata is stripped identically for every compressor. Original display orientation remains recorded, not applied. This normalized 8-bit SDR subset does not qualify native high-depth or transparent-source gates.',
  performance:
    'Serial size and exactness evaluation; elapsed times and process memory are observational, not isolated performance evidence.',
  baseline: '2d931aa3b1617561aed770e73d53dcfabeb8b236',
}
await mkdir(directory, { recursive: true })
const run = (tool: string, args: readonly string[]) => {
  const result = spawnSync(tool, args, {
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`${tool}: ${result.stderr}; ${result.error ?? ''}`)
}
const canonicalPpm = (bytes: Uint8Array, width: number, height: number): Uint8Array => {
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(
    new TextDecoder().decode(bytes.subarray(0, 100)),
  )
  if (
    !header ||
    Number(header[1]) !== width ||
    Number(header[2]) !== height ||
    bytes.length !== header[0].length + width * height * 3
  )
    throw new Error('Unexpected oracle PPM extent')
  return bytes.subarray(header[0].length)
}
if (caseId) {
  const entry = cases.find((candidate) => candidate.id === caseId)
  if (!entry) throw new Error('Case is outside the requested frozen split')
  const started = performance.now()
  try {
    const source = await readFile(`.tmp/jpegxl-m7/sources/${entry.id}.${entry.format}`)
    if (hash(source) !== entry.sourceSha256) throw new Error('Source hash mismatch')
    const metadata = await sharp(source).metadata()
    const { data: pixels, info } = await sharp(source)
      .withIccProfile('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 3 || info.width !== entry.width || info.height !== entry.height)
      throw new Error('Normalization changed stored raster dimensions or channel count')
    const normalizedHash = hash(pixels),
      input = `${directory}/${entry.id}.ppm`
    await writeFile(
      input,
      Buffer.concat([Buffer.from(`P6\n${info.width} ${info.height}\n255\n`), pixels]),
    )
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: info.width,
      height: info.height,
      pixelFormat: 'rgb8',
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'decoder-converted',
        renderingIntent: 'relative',
      },
      options: { mode: 'lossless', effort: 7 },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('Missing encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width: info.width,
      height: info.height,
      stride: info.width * 3,
      format: 'rgb8',
      data: pixels,
    })
    await encoder.finish()
    const bytes = sink.toUint8Array(),
      output = `${directory}/${entry.id}-pure-e7.jxl`
    await writeFile(output, bytes)
    const oracles: object[] = []
    for (const oracle of ['libjxl', 'jxl-rs']) {
      const decoded = `${directory}/${entry.id}-${oracle}.ppm`
      run(
        oracle === 'libjxl' ? `${nativeTools}/djxl` : rustTool,
        oracle === 'libjxl'
          ? [output, decoded, '--num_threads=1', '--bits_per_sample=8']
          : [output, decoded, '--num-threads', '1', '--data-type', 'u8'],
      )
      const decodedHash = hash(canonicalPpm(await readFile(decoded), info.width, info.height))
      if (decodedHash !== normalizedHash)
        throw new Error(`${oracle} pixels differ from normalized input`)
      oracles.push({ oracle, decodedHash, exact: true })
    }
    const native = `${directory}/${entry.id}-libjxl-e7.jxl`
    run(`${nativeTools}/cjxl`, [
      input,
      native,
      '-d',
      '0',
      '-e',
      '7',
      '--num_threads=1',
      '--container=0',
    ])
    const nativeBytes = await readFile(native)
    const result = {
      id: entry.id,
      status: 'verified',
      category: entry.category,
      sourceSha256: entry.sourceSha256,
      normalizedHash,
      originalOrientation: metadata.orientation ?? 1,
      width: info.width,
      height: info.height,
      pureBytes: bytes.length,
      nativeBytes: nativeBytes.length,
      ratio: bytes.length / nativeBytes.length,
      encodedSha256: hash(bytes),
      nativeEncodedSha256: hash(nativeBytes),
      oracles,
      elapsedMilliseconds: performance.now() - started,
    }
    await writeFile(`${directory}/${entry.id}.json`, `${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    await writeFile(
      `${directory}/${entry.id}.json`,
      `${JSON.stringify({ id: entry.id, category: entry.category, status: 'failed', error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
    )
    process.exitCode = 1
  }
} else {
  try {
    await readFile(`${directory}/protocol.json`)
    throw new Error('Run already exists; choose a new PUREJSIMAGE_M7_LOSSLESS_RUN')
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  const sourceFiles = [
    'src/codecs/jpegxl-modular-encode.ts',
    'src/codecs/jpegxl-encoder-memory.ts',
    'src/codecs/jpegxl-decode.ts',
    'src/codecs/jpegxl-jpeg-encode.ts',
    'src/codecs/jpegxl-vardct-encode.ts',
    'src/codecs/jpegxl-vardct-forward-transforms.ts',
    'src/codecs/jpegxl-vardct-quantization.ts',
    'src/codecs/icc.ts',
  ]
  await writeFile(
    `${directory}/protocol.json`,
    `${JSON.stringify({ ...policy, startedAt: new Date().toISOString(), runtime: process.version, sharp: sharp.versions, sourceFiles: await Promise.all(sourceFiles.map(async (path) => ({ path, sha256: hash(await readFile(new URL(`../../${path}`, import.meta.url))) }))), oracleFiles: await Promise.all([`${nativeTools}/cjxl`, `${nativeTools}/djxl`, rustTool].map(async (path) => ({ path, sha256: hash(await readFile(path)) }))) }, null, 2)}\n`,
  )
  let cursor = 0,
    completed = 0
  const outputs: unknown[] = []
  async function worker() {
    while (cursor < cases.length) {
      const entry = cases[cursor++]
      if (!entry) throw new Error('Missing frozen case')
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [import.meta.filename, entry.id], {
          stdio: ['ignore', 'inherit', 'inherit'],
        })
        child.once('error', reject)
        child.once('exit', () => resolve())
      })
      const result: unknown = JSON.parse(await readFile(`${directory}/${entry.id}.json`, 'utf8'))
      outputs.push(result)
      await writeFile(
        `${directory}/report.json`,
        `${JSON.stringify({ policy, completed: ++completed, expected: cases.length, results: outputs }, null, 2)}\n`,
      )
      console.log(`${completed}/${cases.length}: ${entry.id}`)
    }
  }
  await worker()
  const results: unknown[] = await Promise.all(
    cases.map(
      async (entry): Promise<unknown> =>
        JSON.parse(await readFile(`${directory}/${entry.id}.json`, 'utf8')),
    ),
  )
  const failures = results.filter(
    (result) =>
      typeof result !== 'object' ||
      result === null ||
      !('status' in result) ||
      result.status !== 'verified',
  ).length
  await writeFile(
    `${directory}/report.json`,
    `${JSON.stringify({ policy, completed, expected: cases.length, failures, results }, null, 2)}\n`,
  )
  if (failures) process.exitCode = 1
}
