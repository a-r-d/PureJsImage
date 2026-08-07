import { once } from 'node:events'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { createDeflate } from 'node:zlib'
import { GifWriter } from 'omggif'
import { PNG } from 'pngjs'
import {
  allFixtures,
  corpusFilesDirectory,
  fixturePath,
  inspectFixture,
  readManifest,
  verifyInspection,
} from '../lib/corpus.ts'
import type { Fixture, GeneratedFixture, SourceFixture } from '../types.ts'

type GeneratedCorpusFixture = GeneratedFixture & { origin: 'generated' }
type SourceCorpusFixture = SourceFixture & { origin: 'download' }
type Pixel = readonly [red: number, green: number, blue: number, alpha: number]

const writeRgbaPng = async ({
  fixture,
  pixel,
}: {
  fixture: GeneratedCorpusFixture
  pixel(x: number, y: number, width: number, height: number): Pixel
}): Promise<void> => {
  const { width, height } = fixture.expected
  const image = new PNG({ width, height })

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const [red, green, blue, alpha] = pixel(x, y, width, height)
      image.data[offset] = red
      image.data[offset + 1] = green
      image.data[offset + 2] = blue
      image.data[offset + 3] = alpha
    }
  }

  await writeFile(
    fixturePath(fixture),
    PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 }),
  )
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

const crc32 = (buffer: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data: Buffer): Buffer => {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

const writeStreamingStressPng = async (fixture: GeneratedCorpusFixture): Promise<void> => {
  const { width, height } = fixture.expected
  const compressed: Buffer[] = []
  const deflate = createDeflate({ level: 6 })
  deflate.on('data', (chunk: Buffer) => compressed.push(chunk))

  for (let y = 0; y < height; y += 1) {
    const row = Buffer.allocUnsafe(1 + width * 4)
    row[0] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4
      row[offset] = (x >>> 4) & 0xff
      row[offset + 1] = (y >>> 4) & 0xff
      row[offset + 2] = ((x + y) >>> 5) & 0xff
      row[offset + 3] = 0xff
    }
    if (!deflate.write(row)) {
      await once(deflate, 'drain')
    }
  }

  deflate.end()
  await once(deflate, 'end')

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6

  await writeFile(
    fixturePath(fixture),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', Buffer.concat(compressed)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

const writeStaticTransparentGif = async (fixture: GeneratedCorpusFixture): Promise<void> => {
  const { width, height } = fixture.expected
  const pixels = new Array<number>(width * height).fill(0)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x > width / 8 && x < (width * 7) / 8 && y > height / 4 && y < (height * 3) / 4
      pixels[y * width + x] = inside ? 1 + ((x >>> 5) % 3) : 0
    }
  }

  const output = Buffer.alloc(width * height * 2 + 4096)
  const writer = new GifWriter(output, width, height, {
    palette: [0x000000, 0xff6b35, 0xf7c548, 0x2d7dd2],
  })
  writer.addFrame(0, 0, width, height, pixels, { transparent: 0 })
  const length = writer.end()
  await writeFile(fixturePath(fixture), output.subarray(0, length))
}

const writeBmpGradient = async (fixture: GeneratedCorpusFixture): Promise<void> => {
  const { width, height } = fixture.expected
  const rowStride = (width * 3 + 3) & ~3
  const fileSize = 54 + rowStride * height
  const header = new Uint8Array(54)
  const view = new DataView(header.buffer)
  header.set([0x42, 0x4d])
  view.setUint32(2, fileSize, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, rowStride * height, true)

  const file = await open(fixturePath(fixture), 'w')
  try {
    await file.write(header)
    const row = new Uint8Array(rowStride)
    for (let storedY = 0; storedY < height; storedY += 1) {
      const y = height - 1 - storedY
      for (let x = 0; x < width; x += 1) {
        const offset = x * 3
        row[offset] = (x + y) & 0xff
        row[offset + 1] = Math.round((y / (height - 1)) * 255)
        row[offset + 2] = Math.round((x / (width - 1)) * 255)
      }
      await file.write(row)
    }
  } finally {
    await file.close()
  }
}

let noiseState = 0x6d2b79f5
const nextNoiseByte = (): number => {
  noiseState ^= noiseState << 13
  noiseState ^= noiseState >>> 17
  noiseState ^= noiseState << 5
  return noiseState & 0xff
}

const generate = async (fixture: GeneratedCorpusFixture): Promise<void> => {
  switch (fixture.generator) {
    case 'bmp-gradient':
      return writeBmpGradient(fixture)
    case 'rgba-gradient':
      return writeRgbaPng({
        fixture,
        pixel: (x, y, width, height) => [
          Math.round((x / (width - 1)) * 255),
          Math.round((y / (height - 1)) * 255),
          (x + y) & 0xff,
          Math.round((((x ^ y) & 0xff) / 255) * 192 + 63),
        ],
      })
    case 'transparent-logo':
      return writeRgbaPng({
        fixture,
        pixel: (x, y, width, height) => {
          const dx = x - width / 2
          const dy = y - height / 2
          const inside =
            (dx * dx) / (width * width * 0.2) + (dy * dy) / (height * height * 0.12) < 1
          return inside ? [20, 110 + ((x >>> 3) & 63), 210, 220] : [0, 0, 0, 0]
        },
      })
    case 'seeded-noise':
      noiseState = 0x6d2b79f5
      return writeRgbaPng({
        fixture,
        pixel: () => [nextNoiseByte(), nextNoiseByte(), nextNoiseByte(), 255],
      })
    case 'odd-rgba':
      return writeRgbaPng({
        fixture,
        pixel: (x, y) => [x & 0xff, y & 0xff, (x * 17 + y * 31) & 0xff, (x + y) & 0xff],
      })
    case 'tiny-transparent':
      return writeRgbaPng({ fixture, pixel: () => [0, 0, 0, 0] })
    case 'static-transparent-gif':
      return writeStaticTransparentGif(fixture)
    case 'streaming-stress-gradient':
      return writeStreamingStressPng(fixture)
    default:
      throw new Error(`Unknown fixture generator: ${fixture.generator}`)
  }
}

const download = async (fixture: SourceCorpusFixture): Promise<void> => {
  const destination = fixturePath(fixture)
  const temporary = `${destination}.download`
  const response = await fetch(fixture.url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Failed to download ${fixture.id}: HTTP ${response.status}`)
  }
  await writeFile(temporary, Buffer.from(await response.arrayBuffer()))
  await rename(temporary, destination)
}

const isValid = async (fixture: Fixture): Promise<boolean> => {
  try {
    return verifyInspection(fixture, await inspectFixture(fixture)).length === 0
  } catch {
    return false
  }
}

const manifest = await readManifest()
await mkdir(corpusFilesDirectory, { recursive: true })

for (const fixture of allFixtures(manifest)) {
  if (await isValid(fixture)) {
    console.log(`ok       ${fixture.id}`)
    continue
  }

  await rm(fixturePath(fixture), { force: true })
  if (fixture.origin === 'download') {
    console.log(`download ${fixture.id}`)
    await download(fixture)
  } else {
    console.log(`generate ${fixture.id}`)
    await generate(fixture)
  }

  const inspection = await inspectFixture(fixture)
  const errors = verifyInspection(fixture, inspection)
  if (errors.length > 0) {
    throw new Error(`${basename(fixture.file)} failed verification: ${errors.join('; ')}`)
  }
}
