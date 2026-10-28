import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import * as coefficientEncoder from '../../../src/codecs/jpegxl-jpeg-encode.ts'
import type {
  VarDctCoefficientGeometry,
  VarDctCoefficientPlane,
} from '../../../src/codecs/jpegxl-jpeg-encode.ts'
import {
  jpegXlVarDctStrategyBlockHeights,
  jpegXlVarDctStrategyBlockWidths,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import { hash, metrics, oracle, run } from '../comparison/io.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import { libjxlPortOverrides, parseLibjxlPort } from './libjxl-ports.ts'
import { encodedSectionCosts, readDistanceMap, windowContrast } from './local-rate-audit.ts'
import { parseButteraugliOutput, parseSsimulacra2Output } from './metrics.ts'
import { encodeTransplant } from './transplant.ts'

const [root, phase = 'cohorts', id = 'im26-2004'] = process.argv.slice(2)
const rateAudit = process.argv[5] === 'rate'
function readRateAudit(): unknown {
  if (!rateAudit) return undefined
  if (
    !('takeDevelopmentRateAudit' in coefficientEncoder) ||
    typeof coefficientEncoder.takeDevelopmentRateAudit !== 'function'
  )
    throw new Error('Apply RATE-INSTRUMENTATION.patch before the rate audit')
  const result: unknown = coefficientEncoder.takeDevelopmentRateAudit()
  return result
}
if (rateAudit) {
  if (
    !('beginDevelopmentRateAudit' in coefficientEncoder) ||
    typeof coefficientEncoder.beginDevelopmentRateAudit !== 'function'
  )
    throw new Error('Apply RATE-INSTRUMENTATION.patch before the rate audit')
  coefficientEncoder.beginDevelopmentRateAudit()
}
if (!root) throw new Error('Need fresh audit directory')
if (phase !== 'cohorts' && phase !== 'marginal' && phase !== 'endpoints')
  throw new Error('Unknown audit phase')
await mkdir(root, { recursive: true })
const distance = 1.85
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const fixture = manifest.fixtures.find(
  (f) => f.id === id && f.kind === 'lab' && f.split === 'development',
)
if (!fixture) throw new Error('Missing development fixture')
const reference = fixture.png
const input = await readFile(fixture.png)
if (hash(input) !== fixture.fixtureSha256) throw new Error('Fixture changed')
const png = PNG.sync.read(input),
  width = png.width,
  height = png.height,
  pixels = Uint8Array.from(png.data)
if (width !== 512 || height !== 512) throw new Error('Expected pinned crop')
const oldRoot = '.tmp/jpegxl-lossy-lab/display-trace-20261028'
const controlPath = `.tmp/jpegxl-lossy-lab/standalone-reconstruction-20261017/forward-lab/standalone-forward-all-purejsimage/${id}-lab/1.85.jxl`
const changedPath = `${oldRoot}/rd25-filtered-lab/standalone-rd25-filtered-purejsimage/${id}-lab/1.85.jxl`
function capture(g: VarDctCoefficientGeometry) {
  if (!g.loadAc || !g.strategyMap || !g.developmentFirstBlocks)
    throw new Error('Missing selected geometry')
  const groups: VarDctCoefficientPlane[][] = []
  for (let group = 0; group < g.groupsAcross * g.groupsDown; group++)
    groups.push(
      g.loadAc(group, 0).map((p) => ({
        ...p,
        coefficients: p.coefficients.slice(),
        ...(p.coefficientOffsets ? { coefficientOffsets: p.coefficientOffsets.slice() } : {}),
      })),
    )
  return {
    groups,
    strategies: g.strategyMap.slice(),
    first: g.developmentFirstBlocks.slice(),
    blocksWide: g.blocksWide,
    groupsAcross: g.groupsAcross,
  }
}
type Capture = ReturnType<typeof capture>
async function encode(mode: string, mutate?: (snapshot: Capture) => void) {
  const holder: { value?: Capture } = {}
  const options = libjxlPortOverrides(parseLibjxlPort(mode), distance, width, height),
    rewrite = options.rewriteGeometry
  if (!rewrite) throw new Error('Missing writer')
  const result = await encodeTransplant(pixels, width, height, distance, {
    ...options,
    rewriteGeometry(base, context) {
      const geometry = rewrite(base, context),
        snapshot = capture(geometry)
      holder.value = snapshot
      if (!mutate) return geometry
      mutate(snapshot)
      return {
        ...geometry,
        loadAc: (group: number) => {
          const p = snapshot.groups[group]
          if (!p) throw new Error('Missing group')
          return p
        },
      }
    },
  })
  if (!holder.value) throw new Error('Missing captured coefficients')
  return {
    bytes: result.bytes,
    colorBits: result.colorBits,
    captured: holder.value,
    rate: readRateAudit(),
  }
}
const control = await encode('standalone-forward-all'),
  changed = await encode('standalone-rd25-filtered')
if (
  hash(control.bytes) !== hash(await readFile(controlPath)) ||
  hash(changed.bytes) !== hash(await readFile(changedPath))
)
  throw new Error('Capture changed endpoint bytes')
if (control.captured.strategies.some((s, i) => s !== changed.captured.strategies[i]))
  throw new Error('Strategy changed')
interface Change {
  group: number
  channel: number
  index: number
  before: number
  after: number
  x: number
  y: number
  width: number
  height: number
  strategy: number
  frequency: number
  proxySaving: number
}
const changes: Change[] = []
for (let group = 0; group < control.captured.groups.length; group++) {
  const planes = control.captured.groups[group],
    other = changed.captured.groups[group]
  if (!planes || !other) throw new Error('Missing comparison group')
  const ox = (group % control.captured.groupsAcross) * 32,
    oy = Math.floor(group / control.captured.groupsAcross) * 32
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const at = (oy + y) * control.captured.blocksWide + ox + x
      if (control.captured.first[at] !== 1) continue
      const strategy = control.captured.strategies[at] ?? -1,
        bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0,
        bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
      if (!bw || !bh) throw new Error('Bad strategy')
      for (let c = 0; c < 3; c++) {
        const a = planes[c],
          b = other[c],
          offset = a?.coefficientOffsets?.[y * 32 + x]
        if (!a || !b || offset === undefined || offset < 0)
          throw new Error('Missing coefficient offset')
        for (let p = 0; p < bw * bh * 64; p++) {
          const index = offset + p,
            before = a.coefficients[index],
            after = b.coefficients[index]
          if (before === undefined || after === undefined) throw new Error('Missing coefficient')
          if (before === after) continue
          const rate = (q: number) => (q === 0 ? 0 : 1 + 2 * Math.log2(Math.abs(q) + 1))
          changes.push({
            group,
            channel: c,
            index,
            before,
            after,
            x: (ox + x) * 8,
            y: (oy + y) * 8,
            width: bw * 8,
            height: bh * 8,
            strategy,
            frequency: bw * bh === 1 ? (p % 8) * 8 + Math.floor(p / 8) : p,
            proxySaving: rate(before) - rate(after),
          })
        }
      }
    }
}
await writeFile(`${root}/changes.json`, `${JSON.stringify(changes, null, 2)}\n`)
async function measure(name: string, bytes: Uint8Array, colorBits: number, rate: unknown) {
  const artifact = `${root}/${name}.jxl`,
    decoded = `${root}/${name}.png`,
    map = `${root}/${name}.pfm`
  await writeFile(artifact, bytes)
  run(`${oracle}/djxl`, [artifact, decoded, '--num_threads=1', '--bits_per_sample=8'])
  const ba = parseButteraugliOutput(
    run(`${metrics}/butteraugli_main`, [reference, decoded, '--rawdistmap', map]),
  )
  const ssim = parseSsimulacra2Output(run(`${metrics}/ssimulacra2`, [reference, decoded]))
  return {
    name,
    hash: hash(bytes),
    colorBits,
    cost: await encodedSectionCosts(bytes),
    ba,
    ssim,
    rate,
  }
}
const rows = [
  await measure('control', control.bytes, control.colorBits, control.rate),
  await measure('changed', changed.bytes, changed.colorBits, changed.rate),
]
const map = readDistanceMap(await readFile(`${root}/changed.pfm`))
let peak = 0
for (let i = 1; i < map.values.length; i++)
  if ((map.values[i] ?? 0) > (map.values[peak] ?? 0)) peak = i
const peakX = peak % width,
  peakY = Math.floor(peak / width)
const box = {
  x: Math.max(0, Math.min(width - 32, peakX - 16)),
  y: Math.max(0, Math.min(height - 32, peakY - 16)),
  width: 32,
  height: 32,
}
const near = (c: Change) =>
  c.x < box.x + box.width &&
  c.y < box.y + box.height &&
  c.x + c.width > box.x &&
  c.y + c.height > box.y
const cohorts = [
  { name: 'all', select: (_c: Change) => true },
  { name: 'near', select: near },
  { name: 'outside', select: (c: Change) => !near(c) },
  { name: 'zeros', select: (c: Change) => c.after === 0 },
  { name: 'nonzeros', select: (c: Change) => c.after !== 0 },
  ...[0, 1, 2, 3].map((group) => ({
    name: `group-${group}`,
    select: (c: Change) => c.group === group,
  })),
]
const costs = []
const nearby = changes.filter(near)
if (phase !== 'endpoints' && (id !== 'im26-2004' || nearby.length !== 4))
  throw new Error('Pinned local intervention changed')
const singles = new Set(changes.filter((c) => c.after !== 0))
for (let i = 0; i < 20; i++) {
  const change = changes[Math.floor((i * changes.length) / 20)]
  if (change) singles.add(change)
}
const marginal = [
  ...Array.from({ length: 15 }, (_, i) => ({
    name: `mask-${i + 1}`,
    select: (c: Change) => nearby.some((n, bit) => n === c && ((i + 1) & (1 << bit)) !== 0),
  })),
  ...[...singles].map((change, i) => ({
    name: `single-${i}`,
    select: (c: Change) => c === change,
  })),
]
for (const cohort of phase === 'cohorts' ? cohorts : phase === 'marginal' ? marginal : []) {
  const selected = changes.filter(cohort.select)
  const result = await encode('standalone-forward-all', (snapshot) => {
    for (const c of selected) {
      const p = snapshot.groups[c.group]?.[c.channel]
      if (!p || p.coefficients[c.index] !== c.before)
        throw new Error('Intervention baseline differs')
      p.coefficients[c.index] = c.after
    }
  })
  if (cohort.name === 'all' && hash(result.bytes) !== hash(changed.bytes))
    throw new Error('All coefficient changes do not reproduce trial')
  const row = await measure(cohort.name, result.bytes, result.colorBits, result.rate)
  rows.push(row)
  costs.push({
    name: cohort.name,
    count: selected.length,
    changes: selected,
    proxySaving: selected.reduce((s, c) => s + c.proxySaving, 0),
    actualSavingBits: (control.bytes.length - result.bytes.length) * 8,
    colorSavingBits: control.colorBits - result.colorBits,
  })
  const last = costs.at(-1)
  console.log(JSON.stringify({ ...last, changes: undefined }))
}
const luma = (image: PNG) => {
  const out = new Float64Array(width * height)
  for (let p = 0; p < out.length; p++)
    out[p] =
      (0.2126 * (image.data[p * 4] ?? 0) +
        0.7152 * (image.data[p * 4 + 1] ?? 0) +
        0.0722 * (image.data[p * 4 + 2] ?? 0)) /
      255
  return out
}
const source = luma(png),
  local = []
for (const name of phase === 'cohorts'
  ? ['control', 'changed', 'near', 'outside']
  : ['control', 'changed']) {
  const decoded = luma(PNG.sync.read(await readFile(`${root}/${name}.png`)))
  local.push({
    name,
    windows: [16, 32, 64].map((size) => {
      const area = {
        x: Math.max(0, Math.min(width - size, peakX - size / 2)),
        y: Math.max(0, Math.min(height - size, peakY - size / 2)),
        width: size,
        height: size,
      }
      return { box: area, ...windowContrast(source, decoded, width, height, area) }
    }),
  })
}
await writeFile(
  `${root}/audit.json`,
  `${JSON.stringify(
    {
      base: 'ac1fffae',
      id,
      distance,
      fixtureSha256: fixture.fixtureSha256,
      peak: { x: peakX, y: peakY, value: map.values[peak] },
      box,
      changes: changes.length,
      proxySaving: changes.reduce((s, c) => s + c.proxySaving, 0),
      costs,
      local,
      rows,
    },
    null,
    2,
  )}\n`,
)
console.log(JSON.stringify({ peak: { x: peakX, y: peakY }, changes: changes.length, local }))
