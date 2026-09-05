import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { allCodecs } from '../../../src/codec-entries/all.ts'
import { createImageLibrary } from '../../../src/index.ts'
import { reportArgument, reportRevision } from '../report-provenance.ts'
const parsed: unknown = JSON.parse(
  await readFile(
    reportArgument(
      '--corpus-report',
      'benchmark/jpegxl/production-program/m3-common-static-report.json',
    ),
    'utf8',
  ),
)
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
if (
  !record(parsed) ||
  parsed.revision !== reportRevision() ||
  !Array.isArray(parsed.results) ||
  !Array.isArray(parsed.failures)
)
  throw new Error('M5 requires an exact-revision M3 report')
const corpus = {
  results: parsed.results.map((entry: unknown) => {
    if (
      !record(entry) ||
      typeof entry.id !== 'string' ||
      !/^[a-z0-9-]+$/.test(entry.id) ||
      typeof entry.encodedSha256 !== 'string' ||
      typeof entry.width !== 'number' ||
      typeof entry.height !== 'number'
    )
      throw new Error('Invalid M3 result')
    return {
      id: entry.id,
      encodedSha256: entry.encodedSha256,
      width: entry.width,
      height: entry.height,
    }
  }),
  failures: parsed.failures.map((entry: unknown) => {
    if (
      !record(entry) ||
      typeof entry.id !== 'string' ||
      !/^[a-z0-9-]+$/.test(entry.id) ||
      entry.classification !== 'unsupported'
    )
      throw new Error('Invalid M3 failure')
    return { id: entry.id }
  }),
}
const work = reportArgument('--work', '.tmp/jpegxl-m3-common-static')

const Image = createImageLibrary(allCodecs)
const results: unknown[] = []
for (const [index, entry] of corpus.results.entries()) {
  const path = `${work}/${entry.id}`
  const input = await readFile(`${path}.jxl`)
  if (createHash('sha256').update(input).digest('hex') !== entry.encodedSha256)
    throw new Error(`Changed pinned input ${entry.id}`)
  const ppm = await readFile(`${path}.oracle.ppm`)
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(0, 128).toString('ascii'))
  if (!header || Number(header[1]) !== entry.width || Number(header[2]) !== entry.height)
    throw new Error('Oracle dimensions changed')
  const reference = ppm.subarray(header[0].length)
  if (reference.length !== entry.width * entry.height * 3)
    throw new Error('Oracle pixels are truncated')
  const image = (await Image.open(input)).resize({
    width: 64,
    height: 48,
    fit: 'fill',
    kernel: 'nearest',
  })
  const referenceThumbnail = new Uint8Array(64 * 48 * 3)
  for (let y = 0; y < 48; y += 1)
    for (let x = 0; x < 64; x += 1) {
      const offset =
        (Math.floor(((y + 0.5) * entry.height) / 48) * entry.width +
          Math.floor(((x + 0.5) * entry.width) / 64)) *
        3
      referenceThumbnail.set(reference.subarray(offset, offset + 3), (y * 64 + x) * 3)
    }
  // The PNG is checked against djxl before it becomes the input to the target
  // encoder comparison. A one-sample source difference can cross a lossy
  // quantizer threshold, so lossy targets must receive identical input samples.
  const checkedThumbnail = await image.png().toBuffer()
  const referenceImage = await Image.open(checkedThumbnail)
  const outputs: unknown[] = []
  for (const format of ['png', 'jpeg', 'webp', 'avif', 'tiff'] as const) {
    const output = await (format === 'png'
      ? image.png()
      : format === 'jpeg'
        ? image.jpeg({ quality: 100, chromaSubsampling: '444' })
        : format === 'webp'
          ? image.webp({ lossless: true })
          : format === 'avif'
            ? image.avif()
            : image.tiff()
    ).toBuffer()
    const decoded = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== 64 || decoded.info.height !== 48 || decoded.info.channels !== 3)
      throw new Error(`${entry.id}: invalid output geometry`)
    const target =
      format === 'avif'
        ? await sharp(await referenceImage.avif().toBuffer())
            .removeAlpha()
            .raw()
            .toBuffer()
        : format === 'jpeg'
          ? await sharp(
              await referenceImage.jpeg({ quality: 100, chromaSubsampling: '444' }).toBuffer(),
            )
              .removeAlpha()
              .raw()
              .toBuffer()
          : referenceThumbnail
    let maximumError = 0,
      squaredError = 0
    for (let y = 0; y < 48; y += 1)
      for (let x = 0; x < 64; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          const error = Math.abs(
            (decoded.data[(y * 64 + x) * 3 + c] ?? 0) - (target[(y * 64 + x) * 3 + c] ?? 0),
          )
          maximumError = Math.max(maximumError, error)
          squaredError += error * error
        }
      }
    const rmse = Math.sqrt(squaredError / (64 * 48 * 3))
    const lossy = format === 'jpeg' || format === 'avif'
    const maxLimit = lossy ? 0 : 1
    const rmseLimit = lossy ? 0 : 0.55
    if (maximumError > maxLimit || rmse > rmseLimit)
      throw new Error(`${entry.id} ${format}: max ${maximumError}, RMSE ${rmse}`)
    outputs.push({ format, bytes: output.length, maximumError, rmse, maxLimit, rmseLimit })
  }
  results.push({
    id: entry.id,
    sha256: entry.encodedSha256,
    oraclePixelsSha256: createHash('sha256').update(reference).digest('hex'),
    outputs,
  })
  if (index % 10 === 0)
    console.log(`${index + 1}/${corpus.results.length} files passed five complete workflows`)
}
let unsupported = 0
for (const entry of corpus.failures) {
  try {
    const input = await readFile(`${work}/${entry.id}.jxl`)
    await (await Image.open(input)).png().toBuffer()
    throw new Error('Expected unsupported corpus boundary changed')
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'UNSUPPORTED_OPERATION')
      throw error
    unsupported += 1
  }
}
if (results.length / (results.length + unsupported) < 0.99)
  throw new Error('Common static acceptance below 99 percent')
await writeFile(
  reportArgument('--output', 'benchmark/jpegxl/production-program/m5-common-static.json'),
  `${JSON.stringify({ schemaVersion: 1, revision: reportRevision(), corpus: 'M3 checksum-pinned 300-file common-static corpus; unchanged djxl 0.12.0 reference PPM pixels', methodology: 'Every supported input is independently opened, nearest-resized and encoded to each of five formats. All output files are decoded with libvips. PNG, lossless WebP and TIFF retain the M3 independent source tolerance of max 1/RMSE 0.55 against djxl. JPEG quality 100 4:4:4 and AVIF 4:2:0 must exactly match equivalent transcodes of the already oracle-checked PNG thumbnail, decoded by libvips. Identical target input samples avoid amplifying allowed source rounding through lossy quantization. This composition checks source accuracy and pipeline integration; it does not establish new target-codec quality claims. No performance claims are made from this correctness run.', decoded: results.length, unsupported, incorrectOutputs: 0, workflows: results.length * 5, passed: true, results }, null, 2)}\n`,
)
