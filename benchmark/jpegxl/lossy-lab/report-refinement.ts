import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { object } from '../comparison/model.ts'

const [root, ...names] = process.argv.slice(2)
if (!root || !names.length) throw new Error('Usage: report-refinement.ts root run-name...')
const read = async (path: string) => object(JSON.parse(await readFile(path, 'utf8')))
const runs = []
for (const name of names) {
  const path = join(root, name)
  const summary = await read(join(path, 'summary.json'))
  const paired = await read(join(path, 'against-control.json'))
  const images = summary.mode === 'lab' ? 64 : summary.mode === 'screen' ? 16 : 0
  const distances = summary.mode === 'lab' ? 9 : 5
  const own = Array.isArray(summary.speed)
    ? summary.speed.map(object).find((row) => row.engine === 'purejsimage')
    : undefined
  if (
    !images ||
    summary.selectedImages !== images ||
    !Array.isArray(summary.distances) ||
    summary.distances.length !== distances ||
    !own ||
    object(own.lab).count !== images * distances ||
    !Array.isArray(summary.failures) ||
    summary.failures.length !== 0
  )
    throw new Error(`Incomplete quality run: ${name}`)
  runs.push({
    name,
    variant: summary.variant,
    selectedImages: summary.selectedImages,
    distances: summary.distances,
    peers: summary.table,
    checkpoint: paired.control,
    comparisons: paired.comparisons,
    ...(summary.mode === 'lab'
      ? {
          production: await read(join(path, 'against-production.json')),
          nativeReplay: await read(join(path, 'against-native.json')),
        }
      : {}),
    diagnosticSpeed: summary.speed,
    managedPeakBytes: summary.managedPeakBytes,
    processPeakRssBytes: summary.processPeakRssBytes,
    failures: summary.failures,
    coverageWarnings: summary.omissions,
  })
}
const speed = await read(join(root, 'refined-speed', 'summary.json'))
if (
  speed.mode !== 'speed' ||
  speed.workers !== 1 ||
  speed.measuredSpeedJobs !== 192 ||
  speed.complete !== true ||
  !Array.isArray(speed.omissions) ||
  speed.omissions.length !== 0 ||
  speed.selectedImages !== 64 ||
  !Array.isArray(speed.failures) ||
  speed.failures.length
)
  throw new Error('Need a completed isolated 64-photo speed run')
const report = {
  sourceBase: '98183404',
  branch: 'jxl-libjxl-ports',
  root,
  runs,
  isolatedSpeed: speed,
  cumulativePairs: await read(join(root, 'cumulative-speed.json')),
  neighboringPairs: await read(join(root, 'neighbor-speed.json')),
}
await writeFile(
  'benchmark/jpegxl/lossy-lab/REFINEMENT-REPORT.json',
  `${JSON.stringify(report, null, 2)}\n`,
)
console.log(runs.map((run) => ({ name: run.name, peers: run.peers, checkpoint: run.checkpoint })))
