import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { inspectJpegXl } from '../../../src/jpegxl.ts'
import { hashM8Sources } from '../m8-output-digest.ts'
import { fixtures, hash, json, raw, run } from './io.ts'
import { object, string } from './model.ts'

// Verify one isolated encoder observation; timings and RSS exclude both independent decoders.
const [fixtureId, artifact, measurementLog, output] = process.argv.slice(2)
if (!fixtureId || !artifact || !measurementLog || !output)
  throw new Error(
    'Usage: verify-lossless-parity.ts fixture-id encoded.jxl measurement.log output.json',
  )
const fixture = (await fixtures()).find((entry) => entry.id === fixtureId)
if (!fixture) throw new Error('Unknown pinned fixture')
const expected = await raw(fixture)
if (!(expected.data instanceof Uint8Array) || expected.channels !== 4)
  throw new Error('This verifier requires the pinned RGBA8 sample contract')
const lines = (await readFile(measurementLog, 'utf8'))
  .split('\n')
  .filter((line) => line.startsWith('{'))
if (lines.length !== 1) throw new Error('Expected one isolated measurement')
const measurement = object(JSON.parse(lines[0] ?? ''))
const sourceSha256 = await hashM8Sources()
const encoded = await readFile(artifact)
if (
  measurement.implementationSourceSha256 !== sourceSha256 ||
  measurement.outputSha256 !== hash(encoded)
)
  throw new Error('Candidate source or encoded artifact identity changed')
if (measurement.inputSha256 !== hash(expected.data) || measurement.format !== 'rgba8')
  throw new Error('Measurement used different input samples')
const structure = await inspectJpegXl(encoded)
if (structure.alphaChannels !== 1) throw new Error('Alpha channel was dropped')
sharp.concurrency(1)
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const oracles = []
for (const oracle of [
  { name: 'libjxl', executable: `${tools}/djxl`, args: ['--num_threads=1', '--bits_per_sample=8'] },
  { name: 'jxl-rs', executable: rust, args: ['--num-threads', '1'] },
]) {
  const decodedPath = `${artifact}.${oracle.name}.png`
  run(oracle.executable, [artifact, decodedPath, ...oracle.args])
  const decoded = await sharp(decodedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (
    decoded.info.width !== fixture.width ||
    decoded.info.height !== fixture.height ||
    decoded.info.channels !== 4 ||
    !decoded.data.equals(expected.data)
  )
    throw new Error(`${oracle.name} did not reproduce every original sample`)
  oracles.push({
    oracle: oracle.name,
    executableSha256: hash(await readFile(oracle.executable)),
    decodedRgbaSha256: hash(decoded.data),
    maximumSampleError: 0,
    samplesCompared: expected.data.length,
  })
}
await json(output, {
  schemaVersion: 1,
  fixture: fixture.id,
  sourceSha256: fixture.sourceSha256,
  implementationSourceSha256: sourceSha256,
  measurementHarnessSha256: hash(
    await readFile(new URL('../measure-m7-lossless.ts', import.meta.url)),
  ),
  verifierSha256: hash(await readFile(import.meta.filename)),
  artifact,
  encodedSha256: hash(encoded),
  bytes: encoded.length,
  measurement,
  containerOverheadBytes: encoded.length - structure.codestreamBytes,
  oracles,
  status: 'verified',
  comparisonInput: 'identical pinned RGBA8, including hidden color and alpha',
  timingScope:
    'Single isolated observation, not a speed comparison. Encoder core and output exclude input preparation and independent decoding.',
  runtime: string(measurement.runtime),
})
console.log(`${fixture.id}: ${encoded.length} bytes; exact in libjxl and jxl-rs`)
