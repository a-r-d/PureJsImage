import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractDecisions, type TransplantDecisions } from './decisions.ts'

const root = '.tmp/jpegxl-lossy-lab'
const control = `${root}/transplant-20261013-v2/control/screen/transplant-control-purejsimage`
const peer = `${root}/transplant-20261013/vips`
const dcPort = `${root}/ports-20261013/dc-screen/port-dc-purejsimage`
const median = (values: number[]): number => {
  const sorted = values.slice().sort((a, b) => a - b)
  const n = sorted.length
  if (!n) throw new Error('Empty audit population')
  return ((sorted[Math.floor((n - 1) / 2)] ?? 0) + (sorted[Math.floor(n / 2)] ?? 0)) / 2
}
function precision(d: TransplantDecisions) {
  return {
    globalScale: d.globalScale,
    quantDc: d.quantDc,
    dcStep: d.dcQuantization.map((q) => (q * 65536) / d.globalScale / d.quantDc),
    acPrecision: median(d.rawQuantization.map((q) => (q * d.globalScale) / 65536)),
    xScale: d.xQuantizationScale,
    bScale: d.bQuantizationScale,
    smoothDc: d.smoothDc,
    dcCorrelation: [d.colorCorrelation.yToXDc, d.colorCorrelation.yToBDc],
    strategyCounts: Array.from(
      { length: 21 },
      (_, s) => d.strategies.filter((v) => v === s).length,
    ),
  }
}
const rows: {
  id: string
  distance: number
  own: ReturnType<typeof precision>
  native: ReturnType<typeof precision>
  dc: ReturnType<typeof precision>
  dcStepRatio: number[]
  dcPortRatio: number[]
  acPrecisionRatio: number
  xMatrixRatio: number
  bMatrixRatio: number
}[] = []
for (const id of await readdir(control))
  for (const distance of [0.5, 1, 2, 4, 7]) {
    const own = precision(
      await extractDecisions(await readFile(join(control, id, `${distance}.jxl`))),
    )
    const native = precision(
      await extractDecisions(
        await readFile(join(peer, id.replace(/-lab$/u, ''), `${distance}.jxl`)),
      ),
    )
    const dc = precision(
      await extractDecisions(await readFile(join(dcPort, id, `${distance}.jxl`))),
    )
    rows.push({
      id,
      distance,
      own,
      native,
      dc,
      dcStepRatio: native.dcStep.map((v, c) => v / (own.dcStep[c] ?? 1)),
      dcPortRatio: dc.dcStep.map((v, c) => v / (native.dcStep[c] ?? 1)),
      acPrecisionRatio: native.acPrecision / own.acPrecision,
      xMatrixRatio: 0.8 ** (native.xScale - own.xScale),
      bMatrixRatio: 0.8 ** (native.bScale - own.bScale),
    })
  }
const summary = [0.5, 1, 2, 4, 7].map((distance) => {
  const selected = rows.filter((r) => r.distance === distance)
  return {
    distance,
    count: selected.length,
    medianDcStepRatio: [0, 1, 2].map((c) => median(selected.map((r) => r.dcStepRatio[c] ?? 0))),
    medianDcPortRatio: [0, 1, 2].map((c) => median(selected.map((r) => r.dcPortRatio[c] ?? 0))),
    medianAcPrecisionRatio: median(selected.map((r) => r.acPrecisionRatio)),
    medianXMatrixRatio: median(selected.map((r) => r.xMatrixRatio)),
    medianBMatrixRatio: median(selected.map((r) => r.bMatrixRatio)),
    nonzeroNativeDcCorrelation: selected.filter((r) => r.native.dcCorrelation.some((v) => v !== 0))
      .length,
  }
})
await writeFile(
  `${root}/coupled-20261013/quantization-audit.json`,
  JSON.stringify({ summary, rows }, null, 2) + '\n',
)
console.log(JSON.stringify(summary, null, 2))
