import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { encodeJpegXlAlphaEntropyFixture } from '../../../tests/helpers/jpegxl-alpha-entropy.ts'
import { hash, implementationIdentity, json, oracle, run, work } from './io.ts'
import { number, object, string, validateImplementationIdentity } from './model.ts'

const [
  output,
  baselinePath = 'benchmark/jpegxl/comparison/results/alpha-palette-native-baseline.json',
] = process.argv.slice(2)
if (!output) throw new Error('Specify an alpha palette verification report path')
const baseline = object(JSON.parse(await readFile(baselinePath, 'utf8')))
if (!Array.isArray(baseline.results) || baseline.results.length !== 14)
  throw new Error('Complete frozen alpha baseline required')
const identity = await implementationIdentity()
const directory = `${work}/alpha-palette-verification/${basename(output, '.json')}`
await mkdir(directory, { recursive: true })
const results: object[] = []
let independentSamples = 0
for (const value of baseline.results) {
  const expected = object(value)
  const depth = number(expected.depth)
  if (
    (depth !== 8 && depth !== 16) ||
    typeof expected.progressive !== 'boolean' ||
    typeof expected.grouped !== 'boolean' ||
    !Array.isArray(expected.grids)
  )
    throw new Error('Invalid baseline case')
  const dimensions = expected.dimensions === undefined ? undefined : object(expected.dimensions)
  const fixture = await encodeJpegXlAlphaEntropyFixture(
    depth,
    expected.progressive,
    expected.grouped,
    number(expected.budget),
    'triangles',
    dimensions ? { width: number(dimensions.width), height: number(dimensions.height) } : undefined,
  )
  if (fixture.encoded.length > number(expected.bytes)) throw new Error('Complete alpha file grew')
  const artifact = `${directory}/${number(expected.index)}.jxl`
  await writeFile(artifact, fixture.encoded)
  const grids: object[] = []
  for (const [decoder, executable, args] of [
    ['native', `${oracle}/djxl`, ['--num_threads=1']],
    ['rust', '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli', ['--num-threads', '1']],
  ] as const) {
    const path = `${artifact}.${decoder}.npy`
    run(executable, [artifact, path, ...args])
    const bytes = await readFile(path),
      start = 10 + bytes.readUInt16LE(8),
      header = bytes.subarray(10, start).toString('ascii')
    const samples = fixture.width * fixture.height * 4
    if (
      bytes[6] !== 1 ||
      !header.includes("'<f4'") ||
      !header.includes(`(1, ${fixture.height}, ${fixture.width}, 4)`) ||
      bytes.length !== start + samples * 4
    )
      throw new Error('Incomplete independent alpha grid')
    const input = new DataView(fixture.pixels.buffer)
    for (let sample = 0; sample < samples; sample++) {
      const value = bytes.readFloatLE(start + sample * 4)
      if (!Number.isFinite(value)) throw new Error('Nonfinite decoded sample')
      if ((sample & 3) === 3) {
        const alpha = depth === 8 ? input.getUint8(sample) : input.getUint16(sample * 2)
        if (Math.round(value * (2 ** depth - 1)) !== alpha) throw new Error('Alpha sample changed')
      }
    }
    const original = expected.grids.map(object).find((row) => row.decoder === decoder)
    const checksum = hash(bytes)
    if (!original || checksum !== string(original.sha256))
      throw new Error('Complete independently decoded colors changed')
    independentSamples += samples
    grids.push({
      decoder,
      path,
      sha256: checksum,
      samples,
      executableSha256: hash(await readFile(executable)),
      alphaExact: true,
      baselineGridIdentical: true,
    })
  }
  results.push({
    index: expected.index,
    depth,
    progressive: expected.progressive,
    grouped: expected.grouped,
    dimensions: expected.dimensions ?? null,
    budget: expected.budget,
    inputSha256: hash(fixture.pixels),
    bytes: fixture.encoded.length,
    originalBytes: expected.bytes,
    artifact,
    encodedSha256: hash(fixture.encoded),
    grids,
  })
  console.log(
    `${number(expected.index)}: full native/Rust grids unchanged, ${fixture.encoded.length} bytes`,
  )
}
validateImplementationIdentity(await implementationIdentity(), identity)
await json(output, {
  ...identity,
  completed: true,
  sourceAdopted: true,
  baselinePath,
  baselineSha256: hash(await readFile(baselinePath)),
  harnessSha256: hash(await readFile(import.meta.filename)),
  fixtureSha256: hash(await readFile('tests/helpers/jpegxl-alpha-entropy.ts')),
  completeIndependentGrids: results.length * 2,
  independentSamples,
  completeFilesNeverGrow: true,
  results,
  policy:
    'Frozen pre-change full native/Rust Float32 grids, exact 8/16-bit alpha, hidden colors, progressive and partial edge groups, two DC groups, prefix/ANS geometry and the original low working budget. Every independently decoded byte must equal the frozen baseline. The optional search may only shrink complete files.',
})
