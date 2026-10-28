import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { hash } from '../comparison/io.ts'
import { parsePreparedManifest } from './fixture-selection.ts'
import { libjxlPortOverrides } from './libjxl-ports.ts'
import { encodeTransplant } from './transplant.ts'
import { renderSelectedGeometry } from './geometry-display.ts'
import { decodeDisplayStages } from './display-error-trace.ts'
import { libjxlDitheredRgba } from './libjxl-output-dither-port.ts'
const root = process.argv[2]
if (!root) throw new Error('Need a new output directory')
await mkdir(root)
const manifest = parsePreparedManifest(
  JSON.parse(await readFile('.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json', 'utf8')),
)
const rows = []
for (const id of manifest.screenIds) {
  const fixture = manifest.fixtures.find(
    (f) => f.id === id && f.kind === 'lab' && f.split === 'development',
  )
  if (!fixture) throw new Error('Missing development screen fixture')
  const bytes = await readFile(fixture.png)
  if (hash(bytes) !== fixture.fixtureSha256) throw new Error('Changed fixture')
  const source = PNG.sync.read(bytes),
    { width, height } = source
  for (const distance of [0.5, 1, 2, 4, 7]) {
    const options = libjxlPortOverrides('standalone-forward-all', distance, width, height),
      rewrite = options.rewriteGeometry
    if (!rewrite) throw new Error('Missing selector')
    const captures: ReturnType<typeof renderSelectedGeometry>[] = [],
      counts: Record<string, number> = {}
    let renderMs = 0
    const encoded = await encodeTransplant(source.data, width, height, distance, {
      ...options,
      rewriteGeometry(base, context) {
        const selected = rewrite(base, context)
        const started = performance.now()
        captures.push(renderSelectedGeometry(selected, width, height))
        renderMs += performance.now() - started
        for (let p = 0; p < (selected.strategyMap?.length ?? 0); p++)
          if (selected.developmentFirstBlocks?.[p]) {
            const s = String(selected.strategyMap?.[p])
            counts[s] = (counts[s] ?? 0) + 1
          }
        return selected
      },
    })
    if (captures.length !== 1 || !captures[0]) throw new Error('Unexpected geometry invocation')
    const direct = captures[0],
      decoded = await decodeDisplayStages(encoded.bytes),
      errors = []
    for (const [a, b] of [
      [direct.raw, decoded.raw],
      [direct.filtered, decoded.epf],
      [direct.srgb, decoded.srgb],
    ] as const) {
      let error = 0
      for (let c = 0; c < 3; c++)
        for (let p = 0; p < width * height; p++)
          error = Math.max(error, Math.abs((a[c]?.[p] ?? 0) - (b[c]?.[p] ?? 0)))
      errors.push(error)
    }
    const pixelHash = hash(direct.rgba)
    if (
      errors.some((v) => v !== 0) ||
      pixelHash !== hash(libjxlDitheredRgba(decoded.srgb, width, height))
    )
      throw new Error(`Mismatch ${id} ${distance}: ${errors}`)
    rows.push({
      id,
      distance,
      sourceHash: hash(bytes),
      streamHash: hash(encoded.bytes),
      pixelHash,
      errors,
      counts,
      renderMs,
    })
    await writeFile(
      `${root}/geometry-parity.json`,
      JSON.stringify(
        { rows, scope: 'Development screen only; diagnostic timing not qualification' },
        null,
        2,
      ) + '\n',
    )
    console.log(`${id} ${distance}: exact`)
  }
}
