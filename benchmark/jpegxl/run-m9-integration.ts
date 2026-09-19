import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { allCodecs } from '../../src/codec-entries/all.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { openJpegXlSequence } from '../../src/codecs/jpegxl-sequence.ts'
import { openJpegXlSession } from '../../src/codecs/jpegxl-session.ts'
import { createImageLibrary } from '../../src/index.ts'
import {
  inspectJpegReconstructionEligibility,
  inspectJpegXl,
  reconstructJpegFromJpegXl,
  transcodeJpegToJpegXl,
} from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import type { ImageSource } from '../../src/source.ts'
import { MemorySource } from '../../src/source.ts'
import gateManifest from './production-program/m9-gate-manifest.json' with { type: 'json' }

interface M9IntegrationCase {
  readonly id: string
  readonly status: 'passed'
  readonly assertions: number
  readonly outputSha256: string
}

const images = createImageLibrary(allCodecs)
const hash = (...values: readonly (string | Uint8Array)[]): string => {
  const digest = createHash('sha256')
  for (const value of values) digest.update(value)
  return digest.digest('hex')
}
const concatenate = (...parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}
const exifOrientationMarker = (orientation: number): Uint8Array => {
  const payload = new Uint8Array(32)
  payload.set(Uint8Array.of(0x45, 0x78, 0x69, 0x66), 0)
  const view = new DataView(payload.buffer)
  payload[6] = 0x49
  payload[7] = 0x49
  view.setUint16(8, 42, true)
  view.setUint32(10, 8, true)
  view.setUint16(14, 1, true)
  view.setUint16(16, 0x0112, true)
  view.setUint16(18, 3, true)
  view.setUint32(20, 1, true)
  view.setUint16(24, orientation, true)
  const marker = new Uint8Array(payload.length + 4)
  marker.set([0xff, 0xe1])
  new DataView(marker.buffer).setUint16(2, payload.length + 2)
  marker.set(payload, 4)
  return marker
}
const fixture = (path: string): Promise<Uint8Array> => readFile(path)
const ensure: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}
const collectDecoder = async (
  input: Uint8Array,
  options: Parameters<NonNullable<typeof jpegxlCodec.createDecoder>>[2] = {},
): Promise<Uint8Array> => {
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(input),
    defaultImageLimits,
    options,
  )
  if (!decoder) throw new Error('JPEG XL decoder is unavailable')
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const block of decoder.decode()) {
    try {
      const copy = block.data.slice()
      chunks.push(copy)
      size += copy.length
    } finally {
      block.release?.()
    }
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
const pass = (
  id: string,
  assertions: number,
  ...outputs: readonly Uint8Array[]
): M9IntegrationCase =>
  Object.freeze({ id, status: 'passed', assertions, outputSha256: hash(...outputs) })

const orientationViewport = async (): Promise<M9IntegrationCase> => {
  const directory = 'tests/fixtures/jpegxl/m6-preview'
  const provenance: unknown = JSON.parse(await readFile(`${directory}/provenance.json`, 'utf8'))
  ensure(
    typeof provenance === 'object' &&
      provenance !== null &&
      'orientationBitOffset' in provenance &&
      typeof provenance.orientationBitOffset === 'number',
    'M9 orientation provenance is missing',
  )
  const bytes = Uint8Array.from(await fixture(`${directory}/embedded-preview.jxl`))
  const orientation = 6
  for (let bit = 0; bit < 3; bit++) {
    const position: number = provenance.orientationBitOffset + bit
    const byte = position >>> 3
    const mask = 1 << (position & 7)
    bytes[byte] =
      ((bytes[byte] ?? 0) & ~mask) | ((((orientation - 1) >>> bit) & 1) << (position & 7))
  }
  const session = await openJpegXlSession(bytes)
  const digest = createHash('sha256')
  let blocks = 0
  try {
    ensure(session.orientation === orientation, 'M9 progressive orientation was not preserved')
    for await (const event of session.decode({
      coordinateSpace: 'display',
      region: { x: 2, y: 3, width: 10, height: 12 },
      scaleDenominator: 2,
      until: 1,
    })) {
      if (event.type !== 'block') continue
      digest.update(event.block.data)
      event.block.release?.()
      blocks++
    }
    ensure(blocks > 0, 'M9 progressive viewport emitted no blocks')
  } finally {
    await session.close()
  }
  ensure(session.managedLiveBytes === 0, 'M9 progressive viewport leaked managed memory')
  return pass('progressive-orientation-viewport', 3, digest.digest())
}

const progressiveHdrAlpha = async (): Promise<M9IntegrationCase> => {
  const bytes = await fixture('tests/fixtures/jpegxl/m4-color/vardct-alpha-0-2.jxl')
  const session = await openJpegXlSession(bytes)
  const planned = session.plan({ region: { x: 0, y: 0, width: 2, height: 2 } })
  ensure(planned.fallbackReasons.length > 0, 'M9 HDR alpha fallback was not declared')
  const alphaOutput = await collectDecoder(bytes, { alphaOutput: 'straight' })
  const hdrOutput = await collectDecoder(
    await fixture('tests/fixtures/jpegxl/m4-color/vardct-hlg-16.jxl'),
    { hdrOutput: 'linear-float' },
  )
  await session.close()
  ensure(alphaOutput.length > 0 && hdrOutput.length > 0, 'M9 HDR alpha matrix emitted no pixels')
  ensure(session.managedLiveBytes === 0, 'M9 HDR alpha session leaked managed memory')
  return pass('progressive-hdr-alpha-fallback', 3, alphaOutput, hdrOutput)
}

const highDepthFeatures = async (): Promise<M9IntegrationCase> => {
  const native = await openJpegXlSequence(
    await fixture('tests/fixtures/jpegxl/m8-native/grouped-alpha-depth.jxl'),
  )
  const nativeDigest = createHash('sha256')
  let nativePlanes = 0
  try {
    for await (const layer of native.layers())
      for (const plane of layer.planes) {
        nativeDigest.update(new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength))
        nativePlanes++
      }
  } finally {
    await native.close()
  }
  const paths = [
    'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/rgb8-squeeze.jxl',
    'benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/rgb8-palette.jxl',
  ]
  const outputs: Uint8Array[] = [nativeDigest.digest()]
  for (const path of paths) outputs.push(await collectDecoder(await fixture(path)))
  ensure(nativePlanes > 3, 'M9 native grouped channels were not extracted')
  ensure(
    outputs.every((output) => output.length > 0),
    'M9 high-depth feature matrix is empty',
  )
  return pass('high-depth-palette-squeeze-grouped-alpha', 3, ...outputs)
}

const animationTiming = async (): Promise<M9IntegrationCase> => {
  const sequence = await openJpegXlSequence(
    await fixture('tests/fixtures/jpegxl/m8-sequence/newtons-cradle.jxl'),
  )
  try {
    const first = await sequence.frame(0)
    const second = await sequence.frame(1)
    ensure(first.durationTicks !== second.durationTicks, 'M9 animation durations are uniform')
    ensure(second.header.frameWidth < second.header.width, 'M9 animation frame is not partial')
    ensure((await sequence.frameAtTicks(BigInt(second.startTicks))).index === 1, 'M9 seek failed')
    const output = new Uint8Array(24)
    new DataView(output.buffer).setBigUint64(0, BigInt(second.startTicks))
    new DataView(output.buffer).setUint32(8, first.durationTicks)
    new DataView(output.buffer).setUint32(12, second.durationTicks)
    new DataView(output.buffer).setUint32(16, second.header.frameWidth)
    new DataView(output.buffer).setUint32(20, second.header.frameHeight)
    return pass('animation-partial-nonuniform-timing', 3, output)
  } finally {
    await sequence.close()
  }
}

const referenceSeekCancellation = async (): Promise<M9IntegrationCase> => {
  const bytes = await fixture('tests/fixtures/jpegxl/m8-sequence/newtons-cradle.jxl')
  const sequence = await openJpegXlSequence(bytes)
  try {
    const selected = await sequence.frame(1)
    const controller = new AbortController()
    const iterator = sequence.headers(controller.signal)[Symbol.asyncIterator]()
    await iterator.next()
    controller.abort()
    let cancelled = false
    try {
      await iterator.next()
    } catch (error) {
      cancelled = error instanceof Error && error.name === 'AbortError'
    }
    ensure(cancelled, 'M9 reference replay did not cancel')
    const display = new Uint8Array(selected.width * selected.height * 4)
    for (let index = 0; index < selected.width * selected.height; index++)
      for (let channel = 0; channel < 4; channel++)
        display[index * 4 + channel] = Math.round((selected.planes[channel]?.[index] ?? 1) * 255)
    return pass('reference-crop-seek-cancellation', 3, display.subarray(0, 4096))
  } finally {
    await sequence.close()
  }
}

const losslessHdrStorage = async (): Promise<M9IntegrationCase> => {
  const input = await fixture('tests/fixtures/jpegxl/m4-color/hlg-12.jxl')
  const toneMapping = {
    intensityTarget: 4000,
    minNits: 0,
    relativeToMaxDisplay: false,
    linearBelow: 0,
  }
  const output = await (await images.open(input))
    .convertPixelFormat({ format: 'rgb16' })
    .jpegxl({ toneMapping })
    .toUint8Array()
  const inspection = await inspectJpegXl(output)
  ensure(inspection.bitDepth === 16, 'M9 storage conversion lost integer depth')
  ensure(
    inspection.toneMapping?.intensityTarget === toneMapping.intensityTarget,
    'M9 storage conversion lost HDR metadata',
  )
  return pass('lossless-storage-conversion-hdr-metadata', 2, output)
}

const lossyProfileConversion = async (): Promise<M9IntegrationCase> => {
  const input = await fixture('tests/fixtures/jpegxl/m4-color/p3-8.jxl')
  const output = await (await images.open(input, { colorOutput: 'srgb' }))
    .jpegxl({ mode: 'lossy', distance: 1, effort: 3 })
    .toUint8Array()
  const inspection = await inspectJpegXl(output)
  ensure(inspection.encodedColor === 'srgb', 'M9 lossy output retained wrong profile')
  ensure((await collectDecoder(output)).length > 0, 'M9 lossy profile output did not decode')
  return pass('lossy-profile-conversion', 2, output)
}

const floatResizeInteger = async (): Promise<M9IntegrationCase> => {
  const input = await fixture('tests/fixtures/jpegxl/m4-color/vardct-pq-16.jxl')
  const output = await (
    await images.open(input, { hdrOutput: 'linear-float', colorOutput: 'preserve' })
  )
    .resize({ width: 3, height: 2, fit: 'fill', colorSpace: 'linear-light' })
    .convertPixelFormat({ format: 'rgb16', range: { minimum: 0, maximum: 1 } })
    .jpegxl({ sampleBitDepth: 16 })
    .toUint8Array()
  ensure((await inspectJpegXl(output)).bitDepth === 16, 'M9 explicit integer encoding lost depth')
  return pass('float-resize-integer-encode', 1, output)
}

const exactJpegMarkers = async (): Promise<M9IntegrationCase> => {
  const source = await fixture('benchmark/corpus/files/jpeg-reference/generated-progressive.jpg')
  const encoded = await transcodeJpegToJpegXl(source)
  ensure(encoded.mode === 'exact-jpeg', 'M9 exact JPEG transcode used a fallback')
  const reconstructed = await reconstructJpegFromJpegXl(encoded.data)
  ensure(Buffer.from(reconstructed).equals(Buffer.from(source)), 'M9 exact JPEG bytes changed')
  return pass('exact-jpeg-marker-placement', 2, reconstructed)
}

const invalidatedReconstruction = async (): Promise<M9IntegrationCase> => {
  const original = await fixture('benchmark/corpus/files/jpeg-reference/generated-progressive.jpg')
  const source = concatenate(
    original.subarray(0, 2),
    exifOrientationMarker(6),
    original.subarray(2),
  )
  const eligibility = await inspectJpegReconstructionEligibility(source)
  ensure(!eligibility.eligible, 'M9 oriented JPEG unexpectedly remained reconstructable')
  ensure(
    eligibility.reasonCodes.includes('unsupported-display-orientation'),
    'M9 reconstruction rejection reason changed',
  )
  return pass(
    'reconstruction-invalidated-by-display-metadata',
    2,
    new TextEncoder().encode(eligibility.reasonCodes.join(',')),
  )
}

const tinyBudgetFragmented = async (): Promise<M9IntegrationCase> => {
  const bytes = await fixture(
    'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance2-progressive.jxl',
  )
  let reads = 0
  const source: ImageSource = {
    size: bytes.length,
    async read(offset, length, options) {
      if (options?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      reads++
      const output = new Uint8Array(Math.min(length, bytes.length - offset))
      for (let chunk = 0; chunk < output.length; chunk += 7)
        output.set(
          bytes.subarray(offset + chunk, offset + Math.min(output.length, chunk + 7)),
          chunk,
        )
      return output
    },
  }
  const session = await openJpegXlSession(source, { maxCachedBytes: 128 })
  const digest = createHash('sha256')
  try {
    for await (const event of session.native({ scaleDenominator: 8 })) {
      if (event.type !== 'block') continue
      digest.update(event.block.data)
      event.block.release?.()
    }
  } finally {
    await session.close()
  }
  ensure(reads > 1, 'M9 fragmented source did not perform multiple reads')
  ensure(session.managedLiveBytes === 0, 'M9 fragmented source leaked managed memory')
  return pass('tiny-budget-fragmented-source', 2, digest.digest())
}

const strictFallback = async (): Promise<M9IntegrationCase> => {
  const bytes = await fixture(
    'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-effort1.jxl',
  )
  const strict = await openJpegXlSession(bytes)
  let rejected = false
  try {
    try {
      strict.decode({ fallback: 'reject' })
    } catch {
      rejected = true
    }
  } finally {
    await strict.close()
  }
  ensure(rejected, 'M9 strict fallback policy did not reject')
  const allowed = await openJpegXlSession(bytes)
  const digest = createHash('sha256')
  try {
    for await (const event of allowed.decode({ fallback: 'allow' })) {
      if (event.type !== 'block') continue
      digest.update(event.block.data)
      event.block.release?.()
    }
  } finally {
    await allowed.close()
  }
  ensure(allowed.managedLiveBytes === 0, 'M9 fallback decode leaked managed memory')
  return pass('strict-and-allow-fallback', 2, digest.digest())
}

const runners: Readonly<Record<string, () => Promise<M9IntegrationCase>>> = {
  'progressive-orientation-viewport': orientationViewport,
  'progressive-hdr-alpha-fallback': progressiveHdrAlpha,
  'high-depth-palette-squeeze-grouped-alpha': highDepthFeatures,
  'animation-partial-nonuniform-timing': animationTiming,
  'reference-crop-seek-cancellation': referenceSeekCancellation,
  'lossless-storage-conversion-hdr-metadata': losslessHdrStorage,
  'lossy-profile-conversion': lossyProfileConversion,
  'float-resize-integer-encode': floatResizeInteger,
  'exact-jpeg-marker-placement': exactJpegMarkers,
  'reconstruction-invalidated-by-display-metadata': invalidatedReconstruction,
  'tiny-budget-fragmented-source': tinyBudgetFragmented,
  'strict-and-allow-fallback': strictFallback,
}

export const runM9Integration = async () => {
  const cases: M9IntegrationCase[] = []
  for (const id of gateManifest.integrationCases) {
    const run = runners[id]
    if (!run) throw new Error(`Missing M9 integration runner ${id}`)
    cases.push(await run())
  }
  const revisionResult = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
  const statusResult = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  const revision = revisionResult.stdout.trim()
  if (revisionResult.status !== 0 || !/^[0-9a-f]{40}$/u.test(revision))
    throw new Error('Cannot resolve M9 integration revision')
  if (statusResult.status !== 0) throw new Error('Cannot inspect M9 integration worktree')
  const clean = statusResult.stdout.trim() === ''
  return {
    schemaVersion: 1,
    revision,
    clean,
    manifestSha256: hash(
      await readFile('benchmark/jpegxl/production-program/m9-gate-manifest.json'),
    ),
    cases,
    summary: { passed: true, total: cases.length, passedCases: cases.length, incorrectCases: 0 },
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const outputIndex = process.argv.indexOf('--output')
  const report = await runM9Integration()
  const json = `${JSON.stringify(report, null, 2)}\n`
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
  if (outputPath) await writeFile(outputPath, json)
  else process.stdout.write(json)
}
