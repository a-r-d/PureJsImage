import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openJpegXlSequence } from '../../src/jpegxl.ts'
import { hashM8Frame, hashM8Sources } from './m8-output-digest.ts'

const sourceSha256 = await hashM8Sources()
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const nativeHash = '8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788'
const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
if (digest(await readFile(native)) !== nativeHash)
  throw new Error('Pinned native decoder hash differs')
const outputDirectory = '.tmp/jpegxl-m8/native-verification'
await mkdir(outputDirectory, { recursive: true })
const cases = [
  'animation_newtons_cradle',
  'animation_icos4d',
  'animation_spline',
  'bicycles',
  'blendmodes',
  'sunset_logo',
  'noise',
  'opsin_inverse',
  'opsin_inverse_5',
  'bike',
  'bike_5',
  'grayscale_public_university',
  'patches',
  'progressive',
  'alpha_premultiplied',
  'weighted-patches',
  'weighted-patches-lossy',
  'wide-gamut',
]
const pfm = async (path: string) => {
  const bytes = await readFile(path)
  const lines: string[] = []
  let offset = 0
  for (let i = 0; i < 3; i++) {
    const end = bytes.indexOf(10, offset)
    if (end < 0) throw new Error('Truncated PFM header')
    lines.push(bytes.toString('ascii', offset, end))
    offset = end + 1
  }
  const channels = lines[0] === 'PF' ? 3 : lines[0] === 'Pf' ? 1 : 0
  const dimensions = (lines[1] ?? '').split(' ').map(Number)
  const width = dimensions[0],
    height = dimensions[1],
    scale = Number(lines[2])
  if (
    !channels ||
    !width ||
    !height ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    Math.abs(scale) !== 1 ||
    bytes.length !== offset + width * height * channels * 4
  )
    throw new Error('Invalid PFM shape')
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset)
  return {
    width,
    height,
    channels,
    sha256: digest(bytes),
    sample(x: number, y: number, channel: number): number {
      return view.getFloat32(
        ((height - y - 1) * width * channels + x * channels + channel) * 4,
        scale < 0,
      )
    },
  }
}
const reports = []
for (const id of cases.filter(
  (id) => process.argv.length <= 2 || process.argv.slice(2).includes(id),
)) {
  const input =
    id.startsWith('weighted-patches') || id === 'wide-gamut'
      ? `tests/fixtures/jpegxl/m8-static/${id}.jxl`
      : `.tmp/jpegxl-conformance/testcases/${id}/input.jxl`
  const output = join(outputDirectory, `${id}.pfm`)
  execFileSync(
    native,
    [
      input,
      output,
      '--output_frames',
      '--color_space=RGB_D65_SRG_Rel_SRG',
      '--output_extra_channels',
      '--norender_spotcolors',
      '--num_threads=1',
    ],
    { stdio: 'pipe', timeout: 120000 },
  )
  const filenames = await readdir(outputDirectory)
  const primary = filenames
    .filter((name) => name === `${id}.pfm` || new RegExp(`^${id}\\.pfm-[0-9]+\\.pfm$`).test(name))
    .sort()
  const sequence = await openJpegXlSequence(await readFile(input), { orientation: 'apply' })
  const frames = []
  const outputDigest = createHash('sha256')
  try {
    for await (const frame of sequence.frames()) {
      hashM8Frame(outputDigest, frame)
      const primaryName = primary[frame.index]
      if (!primaryName) throw new Error(`${id}: missing native frame ${frame.index}`)
      const rgb = await pfm(join(outputDirectory, primaryName))
      const prefix = primaryName === `${id}.pfm` ? primaryName : primaryName.slice(0, -4)
      if (rgb.width !== frame.width || rgb.height !== frame.height)
        throw new Error(`${id}: native frame dimensions differ`)
      const channels = []
      for (let c = 0; c < frame.planes.length; c++) {
        const reference =
          c < frame.header.colorChannels
            ? rgb
            : await pfm(
                join(outputDirectory, `${prefix}-ec${c - frame.header.colorChannels + 1}.pfm`),
              )
        const plane = frame.planes[c]
        if (!plane) throw new Error('Missing decoded channel')
        let peak = 0,
          sum = 0
        for (let y = 0; y < frame.height; y++)
          for (let x = 0; x < frame.width; x++) {
            const expected = reference.sample(x, y, c < frame.header.colorChannels ? c : 0)
            const error = Math.abs(expected - (plane[y * frame.width + x] ?? 0))
            peak = Math.max(peak, error)
            sum += error * error
          }
        const rms = Math.sqrt(sum / plane.length)
        channels.push({
          channel: c,
          peak,
          rms,
          nativeSha256: reference.sha256,
          passed: peak <= 0.004 && rms <= 0.0001,
        })
      }
      frames.push({
        index: frame.index,
        width: frame.width,
        height: frame.height,
        startTicks: frame.startTicks.toString(),
        durationTicks: frame.durationTicks,
        channels,
      })
    }
    if (frames.length !== primary.length) throw new Error(`${id}: native frame count differs`)
  } finally {
    await sequence.close()
  }
  reports.push({
    id,
    inputSha256: digest(await readFile(input)),
    outputSha256: outputDigest.digest('hex'),
    frames,
  })
}
const report = {
  sourceSha256,
  native,
  nativeSha256: nativeHash,
  generatedAt: new Date().toISOString(),
  sequenceSourceSha256: digest(await readFile('src/codecs/jpegxl-sequence.ts')),
  results: reports,
  passed: reports.every((result) =>
    result.frames.every((frame) => frame.channels.every((channel) => channel.passed)),
  ),
}
await writeFile(join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(
  JSON.stringify({
    passed: report.passed,
    cases: reports.length,
    frames: reports.reduce((sum, result) => sum + result.frames.length, 0),
  }),
)
if (!report.passed) throw new Error('M8 native floating-point frame comparison failed')
