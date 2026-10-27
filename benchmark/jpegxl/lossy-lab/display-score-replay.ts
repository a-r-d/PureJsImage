/** Public metric replay on fixed development PNGs, including geometric invariance checks. */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { metrics } from '../comparison/io.ts'
import { parseSsimulacra2Output } from './metrics.ts'
import { number, object } from '../comparison/model.ts'
import { displayAuditTransforms, transformSquareRgba } from './display-audit-transform.ts'
const [outputRoot] = process.argv.slice(2)
if (!outputRoot) throw new Error('Need output directory')
await mkdir(outputRoot, { recursive: true })
const root = '.tmp/jpegxl-lossy-lab/filter-loss-20261018'
const cases = []
for (const name of ['region-audit-v2', 'texture-region-audit-v2']) {
  const directory = `${root}/${name}`
  const report = object(JSON.parse(await readFile(`${directory}/report.json`, 'utf8')))
  if (
    typeof report.inputPath !== 'string' ||
    !report.inputPath.startsWith('.tmp/jpegxl-lossy-lab/corpus-512-v2/') ||
    !Array.isArray(report.rows)
  )
    throw new Error('Invalid development report')
  const summary = object(report.summary)
  const source = PNG.sync.read(await readFile(report.inputPath))
  const rows = []
  for (const kind of displayAuditTransforms) {
    const ref = `${outputRoot}/source.png`,
      dst = `${outputRoot}/output.png`
    const referencePng = new PNG({ width: 512, height: 512 })
    referencePng.data.set(transformSquareRgba(source.data, 512, kind))
    await writeFile(ref, PNG.sync.write(referencePng))
    async function score(file: string): Promise<number> {
      const png = PNG.sync.read(await readFile(file))
      if (png.width !== 512 || png.height !== 512) throw new Error('Expected fixed 512 crop')
      const outputPng = new PNG({ width: 512, height: 512 })
      outputPng.data.set(transformSquareRgba(png.data, 512, kind))
      await writeFile(dst, PNG.sync.write(outputPng))
      return parseSsimulacra2Output(
        execFileSync(`${metrics}/ssimulacra2`, [ref, dst], { encoding: 'utf8' }),
      )
    }
    const control = await score(`${directory}/control.png`)
    const changes = []
    for (const value of report.rows) {
      const row = object(value),
        x = number(row.x),
        y = number(row.y)
      if (x % 128 || y % 128 || x < 0 || y < 0 || x > 384 || y > 384)
        throw new Error('Invalid fixed intervention')
      const changed = await score(`${directory}/${x / 64}-${y / 64}.png`)
      changes.push({ x, y, storedDelta: number(row.ssimDelta), delta: changed - control })
    }
    const result = {
      kind,
      control,
      controlDifference: control - number(summary.controlScore),
      signAgreement: changes.filter((r) => Math.sign(r.delta) === Math.sign(r.storedDelta)).length,
      maximumDeltaDifference: Math.max(...changes.map((r) => Math.abs(r.delta - r.storedDelta))),
      changes,
    }
    rows.push(result)
    console.log(JSON.stringify({ name, ...result, changes: undefined }))
  }
  cases.push({ name, rows })
}
await writeFile(
  `${outputRoot}/report.json`,
  `${JSON.stringify({ base: 'd9681032', holdoutOpened: false, cases }, null, 2)}\n`,
)
