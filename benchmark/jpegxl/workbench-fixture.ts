import { deflateSync } from 'node:zlib'
import { crc32 } from '../../src/codecs/crc32.ts'

const uint32 = (value: number): Uint8Array => {
  const output = new Uint8Array(4)
  new DataView(output.buffer).setUint32(0, value, false)
  return output
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0))
  const output = new Uint8Array(12 + data.byteLength)
  output.set(uint32(data.byteLength), 0)
  output.set(typeBytes, 4)
  output.set(data, 8)
  output.set(uint32(crc32(typeBytes, data)), 8 + data.byteLength)
  return output
}

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

export const jpegXlWorkbenchPng = (): Uint8Array => {
  const width = 17
  const height = 11
  const header = new Uint8Array(13)
  const headerView = new DataView(header.buffer)
  headerView.setUint32(0, width, false)
  headerView.setUint32(4, height, false)
  header[8] = 8
  header[9] = 6
  const rows = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4)
    rows[row] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4
      rows[offset] = (x * 17 + y * 11) & 255
      rows[offset + 1] = (x * 5 + y * 29) & 255
      rows[offset + 2] = ((x >>> 1) * 61 + (y >>> 1) * 37) & 255
      rows[offset + 3] = (x + y) % 5 === 0 ? 0 : (x * 31 + y * 47) & 255
    }
  }
  return concatenate([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', header),
    chunk('sRGB', Uint8Array.of(1)),
    chunk('IDAT', new Uint8Array(deflateSync(rows, { level: 9 }))),
    chunk('IEND', new Uint8Array()),
  ])
}
