import { readFile, writeFile } from 'node:fs/promises'
import { number, object, string } from '../comparison/model.ts'
import { parsePreparedManifest } from './fixture-selection.ts'

const [root] = process.argv.slice(2)
if (!root) throw new Error('Need rate audit root')
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
function nullable(value: unknown): number | null {
  return value === null ? null : number(value)
}
function sample(value: unknown) {
  const row = object(value)
  if (!Array.isArray(row.rate) || row.rate.length !== 1)
    throw new Error('Expected one instrumented serialization')
  const rate = object(row.rate[0]),
    adaptive = object(rate.adaptive),
    frozen = object(rate.frozen)
  return {
    name: string(row.name),
    hash: string(row.hash),
    actual: number(row.colorBits),
    order: nullable(rate.orderEstimate),
    header: number(rate.componentBits) + number(rate.hfBits),
    adaptive: number(adaptive.estimated),
    exact: number(adaptive.exact),
    frozen: nullable(frozen.estimated),
    frozenExact: nullable(frozen.exact),
    missing: number(frozen.missing),
  }
}
const rows = []
for (const path of [
  ...manifest.screenIds.map((id) => `${root}/screen/${id}`),
  `${root}/marginal`,
]) {
  const audit = object(JSON.parse(await readFile(`${path}/audit.json`, 'utf8'))),
    id = string(audit.id)
  if (!manifest.fixtures.some((f) => f.id === id && f.split === 'development' && f.kind === 'lab'))
    throw new Error('Not development')
  if (!Array.isArray(audit.rows)) throw new Error('Missing rate rows')
  const samples = audit.rows.map(sample),
    base = samples.find((r) => r.name === 'control')
  if (!base) throw new Error('Missing control')
  for (const row of samples) {
    if (row.name === 'control' || (path.endsWith('/marginal') && row.name === 'changed')) continue
    const actual = base.actual - row.actual,
      reconstructed = base.header + base.exact - row.header - row.exact
    if (actual !== reconstructed)
      throw new Error(`Unaccounted bits: ${id} ${row.name} ${actual} != ${reconstructed}`)
    rows.push({
      id,
      name: row.name,
      baseHash: base.hash,
      hash: row.hash,
      actual,
      payload: base.exact - row.exact,
      metadata: base.header - row.header,
      order: base.order === null || row.order === null ? null : base.order - row.order,
      frozen: base.frozen === null || row.frozen === null ? null : base.frozen - row.frozen,
      frozenExact:
        base.frozenExact === null || row.frozenExact === null
          ? null
          : base.frozenExact - row.frozenExact,
      adaptive: base.header + base.adaptive - row.header - row.adaptive,
      missing: row.missing,
    })
  }
}
const summaries = []
for (const subset of ['screen', 'marginal'] as const) {
  const selected = rows.filter((r) => (r.name === 'changed') === (subset === 'screen'))
  for (const predictor of ['order', 'frozen', 'frozenExact', 'adaptive'] as const) {
    let absolute = 0,
      maxError = 0,
      signs = 0,
      nonzero = 0,
      missing = 0,
      falseSavings = 0
    for (const row of selected) {
      const predicted = row[predictor]
      if (predicted === null) {
        missing++
        continue
      }
      const error = Math.abs(predicted - row.actual)
      absolute += error
      maxError = Math.max(maxError, error)
      if (row.actual !== 0) {
        nonzero++
        if (Math.sign(predicted) === Math.sign(row.actual)) signs++
      }
      if (row.actual <= 0 && predicted > 1e-6) falseSavings++
    }
    summaries.push({
      subset,
      predictor,
      count: selected.length,
      missing,
      nonzero,
      correctSign: signs,
      falseSavings,
      maeBits: absolute / (selected.length - missing),
      maxErrorBits: maxError,
    })
  }
}
await writeFile(`${root}/rate-summary.json`, `${JSON.stringify({ rows, summaries }, null, 2)}\n`)
console.log(JSON.stringify(summaries, null, 2))
