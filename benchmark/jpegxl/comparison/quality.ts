import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import sharp from 'sharp'
import { interpolateM7Quality } from '../m7-quality-curves.ts'
import {
  type RecoveryPoint,
  recoveryBracket,
  recoveryMonotonicityViolations,
} from '../m7-recovery-curves.ts'
import { initialize } from './adapters.ts'
import {
  fixtures,
  hash,
  implementationIdentity,
  json,
  metrics,
  oracle,
  raw,
  root,
  run,
  work,
} from './io.ts'
import { classifyError, validateImplementationIdentity } from './model.ts'
import { nextComparisonQualitySetting } from './quality-refinement.ts'

const output = process.argv[2] ?? `${root}/results/quality.json`
const sampling = process.argv[3] ?? 'target80'
const fixtureId = process.argv[4]
if (!['target80', 'all-bands'].includes(sampling) || process.argv.length > 5)
  throw new Error(
    'Specify an output report, target80 or all-bands sampling and optional fixture ID',
  )
if (sampling === 'all-bands' && resolve(output) === resolve(`${root}/results/quality.json`))
  throw new Error(
    'All-band refinement requires a separate report to preserve the frozen comparison',
  )
const targets = sampling === 'all-bands' ? [80, 70, 90] : [80]
const maximumPoints = sampling === 'all-bands' ? 24 : 6
const maximumWidth = sampling === 'all-bands' ? 0.25 : 2
const directory =
  sampling === 'all-bands'
    ? `${work}/quality-refined/${basename(output, '.json')}`
    : `${work}/quality`
const identity = await implementationIdentity()
const harnessSha256 = hash(await readFile(import.meta.filename))
const refinementSha256 = hash(await readFile(new URL('./quality-refinement.ts', import.meta.url)))
const fixturesSha256 = hash(await readFile(`${root}/fixtures.json`))

if (!('ImageData' in globalThis))
  Object.defineProperty(globalThis, 'ImageData', {
    value: class {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    },
  })
const selected = (await fixtures()).filter(
    (f) =>
      [
        'im26-1030-diagnostic',
        'im26-1416-diagnostic',
        'im26-5034-diagnostic',
        'alpha_triangles',
      ].includes(f.id) &&
      (fixtureId === undefined || f.id === fixtureId),
  ),
  results: unknown[] = []
if (!selected.length) throw new Error('No selected quality fixture matches')
await mkdir(directory, { recursive: true })
const toolHashes = Object.fromEntries(
  await Promise.all(
    ['ssimulacra2', 'butteraugli_main'].map(async (tool) => [
      tool,
      hash(await readFile(`${metrics}/${tool}`)),
    ]),
  ),
)
for (const fixture of selected) {
  const p = await raw(fixture),
    transparent = fixture.category === 'transparency',
    backgrounds = transparent ? ['black', 'white'] : ['black']
  const source = `${work}/fixtures/${fixture.id}.png`,
    references = new Map<string, string>()
  for (const background of backgrounds) {
    const path = `${directory}/${fixture.id}-${background}-source.png`
    await sharp(source).flatten({ background }).png().toFile(path)
    references.set(background, path)
  }
  for (const subject of ['purejsimage', 'jsquash', 'vips', 'native-libjxl'] as const) {
    console.log(`quality ${fixture.id} ${subject}`)
    const adapter =
      subject === 'native-libjxl'
        ? undefined
        : await initialize(
            subject,
            async (name) => new Uint8Array(await readFile(`${work}/assets/${name}`)).buffer,
          )
    const points: (RecoveryPoint & {
        butteraugli: number
        artifact: string
        artifactSha256: string
        decodedSha256: string
        backgrounds: unknown[]
        options: unknown
      })[] = [],
      failures: unknown[] = []
    try {
      const queue = subject === 'jsquash' ? [11, 51] : [1, 4],
        minimum = subject === 'jsquash' ? 2 : subject === 'purejsimage' ? 0.25 : 0.1,
        maximum = subject === 'jsquash' ? (sampling === 'all-bands' ? 101 : 81) : 25
      for (let attempt = 0; attempt < maximumPoints; attempt++) {
        const setting =
          queue.shift() ??
          (points.length
            ? nextComparisonQualitySetting(points, targets, minimum, maximum, maximumWidth)
            : undefined)
        if (setting === undefined) break
        const options = {
            lossless: false,
            effort: 7,
            value: subject === 'jsquash' ? 101 - setting : setting,
          },
          prefix = `${directory}/${fixture.id}-${subject}-${setting}`
        try {
          if (subject === 'native-libjxl')
            run(`${oracle}/cjxl`, [
              source,
              `${prefix}.jxl`,
              '-d',
              String(setting),
              '-e',
              '7',
              '--num_threads=1',
            ])
          else {
            if (!adapter?.encode) throw new Error('Missing encoder')
            const output = await adapter.encode(p, options)
            if (output.kind !== 'jxl') throw new Error('Unexpected encoder result')
            await writeFile(`${prefix}.jxl`, output.bytes)
          }
          run(`${oracle}/djxl`, [
            `${prefix}.jxl`,
            `${prefix}.png`,
            '--num_threads=1',
            '--bits_per_sample=8',
          ])
          const scores: { background: string; ssimulacra2: number; butteraugli: number }[] = []
          for (const background of backgrounds) {
            const decoded = `${prefix}-${background}.png`,
              reference = references.get(background)
            if (!reference) throw new Error('Missing prepared reference')
            await sharp(`${prefix}.png`).flatten({ background }).png().toFile(decoded)
            const score = Number.parseFloat(run(`${metrics}/ssimulacra2`, [reference, decoded])),
              ba = Number.parseFloat(run(`${metrics}/butteraugli_main`, [reference, decoded]))
            if (!Number.isFinite(score) || !Number.isFinite(ba))
              throw new Error('Invalid metric result')
            scores.push({ background, ssimulacra2: score, butteraugli: ba })
          }
          const bytes = await readFile(`${prefix}.jxl`)
          points.push({
            setting,
            bytes: bytes.length,
            score: Math.min(...scores.map((s) => s.ssimulacra2)),
            butteraugli: Math.max(...scores.map((s) => s.butteraugli)),
            artifact: `${prefix}.jxl`,
            artifactSha256: hash(bytes),
            decodedSha256: hash(await readFile(`${prefix}.png`)),
            backgrounds: scores,
            options,
          })
        } catch (error) {
          failures.push({ setting, ...classifyError(error) })
          break
        }
      }
    } finally {
      adapter?.close()
    }
    const bands = [70, 80, 90].map((target) => {
      const bracket = recoveryBracket(points, target)
      return {
        target,
        status: bracket
          ? bracket.width <= maximumWidth
            ? 'adequate bracket'
            : 'wide bracket'
          : points.length === 0
            ? 'execution failure'
            : points.every((p) => p.score < target)
              ? 'target not reached under tested configuration'
              : 'insufficient sampling',
        width: bracket?.width ?? null,
        bracket: bracket ?? null,
        interpolatedBytes: bracket ? (interpolateM7Quality(points, target) ?? null) : null,
      }
    })
    const butteraugli = [0.5, 1, 2, 3].map((target) => {
      const bracket = recoveryBracket(
        points.map((point) => ({ ...point, score: -point.butteraugli })),
        -target,
      )
      return {
        target,
        status: bracket
          ? bracket.width <= 0.25
            ? 'adequate bracket'
            : 'wide bracket'
          : 'insufficient sampling',
        width: bracket?.width ?? null,
        bracket: bracket ?? null,
        interpolatedBytes:
          interpolateM7Quality(
            points.map((point) => ({ bytes: point.bytes, score: point.butteraugli })),
            target,
            false,
          ) ?? null,
      }
    })
    results.push({
      fixture: fixture.id,
      scope: fixture.scope,
      sourceSha256: fixture.sourceSha256,
      inputSha256: fixture.rawSha256,
      settingBounds:
        subject === 'jsquash'
          ? { minimum: 2, maximum: sampling === 'all-bands' ? 101 : 81, mapping: '101 - quality' }
          : { minimum: subject === 'purejsimage' ? 0.25 : 0.1, maximum: 25, mapping: 'distance' },
      subject,
      role:
        subject === 'native-libjxl'
          ? 'native oracle, excluded from JavaScript runtime comparisons'
          : 'public JavaScript API',
      points,
      failures,
      bands,
      butteraugli,
      monotonicityViolations: recoveryMonotonicityViolations(points),
    })
    validateImplementationIdentity(await implementationIdentity(), identity)
    await json(output, {
      schemaVersion: 1,
      date: new Date().toISOString(),
      ...identity,
      harnessSha256,
      refinementSha256,
      fixturesSha256,
      toolHashes,
      decoderSha256: hash(await readFile(`${oracle}/djxl`)),
      primaryTarget: 80,
      samplingTargets: targets,
      selectedFixtureIds: selected.map((fixture) => fixture.id),
      maximumSsimBracketWidth: maximumWidth,
      maximumPointsPerSubjectFixture: maximumPoints,
      matching:
        sampling === 'all-bands'
          ? 'Existing M7 nondominated log-byte interpolation. Refine SSIMULACRA2 80, 70 and 90 separately; unresolved targets remain explicit. Butteraugli coordinates may remain missing. No extrapolation or lossless points. Alpha: minimum SSIMULACRA2 / maximum Butteraugli over explicit black and white backgrounds.'
          : 'Existing M7 nondominated log-byte interpolation. Target80 refinements only; 70/90 and Butteraugli secondary coordinates may remain missing. No extrapolation or lossless points. Alpha: minimum SSIMULACRA2 / maximum Butteraugli over explicit black and white backgrounds.',
      results,
    })
  }
}
