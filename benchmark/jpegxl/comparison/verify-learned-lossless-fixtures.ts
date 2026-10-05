import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  encodeLearnedLosslessFixture,
  learnedLosslessFixture,
  reversibleColorFixture,
} from '../../../tests/helpers/jpegxl-learned-lossless.ts'
import {
  encodeLosslessPatchFixture,
  losslessPatchFixture,
} from '../../../tests/helpers/jpegxl-lossless-patches.ts'
import { hashM8Sources } from '../m8-output-digest.ts'
import { hash, json, run } from './io.ts'

const output = process.argv[2]
if (!output) throw new Error('Specify a report path')
const directory = '.tmp/jpegxl-comparison-v1/parity-learned-fixtures'
await mkdir(directory, { recursive: true })
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const rows = []
const fixtures: (
  | {
      readonly kind: 'learned' | 'color'
      readonly depth: 8 | 16
      readonly primary?: 0 | 1 | 2
      readonly fixture: ReturnType<typeof learnedLosslessFixture>
    }
  | {
      readonly kind: 'patches'
      readonly depth: 8
      readonly background: 'pale' | 'flat'
      readonly fixture: ReturnType<typeof losslessPatchFixture>
    }
)[] = []
for (const depth of [8, 16] as const) {
  for (const width of [1024, 1025] as const) {
    fixtures.push({ kind: 'learned', depth, fixture: learnedLosslessFixture(depth, width) })
  }
}
for (const format of ['rgb8', 'rgba8'] as const)
  for (const background of ['pale', 'flat'] as const)
    fixtures.push({
      kind: 'patches',
      depth: 8,
      background,
      fixture: losslessPatchFixture(format, background),
    })
for (const depth of [8, 16] as const)
  for (const primary of [0, 1, 2] as const)
    fixtures.push({
      kind: 'color',
      depth,
      primary,
      fixture: reversibleColorFixture(depth, primary),
    })
for (const entry of fixtures) {
  const { depth, fixture } = entry,
    width = fixture.width,
    channels = fixture.format.startsWith('rgba') ? 4 : 3
  let learned: Awaited<ReturnType<typeof encodeLearnedLosslessFixture>> | undefined
  let result: {
    readonly encoded: Uint8Array
    readonly ownedPeak: number
    readonly ownedLive: number
  }
  if (entry.kind === 'patches') result = await encodeLosslessPatchFixture(entry.fixture)
  else {
    learned = await encodeLearnedLosslessFixture(entry.fixture)
    result = learned
  }
  if (width === 1025 && !learned?.models.includes('learned'))
    throw new Error('Fixture did not exercise learned contexts')
  if (result.ownedLive !== 0) throw new Error('Encoder storage did not unwind')
  const suffix =
    entry.kind === 'color'
      ? `-${entry.primary}`
      : entry.kind === 'patches'
        ? `-${entry.background}`
        : ''
  const artifact = `${directory}/${entry.kind}-${depth}-${width}-${fixture.format}${suffix}.jxl`
  await writeFile(artifact, result.encoded)
  const oracles = []
  const maximum = 2 ** depth - 1,
    sampleBytes = depth / 8,
    samples = fixture.pixels.length / sampleBytes
  for (const oracle of [
    { name: 'libjxl', executable: `${tools}/djxl`, args: ['--num_threads=1'] },
    { name: 'jxl-rs', executable: rust, args: ['--num-threads', '1'] },
  ]) {
    const path = `${artifact}.${oracle.name}.npy`
    run(oracle.executable, [artifact, path, ...oracle.args])
    const npy = await readFile(path)
    if (npy[6] !== 1) throw new Error('Expected NPY version 1')
    const start = 10 + npy.readUInt16LE(8)
    const header = npy.subarray(10, start).toString('ascii')
    if (
      !header.includes("'<f4'") ||
      !header.includes(`(1, ${fixture.height}, ${width}, ${channels})`) ||
      npy.length !== start + samples * 4
    )
      throw new Error(`Unexpected independent layout: ${header}`)
    for (let sample = 0; sample < samples; sample++) {
      const expected =
        depth === 16
          ? (fixture.pixels[sample * 2] ?? 0) * 256 + (fixture.pixels[sample * 2 + 1] ?? 0)
          : (fixture.pixels[sample] ?? 0)
      const value = npy.readFloatLE(start + sample * 4)
      if (!Number.isFinite(value) || Math.round(value * maximum) !== expected)
        throw new Error(`${oracle.name}: changed ${depth}-${width} sample ${sample}`)
    }
    oracles.push({
      oracle: oracle.name,
      executableSha256: hash(await readFile(oracle.executable)),
      normalizedFloatSha256: hash(npy),
      samplesCompared: samples,
      maximumSampleError: 0,
    })
  }
  rows.push({
    kind: entry.kind,
    ...(entry.kind === 'color' ? { primary: entry.primary } : {}),
    ...(entry.kind === 'patches' ? { background: entry.background } : {}),
    depth,
    width,
    height: fixture.height,
    format: fixture.format,
    inputSha256: hash(fixture.pixels),
    artifact,
    bytes: result.encoded.length,
    encodedSha256: hash(result.encoded),
    ownedPeak: result.ownedPeak,
    ownedLive: result.ownedLive,
    ...(learned ? { models: learned.models, groups: learned.groups } : {}),
    oracles,
    status: 'verified',
  })
  console.log(
    `${entry.kind}-${depth}-${width}-${fixture.format}: every original sample exact in both independent decoders`,
  )
}
await json(output, {
  schemaVersion: 1,
  implementationSourceSha256: await hashM8Sources(),
  harnessSha256: hash(await readFile(import.meta.filename)),
  fixtureHelperSha256: hash(
    await readFile(new URL('../../../tests/helpers/jpegxl-learned-lossless.ts', import.meta.url)),
  ),
  patchFixtureHelperSha256: hash(
    await readFile(new URL('../../../tests/helpers/jpegxl-lossless-patches.ts', import.meta.url)),
  ),
  policy:
    'Mixed texture, correlated color in each primary channel, signed gradients and repeated patch cases on pale and colored flat backgrounds at effort 7. Preserve every 8/16-bit native sample, including invisible RGB, nonconstant straight alpha and nonpatched values. Timings are excluded; oracle memory is separate from the encoder owned-storage counter.',
  runtime: process.version,
  rows,
})
