/** Lossless 1:1 comparison panels with provenance; no resampling or color conversion. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const [output, widthText, heightText, leftText, topText, cropWidthText, cropHeightText, ...paths] =
  process.argv.slice(2)
if (!output?.endsWith('.png') || paths.length !== 3)
  throw new Error(
    'Usage: prepare-m7-visual-crop.ts output.png width height left top cropWidth cropHeight source.ppm before.ppm after.ppm',
  )
const width = Number(widthText),
  height = Number(heightText),
  left = Number(leftText),
  top = Number(topText),
  cropWidth = Number(cropWidthText),
  cropHeight = Number(cropHeightText)
if (
  ![width, height, left, top, cropWidth, cropHeight].every(Number.isSafeInteger) ||
  width < 1 ||
  height < 1 ||
  width * height > 30000000 ||
  left < 0 ||
  top < 0 ||
  cropWidth < 1 ||
  cropHeight < 1 ||
  cropWidth > 512 ||
  cropHeight > 512 ||
  left + cropWidth > width ||
  top + cropHeight > height
)
  throw new Error('Invalid bounded crop geometry')
sharp.concurrency(1)
sharp.cache(false)
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const composite = new Uint8Array(cropWidth * 3 * cropHeight * 3)
const inputs = []
for (let panel = 0; panel < paths.length; panel++) {
  const path = paths[panel]
  if (!path) throw new Error('Missing panel')
  const bytes = await readFile(path)
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(bytes.subarray(0, 100).toString('ascii'))
  if (
    !header ||
    Number(header[1]) !== width ||
    Number(header[2]) !== height ||
    bytes.length !== header[0].length + width * height * 3
  )
    throw new Error('RGB8 PPM extent mismatch')
  const pixels = bytes.subarray(header[0].length)
  inputs.push({ path, fileSha256: hash(bytes), pixelsSha256: hash(pixels) })
  for (let row = 0; row < cropHeight; row++) {
    const start = ((top + row) * width + left) * 3
    composite.set(
      pixels.subarray(start, start + cropWidth * 3),
      (row * cropWidth * 3 + panel * cropWidth) * 3,
    )
  }
}
const png = await sharp(composite, {
  raw: { width: cropWidth * 3, height: cropHeight, channels: 3 },
})
  .png()
  .toBuffer()
await writeFile(output, png, { flag: 'wx' })
await writeFile(
  `${output}.json`,
  `${JSON.stringify(
    {
      policy:
        'Source / before / after from left to right. Lossless RGB8 PNG, 1:1 pixels, no rescaling or color conversion. Display at natural size. HDR inputs are separately declared display mappings, not native-light data.',
      width,
      height,
      left,
      top,
      cropWidth,
      cropHeight,
      inputs,
      outputSha256: hash(png),
      harnessSha256: hash(await readFile(import.meta.filename)),
    },
    null,
    2,
  )}\n`,
  { flag: 'wx' },
)
