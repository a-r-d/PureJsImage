import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

import { avifQmatrixFixtureDirectory, avifQmatrixFixtures } from './qmatrix-fixtures.ts'

const width = 256
const height = 192
const source = new Uint8Array(width * height * 3)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const value = ((x >> 5) + (y >> 5)) & 1 ? 210 : 40
    const offset = (y * width + x) * 3
    source[offset] = value
    source[offset + 1] = 255 - value
    source[offset + 2] = (value + 80) & 255
  }
}

for (const fixture of avifQmatrixFixtures) {
  if (fixture.width !== width || fixture.height !== height) {
    throw new Error(`${fixture.file} dimensions do not match the deterministic source`)
  }
  const path = join(avifQmatrixFixtureDirectory, fixture.file)
  await sharp(source, { raw: { width, height, channels: 3 } })
    .avif({ quality: fixture.quality, chromaSubsampling: '4:2:0' })
    .toFile(path)
  const encoded = await readFile(path)
  const checksum = createHash('sha256').update(encoded).digest('hex')
  if (checksum !== fixture.fileSha256) {
    throw new Error(`${fixture.file} checksum changed: ${checksum}`)
  }
  console.log(`generated ${fixture.file}`)
}
