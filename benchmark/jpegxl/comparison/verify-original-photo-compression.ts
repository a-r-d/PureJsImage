import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createPureJsImageEntryTargets } from '../../../scripts/bundle-size-config.ts'
import { readCapabilityManifest } from '../../../scripts/capability-manifest.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { Uint8ArraySink } from '../../../src/sink.ts'
import { fixtures, hash, implementationIdentity, json, raw, work } from './io.ts'
import { number, object, string, validateImplementationIdentity } from './model.ts'
import {
  originalLossyBands,
  originalLossyPoint,
  originalLossySelected,
} from './original-lossy-bands.ts'

const [output] = process.argv.slice(2)
if (!output) throw new Error('Specify an original-photo compression report path')
const studyPath = 'benchmark/jpegxl/comparison/results/original-photo-quality-study.json'
const qualificationPath =
  'benchmark/jpegxl/comparison/results/original-photo-endpoint-qualification.json'
const precedingPath = 'benchmark/jpegxl/comparison/results/photo-parity-production-controls.json'
const study = object(JSON.parse(await readFile(studyPath, 'utf8')))
const qualification = object(JSON.parse(await readFile(qualificationPath, 'utf8')))
const preceding = object(JSON.parse(await readFile(precedingPath, 'utf8')))
if (
  study.maximumPointsPerSubjectFixture !== 24 ||
  study.maximumSsimBracketWidth !== 0.25 ||
  study.maximumButteraugliBracketWidth !== 0.25 ||
  !Array.isArray(study.results) ||
  qualification.completed !== true ||
  !Array.isArray(qualification.proof) ||
  !Array.isArray(qualification.pins) ||
  !Array.isArray(qualification.prototypeModules) ||
  !Array.isArray(qualification.expectedProductionPackages) ||
  !Array.isArray(preceding.packages)
)
  throw new Error('Complete original studies and unchanged quarter-score protocol required')
const sourcePaths = ['src/codecs/jpegxl-vardct-encode.ts', 'src/codecs/jpegxl-jpeg-encode.ts']
const modules = qualification.prototypeModules.map(object)
if (
  hash(modules.map((row) => string(row.sha256)).join(':')) !==
    qualification.candidateSourceSha256 ||
  qualification.candidateSourceSha256 !== study.candidateSourceSha256
)
  throw new Error('Qualified compression source identity differs')
const fileHash = async (path: string) => {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path, { highWaterMark: 65_536 })) {
    if (!(chunk instanceof Uint8Array)) throw new Error('Unexpected evidence chunk')
    digest.update(chunk)
  }
  return digest.digest('hex')
}
const identity = await implementationIdentity()
const directory = `${work}/original-photo-packages/${basename(output, '.json')}`
await mkdir(directory, { recursive: true })
const paths = new Set([
  import.meta.filename,
  studyPath,
  qualificationPath,
  precedingPath,
  ...sourcePaths,
  'scripts/bundle-size-config.ts',
  'scripts/bundle-size-budgets.ts',
  'capabilities/manifest.json',
])
// Reuse complete independent pixels only after every physical evidence pin is rehashed.
for (const value of qualification.pins) {
  const pin = object(value),
    path = string(pin.path)
  if ((await fileHash(path)) !== pin.sha256) throw new Error('Qualified original pixel pin drift')
  paths.add(path)
}
const fixture = (await fixtures()).find((row) => row.id === 'im26-1416-original')
if (fixture?.width !== 4000 || fixture.height !== 3000 || fixture.scope !== 'original')
  throw new Error('Unresized original 12 MP photo required')
const pixels = await raw(fixture)
if (!(pixels.data instanceof Uint8Array) || pixels.channels !== 4)
  throw new Error('Original RGBA8 required')
const input = pixels.data
for (let at = 3; at < input.length; at += 4)
  if (input[at] !== 255) throw new Error('Original photo alpha changed')
for (const path of [fixture.raw, fixture.source]) paths.add(path)
if (hash(await readFile(fixture.source)) !== fixture.sourceSha256)
  throw new Error('Original photo source changed')
const proof = qualification.proof.map(object)
const selectedKeys = new Set<string>()
for (const point of proof) {
  if (
    !Array.isArray(point.grids) ||
    point.grids.length !== 2 ||
    point.alphaExact !== true ||
    number(point.maximumIndependentError) > 1 ||
    number(point.maximumMetricError) > 1 ||
    (point.subject === 'purejsimage' &&
      (point.publicSamples !== input.length || number(point.maximumPublicError) > 1))
  )
    throw new Error('Complete independent endpoint semantics missing')
  const encoded = await readFile(string(point.artifact))
  if (encoded.length !== point.bytes || hash(encoded) !== point.artifactSha256)
    throw new Error('Qualified endpoint stream changed')
  const key = `${string(point.subject)}:${number(point.setting)}`
  if (selectedKeys.has(key)) throw new Error('Duplicate qualified endpoint')
  selectedKeys.add(key)
}
const studyResults = study.results
const results = ['purejsimage', 'jsquash', 'vips'].map((subject) => {
  const row = studyResults.map(object).find((value) => value.subject === subject)
  if (
    !row ||
    row.fixture !== fixture.id ||
    row.inputSha256 !== fixture.rawSha256 ||
    row.sourceSha256 !== fixture.sourceSha256 ||
    !Array.isArray(row.points) ||
    row.points.length > 24 ||
    !Array.isArray(row.bands)
  )
    throw new Error('Original public-API participant or fixed sample budget differs')
  const points = row.points.map(originalLossyPoint)
  if (
    new Set(points.map((point) => point.setting)).size !== points.length ||
    number(row.totalAttempts) < points.length ||
    number(row.totalAttempts) > 24
  )
    throw new Error('Original attempted settings differ')
  for (const metric of ['ssimulacra2', 'butteraugli'] as const) {
    const saved = metric === 'ssimulacra2' ? row.bands : row.butteraugliBands
    const bands = originalLossyBands(points, metric)
    if (
      JSON.stringify(saved) !== JSON.stringify(bands) ||
      ((subject !== 'vips' || metric === 'ssimulacra2') &&
        bands.some((band) => band.status !== 'adequate bracket'))
    )
      throw new Error('Independently reconstructed original frontier differs')
  }
  for (const expected of originalLossySelected(points)) {
    if (
      !proof.some(
        (point) =>
          point.subject === subject &&
          point.setting === expected.setting &&
          point.artifactSha256 === expected.artifactSha256 &&
          point.bytes === expected.bytes &&
          point.decodedSha256 === expected.decodedSha256 &&
          point.score === expected.score &&
          point.butteraugli === expected.butteraugli,
      )
    )
      throw new Error('Matched original endpoint lacks exact independent qualification')
    selectedKeys.delete(`${subject}:${expected.setting}`)
  }
  return row
})
if (selectedKeys.size !== 0) throw new Error('Qualification contains unselected endpoints')
const packages: object[] = []
let namespace: unknown
const targets = createPureJsImageEntryTargets(
  await readCapabilityManifest('capabilities/manifest.json'),
).filter((row) => row.id === 'codec-jpegxl' || row.id === 'jpegxl-specialized')
if (targets.length !== 2) throw new Error('Both complete public packages required')
const precedingPackages = preceding.packages.map(object)
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
  if (
    !file ||
    built.outputFiles.length !== 1 ||
    typeof target.maxMinifiedBytes !== 'number' ||
    file.contents.length > target.maxMinifiedBytes
  )
    throw new Error('Complete package exceeds its declared ceiling')
  const expectedPackage = qualification.expectedProductionPackages
    .map(object)
    .find((row) => row.target === target.id)
  if (
    !expectedPackage ||
    expectedPackage.bytes !== file.contents.length ||
    expectedPackage.sha256 !== hash(file.contents)
  )
    throw new Error('Production package differs from independently qualified candidate package')
  const path = `${directory}/${target.id}.js`
  await writeFile(path, file.contents, { flag: 'wx' })
  const imported: unknown = await import(pathToFileURL(resolve(path)).href)
  const exports = Object.keys(object(imported)).sort()
  const previous = precedingPackages.find((row) => row.target === target.id)
  if (!previous || JSON.stringify(exports) !== JSON.stringify(previous.exports))
    throw new Error('Complete public export set differs')
  packages.push({
    target: target.id,
    path,
    bytes: file.contents.length,
    sha256: hash(file.contents),
    exports,
    ceiling: target.maxMinifiedBytes,
    precedingBytes: previous.bytes,
    qualifiedCandidateSha256: expectedPackage.sha256,
    withinCeiling: true,
  })
  paths.add(path)
  if (target.id === 'codec-jpegxl') namespace = imported
}
const create = object(object(namespace).jpegxlCodec).createEncoder
if (typeof create !== 'function') throw new Error('Complete public encoder missing')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const selected = proof.filter((row) => row.subject === 'purejsimage')
if (selected.length !== qualification.selectedCandidateEndpoints)
  throw new Error('All selected original target endpoints required')
const ownership: object[] = []
for (const expected of selected) {
  const distance = number(expected.setting),
    sink = new Uint8ArraySink(),
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
  const encoded = sink.toUint8Array()
  if (
    hash(input) !== fixture.rawSha256 ||
    encoder.managedLiveBytes !== 0 ||
    encoder.managedLiveAllocations !== 0 ||
    typeof encoder.managedPeakBytes !== 'number'
  )
    throw new Error('Original caller or managed ownership changed')
  if (encoded.length !== expected.bytes || hash(encoded) !== expected.artifactSha256)
    throw new Error('Current complete public stream differs from independently qualified stream')
  const artifact = `${directory}/original-${distance}.jxl`
  await writeFile(artifact, encoded, { flag: 'wx' })
  paths.add(artifact)
  const row = {
    distance,
    bytes: encoded.length,
    encodedSha256: hash(encoded),
    artifact,
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: 0,
    ownedAllocations: 0,
    callerSha256: hash(input),
    elapsedMs: performance.now() - started,
    independentGridReference: string(expected.artifact),
  }
  ownership.push(row)
  console.log(JSON.stringify(row))
}
const pure = results.find((row) => row.subject === 'purejsimage')
if (!pure || !Array.isArray(pure.bands)) throw new Error('Production bands missing')
const pureBands = pure.bands.map(object)
const comparisons: object[] = []
const butteraugliComparisons: object[] = []
for (const peer of results) {
  if (peer.subject === 'purejsimage') continue
  if (!Array.isArray(peer.bands)) throw new Error('Peer bands missing')
  for (const target of [70, 80, 90]) {
    const ours = pureBands.find((row) => row.target === target)
    const theirs = peer.bands.map(object).find((row) => row.target === target)
    if (!ours || !theirs) throw new Error('Original target band missing')
    comparisons.push({
      target,
      comparator: peer.subject,
      status: 'adequate bracket',
      pure: ours,
      peer: theirs,
      ratio: number(ours.interpolatedBytes) / number(theirs.interpolatedBytes),
    })
  }
  if (!Array.isArray(pure.butteraugliBands) || !Array.isArray(peer.butteraugliBands))
    throw new Error('Butteraugli frontiers missing')
  for (const target of [0.5, 1, 2, 3]) {
    const ours = pure.butteraugliBands.map(object).find((row) => row.target === target)
    const theirs = peer.butteraugliBands.map(object).find((row) => row.target === target)
    if (!ours || !theirs) throw new Error('Original Butteraugli target band missing')
    const adequate = ours.status === 'adequate bracket' && theirs.status === 'adequate bracket'
    butteraugliComparisons.push({
      metric: 'butteraugli',
      target,
      comparator: peer.subject,
      status: adequate ? 'adequate bracket' : 'unresolved',
      pure: ours,
      peer: theirs,
      ratio: adequate ? number(ours.interpolatedBytes) / number(theirs.interpolatedBytes) : null,
    })
  }
}
validateImplementationIdentity(await implementationIdentity(), identity)
const pins: object[] = []
for (const path of paths) pins.push({ path, sha256: await fileHash(path) })
await json(output, {
  ...identity,
  completed: true,
  sourceAdopted: true,
  fixture: fixture.id,
  inputSha256: fixture.rawSha256,
  sourceSha256: fixture.sourceSha256,
  inputGeometry: { width: fixture.width, height: fixture.height },
  scope: 'original',
  study: studyPath,
  qualification: qualificationPath,
  qualifiedCandidateSourceSha256: qualification.candidateSourceSha256,
  qualifiedModules: modules,
  packages,
  results,
  proof: proof.map((row) => ({ ...row, freshlyDecoded: false, reusedQualifiedEndpoint: true })),
  ownership,
  comparisons,
  butteraugliComparisons,
  pins,
  scoreTolerance: 0.25,
  butteraugliTolerance: 0.25,
  maximumPointsPerSubjectFixture: 24,
  freshEncodedFiles: ownership.length,
  freshCompleteIndependentGrids: 0,
  reusedQualifiedIndependentGrids: proof.length * 2,
  freshPublicDecodedSamples: 0,
  reusedQualifiedPublicDecodedSamples: selected.length * input.length,
  fullParity: false,
  secondaryMetricDominance: false,
  extrapolation: false,
  publicComparisonCountsChanged: false,
  policy:
    'Original unresized12MPphoto, unchanged input, public WASM peer APIs and shared24attemptbudget. Independently reconstruct both metric frontiers, quarter-unit brackets and log-byte estimates without extrapolation. Stream-rehash every physical selected native/Rust grid, metric PNG and qualification pin. Both complete production packages must be byte-identical to independently qualified candidate packages, retain all exports and satisfy their explicit canonical ceilings. Freshly encode every selected candidate endpoint and require exact qualified bytes, unchanged callers and zero ownership. Count reused grids separately from fresh encodes. Retain both unresolved coarser wasm-vips Butteraugli bands and raw failures; native encoder bytes never substitute. Separate per-metric parity does not establish joint two-metric dominance, universal compression parity, speed or process-RSS parity.',
})
