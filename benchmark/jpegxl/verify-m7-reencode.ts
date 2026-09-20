/** Real-image re-encoding regression cohort; not a held-out quality qualification. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { ImageError } from '../../src/errors.ts'
import { createImageLibrary } from '../../src/index.ts'
import {
  inspectJpegReconstructionEligibility,
  inspectJpegXl,
  transcodeJpegToJpegXl,
} from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

const runId = process.argv[2]
if (!runId || !/^[a-z0-9-]+$/u.test(runId)) throw new Error('Expected a unique run identifier')
const directory = `.tmp/jpegxl-m7/reencode-${runId}`
await mkdir(directory, { recursive: false })
const ids = ['im26-1030', 'im26-1214', 'im26-1466', 'im26-1612', 'im26-2026', 'im26-2400']
const requestedOrigin = process.argv[3]
const availableOrigins = [
  'modular',
  'native-vardct',
  'jpeg-transcoded',
  'normalized-jpeg-transcoded',
] as const
const origins = availableOrigins.filter(
  (origin) => requestedOrigin === undefined || origin === requestedOrigin,
)
if (origins.length === 0) throw new Error('Invalid re-encode origin')
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const run = (tool: string, args: string[]): string => {
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 600_000, maxBuffer: 4_194_304 })
  if (result.status !== 0) throw new Error(`${tool}: ${result.stderr}; ${result.error ?? ''}`)
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
    throw new Error('Independent decoder changed sample extent')
  return bytes.subarray(header[0].length)
}
async function compareOwnPixels(
  source: Uint8Array,
  reference: Uint8Array,
  width: number,
): Promise<number> {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(source), defaultImageLimits)
  if (!decoder) throw new Error('Decoder unavailable')
  let maximum = 0,
    samples = 0
  for await (const block of decoder.decode()) {
    if (block.format !== 'rgb8') throw new Error(`Unexpected decoded format ${block.format}`)
    for (let y = 0; y < block.height; y++)
      for (let x = 0; x < block.width * 3; x++) {
        maximum = Math.max(
          maximum,
          Math.abs(
            (block.data[y * block.stride + x] ?? -1000) -
              (reference[(block.y + y) * width * 3 + block.x * 3 + x] ?? 1000),
          ),
        )
        samples++
      }
    block.release?.()
  }
  if (samples !== reference.length || maximum > 2)
    throw new Error(`Repository pixel mismatch: ${maximum}`)
  return maximum
}
sharp.concurrency(1)
const Image = createImageLibrary([jpegxlCodec])
const results: object[] = []
const sourceFiles = [
  'jpegxl-vardct-encode.ts',
  'jpegxl-vardct-forward-transforms.ts',
  'jpegxl-jpeg-encode.ts',
  'jpegxl-modular-encode.ts',
  'jpegxl-decode.ts',
]
await writeFile(
  `${directory}/protocol.json`,
  `${JSON.stringify(
    {
      policy:
        'Six previously observed development photo families, all selected input representations, native dimensions. Public pipeline re-encodes at distance 3, effort 7, progressive. No exclusion after results; failures retained. Input and output pixels are compared independently, with maximum RGB8 difference 2. This is interoperability regression evidence, not matched-quality or unseen-holdout evidence.',
      ids,
      origins,
      normalizedJpegPolicy:
        'Separate derived JPEG: canonical stored-raster sRGB RGB8 via pinned Sharp, then mozjpeg quality 95, 4:4:4, stripped metadata. Original unsupported JPEG inputs remain expected-unsupported. Derivatives are not additional source families.',
      sharp: sharp.versions,
      startedAt: new Date().toISOString(),
      harnessSha256: hash(await readFile(import.meta.filename)),
      source: await Promise.all(
        sourceFiles.map(async (name) => ({
          name,
          sha256: hash(await readFile(new URL(`../../src/codecs/${name}`, import.meta.url))),
        })),
      ),
      tools: await Promise.all(
        [`${tools}/djxl`, `${tools}/jxlinfo`, rust].map(async (path) => ({
          path,
          sha256: hash(await readFile(path)),
        })),
      ),
    },
    null,
    2,
  )}\n`,
)
let failed = 0,
  expectedUnsupported = 0
for (const id of ids) {
  const entry = selection.cases.find((value) => value.id === id && value.split === 'development')
  if (entry?.format !== 'jpg') throw new Error('Frozen re-encode identity changed')
  const original = await readFile(`.tmp/jpegxl-m7/sources/${id}.jpg`)
  if (hash(original) !== entry.sourceSha256) throw new Error('Original source hash mismatch')
  for (const origin of origins) {
    const path = `${directory}/${id}-${origin}`
    try {
      let source: Uint8Array
      let generatedJpegSha256: string | undefined
      if (origin === 'normalized-jpeg-transcoded') {
        const canonical = await sharp(original)
          .withIccProfile('srgb')
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        if (
          canonical.info.channels !== 3 ||
          canonical.info.width !== entry.width ||
          canonical.info.height !== entry.height
        )
          throw new Error('Normalized JPEG input geometry changed')
        const generated = await sharp(canonical.data, {
          raw: { width: entry.width, height: entry.height, channels: 3 },
        })
          .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' })
          .toBuffer()
        generatedJpegSha256 = hash(generated)
        await writeFile(`${path}-generated.jpg`, generated)
        source = (await transcodeJpegToJpegXl(generated, { reconstruction: 'required' })).data
        await writeFile(`${path}-input.jxl`, source)
        run(`${tools}/djxl`, [`${path}-input.jxl`, `${path}-reconstructed.jpg`, '--num_threads=1'])
        if (hash(await readFile(`${path}-reconstructed.jpg`)) !== generatedJpegSha256)
          throw new Error('Independent JPEG reconstruction changed bytes')
      } else if (origin === 'jpeg-transcoded') {
        source = (await transcodeJpegToJpegXl(original, { reconstruction: 'required' })).data
      } else {
        source = await readFile(
          origin === 'modular'
            ? `.tmp/jpegxl-m7/lossless-development-typed-palette-034-snapshot/${id}-pure-e7.jxl`
            : `.tmp/jpegxl-m7/lossy-development-forward-007-snapshot/${id}/libjxl-1.jxl`,
        )
      }
      await writeFile(`${path}-input.jxl`, source)
      const before = await inspectJpegXl(source)
      if (before.width !== entry.width || before.height !== entry.height)
        throw new Error('Input geometry mismatch')
      run(`${tools}/djxl`, [
        `${path}-input.jxl`,
        `${path}-input.ppm`,
        '--num_threads=1',
        '--bits_per_sample=8',
      ])
      const inputReference = ppm(await readFile(`${path}-input.ppm`), entry.width, entry.height)
      const inputMaximum = await compareOwnPixels(source, inputReference, entry.width)
      const image = await Image.open(source)
      const encoded = await image
        .jpegxl({ mode: 'lossy', distance: 3, effort: 7, progressive: true })
        .toBuffer()
      await writeFile(`${path}.jxl`, encoded)
      const after = await inspectJpegXl(encoded)
      if (
        after.width !== before.width ||
        after.height !== before.height ||
        after.progressivePasses !== 2 ||
        after.encoding !== 'vardct'
      )
        throw new Error('Re-encode structure mismatch')
      const metadata = run(`${tools}/jxlinfo`, [`${path}.jxl`, '-v'])
      await writeFile(`${path}-metadata.txt`, metadata)
      if (!metadata.includes('8-bit RGB') || !metadata.includes('Orientation: 1 (Normal)'))
        throw new Error('Independent output metadata mismatch')
      run(`${tools}/djxl`, [
        `${path}.jxl`,
        `${path}-native.ppm`,
        '--num_threads=1',
        '--bits_per_sample=8',
      ])
      run(rust, [`${path}.jxl`, `${path}-rust.ppm`, '--num-threads', '1', '--data-type', 'u8'])
      const native = ppm(await readFile(`${path}-native.ppm`), entry.width, entry.height)
      const independent = ppm(await readFile(`${path}-rust.ppm`), entry.width, entry.height)
      let maximum = 0
      for (let i = 0; i < native.length; i++)
        maximum = Math.max(maximum, Math.abs((native[i] ?? -1000) - (independent[i] ?? 1000)))
      if (maximum > 2) throw new Error(`Independent output difference ${maximum}`)
      const outputMaximum = await compareOwnPixels(encoded, native, entry.width)
      results.push({
        outputMaximum,
        id,
        origin,
        status: 'verified',
        sourceSha256: entry.sourceSha256,
        ...(generatedJpegSha256 ? { generatedJpegSha256 } : {}),
        inputSha256: hash(source),
        inputMaximum,
        inputPixelSha256: hash(inputReference),
        bytes: encoded.length,
        outputSha256: hash(encoded),
        nativePixelSha256: hash(native),
        rustPixelSha256: hash(independent),
        maximumIndependentDifference: maximum,
      })
      for (const suffix of ['input.ppm', 'native.ppm', 'rust.ppm'])
        await unlink(`${path}-${suffix}`)
      console.log(`${id} ${origin}: verified`)
    } catch (error) {
      const eligibility =
        origin === 'jpeg-transcoded' &&
        error instanceof ImageError &&
        error.code === 'UNSUPPORTED_OPERATION'
          ? await inspectJpegReconstructionEligibility(original)
          : undefined
      const status = eligibility && !eligibility.eligible ? 'expected-unsupported' : 'failed'
      if (status === 'failed') failed++
      else expectedUnsupported++
      results.push({
        id,
        origin,
        status,
        ...(eligibility ? { eligibility } : {}),
        error: error instanceof Error ? error.message : String(error),
      })
      console.log(`${id} ${origin}: ${status}`)
    }
    await writeFile(
      `${directory}/report.json`,
      `${JSON.stringify({ expected: ids.length * origins.length, completed: results.length, expectedUnsupported, failed, results }, null, 2)}\n`,
    )
  }
}
if (failed) process.exitCode = 1
