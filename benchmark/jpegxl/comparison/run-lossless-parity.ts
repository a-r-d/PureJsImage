import { readFile } from 'node:fs/promises'
import { inspectJpegXl } from '../../../src/jpegxl.ts'
import { fixtures, hash, implementationIdentity, json, oracle, raw, root, run, work } from './io.ts'
import { object, string, validateImplementationIdentity } from './model.ts'

const output = process.argv[2]
const effort = Number(process.argv[3] ?? 1)
if (!output || ![1, 3, 5, 7].includes(effort))
  throw new Error('Specify report path and effort 1/3/5/7')
const directory = `${work}/parity-public-e${effort}`
const identity = await implementationIdentity()
const baseline = object(JSON.parse(await readFile(`${root}/results/main-node.json`, 'utf8')))
if (!Array.isArray(baseline.rows)) throw new Error('Missing pinned comparison rows')
const priorRows = baseline.rows.map(object)
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const rows: Record<string, unknown>[] = []
const report = () =>
  json(output, {
    schemaVersion: 1,
    ...identity,
    runtime: process.version,
    effort,
    fixturesSha256: hashFixtureManifest,
    publicWorkerSha256: hashWorker,
    builtModularEncoderSha256: hashBuiltEncoder,
    harnessSha256: hashHarness,
    policy: `All 16 pinned inputs through rebuilt public package entry points at effort ${effort}, preserving native uint8/uint16 samples, hidden color and alpha. Timings are isolated observations; independent validation is excluded.`,
    rows,
  })
const hashFixtureManifest = hash(await readFile(`${root}/fixtures.json`))
const hashWorker = hash(await readFile(`${root}/node-worker.ts`))
const hashBuiltEncoder = hash(await readFile('dist/codecs/jpegxl-modular-encode.js'))
const hashHarness = hash(await readFile(import.meta.filename))
for (const fixture of await fixtures()) {
  const pixels = await raw(fixture)
  if (pixels.data instanceof Float32Array) throw new Error('Explicit float probe required')
  const prefix = `${directory}/${fixture.id}`
  const config = `${prefix}.job.json`
  await json(config, {
    subject: 'purejsimage',
    operation: 'encode',
    fixture,
    settings: { lossless: true, effort, value: 1 },
    repeats: 0,
    output: prefix,
  })
  run(process.execPath, [`${root}/node-worker.ts`, config])
  const measurement = object(JSON.parse(await readFile(`${prefix}.json`, 'utf8')))
  if (measurement.status !== 'verified') throw new Error(`Encode failed: ${fixture.id}`)
  const artifact = `${prefix}.bin`
  const encoded = await readFile(artifact)
  const descriptor = object(measurement.output)
  if (descriptor.sha256 !== hash(encoded)) throw new Error('Output identity changed')
  const maximum = pixels.data instanceof Uint16Array ? 65535 : 255
  const oracles = []
  for (const engine of [
    { name: 'libjxl', executable: `${oracle}/djxl`, args: ['--num_threads=1'] },
    { name: 'jxl-rs', executable: rust, args: ['--num-threads', '1'] },
  ]) {
    const decodedPath = `${prefix}.${engine.name}.npy`
    run(engine.executable, [artifact, decodedPath, ...engine.args])
    const npy = await readFile(decodedPath)
    if (npy[6] !== 1) throw new Error('Expected NPY version 1')
    const start = 10 + npy.readUInt16LE(8)
    const header = npy.subarray(10, start).toString('ascii')
    if (
      !header.includes("'<f4'") ||
      !header.includes(`(1, ${pixels.height}, ${pixels.width}, ${pixels.channels})`) ||
      npy.length !== start + pixels.data.length * 4
    )
      throw new Error(`Unexpected independent layout: ${fixture.id}: ${header}`)
    for (let sample = 0; sample < pixels.data.length; sample++) {
      const value = npy.readFloatLE(start + sample * 4)
      if (!Number.isFinite(value) || Math.round(value * maximum) !== pixels.data[sample])
        throw new Error(`${engine.name}: ${fixture.id} sample ${sample} changed`)
    }
    oracles.push({
      oracle: engine.name,
      executableSha256: hash(await readFile(engine.executable)),
      normalizedFloatSha256: hash(npy),
      samplesCompared: pixels.data.length,
      maximumSampleError: 0,
    })
  }
  const previous = priorRows.find(
    (row) => row.key === `${fixture.id}-purejsimage-encode-ll-e${effort}`,
  )
  const previousOutput = previous ? object(previous.output) : undefined
  const structure = await inspectJpegXl(encoded)
  const publicSourceMatchesDirectObservation =
    effort === 1 && (fixture.id === 'im26-1416-original' || fixture.id === 'im26-8160-original')
      ? hash(encoded) ===
        object(
          JSON.parse(
            await readFile(
              `${root}/results/${fixture.id === 'im26-1416-original' ? 'parity-effort1-photo' : 'parity-effort1-screenshot'}.json`,
              'utf8',
            ),
          ),
        ).encodedSha256
      : null
  if (publicSourceMatchesDirectObservation === false)
    throw new Error('Public/source encoder bytes differ')
  validateImplementationIdentity(await implementationIdentity(), identity)
  if (hash(await readFile('dist/codecs/jpegxl-modular-encode.js')) !== hashBuiltEncoder)
    throw new Error('Built encoder changed during the comparison')
  rows.push({
    fixture: fixture.id,
    format: pixels.data instanceof Uint16Array ? 'uint16' : 'uint8',
    sourceSha256: fixture.sourceSha256,
    inputSha256: fixture.rawSha256,
    artifact,
    bytes: encoded.length,
    encodedSha256: hash(encoded),
    previousBytes: previousOutput?.bytes ?? null,
    unchangedFromPrevious: previousOutput ? string(previousOutput.sha256) === hash(encoded) : null,
    publicSourceMatchesDirectObservation,
    measurement,
    containerOverheadBytes: encoded.length - structure.codestreamBytes,
    oracles,
    status: 'verified',
  })
  await report()
  console.log(`${fixture.id}: ${encoded.length} bytes; exact in both independent decoders`)
}
