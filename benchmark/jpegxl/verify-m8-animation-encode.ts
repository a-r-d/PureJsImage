import { hashM8Sources } from './m8-output-digest.ts'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import {
  encodeJpegXlAnimation,
  openJpegXlSequence,
  type JpegXlAnimationInputFrame,
} from '../../src/jpegxl.ts'
import type { PixelColorSemantics } from '../../src/color.ts'

const sourceSha256 = await hashM8Sources()
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const info = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/jxlinfo'
const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const nativeSha256 = digest(await readFile(native))
if (nativeSha256 !== '8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788')
  throw new Error('Native decoder hash differs')
const photoPath = 'benchmark/corpus/files/wpt-webcodecs-mozjpeg-yuv420.jpg'
const photoSource = await readFile(photoPath)
const width = 96,
  height = 64
const photo = await sharp(photoSource)
  .resize(width + 8, height)
  .ensureAlpha()
  .raw()
  .toBuffer()
const colorSemantics: PixelColorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'straight',
  provenance: 'container-signaled',
  renderingIntent: 'relative',
}
const animation = {
  ticksPerSecondNumerator: 30000,
  ticksPerSecondDenominator: 1001,
  loops: 3,
  haveTimecodes: true,
}
const directory = '.tmp/jpegxl-m8/animation-encode'
await mkdir(directory, { recursive: true })
const reports = []
for (const scene of [
  'moving-text',
  'transparent-sprite',
  'photographic-motion',
  'repeated-frame',
  'oriented-frame',
] as const) {
  for (const mode of ['lossless', 'lossy'] as const) {
    const id = `${scene}-${mode}`
    const inputs: JpegXlAnimationInputFrame[] = []
    const expected: Uint8Array[] = []
    let canvas = new Uint8Array(width * height * 4)
    for (let frame = 0; frame < 5; frame++) {
      const rectangle = scene === 'transparent-sprite' && frame > 0
      const w = rectangle ? 16 : width,
        h = rectangle ? 16 : height
      const xOffset = rectangle ? frame * 12 : 0,
        yOffset = rectangle ? 20 : 0
      const data = new Uint8Array(w * h * 4)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const at = (y * w + x) * 4
          if (
            scene === 'photographic-motion' ||
            scene === 'repeated-frame' ||
            scene === 'oriented-frame'
          ) {
            const sourceX = x + (scene === 'repeated-frame' ? 0 : frame * 2)
            data.set(
              photo.subarray((y * (width + 8) + sourceX) * 4, (y * (width + 8) + sourceX) * 4 + 4),
              at,
            )
          } else {
            const localX = x - frame * 6
            const ink =
              scene === 'moving-text'
                ? localX >= 8 && localX < 48 && y >= 16 && y < 48 && (localX % 12 < 3 || y % 15 < 3)
                : x > 2 && x < w - 3 && y > 2 && y < h - 3
            data[at] = ink ? 250 : 20
            data[at + 1] = ink ? 30 : 80
            data[at + 2] = ink ? 10 : 160
            data[at + 3] = scene === 'transparent-sprite' ? (ink ? 191 : 0) : 255
          }
        }
      const next = canvas.slice()
      for (let y = 0; y < h; y++)
        next.set(data.subarray(y * w * 4, (y + 1) * w * 4), ((y + yOffset) * width + xOffset) * 4)
      canvas = next
      if (scene === 'oriented-frame') {
        const rotated = new Uint8Array(canvas.length)
        for (let i = 0; i < width * height; i++)
          rotated.set(canvas.subarray(i * 4, i * 4 + 4), (width * height - i - 1) * 4)
        expected.push(rotated)
      } else expected.push(canvas)
      inputs.push({
        width: w,
        height: h,
        data,
        x: xOffset,
        y: yOffset,
        durationTicks: [1, 3, 2, 1, 4][frame] ?? 1,
        timecode: 100 + frame,
        source: 1,
        saveAsReference: 1,
        blend: 'replace',
        saveBeforeColorTransform: mode === 'lossy' && scene === 'moving-text' && frame === 0,
      })
    }
    async function* source() {
      for (const input of inputs) yield input
    }
    const chunks: Uint8Array[] = []
    const start = performance.now()
    for await (const chunk of encodeJpegXlAnimation(source(), {
      width,
      height,
      pixelFormat: 'rgba8',
      colorSemantics,
      animation,
      encoding: { mode, effort: 3, orientation: scene === 'oriented-frame' ? 3 : 1 },
    }))
      chunks.push(chunk)
    const encodeMilliseconds = performance.now() - start
    const encoded = Buffer.concat(chunks)
    const path = `${directory}/${id}.jxl`
    await writeFile(path, encoded)
    execFileSync(
      native,
      [path, `${directory}/${id}.npy`, `--metadata_out=${directory}/${id}.json`, '--num_threads=1'],
      { stdio: 'pipe', timeout: 120000 },
    )
    const description = execFileSync(info, ['-v', path], { encoding: 'utf8' })
    if (
      !description.includes('Ticks per second (numerator / denominator): 30000 / 1001') ||
      !description.includes('Num loops: 3')
    )
      throw new Error(`${id}: native rational timing differs`)
    const metadata: unknown = JSON.parse(await readFile(`${directory}/${id}.json`, 'utf8'))
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      !('frames' in metadata) ||
      !Array.isArray(metadata.frames) ||
      metadata.frames.length !== inputs.length
    )
      throw new Error('Invalid native animation metadata')
    const npy = await readFile(`${directory}/${id}.npy`)
    if (npy[0] !== 147 || npy.subarray(1, 6).toString('ascii') !== 'NUMPY' || npy[6] !== 1)
      throw new Error('Invalid native float array')
    const offset = 10 + npy.readUInt16LE(8)
    if (
      !npy.subarray(10, offset).toString('ascii').includes("'<f4'") ||
      npy.length !== offset + inputs.length * width * height * 16
    )
      throw new Error('Native float extent differs')
    const sequence = await openJpegXlSequence(encoded, { orientation: 'apply' })
    const frames = []
    const previousErrors = new Float64Array(width * height * 3)
    try {
      for await (const frame of sequence.frames()) {
        const input = inputs[frame.index],
          pixels = expected[frame.index]
        const timing: unknown = metadata.frames[frame.index]
        if (
          !input ||
          !pixels ||
          typeof timing !== 'object' ||
          timing === null ||
          !('duration' in timing) ||
          typeof timing.duration !== 'number' ||
          !('timecode' in timing) ||
          timing.timecode !== input.timecode ||
          Math.abs(timing.duration - (input.durationTicks * 1001) / 30000) > 0.00000051
        )
          throw new Error(`${id}: native frame timing differs`)
        let maximumDecoderError = 0,
          maximumAlphaError = 0,
          squaredColorError = 0,
          maximumColorError = 0,
          squaredCompositeError = 0,
          squaredTemporalError = 0
        for (let i = 0; i < width * height; i++)
          for (let c = 0; c < 4; c++) {
            const value = npy.readFloatLE(offset + ((frame.index * width * height + i) * 4 + c) * 4)
            maximumDecoderError = Math.max(
              maximumDecoderError,
              Math.abs(value - (frame.planes[c]?.[i] ?? 0)),
            )
            const error = Math.abs(
              Math.round(Math.max(0, Math.min(1, value)) * 255) - (pixels[i * 4 + c] ?? 0),
            )
            if (c === 3) maximumAlphaError = Math.max(maximumAlphaError, error)
            else {
              squaredColorError += error * error
              maximumColorError = Math.max(maximumColorError, error)
              // Exact alpha makes the RGB error identical over black and white backgrounds.
              const compositeError =
                ((Math.round(Math.max(0, Math.min(1, value)) * 255) - (pixels[i * 4 + c] ?? 0)) *
                  (pixels[i * 4 + 3] ?? 0)) /
                255
              squaredCompositeError += compositeError * compositeError
              const temporal = compositeError - (previousErrors[i * 3 + c] ?? 0)
              if (frame.index > 0) squaredTemporalError += temporal * temporal
              previousErrors[i * 3 + c] = compositeError
            }
          }
        const rmsColorError = Math.sqrt(squaredColorError / (width * height * 3))
        const rmsCompositeError = Math.sqrt(squaredCompositeError / (width * height * 3))
        const rmsTemporalError = Math.sqrt(squaredTemporalError / (width * height * 3))
        const passed =
          maximumAlphaError === 0 &&
          maximumDecoderError < 0.0002 &&
          (mode === 'lossless'
            ? maximumColorError === 0
            : rmsCompositeError < 20 && rmsTemporalError < 40)
        frames.push({
          index: frame.index,
          durationTicks: frame.durationTicks,
          startTicks: frame.startTicks,
          maximumDecoderError,
          maximumAlphaError,
          maximumColorError,
          rmsColorError,
          rmsCompositeError,
          rmsTemporalError,
          passed,
        })
      }
    } finally {
      await sequence.close()
    }
    reports.push({
      id,
      inputFrameHashes: inputs.map((frame) => digest(frame.data)),
      outputSha256: digest(encoded),
      encodedBytes: encoded.length,
      encodeMilliseconds,
      nativeNpySha256: digest(npy),
      frames,
    })
  }
}
const passed = reports.every(
  (report) => report.frames.length === 5 && report.frames.every((frame) => frame.passed),
)
await writeFile(
  `${directory}/report.json`,
  `${JSON.stringify({ sourceSha256, nativeSha256, photoPath, photoSha256: digest(photoSource), animation, qualityDomain: '8-bit sRGB composited over black and white with exact alpha; raw RGB errors retained separately', passed, reports }, null, 2)}\n`,
)
console.log(
  JSON.stringify({
    passed,
    cases: reports.length,
    frames: reports.reduce((sum, report) => sum + report.frames.length, 0),
  }),
)
if (!passed) throw new Error('M8 animation encoding native comparison failed')
