import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  encodeJpegXlLargeBlocks,
  verifyJpegXlLargeBlocks,
} from '../../../tests/helpers/jpegxl-large-blocks.ts'
import { hash, implementationIdentity, json, oracle, run, work } from './io.ts'
import { number, object, string, validateImplementationIdentity } from './model.ts'

const [
  output,
  baselinePath = 'benchmark/jpegxl/comparison/results/photo-transform-native-baseline.json',
] = process.argv.slice(2)
if (!output) throw new Error('Specify a photo transform verification report path')
const baseline = object(JSON.parse(await readFile(baselinePath, 'utf8')))
if (!Array.isArray(baseline.results) || baseline.results.length !== 6)
  throw new Error('All six original boundary definitions required')
const identity = await implementationIdentity()
const directory = `${work}/photo-transform-verification/${basename(output, '.json')}`
await mkdir(directory, { recursive: true })
const paths = new Set([import.meta.filename, baselinePath, 'tests/helpers/jpegxl-large-blocks.ts'])
const results: object[] = []
for (const value of baseline.results) {
  const expected = object(value)
  if (typeof expected.progressive !== 'boolean' || !Array.isArray(expected.grids))
    throw new Error('Invalid original boundary')
  const width = number(expected.width),
    height = number(expected.height),
    budget = number(expected.budget)
  const fixture = await encodeJpegXlLargeBlocks(width, height, budget, expected.progressive)
  if (
    hash(fixture.pixels) !== expected.inputSha256 ||
    hash(fixture.encoded) !== expected.encodedSha256 ||
    fixture.encoded.length !== expected.bytes ||
    fixture.ownedPeak > budget
  )
    throw new Error('Complete boundary stream, input or budget changed')
  const artifact = `${directory}/${string(expected.id)}.jxl`
  await writeFile(artifact, fixture.encoded, { flag: 'wx' })
  paths.add(artifact)
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
      !header.includes(`(1, ${height}, ${width}, 4)`) ||
      bytes.length !== start + fixture.pixels.length * 4
    )
      throw new Error('Incomplete boundary grid')
    for (let sample = 0; sample < fixture.pixels.length; sample++) {
      const value = bytes.readFloatLE(start + sample * 4)
      if (
        !Number.isFinite(value) ||
        ((sample & 3) === 3 && Math.round(value * 255) !== fixture.pixels[sample])
      )
        throw new Error('Nonfinite boundary sample or changed alpha')
    }
    const original = expected.grids.map(object).find((row) => row.decoder === decoder)
    if (!original || hash(bytes) !== original.sha256)
      throw new Error('Full independent colors changed')
    paths.add(path)
    paths.add(executable)
    grids.push({
      decoder,
      path,
      sha256: hash(bytes),
      samples: fixture.pixels.length,
      executableSha256: hash(await readFile(executable)),
      alphaExact: true,
      baselineGridIdentical: true,
    })
  }
  const publicOutput = await verifyJpegXlLargeBlocks(width, height, budget, expected.progressive)
  if (publicOutput.alphaError !== 0 || publicOutput.samples !== width * height * 3)
    throw new Error('Public decoder omitted pixels or changed alpha')
  results.push({
    id: expected.id,
    width,
    height,
    budget,
    progressive: expected.progressive,
    artifact,
    bytes: fixture.encoded.length,
    originalBytes: expected.originalBytes,
    encodedSha256: hash(fixture.encoded),
    inputSha256: hash(fixture.pixels),
    ownedPeak: fixture.ownedPeak,
    grids,
    publicOutput,
  })
  console.log(`${string(expected.id)}: complete native/Rust colors and exact alpha verified`)
}
validateImplementationIdentity(await implementationIdentity(), identity)
const pins = []
for (const path of paths) pins.push({ path, sha256: hash(await readFile(path)) })
await json(output, {
  ...identity,
  completed: true,
  sourceAdopted: true,
  baselinePath,
  results,
  pins,
  completeFiles: 6,
  completeIndependentGrids: 12,
  fullParity: false,
  policy:
    'Fresh production encodes preserve all original deterministic inputs and expected complete encoded hashes. Compare every native/Rust sample with the frozen candidate grids; retain exact alpha and closed ownership for partial groups, both orientations across two DC groups, progressive output and the original 797262-byte minimum. Raw streams and NPY grids stay ignored. Public JavaScript output is separately checked, without a perceptual photo or speed claim.',
})
