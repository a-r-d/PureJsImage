import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import sharp from 'sharp'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { Uint8ArraySink } from '../../../src/sink.ts'
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

const [output] = process.argv.slice(2)
if (!output) throw new Error('Specify a graphic compression report path')
const peerPath = 'benchmark/jpegxl/comparison/results/quality-refined-graphic5034.json'
const peers = object(JSON.parse(await readFile(peerPath, 'utf8')))
if (!Array.isArray(peers.results)) throw new Error('Frozen graphic peer curves required')
const identity = await implementationIdentity(),
  directory = `${work}/graphic-compression/${basename(output, '.json')}`
await mkdir(directory, { recursive: true })
const fixture = (await fixtures()).find((row) => row.id === 'im26-5034-diagnostic')
if (!fixture) throw new Error('Original graphic missing')
const pixels = await raw(fixture),
  input = pixels.data
if (!(input instanceof Uint8Array) || pixels.channels !== 4)
  throw new Error('Original RGBA8 required')
const inputPng = `${work}/fixtures/${fixture.id}.png`,
  reference = `${directory}/reference.png`
sharp.concurrency(1)
if (hash(await sharp(inputPng).ensureAlpha().raw().toBuffer()) !== fixture.rawSha256)
  throw new Error('Scoring input differs')
await sharp(inputPng).flatten({ background: 'black' }).png().toFile(reference)
const paths = new Set([
  import.meta.filename,
  peerPath,
  fixture.raw,
  fixture.source,
  inputPng,
  reference,
])
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
  artifact: string
  encodedSha256: string
}
const results: Point[] = [],
  proof: object[] = []
const measure = async (
  subject: string,
  distance: number,
  encoded: Uint8Array,
  artifact: string,
  publicOptions: Point['publicOptions'],
): Promise<Point> => {
  const grids: object[] = []
  let native: Buffer | undefined,
    maximumDecoderError = 0
  for (const [decoder, executable, args] of [
    ['native', `${oracle}/djxl`, ['--num_threads=1']],
    ['rust', '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli', ['--num-threads', '1']],
  ] as const) {
    const path = `${directory}/${subject}-${distance}.${decoder}.npy`
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
      throw new Error('Incomplete graphic grid')
    for (let sample = 0; sample < input.length; sample++) {
      const value = data.readFloatLE(start + sample * 4)
      if (
        !Number.isFinite(value) ||
        ((sample & 3) === 3 && Math.round(value * 255) !== input[sample])
      )
        throw new Error('Nonfinite graphic sample or changed alpha')
      if (native)
        maximumDecoderError = Math.max(
          maximumDecoderError,
          Math.abs(
            Math.round(value * 255) -
              Math.round(native.readFloatLE(10 + native.readUInt16LE(8) + sample * 4) * 255),
          ),
        )
    }
    if (maximumDecoderError > 1) throw new Error('Independent graphic decoders disagree')
    if (decoder === 'native') native = data
    paths.add(path)
    paths.add(executable)
    grids.push({
      decoder,
      path,
      sha256: hash(data),
      samples: input.length,
      alphaExact: true,
      executableSha256: hash(await readFile(executable)),
    })
  }
  const png = `${directory}/${subject}-${distance}.png`,
    black = `${directory}/${subject}-${distance}.black.png`
  run(`${oracle}/djxl`, [artifact, png, '--num_threads=1', '--bits_per_sample=8'])
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (
    decoded.info.width !== fixture.width ||
    decoded.info.height !== fixture.height ||
    decoded.data.length !== input.length
  )
    throw new Error('Graphic metric layout differs')
  for (let at = 3; at < input.length; at += 4)
    if (decoded.data[at] !== input[at]) throw new Error('Metric alpha changed')
  await sharp(png).flatten({ background: 'black' }).png().toFile(black)
  const score = Number.parseFloat(run(`${metrics}/ssimulacra2`, [reference, black]))
  const butteraugli = Number.parseFloat(run(`${metrics}/butteraugli_main`, [reference, black]))
  if (!Number.isFinite(score) || !Number.isFinite(butteraugli))
    throw new Error('Nonfinite graphic metric')
  for (const path of [artifact, png, black]) paths.add(path)
  const result = {
    subject,
    setting: distance,
    publicOptions,
    bytes: encoded.length,
    score,
    butteraugli,
    artifact,
    encodedSha256: hash(encoded),
  }
  results.push(result)
  proof.push({
    ...result,
    encodedFresh: subject === 'purejsimage',
    grids,
    maximumDecoderError,
    decodedSha256: hash(decoded.data),
  })
  console.log(JSON.stringify(result))
  return result
}
const ownership: object[] = []
const peerSelections: { target: number; point: Point }[] = []
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
    const point = await measure(subject, number(expected.setting), encoded, artifact, {
      mode: 'lossy',
      effort: 7,
      parameter: subject === 'jsquash' ? 'quality' : 'distance',
      value: number(options.value),
    })
    if (point.score !== expected.score || point.butteraugli !== expected.butteraugli)
      throw new Error('Frozen peer metric differs')
    peerSelections.push({ target, point })
  }
}
for (const distance of [1, 8, 16]) {
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
  if (!encoder) throw new Error('Public graphic encoder missing')
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
    throw new Error('Graphic caller storage or ownership changed')
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
  freshEncodedFiles: 3,
  frozenPeerFiles: 6,
  freshCompleteIndependentGrids: 18,
  publicComparisonCountsChanged: false,
  fullParity: false,
  extrapolation: false,
  policy:
    'Freshly encode the three original public distances 1,8,16 on the unchanged opaque graphic. Select the smallest frozen measured peer that reaches each original SSIMULACRA2 target. Rehash all six complete frozen peer files, freshly decode every original sample in native/Rust and reproduce both frozen metrics exactly. Point dominance requires fewer or equal bytes, higher or equal SSIMULACRA2 and lower or equal Butteraugli simultaneously. This separate direct-point qualification creates no interpolated bracket, changes no 13/11 counts, relabels no failed comparison and claims no speed/RSS or universal compression parity.',
})
