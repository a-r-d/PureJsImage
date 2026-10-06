import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
import { interpolateM7Quality } from '../m7-quality-curves.ts'
import { type RecoveryBracket, recoveryBracket } from '../m7-recovery-curves.ts'
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
import { number, object, validateImplementationIdentity } from './model.ts'

const [
  output,
  baselinePath = 'benchmark/jpegxl/comparison/results/photo-parity-production-controls.json',
] = process.argv.slice(2)
if (!output) throw new Error('Specify a photo compression verification report path')
const baseline = object(JSON.parse(await readFile(baselinePath, 'utf8')))
if (!Array.isArray(baseline.results) || baseline.results.length !== 34)
  throw new Error('All 34 frozen photo points are required')
const peerPath = 'benchmark/jpegxl/comparison/results/filter-ac-production-controls.json'
const peers = object(JSON.parse(await readFile(peerPath, 'utf8')))
if (
  !Array.isArray(peers.matchedFrozenPeerComparisons) ||
  peers.matchedFrozenPeerComparisons.length !== 12
)
  throw new Error('All twelve frozen peer comparisons are required')
const identity = await implementationIdentity()
const directory = `${work}/photo-compression-verification/${basename(output, '.json')}`
await mkdir(directory, { recursive: true })
const paths = new Set([
  import.meta.filename,
  baselinePath,
  peerPath,
  'capabilities/manifest.json',
  'scripts/bundle-size-config.ts',
  'scripts/bundle-size-budgets.ts',
])
const packages: object[] = []
const results: Record<string, unknown>[] = []
const targets = createPureJsImageEntryTargets(
  await readCapabilityManifest('capabilities/manifest.json'),
).filter((row) => row.id === 'codec-jpegxl' || row.id === 'jpegxl-specialized')
if (targets.length !== 2) throw new Error('Both complete public packages are required')
let namespace: unknown
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
  if (!file || built.outputFiles.length !== 1 || typeof target.maxMinifiedBytes !== 'number')
    throw new Error('Complete public package or ceiling missing')
  const path = `${directory}/${target.id}.js`
  await writeFile(path, file.contents, { flag: 'wx' })
  paths.add(path)
  const imported: unknown = await import(pathToFileURL(resolve(path)).href)
  const oldCeiling = target.id === 'codec-jpegxl' ? 545000 : 617000
  packages.push({
    target: target.id,
    path,
    bytes: file.contents.length,
    sha256: hash(file.contents),
    exports: Object.keys(object(imported)).sort(),
    ceiling: target.maxMinifiedBytes,
    withinCeiling: file.contents.length <= target.maxMinifiedBytes,
    oldCeiling,
    withinOldCeiling: file.contents.length <= oldCeiling,
  })
  if (file.contents.length > target.maxMinifiedBytes)
    throw new Error('Complete package exceeds its ceiling')
  if (target.id === 'codec-jpegxl') namespace = imported
}
const create = object(object(namespace).jpegxlCodec).createEncoder
if (typeof create !== 'function') throw new Error('Public encoder missing')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
sharp.concurrency(1)
for (const id of ['im26-1030-diagnostic', 'im26-1416-diagnostic']) {
  const fixture = (await fixtures()).find((row) => row.id === id)
  if (!fixture) throw new Error('Original photo fixture missing')
  const pixels = await raw(fixture),
    input = pixels.data
  if (!(input instanceof Uint8Array) || pixels.channels !== 4)
    throw new Error('Original RGBA8 required')
  const inputPng = `${work}/fixtures/${id}.png`,
    reference = `${directory}/${id}-reference.png`
  if (hash(await sharp(inputPng).ensureAlpha().raw().toBuffer()) !== fixture.rawSha256)
    throw new Error('Scoring source differs from original samples')
  await sharp(inputPng).flatten({ background: 'black' }).png().toFile(reference)
  for (const path of [fixture.source, fixture.raw, inputPng, reference]) paths.add(path)
  const selected = baseline.results.map(object).filter((row) => row.fixture === id)
  if (selected.length === 0 || selected.length > 24)
    throw new Error('Original shared point budget exceeded')
  const settings = new Set<number>()
  for (const expected of selected) {
    const distance = number(expected.distance)
    if (settings.has(distance) || distance < 0.25 || distance > 25)
      throw new Error('Invalid frozen distance')
    settings.add(distance)
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
    const encoded = sink.toUint8Array(),
      elapsedMs = performance.now() - started
    if (
      hash(input) !== fixture.rawSha256 ||
      encoder.managedLiveBytes !== 0 ||
      encoder.managedLiveAllocations !== 0
    )
      throw new Error('Caller storage or ownership changed')
    if (encoded.length !== expected.bytes || hash(encoded) !== expected.encodedSha256)
      throw new Error('Complete frozen photo stream changed')
    const artifact = `${directory}/${id}-${distance}.jxl`
    await writeFile(artifact, encoded, { flag: 'wx' })
    paths.add(artifact)
    let native: Buffer | undefined,
      maximumDecoderError = 0
    const grids: object[] = []
    for (const [decoder, executable, args] of [
      ['native', `${oracle}/djxl`, ['--num_threads=1']],
      ['rust', '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli', ['--num-threads', '1']],
    ] as const) {
      const path = `${artifact}.${decoder}.npy`
      run(executable, [artifact, path, ...args])
      const bytes = await readFile(path),
        start = 10 + bytes.readUInt16LE(8)
      const header = bytes.subarray(10, start).toString('ascii')
      if (
        bytes[6] !== 1 ||
        !header.includes("'<f4'") ||
        !header.includes(`(1, ${fixture.height}, ${fixture.width}, 4)`) ||
        bytes.length !== start + input.length * 4
      )
        throw new Error('Incomplete independent grid')
      for (let sample = 0; sample < input.length; sample++) {
        const value = bytes.readFloatLE(start + sample * 4)
        if (
          !Number.isFinite(value) ||
          ((sample & 3) === 3 && Math.round(value * 255) !== input[sample])
        )
          throw new Error('Nonfinite sample or changed alpha')
        if (native)
          maximumDecoderError = Math.max(
            maximumDecoderError,
            Math.abs(
              Math.round(value * 255) -
                Math.round(native.readFloatLE(10 + native.readUInt16LE(8) + sample * 4) * 255),
            ),
          )
      }
      if (maximumDecoderError > 1) throw new Error('Independent decoders disagree')
      if (decoder === 'native') native = bytes
      paths.add(path)
      paths.add(executable)
      grids.push({
        decoder,
        path,
        sha256: hash(bytes),
        samples: input.length,
        originalAlphaError: 0,
        executableSha256: hash(await readFile(executable)),
      })
    }
    if (!native) throw new Error('Native grid missing')
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    if (
      !decoder ||
      decoder.width !== fixture.width ||
      decoder.height !== fixture.height ||
      decoder.pixelFormat !== 'rgba8'
    )
      throw new Error('Public decoder layout changed')
    const seen = new Uint8Array(fixture.width * fixture.height)
    let maximumPublicError = 0,
      publicPixels = 0
    for await (const block of decoder.decode())
      try {
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < block.width; x++) {
            const pixel = (block.y + y) * fixture.width + block.x + x
            if (seen[pixel] !== 0) throw new Error('Repeated public pixel')
            seen[pixel] = 1
            publicPixels++
            for (let channel = 0; channel < 4; channel++) {
              const value = block.data[y * block.stride + x * 4 + channel] ?? 0
              const expected = Math.max(
                0,
                Math.min(
                  255,
                  Math.round(
                    native.readFloatLE(10 + native.readUInt16LE(8) + (pixel * 4 + channel) * 4) *
                      255,
                  ),
                ),
              )
              maximumPublicError = Math.max(maximumPublicError, Math.abs(value - expected))
              if (channel === 3 && value !== input[pixel * 4 + channel])
                throw new Error('Public alpha changed')
            }
          }
      } finally {
        block.release?.()
      }
    if (publicPixels !== seen.length || maximumPublicError > 1)
      throw new Error('Public pixels disagree')
    const png = `${artifact}.png`,
      black = `${artifact}.black.png`
    run(`${oracle}/djxl`, [artifact, png, '--num_threads=1', '--bits_per_sample=8'])
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (
      decoded.info.width !== fixture.width ||
      decoded.info.height !== fixture.height ||
      decoded.data.length !== input.length
    )
      throw new Error('Metric sample layout changed')
    for (let at = 3; at < input.length; at += 4)
      if (decoded.data[at] !== input[at]) throw new Error('Metric alpha changed')
    await sharp(png).flatten({ background: 'black' }).png().toFile(black)
    const score = Number.parseFloat(run(`${metrics}/ssimulacra2`, [reference, black]))
    const butteraugli = Number.parseFloat(run(`${metrics}/butteraugli_main`, [reference, black]))
    if (
      !Number.isFinite(score) ||
      !Number.isFinite(butteraugli) ||
      score !== expected.score ||
      butteraugli !== expected.butteraugli
    )
      throw new Error('Frozen quality metric changed')
    paths.add(png)
    paths.add(black)
    results.push({
      fixture: id,
      distance,
      bytes: encoded.length,
      score,
      butteraugli,
      artifact,
      encodedSha256: hash(encoded),
      decodedSha256: hash(decoded.data),
      originalAlphaError: 0,
      grids,
      maximumDecoderError,
      maximumPublicError,
      publicPixels,
      ownedPeak: number(encoder.managedPeakBytes),
      ownedLive: 0,
      ownedAllocations: 0,
      elapsedMs,
    })
    console.log(
      JSON.stringify({ fixture: id, distance, bytes: encoded.length, score, butteraugli }),
    )
  }
}
const matchedPhotoBands: (RecoveryBracket & {
  fixture: string
  target: number
  interpolatedBytes: number
})[] = []
for (const fixture of ['im26-1030-diagnostic', 'im26-1416-diagnostic'])
  for (const target of [70, 80, 90]) {
    const points = results
      .filter((row) => row.fixture === fixture)
      .map((row) => ({
        setting: number(row.distance),
        bytes: number(row.bytes),
        score: number(row.score),
      }))
    const bracket = recoveryBracket(points, target),
      interpolatedBytes = interpolateM7Quality(points, target)
    if (!bracket || bracket.width > 0.25 || interpolatedBytes === undefined)
      throw new Error('Original adequate bracket missing')
    matchedPhotoBands.push({ fixture, target, ...bracket, interpolatedBytes })
  }
const matchedFrozenPeerComparisons = peers.matchedFrozenPeerComparisons.map((value) => {
  const peer = object(value)
  const band = matchedPhotoBands.find(
    (row) => row.fixture === peer.fixture && row.target === peer.target,
  )
  if (!band || number(peer.frozenPeerWidth) > 0.25) throw new Error('Frozen peer bracket differs')
  const ratio = band.interpolatedBytes / number(peer.frozenPeerBytes)
  if (ratio > 1) throw new Error('Measured photo compression gap remains')
  return { ...peer, interpolatedBytes: band.interpolatedBytes, ratio }
})
for (const path of [`${metrics}/ssimulacra2`, `${metrics}/butteraugli_main`]) paths.add(path)
validateImplementationIdentity(await implementationIdentity(), identity)
const pins = []
for (const path of paths) pins.push({ path, sha256: hash(await readFile(path)) })
await json(output, {
  ...identity,
  completed: true,
  sourceAdopted: true,
  baselinePath,
  packages,
  results,
  matchedPhotoBands,
  matchedFrozenPeerComparisons,
  maximumPointsPerPhoto: 24,
  scoreTolerance: 0.25,
  extrapolation: false,
  publicComparisonCountsChanged: false,
  fullParity: false,
  competitorSpeedQualified: false,
  pins,
  policy:
    'Fresh complete production packages and all 34 original photo points, with every complete native/Rust grid, public JavaScript pixel and both quality metrics. Preserve all score inversions, original alpha, caller storage and closed ownership. Recompute six nondominated log-byte matches under the original 0.25-score width policy and retain twelve exact frozen peer brackets. The preceding private 0.05-width attempt exhausted the shared 24-point budget on the second photo; its null result remains untouched. Original wider-policy qualification is reported separately. Package ceilings increase explicitly; no runtime dependencies, release, speed/RSS parity or universal lossy claim. Other comparator rows and 13 adequate/11 unresolved totals stay unchanged.',
})
