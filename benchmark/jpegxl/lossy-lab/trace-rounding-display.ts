import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { object } from '../comparison/model.ts'
import {
  decodeDisplayStages,
  traceCorrection,
  tracePlanes,
  traceSquaredError,
} from './display-error-trace.ts'
import { parsePreparedManifest, selectPreparedFixtures } from './fixture-selection.ts'
import { libjxlGaborishContext } from './libjxl-gaborish-port.ts'
import { libjxlPortOverrides } from './libjxl-ports.ts'
import { parsePoint } from './model.ts'
import { encodeTransplant } from './transplant.ts'

const [root, shardText, family = 'rounding'] = process.argv.slice(2)
if (family !== 'rounding' && family !== 'demotion') throw new Error('Unknown trace family')
if (!root) throw new Error('Need fresh output root')
await mkdir(root, { recursive: true })
if (shardText === undefined) {
  await Promise.all(
    [0, 1, 2, 3].map(
      (shard) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [import.meta.filename, root, String(shard), family],
            {
              stdio: 'inherit',
            },
          )
          child.once('error', reject)
          child.once('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(`Trace shard ${shard}: ${code}`)),
          )
        }),
    ),
  )
} else {
  const shard = Number(shardText)
  if (!Number.isInteger(shard) || shard < 0 || shard > 3) throw new Error('Bad shard')
  const manifest = parsePreparedManifest(
    JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
  )
  const fixtures = selectPreparedFixtures(manifest, { mode: 'screen' })
  if (!fixtures.complete || fixtures.fixtures.length !== 16) throw new Error('Incomplete screen')
  const cache =
    family === 'rounding'
      ? '.tmp/jpegxl-lossy-lab/selected-20261028'
      : '.tmp/jpegxl-lossy-lab/display-trace-20261028'
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  for (const [index, fixture] of fixtures.fixtures.entries()) {
    if (index % 4 !== shard) continue
    const file = await readFile(fixture.png),
      png = PNG.sync.read(file)
    if (png.width !== 512 || png.height !== 512) throw new Error('Trace requires fixed 512 crops')
    if (hash(file) !== fixture.fixtureSha256) throw new Error('Source changed')
    const sourceRgb = tracePlanes(png.width * png.height),
      sourceLinear = tracePlanes(png.width * png.height)
    for (let c = 0; c < 3; c++) {
      const rgb = sourceRgb[c],
        linear = sourceLinear[c]
      if (!rgb || !linear) throw new Error('Missing source channel')
      for (let p = 0; p < png.width * png.height; p++) {
        const v = (png.data[p * 4 + c] ?? 0) / 255
        rgb[p] = v
        linear[p] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
    }
    for (const distance of [2, 4]) {
      const source = tracePlanes(png.width * png.height),
        idealRaw = tracePlanes(png.width * png.height)
      const options = libjxlPortOverrides(
          'standalone-forward-all',
          distance,
          png.width,
          png.height,
        ),
        rewrite = options.rewriteGeometry
      if (!rewrite) throw new Error('Missing rewrite')
      const encoded = await encodeTransplant(
        Uint8Array.from(png.data),
        png.width,
        png.height,
        distance,
        {
          ...options,
          rewriteGeometry(base, context) {
            const inverse = libjxlGaborishContext(base, context, png.width, png.height)
            try {
              for (let by = 0; by < base.blocksHigh; by++)
                for (let bx = 0; bx < base.blocksWide; bx++) {
                  for (const [ctx, target] of [
                    [context, source],
                    [inverse, idealRaw],
                  ] as const) {
                    const block = ctx.readBlock(bx, by, false)
                    for (let y = 0; y < 8; y++)
                      for (let x = 0; x < 8; x++) {
                        const at = (by * 8 + y) * png.width + bx * 8 + x,
                          p = y * 8 + x
                        target[0][at] = block[0]?.[p] ?? 0
                        target[1][at] = block[1]?.[p] ?? 0
                        target[2][at] = (block[2]?.[p] ?? 0) + (block[1]?.[p] ?? 0)
                      }
                  }
                }
            } finally {
              inverse.release()
            }
            return rewrite(base, context)
          },
        },
      )
      const rows = []
      const modes =
        family === 'rounding'
          ? [
              'standalone-forward-all',
              'standalone-round-guarded',
              'standalone-round-weak',
              'standalone-round-high',
            ]
          : ['standalone-forward-all', 'standalone-rd25', 'standalone-rd50', 'standalone-rd100']
      for (const mode of modes) {
        const path = `${cache}/${mode}-screen/${mode}-purejsimage/${fixture.id}-lab`
        const stream = await readFile(`${path}/${distance}.jxl`)
        if (mode === 'standalone-forward-all' && hash(stream) !== hash(encoded.bytes))
          throw new Error('Control changed')
        const stages = await decodeDisplayStages(stream, idealRaw)
        if (!stages.idealGaborish) throw new Error('Missing ideal Gaborish')
        const native = PNG.sync.read(await readFile(`${path}/${distance}.png`))
        let maximum = 0,
          beyondOne = 0
        for (let p = 0; p < png.width * png.height; p++)
          for (let c = 0; c < 3; c++) {
            const delta = Math.abs(
              Math.round((stages.rounded[c]?.[p] ?? 0) * 255) - (native.data[p * 4 + c] ?? 0),
            )
            maximum = Math.max(maximum, delta)
            if (delta > 1) beyondOne++
          }
        if (beyondOne)
          throw new Error(`Native parity ${fixture.id}/${distance}/${mode}: ${maximum}`)
        const curve = object(JSON.parse(await readFile(`${path}/result.json`, 'utf8')))
        if (!Array.isArray(curve.points)) throw new Error('Missing scores')
        const point = curve.points.map(parsePoint).find((p) => p.setting === distance)
        if (!point) throw new Error('Missing native score')
        rows.push({
          mode,
          bytes: stream.length,
          hash: hash(stream),
          point,
          maximum,
          beyondOne,
          rawError: traceSquaredError(stages.raw, idealRaw),
          gaborishQuantError: traceSquaredError(stages.gaborish, stages.idealGaborish),
          preconditionBias: traceSquaredError(stages.idealGaborish, source),
          gaborishError: traceSquaredError(stages.gaborish, source),
          epf: traceCorrection(stages.gaborish, stages.epf, source),
          linearError: traceSquaredError(stages.linear, sourceLinear),
          displayRounding: traceCorrection(stages.srgb, stages.rounded, sourceRgb),
        })
      }
      await writeFile(
        `${root}/${fixture.id}-${distance}.json`,
        `${JSON.stringify({ base: 'd18b41b4', id: fixture.id, distance, rows })}\n`,
        { flag: 'wx' },
      )
    }
    console.log(fixture.id)
  }
}
