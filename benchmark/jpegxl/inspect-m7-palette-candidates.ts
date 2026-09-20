import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }
const results: object[] = []
for (const entry of selection.cases) {
  const directory = `.tmp/jpegxl-m7/lossless-${entry.split}-single-cache-031-snapshot`
  const input = await readFile(`${directory}/${entry.id}.ppm`)
  const header = /^P6\n(\d+) (\d+)\n255\n/u.exec(input.subarray(0, 100).toString('ascii'))
  if (
    !header ||
    Number(header[1]) !== entry.width ||
    Number(header[2]) !== entry.height ||
    input.length !== header[0].length + entry.width * entry.height * 3
  )
    throw new Error(`${entry.id}: invalid normalized extent`)
  const pixels = input.subarray(header[0].length)
  const candidates: object[] = []
  for (let y = 0; y < entry.height; y += 1024)
    for (let x = 0; x < entry.width; x += 1024) {
      const colors = new Set<number>()
      const right = Math.min(x + 1024, entry.width),
        bottom = Math.min(y + 1024, entry.height)
      for (let row = y; row < bottom && colors.size <= 1024; row++)
        for (let column = x; column < right && colors.size <= 1024; column++) {
          const offset = (row * entry.width + column) * 3
          colors.add(
            ((pixels[offset] ?? 0) << 16) |
              ((pixels[offset + 1] ?? 0) << 8) |
              (pixels[offset + 2] ?? 0),
          )
        }
      if (colors.size > 256 && colors.size <= 1024) candidates.push({ x, y, colors: colors.size })
    }
  results.push({
    id: entry.id,
    split: entry.split,
    normalizedSha256: createHash('sha256').update(pixels).digest('hex'),
    candidates,
  })
}
await writeFile(
  '.tmp/jpegxl-m7/palette-034-sdr-impact.json',
  `${JSON.stringify({ policy: 'Inspect all 240 previously evaluated SDR families. Count exact RGB colors up to 1025 per 1024-square group; reversible RCT preserves cardinality. This identifies new palette eligibility, not a compression or decoding pass.', results }, null, 2)}\n`,
)
