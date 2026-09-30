/** One RGB8 source/engine/target per bounded manual run. Never changes the approved matrix. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { encodeJpegXlVarDct8 } from '../../src/codecs/jpegxl-vardct-encode.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import {
  nextRecoverySetting,
  recoveryBracket,
  recoveryFrontier,
  recoveryMonotonicityViolations,
  type RecoveryPoint,
} from './m7-recovery-curves.ts'
import { verifyM7QualityPixels } from './m7-quality-decoding.ts'
import artifacts from './production-program/m7-prompt2-artifacts.json' with { type: 'json' }
import ceiling from './production-program/m7-prompt10-native-ceiling.json' with { type: 'json' }
import lowEndpoints from './production-program/m7-prompt11-low-endpoints.json' with { type: 'json' }

const [runId, split, id, engine, targetText, stepsText, widthText] = process.argv.slice(2)
if (
  !runId ||
  !/^[a-z0-9-]+$/u.test(runId) ||
  (split !== 'development' && split !== 'holdout') ||
  !id ||
  !/^[a-z0-9-]+$/u.test(id) ||
  (engine !== 'purejsimage' && engine !== 'libjxl')
)
  throw new Error(
    'Usage: node benchmark/jpegxl/refine-m7-recovery.ts run-id development|holdout source-id purejsimage|libjxl 70|80|90 steps width',
  )
const target = Number(targetText)
const maximumSteps = Number(stepsText)
const maximumWidth = Number(widthText)
if (
  ![70, 80, 90].includes(target) ||
  !Number.isSafeInteger(maximumSteps) ||
  maximumSteps < 1 ||
  maximumSteps > 6 ||
  !Number.isFinite(maximumWidth) ||
  maximumWidth <= 0 ||
  maximumWidth > 10
)
  throw new Error('Target must be 70/80/90, steps 1..6, width (0, 10]')
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const metrics = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-m7-metrics/tools'
const directory = `.tmp/jpegxl-m7/recovery-refine/${runId}`
const reportPath = `${directory}/report.json`
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const toolHash = async (path: string): Promise<string> => hash(await readFile(path))
const run = (path: string, args: readonly string[]): string => {
  const result = spawnSync(path, args, {
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`${path}: ${result.stderr}; ${result.error ?? ''}`)
  return result.stdout
}
const ppm = (bytes: Uint8Array, width: number, height: number): Uint8Array => {
  const match = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(
    new TextDecoder().decode(bytes.subarray(0, 100)),
  )
  if (
    !match ||
    Number(match[1]) !== width ||
    Number(match[2]) !== height ||
    bytes.length !== match[0].length + width * height * 3
  )
    throw new Error('RGB8 PPM extent or color depth mismatch')
  return bytes.subarray(match[0].length)
}
const original = artifacts.cases.find((entry) => entry.split === split && entry.id === id)
if (!original) throw new Error(`Source ${split}/${id} is outside the approved split`)
const input = `${dirname(original.rawReportPath)}/input.ppm`
const pixels = ppm(await readFile(input), original.width, original.height)
if (hash(pixels) !== original.normalizedSha256) throw new Error('Normalized input pixels changed')
const codecNames = (await readdir('src/codecs'))
  .filter((name) => name.startsWith('jpegxl') && name.endsWith('.ts'))
  .sort()
const codecFingerprint = createHash('sha256')
for (const name of codecNames)
  codecFingerprint.update(name).update(await readFile(`src/codecs/${name}`))
const protocol = {
  version: 1,
  split,
  id,
  engine,
  target,
  inputPixelsSha256: original.normalizedSha256,
  width: original.width,
  height: original.height,
  codecSha256: codecFingerprint.digest('hex'),
  cjxlSha256: await toolHash(`${native}/cjxl`),
  djxlSha256: await toolHash(`${native}/djxl`),
  rustSha256: await toolHash(rust),
  ssimulacra2Sha256: await toolHash(`${metrics}/ssimulacra2`),
  butteraugliSha256: await toolHash(`${metrics}/butteraugli_main`),
  scope:
    'One bounded RGB8 endpoint refinement. Existing matrix is unchanged; new points are development diagnostics or observed-holdout regression evidence only.',
}
interface MeasuredPoint extends RecoveryPoint {
  readonly source: string
  readonly encodedSha256: string
  readonly decodedSha256?: string | undefined
  readonly independentMaximum?: number
  readonly butteraugli?: number | undefined
  readonly artifactPath?: string
}
const oldPoints: MeasuredPoint[] = []
const add = (value: unknown, source: string): void => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('engine' in value) ||
    value.engine !== engine
  )
    return
  if ('status' in value && value.status !== 'measured') return
  const setting =
    'setting' in value ? value.setting : 'distance' in value ? value.distance : undefined
  if (
    typeof setting !== 'number' ||
    !(setting > 0) ||
    !('bytes' in value) ||
    typeof value.bytes !== 'number' ||
    !('ssimulacra2' in value) ||
    typeof value.ssimulacra2 !== 'number' ||
    !('encodedSha256' in value) ||
    typeof value.encodedSha256 !== 'string'
  )
    throw new Error('Invalid measured baseline point')
  const butteraugli =
    'butteraugli' in value && typeof value.butteraugli === 'number' ? value.butteraugli : undefined
  const decodedSha256 =
    'decodedSha256' in value && typeof value.decodedSha256 === 'string'
      ? value.decodedSha256
      : undefined
  oldPoints.push({
    setting,
    bytes: value.bytes,
    score: value.ssimulacra2,
    butteraugli,
    encodedSha256: value.encodedSha256,
    decodedSha256,
    source,
  })
}
// The current complete raw case applies the Prompt 9 overlay. Its source hash is checked above.
const rawPath = `.tmp/jpegxl-m7/prompt9-qualified-complete-${split}/${id}/report.json`
const raw: unknown = JSON.parse(await readFile(rawPath, 'utf8'))
if (
  typeof raw !== 'object' ||
  raw === null ||
  !('normalizedSha256' in raw) ||
  raw.normalizedSha256 !== original.normalizedSha256 ||
  !('points' in raw) ||
  !Array.isArray(raw.points)
)
  throw new Error('Current qualified case report does not match the normalized input')
for (const entry of raw.points) add(entry, 'approved-2mp')
for (const entry of lowEndpoints.results)
  if (
    entry.split === split &&
    entry.id === id &&
    entry.inputPixelsSha256 === original.normalizedSha256
  )
    add(entry, 'supplementary-low')
for (const entry of ceiling.results)
  if (
    entry.split === split &&
    entry.id === id &&
    entry.inputPixelsSha256 === original.normalizedSha256
  )
    add({ ...entry, engine: 'libjxl' }, 'supplementary-high')
if (oldPoints.length < 2) throw new Error('No complete baseline curve')
await mkdir(directory, { recursive: true })
const additions: MeasuredPoint[] = []
let cachedText: string | undefined
try {
  cachedText = await readFile(reportPath, 'utf8')
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
}
if (cachedText !== undefined) {
  const saved: unknown = JSON.parse(cachedText)
  if (
    typeof saved !== 'object' ||
    saved === null ||
    !('protocol' in saved) ||
    typeof saved.protocol !== 'object' ||
    saved.protocol === null ||
    !('additions' in saved) ||
    !Array.isArray(saved.additions)
  )
    throw new Error('Invalid cached report')
  const previous = new Map(Object.entries(saved.protocol))
  previous.delete('maximumSteps')
  previous.delete('maximumWidth')
  if (JSON.stringify(Object.fromEntries(previous)) !== JSON.stringify(protocol))
    throw new Error('Cache protocol mismatch')
  for (const value of saved.additions) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('source' in value) ||
      value.source !== 'adaptive-refinement' ||
      !('setting' in value) ||
      typeof value.setting !== 'number' ||
      !('bytes' in value) ||
      typeof value.bytes !== 'number' ||
      !('score' in value) ||
      typeof value.score !== 'number' ||
      !('encodedSha256' in value) ||
      typeof value.encodedSha256 !== 'string' ||
      !('decodedSha256' in value) ||
      typeof value.decodedSha256 !== 'string' ||
      !('artifactPath' in value) ||
      typeof value.artifactPath !== 'string'
    )
      throw new Error('Invalid cached endpoint')
    if (
      !value.artifactPath.startsWith(`${directory}/d`) ||
      hash(await readFile(value.artifactPath)) !== value.encodedSha256
    )
      throw new Error('Cached stream identity mismatch')
    const decodedPath = value.artifactPath.replace(/\.jxl$/u, '-native.ppm')
    const decoded = ppm(await readFile(decodedPath), original.width, original.height)
    if (hash(decoded) !== value.decodedSha256) throw new Error('Cached decoded pixels changed')
    const butteraugli =
      'butteraugli' in value && typeof value.butteraugli === 'number'
        ? value.butteraugli
        : Number.parseFloat(run(`${metrics}/butteraugli_main`, [input, decodedPath]))
    const other = ppm(
      await readFile(value.artifactPath.replace(/\.jxl$/u, '-rust.ppm')),
      original.width,
      original.height,
    )
    let independentMaximum = 0
    for (let index = 0; index < decoded.length; index++)
      independentMaximum = Math.max(
        independentMaximum,
        Math.abs((decoded[index] ?? 0) - (other[index] ?? 0)),
      )
    if (independentMaximum > 2) throw new Error('Cached independent decoder mismatch')
    additions.push({
      source: value.source,
      setting: value.setting,
      bytes: value.bytes,
      score: value.score,
      butteraugli,
      independentMaximum,
      encodedSha256: value.encodedSha256,
      decodedSha256: value.decodedSha256,
      artifactPath: value.artifactPath,
    })
  }
}
const minimumSetting = engine === 'libjxl' ? 0.05 : 0.25
const maximumSetting = 20
const save = async (status: string): Promise<void> => {
  const points = [...oldPoints, ...additions]
  const bracket = recoveryBracket(points, target)
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        protocol,
        status,
        settingFloor: minimumSetting,
        settingCeiling: maximumSetting,
        bracketWidth: bracket?.width ?? null,
        bracketSettings: bracket ? [bracket.lower.setting, bracket.upper.setting] : null,
        monotonicityViolations: recoveryMonotonicityViolations(points),
        nondominatedPoints: recoveryFrontier(points).length,
        maximumSteps,
        maximumWidth,
        baselinePoints: oldPoints,
        additions,
      },
      null,
      2,
    )}\n`,
  )
}
for (let step = additions.length; step < maximumSteps; step++) {
  const setting = nextRecoverySetting(
    [...oldPoints, ...additions],
    target,
    minimumSetting,
    maximumSetting,
    maximumWidth,
  )
  if (setting === undefined) break
  const stem = `${directory}/d${setting}`
  const encodedPath = `${stem}.jxl`
  if (engine === 'libjxl')
    run(`${native}/cjxl`, [
      input,
      encodedPath,
      '-d',
      String(setting),
      '-e',
      '7',
      '--num_threads=1',
      '--container=0',
    ])
  else {
    const sink = new Uint8ArraySink()
    for (const part of encodeJpegXlVarDct8(
      pixels,
      original.width,
      original.height,
      setting,
      undefined,
      3,
      7,
    ))
      await sink.write(part)
    await writeFile(encodedPath, sink.toUint8Array(), { flag: 'wx' })
  }
  const decodedPath = `${stem}-native.ppm`
  const rustPath = `${stem}-rust.ppm`
  run(`${native}/djxl`, [encodedPath, decodedPath, '--num_threads=1', '--bits_per_sample=8'])
  run(rust, [encodedPath, rustPath, '--num-threads', '1', '--data-type', 'u8'])
  const decoded = ppm(await readFile(decodedPath), original.width, original.height)
  const independent = ppm(await readFile(rustPath), original.width, original.height)
  let independentMaximum = 0
  for (let index = 0; index < decoded.length; index++)
    independentMaximum = Math.max(
      independentMaximum,
      Math.abs((decoded[index] ?? 0) - (independent[index] ?? 0)),
    )
  if (independentMaximum > 2) throw new Error(`Independent decoder mismatch: ${independentMaximum}`)
  const stream = await readFile(encodedPath)
  if (engine === 'purejsimage')
    await verifyM7QualityPixels(stream, decoded, original.width, original.height)
  const score = Number.parseFloat(run(`${metrics}/ssimulacra2`, [input, decodedPath]))
  const butteraugli = Number.parseFloat(run(`${metrics}/butteraugli_main`, [input, decodedPath]))
  if (!Number.isFinite(score) || !Number.isFinite(butteraugli))
    throw new Error('Nonfinite quality score')
  additions.push({
    source: 'adaptive-refinement',
    setting,
    bytes: stream.length,
    score,
    butteraugli,
    encodedSha256: hash(stream),
    decodedSha256: hash(decoded),
    independentMaximum,
    artifactPath: encodedPath,
  })
  await save('running')
  console.log(
    JSON.stringify({
      setting,
      bytes: stream.length,
      ssimulacra2: score,
      butteraugli,
      independentMaximum,
      bracketWidth: recoveryBracket([...oldPoints, ...additions], target)?.width ?? null,
    }),
  )
}
const finalPoints = [...oldPoints, ...additions]
const bracket = recoveryBracket(finalPoints, target)
const status =
  bracket && bracket.width <= maximumWidth
    ? 'adequate-bracket'
    : nextRecoverySetting(finalPoints, target, minimumSetting, maximumSetting, maximumWidth) ===
        undefined
      ? 'setting-limit-or-nonmonotonic'
      : 'search-limit'
await save(status)
console.log(
  JSON.stringify({
    status,
    additions: additions.length,
    bracketWidth: bracket?.width ?? null,
    monotonicityViolations: recoveryMonotonicityViolations(finalPoints),
  }),
)
