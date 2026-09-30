import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const directory = 'docs-astro/public/assets/jpegxl-tools'
await mkdir(directory, { recursive: true })
const previews = []
for (const tool of [
  'convert',
  'jpeg-recompression',
  'animation',
  'progressive',
  'native',
  'comparison',
]) {
  const input = await readFile(`.tmp/jpegxl-showcase-${tool}.png`)
  const output = await sharp(input)
    .resize({ width: 512, height: 320, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer()
  await writeFile(`${directory}/${tool}.webp`, output)
  previews.push({
    tool,
    route: `/jpeg-xl/${tool}/`,
    sha256: createHash('sha256').update(output).digest('hex'),
    captureSha256: createHash('sha256').update(input).digest('hex'),
    bytes: output.length,
  })
}
await writeFile(
  'docs-astro/src/data/jpegxl-showcase-previews.json',
  `${JSON.stringify({ capture: 'Actual Chromium canvas/output screenshots from browser-tests/jpegxl-showcase.pw.ts with PUREJSIMAGE_CAPTURE_JXL=1. No generated mockups.', previews }, null, 2)}\n`,
)
