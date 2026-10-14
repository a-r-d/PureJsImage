import { readFile, writeFile } from 'node:fs/promises'
import { number, object } from '../comparison/model.ts'

const [root, ...names] = process.argv.slice(2)
if (!root || !names.length) throw new Error('Usage: report-standalone.ts root run-name...')
const metrics = ['ssimulacra2', 'butteraugliNorm3', 'butteraugliMax'] as const
const rows = []
for (const name of names) {
  if (!/^[a-z-]+$/u.test(name)) throw new Error('Invalid run name')
  const directory = `${root}/${name}`
  const summary = object(JSON.parse(await readFile(`${directory}/summary.json`, 'utf8')))
  const control = object(JSON.parse(await readFile(`${directory}/against-control.json`, 'utf8')))
  const native = object(JSON.parse(await readFile(`${directory}/against-native.json`, 'utf8')))
  if (
    !Array.isArray(summary.table) ||
    !Array.isArray(summary.speed) ||
    !Array.isArray(summary.failures) ||
    summary.failures.length ||
    !Array.isArray(control.control) ||
    !Array.isArray(native.control)
  )
    throw new Error(`Incomplete run: ${name}`)
  const expected = summary.mode === 'lab' ? 64 : 16
  const peers = summary.table.map(object)
  const values = (records: readonly unknown[], peer?: string) =>
    metrics.map((metric) => {
      const row = records.map(object).find((r) => r.metric === metric && (!peer || r.peer === peer))
      if (!row || row.count !== expected) throw new Error(`Incomplete metric: ${name}/${metric}`)
      return number(row.mean)
    })
  const vips = values(peers, 'vips'),
    jsquash = values(peers, 'jsquash')
  const own = values(control.control),
    replay = values(native.control)
  const speed = summary.speed.map(object).find((r) => r.engine === 'purejsimage')
  if (!speed) throw new Error('Missing own timing')
  const mean = vips.reduce((a, b) => a + b, 0) / 3
  rows.push({
    name,
    directory,
    images: expected,
    usesPeerMaps: false,
    vips,
    mean,
    jsquash,
    control: own,
    nativeReplay: replay,
    numericalObjectivePassed: mean <= 2 && Math.max(...vips) <= 5,
    nativeReplayGatePassed: Math.max(...replay) <= 1,
    medianMs: number(object(speed.lab).median),
    managedPeakBytes: summary.managedPeakBytes,
    processPeakRssBytes: summary.processPeakRssBytes,
    controlComparisons: control.comparisons,
    nativeComparisons: native.comparisons,
    peerComparisons: summary.comparisons,
    omissions: summary.omissions,
  })
}
const speedDirectory = `${root}/direct-speed`
const speedSummary = object(JSON.parse(await readFile(`${speedDirectory}/summary.json`, 'utf8')))
if (
  speedSummary.mode !== 'speed' ||
  speedSummary.workers !== 1 ||
  !Array.isArray(speedSummary.speed) ||
  !Array.isArray(speedSummary.failures) ||
  speedSummary.failures.length
)
  throw new Error('Incomplete isolated speed run')
const speedRows = speedSummary.speed.map(object)
const speedMedian = (engine: string): number => {
  const row = speedRows.find((r) => r.engine === engine)
  if (!row) throw new Error('Missing speed engine')
  const values = object(row.lab)
  if (values.count !== 64) throw new Error('Incomplete crop speed set')
  return number(values.median)
}
const ratio = speedMedian('purejsimage') / speedMedian('jsquash')
const isolatedSpeed = {
  directory: speedDirectory,
  ratio,
  cropSpeedGatePassed: ratio <= 3,
  summary: speedSummary,
}
await writeFile(
  'benchmark/jpegxl/lossy-lab/STANDALONE-REPORT.json',
  `${JSON.stringify({ baseRevision: '5cc00559', metricOrder: metrics, timing: 'Four-worker quality sweep diagnostics, not isolated speed qualification.', isolatedSpeed, rows }, null, 2)}\n`,
)
const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`
await writeFile(
  `${root}/table.md`,
  '| Run | vips SSIM / 3-norm / max (%) | Mean (%) | Control (%) | Native replay (%) | jSquash (%) | Own median ms |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n' +
    rows
      .map(
        (r) =>
          `| ${r.name} | ${r.vips.map(fmt).join(' / ')} | ${fmt(r.mean)} | ${r.control.map(fmt).join(' / ')} | ${r.nativeReplay.map(fmt).join(' / ')} | ${r.jsquash.map(fmt).join(' / ')} | ${r.medianMs.toFixed(1)} |`,
      )
      .join('\n') +
    '\n',
)
console.log(
  JSON.stringify(
    rows.map(({ name, vips, mean, nativeReplay, medianMs }) => ({
      name,
      vips,
      mean,
      nativeReplay,
      medianMs,
    })),
    null,
    2,
  ),
)
