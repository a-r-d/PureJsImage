/** Same-input native filter controls at measured quality, not equal distance. */
import { mkdir, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { JpegXlCodestreamSource } from '../../../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../../../src/codecs/jpegxl-decode.ts'
import { inspectJpegXl } from '../../../src/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'
import { inspectJpegXlVarDctStrategyIds } from '../inspect-vardct-strategies.ts'
import { interpolateM7Quality } from '../m7-quality-curves.ts'
import {
  nextRecoverySetting,
  type RecoveryPoint,
  recoveryBracket,
  recoveryMonotonicityViolations,
} from '../m7-recovery-curves.ts'
import {
  fixtures,
  hash,
  implementationIdentity,
  json,
  metrics,
  oracle,
  pnm,
  raw,
  root,
  run,
  work,
} from './io.ts'
import { object } from './model.ts'

const output = process.argv[2]
if (!output) throw new Error('Usage: node investigate-lossy-filters.ts report.json')
const directory = `${work}/compression-investigation/lossy-filters`
await mkdir(directory, { recursive: true })
const fixture = (await fixtures()).find((f) => f.id === 'im26-1030-diagnostic')
if (!fixture) throw new Error('Missing pinned photo')
const source = await readFile(fixture.source)
if (hash(source) !== fixture.sourceSha256) throw new Error('Pinned source changed')
const rgb = pnm(source),
  rgba = await raw(fixture)
if (
  !(rgb.data instanceof Uint8Array) ||
  !(rgba.data instanceof Uint8Array) ||
  rgb.channels !== 3 ||
  rgba.channels !== 4 ||
  rgb.width !== rgba.width ||
  rgb.height !== rgba.height
)
  throw new Error('Input sample contract mismatch')
for (let i = 0; i < rgb.width * rgb.height; i++) {
  if (rgba.data[i * 4 + 3] !== 255) throw new Error('RGB control requires opaque alpha')
  for (let c = 0; c < 3; c++)
    if (rgb.data[i * 3 + c] !== rgba.data[i * 4 + c])
      throw new Error('Control input samples changed')
}
const reference = `${directory}/reference.png`
await sharp(rgb.data, { raw: { width: rgb.width, height: rgb.height, channels: 3 } })
  .png()
  .toFile(reference)
const identity = await implementationIdentity()
const original = object(JSON.parse(await readFile(`${root}/results/main-node.json`, 'utf8')))
const manifest = object(JSON.parse(await readFile(`${root}/fixtures.json`, 'utf8')))
if (
  original.implementationSourceSha256 !== identity.implementationSourceSha256 ||
  manifest.oracleSha256 !== hash(await readFile(`${oracle}/cjxl`))
)
  throw new Error('Pinned implementation or oracle changed')

interface Point extends RecoveryPoint {
  butteraugli: number
  artifact: string
  artifactSha256: string
  decodedRgbSha256: string
  containerOverheadBytes: number
  strategies: readonly number[]
  gaborish: boolean
  epfIterations: number
}
const variants = [
  { id: 'default', args: [] },
  { id: 'no-gaborish', args: ['--gaborish=0'] },
  { id: 'no-epf', args: ['--epf=0'] },
  { id: 'no-gaborish-no-epf', args: ['--gaborish=0', '--epf=0'] },
  { id: 'faster-decoding-4', args: ['--faster_decoding=4'] },
]
const results: {
  variant: string
  options: string[]
  points: Point[]
  bracketWidth: number | null
  interpolatedBytes: number | null
  monotonicityViolations: ReturnType<typeof recoveryMonotonicityViolations>
}[] = []
for (const variant of variants) {
  const points: Point[] = []
  const queue = [1, 4]
  for (let attempt = 0; attempt < 16; attempt++) {
    const bracket = recoveryBracket(points, 80)
    if (bracket && bracket.width <= 0.25 && queue.length === 0) break
    const setting = queue.shift() ?? nextRecoverySetting(points, 80, 0.1, 25, 0.25)
    if (setting === undefined) break
    const path = `${directory}/${variant.id}-${setting}.jxl`
    console.log(`quality control ${variant.id} distance ${setting}`)
    run(`${oracle}/cjxl`, [
      fixture.source,
      path,
      '-e',
      '7',
      '-d',
      String(setting),
      '--num_threads=0',
      '--container=0',
      ...variant.args,
    ])
    const decodedPath = `${path}.png`
    run(`${oracle}/djxl`, [path, decodedPath, '--num_threads=0', '--bits_per_sample=8'])
    const decoded = await sharp(decodedPath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (
      decoded.info.width !== rgb.width ||
      decoded.info.height !== rgb.height ||
      decoded.info.channels !== 3
    )
      throw new Error('Native control shape changed')
    const score = Number.parseFloat(run(`${metrics}/ssimulacra2`, [reference, decodedPath]))
    const butteraugli = Number.parseFloat(
      run(`${metrics}/butteraugli_main`, [reference, decodedPath]),
    )
    if (!Number.isFinite(score) || !Number.isFinite(butteraugli))
      throw new Error('Invalid metric output')
    const bytes = await readFile(path)
    const structure = await inspectJpegXl(bytes)
    const logical = new JpegXlCodestreamSource(new MemorySource(bytes), structure)
    const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
    const frame = frames.at(-1)
    if (frame?.encoding !== 'vardct') throw new Error('Expected VarDCT control')
    points.push({
      setting,
      score,
      butteraugli,
      bytes: bytes.length,
      artifact: path,
      artifactSha256: hash(bytes),
      decodedRgbSha256: hash(decoded.data),
      containerOverheadBytes: bytes.length - structure.codestreamBytes,
      strategies: await inspectJpegXlVarDctStrategyIds(logical, frames),
      gaborish: frame.gaborish,
      epfIterations: frame.epfIterations,
    })
  }
  const bracket = recoveryBracket(points, 80)
  results.push({
    variant: variant.id,
    options: variant.args,
    points,
    bracketWidth: bracket?.width ?? null,
    interpolatedBytes:
      bracket && bracket.width <= 0.25 ? (interpolateM7Quality(points, 80) ?? null) : null,
    monotonicityViolations: recoveryMonotonicityViolations(points),
  })
  await json(output, {
    schemaVersion: 1,
    date: new Date().toISOString(),
    ...identity,
    fixture: fixture.id,
    sourceSha256: fixture.sourceSha256,
    inputRgbSha256: hash(rgb.data),
    target: 80,
    maximumBracketWidth: 0.25,
    oracleVersion: run(`${oracle}/cjxl`, ['--version']).trim(),
    cjxlSha256: hash(await readFile(`${oracle}/cjxl`)),
    djxlSha256: hash(await readFile(`${oracle}/djxl`)),
    ssimulacra2Sha256: hash(await readFile(`${metrics}/ssimulacra2`)),
    butteraugliSha256: hash(await readFile(`${metrics}/butteraugli_main`)),
    results,
  })
}
