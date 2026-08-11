import { crc32 } from '../src/codecs/crc32.ts'

const uint16BigEndian = (value: number): [number, number] => [value >>> 8, value & 0xff]

export const pngFixture = (
  width: number,
  height: number,
  colorType = 6,
): Uint8Array<ArrayBuffer> => {
  const data = new Uint8Array(33)
  data.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  data.set([0, 0, 0, 13, 73, 72, 68, 82], 8)
  new DataView(data.buffer).setUint32(16, width)
  new DataView(data.buffer).setUint32(20, height)
  data.set([8, colorType, 0, 0, 0], 24)
  new DataView(data.buffer).setUint32(29, crc32(data.subarray(12, 16), data.subarray(16, 29)))
  return data
}

export const jpegFixture = (
  width: number,
  height: number,
  orientation?: number,
): Uint8Array<ArrayBuffer> => {
  const bytes: number[] = [0xff, 0xd8]

  if (orientation !== undefined) {
    const exif = [
      0x45,
      0x78,
      0x69,
      0x66,
      0,
      0,
      0x49,
      0x49,
      0x2a,
      0,
      8,
      0,
      0,
      0,
      1,
      0,
      0x12,
      0x01,
      3,
      0,
      1,
      0,
      0,
      0,
      orientation,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]
    bytes.push(0xff, 0xe1, ...uint16BigEndian(exif.length + 2), ...exif)
  }

  bytes.push(
    0xff,
    0xc0,
    0,
    11,
    8,
    ...uint16BigEndian(height),
    ...uint16BigEndian(width),
    1,
    1,
    0x11,
    0,
    0xff,
    0xda,
    0,
    2,
  )
  return Uint8Array.from(bytes)
}

export const gifFixture = (width: number, height: number, frames = 1): Uint8Array<ArrayBuffer> => {
  const bytes = [
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61,
    width & 0xff,
    width >>> 8,
    height & 0xff,
    height >>> 8,
    0x80,
    0,
    0,
    0,
    0,
    0,
    0xff,
    0xff,
    0xff,
  ]

  for (let frame = 0; frame < frames; frame += 1) {
    bytes.push(
      0x21,
      0xf9,
      4,
      1,
      0,
      0,
      0,
      0,
      0x2c,
      0,
      0,
      0,
      0,
      width & 0xff,
      width >>> 8,
      height & 0xff,
      height >>> 8,
      0,
      2,
      1,
      0,
      0,
    )
  }
  bytes.push(0x3b)
  return Uint8Array.from(bytes)
}

export const jpegXlContainerFixture = (): Uint8Array<ArrayBuffer> =>
  Uint8Array.of(
    0x00,
    0x00,
    0x00,
    0x0c,
    0x4a,
    0x58,
    0x4c,
    0x20,
    0x0d,
    0x0a,
    0x87,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x14,
    0x66,
    0x74,
    0x79,
    0x70,
    0x6a,
    0x78,
    0x6c,
    0x20,
    0x00,
    0x00,
    0x00,
    0x00,
    0x6a,
    0x78,
    0x6c,
    0x20,
    0x00,
    0x00,
    0x00,
    0x0c,
    0x6a,
    0x78,
    0x6c,
    0x63,
    0xff,
    0x0a,
    0x01,
    0x02,
  )
