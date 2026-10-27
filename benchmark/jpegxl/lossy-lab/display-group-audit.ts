/** Larger fixed development interventions to distinguish loss-model error from tiny score changes. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { metrics, oracle } from '../comparison/io.ts'
import { encodeTransplant } from './transplant.ts'
import { libjxlPortOverrides } from './libjxl-ports.ts'
import { parseSsimulacra2Output } from './metrics.ts'
import { displayAuditTransforms, transformSquareRgba } from './display-audit-transform.ts'
import { displayLinearPlanes, displayLossPyramid } from './libjxl-display-loss.ts'
const [root, sizeArgument = '128'] = process.argv.slice(2)
if (!root) throw new Error('Need fresh output root')
const regionSize = Number(sizeArgument)
if (regionSize !== 128 && regionSize !== 512) throw new Error('Region size must be 128 or 512')
await mkdir(root, { recursive: true })
const cases = []
const binaryHash = createHash('sha256')
  .update(await readFile(`${metrics}/ssimulacra2`))
  .digest('hex')
for (const [id, distance] of [
  ['im26-3012', 2],
  ['im26-3312', 4],
] as const) {
  const directory = `${root}/${id}`
  await mkdir(directory)
  const sourcePath = `.tmp/jpegxl-lossy-lab/corpus-512-v2/${id}.png`
  const sourceBytes = await readFile(sourcePath),
    source = PNG.sync.read(sourceBytes)
  if (source.width !== 512 || source.height !== 512)
    throw new Error('Expected 512 development crop')
  const sourcePlanes = displayLinearPlanes(source.data, 512, 512)
  const overrides = libjxlPortOverrides('standalone-forward-all', distance, 512, 512)
  const rewrite = overrides.rewriteGeometry
  if (!rewrite) throw new Error('Missing standalone rewrite')
  for (const kind of displayAuditTransforms) {
    const png = new PNG({ width: 512, height: 512 })
    png.data.set(transformSquareRgba(source.data, 512, kind))
    await writeFile(`${directory}/source-${kind}.png`, PNG.sync.write(png))
  }
  async function encode(x: number, y: number) {
    const result = await encodeTransplant(Uint8Array.from(source.data), 512, 512, distance, {
      ...overrides,
      rewriteGeometry(base, context) {
        if (!rewrite) throw new Error('Missing standalone rewrite')
        const geometry = rewrite(base, context),
          map = geometry.sharpnessMap
        if (!map) throw new Error('Missing sharpness map')
        map.fill(4)
        if (x >= 0)
          for (let by = y / 8; by < (y + regionSize) / 8; by++)
            map.fill(
              7,
              by * geometry.blocksWide + x / 8,
              by * geometry.blocksWide + (x + regionSize) / 8,
            )
        return geometry
      },
    })
    const name = x < 0 ? 'control' : `${x}-${y}`
    await writeFile(`${directory}/${name}.jxl`, result.bytes)
    execFileSync(
      `${oracle}/djxl`,
      [
        `${directory}/${name}.jxl`,
        `${directory}/${name}.png`,
        '--num_threads=1',
        '--bits_per_sample=8',
      ],
      { stdio: 'pipe' },
    )
    const png = PNG.sync.read(await readFile(`${directory}/${name}.png`))
    const scores = []
    for (const kind of displayAuditTransforms) {
      const transformed = new PNG({ width: 512, height: 512 })
      transformed.data.set(transformSquareRgba(png.data, 512, kind))
      const file = `${directory}/score.png`
      await writeFile(file, PNG.sync.write(transformed))
      scores.push({
        kind,
        score: parseSsimulacra2Output(
          execFileSync(`${metrics}/ssimulacra2`, [`${directory}/source-${kind}.png`, file], {
            encoding: 'utf8',
          }),
        ),
      })
    }
    const planes = displayLinearPlanes(png.data, 512, 512)
    const loss = displayLossPyramid(sourcePlanes, planes, 512, 512, 'rgb', 6, {
      radius: 4,
      border: 'zero',
      moment64: true,
    }).reduce((a, b) => a + b, 0)
    return {
      bytes: result.bytes.length,
      sha256: createHash('sha256').update(result.bytes).digest('hex'),
      scores,
      loss,
    }
  }
  const control = await encode(-1, -1),
    rows = []
  for (let y = 0; y < 512; y += regionSize)
    for (let x = 0; x < 512; x += regionSize) {
      const result = await encode(x, y)
      const deltas = result.scores.map(({ kind, score }, i) => ({
        kind,
        delta: score - (control.scores[i]?.score ?? Number.NaN),
      }))
      const min = Math.min(...deltas.map((r) => r.delta)),
        max = Math.max(...deltas.map((r) => r.delta))
      const predicted = control.loss - result.loss
      rows.push({
        x,
        y,
        ...result,
        deltas,
        min,
        max,
        stable: min > 0 || max < 0,
        predicted,
        originalCorrect: Math.sign(predicted) === Math.sign(deltas[0]?.delta ?? 0),
      })
    }
  const summary = {
    id,
    distance,
    stable: rows.filter((r) => r.stable).length,
    stableCorrect: rows.filter((r) => r.stable && r.originalCorrect).length,
    originalCorrect: rows.filter((r) => r.originalCorrect).length,
    harmful: rows.filter((r) => (r.deltas[0]?.delta ?? 0) < 0).length,
    maximumOrientationRange: Math.max(...rows.map((r) => r.max - r.min)),
  }
  cases.push({
    summary,
    sourcePath,
    sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    control,
    rows,
  })
  console.log(JSON.stringify(summary))
}
await writeFile(
  `${root}/report.json`,
  `${JSON.stringify({ base: 'd9681032', regionSize, binaryHash, holdoutOpened: false, cases }, null, 2)}\n`,
)
