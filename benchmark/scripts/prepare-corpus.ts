import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDeflate } from 'node:zlib'
import { GifWriter } from 'omggif'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import {
  allFixtures,
  corpusFilesDirectory,
  fixturePath,
  inspectFixture,
  readManifest,
  verifyInspection,
} from '../lib/corpus.ts'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import type { Fixture, GeneratedFixture, SourceFixture } from '../types.ts'

type GeneratedCorpusFixture = GeneratedFixture & { origin: 'generated' }
type SourceCorpusFixture = SourceFixture & { origin: 'download' }
type Pixel = readonly [red: number, green: number, blue: number, alpha: number]

const corpusDownloadHosts: ReadonlySet<string> = new Set([
  'd9-wret.s3.us-west-2.amazonaws.com',
  'entropymine.com',
  'gitlab.com',
  'heic.digital',
  'live.staticflickr.com',
  'raw.githubusercontent.com',
  'upload.wikimedia.org',
  'www.gstatic.com',
])

const avifBenchmarkSources: Readonly<Record<string, string>> = {
  'avif-fox-profile0-1204x800': 'fox.profile0.8bpc.yuv420.avif',
}

const writeAvifBenchmarkCopy = async (fixture: GeneratedCorpusFixture): Promise<void> => {
  const sourceName = avifBenchmarkSources[fixture.id]
  if (sourceName === undefined) {
    throw new Error(`Unknown AVIF benchmark copy fixture: ${fixture.id}`)
  }
  const source = join(corpusFilesDirectory, 'avif', sourceName)
  await writeFile(fixturePath(fixture), await readFile(source))
}

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

const writeTiffGradient = async (
  fixture: GeneratedCorpusFixture,
  photometric: 2 | 8 = 2,
): Promise<void> => {
  const { width, height } = fixture.expected
  const rowsPerStrip = 32
  const stripCount = Math.ceil(height / rowsPerStrip)
  const entryCount = 13
  const ifdOffset = 8
  const ifdBytes = 2 + entryCount * 12 + 4
  const bitsOffset = ifdOffset + ifdBytes
  const stripOffsetsOffset = bitsOffset + 6
  const stripByteCountsOffset = stripOffsetsOffset + stripCount * 4
  const xResolutionOffset = stripByteCountsOffset + stripCount * 4
  const yResolutionOffset = xResolutionOffset + 8
  const pixelsOffset = yResolutionOffset + 8
  const header = Buffer.alloc(pixelsOffset)
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)

  header.set([0x49, 0x49], 0)
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, entryCount, true)

  let entryOffset = ifdOffset + 2
  const writeEntry = (tag: number, fieldType: number, count: number, value: number): void => {
    view.setUint16(entryOffset, tag, true)
    view.setUint16(entryOffset + 2, fieldType, true)
    view.setUint32(entryOffset + 4, count, true)
    if (fieldType === 3 && count === 1) view.setUint16(entryOffset + 8, value, true)
    else view.setUint32(entryOffset + 8, value, true)
    entryOffset += 12
  }

  writeEntry(256, 4, 1, width)
  writeEntry(257, 4, 1, height)
  writeEntry(258, 3, 3, bitsOffset)
  writeEntry(259, 3, 1, 1)
  writeEntry(262, 3, 1, photometric)
  writeEntry(273, 4, stripCount, stripOffsetsOffset)
  writeEntry(277, 3, 1, 3)
  writeEntry(278, 4, 1, rowsPerStrip)
  writeEntry(279, 4, stripCount, stripByteCountsOffset)
  writeEntry(282, 5, 1, xResolutionOffset)
  writeEntry(283, 5, 1, yResolutionOffset)
  writeEntry(284, 3, 1, 1)
  writeEntry(296, 3, 1, 2)
  view.setUint32(entryOffset, 0, true)

  view.setUint16(bitsOffset, 8, true)
  view.setUint16(bitsOffset + 2, 8, true)
  view.setUint16(bitsOffset + 4, 8, true)
  view.setUint32(xResolutionOffset, 72, true)
  view.setUint32(xResolutionOffset + 4, 1, true)
  view.setUint32(yResolutionOffset, 72, true)
  view.setUint32(yResolutionOffset + 4, 1, true)

  let stripOffset = pixelsOffset
  for (let strip = 0; strip < stripCount; strip += 1) {
    const rows = Math.min(rowsPerStrip, height - strip * rowsPerStrip)
    const byteCount = rows * width * 3
    view.setUint32(stripOffsetsOffset + strip * 4, stripOffset, true)
    view.setUint32(stripByteCountsOffset + strip * 4, byteCount, true)
    stripOffset += byteCount
  }

  const file = await open(fixturePath(fixture), 'w')
  try {
    await file.write(header)
    const row = Buffer.allocUnsafe(width * 3)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = x * 3
        row[offset] = Math.round((x / (width - 1)) * 255)
        row[offset + 1] =
          photometric === 8
            ? (Math.round((y / (height - 1)) * 160 - 80) + 256) & 0xff
            : Math.round((y / (height - 1)) * 255)
        row[offset + 2] =
          photometric === 8 ? (((x * 13 + y * 7) % 161) - 80 + 256) & 0xff : (x + y) & 0xff
      }
      await file.write(row)
    }
  } finally {
    await file.close()
  }
}

const writePacked6FillOrderTiff = async (fixture: GeneratedCorpusFixture): Promise<void> => {
  const { width, height } = fixture.expected
  const rowsPerStrip = 32
  const stripCount = Math.ceil(height / rowsPerStrip)
  const rowBytes = Math.ceil((width * 6) / 8)
  const entryCount = 12
  const ifdOffset = 8
  const ifdBytes = 2 + entryCount * 12 + 4
  const stripOffsetsOffset = ifdOffset + ifdBytes
  const stripByteCountsOffset = stripOffsetsOffset + stripCount * 4
  const pixelsOffset = stripByteCountsOffset + stripCount * 4
  const header = Buffer.alloc(pixelsOffset)
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  header.set([0x49, 0x49])
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, entryCount, true)

  let entryOffset = ifdOffset + 2
  const writeEntry = (tag: number, fieldType: number, count: number, value: number): void => {
    view.setUint16(entryOffset, tag, true)
    view.setUint16(entryOffset + 2, fieldType, true)
    view.setUint32(entryOffset + 4, count, true)
    if (fieldType === 3 && count === 1) view.setUint16(entryOffset + 8, value, true)
    else view.setUint32(entryOffset + 8, value, true)
    entryOffset += 12
  }
  writeEntry(256, 4, 1, width)
  writeEntry(257, 4, 1, height)
  writeEntry(258, 3, 1, 6)
  writeEntry(259, 3, 1, 1)
  writeEntry(262, 3, 1, 1)
  writeEntry(266, 3, 1, 2)
  writeEntry(273, 4, stripCount, stripOffsetsOffset)
  writeEntry(277, 3, 1, 1)
  writeEntry(278, 4, 1, rowsPerStrip)
  writeEntry(279, 4, stripCount, stripByteCountsOffset)
  writeEntry(284, 3, 1, 1)
  writeEntry(339, 3, 1, 1)
  view.setUint32(entryOffset, 0, true)

  let stripOffset = pixelsOffset
  for (let strip = 0; strip < stripCount; strip += 1) {
    const rows = Math.min(rowsPerStrip, height - strip * rowsPerStrip)
    const byteCount = rows * rowBytes
    view.setUint32(stripOffsetsOffset + strip * 4, stripOffset, true)
    view.setUint32(stripByteCountsOffset + strip * 4, byteCount, true)
    stripOffset += byteCount
  }

  const reversed = new Uint8Array(256)
  for (let value = 0; value < 256; value += 1) {
    let source = value
    let target = 0
    for (let bit = 0; bit < 8; bit += 1) {
      target = (target << 1) | (source & 1)
      source >>>= 1
    }
    reversed[value] = target
  }
  const file = await open(fixturePath(fixture), 'w')
  try {
    await file.write(header)
    const row = Buffer.allocUnsafe(rowBytes)
    for (let y = 0; y < height; y += 1) {
      let accumulator = 0
      let bufferedBits = 0
      let outputOffset = 0
      for (let x = 0; x < width; x += 1) {
        const sample = (x * 17 + y * 29) & 63
        accumulator = (accumulator << 6) | sample
        bufferedBits += 6
        if (bufferedBits >= 8) {
          bufferedBits -= 8
          row[outputOffset] = reversed[(accumulator >>> bufferedBits) & 0xff] ?? 0
          outputOffset += 1
          accumulator &= (1 << bufferedBits) - 1
        }
      }
      if (bufferedBits > 0) {
        row[outputOffset] = reversed[(accumulator << (8 - bufferedBits)) & 0xff] ?? 0
      }
      await file.write(row)
    }
  } finally {
    await file.close()
  }
}

const writePacked12Tiff = async (
  fixture: GeneratedCorpusFixture,
  tiled: boolean,
): Promise<void> => {
  const { width, height } = fixture.expected
  const segmentWidth = tiled ? 256 : width
  const segmentHeight = tiled ? 256 : 32
  const segmentsAcross = tiled ? Math.ceil(width / segmentWidth) : 1
  const segmentsDown = Math.ceil(height / segmentHeight)
  const segmentCount = segmentsAcross * segmentsDown
  const entryCount = tiled ? 11 : 10
  const ifdOffset = 8
  const ifdBytes = 2 + entryCount * 12 + 4
  const bitsOffset = ifdOffset + ifdBytes
  const segmentOffsetsOffset = bitsOffset + 6
  const segmentByteCountsOffset = segmentOffsetsOffset + segmentCount * 4
  const pixelsOffset = segmentByteCountsOffset + segmentCount * 4
  const header = Buffer.alloc(pixelsOffset)
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  header.set([0x49, 0x49])
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, entryCount, true)

  let entryOffset = ifdOffset + 2
  const writeEntry = (tag: number, fieldType: number, count: number, value: number): void => {
    view.setUint16(entryOffset, tag, true)
    view.setUint16(entryOffset + 2, fieldType, true)
    view.setUint32(entryOffset + 4, count, true)
    if (fieldType === 3 && count === 1) view.setUint16(entryOffset + 8, value, true)
    else view.setUint32(entryOffset + 8, value, true)
    entryOffset += 12
  }

  writeEntry(256, 4, 1, width)
  writeEntry(257, 4, 1, height)
  writeEntry(258, 3, 3, bitsOffset)
  writeEntry(259, 3, 1, 1)
  writeEntry(262, 3, 1, 2)
  if (!tiled) writeEntry(273, 4, segmentCount, segmentOffsetsOffset)
  writeEntry(277, 3, 1, 3)
  if (!tiled) {
    writeEntry(278, 4, 1, segmentHeight)
    writeEntry(279, 4, segmentCount, segmentByteCountsOffset)
  }
  writeEntry(284, 3, 1, 1)
  if (tiled) {
    writeEntry(322, 4, 1, segmentWidth)
    writeEntry(323, 4, 1, segmentHeight)
    writeEntry(324, 4, segmentCount, segmentOffsetsOffset)
    writeEntry(325, 4, segmentCount, segmentByteCountsOffset)
  }
  view.setUint32(entryOffset, 0, true)
  view.setUint16(bitsOffset, 12, true)
  view.setUint16(bitsOffset + 2, 12, true)
  view.setUint16(bitsOffset + 4, 12, true)

  let pixelOffset = pixelsOffset
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const segmentRow = Math.floor(segment / segmentsAcross)
    const rows = tiled
      ? segmentHeight
      : Math.min(segmentHeight, height - segmentRow * segmentHeight)
    const byteCount = (segmentWidth * rows * 36) >>> 3
    view.setUint32(segmentOffsetsOffset + segment * 4, pixelOffset, true)
    view.setUint32(segmentByteCountsOffset + segment * 4, byteCount, true)
    pixelOffset += byteCount
  }

  const file = await open(fixturePath(fixture), 'w')
  try {
    await file.write(header)
    const row = Buffer.allocUnsafe((segmentWidth * 36) >>> 3)
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const segmentX = (segment % segmentsAcross) * segmentWidth
      const segmentY = Math.floor(segment / segmentsAcross) * segmentHeight
      const rows = tiled ? segmentHeight : Math.min(segmentHeight, height - segmentY)
      for (let localY = 0; localY < rows; localY += 1) {
        const y = segmentY + localY
        const green = y < height ? Math.round((y / (height - 1)) * 4_095) : 0
        for (let localX = 0; localX < segmentWidth; localX += 2) {
          const x0 = segmentX + localX
          const x1 = x0 + 1
          const valid0 = x0 < width && y < height
          const valid1 = x1 < width && y < height
          const red0 = valid0 ? Math.round((x0 / (width - 1)) * 4_095) : 0
          const blue0 = valid0 ? (x0 + y) & 4_095 : 0
          const red1 = valid1 ? Math.round((x1 / (width - 1)) * 4_095) : 0
          const blue1 = valid1 ? (x1 + y) & 4_095 : 0
          const green0 = valid0 ? green : 0
          const green1 = valid1 ? green : 0
          const target = (localX >>> 1) * 9
          row[target] = red0 >>> 4
          row[target + 1] = ((red0 & 15) << 4) | (green0 >>> 8)
          row[target + 2] = green0
          row[target + 3] = blue0 >>> 4
          row[target + 4] = ((blue0 & 15) << 4) | (red1 >>> 8)
          row[target + 5] = red1
          row[target + 6] = green1 >>> 4
          row[target + 7] = ((green1 & 15) << 4) | (blue1 >>> 8)
          row[target + 8] = blue1
        }
        await file.write(row)
      }
    }
  } finally {
    await file.close()
  }
}
const align8 = (value: number): number => (value + 7) & ~7

const writeBigTiffRgb16 = async (fixture: GeneratedCorpusFixture): Promise<void> => {
  const { width, height } = fixture.expected
  const rowsPerStrip = 32
  const stripCount = Math.ceil(height / rowsPerStrip)
  const entryCount = 10
  const ifdOffset = 16
  const ifdBytes = 8 + entryCount * 20 + 8
  const bitsOffset = ifdOffset + ifdBytes
  const stripOffsetsOffset = align8(bitsOffset + 6)
  const stripByteCountsOffset = stripOffsetsOffset + stripCount * 8
  const pixelsOffset = align8(stripByteCountsOffset + stripCount * 8)
  const header = Buffer.alloc(pixelsOffset)
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)

  header.set([0x49, 0x49])
  view.setUint16(2, 43, true)
  view.setUint16(4, 8, true)
  view.setUint16(6, 0, true)
  view.setBigUint64(8, BigInt(ifdOffset), true)
  view.setBigUint64(ifdOffset, BigInt(entryCount), true)

  let entryOffset = ifdOffset + 8
  const writeEntry = (tag: number, fieldType: number, count: number, value: number): void => {
    view.setUint16(entryOffset, tag, true)
    view.setUint16(entryOffset + 2, fieldType, true)
    view.setBigUint64(entryOffset + 4, BigInt(count), true)
    if (fieldType === 3 && count === 1) view.setUint16(entryOffset + 12, value, true)
    else if (fieldType === 4 && count === 1) view.setUint32(entryOffset + 12, value, true)
    else view.setBigUint64(entryOffset + 12, BigInt(value), true)
    entryOffset += 20
  }

  writeEntry(256, 4, 1, width)
  writeEntry(257, 4, 1, height)
  const bitsEntryValueOffset = entryOffset + 12
  writeEntry(258, 3, 3, 0)
  writeEntry(259, 3, 1, 1)
  writeEntry(262, 3, 1, 2)
  writeEntry(273, 16, stripCount, stripOffsetsOffset)
  writeEntry(277, 3, 1, 3)
  writeEntry(278, 4, 1, rowsPerStrip)
  writeEntry(279, 16, stripCount, stripByteCountsOffset)
  writeEntry(284, 3, 1, 1)
  view.setBigUint64(entryOffset, 0n, true)
  view.setUint16(bitsEntryValueOffset, 16, true)
  view.setUint16(bitsEntryValueOffset + 2, 16, true)
  view.setUint16(bitsEntryValueOffset + 4, 16, true)

  let stripOffset = pixelsOffset
  for (let strip = 0; strip < stripCount; strip += 1) {
    const rows = Math.min(rowsPerStrip, height - strip * rowsPerStrip)
    const byteCount = rows * width * 6
    view.setBigUint64(stripOffsetsOffset + strip * 8, BigInt(stripOffset), true)
    view.setBigUint64(stripByteCountsOffset + strip * 8, BigInt(byteCount), true)
    stripOffset += byteCount
  }

  const file = await open(fixturePath(fixture), 'w')
  try {
    await file.write(header)
    const row = Buffer.allocUnsafe(width * 6)
    const rowView = new DataView(row.buffer, row.byteOffset, row.byteLength)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = x * 6
        rowView.setUint16(offset, Math.round((x / (width - 1)) * 65_535), true)
        rowView.setUint16(offset + 2, Math.round((y / (height - 1)) * 65_535), true)
        rowView.setUint16(offset + 4, (x * 31 + y * 17) & 0xffff, true)
      }
      await file.write(row)
    }
  } finally {
    await file.close()
  }
}

const writePlanarCmyk8Tiff = async (fixture: GeneratedCorpusFixture): Promise<void> => {
  const { width, height } = fixture.expected
  const rowsPerStrip = 32
  const stripsPerPlane = Math.ceil(height / rowsPerStrip)
  const stripCount = stripsPerPlane * 4
  const entryCount = 10
  const ifdOffset = 8
  const ifdBytes = 2 + entryCount * 12 + 4
  const bitsOffset = ifdOffset + ifdBytes
  const stripOffsetsOffset = bitsOffset + 8
  const stripByteCountsOffset = stripOffsetsOffset + stripCount * 4
  const pixelsOffset = stripByteCountsOffset + stripCount * 4
  const header = Buffer.alloc(pixelsOffset)
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)

  header.set([0x49, 0x49])
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, entryCount, true)

  let entryOffset = ifdOffset + 2
  const writeEntry = (tag: number, fieldType: number, count: number, value: number): void => {
    view.setUint16(entryOffset, tag, true)
    view.setUint16(entryOffset + 2, fieldType, true)
    view.setUint32(entryOffset + 4, count, true)
    if (fieldType === 3 && count === 1) view.setUint16(entryOffset + 8, value, true)
    else view.setUint32(entryOffset + 8, value, true)
    entryOffset += 12
  }

  writeEntry(256, 4, 1, width)
  writeEntry(257, 4, 1, height)
  writeEntry(258, 3, 4, bitsOffset)
  writeEntry(259, 3, 1, 1)
  writeEntry(262, 3, 1, 5)
  writeEntry(273, 4, stripCount, stripOffsetsOffset)
  writeEntry(277, 3, 1, 4)
  writeEntry(278, 4, 1, rowsPerStrip)
  writeEntry(279, 4, stripCount, stripByteCountsOffset)
  writeEntry(284, 3, 1, 2)
  view.setUint32(entryOffset, 0, true)
  for (let sample = 0; sample < 4; sample += 1) {
    view.setUint16(bitsOffset + sample * 2, 8, true)
  }

  let stripOffset = pixelsOffset
  for (let sample = 0; sample < 4; sample += 1) {
    for (let strip = 0; strip < stripsPerPlane; strip += 1) {
      const index = sample * stripsPerPlane + strip
      const rows = Math.min(rowsPerStrip, height - strip * rowsPerStrip)
      const byteCount = rows * width
      view.setUint32(stripOffsetsOffset + index * 4, stripOffset, true)
      view.setUint32(stripByteCountsOffset + index * 4, byteCount, true)
      stripOffset += byteCount
    }
  }

  const file = await open(fixturePath(fixture), 'w')
  try {
    await file.write(header)
    const row = Buffer.allocUnsafe(width)
    for (let sample = 0; sample < 4; sample += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          row[x] =
            sample === 0
              ? Math.round((x / (width - 1)) * 255)
              : sample === 1
                ? Math.round((y / (height - 1)) * 255)
                : sample === 2
                  ? (x + y) & 0xff
                  : (x ^ y) & 0x7f
        }
        await file.write(row)
      }
    }
  } finally {
    await file.close()
  }
}

const writeWebpGradient = async (
  fixture: GeneratedCorpusFixture,
  lossless: boolean,
): Promise<void> => {
  const { width, height } = fixture.expected
  const pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      pixels[offset] = Math.round((x / (width - 1)) * 255)
      pixels[offset + 1] = Math.round((y / (height - 1)) * 255)
      pixels[offset + 2] = (x + y) & 255
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .webp({ lossless, quality: 82, effort: 6 })
    .toFile(fixturePath(fixture))
}

interface IcoPayload {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly data: Uint8Array
}

const rgbaPng = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => Pixel,
): Uint8Array => {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      image.data.set(pixel(x, y), (y * width + x) * 4)
    }
  }
  return PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 })
}

const dibIcon = ({
  width,
  height,
  bitDepth,
  pixel,
  transparent,
}: {
  width: number
  height: number
  bitDepth: 24 | 32
  pixel(x: number, y: number): Pixel
  transparent(x: number, y: number): boolean
}): Uint8Array => {
  const xorStride = Math.floor((width * bitDepth + 31) / 32) * 4
  const andStride = Math.floor((width + 31) / 32) * 4
  const output = new Uint8Array(40 + xorStride * height + andStride * height)
  const view = new DataView(output.buffer)
  view.setUint32(0, 40, true)
  view.setInt32(4, width, true)
  view.setInt32(8, height * 2, true)
  view.setUint16(12, 1, true)
  view.setUint16(14, bitDepth, true)
  view.setUint32(20, xorStride * height, true)
  const bytesPerPixel = bitDepth >>> 3
  const andOffset = 40 + xorStride * height
  for (let storedY = 0; storedY < height; storedY += 1) {
    const y = height - 1 - storedY
    const xorRow = 40 + storedY * xorStride
    const andRow = andOffset + storedY * andStride
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = pixel(x, y)
      const offset = xorRow + x * bytesPerPixel
      output[offset] = blue
      output[offset + 1] = green
      output[offset + 2] = red
      if (bytesPerPixel === 4) output[offset + 3] = alpha
      if (transparent(x, y)) {
        const maskOffset = andRow + (x >>> 3)
        output[maskOffset] = (output[maskOffset] ?? 0) | (0x80 >>> (x & 7))
      }
    }
  }
  return output
}

const icoFile = (payloads: readonly IcoPayload[]): Uint8Array => {
  const directoryBytes = 6 + payloads.length * 16
  const payloadBytes = payloads.reduce((total, payload) => total + payload.data.byteLength, 0)
  const output = new Uint8Array(directoryBytes + payloadBytes)
  const view = new DataView(output.buffer)
  view.setUint16(2, 1, true)
  view.setUint16(4, payloads.length, true)
  let payloadOffset = directoryBytes
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index]
    if (!payload) continue
    const entry = 6 + index * 16
    output[entry] = payload.width === 256 ? 0 : payload.width
    output[entry + 1] = payload.height === 256 ? 0 : payload.height
    view.setUint16(entry + 4, 1, true)
    view.setUint16(entry + 6, payload.bitDepth, true)
    view.setUint32(entry + 8, payload.data.byteLength, true)
    view.setUint32(entry + 12, payloadOffset, true)
    output.set(payload.data, payloadOffset)
    payloadOffset += payload.data.byteLength
  }
  return output
}

const writeIcoFixture = async (fixture: GeneratedCorpusFixture): Promise<void> => {
  let payloads: readonly IcoPayload[]
  if (fixture.generator === 'ico-mixed') {
    const small = (size: number, red: number, green: number): IcoPayload => ({
      width: size,
      height: size,
      bitDepth: 32,
      data: dibIcon({
        width: size,
        height: size,
        bitDepth: 32,
        pixel: () => [red, green, 40, 255],
        transparent: () => false,
      }),
    })
    payloads = [
      small(16, 230, 30),
      small(32, 40, 210),
      {
        width: 256,
        height: 256,
        bitDepth: 32,
        data: rgbaPng(256, 256, (x, y) => [
          x,
          y,
          x ^ y,
          x < 16 || y < 16 ? 0 : 128 + ((x + y) & 127),
        ]),
      },
    ]
  } else if (fixture.generator === 'ico-dib32') {
    payloads = [
      {
        width: fixture.expected.width,
        height: fixture.expected.height,
        bitDepth: 32,
        data: dibIcon({
          width: fixture.expected.width,
          height: fixture.expected.height,
          bitDepth: 32,
          pixel: (x, y) => [
            (x * 3) & 255,
            (y * 5) & 255,
            (x + y) & 255,
            64 + ((x * 7 + y * 11) & 191),
          ],
          transparent: () => false,
        }),
      },
    ]
  } else {
    payloads = [
      {
        width: fixture.expected.width,
        height: fixture.expected.height,
        bitDepth: 24,
        data: dibIcon({
          width: fixture.expected.width,
          height: fixture.expected.height,
          bitDepth: 24,
          pixel: (x, y) => [
            Math.round((x / (fixture.expected.width - 1)) * 255),
            Math.round((y / (fixture.expected.height - 1)) * 255),
            (x * 13 + y * 7) & 255,
            255,
          ],
          transparent: (x, y) =>
            x < 3 || y < 3 || x >= fixture.expected.width - 3 || y >= fixture.expected.height - 3,
        }),
      },
    ]
  }
  await writeFile(fixturePath(fixture), icoFile(payloads))
}

let noiseState = 0x6d2b79f5
const nextNoiseByte = (): number => {
  noiseState ^= noiseState << 13
  noiseState ^= noiseState >>> 17
  noiseState ^= noiseState << 5
  return noiseState & 0xff
}

const smallCodecPreparer = fileURLToPath(
  new URL('../small-codecs/prepare-benchmark-corpus.ts', import.meta.url),
)

const generate = async (fixture: GeneratedCorpusFixture): Promise<void> => {
  switch (fixture.generator) {
    case 'avif-benchmark-copy':
      return writeAvifBenchmarkCopy(fixture)
    case 'bmp-gradient':
      return writeBmpGradient(fixture)
    case 'ico-dib24':
    case 'ico-dib32':
    case 'ico-mixed':
      return writeIcoFixture(fixture)
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
    case 'tiff-gradient':
      return writeTiffGradient(fixture)
    case 'tiff-cielab8-strip':
      return writeTiffGradient(fixture, 8)
    case 'tiff-fillorder6-strip':
      return writePacked6FillOrderTiff(fixture)
    case 'tiff-bigtiff-rgb16':
      return writeBigTiffRgb16(fixture)
    case 'tiff-cmyk8-planar':
      return writePlanarCmyk8Tiff(fixture)
    case 'tiff-packed12-strip':
      return writePacked12Tiff(fixture, false)
    case 'tiff-packed12-tile':
      return writePacked12Tiff(fixture, true)
    case 'small-codec-corpus':
      execFileSync(process.execPath, ['--experimental-strip-types', smallCodecPreparer], {
        stdio: 'inherit',
      })
      return
    case 'webp-gradient-lossless':
      return writeWebpGradient(fixture, true)
    case 'webp-gradient-lossy':
      return writeWebpGradient(fixture, false)
    default:
      throw new Error(`Unknown fixture generator: ${fixture.generator}`)
  }
}

const download = async (fixture: SourceCorpusFixture): Promise<void> => {
  const destination = fixturePath(fixture)
  await downloadPinnedFile({
    allowedDirectory: corpusFilesDirectory,
    allowedHosts: corpusDownloadHosts,
    destination,
    expectedSha256: fixture.expected.sha256,
    url: fixture.url,
  })
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
const requestedFixtureIds = new Set(process.argv.slice(2))

for (const fixture of allFixtures(manifest)) {
  if (requestedFixtureIds.size > 0 && !requestedFixtureIds.has(fixture.id)) continue
  if (await isValid(fixture)) {
    console.log(`ok       ${fixture.id}`)
    continue
  }

  if (fixture.origin === 'download') {
    console.log(`download ${fixture.id}`)
    await download(fixture)
  } else {
    console.log(`generate ${fixture.id}`)
    await rm(fixturePath(fixture), { force: true })
    await generate(fixture)
  }

  const inspection = await inspectFixture(fixture)
  const errors = verifyInspection(fixture, inspection)
  if (errors.length > 0) {
    throw new Error(`${basename(fixture.file)} failed verification: ${errors.join('; ')}`)
  }
}
