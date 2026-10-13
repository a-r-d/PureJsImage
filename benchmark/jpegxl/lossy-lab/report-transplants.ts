import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { number, object } from '../comparison/model.ts'
import { parsePreparedManifest, selectPreparedFixtures } from './fixture-selection.ts'
import { bdRate, type QualityMetric, summarizeBdRates } from './metrics.ts'
import { parsePoint } from './model.ts'

const root = process.argv[2] ?? '.tmp/jpegxl-lossy-lab/transplant-20261013-v2'
const strategyRoot = process.argv[3] ?? '.tmp/jpegxl-lossy-lab/replay-v4'
const replayRoot = process.argv[4] ?? '.tmp/jpegxl-lossy-lab/replay-v5'
const allRoot = process.argv[5] ?? '.tmp/jpegxl-lossy-lab/replay-v6'
const peerRoot = '.tmp/jpegxl-lossy-lab/transplant-20261013'
const components = [
  'control',
  'quant',
  'dc',
  'cfl',
  'filters',
  'available',
  'strategy',
  'features',
  'all',
]
const metrics: readonly QualityMetric[] = ['ssimulacra2', 'butteraugliNorm3', 'butteraugliMax']
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const array = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error('Expected report array')
  return value
}
const readJson = async (path: string) => object(JSON.parse(await readFile(path, 'utf8')))
async function optionalJson(path: string) {
  try {
    return await readJson(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}
function location(component: string, mode: string) {
  if (component === 'all')
    return { directory: join(allRoot, component, mode), variant: 'replay-all' }
  if (component === 'strategy' && mode !== 'speed')
    return { directory: join(strategyRoot, component, mode), variant: 'force-strategy' }
  if (['strategy', 'filters', 'available', 'features', 'all'].includes(component))
    return { directory: join(replayRoot, component, mode), variant: `replay-${component}` }
  return {
    directory: join(
      root,
      component === 'quant' && mode !== 'speed' ? 'quant-corrected' : component,
      mode,
    ),
    variant: `transplant-${component}`,
  }
}
async function points(component: string, mode: 'screen' | 'lab', id: string) {
  const selected = location(component, mode)
  const row = await readJson(
    join(selected.directory, `${selected.variant}-purejsimage`, `${id}-lab`, 'result.json'),
  )
  return array(row.points).map(parsePoint)
}
const rows = []
for (const mode of ['screen', 'lab'] as const) {
  const fixtures = selectPreparedFixtures(manifest, { mode }).fixtures
  for (const component of components) {
    const selected = location(component, mode)
    const summary = await optionalJson(join(selected.directory, 'summary.json'))
    if (!summary) continue
    const speed = array(summary.speed)
      .map(object)
      .find((s) => s.engine === 'purejsimage')
    const ownSpeed = speed?.lab === null || speed?.lab === undefined ? null : object(speed.lab)
    const failures = array(summary.failures)
    const expectedPoints = fixtures.length * (mode === 'screen' ? 5 : 9)
    const scoredPoints = ownSpeed ? number(ownSpeed.count) : 0
    const valid = failures.length === 0 && scoredPoints === expectedPoints
    const comparisons = array(summary.comparisons).map(object)
    const peerRates = array(summary.table).map(object)
    const isolated = await optionalJson(
      join(location(component, 'speed').directory, 'summary.json'),
    )
    const isolatedSpeed = isolated ? array(isolated.speed).map(object) : []
    const isolatedOwn = isolatedSpeed.find((s) => s.engine === 'purejsimage')
    const isolatedJs = isolatedSpeed.find((s) => s.engine === 'jsquash')
    const isolatedVips = isolatedSpeed.find((s) => s.engine === 'vips')
    const isolatedMs =
      isolatedOwn?.lab === null || isolatedOwn?.lab === undefined
        ? null
        : number(object(isolatedOwn.lab).median)
    const isolatedComplete =
      isolated !== null &&
      array(isolated.failures).length === 0 &&
      [isolatedOwn, isolatedJs, isolatedVips].every(
        (entry) =>
          entry?.lab !== null && entry?.lab !== undefined && number(object(entry.lab).count) === 64,
      )
    const againstControl = []
    if (valid) {
      for (const metric of metrics) {
        const values: number[] = []
        const omissions: string[] = []
        for (const fixture of fixtures) {
          const candidate = await points(component, mode, fixture.id)
          const control = await points('control', mode, fixture.id)
          try {
            values.push(
              bdRate(
                candidate.map((p) => ({ bytes: p.bytes, quality: p[metric] })),
                control.map((p) => ({ bytes: p.bytes, quality: p[metric] })),
                metric,
                metric === 'ssimulacra2'
                  ? { minimum: 60, maximum: 90 }
                  : metric === 'butteraugliMax'
                    ? { minimum: 0.5, maximum: 3 }
                    : undefined,
              ).percent,
            )
          } catch (error) {
            omissions.push(
              `${fixture.id}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        againstControl.push({ metric, ...summarizeBdRates(values), omissions })
      }
    }
    rows.push({
      component,
      evidence: selected.directory,
      mode,
      valid,
      scoredPoints,
      expectedPoints,
      selectedImages: summary.selectedImages,
      failures,
      encodeMedianMs: ownSpeed?.median ?? null,
      encodeMeanMs: ownSpeed?.mean ?? null,
      isolatedMedianMs: isolatedMs,
      isolatedComplete,
      isolatedVsJsquash:
        isolatedMs !== null && isolatedJs
          ? isolatedMs / number(object(isolatedJs.lab).median)
          : null,
      isolatedVsVips:
        isolatedMs !== null && isolatedVips
          ? isolatedMs / number(object(isolatedVips.lab).median)
          : null,
      managedPeakBytes: summary.managedPeakBytes,
      peerRates,
      againstControl,
      fullBands: ['jsquash', 'vips'].flatMap((peer) =>
        metrics.map((metric) => ({
          peer,
          metric,
          count: comparisons.filter(
            (c) => c.peer === peer && c.metric === metric && c.coversRequiredRange === true,
          ).length,
        })),
      ),
      warnings: summary.omissions,
    })
  }
}
const inventory = await readJson(join(peerRoot, 'inventory.json'))
const inventoryRows = array(inventory.rows).map(object)
const inventorySummary = {
  streams: inventoryRows.length,
  strategies: [...new Set(inventoryRows.flatMap((r) => array(r.strategies).map(number)))].sort(
    (a, b) => a - b,
  ),
  patchedStreams: inventoryRows.filter((r) => number(r.patches) > 0).length,
  noiseStreams: inventoryRows.filter((r) => r.noise === true).length,
  splineStreams: inventoryRows.filter((r) => number(r.splines) > 0).length,
  customMatrices: [...new Set(inventoryRows.flatMap((r) => array(r.customMatrices).map(number)))],
  xScales: [...new Set(inventoryRows.map((r) => number(r.xScale)))],
  bScales: [...new Set(inventoryRows.map((r) => number(r.bScale)))],
}
const report = {
  date: '2026-10-13',
  root,
  peerRoot,
  strategyRoot,
  replayRoot,
  allRoot,
  inventory: inventorySummary,
  peerCacheAudit: await readJson(join(peerRoot, 'peer-cache-audit.json')),
  controlPublicAudit: await readJson(join(root, 'control-public-audit.json')),
  status:
    rows.length === components.length * 2 && rows.every((row) => row.valid && row.isolatedComplete)
      ? 'Step 1 complete; pre-port checkpoint'
      : 'Step 1 continuing; missing rows or isolated timing are pending',
  timeScope:
    'isolated distance-2 encoding on 64 crops; peers freshly timed at effort 7, jSquash quality 80; excludes decoding peer decisions',
  textures: array(
    JSON.parse(await readFile(join(root, 'textures', 'comparisons.json'), 'utf8')),
  ).map(object),
  replayTextures: array(
    JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/replay-textures-v3/comparisons.json', 'utf8')),
  ).map(object),
  rows,
}
await writeFile(
  'benchmark/jpegxl/lossy-lab/TRANSPLANT-REPORT.json',
  `${JSON.stringify(report, null, 2)}\n`,
)
execFileSync(
  'node_modules/.bin/biome',
  ['format', '--write', 'benchmark/jpegxl/lossy-lab/TRANSPLANT-REPORT.json'],
  { stdio: 'ignore' },
)
const percent = (n: unknown): string =>
  typeof n === 'number' ? `${n >= 0 ? '+' : ''}${n.toFixed(3)}%` : 'unavailable'
const text: string[] = [
  '# Decision transplant report (2026-10-13)',
  '',
  report.status + '.',
  'Transform, quantization, DC, CfL, filters and patch-reference replay are implemented.',
  'No libjxl decision logic is ported. Holdout remains closed.',
  '',
  `Fresh vips preparation: ${inventorySummary.streams} streams from all 64 development photos.`,
  'The standard lab ladder has nine distances; the screen has five. All 576 lab streams',
  'equal the cached peer streams, so existing peer scores are reused. Holdout is closed.',
  '',
  'The repaired control matches all 576 retained production development files byte',
  'for byte. The forcing option is internal and rejected by the public codec.',
  '',
  'Each rate is mean per-image BD-rate, ordered SSIMULACRA2 / Butteraugli 3-norm / max.',
  'Times are isolated distance-2 encode medians on 64 crops including the container.',
  'Fresh peer timings use effort 7, jSquash quality 80 and vips distance 2. Required-band coverage',
  'and every warning are retained in TRANSPLANT-REPORT.json. Partial bands remain a limitation.',
  '',
]
for (const mode of ['screen', 'lab']) {
  text.push(
    `## ${mode === 'screen' ? 'Screen (16 photos)' : 'Full lab (64 photos)'}`,
    '',
    '| Forced component | vs vips | vs jSquash reference | vs control | Isolated encode ms | Scored points | Result |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
  )
  for (const row of rows.filter((r) => r.mode === mode)) {
    const rates = (peer: string) =>
      row.valid
        ? metrics
            .map((metric) =>
              percent(row.peerRates.find((r) => r.peer === peer && r.metric === metric)?.mean),
            )
            .join(' / ')
        : 'unavailable'
    const delta = row.valid
      ? metrics
          .map((metric) => percent(row.againstControl.find((r) => r.metric === metric)?.mean))
          .join(' / ')
      : 'unavailable'
    text.push(
      `| ${row.component} | ${rates('vips')} | ${rates('jsquash')} | ${delta} | ${typeof row.isolatedMedianMs === 'number' ? row.isolatedMedianMs.toFixed(1) : 'unavailable'} | ${row.scoredPoints}/${row.expectedPoints} | ${row.valid ? 'measured' : 'unavailable; see failures'} |`,
    )
  }
  text.push('')
}
text.push(
  '## Interpretation',
  '',
  'The available row combines quant/DC/CfL/filters. It is not the all-maps row.',
  'DC-only transfers physical DC precision while preserving our AC global scale.',
  'Forced quant fields constrain merges to cells with identical quantizers. The',
  'initial v2 quant row failed this condition and is excluded; quant-corrected',
  'contains the repaired row. Successful corrected/combined points verify their',
  'emitted maps before scoring.',
  'Quant forcing also disables our DCT32/rectangle selection stage; DCT16 is',
  'allowed only across equal field values. Its timing gains include avoided',
  'selection work. Quant and available rows therefore also restrict transform',
  'selection and cannot establish a pure quantization-heuristic contribution.',
  "Corrected filter rows mathematically invert our decoder's signaled 3x3 Gaborish",
  'kernel before encoding. The earlier header-only rows remain preserved and excluded.',
  'All 18 peer transform IDs are replayed, including AFV, DCT64 and rectangular',
  'transforms with odd-coordinate leaders. The all row also aligns channel matrix',
  'scales, DC smoothing and exact raw DC quantizer fields. Reference integer samples are decoded and re-encoded',
  'using our Modular entropy writer, and additive patches are subtracted in XYB.',
  'No peer entropy payload is copied. 186 streams have patches; noise and splines',
  'are absent. Default quant matrices are used; peer X scales range from 3 to 5.',
  'The all-maps residual includes unsignaled pixel preconditioning. libjxl uses',
  'a perceptually optimized approximate 5x5 Gaborish inverse, while this transplant',
  'uses a mathematical inverse of the decoder filter. Entropy coding and quantizer',
  'rounding therefore do not explain the residual alone.',
  '',
  'The first raw-codestream attempt omitted the public 40-byte container. It is',
  'preserved under transplant-20261013 and excluded. This report uses repaired v2',
  'container output. Every measured point is decoded and scored with native libjxl.',
  '',
  '## Near-flat textures',
  '',
  'Each comparison is original / our distance-3 control / the nearest-byte vips',
  'point on the frozen ladder. Sizes are approximate, with the actual difference',
  'listed below. These are visual observations, not a transform-only causal test.',
  '',
  '| Texture | Own bytes | Vips distance / bytes | Byte difference | Peer strategies | Observation |',
  '| --- | ---: | --- | ---: | --- | --- |',
)
const observations: Readonly<Record<string, string>> = {
  'im26-3304': 'Vips has smoother dark flat regions; our output has faint block patches.',
  'im26-3312':
    'Vips preserves more of the paper grain; our output smooths it and has mild uneven regions.',
  'im26-1020':
    'The original already has blocks. Vips reduces additional blockiness; it does not remove all source structure.',
}
for (const texture of report.textures) {
  if (typeof texture.id !== 'string') throw new Error('Missing texture ID')
  text.push(
    `| ${texture.id} | ${texture.ownBytes} | ${texture.vipsDistance} / ${texture.vipsBytes} | ${number(texture.differencePercent).toFixed(2)}% | ${array(texture.strategies).map(number).join(', ')} | ${observations[texture.id]} |`,
    '',
    `![${texture.id}: original, own control, vips](../../../${texture.image})`,
    '',
  )
}
text.push(
  '## Forced-transform texture comparison',
  '',
  'The new comparison uses distance 3 for every encoded column. Columns are',
  'original / control / forced strategy / all maps / vips. Sizes differ, so this',
  'isolates the decision switch at a fixed distance rather than matched rate.',
  'The central 256-square review crop maps the original channel means to 128 and',
  'multiplies differences by four. This makes faint seams visible without clipping',
  'the paper texture. Full unchanged-color comparisons are retained alongside it.',
  '',
  '| Texture | Control / strategy / all / vips bytes | Visual observation |',
  '| --- | --- | --- |',
)
const replayObservations: Readonly<Record<string, string>> = {
  'im26-3304':
    'Transform replay reduces the small checker pattern, but uneven regions remain. All maps and vips are much smoother and much smaller at this distance.',
  'im26-3312':
    'Transform choice alone does not remove the visible paper squares. Some are already in the original. The all-maps output still has broad uneven color regions.',
  'im26-1020':
    'Large transforms soften the square boundaries into rounded regions. The original contains strong blocks; replay also removes detail, so this is not an unconditional quality gain.',
}
for (const texture of report.replayTextures) {
  if (typeof texture.id !== 'string') throw new Error('Missing replay texture ID')
  text.push(
    `| ${texture.id} | ${array(texture.bytes).slice(1).join(' / ')} | ${replayObservations[texture.id]} |`,
    '',
    `![${texture.id}: original, control, strategy, all maps, vips; contrast enhanced](../../../${texture.contrastImage})`,
    '',
  )
}
text.push(
  '',
  '## Pre-port decision',
  '',
  'The all-maps row closes much of the Butteraugli gap, but still misses SSIM.',
  'Among individual components, transform replay gives the strongest improvement',
  'in 3-norm against vips. Its maximum-error regression prevents promotion as-is.',
  'The first source experiment should port the strategy decision cost using our',
  'own quantizer, with the maximum-error guard retained. Native peer decisions',
  'were chosen jointly with different quantizers and preconditioning, so their',
  'map alone does not establish the quality of a source-informed selector.',
  'Strategy and mathematical filter replay exceed the 3x crop speed target.',
  'Use cheaper first-party transform/filter kernels before promotion; these',
  'development prototypes are not eligible for the production path.',
  'Holdout and original speed/memory qualification remain required for any port.',
  '',
  '## Reproduction',
  '',
  '```sh',
  'node benchmark/jpegxl/lossy-lab/prepare-transplant.ts',
  'node benchmark/jpegxl/lossy-lab/run-transplants.ts <new-output-directory>',
  'node benchmark/jpegxl/lossy-lab/run-transplant-corrections.ts <new-output-directory>',
  'node benchmark/jpegxl/lossy-lab/run-transplant-replay.ts <new-output-directory>',
  'node benchmark/jpegxl/lossy-lab/run-transplant-speed.ts <new-output-directory>',
  'node benchmark/jpegxl/lossy-lab/run-replay-speed.ts .tmp/jpegxl-lossy-lab/replay-v5 strategy filters available features',
  'node benchmark/jpegxl/lossy-lab/run-replay-speed.ts .tmp/jpegxl-lossy-lab/replay-v6 all',
  'node benchmark/jpegxl/lossy-lab/compare-transplant-textures.ts <new-output-directory>',
  'node benchmark/jpegxl/lossy-lab/compare-replay-textures.ts <new-output-directory>',
  'node benchmark/jpegxl/lossy-lab/audit-transplant-control.ts <new-output-directory>',
  'node benchmark/jpegxl/lossy-lab/report-transplants.ts <new-output-directory>',
  '```',
  '',
  'The pre-port checkpoint must include every screen/full row and isolated timing.',
  'Step 2 follows measured contributions after that checkpoint is reported.',
  '',
)
await writeFile('benchmark/jpegxl/lossy-lab/TRANSPLANT-REPORT.md', text.join('\n'))
