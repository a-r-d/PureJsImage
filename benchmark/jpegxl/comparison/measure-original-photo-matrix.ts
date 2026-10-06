import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'
import { createPureJsImageEntryTargets } from '../../../scripts/bundle-size-config.ts'
import { readCapabilityManifest } from '../../../scripts/capability-manifest.ts'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { Uint8ArraySink } from '../../../src/sink.ts'
import { MemorySource } from '../../../src/source.ts'
import { hash, implementationIdentity, json, metrics, oracle, run, work } from './io.ts'
import { number, object, string, validateImplementationIdentity } from './model.ts'
import { originalMatrixAttempts } from './original-matrix-ledger.ts'

const [output, fixtureId, subject, ...arguments_] = process.argv.slice(2)
if (subject !== 'purejsimage' && subject !== 'jsquash' && subject !== 'vips')
  throw new Error('Specify one predeclared public participant')
if (!fixtureId) throw new Error('Specify a predeclared original photo')
if (!output) throw new Error('Specify an original photo compression report path')
const distances = arguments_.map(Number)
if (
  distances.length < 1 ||
  distances.length > 24 ||
  new Set(distances).size !== distances.length ||
  distances.some(
    (value) =>
      !Number.isFinite(value) ||
      value < (subject === 'jsquash' ? 2 : subject === 'vips' ? 0.1 : 0.25) ||
      value > (subject === 'jsquash' ? 101 : 25),
  )
)
  throw new Error('Specify 1 to 24 unique settings in the predeclared participant domain')
const identity = await implementationIdentity(),
  directory = `${work}/original-butteraugli/${basename(output, '.json')}`
await mkdir(directory, { recursive: true })
if (
  identity.implementationSourceSha256 !==
  '7c17231f8d1c13b79eaf4794cdf69709160c9d962ed5501f5492da8a42387771'
)
  throw new Error('Qualified source differs')
const previous = object(
  JSON.parse(
    await readFile(
      'benchmark/jpegxl/comparison/results/original-photo-production-controls.json',
      'utf8',
    ),
  ),
)
if (!Array.isArray(previous.packages)) throw new Error('Qualified public packages missing')
const packages: object[] = []
let namespace: unknown
const targets = createPureJsImageEntryTargets(
  await readCapabilityManifest('capabilities/manifest.json'),
).filter((row) => row.id === 'codec-jpegxl' || row.id === 'jpegxl-specialized')
if (targets.length !== 2) throw new Error('Both complete public packages required')
for (const target of targets) {
  const built = await build({
    bundle: true,
    charset: 'utf8',
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    minify: true,
    platform: 'node',
    target: 'node22',
    treeShaking: true,
    write: false,
    stdin: {
      contents: target.contents,
      loader: 'ts',
      resolveDir: process.cwd(),
      sourcefile: 'bundle-size-entry.ts',
    },
  })
  const file = built.outputFiles[0]
  const prior = previous.packages.map(object).find((row) => row.target === target.id)
  if (
    !file ||
    built.outputFiles.length !== 1 ||
    !prior ||
    hash(file.contents) !== prior.sha256 ||
    file.contents.length !== prior.bytes ||
    typeof target.maxMinifiedBytes !== 'number' ||
    file.contents.length > target.maxMinifiedBytes
  )
    throw new Error('Current whole public package differs')
  const path = `${directory}/${target.id}.js`
  await writeFile(path, file.contents, { flag: 'wx' })
  const imported: unknown = await import(pathToFileURL(resolve(path)).href)
  const exports = Object.keys(object(imported)).sort()
  if (JSON.stringify(exports) !== JSON.stringify(prior.exports))
    throw new Error('Public exports differ')
  packages.push({
    path,
    target: target.id,
    sha256: hash(file.contents),
    bytes: file.contents.length,
    exports,
    ceiling: target.maxMinifiedBytes,
  })
  if (target.id === 'codec-jpegxl') namespace = imported
}
const create = object(object(namespace).jpegxlCodec).createEncoder
if (typeof create !== 'function') throw new Error('Complete public encoder missing')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const planPath = 'benchmark/jpegxl/comparison/original-photo-matrix-plan.json'
const plan = object(JSON.parse(await readFile(planPath, 'utf8')))
if (
  plan.implementationSourceSha256 !== identity.implementationSourceSha256 ||
  !Array.isArray(plan.fixtures) ||
  plan.maximumAttemptsPerUnchangedImplementationParticipantFixture !== 24
)
  throw new Error('Predeclared matrix plan differs')
const fixturePath = string(plan.fixtureManifest)
const fixtureReport = object(JSON.parse(await readFile(fixturePath, 'utf8')))
if (fixtureReport.completed !== true || !Array.isArray(fixtureReport.fixtures))
  throw new Error('Prepared originals missing')
const row = fixtureReport.fixtures.map(object).find((entry) => entry.id === fixtureId)
const planned = plan.fixtures.map(object).find((entry) => entry.id === fixtureId)
if (
  !row ||
  !planned ||
  row.scope !== 'original' ||
  row.channels !== 4 ||
  row.sampleType !== 'uint8' ||
  row.width !== planned.width ||
  row.height !== planned.height ||
  row.rawSha256 !== planned.rawSha256
)
  throw new Error('Pinned original photo differs')
const fixture = {
  id: string(row.id),
  width: number(row.width),
  height: number(row.height),
  raw: string(row.raw),
  rawSha256: string(row.rawSha256),
  source: string(row.source),
  sourceSha256: string(row.sourceSha256),
}
if (
  !Number.isSafeInteger(fixture.width) ||
  !Number.isSafeInteger(fixture.height) ||
  fixture.width < 1 ||
  fixture.height < 1 ||
  fixture.width * fixture.height > 16777216
)
  throw new Error('Invalid original extent')
const input = new Uint8Array(await readFile(fixture.raw))
if (
  input.length !== fixture.width * fixture.height * 4 ||
  hash(input) !== fixture.rawSha256 ||
  hash(await readFile(fixture.source)) !== fixture.sourceSha256
)
  throw new Error('Original source or sample drift')
for (let at = 3; at < input.length; at += 4)
  if (input[at] !== 255) throw new Error('Original alpha differs')
const inputPng = string(row.png)
sharp.concurrency(1)
if (
  hash(await readFile(inputPng)) !== row.pngSha256 ||
  hash(await sharp(inputPng).ensureAlpha().raw().toBuffer()) !== fixture.rawSha256
)
  throw new Error('Scoring pixels differ')
const paths = new Set([
  import.meta.filename,
  planPath,
  fixturePath,
  fixture.raw,
  fixture.source,
  inputPng,
  'src/codecs/jpegxl-vardct-encode.ts',
  'src/codecs/jpegxl-jpeg-encode.ts',
  'benchmark/jpegxl/comparison/original-matrix-ledger.ts',
  'benchmark/jpegxl/comparison/results/original-photo-production-controls.json',
])
interface Attempt {
  readonly setting: number
  readonly report: string
  status: 'attempted' | 'verified' | 'failed'
}
const ledgerPath = `${work}/original-photo-matrix-1547/${identity.implementationSourceSha256}/${fixture.id}-${subject}-attempts.json`
const domain = object(plan.domain)[subject]
if (!Array.isArray(domain) || domain.length !== 2) throw new Error('Participant domain missing')
const minimumSetting = number(domain[0]),
  maximumSetting = number(domain[1])
if (distances.some((setting) => setting < minimumSetting || setting > maximumSetting))
  throw new Error('Setting outside predeclared domain')
const attempts: Attempt[] = []
try {
  attempts.push(
    ...originalMatrixAttempts(JSON.parse(await readFile(ledgerPath, 'utf8')), {
      implementationSourceSha256: identity.implementationSourceSha256,
      fixture: fixture.id,
      inputSha256: fixture.rawSha256,
      minimumSetting,
      maximumSetting,
    }).map((attempt) => ({ ...attempt })),
  )
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
}
if (
  attempts.length + distances.length > 24 ||
  distances.some((distance) => attempts.some((attempt) => attempt.setting === distance))
)
  throw new Error('Unchanged-source attempt budget or uniqueness violated')
const saveLedger = async () => {
  const pending = `${ledgerPath}.pending-${process.pid}`
  await json(pending, {
    implementationSourceSha256: identity.implementationSourceSha256,
    fixture: fixture.id,
    inputSha256: fixture.rawSha256,
    maximumAttempts: 24,
    attempts,
  })
  await rename(pending, ledgerPath)
}
const peerWorker = 'benchmark/jpegxl/comparison/original-photo-matrix-peer-worker.ts'
if (subject !== 'purejsimage') {
  paths.add(peerWorker)
  paths.add('benchmark/jpegxl/comparison/adapters.ts')
  for (const [name, version] of [
    ['@jsquash/jxl', '1.3.0'],
    ['wasm-vips', '0.0.19'],
  ] as const) {
    const path = `node_modules/${name}/package.json`
    if (object(JSON.parse(await readFile(path, 'utf8'))).version !== version)
      throw new Error('Pinned public peer version differs')
    paths.add(path)
  }
  for (const path of [
    `${work}/assets/jsquash-enc.wasm`,
    `${work}/assets/jsquash-dec.wasm`,
    'node_modules/@jsquash/jxl/encode.js',
    'node_modules/@jsquash/jxl/decode.js',
    'node_modules/wasm-vips/versions.json',
    'node_modules/wasm-vips/lib/vips-node.mjs',
    'node_modules/wasm-vips/lib/vips.wasm',
    'node_modules/wasm-vips/lib/vips-jxl.wasm',
  ])
    paths.add(path)
}
const references = new Map<string, string>()
for (const background of ['black']) {
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
      throw new Error('Original photo alpha sample missing or nonfinite')
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
      throw new Error('Incomplete original photo grid')
    for (let sample = 0; sample < input.length; sample++) {
      const value = data.readFloatLE(start + sample * 4)
      if (!Number.isFinite(value)) throw new Error('Nonfinite original photo sample')
      if (native)
        maximumDecoderError = Math.max(
          maximumDecoderError,
          Math.abs(
            Math.round(value * 255) -
              Math.round(native.data.readFloatLE(native.start + sample * 4) * 255),
          ),
        )
    }
    if (maximumDecoderError > 1) throw new Error('Independent original photo decoders disagree')
    const alpha = alphaError((at) => Math.round(data.readFloatLE(start + at * 4) * 255))
    if (alpha.maximum !== 0) throw new Error('Production original photo alpha changed')
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
    throw new Error('Original photo metric layout differs')
  const alpha = alphaError((at) => decoded.data[at] ?? Number.NaN)
  if (!native) throw new Error('Native original photo grid missing')
  let maximumMetricDecoderError = 0
  for (let at = 0; at < input.length; at++) {
    const quantized = Math.max(
      0,
      Math.min(255, Math.round(native.data.readFloatLE(native.start + at * 4) * 255)),
    )
    const actual = decoded.data[at]
    if (actual === undefined) throw new Error('Original photo metric sample missing')
    maximumMetricDecoderError = Math.max(maximumMetricDecoderError, Math.abs(quantized - actual))
  }
  if (maximumMetricDecoderError > 1 || alpha.maximum !== 0)
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
      throw new Error('Public original photo decoder geometry differs')
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
          throw new Error('Public original photo rows are missing, repeated or out of bounds')
        for (let y = 0; y < block.height; y++) {
          for (let x = 0; x < block.width * 4; x++) {
            const at = (block.y + y) * fixture.width * 4 + x,
              actual = block.data[y * block.stride + x],
              expected = Math.max(
                0,
                Math.min(255, Math.round(native.data.readFloatLE(native.start + at * 4) * 255)),
              )
            if (actual === undefined || ((x & 3) === 3 && actual !== input[at]))
              throw new Error('Public original photo sample missing or alpha changed')
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
      throw new Error('Public original photo decoder differs from complete native pixels')
  }
  const backgrounds: Point['backgrounds'] = []
  for (const [background, reference] of references) {
    const composite = `${directory}/${subject}-${setting}.${background}.png`
    await sharp(png).flatten({ background }).png().toFile(composite)
    const ssimulacra2 = Number.parseFloat(run(`${metrics}/ssimulacra2`, [reference, composite])),
      butteraugli = Number.parseFloat(run(`${metrics}/butteraugli_main`, [reference, composite]))
    if (!Number.isFinite(ssimulacra2) || !Number.isFinite(butteraugli))
      throw new Error('Nonfinite original photo metric')
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
    encodedFresh: true,
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
const ownership: {
  distance: number
  ownedPeak: number
  ownedLive: 0
  ownedAllocations: 0
  elapsedMs: number
}[] = []
const failures: {
  subject: string
  setting: number
  phase: 'public-encode' | 'independent-validation'
  status: string
  detail: string
}[] = []
for (const distance of distances) {
  const attempt: Attempt = { setting: distance, report: output, status: 'attempted' }
  attempts.push(attempt)
  await saveLedger()
  let phase: 'public-encode' | 'independent-validation' = 'public-encode'
  try {
    if (subject === 'purejsimage') {
      const sink = new Uint8ArraySink(),
        started = performance.now()
      const encoder: unknown = await create(sink, {
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
      if (
        !isRecord(encoder) ||
        typeof encoder.write !== 'function' ||
        typeof encoder.finish !== 'function'
      )
        throw new Error('Public encoder lifecycle missing')
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
        throw new Error('Original photo caller storage or ownership changed')
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
      phase = 'independent-validation'
      await measure('purejsimage', distance, encoded, artifact, {
        mode: 'lossy',
        effort: 7,
        parameter: 'distance',
        value: distance,
      })
    } else {
      const artifact = `${directory}/${subject}-${distance}.jxl`
      console.log(
        run(process.execPath, [peerWorker, subject, String(distance), artifact, fixture.id]).trim(),
      )
      const encoded = new Uint8Array(await readFile(artifact))
      phase = 'independent-validation'
      await measure(subject, distance, encoded, artifact, {
        mode: 'lossy',
        effort: 7,
        parameter: subject === 'jsquash' ? 'quality' : 'distance',
        value: subject === 'jsquash' ? 101 - distance : distance,
      })
    }
    attempt.status = 'verified'
  } catch (error) {
    attempt.status = 'failed'
    const failure = {
      subject,
      setting: distance,
      phase,
      status: phase === 'independent-validation' ? 'incorrect output' : 'execution failure',
      detail: error instanceof Error ? error.message : String(error),
    }
    failures.push(failure)
    console.log(JSON.stringify(failure))
  }
  await saveLedger()
}
const comparisons: object[] = []
for (const path of [`${metrics}/ssimulacra2`, `${metrics}/butteraugli_main`]) paths.add(path)
validateImplementationIdentity(await implementationIdentity(), identity)
const pins = []
for (const path of paths) pins.push({ path, sha256: hash(await readFile(path)) })
await json(output, {
  ...identity,
  completed: true,
  sourceAdopted: true,
  subject,
  failures,
  allRequestedOutputsVerified: failures.length === 0,
  productionCodecSourcePath: 'src/codecs/jpegxl-vardct-encode.ts',
  packages,
  productionCodecSourceSha256: hash(await readFile('src/codecs/jpegxl-vardct-encode.ts')),
  inheritedMeasuredPoints: 0,
  totalMeasuredPoints: results.length,
  totalAttemptedSettings: distances.length,
  attemptLedger: {
    path: ledgerPath,
    attemptedSettings: attempts.map((attempt) => attempt.setting),
    maximumAttempts: 24,
  },
  predeclaredPlan: { path: planPath, sha256: hash(await readFile(planPath)) },
  fixture: fixture.id,
  inputSha256: fixture.rawSha256,
  results,
  proof,
  ownership,
  comparisons,
  pins,
  freshEncodedFiles: results.length,
  attemptedSettings: distances,
  frozenPeerFiles: 0,
  freshCompleteIndependentGrids: results.length * 2,
  freshPublicDecodedSamples: subject === 'purejsimage' ? results.length * input.length : 0,
  publicComparisonCountsChanged: false,
  fullParity: false,
  extrapolation: false,
  policy:
    'Measure one predeclared unresized original through the complete production PureJsImage package or a pinned public WASM encoder API. Verify both complete production package identities and retain the original shared 24-attempt ledger, including unsuccessful attempts. Successful files require complete finite native/Rust grids, exact opaque alpha and both metrics; PureJsImage outputs also require every public decoded sample, unchanged callers and closed ownership. Preserve encoding and validation failures separately. Native encoder bytes never substitute for peer output. Fixed settings do not establish matched compression parity.',
})

if (
  failures.some(
    (failure) => subject === 'purejsimage' || failure.phase === 'independent-validation',
  )
)
  process.exitCode = 1
