import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { encodeJpegXlAlphaEntropyFixture } from '../../../tests/helpers/jpegxl-alpha-entropy.ts'
import { hash, implementationIdentity, json, oracle, run, work } from './io.ts'
import { object, string, validateImplementationIdentity } from './model.ts'

const [output, baselinePath] = process.argv.slice(2)
if (!output) throw new Error('Specify an alpha verification report path and optional baseline')
const expected = new Map<string, Map<string, string>>()
if (baselinePath) {
  const parsed: unknown = JSON.parse(await readFile(baselinePath, 'utf8'))
  const report = object(parsed)
  const baseline = report.nativeFixtures === undefined ? report : object(report.nativeFixtures)
  if (!Array.isArray(baseline.results)) throw new Error('Missing baseline fixture results')
  for (const value of baseline.results) {
    const row = object(value)
    if (!Array.isArray(row.decoders)) throw new Error('Missing baseline decoders')
    const decoders = new Map<string, string>()
    for (const value of row.decoders) {
      const decoder = object(value)
      if (!Array.isArray(decoder.normalizedHashes)) throw new Error('Missing baseline pixel hashes')
      decoders.set(string(decoder.name), string(decoder.normalizedHashes[0]))
    }
    expected.set(string(row.key), decoders)
  }
}
const identity = await implementationIdentity()
const directory = `${work}/alpha-verification/${basename(output, '.json')}`
await mkdir(directory, { recursive: true })
const results = []
for (const pattern of ['levels', 'binary-bands'] as const)
  for (const depth of [8, 16] as const)
    for (const progressive of [false, true])
      for (const grouped of [false, true]) {
        const fixture = await encodeJpegXlAlphaEntropyFixture(
          depth,
          progressive,
          grouped,
          16_777_216,
          pattern,
        )
        const key = `${depth}-${progressive}-${grouped}${pattern === 'levels' ? '' : '-binary-bands'}`
        const artifact = `${directory}/${key}.jxl`
        await writeFile(artifact, fixture.encoded)
        const decoders = []
        for (const decoder of [
          { name: 'libjxl', executable: `${oracle}/djxl`, args: ['--num_threads=1'] },
          {
            name: 'jxl-rs',
            executable: '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli',
            args: ['--num-threads', '1'],
          },
        ]) {
          const path = `${artifact}.${decoder.name}.npy`
          run(decoder.executable, [artifact, path, ...decoder.args])
          const npy = await readFile(path)
          if (npy[6] !== 1) throw new Error('Expected NPY version 1')
          const start = 10 + npy.readUInt16LE(8)
          const header = npy.subarray(10, start).toString('ascii')
          if (
            !header.includes("'<f4'") ||
            !header.includes(`(1, ${fixture.height}, ${fixture.width}, 4)`) ||
            npy.length !== start + fixture.width * fixture.height * 16
          )
            throw new Error('Unexpected independent alpha fixture layout')
          const input = new DataView(fixture.pixels.buffer)
          const maximum = 2 ** depth - 1
          for (let sample = 3; sample < fixture.width * fixture.height * 4; sample += 4) {
            const alpha = depth === 8 ? input.getUint8(sample) : input.getUint16(sample * 2)
            const actual = npy.readFloatLE(start + sample * 4)
            if (!Number.isFinite(actual) || Math.round(actual * maximum) !== alpha)
              throw new Error(`${decoder.name}: changed alpha sample ${sample}`)
          }
          const normalizedHash = hash(npy)
          if (baselinePath && expected.get(key)?.get(decoder.name) !== normalizedHash)
            throw new Error(`${decoder.name}: decoded color grid differs from baseline for ${key}`)
          decoders.push({
            name: decoder.name,
            executableSha256: hash(await readFile(decoder.executable)),
            normalizedHashes: [normalizedHash],
            exactAlphaSamples: fixture.width * fixture.height,
          })
        }
        results.push({
          key,
          depth,
          progressive,
          grouped,
          pattern,
          inputSha256: hash(fixture.pixels),
          currentBytes: fixture.encoded.length,
          currentSha256: hash(fixture.encoded),
          decoders,
        })
        validateImplementationIdentity(await implementationIdentity(), identity)
        console.log(`${key}: exact alpha in both independent decoders`)
      }
await json(output, {
  ...identity,
  harnessSha256: hash(await readFile(import.meta.filename)),
  fixtureSha256: hash(await readFile('tests/helpers/jpegxl-alpha-entropy.ts')),
  policy:
    'Exact native 8/16-bit alpha at five levels and changing binary bands, regular/progressive and partial edge groups. An optional baseline additionally requires identical complete independently decoded Float32 grids.',
  baselinePath: baselinePath ?? null,
  results,
})
