import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import sharp from 'sharp'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { Uint8ArraySink } from '../../../src/sink.ts'
import { MemorySource } from '../../../src/source.ts'
import {
  fixtures,
  hash,
  implementationIdentity,
  json,
  metrics,
  oracle,
  raw,
  run,
  work,
} from './io.ts'
import { number, object, string, validateImplementationIdentity } from './model.ts'

const [output, ...arguments_] = process.argv.slice(2)
if (!output) throw new Error('Specify a transparency compression report path')
const distances = arguments_.length ? arguments_.map(Number) : [3.5, 4, 6, 6.5, 7]
if (
  distances.length > 24 ||
  new Set(distances).size !== distances.length ||
  distances.some((value) => !Number.isFinite(value) || value < 0.25 || value > 25)
)
  throw new Error('Specify at most 24 unique distances in the original 0.25..25 domain')
const peerPath = 'benchmark/jpegxl/comparison/results/quality-refined-alpha.json'
const peers = object(JSON.parse(await readFile(peerPath, 'utf8')))
if (!Array.isArray(peers.results)) throw new Error('Frozen transparency peer curves required')
const identity = await implementationIdentity(),
  directory = `${work}/alpha-compression/${basename(output, '.json')}`
await mkdir(directory, { recursive: true })
const fixture = (await fixtures()).find((row) => row.id === 'alpha_triangles')
if (!fixture) throw new Error('Original transparency missing')
const pixels = await raw(fixture),
  input = pixels.data
if (!(input instanceof Uint8Array) || pixels.channels !== 4)
  throw new Error('Original RGBA8 required')
const inputPng = `${work}/fixtures/${fixture.id}.png`
sharp.concurrency(1)
if (hash(await sharp(inputPng).ensureAlpha().raw().toBuffer()) !== fixture.rawSha256)
  throw new Error('Scoring input differs')
const paths = new Set([import.meta.filename, peerPath, fixture.raw, fixture.source, inputPng])
const references = new Map<string, string>()
for (const background of ['black', 'white']) {
  const reference = `${directory}/reference-${background}.png`
  await sharp(inputPng).flatten({ background }).png().toFile(reference)
  references.set(background, reference)
  paths.add(reference)
}
interface AlphaError {
  maximum: number
  changedSamples: number
  absoluteError: number
}
const alphaError = (sample: (at: number) => number): AlphaError => {
  let maximum = 0,
    changedSamples = 0,
    absoluteError = 0
  for (let at = 3; at < input.length; at += 4) {
    const original = input[at],
      actual = sample(at)
    if (original === undefined || !Number.isFinite(actual))
      throw new Error('Transparency alpha sample missing or nonfinite')
    const error = Math.abs(actual - original)
    maximum = Math.max(maximum, error)
    if (error !== 0) changedSamples++
    absoluteError += error
  }
  return { maximum, changedSamples, absoluteError }
}
interface Point {
  subject: string
  setting: number
  publicOptions: {
    mode: 'lossy'
    effort: 7
    parameter: 'distance' | 'quality'
    value: number
  }
  bytes: number
  score: number
  butteraugli: number
  backgrounds: { background: string; ssimulacra2: number; butteraugli: number }[]
  alphaError: AlphaError
  artifact: string
  encodedSha256: string
  decodedPngSha256: string
}
const results: Point[] = [],
  proof: object[] = []
const measure = async (
  subject: string,
  setting: number,
  encoded: Uint8Array,
  artifact: string,
  publicOptions: Point['publicOptions'],
): Promise<Point> => {
  const grids: object[] = []
  let native: { data: Buffer; start: number } | undefined,
    maximumDecoderError = 0,
    nativeAlpha: AlphaError | undefined
  for (const [decoder, executable, args] of [
    ['native', `${oracle}/djxl`, ['--num_threads=1']],
    ['rust', '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli', ['--num-threads', '1']],
  ] as const) {
    const path = `${directory}/${subject}-${setting}.${decoder}.npy`
    run(executable, [artifact, path, ...args])
    const data = await readFile(path),
      start = 10 + data.readUInt16LE(8),
      header = data.subarray(10, start).toString('ascii')
    if (
      data[6] !== 1 ||
      !header.includes("'<f4'") ||
      !header.includes(`(1, ${fixture.height}, ${fixture.width}, 4)`) ||
      data.length !== start + input.length * 4
    )
      throw new Error('Incomplete transparency grid')
    for (let sample = 0; sample < input.length; sample++) {
      const value = data.readFloatLE(start + sample * 4)
      if (!Number.isFinite(value)) throw new Error('Nonfinite transparency sample')
      if (native)
        maximumDecoderError = Math.max(
          maximumDecoderError,
          Math.abs(
            Math.round(value * 255) -
              Math.round(native.data.readFloatLE(native.start + sample * 4) * 255),
          ),
        )
    }
    if (maximumDecoderError > 1) throw new Error('Independent transparency decoders disagree')
    const alpha = alphaError((at) => Math.round(data.readFloatLE(start + at * 4) * 255))
    if (subject === 'purejsimage' && alpha.maximum !== 0)
      throw new Error('Production transparency alpha changed')
    if (decoder === 'native') {
      native = { data, start }
      nativeAlpha = alpha
    }
    paths.add(path)
    paths.add(executable)
    grids.push({ decoder, path, sha256: hash(data), samples: input.length, alphaError: alpha })
  }
  const png = `${directory}/${subject}-${setting}.png`
  run(`${oracle}/djxl`, [artifact, png, '--num_threads=1', '--bits_per_sample=8'])
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (
    decoded.info.width !== fixture.width ||
    decoded.info.height !== fixture.height ||
    decoded.info.channels !== 4 ||
    decoded.data.length !== input.length
  )
    throw new Error('Transparency metric layout differs')
  const alpha = alphaError((at) => decoded.data[at] ?? Number.NaN)
  if (!native) throw new Error('Native transparency grid missing')
  let maximumMetricDecoderError = 0
  for (let at = 0; at < input.length; at++) {
    const quantized = Math.max(
      0,
      Math.min(255, Math.round(native.data.readFloatLE(native.start + at * 4) * 255)),
    )
    const actual = decoded.data[at]
    if (actual === undefined) throw new Error('Transparency metric sample missing')
    maximumMetricDecoderError = Math.max(maximumMetricDecoderError, Math.abs(quantized - actual))
  }
  if (maximumMetricDecoderError > 1 || (subject === 'purejsimage' && alpha.maximum !== 0))
    throw new Error('Metric pixels differ from clipped native grid or production alpha changed')
  let publicSamples = 0,
    maximumPublicDecoderError = 0
  if (subject === 'purejsimage') {
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    if (
      !decoder ||
      decoder.width !== fixture.width ||
      decoder.height !== fixture.height ||
      decoder.pixelFormat !== 'rgba8'
    )
      throw new Error('Public transparency decoder geometry differs')
    let nextRow = 0
    for await (const block of decoder.decode()) {
      try {
        if (
          block.x !== 0 ||
          block.width !== fixture.width ||
          block.y !== nextRow ||
          block.y + block.height > fixture.height ||
          block.format !== 'rgba8'
        )
          throw new Error('Public transparency rows are missing, repeated or out of bounds')
        for (let y = 0; y < block.height; y++) {
          for (let x = 0; x < block.width * 4; x++) {
            const at = (block.y + y) * fixture.width * 4 + x,
              actual = block.data[y * block.stride + x],
              expected = Math.max(
                0,
                Math.min(255, Math.round(native.data.readFloatLE(native.start + at * 4) * 255)),
              )
            if (actual === undefined || ((x & 3) === 3 && actual !== input[at]))
              throw new Error('Public transparency sample missing or alpha changed')
            maximumPublicDecoderError = Math.max(
              maximumPublicDecoderError,
              Math.abs(actual - expected),
            )
            publicSamples++
          }
        }
        nextRow += block.height
      } finally {
        block.release?.()
      }
    }
    if (
      nextRow !== fixture.height ||
      publicSamples !== input.length ||
      maximumPublicDecoderError > 1
    )
      throw new Error('Public transparency decoder differs from complete native pixels')
  }
  const backgrounds: Point['backgrounds'] = []
  for (const [background, reference] of references) {
    const composite = `${directory}/${subject}-${setting}.${background}.png`
    await sharp(png).flatten({ background }).png().toFile(composite)
    const ssimulacra2 = Number.parseFloat(run(`${metrics}/ssimulacra2`, [reference, composite])),
      butteraugli = Number.parseFloat(run(`${metrics}/butteraugli_main`, [reference, composite]))
    if (!Number.isFinite(ssimulacra2) || !Number.isFinite(butteraugli))
      throw new Error('Nonfinite transparency metric')
    backgrounds.push({ background, ssimulacra2, butteraugli })
    paths.add(composite)
  }
  paths.add(artifact)
  paths.add(png)
  const result: Point = {
    subject,
    setting,
    publicOptions,
    bytes: encoded.length,
    score: Math.min(...backgrounds.map((row) => row.ssimulacra2)),
    butteraugli: Math.max(...backgrounds.map((row) => row.butteraugli)),
    backgrounds,
    alphaError: alpha,
    artifact,
    encodedSha256: hash(encoded),
    decodedPngSha256: hash(await readFile(png)),
  }
  results.push(result)
  proof.push({
    ...result,
    encodedFresh: subject === 'purejsimage',
    grids,
    maximumDecoderError,
    publicSamples,
    maximumPublicDecoderError,
    maximumMetricDecoderError,
    nativeAlphaError: nativeAlpha,
  })
  console.log(JSON.stringify(result))
  return result
}
const ownership: object[] = [],
  peerSelections: { target: number; point: Point }[] = []
for (const subject of ['jsquash', 'vips']) {
  const row = peers.results.map(object).find((row) => row.subject === subject)
  if (!row || !Array.isArray(row.points) || row.points.length > 24)
    throw new Error('Original peer domain differs')
  for (const target of [70, 80, 90]) {
    const expected = row.points
      .map(object)
      .filter((point) => number(point.score) >= target)
      .sort((left, right) => number(left.bytes) - number(right.bytes))[0]
    if (!expected) throw new Error('Peer does not reach target')
    const artifact = string(expected.artifact),
      encoded = await readFile(artifact)
    if (encoded.length !== expected.bytes || hash(encoded) !== expected.artifactSha256)
      throw new Error('Frozen peer file differs')
    const options = object(expected.options)
    if (options.lossless !== false || options.effort !== 7)
      throw new Error('Frozen peer public options differ')
    let point = results.find((result) => result.subject === subject && result.artifact === artifact)
    point ??= await measure(subject, number(expected.setting), encoded, artifact, {
      mode: 'lossy',
      effort: 7,
      parameter: subject === 'jsquash' ? 'quality' : 'distance',
      value: number(options.value),
    })
    if (
      point.score !== expected.score ||
      point.butteraugli !== expected.butteraugli ||
      point.decodedPngSha256 !== expected.decodedSha256 ||
      JSON.stringify(point.backgrounds) !== JSON.stringify(expected.backgrounds)
    )
      throw new Error('Frozen peer metric or decoded PNG differs')
    peerSelections.push({ target, point })
  }
}
for (const distance of distances) {
  const sink = new Uint8ArraySink(),
    started = performance.now()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: fixture.width,
    height: fixture.height,
    pixelFormat: 'rgba8',
    limits: defaultImageLimits,
    options: { mode: 'lossy', effort: 7, distance },
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'container-signaled',
      renderingIntent: 'relative',
    },
  })
  if (!encoder) throw new Error('Public transparency encoder missing')
  await encoder.write({
    x: 0,
    y: 0,
    width: fixture.width,
    height: fixture.height,
    stride: fixture.width * 4,
    format: 'rgba8',
    data: input,
  })
  await encoder.finish()
  if (
    hash(input) !== fixture.rawSha256 ||
    !('managedLiveBytes' in encoder) ||
    encoder.managedLiveBytes !== 0 ||
    !('managedLiveAllocations' in encoder) ||
    encoder.managedLiveAllocations !== 0 ||
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number'
  )
    throw new Error('Transparency caller storage or ownership changed')
  const encoded = sink.toUint8Array(),
    artifact = `${directory}/purejsimage-${distance}.jxl`
  await writeFile(artifact, encoded, { flag: 'wx' })
  ownership.push({
    distance,
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: 0,
    ownedAllocations: 0,
    elapsedMs: performance.now() - started,
  })
  await measure('purejsimage', distance, encoded, artifact, {
    mode: 'lossy',
    effort: 7,
    parameter: 'distance',
    value: distance,
  })
}
const comparisons = peerSelections.map(({ target, point }) => {
  const pure = results
    .filter(
      (row) =>
        row.subject === 'purejsimage' &&
        row.bytes <= point.bytes &&
        row.score >= point.score &&
        row.butteraugli <= point.butteraugli,
    )
    .sort((a, b) => a.bytes - b.bytes)[0]
  return {
    target,
    comparator: point.subject,
    peer: point,
    pure: pure ?? null,
    dominatesBothMetrics: pure !== undefined,
    ratio: pure ? pure.bytes / point.bytes : null,
  }
})
for (const path of [`${metrics}/ssimulacra2`, `${metrics}/butteraugli_main`]) paths.add(path)
validateImplementationIdentity(await implementationIdentity(), identity)
const pins = []
for (const path of paths) pins.push({ path, sha256: hash(await readFile(path)) })
await json(output, {
  ...identity,
  completed: true,
  sourceAdopted: true,
  fixture: fixture.id,
  inputSha256: fixture.rawSha256,
  results,
  proof,
  ownership,
  comparisons,
  pins,
  freshEncodedFiles: distances.length,
  frozenPeerFiles: 5,
  freshCompleteIndependentGrids: (distances.length + 5) * 2,
  publicComparisonCountsChanged: false,
  fullParity: false,
  extrapolation: false,
  policy:
    'Fresh public encodes on the unchanged original transparency fixture. Select the smallest frozen measured peer reaching each original SSIMULACRA2 target. Rehash each complete file and freshly decode all samples in native/Rust. Reproduce frozen PNGs and black/white metrics exactly. Aggregate minimum SSIMULACRA2 and maximum Butteraugli over both backgrounds. Record peer alpha changes; require exact production alpha. Direct dominance requires no more bytes, no lower aggregate SSIMULACRA2 and no higher aggregate Butteraugli simultaneously. Retain failures without manufacturing interpolation brackets, changing historical counts, or claiming universal compression, speed or RSS parity.',
})
