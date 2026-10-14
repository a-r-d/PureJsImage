import { readFile, writeFile } from 'node:fs/promises'
import { number, object } from '../comparison/model.ts'

const root = '.tmp/jpegxl-lossy-lab/allocation-20261014'
const metrics = ['ssimulacra2', 'butteraugliNorm3', 'butteraugliMax'] as const
const rows = (await readFile(`${root}/completed.jsonl`, 'utf8'))
  .trim()
  .split('\n')
  .map((line) => {
    const row = object(JSON.parse(line))
    if (
      typeof row.name !== 'string' ||
      typeof row.directory !== 'string' ||
      !Array.isArray(row.peers) ||
      !Array.isArray(row.control)
    )
      throw new Error('Malformed completed allocation point')
    const peers = row.peers.map(object),
      own = row.control.map(object)
    const values = (peer: string) =>
      metrics.map((metric) => {
        const value = peers.find((r) => r.peer === peer && r.metric === metric)
        if (value?.count !== 16) throw new Error('Incomplete peer comparison')
        return number(value.mean)
      })
    const vips = values('vips'),
      jsquash = values('jsquash')
    const control = metrics.map((metric) => {
      const value = own.find((r) => r.metric === metric)
      if (value?.count !== 16) throw new Error('Incomplete control comparison')
      return number(value.mean)
    })
    if (!Array.isArray(row.speed)) throw new Error('Missing diagnostic timing')
    const speed = row.speed.map(object).find((r) => r.engine === 'purejsimage')
    if (!speed) throw new Error('Missing own timing')
    return {
      medianMs: number(object(speed.lab).median),
      name: row.name,
      directory: row.directory,
      alpha: number(row.alpha),
      acScale: number(row.acScale),
      smoothing: row.smoothing,
      vips,
      jsquash,
      control,
      mean: vips.reduce((a, b) => a + b, 0) / 3,
      maximum: Math.max(...vips),
    }
  })
const ranked = [...rows].sort(
  (a, b) => Number(a.maximum > 5) - Number(b.maximum > 5) || a.mean - b.mean,
)
const frontier = rows.filter(
  (row) =>
    !rows.some(
      (other) =>
        (other.vips[0] ?? Infinity) <= (row.vips[0] ?? Infinity) &&
        (other.vips[1] ?? Infinity) <= (row.vips[1] ?? Infinity) &&
        ((other.vips[0] ?? Infinity) < (row.vips[0] ?? Infinity) ||
          (other.vips[1] ?? Infinity) < (row.vips[1] ?? Infinity)),
    ),
)
const report = {
  base: '120e0675',
  ranking:
    'Prefer points with every screen metric <=5%, then ascending three-metric mean; if none qualify, ascending mean.',
  metrics,
  rows,
  frontier: frontier.map((r) => r.name),
  bestTwo: ranked.slice(0, 2),
  evidence: await Promise.all(
    rows.map(async (r) => {
      const summary = object(JSON.parse(await readFile(`${r.directory}/summary.json`, 'utf8')))
      return {
        name: r.name,
        resources: {
          managedPeakBytes: summary.managedPeakBytes,
          processPeakRssBytes: summary.processPeakRssBytes,
          elapsedSeconds: summary.elapsedSeconds,
        },
        comparison: JSON.parse(
          await readFile(`${r.directory}/against-control.json`, 'utf8'),
        ) as unknown,
      }
    }),
  ),
}
await writeFile(`${root}/report.json`, `${JSON.stringify(report, null, 2)}\n`)
const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`
await writeFile(
  `${root}/table.md`,
  '| Point | vips SSIM / 3-norm / max (%) | Mean (%) | Control SSIM / 3-norm / max (%) | Own median ms |\n| --- | ---: | ---: | ---: | ---: |\n' +
    rows
      .map(
        (r) =>
          `| ${r.name} | ${r.vips.map(fmt).join(' / ')} | ${fmt(r.mean)} | ${r.control.map(fmt).join(' / ')} | ${r.medianMs.toFixed(1)} |`,
      )
      .join('\n') +
    '\n',
)
const zoom = process.argv.includes('--zoom')
const xMin = zoom ? -7 : Math.floor(Math.min(...rows.map((r) => r.vips[0] ?? 0)) / 5) * 5 - 1
const xMax = zoom ? 6 : Math.ceil(Math.max(...rows.map((r) => r.vips[0] ?? 0)) / 5) * 5 + 1
const yMin = zoom ? -2 : Math.floor(Math.min(...rows.map((r) => r.vips[1] ?? 0)) / 2) * 2 - 1
const yMax = zoom ? 10 : Math.ceil(Math.max(...rows.map((r) => r.vips[1] ?? 0)) / 2) * 2 + 1
const x = (v: number) => 85 + ((v - xMin) / (xMax - xMin)) * 780
const y = (v: number) => 580 - ((v - yMin) / (yMax - yMin)) * 465
const svg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="740" viewBox="0 0 1050 740" role="img" aria-labelledby="allocation-title">',
  '<title id="allocation-title">DC and AC allocation: SSIMULACRA2 versus Butteraugli 3-norm BD-rate frontier</title>',
  '<rect width="1050" height="740" fill="#ffffff"/><g font-family="sans-serif" fill="#182b3a">',
  '<text x="70" y="38" font-size="23">DC/AC allocation frontier • 16-photo screen</text>',
  '<text x="70" y="65" font-size="14">BD-rate against wasm-vips; lower is better. Partial quality-band overlap.</text>',
]
for (let i = 0; i <= 6; i++) {
  const xv = xMin + ((xMax - xMin) * i) / 6,
    yv = yMin + ((yMax - yMin) * i) / 6
  svg.push(
    `<path d="M ${x(xv)} 115 V 580 M 85 ${y(yv)} H 865" stroke="#dde4e9" fill="none"/>`,
    `<text x="${x(xv)}" y="606" text-anchor="middle" font-size="13">${xv.toFixed(1)}%</text>`,
    `<text x="72" y="${y(yv) + 4}" text-anchor="end" font-size="13">${yv.toFixed(1)}%</text>`,
  )
}
svg.push(
  `<polyline points="${[...frontier]
    .sort((a, b) => (a.vips[0] ?? 0) - (b.vips[0] ?? 0))
    .map((r) => `${x(r.vips[0] ?? 0)},${y(r.vips[1] ?? 0)}`)
    .join(' ')}" fill="none" stroke="#132e48" stroke-width="2"/>`,
)
const colors = ['#2463a0', '#168c83', '#b68b10', '#d86632', '#944aa7']
for (const r of rows) {
  if (
    (r.vips[0] ?? 0) < xMin ||
    (r.vips[0] ?? 0) > xMax ||
    (r.vips[1] ?? 0) < yMin ||
    (r.vips[1] ?? 0) > yMax
  )
    continue
  const cx = x(r.vips[0] ?? 0),
    cy = y(r.vips[1] ?? 0),
    color = colors[Math.round(r.alpha * 4)] ?? '#333'
  svg.push(
    `<circle cx="${cx}" cy="${cy}" r="${4 + r.acScale * 2}" fill="${r.smoothing === 'on' ? color : '#ffffff'}" stroke="${color}" stroke-width="2"><title>${r.name}: ${r.vips.map(fmt).join(' / ')}, mean ${fmt(r.mean)}</title></circle>`,
  )
  const rank = ranked.slice(0, 2).findIndex((best) => best.name === r.name)
  if (rank >= 0)
    svg.push(
      `<text x="${cx + 12}" y="${cy + (rank === 0 ? 22 : -12)}" font-size="12">${r.name}</text>`,
    )
}
svg.push(
  '<text x="465" y="646" text-anchor="middle" font-size="17">SSIMULACRA2 BD-rate (%)</text>',
  '<text x="23" y="350" transform="rotate(-90 23 350)" text-anchor="middle" font-size="17">Butteraugli 3-norm BD-rate (%)</text>',
  '<text x="85" y="685" font-size="14">Filled: smoothing on • Open: smoothing off • Larger circles: greater AC precision</text>',
)
for (let i = 0; i < 5; i++)
  svg.push(
    `<circle cx="905" cy="${150 + i * 33}" r="6" fill="${colors[i]}"/><text x="922" y="${155 + i * 33}" font-size="14">α = ${i / 4}</text>`,
  )
svg.push('</g></svg>')
await writeFile(`${root}/${zoom ? 'frontier-zoom' : 'frontier'}.svg`, svg.join('\n'))
console.log(
  JSON.stringify(
    { count: rows.length, bestTwo: report.bestTwo, frontier: report.frontier },
    null,
    2,
  ),
)
