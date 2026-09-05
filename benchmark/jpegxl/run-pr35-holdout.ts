import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createJpegXlModularEncoder } from '../../src/codecs/jpegxl-modular-encode.ts'
import { inspectJpegReconstructionEligibility, transcodeJpegToJpegXl } from '../../src/jpegxl.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

const argument = (key: string, fallback: string): string => {
  const index = process.argv.indexOf(key)
  const value = process.argv[index + 1]
  if (index < 0) return fallback
  if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`)
  return value
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const manifestPath = argument(
  '--manifest',
  'benchmark/jpegxl/production-program/pr35-holdout-manifest.json',
)
const manifestBytes = await readFile(manifestPath)
const manifest: unknown = JSON.parse(manifestBytes.toString())
if (!object(manifest) || !Array.isArray(manifest.cases) || manifest.cases.length < 1)
  throw new Error('Invalid frozen holdout')
const entries = manifest.cases.map((entry: unknown) => {
  if (
    !object(entry) ||
    typeof entry.id !== 'string' ||
    typeof entry.path !== 'string' ||
    typeof entry.sha256 !== 'string' ||
    typeof entry.sourceWidth !== 'number' ||
    typeof entry.sourceHeight !== 'number'
  )
    throw new Error('Invalid holdout entry')
  return {
    id: entry.id,
    path: entry.path,
    sha256: entry.sha256,
    width: entry.sourceWidth,
    height: entry.sourceHeight,
  }
})
const tools = argument('--tools', '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools')
const work = argument('--work', '.tmp/pr35-remediation/holdout')
await mkdir(work, { recursive: true })
const run = (binary: string, args: string[]) => {
  const start = performance.now()
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || String(result.error))
  return performance.now() - start
}
const pixelsFromPnm = (bytes: Uint8Array): Uint8Array => {
  const text = new TextDecoder().decode(bytes.subarray(0, 1024))
  if (text.startsWith('P7\n')) {
    const end = text.indexOf('ENDHDR\n')
    if (end < 0) throw new Error('Missing PAM header')
    return bytes.subarray(end + 7)
  }
  if (!text.startsWith('P6')) throw new Error('Expected RGB PPM')
  let offset = 0,
    tokens = 0
  while (tokens < 4) {
    while ((bytes[offset] ?? 0) <= 32 && offset < bytes.length) offset += 1
    if (bytes[offset] === 35) {
      while (offset < bytes.length && bytes[offset] !== 10) offset += 1
      continue
    }
    while ((bytes[offset] ?? 0) > 32 && offset < bytes.length) offset += 1
    tokens += 1
  }
  return bytes.subarray(offset + (bytes[offset] === 13 && bytes[offset + 1] === 10 ? 2 : 1))
}
const id = argument('--case', '')
if (id) {
  const entry = entries.find((entry) => entry.id === id)
  if (!entry) throw new Error('Unknown holdout case')
  const source = await readFile(entry.path)
  if (hash(source) !== entry.sha256) throw new Error('Frozen source checksum changed')
  const metadata = await sharp(source).metadata()
  const high = metadata.depth === 'ushort'
  const depth = high ? 16 : 8
  const pipeline = sharp(source).toColourspace(high ? 'rgb16' : 'srgb')
  const { data: raw, info } = await pipeline
    .clone()
    .raw({ depth: high ? 'ushort' : 'uchar' })
    .toBuffer({ resolveWithObject: true })
  if (
    info.width !== entry.width ||
    info.height !== entry.height ||
    (info.channels !== 3 && info.channels !== 4)
  )
    throw new Error('Holdout geometry or channels changed')
  if (high) raw.swap16()
  const channels = info.channels
  const inputHash = hash(raw)
  const referencePng = await pipeline
    .clone()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
  const inputPnm = join(work, `${id}.input.${channels === 4 ? 'pam' : 'ppm'}`)
  const header =
    channels === 4
      ? `P7\nWIDTH ${info.width}\nHEIGHT ${info.height}\nDEPTH 4\nMAXVAL ${2 ** depth - 1}\nTUPLTYPE RGB_ALPHA\nENDHDR\n`
      : `P6\n${info.width} ${info.height}\n${2 ** depth - 1}\n`
  await writeFile(inputPnm, Buffer.concat([Buffer.from(header), raw]))
  const results: unknown[] = []
  for (const effort of [1, 7] as const) {
    const output = join(work, `${id}-e${effort}.jxl`)
    const sink = new Uint8ArraySink()
    const start = performance.now()
    const encoder = await createJpegXlModularEncoder(sink, {
      width: info.width,
      height: info.height,
      pixelFormat: channels === 4 ? (high ? 'rgba16' : 'rgba8') : high ? 'rgb16' : 'rgb8',
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: channels === 4 ? 'straight' : 'none',
        provenance: 'assumed-default',
        renderingIntent: 'relative',
      },
      options: { effort },
    })
    const format = channels === 4 ? (high ? 'rgba16' : 'rgba8') : high ? 'rgb16' : 'rgb8'
    await encoder.write({
      x: 0,
      y: 0,
      width: info.width,
      height: info.height,
      stride: info.width * channels * (depth / 8),
      format,
      data: raw,
    })
    await encoder.finish()
    const milliseconds = performance.now() - start
    const encoded = sink.toUint8Array()
    await writeFile(output, encoded)
    const decoded = join(work, `${id}-e${effort}.${channels === 4 ? 'pam' : 'ppm'}`)
    run(join(tools, 'djxl'), [output, decoded, `--bits_per_sample=${depth}`])
    const actual = pixelsFromPnm(await readFile(decoded))
    const exact = actual.length === raw.length && hash(actual) === inputHash
    const oraclePath = join(work, `${id}-oracle-e${effort}.jxl`)
    const oracleMilliseconds = run(join(tools, 'cjxl'), [
      inputPnm,
      oraclePath,
      '-d',
      '0',
      '-e',
      String(effort),
      '--keep_invisible=1',
      '--num_threads=1',
    ])
    const oracle = await readFile(oraclePath)
    results.push({
      effort,
      executedPath:
        info.width <= 1024 && info.height <= 1024
          ? 'single-group effort search'
          : 'multi-group left predictor (current large-image path)',
      milliseconds,
      oracleMilliseconds,
      bytes: encoded.length,
      ratioToPng: encoded.length / referencePng.length,
      ratioToLibjxl: encoded.length / oracle.length,
      outputSha256: hash(encoded),
      oracleBytes: oracle.length,
      exactNativeSamples: exact,
      managedPeakBytes: 'managedPeakBytes' in encoder ? encoder.managedPeakBytes : null,
      managedLiveBytes: 'managedLiveBytes' in encoder ? encoder.managedLiveBytes : null,
    })
  }
  let exactJpeg: unknown = { status: 'not-applicable' }
  if (metadata.format === 'jpeg') {
    const eligibility = await inspectJpegReconstructionEligibility(source)
    try {
      const start = performance.now()
      const encoded = await transcodeJpegToJpegXl(source, {
        reconstruction: 'required',
      })
      const milliseconds = performance.now() - start
      const path = join(work, `${id}-exact.jxl`),
        jpeg = join(work, `${id}-restored.jpg`)
      await writeFile(path, encoded.data)
      run(join(tools, 'djxl'), [path, jpeg])
      const restored = await readFile(jpeg)
      let onlyIfSmaller: unknown
      try {
        const guarded = await transcodeJpegToJpegXl(source, {
          reconstruction: 'required',
          onlyIfSmaller: true,
        })
        onlyIfSmaller = {
          status: 'encoded',
          bytes: guarded.data.byteLength,
          smaller: guarded.data.byteLength < source.length,
        }
      } catch (error) {
        onlyIfSmaller = {
          status: 'rejected',
          message: error instanceof Error ? error.message : String(error),
        }
      }
      exactJpeg = {
        onlyIfSmaller,
        status: 'encoded',
        eligibility,
        bytes: encoded.data.length,
        ratioToSource: encoded.data.length / source.length,
        milliseconds,
        byteExact: hash(restored) === entry.sha256,
      }
    } catch (error) {
      exactJpeg = {
        status: 'rejected',
        eligibility,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  console.log(
    JSON.stringify({
      id,
      sourceSha256: entry.sha256,
      width: info.width,
      height: info.height,
      channels,
      depth,
      inputPixelSha256: inputHash,
      inputBytes: raw.length,
      referencePngBytes: referencePng.length,
      results,
      exactJpeg,
      absoluteProcessPeakRssBytes: process.resourceUsage().maxRSS * 1024,
    }),
  )
} else {
  const results: unknown[] = []
  for (const entry of entries) {
    const child = spawnSync(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        '--case',
        entry.id,
        '--manifest',
        manifestPath,
        '--tools',
        tools,
        '--work',
        work,
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
    if (child.status !== 0) {
      results.push({ id: entry.id, status: 'failed', error: child.stderr || child.stdout })
      console.error(`${entry.id}: failed`)
      continue
    }
    const result: unknown = JSON.parse(child.stdout)
    results.push(result)
    console.error(`${entry.id}: reported`)
  }
  const passed = results.every((value) => {
    if (
      !object(value) ||
      !Array.isArray(value.results) ||
      value.results.length !== 2 ||
      !value.results.every((result) => object(result) && result.exactNativeSamples === true)
    )
      return false
    const jpeg = value.exactJpeg
    return (
      object(jpeg) &&
      (jpeg.status === 'not-applicable' ||
        (jpeg.status === 'encoded' && jpeg.byteExact === true) ||
        (jpeg.status === 'rejected' &&
          object(jpeg.eligibility) &&
          jpeg.eligibility.eligible === false))
    )
  })
  const report = {
    schemaVersion: 1,
    revision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    generatedAt: new Date().toISOString(),
    manifestSha256: hash(manifestBytes),
    corpus: manifest,
    validation: {
      passed,
      policy:
        'All selected pixels are independently exact; eligible JPEGs reconstruct exactly; ineligible JPEGs remain explicit rejections. Compression expansions are retained.',
    },
    methodology:
      'Frozen source assets at original dimensions, independently decoded by libvips to straight RGB/RGBA sRGB (RGB16 for the disclosed synthetic 16-bit gray example). No resizing. Pixel encoder efforts 1 and 7; independent djxl exact integer samples; matched libjxl single-thread lossless effort and PNG level 9 comparisons. Encoder time includes input staging and sink copies; oracle time includes process startup and file I/O. These are observational timings, not a speed gate. RSS is absolute per-case process peak across both efforts and validation. Every selected failure, expansion, and exact-JPEG rejection is retained.',
    oracleRevision: 'a7a9c787341cf703dede03c2009fa460cae5e5df',
    results,
  }
  const output = argument('--output', '.tmp/pr35-remediation/holdout.json')
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote ${output}`)
  if (!passed) process.exitCode = 1
}
