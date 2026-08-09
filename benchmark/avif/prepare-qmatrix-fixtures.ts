import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

import { avifQmatrixFixtureDirectory, avifQmatrixFixtures } from './qmatrix-fixtures.ts'

const width = 256
const height = 192
const source = new Uint8Array(width * height * 3)
const clampByte = (value: number): number => Math.max(0, Math.min(255, value))
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 3
    const texture = ((x * 29 + y * 17 + ((x * y) % 97)) & 31) - 16
    const patch = ((x >> 4) + (y >> 4)) & 1 ? 10 : -10
    source[offset] = clampByte(25 + (x * 180) / width + (y * 30) / height + texture / 2 + patch)
    source[offset + 1] = clampByte(
      35 + (y * 150) / height + ((width - x) * 50) / width - texture / 3 - patch,
    )
    source[offset + 2] = clampByte(
      180 - (y * 120) / height + (x * 50) / width + texture + patch / 2,
    )
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
