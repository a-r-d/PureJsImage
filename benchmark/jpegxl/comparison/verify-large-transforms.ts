import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import sharp from 'sharp'
import { decodeDct16OrderFixture } from '../../../tests/helpers/jpegxl-dct16-orders.ts'
import { encodeLargeOrderFixture } from '../../../tests/helpers/jpegxl-large-orders.ts'
import { hash, implementationIdentity, json, oracle, work } from './io.ts'
import { number, object, string, validateImplementationIdentity } from './model.ts'

const [
  output,
  baselinePath = 'benchmark/jpegxl/comparison/results/large-transform-native-baseline.json',
  nativePath = `${oracle}/djxl`,
  rustPath = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli',
] = process.argv.slice(2)
if (!output || process.argv.length > 6)
  throw new Error(
    'Specify report path, then optional baseline, pinned native decoder and pinned Rust decoder paths',
  )
const baseline = object(JSON.parse(await readFile(baselinePath, 'utf8')))
if (
  baseline.completed !== true ||
  !Array.isArray(baseline.results) ||
  baseline.results.length !== 8 ||
  !Array.isArray(baseline.fixtureSources)
)
  throw new Error('All eight qualified mixed and prefix fixture definitions required')
const digest = (value: unknown): string => {
  const text = string(value)
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new Error('Invalid SHA256')
  return text
}
const definitions = baseline.results.map((value) => {
  const row = object(value),
    groups = number(row.groups),
    width = number(row.width),
    height = number(row.height)
  if (
    (groups !== 1 && groups !== 2) ||
    width !== groups * 256 ||
    height !== 128 ||
    typeof row.learned !== 'boolean' ||
    typeof row.familyContexts !== 'boolean' ||
    !Array.isArray(row.grids) ||
    row.grids.length !== 2
  )
    throw new Error('Invalid deterministic fixture definition')
  const id = `${groups === 2 ? 'mixed' : 'prefix'}-${row.familyContexts ? 'family' : 'shared'}-${row.learned ? 'learned' : 'natural'}`
  if (row.id !== id || !Number.isSafeInteger(row.bytes) || number(row.bytes) < 1)
    throw new Error('Invalid fixture identity or byte count')
  const grids = row.grids.map((value) => {
    const grid = object(value)
    if (
      (grid.name !== 'native' && grid.name !== 'rust') ||
      grid.alphaExact !== true ||
      grid.samples !== width * height * 3 ||
      number(grid.maxError) > 1
    )
      throw new Error('Invalid qualified independent grid')
    return {
      name: grid.name,
      sha256: digest(grid.sha256),
      executableSha256: digest(grid.executableSha256),
    }
  })
  if (new Set(grids.map((grid) => grid.name)).size !== 2)
    throw new Error('Native and Rust grids both required')
  return {
    id,
    groups,
    width,
    height,
    learned: row.learned,
    familyContexts: row.familyContexts,
    bytes: number(row.bytes),
    sha256: digest(row.sha256),
    publicSha256: digest(row.publicSha256),
    grids,
  }
})
assert.equal(new Set(definitions.map((row) => row.id)).size, 8)
const sourcePins = baseline.fixtureSources.map((value) => {
  const pin = object(value)
  return { path: string(pin.path), sha256: digest(pin.sha256) }
})
assert.equal(sourcePins.length, 2)
assert.deepEqual(sourcePins.map((pin) => pin.path).sort(), [
  'tests/helpers/jpegxl-dct16-orders.ts',
  'tests/helpers/jpegxl-large-orders.ts',
])
// Verify both optional external tool paths and every input before any fixture encode.
const tools = [
  { name: 'native', path: nativePath, args: ['--num_threads=1', '--bits_per_sample=8'] },
  { name: 'rust', path: rustPath, args: ['--num-threads', '1'] },
]
for (const tool of tools) {
  const executableSha256 = hash(await readFile(tool.path))
  for (const row of definitions) {
    const expected = row.grids.find((grid) => grid.name === tool.name)
    assert(expected)
    assert.equal(executableSha256, expected.executableSha256, 'Pinned development oracle')
  }
}
for (const pin of sourcePins) assert.equal(hash(await readFile(pin.path)), pin.sha256, pin.path)
const identity = await implementationIdentity(),
  directory = `${work}/large-transform-verification/${basename(output, '.json')}`
await mkdir(directory, { recursive: true })
sharp.concurrency(1)
const pins = new Map<string, string>([
  [baselinePath, hash(await readFile(baselinePath))],
  [import.meta.filename, hash(await readFile(import.meta.filename))],
])
for (const pin of sourcePins) pins.set(pin.path, pin.sha256)
for (const tool of tools) pins.set(tool.path, hash(await readFile(tool.path)))
const results: object[] = [],
  originalGrids = new Map<string, Uint8Array>()
// Natural always precedes learned, independently of the external JSON ordering.
for (const groups of [2, 1] as const)
  for (const familyContexts of [false, true])
    for (const learned of [false, true]) {
      const expected = definitions.find(
        (row) =>
          row.groups === groups && row.familyContexts === familyContexts && row.learned === learned,
      )
      assert(expected)
      const encoded = encodeLargeOrderFixture(learned, familyContexts, groups)
      assert.equal(encoded.length, expected.bytes)
      assert.equal(hash(encoded), expected.sha256, 'Complete deterministic artifact')
      const artifact = `${directory}/${expected.id}.jxl`
      await writeFile(artifact, encoded, { flag: 'wx' })
      pins.set(artifact, hash(encoded))
      const publicPixels = await decodeDct16OrderFixture(encoded, expected.width)
      assert.equal(publicPixels.length, expected.width * expected.height * 3)
      assert.equal(hash(publicPixels), expected.publicSha256)
      const pair = `${groups}-${familyContexts}`,
        publicKey = `${pair}-public`
      if (learned)
        assert.deepEqual(
          publicPixels,
          originalGrids.get(publicKey),
          'Natural/learned complete public identity',
        )
      else originalGrids.set(publicKey, publicPixels)
      const grids: object[] = []
      for (const tool of tools) {
        const path = `${artifact}.${tool.name}.png`,
          child = spawnSync(tool.path, [artifact, path, ...tool.args], {
            encoding: 'utf8',
            timeout: 30_000,
            killSignal: 'SIGKILL',
            maxBuffer: 1_048_576,
          })
        assert.equal(child.error, undefined)
        assert.equal(child.status, 0, child.stderr)
        assert.equal(child.signal, null)
        const png = await readFile(path),
          decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
          pixels = new Uint8Array(
            decoded.data.buffer,
            decoded.data.byteOffset,
            decoded.data.byteLength,
          )
        assert.equal(decoded.info.width, expected.width)
        assert.equal(decoded.info.height, expected.height)
        assert.equal(decoded.info.channels, 4)
        assert.equal(pixels.length, expected.width * expected.height * 4)
        let maxError = 0
        for (let pixel = 0; pixel < expected.width * expected.height; pixel++) {
          assert.equal(pixels[pixel * 4 + 3], 255, 'Exact opaque alpha')
          for (let c = 0; c < 3; c++) {
            const a = publicPixels[pixel * 3 + c],
              b = pixels[pixel * 4 + c]
            assert(a !== undefined && b !== undefined)
            maxError = Math.max(maxError, Math.abs(a - b))
          }
        }
        assert(maxError <= 1, 'Every independent/public RGB sample within one code')
        const baselineGrid: { name: string; sha256: string; executableSha256: string } | undefined =
          expected.grids.find((grid) => grid.name === tool.name)
        assert(baselineGrid)
        assert.equal(hash(pixels), baselineGrid.sha256, 'Complete qualified independent grid')
        const key = `${pair}-${tool.name}`
        if (learned)
          assert.deepEqual(
            pixels,
            originalGrids.get(key),
            'Natural/learned complete independent identity',
          )
        else originalGrids.set(key, pixels.slice())
        pins.set(path, hash(png))
        grids.push({
          decoder: tool.name,
          path,
          pngSha256: hash(png),
          sha256: hash(pixels),
          samples: publicPixels.length,
          rgbaSamples: pixels.length,
          maxError,
          alphaExact: true,
          baselineGridIdentical: true,
          naturalLearnedIdentical: true,
          executableSha256: baselineGrid.executableSha256,
        })
      }
      results.push({
        ...expected,
        artifact,
        encodedSha256: hash(encoded),
        publicSamples: publicPixels.length,
        publicSha256: hash(publicPixels),
        naturalLearnedPublicIdentical: true,
        ownerClosedByFixture: true,
        grids,
      })
      console.log(
        `${expected.id}: complete artifact, public/native/Rust grids and exact alpha verified`,
      )
    }
validateImplementationIdentity(await implementationIdentity(), identity)
for (const [path, sha256] of pins) assert.equal(hash(await readFile(path)), sha256, path)
await json(output, {
  ...identity,
  completed: true,
  baselinePath,
  results,
  pins: [...pins].map(([path, sha256]) => ({ path, sha256 })),
  completeFiles: 8,
  completeIndependentGrids: 16,
  completePublicGrids: 8,
  fullParity: false,
  policy:
    'Deterministic firstparty mixed DCT16/DCT32/16x32/32x16 learned-order streams: four two-group ANS and four single-group prefix. Verify complete artifacts and all independent/public RGB samples, exact opaque alpha and complete natural/learned decoded identity. Development oracle paths may be overridden only with exact pinned binaries. Fixture owners close before decode. No perceptual photo, public encoder selection, compression parity or speed claim.',
})
