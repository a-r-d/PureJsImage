import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import jpeg from 'jpeg-js'
import { encodeJpegIdentityComponents } from '../src/codecs/jpeg-encode.ts'

type FixtureCompression = 1 | 5 | 7 | 8 | 32773
type FieldType = 2 | 3 | 4 | 7 | 12 | 16 | 18

interface GeoFixture {
  readonly kind: 'north-up' | 'rotated'
  readonly pixelIsPoint?: boolean
  readonly nodata?: string
}

interface LevelFixture {
  readonly width: number
  readonly height: number
  readonly tileWidth: number
  readonly tileHeight: number
  readonly samples: 1 | 3 | 4
  readonly compression: FixtureCompression
  readonly photometric?: 1 | 2 | 6
  readonly extraSamples?: readonly number[]
  readonly jpegTables?: boolean
  readonly geo?: GeoFixture
}

interface CogFixture {
  readonly filename: string
  readonly bigTiff?: boolean
  readonly levels: readonly LevelFixture[]
}

interface Entry {
  readonly tag: number
  readonly type: FieldType
  readonly values: readonly number[] | string
}

interface EncodedLevel {
  readonly definition: LevelFixture
  readonly tiles: readonly Uint8Array[]
  readonly jpegTables?: Uint8Array
}

const outputDirectory = resolve('tests/fixtures/cog')

const fixtures: readonly CogFixture[] = [
  {
    filename: 'classic-deflate-rgb-nodata.tif',
    levels: [
      {
        width: 16,
        height: 16,
        tileWidth: 8,
        tileHeight: 8,
        samples: 3,
        compression: 8,
        geo: { kind: 'north-up', nodata: '0' },
      },
    ],
  },
  {
    filename: 'bigtiff-lzw-rgba.tif',
    bigTiff: true,
    levels: [
      {
        width: 8,
        height: 8,
        tileWidth: 4,
        tileHeight: 4,
        samples: 4,
        compression: 5,
        geo: { kind: 'north-up', pixelIsPoint: true, nodata: '0 0 0 255' },
      },
    ],
  },
  {
    filename: 'subifd-deflate-rotated.tif',
    levels: [
      {
        width: 32,
        height: 32,
        tileWidth: 8,
        tileHeight: 8,
        samples: 3,
        compression: 8,
        geo: { kind: 'rotated', nodata: '255' },
      },
      {
        width: 16,
        height: 16,
        tileWidth: 8,
        tileHeight: 8,
        samples: 3,
        compression: 8,
      },
    ],
  },
  {
    filename: 'showcase-subifd-deflate-rotated.tif',
    levels: [
      {
        width: 2_048,
        height: 1_024,
        tileWidth: 128,
        tileHeight: 128,
        samples: 3,
        compression: 8,
        geo: { kind: 'rotated', nodata: '255' },
      },
      {
        width: 1_024,
        height: 512,
        tileWidth: 128,
        tileHeight: 128,
        samples: 3,
        compression: 8,
      },
      {
        width: 512,
        height: 256,
        tileWidth: 128,
        tileHeight: 128,
        samples: 3,
        compression: 8,
      },
    ],
  },
  {
    filename: 'classic-packbits-gray.tif',
    levels: [
      {
        width: 16,
        height: 8,
        tileWidth: 8,
        tileHeight: 8,
        samples: 1,
        compression: 32773,
        geo: { kind: 'north-up' },
      },
    ],
  },
  {
    filename: 'classic-jpeg-rgb.tif',
    levels: [
      {
        width: 16,
        height: 8,
        tileWidth: 8,
        tileHeight: 8,
        samples: 3,
        compression: 7,
        geo: { kind: 'north-up' },
      },
    ],
  },
  {
    filename: 'classic-jpeg-rgb-nir.tif',
    levels: [
      {
        width: 20,
        height: 12,
        tileWidth: 8,
        tileHeight: 8,
        samples: 4,
        compression: 7,
        photometric: 2,
        extraSamples: [0],
        jpegTables: true,
        geo: { kind: 'north-up' },
      },
      {
        width: 10,
        height: 6,
        tileWidth: 8,
        tileHeight: 8,
        samples: 4,
        compression: 7,
        photometric: 2,
        extraSamples: [0],
        jpegTables: true,
      },
    ],
  },
]

const align = (value: number, alignment: number): number => Math.ceil(value / alignment) * alignment
const typeBytes = (type: FieldType): number =>
  type === 2 || type === 7 ? 1 : type === 3 ? 2 : type === 4 ? 4 : 8

const entryCount = (entry: Entry): number =>
  typeof entry.values === 'string'
    ? new TextEncoder().encode(`${entry.values}\0`).byteLength
    : entry.values.length

const entryBytes = (entry: Entry): number => entryCount(entry) * typeBytes(entry.type)

const entryPayload = (entry: Entry, littleEndian: boolean): Uint8Array => {
  if (typeof entry.values === 'string') {
    return Uint8Array.from([...new TextEncoder().encode(entry.values), 0])
  }
  const output = new Uint8Array(entryBytes(entry))
  const view = new DataView(output.buffer)
  for (let index = 0; index < entry.values.length; index += 1) {
    const value = entry.values[index] ?? 0
    const offset = index * typeBytes(entry.type)
    if (entry.type === 2 || entry.type === 7) output[offset] = value & 0xff
    else if (entry.type === 3) view.setUint16(offset, value, littleEndian)
    else if (entry.type === 4) view.setUint32(offset, value, littleEndian)
    else if (entry.type === 12) view.setFloat64(offset, value, littleEndian)
    else view.setBigUint64(offset, BigInt(value), littleEndian)
  }
  return output
}

const packBits = (input: Uint8Array): Uint8Array => {
  const output: number[] = []
  for (let offset = 0; offset < input.byteLength; ) {
    const length = Math.min(128, input.byteLength - offset)
    output.push(length - 1)
    for (let index = 0; index < length; index += 1) output.push(input[offset + index] ?? 0)
    offset += length
  }
  return Uint8Array.from(output)
}

const lzwLiteralStream = (input: Uint8Array): Uint8Array => {
  if (input.byteLength > 250)
    throw new Error('COG LZW fixture tile exceeds the 9-bit literal limit')
  const codes = [256, ...input, 257]
  const output: number[] = []
  let accumulator = 0
  let bits = 0
  for (const code of codes) {
    accumulator = accumulator * 512 + code
    bits += 9
    while (bits >= 8) {
      bits -= 8
      output.push(Math.floor(accumulator / 2 ** bits) & 0xff)
      accumulator %= 2 ** bits
    }
  }
  if (bits > 0) output.push((accumulator << (8 - bits)) & 0xff)
  return Uint8Array.from(output)
}

const tileSample = (
  level: LevelFixture,
  x: number,
  y: number,
  sample: number,
  tileX: number,
  tileY: number,
): number => {
  if (level.compression === 7) {
    if (sample === 0) return tileX % 2 === 0 ? 230 : 20
    if (sample === 1) return tileY % 2 === 0 ? 35 : 220
    if (sample === 2) return tileX % 2 === 0 ? 45 : 210
    return 70 + ((tileX * 40 + tileY * 55) % 140)
  }
  if (sample === 3) return 80 + ((x * 7 + y * 11) % 176)
  return (x * 17 + y * 29 + sample * 61 + 3) & 0xff
}

const rawTile = (level: LevelFixture, tileX: number, tileY: number): Uint8Array => {
  const output = new Uint8Array(level.tileWidth * level.tileHeight * level.samples)
  for (let localY = 0; localY < level.tileHeight; localY += 1) {
    for (let localX = 0; localX < level.tileWidth; localX += 1) {
      const x = tileX * level.tileWidth + localX
      const y = tileY * level.tileHeight + localY
      if (x >= level.width || y >= level.height) continue
      for (let sample = 0; sample < level.samples; sample += 1) {
        output[(localY * level.tileWidth + localX) * level.samples + sample] = tileSample(
          level,
          x,
          y,
          sample,
          tileX,
          tileY,
        )
      }
    }
  }
  return output
}

const encodeTile = (level: LevelFixture, raw: Uint8Array): Uint8Array => {
  if (level.compression === 1) return raw
  if (level.compression === 5) return lzwLiteralStream(raw)
  if (level.compression === 8) return Uint8Array.from(deflateSync(raw, { level: 9 }))
  if (level.compression === 32773) return packBits(raw)
  if (level.samples === 4 || level.jpegTables === true) {
    return encodeJpegIdentityComponents(
      level.tileWidth,
      level.tileHeight,
      level.samples,
      raw,
      level.jpegTables === true,
    ).stream
  }
  const rgba = new Uint8Array(level.tileWidth * level.tileHeight * 4)
  for (let pixel = 0; pixel < level.tileWidth * level.tileHeight; pixel += 1) {
    rgba[pixel * 4] = raw[pixel * 3] ?? 0
    rgba[pixel * 4 + 1] = raw[pixel * 3 + 1] ?? 0
    rgba[pixel * 4 + 2] = raw[pixel * 3 + 2] ?? 0
    rgba[pixel * 4 + 3] = 255
  }
  return Uint8Array.from(
    jpeg.encode({ width: level.tileWidth, height: level.tileHeight, data: rgba }, 100).data,
  )
}

const encodeLevel = (definition: LevelFixture): EncodedLevel => {
  const across = Math.ceil(definition.width / definition.tileWidth)
  const down = Math.ceil(definition.height / definition.tileHeight)
  const tiles: Uint8Array[] = []
  for (let tileY = 0; tileY < down; tileY += 1) {
    for (let tileX = 0; tileX < across; tileX += 1) {
      tiles.push(encodeTile(definition, rawTile(definition, tileX, tileY)))
    }
  }
  return {
    definition,
    tiles: Object.freeze(tiles),
    ...(definition.jpegTables === true
      ? {
          jpegTables: encodeJpegIdentityComponents(8, 8, 1, new Uint8Array(64), true).tables,
        }
      : {}),
  }
}

const geoEntries = (geo: GeoFixture | undefined): readonly Entry[] => {
  if (geo === undefined) return []
  const citation = 'WGS 84 / UTM zone 18N|'
  const keyDirectory = [
    1,
    1,
    0,
    4,
    1024,
    0,
    1,
    1,
    1025,
    0,
    1,
    geo.pixelIsPoint ? 2 : 1,
    3072,
    0,
    1,
    32618,
    3073,
    34737,
    citation.length,
    0,
  ]
  const modelEntries: readonly Entry[] =
    geo.kind === 'north-up'
      ? [
          { tag: 33550, type: 12, values: [2, 2, 0] },
          { tag: 33922, type: 12, values: [0, 0, 0, 500_000, 4_500_000, 0] },
        ]
      : [
          {
            tag: 34264,
            type: 12,
            values: [2, 0.5, 0, 100, -0.25, -2, 0, 200, 0, 0, 1, 0, 0, 0, 0, 1],
          },
        ]
  return [
    ...modelEntries,
    { tag: 34735, type: 3, values: keyDirectory },
    { tag: 34737, type: 2, values: citation },
    ...(geo.nodata === undefined ? [] : [{ tag: 42113, type: 2 as const, values: geo.nodata }]),
  ]
}

const directoryEntries = (
  level: EncodedLevel,
  levelIndex: number,
  tileOffsets: readonly number[],
  subIfdOffsets: readonly number[],
  bigTiff: boolean,
): readonly Entry[] => {
  const { definition } = level
  const offsetType: 4 | 16 = bigTiff ? 16 : 4
  const entries: Entry[] = [
    ...(levelIndex === 0 ? [] : [{ tag: 254, type: 4 as const, values: [1] }]),
    { tag: 256, type: 4, values: [definition.width] },
    { tag: 257, type: 4, values: [definition.height] },
    { tag: 258, type: 3, values: new Array<number>(definition.samples).fill(8) },
    { tag: 259, type: 3, values: [definition.compression] },
    {
      tag: 262,
      type: 3,
      values: [
        definition.photometric ??
          (definition.compression === 7 ? 6 : definition.samples === 1 ? 1 : 2),
      ],
    },
    { tag: 277, type: 3, values: [definition.samples] },
    { tag: 284, type: 3, values: [1] },
    { tag: 322, type: 4, values: [definition.tileWidth] },
    { tag: 323, type: 4, values: [definition.tileHeight] },
    { tag: 324, type: offsetType, values: tileOffsets },
    { tag: 325, type: offsetType, values: level.tiles.map(({ byteLength }) => byteLength) },
    { tag: 339, type: 3, values: new Array<number>(definition.samples).fill(1) },
    ...(definition.extraSamples !== undefined
      ? [{ tag: 338, type: 3 as const, values: definition.extraSamples }]
      : definition.samples === 4
        ? [{ tag: 338, type: 3 as const, values: [2] }]
        : []),
    ...(level.jpegTables === undefined
      ? []
      : [{ tag: 347, type: 7 as const, values: Array.from(level.jpegTables) }]),
    ...(subIfdOffsets.length === 0
      ? []
      : [{ tag: 330, type: bigTiff ? (18 as const) : (4 as const), values: subIfdOffsets }]),
    ...geoEntries(definition.geo),
  ]
  return Object.freeze(entries.sort((left, right) => left.tag - right.tag))
}

const buildFixture = (fixture: CogFixture): Uint8Array => {
  const bigTiff = fixture.bigTiff ?? false
  const headerBytes = bigTiff ? 16 : 8
  const countBytes = bigTiff ? 8 : 2
  const entryRecordBytes = bigTiff ? 20 : 12
  const inlineBytes = bigTiff ? 8 : 4
  const nextBytes = bigTiff ? 8 : 4
  const levels = fixture.levels.map(encodeLevel)
  const placeholderEntries = levels.map((level, index) =>
    directoryEntries(
      level,
      index,
      level.tiles.map(() => 0),
      index === 0 ? levels.slice(1).map(() => 0) : [],
      bigTiff,
    ),
  )
  const ifdOffsets: number[] = []
  let cursor = headerBytes
  for (const entries of placeholderEntries) {
    cursor = align(cursor, bigTiff ? 8 : 2)
    ifdOffsets.push(cursor)
    cursor += countBytes + entries.length * entryRecordBytes + nextBytes
  }
  cursor = align(cursor, 8)
  for (const entries of placeholderEntries) {
    for (const entry of entries) {
      if (entryBytes(entry) > inlineBytes) cursor = align(cursor, 8) + entryBytes(entry)
    }
  }
  cursor = align(cursor, 8)
  const mutableTileOffsets: number[][] = levels.map(() => [])
  // COG readers should reach reduced-resolution imagery before the full-resolution tile payloads.
  for (let levelIndex = levels.length - 1; levelIndex >= 0; levelIndex -= 1) {
    const level = levels[levelIndex]
    if (level === undefined) continue
    const offsets = mutableTileOffsets[levelIndex]
    if (offsets === undefined) continue
    for (const tile of level.tiles) {
      offsets.push(cursor)
      cursor += tile.byteLength
    }
  }
  const tileOffsets: readonly (readonly number[])[] = Object.freeze(
    mutableTileOffsets.map((offsets) => Object.freeze(offsets)),
  )
  const entriesByLevel = levels.map((level, index) =>
    directoryEntries(
      level,
      index,
      tileOffsets[index] ?? [],
      index === 0 ? ifdOffsets.slice(1) : [],
      bigTiff,
    ),
  )
  const output = new Uint8Array(cursor)
  const view = new DataView(output.buffer)
  const setOffset = (offset: number, value: number): void => {
    if (bigTiff) view.setBigUint64(offset, BigInt(value), true)
    else view.setUint32(offset, value, true)
  }
  if (bigTiff) {
    output.set([0x49, 0x49, 0x2b, 0])
    view.setUint16(4, 8, true)
    view.setUint16(6, 0, true)
    view.setBigUint64(8, BigInt(ifdOffsets[0] ?? 0), true)
  } else {
    output.set([0x49, 0x49, 0x2a, 0])
    view.setUint32(4, ifdOffsets[0] ?? 0, true)
  }
  let externalCursor = align(
    (ifdOffsets.at(-1) ?? headerBytes) +
      countBytes +
      (entriesByLevel.at(-1)?.length ?? 0) * entryRecordBytes +
      nextBytes,
    8,
  )
  for (let levelIndex = 0; levelIndex < entriesByLevel.length; levelIndex += 1) {
    const entries = entriesByLevel[levelIndex] ?? []
    const ifdOffset = ifdOffsets[levelIndex] ?? 0
    if (bigTiff) view.setBigUint64(ifdOffset, BigInt(entries.length), true)
    else view.setUint16(ifdOffset, entries.length, true)
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex]
      if (entry === undefined) continue
      const offset = ifdOffset + countBytes + entryIndex * entryRecordBytes
      const payload = entryPayload(entry, true)
      const inlineOffset = offset + (bigTiff ? 12 : 8)
      view.setUint16(offset, entry.tag, true)
      view.setUint16(offset + 2, entry.type, true)
      if (bigTiff) view.setBigUint64(offset + 4, BigInt(entryCount(entry)), true)
      else view.setUint32(offset + 4, entryCount(entry), true)
      if (payload.byteLength <= inlineBytes) output.set(payload, inlineOffset)
      else {
        externalCursor = align(externalCursor, 8)
        setOffset(inlineOffset, externalCursor)
        output.set(payload, externalCursor)
        externalCursor += payload.byteLength
      }
    }
    setOffset(ifdOffset + countBytes + entries.length * entryRecordBytes, 0)
  }
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const level = levels[levelIndex]
    if (level === undefined) continue
    for (let tileIndex = 0; tileIndex < level.tiles.length; tileIndex += 1) {
      output.set(
        level.tiles[tileIndex] ?? new Uint8Array(),
        tileOffsets[levelIndex]?.[tileIndex] ?? 0,
      )
    }
  }
  return output
}

await mkdir(outputDirectory, { recursive: true })
const manifestEntries: {
  filename: string
  sha256: string
  bytes: number
  container: 'TIFF' | 'BigTIFF'
  compressionIds: readonly number[]
  levels: readonly { width: number; height: number }[]
}[] = []
for (const fixture of fixtures) {
  const bytes = buildFixture(fixture)
  await writeFile(resolve(outputDirectory, fixture.filename), bytes)
  manifestEntries.push({
    filename: fixture.filename,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    container: fixture.bigTiff ? 'BigTIFF' : 'TIFF',
    compressionIds: Object.freeze([
      ...new Set(fixture.levels.map(({ compression }) => compression)),
    ]),
    levels: Object.freeze(fixture.levels.map(({ width, height }) => ({ width, height }))),
  })
}
const manifest = {
  schemaVersion: 1,
  generator: 'node scripts/generate-cog-fixtures.ts',
  notes:
    'Deterministic first-party fixture construction; Node zlib and dev-only jpeg-js encode fixture segments and are not runtime dependencies.',
  fixtures: manifestEntries,
}
const manifestPath = resolve(outputDirectory, 'manifest.json')
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(
  `Generated ${manifestEntries.length} COG fixtures in ${dirname(manifestPath)}\n`,
)
