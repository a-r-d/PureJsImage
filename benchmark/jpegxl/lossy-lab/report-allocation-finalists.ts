import { readFile, writeFile } from 'node:fs/promises'
import { number, object } from '../comparison/model.ts'

const root = '.tmp/jpegxl-lossy-lab/allocation-20261014'
const grid = object(JSON.parse(await readFile(`${root}/report.json`, 'utf8')))
const metrics = ['ssimulacra2', 'butteraugliNorm3', 'butteraugliMax'] as const
if (!Array.isArray(grid.bestTwo)) throw new Error('Missing finalists')
const names = [
  'gaborish',
  ...grid.bestTwo.map((value) => {
    const row = object(value)
    if (typeof row.name !== 'string') throw new Error('Missing finalist name')
    return row.name
  }),
]
const rows = await Promise.all(
  names.map(async (name) => {
    const directory = `${root}/${name}-lab`
    const comparison = object(
      JSON.parse(await readFile(`${directory}/against-control.json`, 'utf8')),
    )
    const summary = object(JSON.parse(await readFile(`${directory}/summary.json`, 'utf8')))
    if (
      !Array.isArray(comparison.peers) ||
      !Array.isArray(comparison.control) ||
      !Array.isArray(summary.failures) ||
      summary.failures.length
    )
      throw new Error('Incomplete finalist report')
    const peers = comparison.peers.map(object),
      own = comparison.control.map(object)
    const values = (peer: string) =>
      metrics.map((metric) => {
        const row = peers.find((r) => r.peer === peer && r.metric === metric)
        if (row?.count !== 64) throw new Error('Incomplete finalist comparison')
        return number(row.mean)
      })
    const vips = values('vips'),
      jsquash = values('jsquash')
    const control = metrics.map((metric) => {
      const row = own.find((r) => r.metric === metric)
      if (row?.count !== 64) throw new Error('Incomplete control comparison')
      return number(row.mean)
    })
    if (!Array.isArray(summary.speed)) throw new Error('Missing diagnostic timing')
    const speed = summary.speed.map(object).find((r) => r.engine === 'purejsimage')
    if (!speed) throw new Error('Missing own timing')
    const mean = vips.reduce((a, b) => a + b, 0) / 3
    return {
      name,
      medianMs: number(object(speed.lab).median),
      vips,
      jsquash,
      control,
      mean,
      maximum: Math.max(...vips),
      usesPeerMaps: name === 'gaborish',
      numericalObjectivePassed: mean <= 2 && Math.max(...vips) <= 5,
      objectivePassed: name !== 'gaborish' && mean <= 2 && Math.max(...vips) <= 5,
      managedPeakBytes: summary.managedPeakBytes,
      processPeakRssBytes: summary.processPeakRssBytes,
      speed: summary.speed,
      comparison,
    }
  }),
)
const gaborishDirect = JSON.parse(
  await readFile(`${root}/gaborish-lab/against-mathematical.json`, 'utf8'),
) as unknown
const best = [...rows.filter((r) => r.name !== 'gaborish')].sort(
  (a, b) => Number(a.maximum > 5) - Number(b.maximum > 5) || a.mean - b.mean,
)[0]
if (!best) throw new Error('Missing best full-lab point')
const final = {
  ...grid,
  fullLab: rows,
  gaborishDirect,
  best,
  selectorSpeedEstimate: {
    prototypeMedianMs: 4814.3111715000005,
    nativeMapReplayMedianMs: 1047.3728465000002,
    addedMs: 3766.938325,
    ratio: 4814.3111715000005 / 1047.3728465000002,
    scope:
      'Prior four-worker screen medians. Includes selector, quantization-field aggregation and a different inverse kernel. Diagnostic estimate only, not isolated selector timing or a speed qualification.',
  },
  ownEncodedPoints: 4288,
}
await writeFile(
  'benchmark/jpegxl/lossy-lab/ALLOCATION-REPORT.json',
  `${JSON.stringify(final, null, 2)}\n`,
)
const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`
await writeFile(
  `${root}/full-table.md`,
  '| Full 64-photo lab | vips SSIM / 3-norm / max (%) | Mean (%) | Control SSIM / 3-norm / max (%) | jSquash SSIM / 3-norm / max (%) | Own median ms |\n| --- | ---: | ---: | ---: | ---: | ---: |\n' +
    rows
      .map(
        (r) =>
          `| ${r.name} | ${r.vips.map(fmt).join(' / ')} | ${fmt(r.mean)} | ${r.control.map(fmt).join(' / ')} | ${r.jsquash.map(fmt).join(' / ')} | ${r.medianMs.toFixed(1)} |`,
      )
      .join('\n') +
    '\n',
)
console.log(
  JSON.stringify(
    {
      best: {
        name: best.name,
        vips: best.vips,
        mean: best.mean,
        objectivePassed: best.objectivePassed,
      },
      rows: rows.map(({ name, vips, mean, control, jsquash, objectivePassed }) => ({
        name,
        vips,
        mean,
        control,
        jsquash,
        objectivePassed,
      })),
    },
    null,
    2,
  ),
)
