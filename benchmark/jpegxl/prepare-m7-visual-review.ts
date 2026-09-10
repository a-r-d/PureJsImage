import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { validateM7CachedPoint } from './m7-quality-cache.ts'
import corpus from './production-program/m7-corpus-selection.json' with { type: 'json' }

sharp.concurrency(1)
sharp.cache(false)
const [qualityDirectory, runId, selectionPath] = process.argv.slice(2)
if (!qualityDirectory || !runId || !selectionPath || !/^[a-z0-9-]+$/u.test(runId))
  throw new Error('Specify quality directory, unique run identifier and visual selection JSON')
const output = `.tmp/jpegxl-m7/visual-${runId}`
await mkdir(output)
const djxl = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const nativeSha256 = hash(await readFile(djxl))
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected record')
  return value
}
const number = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('Expected positive integer')
  return value
}
const selectionBytes = await readFile(selectionPath)
const selection = record(JSON.parse(selectionBytes.toString('utf8')))
const qualityProtocol = record(
  JSON.parse(await readFile(`${qualityDirectory}/protocol.json`, 'utf8')),
)
if (
  (selection.split !== 'development' && selection.split !== 'holdout') ||
  selection.split !== qualityProtocol.split ||
  typeof qualityProtocol.sourceFingerprint !== 'string' ||
  !Array.isArray(selection.cases) ||
  selection.cases.length === 0
)
  throw new Error('Visual selection must contain cases from the quality run split')
const seen = new Set<string>()
const cases = selection.cases.map((value: unknown) => {
  const entry = record(value)
  if (
    typeof entry.id !== 'string' ||
    seen.has(entry.id) ||
    !corpus.cases.some(
      (candidate) => candidate.id === entry.id && candidate.split === selection.split,
    ) ||
    typeof entry.reason !== 'string' ||
    entry.reason.length === 0 ||
    !Array.isArray(entry.centers) ||
    entry.centers.length === 0 ||
    entry.centers.length > 8
  )
    throw new Error('Invalid or duplicate visual case')
  seen.add(entry.id)
  const centers = entry.centers.map((value: unknown): readonly [number, number] => {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value.some(
        (coordinate: unknown) =>
          typeof coordinate !== 'number' ||
          !Number.isFinite(coordinate) ||
          coordinate < 0 ||
          coordinate > 1,
      )
    )
      throw new Error('Visual centers must be normalized coordinate pairs')
    const x: unknown = value[0],
      y: unknown = value[1]
    if (typeof x !== 'number' || typeof y !== 'number') throw new Error('Invalid visual coordinate')
    return [x, y]
  })
  return { id: entry.id, reason: entry.reason, centers }
})
if (
  !Array.isArray(qualityProtocol.tools) ||
  !qualityProtocol.tools.some((value: unknown) => {
    const tool = record(value)
    return tool.path === djxl && tool.sha256 === nativeSha256
  })
)
  throw new Error('Visual decoder differs from the pinned quality oracle')
const panels: object[] = []
for (const entry of cases) {
  const directory = `${qualityDirectory}/${entry.id}`
  const raw = await readFile(`${directory}/report.json`)
  const report = record(JSON.parse(raw.toString('utf8')))
  const source = corpus.cases.find((candidate) => candidate.id === entry.id)
  if (
    !source ||
    report.id !== entry.id ||
    report.sourceSha256 !== source.sourceSha256 ||
    report.sourceFingerprint !== qualityProtocol.sourceFingerprint
  )
    throw new Error('Visual source identity or encoder fingerprint mismatch')
  const width = number(report.width),
    height = number(report.height)
  if (!Array.isArray(report.points)) throw new Error('Missing measured points')
  const points: readonly unknown[] = report.points
  const cropSize = Math.min(256, width, height)
  const regions = entry.centers.map(([cx = 0.5, cy = 0.5]) => ({
    left: Math.max(0, Math.min(width - cropSize, Math.round(width * cx - cropSize / 2))),
    top: Math.max(0, Math.min(height - cropSize, Math.round(height * cy - cropSize / 2))),
    width: cropSize,
    height: cropSize,
  }))
  for (const setting of [1, 3]) {
    const variants = [
      { label: 'Original', path: `${directory}/input.ppm`, point: undefined },
      ...['purejsimage', 'libjxl'].map((engine) => {
        const selected = points.find((value) => {
          const p = record(value)
          return p.engine === engine && p.setting === setting
        })
        const point = validateM7CachedPoint(selected, engine, setting)
        return {
          label: `${engine} d=${setting}`,
          path: `${output}/${entry.id}-${engine}-${setting}.ppm`,
          point,
        }
      }),
    ]
    const crops: Buffer[][] = regions.map(() => [])
    const labels: string[] = []
    for (const variant of variants) {
      if (variant.point) {
        const engine = variant.point.engine
        const encoded = `${directory}/${engine}-${setting}.jxl`
        if (hash(await readFile(encoded)) !== variant.point.encodedSha256)
          throw new Error('Encoded hash mismatch')
        const result = spawnSync(
          djxl,
          [encoded, variant.path, '--num_threads=1', '--bits_per_sample=8'],
          { encoding: 'utf8', timeout: 120_000, maxBuffer: 1_048_576 },
        )
        if (result.status !== 0) throw new Error(result.stderr || 'Native decode failed')
      }
      const bytes = await readFile(variant.path)
      const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(bytes.subarray(0, 100).toString('ascii'))
      if (!header || Number(header[1]) !== width || Number(header[2]) !== height)
        throw new Error('Wrong image extent')
      const pixels = bytes.subarray(header[0].length)
      if (
        pixels.length !== width * height * 3 ||
        hash(pixels) !== (variant.point?.decodedSha256 ?? report.normalizedSha256)
      )
        throw new Error('Decoded sample hash mismatch')
      for (let i = 0; i < regions.length; i++) {
        const region = regions[i]
        if (!region) throw new Error('Missing region')
        const crop = await sharp(pixels, { raw: { width, height, channels: 3 } })
          .extract(region)
          .resize(512, 512, { kernel: 'nearest' })
          .png()
          .toBuffer()
        crops[i]?.push(crop)
      }
      labels.push(
        variant.point
          ? `${variant.label}; SSIM ${Number(variant.point.ssimulacra2).toFixed(2)}; ${variant.point.bytes} bytes`
          : variant.label,
      )
      if (variant.point) await unlink(variant.path)
    }
    for (let i = 0; i < regions.length; i++) {
      const row = crops[i]
      if (row?.length !== 3) throw new Error('Missing crops')
      const label = Buffer.from(
        `<svg width="1536" height="60"><rect width="100%" height="100%" fill="white"/>${labels.map((text, index) => `<text x="${index * 512 + 12}" y="35" font-family="sans-serif" font-size="17">${text}</text>`).join('')}</svg>`,
      )
      const path = `${output}/${entry.id}-d${setting}-region${i}.png`
      await sharp({ create: { width: 1536, height: 572, channels: 3, background: '#ffffff' } })
        .composite([
          { input: label, left: 0, top: 0 },
          ...row.map((input, index) => ({ input, left: index * 512, top: 60 })),
        ])
        .png()
        .toFile(path)
      panels.push({
        id: entry.id,
        reason: entry.reason,
        setting,
        region: regions[i],
        path,
        labels,
        reportSha256: hash(raw),
        reviewStatus: 'not-reviewed',
      })
    }
  }
}
await writeFile(
  `${output}/report.json`,
  `${JSON.stringify({ policy: 'Diagnostic visual crops at 2x nearest-neighbor display. Same numeric distance is not matched quality; labels retain measured scores and sizes. Each decoded bitmap is released before the next variant. Human inspection required.', qualityDirectory, selectionPath, selectionSha256: hash(selectionBytes), sourceFingerprint: qualityProtocol.sourceFingerprint, nativeSha256, panels, qualificationComplete: false }, null, 2)}\n`,
)
console.log(JSON.stringify({ output, panels: panels.length }))
