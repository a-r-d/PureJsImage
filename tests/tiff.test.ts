import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import * as Lerc from 'lerc'
import { fromArrayBuffer as openGeoTiffOracle } from 'geotiff'
import { describe, expect, it } from 'vitest'
import aperioFixture from './fixtures/aperio-33003-first-tile.json' with { type: 'json' }
import type { DecoderOptions, ImageCodec } from '../src/codec.ts'
import {
  createTiffCodec,
  encodeTiffDocument,
  openTiffDocument,
  tiffCodec,
} from '../src/codecs/tiff.ts'
import { isAperioSvs, openAperioSvs } from '../src/pathology/aperio-svs.ts'
import { isOmeTiff, omeTiffProfile, openOmeTiff } from '../src/scientific/ome-tiff.ts'
import { webpCodec } from '../src/codecs/webp.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { geoTiffProfile } from '../src/geotiff.ts'
import type { PixelBlock } from '../src/pixel.ts'
import type { RasterBlock } from '../src/raster.ts'
import { createTiffProfileRegistry } from '../src/tiff/profiles.ts'
import { nodeRuntime } from '../src/node-runtime.ts'
import { MemorySource, type ImageSource } from '../src/source.ts'
import { Uint8ArraySink } from '../src/sink.ts'

import { createTiffEncodeOperation } from '../src/pipeline.ts'
import { channelSwappingRgbProfile, constantGrayCmykProfile } from './icc-fixtures.ts'
import { Image } from './image-library.ts'

type Rgba = readonly [red: number, green: number, blue: number, alpha: number]
type TiffFieldType = 2 | 3 | 4 | 6 | 7 | 8 | 11 | 12

interface TiffEntryFixture {
  readonly tag: number
  readonly type: TiffFieldType
  readonly values: readonly number[]
}

interface TiffFixtureOptions {
  readonly width: number
  readonly height: number
  readonly littleEndian?: boolean
  readonly bitsPerSample: readonly number[]
  readonly compression: number
  readonly photometric: number
  readonly strips: readonly Uint8Array[]
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly rowsPerStrip?: number
  readonly fillOrder?: 1 | 2
  readonly planarConfiguration?: 1 | 2
  readonly predictor?: 1 | 2 | 3
  readonly t6Options?: number
  readonly t4Options?: number
  readonly extraSamples?: readonly number[]
  readonly colorMap?: readonly number[]
  readonly orientation?: number
  readonly iccProfile?: Uint8Array
  readonly jpegInterchange?: Uint8Array
  readonly extraEntries?: readonly TiffEntryFixture[]
  readonly pointedEntries?: readonly {
    readonly tag: number
    readonly tables: readonly Uint8Array[]
  }[]
}

const typeBytes = (type: TiffFieldType): number => {
  if (type === 3 || type === 8) return 2
  if (type === 4 || type === 11) return 4
  if (type === 12) return 8
  return 1
}

const tiffFixture = (options: TiffFixtureOptions): Uint8Array<ArrayBuffer> => {
  const littleEndian = options.littleEndian ?? true
  const samples = options.bitsPerSample.length
  const rowsPerStrip = options.rowsPerStrip ?? options.height
  const tiled = options.tileWidth !== undefined || options.tileHeight !== undefined
  if (tiled && (options.tileWidth === undefined || options.tileHeight === undefined)) {
    throw new Error('Both tile dimensions are required')
  }
  const entries = (
    stripOffsets: readonly number[],
    jpegInterchangeOffset: number,
    pointedOffsets: ReadonlyMap<number, readonly number[]>,
  ): TiffEntryFixture[] => {
    const values: TiffEntryFixture[] = [
      { tag: 256, type: 4, values: [options.width] },
      { tag: 257, type: 4, values: [options.height] },
      { tag: 258, type: 3, values: options.bitsPerSample },
      { tag: 259, type: 3, values: [options.compression] },
      { tag: 262, type: 3, values: [options.photometric] },
      ...(options.fillOrder ? [{ tag: 266, type: 3 as const, values: [options.fillOrder] }] : []),
      ...(tiled || options.strips.length === 0
        ? []
        : [{ tag: 273, type: 4 as const, values: stripOffsets }]),
      ...(options.orientation
        ? [{ tag: 274, type: 3 as const, values: [options.orientation] }]
        : []),
      { tag: 277, type: 3, values: [samples] },
      ...(tiled || options.strips.length === 0
        ? []
        : [{ tag: 278, type: 4 as const, values: [rowsPerStrip] }]),
      ...(tiled || options.strips.length === 0
        ? []
        : [
            {
              tag: 279,
              type: 4 as const,
              values: options.strips.map((strip) => strip.byteLength),
            },
          ]),
      { tag: 284, type: 3, values: [options.planarConfiguration ?? 1] },
      ...(options.jpegInterchange
        ? [
            { tag: 513, type: 4 as const, values: [jpegInterchangeOffset] },
            { tag: 514, type: 4 as const, values: [options.jpegInterchange.byteLength] },
          ]
        : []),
      ...(options.t4Options === undefined
        ? []
        : [{ tag: 292, type: 4 as const, values: [options.t4Options] }]),
      ...(options.t6Options === undefined
        ? []
        : [{ tag: 293, type: 4 as const, values: [options.t6Options] }]),
      ...(options.predictor ? [{ tag: 317, type: 3 as const, values: [options.predictor] }] : []),
      ...(options.colorMap ? [{ tag: 320, type: 3 as const, values: options.colorMap }] : []),
      ...(tiled
        ? [
            { tag: 322, type: 4 as const, values: [options.tileWidth ?? 0] },
            { tag: 323, type: 4 as const, values: [options.tileHeight ?? 0] },
            { tag: 324, type: 4 as const, values: stripOffsets },
            {
              tag: 325,
              type: 4 as const,
              values: options.strips.map((strip) => strip.byteLength),
            },
          ]
        : []),
      ...(options.extraSamples
        ? [{ tag: 338, type: 3 as const, values: options.extraSamples }]
        : []),
      ...(options.iccProfile
        ? [{ tag: 34675, type: 7 as const, values: Array.from(options.iccProfile) }]
        : []),
      ...(options.extraEntries ?? []),
      ...(options.pointedEntries ?? []).map((entry) => ({
        tag: entry.tag,
        type: 4 as const,
        values: pointedOffsets.get(entry.tag) ?? entry.tables.map(() => 0),
      })),
    ]
    return values.sort((left, right) => left.tag - right.tag)
  }

  const placeholderEntries = entries(
    options.strips.map(() => 0),
    0,
    new Map(),
  )
  const ifdBytes = 2 + placeholderEntries.length * 12 + 4
  const externalBytes = placeholderEntries.reduce((total, entry) => {
    const bytes = entry.values.length * typeBytes(entry.type)
    return total + (bytes > 4 ? bytes : 0)
  }, 0)
  let pointedDataOffset = 8 + ifdBytes + externalBytes
  const pointedOffsets = new Map<number, readonly number[]>()
  for (const entry of options.pointedEntries ?? []) {
    const offsets: number[] = []
    for (const table of entry.tables) {
      offsets.push(pointedDataOffset)
      pointedDataOffset += table.byteLength
    }
    pointedOffsets.set(entry.tag, offsets)
  }
  const pixelOffset = pointedDataOffset
  const stripOffsets: number[] = []
  let nextStripOffset = pixelOffset
  for (const strip of options.strips) {
    stripOffsets.push(nextStripOffset)
    nextStripOffset += strip.byteLength
  }
  const jpegInterchangeOffset = nextStripOffset
  const outputBytes = nextStripOffset + (options.jpegInterchange?.byteLength ?? 0)

  const finalEntries = entries(stripOffsets, jpegInterchangeOffset, pointedOffsets)
  const output = new Uint8Array(outputBytes)
  const view = new DataView(output.buffer)
  output.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d])
  view.setUint16(2, 42, littleEndian)
  view.setUint32(4, 8, littleEndian)
  view.setUint16(8, finalEntries.length, littleEndian)
  let externalOffset = 8 + ifdBytes

  for (let index = 0; index < finalEntries.length; index += 1) {
    const entry = finalEntries[index]
    if (!entry) continue
    const entryOffset = 10 + index * 12
    view.setUint16(entryOffset, entry.tag, littleEndian)
    view.setUint16(entryOffset + 2, entry.type, littleEndian)
    view.setUint32(entryOffset + 4, entry.values.length, littleEndian)
    const byteLength = entry.values.length * typeBytes(entry.type)
    const valuesOffset = byteLength > 4 ? externalOffset : entryOffset + 8
    if (byteLength > 4) {
      view.setUint32(entryOffset + 8, externalOffset, littleEndian)
      externalOffset += byteLength
    }
    for (let valueIndex = 0; valueIndex < entry.values.length; valueIndex += 1) {
      const offset = valuesOffset + valueIndex * typeBytes(entry.type)
      const value = entry.values[valueIndex] ?? 0
      if (entry.type === 3) view.setUint16(offset, value, littleEndian)
      else if (entry.type === 4) view.setUint32(offset, value, littleEndian)
      else if (entry.type === 6) view.setInt8(offset, value)
      else if (entry.type === 8) view.setInt16(offset, value, littleEndian)
      else if (entry.type === 11) view.setFloat32(offset, value, littleEndian)
      else if (entry.type === 12) view.setFloat64(offset, value, littleEndian)
      else output[offset] = value
    }
  }
  view.setUint32(10 + finalEntries.length * 12, 0, littleEndian)
  for (const entry of options.pointedEntries ?? []) {
    const offsets = pointedOffsets.get(entry.tag) ?? []
    for (let index = 0; index < entry.tables.length; index += 1) {
      output.set(entry.tables[index] ?? new Uint8Array(), offsets[index] ?? 0)
    }
  }
  for (let index = 0; index < options.strips.length; index += 1) {
    output.set(options.strips[index] ?? new Uint8Array(), stripOffsets[index] ?? 0)
  }
  if (options.jpegInterchange) output.set(options.jpegInterchange, jpegInterchangeOffset)
  return output
}
const zstdRawFrame = (data: readonly number[]): Uint8Array<ArrayBuffer> => {
  if (data.length > 255) throw new Error('Test Zstandard frame is too large')
  const blockHeader = data.length * 8 + 1
  return Uint8Array.of(
    0x28,
    0xb5,
    0x2f,
    0xfd,
    0x20,
    data.length,
    blockHeader & 255,
    (blockHeader >>> 8) & 255,
    (blockHeader >>> 16) & 255,
    ...data,
  )
}

interface TiffGraphFixtureNode {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
  readonly imageDescription?: string
  readonly tiled?: boolean
  readonly subIfds?: readonly number[]
  readonly next?: number
  readonly newSubfileType?: number
  readonly invalidStripOffset?: boolean
}

const tiffGraphFixture = (
  nodes: readonly TiffGraphFixtureNode[],
  bigTiff = false,
): Uint8Array<ArrayBuffer> => {
  const headerBytes = bigTiff ? 16 : 8
  const countBytes = bigTiff ? 8 : 2
  const entryBytes = bigTiff ? 20 : 12
  const inlineBytes = bigTiff ? 8 : 4
  const nextBytes = bigTiff ? 8 : 4
  const offsetBytes = bigTiff ? 8 : 4
  const entryCounts = nodes.map(
    (node) =>
      10 +
      (node.tiled ? 1 : 0) +
      (node.newSubfileType === undefined ? 0 : 1) +
      (node.imageDescription === undefined ? 0 : 1) +
      (node.subIfds ? 1 : 0),
  )
  const ifdOffsets: number[] = []
  let cursor = headerBytes
  for (const count of entryCounts) {
    ifdOffsets.push(cursor)
    cursor += countBytes + count * entryBytes + nextBytes
  }
  const subIfdDataOffsets = new Map<number, number>()
  for (let index = 0; index < nodes.length; index += 1) {
    const subIfds = nodes[index]?.subIfds
    if (subIfds && subIfds.length * offsetBytes > inlineBytes) {
      subIfdDataOffsets.set(index, cursor)
      cursor += subIfds.length * offsetBytes
    }
  }
  const descriptionBytes = new Map<number, Uint8Array>()
  const descriptionOffsets = new Map<number, number>()
  for (let index = 0; index < nodes.length; index += 1) {
    const description = nodes[index]?.imageDescription
    if (description === undefined) continue
    const encoded = Uint8Array.from([...new TextEncoder().encode(description), 0])
    descriptionBytes.set(index, encoded)
    descriptionOffsets.set(index, cursor)
    cursor += encoded.byteLength
  }
  const pixelOffsets: number[] = []
  for (const node of nodes) {
    pixelOffsets.push(cursor)
    cursor += node.pixels.byteLength
  }

  const output = new Uint8Array(cursor)
  const view = new DataView(output.buffer)
  const setOffset = (offset: number, value: number): void => {
    if (bigTiff) view.setBigUint64(offset, BigInt(value), true)
    else view.setUint32(offset, value, true)
  }
  if (bigTiff) {
    output.set([0x49, 0x49, 0x2b, 0])
    view.setUint16(4, 8, true)
    view.setBigUint64(8, BigInt(ifdOffsets[0] ?? 0), true)
  } else {
    output.set([0x49, 0x49, 0x2a, 0])
    view.setUint32(4, ifdOffsets[0] ?? 0, true)
  }

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex]
    if (!node) continue
    const ifdOffset = ifdOffsets[nodeIndex] ?? 0
    const stripOffset = node.invalidStripOffset
      ? output.byteLength + 1
      : (pixelOffsets[nodeIndex] ?? 0)
    const entries: {
      readonly tag: number
      readonly type: 2 | 3 | 4 | 16 | 18
      readonly values: readonly number[]
    }[] = [
      ...(node.newSubfileType === undefined
        ? []
        : [{ tag: 254, type: 4 as const, values: [node.newSubfileType] }]),
      ...(node.imageDescription === undefined
        ? []
        : [
            {
              tag: 270,
              type: 2 as const,
              values: Array.from(descriptionBytes.get(nodeIndex) ?? []),
            },
          ]),
      { tag: 256, type: 4, values: [node.width] },
      { tag: 257, type: 4, values: [node.height] },
      { tag: 258, type: 3, values: [8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      ...(node.tiled
        ? [
            { tag: 322, type: 4 as const, values: [node.width] },
            { tag: 323, type: 4 as const, values: [node.height] },
            { tag: 324, type: bigTiff ? (16 as const) : (4 as const), values: [stripOffset] },
            {
              tag: 325,
              type: bigTiff ? (16 as const) : (4 as const),
              values: [node.pixels.byteLength],
            },
          ]
        : [
            { tag: 273, type: bigTiff ? (16 as const) : (4 as const), values: [stripOffset] },
            { tag: 278, type: 4 as const, values: [node.height] },
            {
              tag: 279,
              type: bigTiff ? (16 as const) : (4 as const),
              values: [node.pixels.byteLength],
            },
          ]),
      { tag: 277, type: 3, values: [1] },
      { tag: 284, type: 3, values: [1] },
      ...(node.subIfds
        ? [
            {
              tag: 330,
              type: bigTiff ? (18 as const) : (4 as const),
              values: node.subIfds.map((index) => ifdOffsets[index] ?? 0),
            },
          ]
        : []),
    ]
    entries.sort((left, right) => left.tag - right.tag)
    if (bigTiff) view.setBigUint64(ifdOffset, BigInt(entries.length), true)
    else view.setUint16(ifdOffset, entries.length, true)
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex]
      if (!entry) continue
      const offset = ifdOffset + countBytes + entryIndex * entryBytes
      view.setUint16(offset, entry.tag, true)
      view.setUint16(offset + 2, entry.type, true)
      if (bigTiff) view.setBigUint64(offset + 4, BigInt(entry.values.length), true)
      else view.setUint32(offset + 4, entry.values.length, true)
      const bytesPerValue = entry.type === 2 ? 1 : entry.type === 3 ? 2 : entry.type === 4 ? 4 : 8
      const valueBytes = bytesPerValue * entry.values.length
      const inlineOffset = offset + (bigTiff ? 12 : 8)
      const valueOffset =
        valueBytes <= inlineBytes
          ? inlineOffset
          : entry.tag === 270
            ? (descriptionOffsets.get(nodeIndex) ?? 0)
            : (subIfdDataOffsets.get(nodeIndex) ?? 0)
      if (valueBytes > inlineBytes) setOffset(inlineOffset, valueOffset)
      for (let valueIndex = 0; valueIndex < entry.values.length; valueIndex += 1) {
        const target = valueOffset + valueIndex * bytesPerValue
        const value = entry.values[valueIndex] ?? 0
        if (bytesPerValue === 1) output[target] = value
        else if (bytesPerValue === 2) view.setUint16(target, value, true)
        else if (bytesPerValue === 4) view.setUint32(target, value, true)
        else view.setBigUint64(target, BigInt(value), true)
      }
    }
    const nextOffset = ifdOffset + countBytes + entries.length * entryBytes
    setOffset(nextOffset, node.next === undefined ? 0 : (ifdOffsets[node.next] ?? 0))
    output.set(node.pixels, pixelOffsets[nodeIndex] ?? 0)
  }
  return output
}

const bigTiffRgbFixture = (): Uint8Array<ArrayBuffer> => {
  const entries = [
    [256, 4, 1, 2],
    [257, 4, 1, 1],
    [258, 3, 3, 0x0008_0008_0008],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 16, 1, 0],
    [277, 3, 1, 3],
    [278, 4, 1, 1],
    [279, 16, 1, 6],
    [284, 3, 1, 1],
  ] as const
  const pixelOffset = 16 + 8 + entries.length * 20 + 8
  const output = new Uint8Array(pixelOffset + 6)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2b, 0])
  view.setUint16(4, 8, true)
  view.setBigUint64(8, 16n, true)
  view.setBigUint64(16, BigInt(entries.length), true)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const offset = 24 + index * 20
    view.setUint16(offset, entry[0], true)
    view.setUint16(offset + 2, entry[1], true)
    view.setBigUint64(offset + 4, BigInt(entry[2]), true)
    view.setBigUint64(offset + 12, BigInt(entry[0] === 273 ? pixelOffset : entry[3]), true)
  }
  output.set([10, 20, 30, 200, 150, 100], pixelOffset)
  return output
}

const packedFaxBits = (bits: string): Uint8Array => {
  const output = new Uint8Array(Math.ceil(bits.length / 8))
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index] === '1') {
      const byte = index >>> 3
      output[byte] = (output[byte] ?? 0) | (1 << (7 - (index & 7)))
    }
  }
  return output
}
const packSampleRows = (rows: readonly (readonly number[])[], bitDepth: number): Uint8Array => {
  const rowBytes = Math.ceil(((rows[0]?.length ?? 0) * bitDepth) / 8)
  const output = new Uint8Array(rowBytes * rows.length)
  for (let row = 0; row < rows.length; row += 1) {
    const values = rows[row] ?? []
    for (let sample = 0; sample < values.length; sample += 1) {
      const value = values[sample] ?? 0
      for (let bit = 0; bit < bitDepth; bit += 1) {
        if (((value >>> (bitDepth - bit - 1)) & 1) === 0) continue
        const outputBit = row * rowBytes * 8 + sample * bitDepth + bit
        output[outputBit >>> 3] = (output[outputBit >>> 3] ?? 0) | (1 << (7 - (outputBit & 7)))
      }
    }
  }
  return output
}

const predictorDifferences = (
  values: readonly number[],
  stride: number,
  bitDepth: number,
): readonly number[] => {
  const maximum = 2 ** bitDepth
  return values.map((value, index) =>
    index < stride ? value : (value - (values[index - stride] ?? 0) + maximum) % maximum,
  )
}

const signedPayload = (
  values: readonly number[],
  bitDepth: 8 | 16,
  littleEndian: boolean,
): Uint8Array => {
  const bytesPerSample = bitDepth >>> 3
  const output = new Uint8Array(values.length * bytesPerSample)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    if (bitDepth === 8) view.setInt8(index, values[index] ?? 0)
    else view.setInt16(index * 2, values[index] ?? 0, littleEndian)
  }
  return output
}

const unsignedPayload = (
  values: readonly bigint[],
  bitDepth: 24 | 32 | 64,
  littleEndian: boolean,
): Uint8Array => {
  const bytesPerSample = bitDepth >>> 3
  const output = new Uint8Array(values.length * bytesPerSample)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0n
    const offset = index * bytesPerSample
    for (let byte = 0; byte < bytesPerSample; byte += 1) {
      const shift = BigInt(littleEndian ? byte : bytesPerSample - byte - 1) * 8n
      output[offset + byte] = Number((value >> shift) & 0xffn)
    }
  }
  return output
}

const widePredictorDifferences = (
  values: readonly bigint[],
  stride: number,
  bitDepth: 24 | 32 | 64,
): readonly bigint[] => {
  const mask = (1n << BigInt(bitDepth)) - 1n
  return values.map((value, index) =>
    index < stride ? value : (value - (values[index - stride] ?? 0n)) & mask,
  )
}

const floatPayload = (
  values: readonly number[],
  bitDepth: 32 | 64,
  littleEndian: boolean,
): Uint8Array => {
  const bytesPerSample = bitDepth >>> 3
  const output = new Uint8Array(values.length * bytesPerSample)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    if (bitDepth === 32) view.setFloat32(index * 4, values[index] ?? 0, littleEndian)
    else view.setFloat64(index * 8, values[index] ?? 0, littleEndian)
  }
  return output
}

const floatingPredictorDifferences = (
  source: Uint8Array,
  bytesPerSample: 2 | 4 | 8,
  stride: number,
  littleEndian: boolean,
): Uint8Array => {
  const samples = source.byteLength / bytesPerSample
  const shuffled = new Uint8Array(source.byteLength)
  for (let sample = 0; sample < samples; sample += 1) {
    for (let byte = 0; byte < bytesPerSample; byte += 1) {
      const plane = littleEndian ? bytesPerSample - byte - 1 : byte
      shuffled[plane * samples + sample] = source[sample * bytesPerSample + byte] ?? 0
    }
  }
  for (let index = shuffled.byteLength - 1; index >= stride; index -= 1) {
    shuffled[index] = ((shuffled[index] ?? 0) - (shuffled[index - stride] ?? 0)) & 0xff
  }
  return shuffled
}

const horizontal64Differences = (source: Uint8Array, littleEndian: boolean): Uint8Array => {
  const output = Uint8Array.from(source)
  const view = new DataView(output.buffer)
  const samples = output.byteLength / 8
  const mask = 0xffff_ffff_ffff_ffffn
  for (let sample = samples - 1; sample >= 1; sample -= 1) {
    const current = view.getBigUint64(sample * 8, littleEndian)
    const previous = view.getBigUint64((sample - 1) * 8, littleEndian)
    view.setBigUint64(sample * 8, (current - previous) & mask, littleEndian)
  }
  return output
}
const sgiLogRleRows = (rows: readonly (readonly number[])[], bytePlanes: 2 | 4): Uint8Array => {
  const encoded: number[] = []
  for (const row of rows) {
    for (let plane = 0; plane < bytePlanes; plane += 1) {
      const shift = (bytePlanes - plane - 1) * 8
      const first = ((row[0] ?? 0) >>> shift) & 0xff
      const run = row.length >= 2 && row.every((value) => ((value >>> shift) & 0xff) === first)
      if (run) {
        encoded.push(126 + row.length, first)
      } else {
        encoded.push(row.length)
        for (const value of row) encoded.push((value >>> shift) & 0xff)
      }
    }
  }
  return Uint8Array.from(encoded)
}

const sgiLog24Rows = (rows: readonly (readonly number[])[]): Uint8Array => {
  const output = new Uint8Array(rows.reduce((total, row) => total + row.length * 3, 0))
  let offset = 0
  for (const row of rows) {
    for (const value of row) {
      output[offset] = value >>> 16
      output[offset + 1] = value >>> 8
      output[offset + 2] = value
      offset += 3
    }
  }
  return output
}

const logL16Value = (bits: number): number => {
  const logarithmic = bits & 0x7fff
  if (logarithmic === 0) return 0
  const magnitude = 2 ** ((logarithmic + 0.5) / 256 - 64)
  return (bits & 0x8000) === 0 ? magnitude : -magnitude
}

const decodeDirect = async (
  input: Uint8Array,
  codec: ImageCodec = tiffCodec,
  options: Readonly<DecoderOptions> = {},
): Promise<{
  readonly format: string
  readonly data: Uint8Array
  readonly displayRanges: readonly { readonly black: number; readonly white: number }[] | undefined
}> => {
  if (!codec.createDecoder) throw new Error('TIFF decoder is unavailable')
  const decoder = await codec.createDecoder(new MemorySource(input), defaultImageLimits, options)
  let displayRanges: readonly { readonly black: number; readonly white: number }[] | undefined
  const blocks: Uint8Array[] = []
  for await (const block of decoder.decode()) {
    blocks.push(Uint8Array.from(block.data))
    displayRanges ??= block.displayRanges
  }
  const bytes = blocks.reduce((total, block) => total + block.byteLength, 0)
  const data = new Uint8Array(bytes)
  let offset = 0
  for (const block of blocks) {
    data.set(block, offset)
    offset += block.byteLength
  }
  return { format: decoder.pixelFormat, data, displayRanges }
}
const classicTiffValues = (input: Uint8Array, targetTag: number): readonly number[] => {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  if (input[0] !== 0x49 || input[1] !== 0x49 || view.getUint16(2, true) !== 42) {
    throw new Error('Expected a little-endian Classic TIFF')
  }
  const ifdOffset = view.getUint32(4, true)
  const entryCount = view.getUint16(ifdOffset, true)
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (view.getUint16(entryOffset, true) !== targetTag) continue
    const type = view.getUint16(entryOffset + 2, true)
    const count = view.getUint32(entryOffset + 4, true)
    const bytesPerValue = type === 3 ? 2 : type === 4 ? 4 : 0
    if (bytesPerValue === 0) throw new Error(`Unsupported test TIFF field type ${type}`)
    const valueBytes = count * bytesPerValue
    const valuesOffset = valueBytes <= 4 ? entryOffset + 8 : view.getUint32(entryOffset + 8, true)
    const values: number[] = []
    for (let value = 0; value < count; value += 1) {
      const offset = valuesOffset + value * bytesPerValue
      values.push(type === 3 ? view.getUint16(offset, true) : view.getUint32(offset, true))
    }
    return values
  }
  throw new Error(`TIFF tag ${targetTag} is missing`)
}

const uint16BigEndian = (data: Uint8Array, offset: number): number =>
  ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)

const scaleTo16 = (value: number, bitDepth: number): number =>
  Math.round((value * 65_535) / (2 ** bitDepth - 1))

const splitJpegTables = (
  input: Uint8Array,
): { readonly image: Uint8Array; readonly tables: Uint8Array } => {
  const image: number[] = [0xff, 0xd8]
  const tables: number[] = [0xff, 0xd8]
  let offset = 2
  while (offset + 4 <= input.byteLength) {
    const marker = input[offset + 1]
    if (input[offset] !== 0xff || marker === undefined) throw new Error('Invalid JPEG fixture')
    if (marker === 0xda) {
      image.push(...input.subarray(offset))
      tables.push(0xff, 0xd9)
      return { image: Uint8Array.from(image), tables: Uint8Array.from(tables) }
    }
    const length = ((input[offset + 2] ?? 0) << 8) | (input[offset + 3] ?? 0)
    const end = offset + length + 2
    if (length < 2 || end > input.byteLength) throw new Error('Invalid JPEG fixture marker')
    const target = marker === 0xdb || marker === 0xc4 || marker === 0xdd ? tables : image
    target.push(...input.subarray(offset, end))
    offset = end
  }
  throw new Error('JPEG fixture has no scan')
}

interface OldJpegFixtureParts {
  readonly entropy: Uint8Array
  readonly quantizationTables: readonly Uint8Array[]
  readonly dcTables: readonly Uint8Array[]
  readonly acTables: readonly Uint8Array[]
  readonly horizontalSubsampling: number
  readonly verticalSubsampling: number
  readonly scan: Uint8Array
}

const oldJpegFixtureParts = (input: Uint8Array): OldJpegFixtureParts => {
  const quantization = new Map<number, Uint8Array>()
  const dc = new Map<number, Uint8Array>()
  const ac = new Map<number, Uint8Array>()
  const componentIds: number[] = []
  const tableSelectors: number[] = []
  const horizontalSampling: number[] = []
  const verticalSampling: number[] = []
  const scanSelectors = new Map<number, number>()
  let entropy: Uint8Array | undefined
  let scan: Uint8Array | undefined
  let offset = 2
  while (offset + 4 <= input.byteLength) {
    const marker = input[offset + 1]
    if (input[offset] !== 0xff || marker === undefined) throw new Error('Invalid JPEG fixture')
    const length = ((input[offset + 2] ?? 0) << 8) | (input[offset + 3] ?? 0)
    const start = offset + 4
    const end = offset + length + 2
    if (length < 2 || end > input.byteLength) throw new Error('Invalid JPEG fixture marker')
    if (marker === 0xdb) {
      let position = start
      while (position < end) {
        const selector = input[position] ?? 0xff
        if (selector >>> 4 !== 0 || position + 65 > end) {
          throw new Error('Unsupported JPEG fixture quantization table')
        }
        quantization.set(selector & 15, input.slice(position + 1, position + 65))
        position += 65
      }
    } else if (marker === 0xc4) {
      let position = start
      while (position < end) {
        const selector = input[position] ?? 0xff
        let values = 0
        for (let index = 0; index < 16; index += 1) values += input[position + 1 + index] ?? 0
        const tableEnd = position + 17 + values
        if (tableEnd > end) throw new Error('Invalid JPEG fixture Huffman table')
        const table = input.slice(position + 1, tableEnd)
        const tables = selector >>> 4 === 0 ? dc : ac
        tables.set(selector & 15, table)
        position = tableEnd
      }
    } else if (marker === 0xc0) {
      const count = input[start + 5] ?? 0
      for (let index = 0; index < count; index += 1) {
        const component = start + 6 + index * 3
        componentIds.push(input[component] ?? 0)
        const sampling = input[component + 1] ?? 0
        horizontalSampling.push(sampling >>> 4)
        verticalSampling.push(sampling & 15)
        tableSelectors.push(input[component + 2] ?? 0)
      }
    } else if (marker === 0xda) {
      const count = input[start] ?? 0
      for (let index = 0; index < count; index += 1) {
        scanSelectors.set(input[start + 1 + index * 2] ?? 0, input[start + 2 + index * 2] ?? 0)
      }
      const entropyEnd =
        input[input.byteLength - 2] === 0xff && input[input.byteLength - 1] === 0xd9
          ? input.byteLength - 2
          : input.byteLength
      entropy = input.slice(end, entropyEnd)
      scan = input.slice(offset, entropyEnd)
      break
    }
    offset = end
  }
  if (!entropy || !scan || componentIds.length !== 3) throw new Error('Incomplete JPEG fixture')
  const quantizationTables: Uint8Array[] = []
  const dcTables: Uint8Array[] = []
  const acTables: Uint8Array[] = []
  for (let index = 0; index < componentIds.length; index += 1) {
    const scan = scanSelectors.get(componentIds[index] ?? 0) ?? 0
    const quantizationTable = quantization.get(tableSelectors[index] ?? 0)
    const dcTable = dc.get(scan >>> 4)
    const acTable = ac.get(scan & 15)
    if (!quantizationTable || !dcTable || !acTable) throw new Error('JPEG fixture table is missing')
    quantizationTables.push(quantizationTable)
    dcTables.push(dcTable)
    acTables.push(acTable)
  }
  return {
    scan,
    entropy,
    quantizationTables,
    dcTables,
    acTables,
    horizontalSubsampling: horizontalSampling[0] ?? 1,
    verticalSubsampling: verticalSampling[0] ?? 1,
  }
}

const packNineBitCodes = (codes: readonly number[]): Uint8Array => {
  const output = new Uint8Array(Math.ceil((codes.length * 9) / 8))
  let bitOffset = 0
  for (const code of codes) {
    for (let bit = 8; bit >= 0; bit -= 1) {
      if ((code & (1 << bit)) !== 0) {
        const byte = bitOffset >>> 3
        output[byte] = (output[byte] ?? 0) | (1 << (7 - (bitOffset & 7)))
      }
      bitOffset += 1
    }
  }
  return output
}
const packLegacyLzwLiterals = (values: Uint8Array): Uint8Array => {
  const output = new Uint8Array(Math.ceil(((values.byteLength + 2) * 12) / 8))
  let bitOffset = 0
  let codeWidth = 9
  let nextCode = 258
  let hasPrevious = false
  const writeCode = (code: number): void => {
    for (let bit = 0; bit < codeWidth; bit += 1) {
      if ((code & (1 << bit)) !== 0) {
        const byte = bitOffset >>> 3
        output[byte] = (output[byte] ?? 0) | (1 << (bitOffset & 7))
      }
      bitOffset += 1
    }
  }

  writeCode(256)
  for (const value of values) {
    writeCode(value)
    if (hasPrevious && nextCode < 4096) {
      nextCode += 1
      if (codeWidth < 12 && nextCode === 1 << codeWidth) codeWidth += 1
    }
    hasPrevious = true
  }
  writeCode(257)
  return output.subarray(0, Math.ceil(bitOffset / 8))
}

const decodedPng = async (input: Uint8Array): Promise<PNG> => {
  const output = await (await Image.open(input)).png().toBuffer()
  return PNG.sync.read(output)
}

const reverseByteBits = (input: Uint8Array): Uint8Array => {
  const output = new Uint8Array(input.byteLength)
  for (let index = 0; index < input.byteLength; index += 1) {
    let source = input[index] ?? 0
    let reversed = 0
    for (let bit = 0; bit < 8; bit += 1) {
      reversed = (reversed << 1) | (source & 1)
      source >>>= 1
    }
    output[index] = reversed
  }
  return output
}
const byteSequenceOffset = (data: Uint8Array, sequence: readonly number[]): number => {
  for (let offset = 0; offset + sequence.length <= data.byteLength; offset += 1) {
    if (sequence.every((value, index) => data[offset + index] === value)) return offset
  }
  return -1
}

const jp2CodestreamFixture = async (): Promise<Uint8Array> => {
  const jp2 = await readFile('benchmark/corpus/files/jp2/openjpeg-lossless-rgb16.jp2')
  const boxType = byteSequenceOffset(jp2, [0x6a, 0x70, 0x32, 0x63])
  if (boxType < 0) throw new Error('JP2 codestream box is missing')
  return Uint8Array.from(jp2.subarray(boxType + 4))
}

const appendEmptyIfd = (input: Uint8Array, littleEndian: boolean): Uint8Array => {
  const output = new Uint8Array(input.byteLength + 6)
  output.set(input)
  const view = new DataView(output.buffer)
  const entryCount = view.getUint16(8, littleEndian)
  view.setUint32(10 + entryCount * 12, input.byteLength, littleEndian)
  view.setUint16(input.byteLength, 0, littleEndian)
  view.setUint32(input.byteLength + 2, 0, littleEndian)
  return output
}

const renameClassicTiffTag = (input: Uint8Array, from: number, to: number): void => {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const littleEndian = input[0] === 0x49
  const entryCount = view.getUint16(8, littleEndian)
  for (let index = 0; index < entryCount; index += 1) {
    const offset = 10 + index * 12
    if (view.getUint16(offset, littleEndian) === from) {
      view.setUint16(offset, to, littleEndian)
      return
    }
  }
  throw new Error(`TIFF fixture tag ${from} is missing`)
}

const clearClassicTiffTag = (input: Uint8Array, tag: number): void => {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const littleEndian = input[0] === 0x49
  const entryCount = view.getUint16(8, littleEndian)
  for (let index = 0; index < entryCount; index += 1) {
    const offset = 10 + index * 12
    if (view.getUint16(offset, littleEndian) === tag) {
      input.fill(0, offset, offset + 12)
      return
    }
  }
  throw new Error(`TIFF fixture tag ${tag} is missing`)
}

const pixel = (image: PNG, x: number, y: number): Rgba => {
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset] ?? -1,
    image.data[offset + 1] ?? -1,
    image.data[offset + 2] ?? -1,
    image.data[offset + 3] ?? -1,
  ]
}

describe('TIFF codec', () => {
  it('converts TIFF InterColorProfile tag 34675 to sRGB', async () => {
    const input = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      iccProfile: channelSwappingRgbProfile(),
      strips: [Uint8Array.of(10, 20, 30, 90, 110, 130)],
    })
    const decoded = await decodedPng(input)

    expect(pixel(decoded, 0, 0)).toEqual([30, 20, 10, 255])
    expect(pixel(decoded, 1, 0)).toEqual([130, 110, 90, 255])
  })

  it('rejects corrupt and non-UNDEFINED TIFF ICC profile tags', async () => {
    const corrupt = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      iccProfile: Uint8Array.of(1, 2, 3),
      strips: [Uint8Array.of(10, 20, 30)],
    })
    const wrongType = Uint8Array.from(
      tiffFixture({
        width: 1,
        height: 1,
        bitsPerSample: [8, 8, 8],
        compression: 1,
        photometric: 2,
        iccProfile: channelSwappingRgbProfile(),
        strips: [Uint8Array.of(10, 20, 30)],
      }),
    )
    const view = new DataView(wrongType.buffer)
    const entryCount = view.getUint16(8, true)
    for (let index = 0; index < entryCount; index += 1) {
      const offset = 10 + index * 12
      if (view.getUint16(offset, true) === 34675) view.setUint16(offset + 2, 1, true)
    }

    await expect((await Image.open(corrupt)).metadata()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
    await expect((await Image.open(wrongType)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'TIFF tag 34675 must use the UNDEFINED field type',
    })
  })

  it('reads big-endian metadata and decodes RGB strips and regions', async () => {
    const firstPage = tiffFixture({
      width: 2,
      height: 2,
      littleEndian: false,
      orientation: 6,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      strips: [Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])],
    })
    const input = appendEmptyIfd(firstPage, false)
    const image = await Image.open(input)

    await expect(image.metadata()).resolves.toMatchObject({
      format: 'tiff',
      mimeType: 'image/tiff',
      width: 2,
      height: 2,
      bitDepth: 8,
      hasAlpha: false,
      frames: 2,
      orientation: 6,
    })
    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(decoded, 1, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(decoded, 0, 1)).toEqual([0, 0, 255, 255])

    const cropped = PNG.sync.read(
      await image.crop({ x: 1, y: 0, width: 1, height: 2 }).png().toBuffer(),
    )
    expect(pixel(cropped, 0, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(cropped, 0, 1)).toEqual([255, 255, 255, 255])
  })

  it('selects top-level TIFF frames and reduced-resolution SubIFDs', async () => {
    const input = tiffGraphFixture([
      {
        width: 4,
        height: 2,
        pixels: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8),
        subIfds: [1],
        next: 2,
      },
      {
        width: 2,
        height: 1,
        pixels: Uint8Array.of(101, 102),
        newSubfileType: 1,
      },
      {
        width: 3,
        height: 1,
        pixels: Uint8Array.of(201, 202, 203),
        subIfds: [3],
      },
      { width: 1, height: 1, pixels: Uint8Array.of(250) },
    ])

    await expect((await Image.open(input)).metadata()).resolves.toMatchObject({
      width: 4,
      height: 2,
      frames: 2,
      resolutionLevels: 2,
    })
    await expect((await Image.open(input, { frame: 1 })).metadata()).resolves.toMatchObject({
      width: 3,
      height: 1,
      frames: 2,
      resolutionLevels: 2,
    })
    await expect(
      (await Image.open(input, { frame: 1, resolutionLevel: 1 })).metadata(),
    ).resolves.toMatchObject({
      width: 1,
      height: 1,
      frames: 2,
      resolutionLevels: 2,
    })

    await expect(decodeDirect(input, tiffCodec, { resolutionLevel: 1 })).resolves.toMatchObject({
      format: 'gray8',
      data: Uint8Array.of(101, 102),
    })
    await expect(decodeDirect(input, tiffCodec, { frame: 1 })).resolves.toMatchObject({
      format: 'gray8',
      data: Uint8Array.of(201, 202, 203),
    })
    await expect(
      decodeDirect(input, tiffCodec, { frame: 1, resolutionLevel: 1 }),
    ).resolves.toMatchObject({
      format: 'gray8',
      data: Uint8Array.of(250),
    })
  })

  it('orders reduced-resolution levels from largest to smallest', async () => {
    const input = tiffGraphFixture([
      {
        width: 4,
        height: 4,
        pixels: new Uint8Array(16),
        subIfds: [1, 2],
      },
      { width: 1, height: 1, pixels: Uint8Array.of(11), newSubfileType: 1 },
      {
        width: 2,
        height: 2,
        pixels: Uint8Array.of(21, 22, 23, 24),
        newSubfileType: 1,
      },
    ])

    await expect((await Image.open(input)).metadata()).resolves.toMatchObject({
      resolutionLevels: 3,
    })
    await expect(decodeDirect(input, tiffCodec, { resolutionLevel: 1 })).resolves.toMatchObject({
      data: Uint8Array.of(21, 22, 23, 24),
    })
    await expect(decodeDirect(input, tiffCodec, { resolutionLevel: 2 })).resolves.toMatchObject({
      data: Uint8Array.of(11),
    })
  })

  it('selects BigTIFF SubIFDs using IFD8 offsets', async () => {
    const input = tiffGraphFixture(
      [
        {
          width: 3,
          height: 2,
          pixels: Uint8Array.of(1, 2, 3, 4, 5, 6),
          subIfds: [1],
        },
        {
          width: 1,
          height: 1,
          pixels: Uint8Array.of(222),
          newSubfileType: 1,
        },
      ],
      true,
    )

    await expect((await Image.open(input)).metadata()).resolves.toMatchObject({
      width: 3,
      height: 2,
      frames: 1,
      resolutionLevels: 2,
    })
    await expect(decodeDirect(input, tiffCodec, { resolutionLevel: 1 })).resolves.toMatchObject({
      format: 'gray8',
      data: Uint8Array.of(222),
    })
  })

  it('rejects invalid TIFF frame and resolution-level selections', async () => {
    const input = tiffGraphFixture([
      { width: 2, height: 1, pixels: Uint8Array.of(1, 2), subIfds: [1] },
      { width: 1, height: 1, pixels: Uint8Array.of(3), newSubfileType: 1 },
    ])

    await expect((await Image.open(input, { frame: 1 })).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'TIFF frame 1 is outside the 1-frame image',
    })
    await expect(
      (await Image.open(input, { resolutionLevel: 2 })).metadata(),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'TIFF resolutionLevel 2 is outside the 2-level frame 0',
    })
  })

  it('rejects TIFF SubIFD graph cycles, malformed offsets, and excess directories', async () => {
    const cycle = tiffGraphFixture([
      { width: 2, height: 2, pixels: Uint8Array.of(1, 2, 3, 4), subIfds: [1] },
      { width: 1, height: 1, pixels: Uint8Array.of(5), subIfds: [1] },
    ])
    const alias = tiffGraphFixture([
      { width: 2, height: 2, pixels: Uint8Array.of(1, 2, 3, 4), subIfds: [1, 1] },
      { width: 1, height: 1, pixels: Uint8Array.of(5) },
    ])
    const malformed = tiffGraphFixture([
      { width: 2, height: 2, pixels: Uint8Array.of(1, 2, 3, 4), subIfds: [99] },
    ])
    const limited = tiffGraphFixture([
      { width: 2, height: 2, pixels: Uint8Array.of(1, 2, 3, 4), subIfds: [1] },
      { width: 1, height: 1, pixels: Uint8Array.of(5) },
    ])

    await expect((await Image.open(cycle)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'TIFF SubIFD graph contains a loop',
    })
    await expect((await Image.open(alias)).metadata()).resolves.toMatchObject({
      resolutionLevels: 2,
    })
    await expect(decodeDirect(alias, tiffCodec, { resolutionLevel: 1 })).resolves.toMatchObject({
      data: Uint8Array.of(5),
    })
    await expect((await Image.open(malformed)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'TIFF SubIFD offset is invalid',
    })
    await expect(
      tiffCodec.metadata(new MemorySource(limited), { ...defaultImageLimits, maxFrames: 1 }),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: 'TIFF image directory count exceeds maxFrames 1',
    })
  })

  it('does not read pixel segments from unselected TIFF frames', async () => {
    const input = tiffGraphFixture([
      {
        width: 2,
        height: 1,
        pixels: Uint8Array.of(11, 22),
        next: 1,
      },
      {
        width: 1,
        height: 1,
        pixels: Uint8Array.of(33),
        invalidStripOffset: true,
      },
    ])

    await expect(decodeDirect(input)).resolves.toMatchObject({
      format: 'gray8',
      data: Uint8Array.of(11, 22),
    })
    await expect(decodeDirect(input, tiffCodec, { frame: 1 })).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
  })

  it('decodes packed grayscale and palette sample depths', async () => {
    const grayscale = tiffFixture({
      width: 4,
      height: 1,
      bitsPerSample: [2],
      compression: 1,
      photometric: 1,
      strips: [Uint8Array.of(0x1b)],
    })
    const colorMap = new Array<number>(16 * 3).fill(0)
    colorMap[1] = 0xffff
    colorMap[16 + 2] = 0xffff
    const palette = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [4],
      compression: 1,
      photometric: 3,
      colorMap,
      strips: [Uint8Array.of(0x12)],
    })

    const grayPixels = await decodedPng(grayscale)
    expect(pixel(grayPixels, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(grayPixels, 1, 0)).toEqual([85, 85, 85, 255])
    expect(pixel(grayPixels, 2, 0)).toEqual([170, 170, 170, 255])
    expect(pixel(grayPixels, 3, 0)).toEqual([255, 255, 255, 255])
    const palettePixels = await decodedPng(palette)
    expect(pixel(palettePixels, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(palettePixels, 1, 0)).toEqual([0, 255, 0, 255])
  })

  it('decodes PackBits planar grayscale with associated alpha', async () => {
    const input = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8, 8],
      compression: 32773,
      photometric: 1,
      planarConfiguration: 2,
      extraSamples: [1],
      strips: [Uint8Array.from([1, 0, 50]), Uint8Array.from([1, 0, 128])],
    })
    const decoded = await decodedPng(input)

    expect(pixel(decoded, 0, 0)).toEqual([0, 0, 0, 0])
    expect(pixel(decoded, 1, 0)).toEqual([100, 100, 100, 128])
  })

  it('decodes LZW and Deflate with horizontal prediction', async () => {
    const lzw = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [8],
      compression: 5,
      photometric: 1,
      strips: [packNineBitCodes([256, 10, 20, 30, 257])],
    })
    const predicted = Uint8Array.from([10, 10, 15])
    const deflate = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [8],
      compression: 8,
      photometric: 1,
      predictor: 2,
      strips: [deflateSync(predicted)],
    })
    const deflateLastStripPadding = tiffFixture({
      width: 1,
      height: 3,
      bitsPerSample: [8],
      compression: 8,
      photometric: 1,
      rowsPerStrip: 2,
      strips: [deflateSync(Uint8Array.of(1, 2)), deflateSync(Uint8Array.of(3, 99))],
    })

    const lzwPixels = await decodedPng(lzw)
    expect(pixel(lzwPixels, 0, 0)).toEqual([10, 10, 10, 255])
    expect(pixel(lzwPixels, 2, 0)).toEqual([30, 30, 30, 255])
    const deflatePixels = await decodedPng(deflate)
    expect(pixel(deflatePixels, 0, 0)).toEqual([10, 10, 10, 255])
    expect(pixel(deflatePixels, 1, 0)).toEqual([20, 20, 20, 255])
    expect(pixel(deflatePixels, 2, 0)).toEqual([35, 35, 35, 255])
    const paddedPixels = await decodedPng(deflateLastStripPadding)
    expect(pixel(paddedPixels, 0, 2)).toEqual([3, 3, 3, 255])
  })
  it('decodes bounded LERC and LERC plus Deflate strips exactly', async () => {
    await Lerc.load()
    const blob = new Uint8Array(await readFile('tests/fixtures/bluemarble_256_256_3_byte.lerc2'))
    const oracle = Lerc.decode(blob.buffer)
    const expected = new Uint8Array(oracle.width * oracle.height * oracle.pixels.length)
    for (let pixel = 0; pixel < oracle.width * oracle.height; pixel += 1) {
      for (let band = 0; band < oracle.pixels.length; band += 1) {
        expected[pixel * oracle.pixels.length + band] = oracle.pixels[band]?.[pixel] ?? 0
      }
    }
    for (const additionalCompression of [0, 1] as const) {
      const input = tiffFixture({
        width: 256,
        height: 256,
        bitsPerSample: [8, 8, 8],
        compression: 34887,
        photometric: 2,
        strips: [additionalCompression === 0 ? blob : deflateSync(blob)],
        extraEntries: [{ tag: 50674, type: 4, values: [4, additionalCompression] }],
      })
      const decoded = await decodeDirect(input)
      expect(decoded.format).toBe('rgb8')
      expect(decoded.data).toEqual(expected)
    }

    const floatBlob = new Uint8Array(
      await readFile('tests/fixtures/california_400_400_1_float.lerc2'),
    )
    const floatOracle = Lerc.decode(floatBlob.buffer)
    const floatBand = floatOracle.pixels[0]
    if (!(floatBand instanceof Float32Array)) throw new Error('Expected float32 LERC oracle data')
    const floatInput = tiffFixture({
      width: 400,
      height: 400,
      bitsPerSample: [32],
      compression: 34887,
      photometric: 1,
      strips: [floatBlob],
      extraEntries: [
        { tag: 339, type: 3, values: [3] },
        { tag: 50674, type: 4, values: [4, 0] },
      ],
    })
    const floatDecoded = await decodeDirect(floatInput)
    expect(floatDecoded.format).toBe('grayf32')
    const floatExpected = new Uint8Array(floatBand.byteLength)
    const floatExpectedView = new DataView(floatExpected.buffer)
    for (let pixel = 0; pixel < floatOracle.width * floatOracle.height; pixel += 1) {
      const value = floatOracle.mask?.[pixel] === 0 ? Number.NaN : (floatBand[pixel] ?? 0)
      floatExpectedView.setFloat32(pixel * 4, value)
    }
    expect(floatDecoded.data.byteLength).toBe(floatExpected.byteLength)
    expect(createHash('sha256').update(floatDecoded.data).digest('hex')).toBe(
      createHash('sha256').update(floatExpected).digest('hex'),
    )

    const mismatched = tiffFixture({
      width: 255,
      height: 256,
      bitsPerSample: [8, 8, 8],
      compression: 34887,
      photometric: 2,
      strips: [blob],
      extraEntries: [{ tag: 50674, type: 4, values: [4, 0] }],
    })
    await expect(decodeDirect(mismatched)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const invalidDeflate = tiffFixture({
      width: 256,
      height: 256,
      bitsPerSample: [8, 8, 8],
      compression: 34887,
      photometric: 2,
      strips: [deflateSync(blob).subarray(0, -2)],
      extraEntries: [{ tag: 50674, type: 4, values: [4, 1] }],
    })
    await expect(decodeDirect(invalidDeflate)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const zstandard = tiffFixture({
      width: 256,
      height: 256,
      bitsPerSample: [8, 8, 8],
      compression: 34887,
      photometric: 2,
      strips: [blob],
      extraEntries: [{ tag: 50674, type: 4, values: [4, 2] }],
    })
    await expect(decodeDirect(zstandard)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })

    const missingParameters = tiffFixture({
      width: 256,
      height: 256,
      bitsPerSample: [8, 8, 8],
      compression: 34887,
      photometric: 2,
      strips: [blob],
    })
    await expect(decodeDirect(missingParameters)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('decodes bounded Zstandard strips before predictor reversal', async () => {
    const predicted = [10, 10, 15, 40, 10, 10]
    const input = tiffFixture({
      width: 3,
      height: 2,
      bitsPerSample: [8],
      compression: 50000,
      photometric: 1,
      predictor: 2,
      strips: [zstdRawFrame(predicted)],
    })
    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([10, 10, 10, 255])
    expect(pixel(decoded, 2, 0)).toEqual([35, 35, 35, 255])
    expect(pixel(decoded, 0, 1)).toEqual([40, 40, 40, 255])
    expect(pixel(decoded, 2, 1)).toEqual([60, 60, 60, 255])

    const truncatedFrame = zstdRawFrame(predicted).subarray(0, -1)
    const truncated = tiffFixture({
      width: 3,
      height: 2,
      bitsPerSample: [8],
      compression: 50000,
      photometric: 1,
      strips: [truncatedFrame],
    })
    await expect(decodedPng(truncated)).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })

    const oversizedFrame = Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0x20, 7, 0x3b, 0, 0, 99)
    const oversized = tiffFixture({
      width: 3,
      height: 2,
      bitsPerSample: [8],
      compression: 50000,
      photometric: 1,
      strips: [oversizedFrame],
    })
    await expect(decodedPng(oversized)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
  it('composes WebP-in-TIFF explicitly without changing the default TIFF codec', async () => {
    const source = new PNG({ width: 3, height: 2 })
    source.data.set([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 12, 34, 56, 78, 90, 123, 210, 255, 255, 255,
      255, 64,
    ])
    const sourcePng = PNG.sync.write(source)
    const lossless = await (await Image.open(sourcePng)).webp({ lossless: true }).toBuffer()
    const input = tiffFixture({
      width: 3,
      height: 2,
      bitsPerSample: [8, 8, 8, 8],
      compression: 50001,
      photometric: 2,
      extraSamples: [2],
      strips: [lossless],
    })

    await expect(decodeDirect(input)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    const composed = createTiffCodec({ embeddedCodecs: [webpCodec] })
    const decoded = await decodeDirect(input, composed)
    expect(decoded.format).toBe('rgba8')
    expect(Array.from(decoded.data)).toEqual(Array.from(source.data))

    const lossy = await (await Image.open(sourcePng)).webp({ quality: 80 }).toBuffer()
    const lossyTiff = tiffFixture({
      width: 3,
      height: 2,
      bitsPerSample: [8, 8, 8, 8],
      compression: 50001,
      photometric: 2,
      extraSamples: [2],
      strips: [lossy],
    })
    const standaloneLossy = await decodeDirect(lossy, webpCodec)
    const composedLossy = await decodeDirect(lossyTiff, composed)
    expect(composedLossy.data).toEqual(standaloneLossy.data)

    const mismatched = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8, 8],
      compression: 50001,
      photometric: 2,
      extraSamples: [2],
      strips: [lossless],
    })
    await expect(decodeDirect(mismatched, composed)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('decodes padded tiles and crops edge tiles to the image dimensions', async () => {
    const input = tiffFixture({
      width: 3,
      height: 3,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      tileWidth: 2,
      tileHeight: 2,
      strips: [
        Uint8Array.from([255, 0, 0, 0, 255, 0, 255, 255, 0, 0, 255, 255]),
        Uint8Array.from([0, 0, 255, 1, 2, 3, 255, 0, 255, 4, 5, 6]),
        Uint8Array.from([255, 255, 255, 0, 0, 0, 7, 8, 9, 10, 11, 12]),
        Uint8Array.from([127, 127, 127, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
      ],
    })
    const decoded = await decodedPng(input)

    expect(pixel(decoded, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(decoded, 2, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(decoded, 1, 1)).toEqual([0, 255, 255, 255])
    expect(pixel(decoded, 0, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 2, 2)).toEqual([127, 127, 127, 255])
  })

  it('accepts legacy tiled TIFFs that store tile tables in strip tags', async () => {
    const input = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      tileWidth: 2,
      tileHeight: 1,
      strips: [Uint8Array.of(10, 20), Uint8Array.of(30, 99)],
    })
    renameClassicTiffTag(input, 324, 273)
    renameClassicTiffTag(input, 325, 279)

    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([10, 10, 10, 255])
    expect(pixel(decoded, 1, 0)).toEqual([20, 20, 20, 255])
    expect(pixel(decoded, 2, 0)).toEqual([30, 30, 30, 255])
  })

  it('decodes 16-bit RGB in both byte orders and BigTIFF 64-bit offsets', async () => {
    const rgb16 = tiffFixture({
      width: 2,
      height: 1,
      littleEndian: false,
      bitsPerSample: [16, 16, 16],
      compression: 1,
      photometric: 2,
      strips: [Uint8Array.from([0, 0, 0x80, 0, 0xff, 0xff, 0xff, 0xff, 0, 0, 1, 1])],
    })
    const decoded16 = await decodedPng(rgb16)
    const bigTiffInput = bigTiffRgbFixture()
    bigTiffInput[63] = 0xff
    const bigTiff = await decodedPng(bigTiffInput)

    expect(pixel(decoded16, 0, 0)).toEqual([0, 128, 255, 255])
    expect(pixel(decoded16, 1, 0)).toEqual([255, 0, 1, 255])
    expect(pixel(bigTiff, 0, 0)).toEqual([10, 20, 30, 255])
    expect(pixel(bigTiff, 1, 0)).toEqual([200, 150, 100, 255])
  })
  it('preserves packed 10/12/14-bit grayscale and RGB samples in bounded 16-bit blocks', async () => {
    const grayscale = [4_095, 0, 2_048] as const
    for (const littleEndian of [true, false]) {
      const predicted = predictorDifferences(grayscale, 1, 12)
      const input = tiffFixture({
        width: grayscale.length,
        height: 1,
        littleEndian,
        bitsPerSample: [12],
        compression: 1,
        photometric: 1,
        predictor: 2,
        strips: [packSampleRows([predicted], 12)],
      })
      const direct = await decodeDirect(input)
      expect(direct.format).toBe('gray16')
      expect(grayscale.map((_, index) => uint16BigEndian(direct.data, index * 2))).toEqual(
        grayscale.map((value) => scaleTo16(value, 12)),
      )
      const png = await decodedPng(input)
      expect(pixel(png, 0, 0)).toEqual([255, 255, 255, 255])
      expect(pixel(png, 1, 0)).toEqual([0, 0, 0, 255])
      expect(pixel(png, 2, 0)).toEqual([128, 128, 128, 255])
    }

    for (const bitDepth of [10, 12, 14]) {
      const maximum = 2 ** bitDepth - 1
      const midpoint = Math.ceil(maximum / 2)
      const channels = [
        [0, maximum, 1],
        [midpoint, midpoint, midpoint],
        [maximum, 0, maximum - 1],
      ] as const
      for (const planarConfiguration of [1, 2] as const) {
        const strips =
          planarConfiguration === 1
            ? [packSampleRows([[...channels[0], ...channels[1], ...channels[2]]], bitDepth)]
            : [
                packSampleRows([[channels[0][0], channels[1][0], channels[2][0]]], bitDepth),
                packSampleRows([[channels[0][1], channels[1][1], channels[2][1]]], bitDepth),
                packSampleRows([[channels[0][2], channels[1][2], channels[2][2]]], bitDepth),
              ]
        const input = tiffFixture({
          width: 3,
          height: 1,
          littleEndian: bitDepth !== 12,
          bitsPerSample: [bitDepth, bitDepth, bitDepth],
          compression: 1,
          photometric: 2,
          planarConfiguration,
          strips,
        })
        const direct = await decodeDirect(input)
        expect(direct.format).toBe('rgb16')
        const expected = channels.flatMap((channel) =>
          channel.map((value) => scaleTo16(value, bitDepth)),
        )
        expect(expected.map((_, index) => uint16BigEndian(direct.data, index * 2))).toEqual(
          expected,
        )
      }
    }

    const tiled = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [14],
      compression: 1,
      photometric: 1,
      tileWidth: 3,
      tileHeight: 1,
      strips: [packSampleRows([[0, 16_383, 7_777]], 14)],
    })
    const tilePixels = await decodedPng(tiled)
    expect(pixel(tilePixels, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(tilePixels, 1, 0)).toEqual([255, 255, 255, 255])
  })

  it('decodes low packed RGB and grayscale without temporary sample planes', async () => {
    for (const bitDepth of [2, 4]) {
      const maximum = 2 ** bitDepth - 1
      const input = tiffFixture({
        width: 2,
        height: 1,
        bitsPerSample: [bitDepth, bitDepth, bitDepth],
        compression: 1,
        photometric: 2,
        strips: [packSampleRows([[0, maximum, 0, maximum, 0, maximum]], bitDepth)],
      })
      const decoded = await decodedPng(input)
      expect(pixel(decoded, 0, 0)).toEqual([0, 255, 0, 255])
      expect(pixel(decoded, 1, 0)).toEqual([255, 0, 255, 255])
    }
    const gray6 = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [6],
      compression: 1,
      photometric: 1,
      strips: [packSampleRows([[0, 32, 63]], 6)],
    })
    const decoded = await decodedPng(gray6)
    expect(pixel(decoded, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 1, 0)).toEqual([129, 129, 129, 255])
    expect(pixel(decoded, 2, 0)).toEqual([255, 255, 255, 255])
  })

  it('honors FillOrder 2 for odd packed strips, row padding, and edge tiles', async () => {
    // Independently written in Python and decoded by ImageMagick 7.1.2/LibTIFF 4.7.1.
    const grayscale = Buffer.from(
      'SUkqAAgAAAAMAAABBAABAAAABQAAAAEBBAABAAAAAgAAAAIBAwABAAAABgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAQAAAAoBAwABAAAAAgAAABEBBAACAAAAngAAABUBAwABAAAAAQAAABYBBAABAAAAAQAAABcBBAACAAAApgAAABwBAwABAAAAAQAAAFMBAwABAAAAAQAAAAAAAACuAAAAsgAAAAQAAAAEAAAAACgGP38gggA=',
      'base64',
    )
    const grayscalePixels = await decodeDirect(grayscale)
    expect(grayscalePixels.data).toEqual(Uint8Array.of(0, 4, 68, 129, 255, 255, 129, 68, 4, 0))

    // Big-endian padded edge tile from the same independent fixture generator and oracle.
    const tiledRgb = Buffer.from(
      'TU0AKgAAAAgADAEAAAQAAAABAAAAAwEBAAQAAAABAAAAAgECAAMAAAADAAAAngEDAAMAAAABAAEAAAEGAAMAAAABAAIAAAEKAAMAAAABAAIAAAEVAAMAAAABAAMAAAEcAAMAAAABAAEAAAFCAAQAAAABAAAABAFDAAQAAAABAAAAAgFEAAQAAAABAAAApAFFAAQAAAABAAAABgAAAAAAAgACAALMbAN/AgA=',
      'base64',
    )
    const tiledPixels = await decodedPng(tiledRgb)
    expect(pixel(tiledPixels, 0, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(tiledPixels, 1, 0)).toEqual([255, 0, 255, 255])
    expect(pixel(tiledPixels, 2, 0)).toEqual([85, 170, 255, 255])
    expect(pixel(tiledPixels, 0, 1)).toEqual([255, 255, 255, 255])
    expect(pixel(tiledPixels, 2, 1)).toEqual([0, 0, 0, 255])
  })

  it('reverses FillOrder 2 before predictors in both byte orders and rejects truncation', async () => {
    const values = [0, 15, 0, 5, 10, 15, 15, 5, 10]
    const differences = predictorDifferences(values, 3, 4)
    for (const littleEndian of [true, false]) {
      const predicted = reverseByteBits(packSampleRows([differences], 4))
      const input = tiffFixture({
        width: 3,
        height: 1,
        littleEndian,
        bitsPerSample: [4, 4, 4],
        compression: 8,
        photometric: 2,
        fillOrder: 2,
        predictor: 2,
        strips: [deflateSync(predicted)],
      })
      expect(await decodeDirect(input)).toMatchObject({
        format: 'rgb8',
        data: Uint8Array.from(values, (value) => value * 17),
      })
    }

    const sharedInput = Buffer.from(
      tiffFixture({
        width: 3,
        height: 1,
        bitsPerSample: [6],
        compression: 1,
        photometric: 1,
        fillOrder: 2,
        strips: [reverseByteBits(packSampleRows([[0, 32, 63]], 6))],
      }),
    )
    const originalInput = Buffer.from(sharedInput)
    const sharedSource = {
      size: sharedInput.byteLength,
      read: async (offset: number, length: number): Promise<Uint8Array> =>
        sharedInput.subarray(offset, offset + length),
    }
    if (!tiffCodec.createDecoder) throw new Error('TIFF decoder is unavailable')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const decoder = await tiffCodec.createDecoder(sharedSource, defaultImageLimits)
      for await (const block of decoder.decode()) {
        expect(block.data).toEqual(Uint8Array.of(0, 129, 255))
      }
    }
    expect(sharedInput).toEqual(originalInput)

    const truncated = tiffFixture({
      width: 5,
      height: 1,
      bitsPerSample: [6],
      compression: 1,
      photometric: 1,
      fillOrder: 2,
      strips: [Uint8Array.of(0, 0, 0)],
    })
    await expect(decodeDirect(truncated)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'TIFF uncompressed strip has 3, expected 4 bytes',
    })
  })

  it('decodes 16-bit palette indices directly to RGB rows', async () => {
    const colors = 65_536
    const colorMap = new Array<number>(colors * 3).fill(0)
    colorMap[0] = 0
    colorMap[colors] = 65_535
    colorMap[colors * 2] = 0
    colorMap[0x1234] = 0xab00
    colorMap[colors + 0x1234] = 0xcd00
    colorMap[colors * 2 + 0x1234] = 0xef00
    colorMap[0xffff] = 65_535
    colorMap[colors + 0xffff] = 0
    colorMap[colors * 2 + 0xffff] = 0
    const input = tiffFixture({
      width: 3,
      height: 1,
      littleEndian: false,
      bitsPerSample: [16],
      compression: 1,
      photometric: 3,
      colorMap,
      strips: [Uint8Array.of(0, 0, 0x12, 0x34, 0xff, 0xff)],
    })

    const decoded = await decodeDirect(input)
    expect(decoded.format).toBe('rgb8')
    expect(decoded.data).toEqual(Uint8Array.of(0, 255, 0, 170, 204, 238, 255, 0, 0))
  })

  it('preserves unsigned 24-bit and 32-bit RGB with native Predictor 2 reversal', async () => {
    for (const bitDepth of [24, 32] as const) {
      const maximum = (1n << BigInt(bitDepth)) - 1n
      const values = [0n, maximum >> 1n, maximum, maximum, 0n, maximum >> 2n] as const
      const differences = widePredictorDifferences(values, 3, bitDepth)
      for (const littleEndian of [true, false]) {
        const input = tiffFixture({
          width: 2,
          height: 1,
          littleEndian,
          bitsPerSample: [bitDepth, bitDepth, bitDepth],
          compression: 1,
          photometric: 2,
          predictor: 2,
          strips: [unsignedPayload(differences, bitDepth, littleEndian)],
        })
        const raw = await decodeDirect(input)
        expect(raw.format).toBe('rgb32')
        expect(raw.data).toEqual(unsignedPayload(values, 32, false))
        expect(raw.displayRanges).toEqual([
          { black: 0, white: Number(maximum) },
          { black: 0, white: Number(maximum) },
          { black: 0, white: Number(maximum) },
        ])
        const pixels = await decodedPng(input)
        expect(pixel(pixels, 0, 0)).toEqual([0, 127, 255, 255])
        expect(pixel(pixels, 1, 0)).toEqual([255, 0, 63, 255])
      }
    }
  })

  it('preserves planar 32-bit RGB and padded-edge tiled 24-bit grayscale', async () => {
    const maximum32 = 0xffff_ffffn
    const planes = [
      [0n, maximum32],
      [maximum32 >> 1n, maximum32 >> 2n],
      [maximum32, 0n],
    ] as const
    const planar = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [32, 32, 32],
      compression: 1,
      photometric: 2,
      planarConfiguration: 2,
      predictor: 2,
      strips: planes.map((values) =>
        unsignedPayload(widePredictorDifferences(values, 1, 32), 32, true),
      ),
    })
    const planarRaw = await decodeDirect(planar)
    expect(planarRaw.format).toBe('rgb32')
    expect(planarRaw.data).toEqual(
      unsignedPayload(
        [planes[0][0], planes[1][0], planes[2][0], planes[0][1], planes[1][1], planes[2][1]],
        32,
        false,
      ),
    )

    const maximum24 = 0xff_ffffn
    const tiled = tiffFixture({
      width: 2,
      height: 1,
      littleEndian: false,
      bitsPerSample: [24],
      compression: 1,
      photometric: 0,
      tileWidth: 3,
      tileHeight: 1,
      strips: [unsignedPayload([0n, maximum24, 123n], 24, false)],
    })
    const tileRaw = await decodeDirect(tiled)
    expect(tileRaw.format).toBe('gray32')
    expect(tileRaw.data).toEqual(unsignedPayload([0n, maximum24], 32, false))
    const tilePixels = await decodedPng(tiled)
    expect(pixel(tilePixels, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(tilePixels, 1, 0)).toEqual([0, 0, 0, 255])
  })

  it('preserves exact unsigned 64-bit RGB values without BigInt pixel arithmetic', async () => {
    const maximum = 0xffff_ffff_ffff_ffffn
    const values = [
      0n,
      0x8000_0000_0000_0000n,
      maximum,
      maximum,
      0x0020_0000_0000_0001n,
      0x4000_0000_0000_0000n,
    ] as const
    const differences = widePredictorDifferences(values, 3, 64)
    for (const littleEndian of [true, false]) {
      const input = tiffFixture({
        width: 2,
        height: 1,
        littleEndian,
        bitsPerSample: [64, 64, 64],
        compression: 1,
        photometric: 2,
        predictor: 2,
        strips: [unsignedPayload(differences, 64, littleEndian)],
      })
      const raw = await decodeDirect(input)
      expect(raw.format).toBe('rgb64')
      expect(raw.data).toEqual(unsignedPayload(values, 64, false))
      const pixels = await decodedPng(input)
      expect(pixel(pixels, 0, 0)).toEqual([0, 127, 255, 255])
      expect(pixel(pixels, 1, 0)).toEqual([255, 0, 63, 255])
    }
  })

  it('rejects truncated wide unsigned rows before pixel emission', async () => {
    const input = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [64],
      compression: 1,
      photometric: 1,
      strips: [new Uint8Array(15)],
    })
    await expect(Image.open(input).then((image) => image.png().toBuffer())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('decodes SGILog luminance to native CIE Y with bounded row RLE', async () => {
    const values = [0, 0x3f00, 0xbf00, 0x4000]
    for (const littleEndian of [true, false]) {
      const input = tiffFixture({
        width: values.length,
        height: 1,
        littleEndian,
        bitsPerSample: [16],
        compression: 34676,
        photometric: 32844,
        strips: [sgiLogRleRows([values], 2)],
        extraEntries: [{ tag: 339, type: 3, values: [2] }],
      })
      const raw = await decodeDirect(input)
      expect(raw.format).toBe('yf32')
      const view = new DataView(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength)
      for (let index = 0; index < values.length; index += 1) {
        expect(view.getFloat32(index * 4, false)).toBe(Math.fround(logL16Value(values[index] ?? 0)))
      }
      const pixels = await decodedPng(input)
      expect(pixel(pixels, 0, 0)).toEqual([0, 0, 0, 255])
      expect(pixel(pixels, 1, 0)).toEqual([181, 181, 181, 255])
      expect(pixel(pixels, 2, 0)).toEqual([0, 0, 0, 255])
      expect(pixel(pixels, 3, 0)).toEqual([255, 255, 255, 255])
      const metadata = await (await Image.open(input)).metadata()
      expect(metadata).toMatchObject({
        colorSpace: 'gray',
        bitDepth: 32,
        sampleFormat: 'floating-point',
      })
    }
  })

  it('decodes SGILog32 byte-plane runs and literals to native CIE XYZ', async () => {
    const logL = 0x3f00
    const codes = [
      ((logL << 16) | (86 << 8) | 194) >>> 0,
      ((logL << 16) | (110 << 8) | 160) >>> 0,
      ((logL << 16) | (86 << 8) | 194) >>> 0,
      ((logL << 16) | (86 << 8) | 194) >>> 0,
    ]
    const input = tiffFixture({
      width: codes.length,
      height: 1,
      bitsPerSample: [16, 16, 16],
      compression: 34676,
      photometric: 32845,
      strips: [sgiLogRleRows([codes], 4)],
      extraEntries: [{ tag: 339, type: 3, values: [2, 2, 2] }],
    })
    const raw = await decodeDirect(input)
    expect(raw.format).toBe('xyzf32')
    expect(raw.displayRanges).toBeUndefined()
    const luminance = logL16Value(logL)
    const u = 86.5 / 410
    const v = 194.5 / 410
    const scale = 1 / (6 * u - 16 * v + 12)
    const x = 9 * u * scale
    const y = 4 * v * scale
    const view = new DataView(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength)
    expect(view.getFloat32(0, false)).toBe(Math.fround((x / y) * luminance))
    expect(view.getFloat32(4, false)).toBe(Math.fround(luminance))
    expect(view.getFloat32(8, false)).toBe(Math.fround(((1 - x - y) / y) * luminance))
    const metadata = await (await Image.open(input)).metadata()
    expect(metadata).toMatchObject({
      colorSpace: 'cie-xyz',
      bitDepth: 32,
      sampleFormat: 'floating-point',
    })
  })

  it('decodes SGILog24 codebook chroma and padded tile edges', async () => {
    const values = [(0x300 << 14) | 0, (0x300 << 14) | 0x3fff]
    const strip = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [16, 16, 16],
      compression: 34677,
      photometric: 32845,
      strips: [sgiLog24Rows([values])],
      extraEntries: [{ tag: 339, type: 3, values: [2, 2, 2] }],
    })
    const raw = await decodeDirect(strip)
    expect(raw.format).toBe('xyzf32')
    expect(raw.data.byteLength).toBe(24)
    const view = new DataView(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength)
    for (let offset = 0; offset < raw.data.byteLength; offset += 4) {
      expect(Number.isFinite(view.getFloat32(offset, false))).toBe(true)
    }

    const paddedValues = [values[0] ?? 0, values[1] ?? 0, values[0] ?? 0, values[1] ?? 0]
    const tiled = tiffFixture({
      width: 3,
      height: 1,
      littleEndian: false,
      bitsPerSample: [16, 16, 16],
      compression: 34677,
      photometric: 32845,
      tileWidth: 4,
      tileHeight: 1,
      strips: [sgiLog24Rows([paddedValues])],
      extraEntries: [{ tag: 339, type: 3, values: [2, 2, 2] }],
    })
    const tiledRaw = await decodeDirect(tiled)
    expect(tiledRaw.format).toBe('xyzf32')
    expect(tiledRaw.data.byteLength).toBe(36)
    expect(tiledRaw.data).toEqual(
      Uint8Array.from([
        ...raw.data.slice(0, 12),
        ...raw.data.slice(12, 24),
        ...raw.data.slice(0, 12),
      ]),
    )
  })

  it('rejects malformed SGILog packets and inexact SGILog24 segments', async () => {
    const fixture = (compression: number, photometric: number, strip: Uint8Array): Uint8Array =>
      tiffFixture({
        width: 4,
        height: 1,
        bitsPerSample: photometric === 32844 ? [16] : [16, 16, 16],
        compression,
        photometric,
        strips: [strip],
        extraEntries: [
          {
            tag: 339,
            type: 3,
            values: photometric === 32844 ? [2] : [2, 2, 2],
          },
        ],
      })
    for (const input of [
      fixture(34676, 32844, Uint8Array.of(130)),
      fixture(34676, 32844, Uint8Array.of(131, 0)),
      fixture(34676, 32844, Uint8Array.of(4, 0, 1)),
      fixture(34676, 32844, Uint8Array.of(130, 0, 130, 0, 99)),
      fixture(34677, 32845, new Uint8Array(11)),
    ]) {
      await expect(Image.open(input).then((image) => image.png().toBuffer())).rejects.toMatchObject(
        {
          code: 'INVALID_INPUT',
        },
      )
    }
  })

  it('preserves signed integer samples and converts declared display ranges', async () => {
    const signed8 = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      strips: [signedPayload([-128, 0, 127], 8, true)],
      extraEntries: [
        { tag: 339, type: 3, values: [2] },
        { tag: 340, type: 6, values: [-100] },
        { tag: 341, type: 6, values: [100] },
      ],
    })
    const raw8 = await decodeDirect(signed8)
    expect(raw8).toEqual({
      format: 'grayi8',
      data: Uint8Array.of(128, 0, 127),
      displayRanges: [{ black: -100, white: 100 }],
    })
    const metadata = await (await Image.open(signed8)).metadata()
    expect(metadata.sampleFormat).toBe('signed-integer')
    const pixels8 = await decodedPng(signed8)
    expect(pixel(pixels8, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(pixels8, 1, 0)).toEqual([127, 127, 127, 255])
    expect(pixel(pixels8, 2, 0)).toEqual([255, 255, 255, 255])

    const whiteIsZero = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8],
      compression: 1,
      photometric: 0,
      strips: [signedPayload([-128, 127], 8, true)],
      extraEntries: [{ tag: 339, type: 3, values: [2] }],
    })
    const inverse = await decodedPng(whiteIsZero)
    expect(pixel(inverse, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(inverse, 1, 0)).toEqual([0, 0, 0, 255])

    const values = [-32_768, 0, 32_767, 32_767, -32_768, 0] as const
    const rawValues = values.map((value) => value & 0xffff)
    const predicted = predictorDifferences(rawValues, 3, 16)
    for (const littleEndian of [true, false]) {
      const payload = new Uint8Array(predicted.length * 2)
      const view = new DataView(payload.buffer)
      for (let index = 0; index < predicted.length; index += 1) {
        view.setUint16(index * 2, predicted[index] ?? 0, littleEndian)
      }
      const signed16 = tiffFixture({
        width: 2,
        height: 1,
        littleEndian,
        bitsPerSample: [16, 16, 16],
        compression: 1,
        photometric: 2,
        predictor: 2,
        strips: [payload],
        extraEntries: [{ tag: 339, type: 3, values: [2, 2, 2] }],
      })
      const raw16 = await decodeDirect(signed16)
      expect(raw16.format).toBe('rgbi16')
      expect(raw16.data).toEqual(signedPayload(values, 16, false))
      expect(raw16.displayRanges).toEqual([
        { black: -32_768, white: 32_767 },
        { black: -32_768, white: 32_767 },
        { black: -32_768, white: 32_767 },
      ])
      const pixels16 = await decodedPng(signed16)
      expect(pixel(pixels16, 0, 0)).toEqual([0, 127, 255, 255])
      expect(pixel(pixels16, 1, 0)).toEqual([255, 0, 127, 255])
    }
  })

  it('preserves IEEE floats and converts finite and non-finite samples deterministically', async () => {
    const halfBits = [0, 0x3800, 0x3c00, 0x7e01, 0x7c00, 0xfc00] as const
    const halfPayload = new Uint8Array(halfBits.length * 2)
    const halfView = new DataView(halfPayload.buffer)
    for (let index = 0; index < halfBits.length; index += 1) {
      halfView.setUint16(index * 2, halfBits[index] ?? 0, true)
    }
    const float16 = tiffFixture({
      width: halfBits.length,
      height: 1,
      bitsPerSample: [16],
      compression: 1,
      photometric: 1,
      strips: [halfPayload],
      extraEntries: [
        { tag: 339, type: 3, values: [3] },
        { tag: 340, type: 11, values: [0] },
        { tag: 341, type: 11, values: [1] },
      ],
    })
    const raw16 = await decodeDirect(float16)
    expect(raw16.format).toBe('grayf16')
    expect(raw16.data).toEqual(
      Uint8Array.from(halfBits.flatMap((bits) => [bits >>> 8, bits & 0xff])),
    )
    const pixels16 = await decodedPng(float16)
    expect(halfBits.map((_bits, x) => pixel(pixels16, x, 0)[0])).toEqual([0, 127, 255, 0, 255, 0])

    const rgbValues = [0, 0.5, 1, 1, 0.25, 0] as const
    for (const littleEndian of [true, false]) {
      const rawRgb = floatPayload(rgbValues, 32, littleEndian)
      const predictedRgb = floatingPredictorDifferences(rawRgb, 4, 3, littleEndian)
      const float32 = tiffFixture({
        width: 2,
        height: 1,
        littleEndian,
        bitsPerSample: [32, 32, 32],
        compression: 8,
        photometric: 2,
        predictor: 3,
        strips: [deflateSync(predictedRgb)],
        extraEntries: [
          { tag: 339, type: 3, values: [3, 3, 3] },
          { tag: 340, type: 11, values: [0, 0, 0] },
          { tag: 341, type: 11, values: [1, 1, 1] },
        ],
      })
      const raw32 = await decodeDirect(float32)
      expect(raw32.format).toBe('rgbf32')
      expect(raw32.data).toEqual(floatPayload(rgbValues, 32, false))
      const pixels32 = await decodedPng(float32)
      expect(pixel(pixels32, 0, 0)).toEqual([0, 127, 255, 255])
      expect(pixel(pixels32, 1, 0)).toEqual([255, 63, 0, 255])
    }

    const float64Values = [0, 0.25, 0.5, 1] as const
    for (const littleEndian of [true, false]) {
      const rawFloat64 = floatPayload(float64Values, 64, littleEndian)
      const float64 = tiffFixture({
        width: float64Values.length,
        height: 1,
        littleEndian,
        bitsPerSample: [64],
        compression: 1,
        photometric: 1,
        predictor: 2,
        strips: [horizontal64Differences(rawFloat64, littleEndian)],
        extraEntries: [{ tag: 339, type: 3, values: [3] }],
      })
      const raw64 = await decodeDirect(float64)
      expect(raw64.format).toBe('grayf64')
      expect(raw64.data).toEqual(floatPayload(float64Values, 64, false))
      const pixels64 = await decodedPng(float64)
      expect(float64Values.map((_value, x) => pixel(pixels64, x, 0)[0])).toEqual([0, 63, 127, 255])
    }
  })

  it('rejects invalid numeric display ranges', async () => {
    const invalidRange = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [32],
      compression: 1,
      photometric: 1,
      strips: [floatPayload([0], 32, true)],
      extraEntries: [
        { tag: 339, type: 3, values: [3] },
        { tag: 340, type: 11, values: [1] },
        { tag: 341, type: 11, values: [0] },
      ],
    })
    await expect(
      Image.open(invalidRange).then((image) => image.png().toBuffer()),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('decodes CMYK alpha but keeps generic five-band data unsupported', async () => {
    for (const extraSample of [1, 2]) {
      const input = tiffFixture({
        width: 1,
        height: 1,
        bitsPerSample: [8, 8, 8, 8, 8],
        compression: 1,
        photometric: 5,
        extraSamples: [extraSample],
        strips: [
          extraSample === 1
            ? Uint8Array.of(127, 255, 255, 0, 128)
            : Uint8Array.of(0, 255, 255, 0, 128),
        ],
      })
      const decoded = await decodedPng(input)
      expect(pixel(decoded, 0, 0)).toEqual([255, 0, 0, 128])
    }
    const planarPredicted = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8, 8, 8, 8, 8],
      compression: 1,
      photometric: 5,
      planarConfiguration: 2,
      predictor: 2,
      tileWidth: 2,
      tileHeight: 1,
      extraSamples: [2],
      strips: [
        Uint8Array.of(0, 255),
        Uint8Array.of(255, 1),
        Uint8Array.of(255, 1),
        Uint8Array.of(0, 0),
        Uint8Array.of(128, 127),
      ],
    })
    const planarPixels = await decodedPng(planarPredicted)
    expect(pixel(planarPixels, 0, 0)).toEqual([255, 0, 0, 128])
    expect(pixel(planarPixels, 1, 0)).toEqual([0, 255, 255, 255])

    const generic = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8, 8, 8],
      compression: 1,
      photometric: 1,
      extraSamples: [0, 0, 0, 0],
      strips: [Uint8Array.of(1, 2, 3, 4, 5)],
    })
    await expect(Image.open(generic).then((image) => image.png().toBuffer())).rejects.toMatchObject(
      {
        code: 'UNSUPPORTED_OPERATION',
      },
    )
  })

  it('rejects truncated packed rows before pixel emission', async () => {
    const input = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [12],
      compression: 1,
      photometric: 1,
      strips: [Uint8Array.of(0, 0, 0, 0)],
    })
    await expect(Image.open(input).then((image) => image.png().toBuffer())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('decodes legacy LSB-packed TIFF LZW through its late code-width transition', async () => {
    const values = Uint8Array.from({ length: 300 }, (_, index) => index & 0xff)
    const input = tiffFixture({
      width: values.byteLength,
      height: 1,
      bitsPerSample: [8],
      compression: 5,
      photometric: 1,
      strips: [packLegacyLzwLiterals(values)],
    })

    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 255, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 299, 0)).toEqual([43, 43, 43, 255])
  })

  it('decodes independently encoded tiled LZW and BigTIFF files', async () => {
    // ImageMagick 7.1.2/libtiff 4.7 encoded both fixtures; TIFF64 emits BigTIFF.
    const bigTiff = Buffer.from(
      'SUkrAAgAAAAeAAAAAAAAAIAFBQPABBYNAoJBoLAQEAAAAAAAAAAAAQMAAQAAAAAAAAADAAAAAAAAAAEBAwABAAAAAAAAAAIAAAAAAAAAAgEDAAMAAAAAAAAACAAIAAgAAAADAQMAAQAAAAAAAAAFAAAAAAAAAAYBAwABAAAAAAAAAAIAAAAAAAAACgEDAAEAAAAAAAAAAQAAAAAAAAARARAAAQAAAAAAAAAQAAAAAAAAABIBAwABAAAAAAAAAAEAAAAAAAAAFQEDAAEAAAAAAAAAAwAAAAAAAAAWAQMAAQAAAAAAAAACAAAAAAAAABcBEAABAAAAAAAAAA4AAAAAAAAAHAEDAAEAAAAAAAAAAQAAAAAAAAApAQMAAgAAAAAAAAAAAAEAAAAAAD0BAwABAAAAAAAAAAIAAAAAAAAAPgEFAAIAAAAAAAAAngEAAAAAAAA/AQUABgAAAAAAAABuAQAAAAAAAAAAAAAAAAAAhetRAAAAgADD9agAAAAAAs3MTAAAAAABzcxMAAAAgADNzEwAAAAAAo/C9QAAAAAQNxqgAAAAAAIrhwoAAAAgAA==',
      'base64',
    )
    const tiled = Buffer.from(
      'SUkqAFIBAACABMrpsAQWDQeCu0Uqo0FMkAkWnMfkU0COHxE3xR5xc5p8jGhhkeIHNAJA3QiUABAPB6w0VSMXx8ZyKIl+PgOaHNHkc0NMjSN3MohSmEBJjAU0EOfxEnzwJ0s5n+eOOoK8kGhZkWRlCroOtREH1cp1+JVcR2Q31d52RPkmQESRs+3JO4RE4W4x3U5i+3DO9F+3AO9I8lT0hyNf4VR4eIu/CnPGHNIFmkjSRk/KBPLRE/5Rx5s5q8tVgZyNv6NB6WwaMp6o5rDRiPXG/RvPXJ8tyAZXHcpPdxEP4Uh5En4UJ5F4YVx5FXkusEKRv/cmPfnNv85B9CIo+id3vQcqFIpgBWqxVgBgkpsn9GoFgipT9/5fP6fX6eHx+XziEltkPkY9z4PtAcCQK7r8PI8wAEC/pfwA974wNCUJvrBD9AAcL+i/B8BQpDz6oCARAAABAwABAAAABQAAAAEBAwABAAAAAwAAAAIBAwADAAAAJAIAAAMBAwABAAAABQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAABIBAwABAAAAAQAAABUBAwABAAAAAwAAABwBAwABAAAAAQAAACkBAwACAAAAAAABAD0BAwABAAAAAgAAAD4BBQACAAAAWgIAAD8BBQAGAAAAKgIAAEIBAwABAAAAEAAAAEMBAwABAAAAEAAAAEQBBAABAAAACAAAAEUBBAABAAAASgEAAAAAAAAIAAgACACF61EAAACAAMP1qAAAAAACzcxMAAAAAAHNzEwAAACAAM3MTAAAAAACj8L1AAAAABA3GqAAAAAAAiuHCgAAACAA',
      'base64',
    )
    const bigPixels = await decodedPng(bigTiff)
    const tilePixels = await decodedPng(tiled)

    expect(pixel(bigPixels, 2, 1)).toEqual([20, 40, 60, 255])
    expect(pixel(tilePixels, 0, 0)).toEqual([19, 87, 155, 255])
    expect(pixel(tilePixels, 2, 1)).toEqual([128, 144, 110, 255])
    expect(pixel(tilePixels, 4, 2)).toEqual([238, 202, 66, 255])
  })

  it('converts TIFF 6 CIELab samples to D65 sRGB in chunky and planar layouts', async () => {
    // tifffile 2026.3.3 encoded this chunky TIFF independently.
    const chunky = Buffer.from(
      'SUkqAAgAAAAOAAABBAABAAAABgAAAAEBBAABAAAAAQAAAAIBAwADAAAAtgAAAAMBAwABAAAAAQAAAAYBAwABAAAACAAAABEBBAABAAAA4AAAABUBAwABAAAAAwAAABYBBAABAAAAAQAAABcBBAABAAAAEgAAABoBBQABAAAAvAAAABsBBQABAAAAxAAAABwBAwABAAAAAQAAACgBAwABAAAAAQAAADEBAgAMAAAAzAAAAAAAAAAIAAgACAABAAAAAQAAAAEAAAABAAAAdGlmZmZpbGUucHkAAAAAAAAAAAAAAAD/AACKUUbgsVFLRJCAKNg=',
      'base64',
    )
    const planar = tiffFixture({
      width: 6,
      height: 1,
      littleEndian: false,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 8,
      planarConfiguration: 2,
      strips: [
        Uint8Array.of(0, 255, 138, 224, 75, 128),
        Uint8Array.of(0, 0, 81, 177, 68, 40),
        Uint8Array.of(0, 0, 70, 81, 144, 216),
      ],
    })
    // colour-science 0.4.7 independently converted the TIFF 6 D65 Lab values to sRGB.
    const expected = Uint8Array.of(
      0,
      0,
      0,
      255,
      255,
      255,
      255,
      1,
      0,
      73,
      253,
      26,
      0,
      34,
      254,
      152,
      95,
      188,
    )
    expect(await decodeDirect(chunky)).toMatchObject({ format: 'rgb8', data: expected })
    expect(await decodeDirect(planar)).toMatchObject({ format: 'rgb8', data: expected })
    if (!tiffCodec.metadata) throw new Error('TIFF metadata inspector is unavailable')
    await expect(
      tiffCodec.metadata(new MemorySource(chunky), defaultImageLimits),
    ).resolves.toMatchObject({
      colorSpace: 'cie-lab',
      bitDepth: 8,
    })
  })

  it('supports L-only CIELab and unassociated alpha with explicit boundaries', async () => {
    const lightness = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [8],
      compression: 1,
      photometric: 8,
      strips: [Uint8Array.of(0, 128, 255)],
    })
    const alpha = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8, 8],
      compression: 1,
      photometric: 8,
      extraSamples: [2],
      strips: [Uint8Array.of(138, 81, 70, 127)],
    })
    expect(await decodeDirect(lightness)).toMatchObject({
      format: 'rgb8',
      data: Uint8Array.of(0, 0, 0, 119, 119, 119, 255, 255, 255),
    })
    expect(await decodeDirect(alpha)).toMatchObject({
      format: 'rgba8',
      data: Uint8Array.of(255, 1, 0, 127),
    })

    const associated = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8, 8],
      compression: 1,
      photometric: 8,
      extraSamples: [1],
      strips: [Uint8Array.of(138, 81, 70, 127)],
    })
    const invalidChroma = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 8,
      strips: [Uint8Array.of(128, 128, 0)],
    })
    const profiled = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 8,
      iccProfile: channelSwappingRgbProfile(),
      strips: [Uint8Array.of(128, 0, 0)],
    })
    await expect(decodeDirect(associated)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'TIFF CIELab associated alpha is unsupported',
    })
    await expect(decodeDirect(invalidChroma)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'TIFF CIELab a* and b* samples must be within -127 to 127',
    })
    await expect(decodeDirect(profiled)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'TIFF CIELab ICC transforms are not implemented',
    })
  })

  it('applies CMYK lut16 ICC profiles before bounded RGB output', async () => {
    const profile = constantGrayCmykProfile()
    const chunky = tiffFixture({
      width: 4,
      height: 1,
      bitsPerSample: [8, 8, 8, 8],
      compression: 1,
      photometric: 5,
      iccProfile: profile,
      strips: [Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 255)],
    })
    const planar16 = tiffFixture({
      width: 2,
      height: 1,
      littleEndian: false,
      bitsPerSample: [16, 16, 16, 16],
      compression: 1,
      photometric: 5,
      planarConfiguration: 2,
      iccProfile: profile,
      strips: [
        Uint8Array.of(0, 0, 255, 255),
        Uint8Array.of(255, 255, 0, 0),
        Uint8Array.of(0, 0, 255, 255),
        Uint8Array.of(255, 255, 0, 0),
      ],
    })
    const alpha = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8, 8, 8],
      compression: 1,
      photometric: 5,
      extraSamples: [2],
      iccProfile: profile,
      strips: [Uint8Array.of(0, 0, 0, 0, 127)],
    })
    const labPcs = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8, 8],
      compression: 1,
      photometric: 5,
      iccProfile: constantGrayCmykProfile('Lab '),
      strips: [Uint8Array.of(255, 0, 0, 0)],
    })

    // ImageMagick 7.1.2 with LittleCMS produced [187, 187, 187] for this profile.
    const chunkyPixels = await decodeDirect(chunky)
    const planarPixels = await decodeDirect(planar16)
    const alphaPixels = await decodeDirect(alpha)
    for (const data of [chunkyPixels.data, planarPixels.data]) {
      for (const value of data) expect(Math.abs(value - 187)).toBeLessThanOrEqual(1)
    }
    expect(alphaPixels).toMatchObject({
      format: 'rgba8',
      data: Uint8Array.of(188, 188, 187, 127),
    })
    // The same independent LittleCMS oracle produced exact [119, 119, 119] for Lab PCS.
    await expect(decodeDirect(labPcs)).resolves.toMatchObject({
      format: 'rgb8',
      data: Uint8Array.of(119, 119, 119),
    })

    await expect(decodeDirect(chunky, tiffCodec, { preserveIcc: true })).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'Preserving a CMYK TIFF ICC profile requires a raw CMYK pixel format',
    })
    const wrongColorSpace = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8, 8],
      compression: 1,
      photometric: 5,
      iccProfile: channelSwappingRgbProfile(),
      strips: [Uint8Array.of(0, 0, 0, 0)],
    })
    await expect(decodeDirect(wrongColorSpace)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Embedded ICC profile must use the CMYK input color space',
    })
    const unsupportedClass = constantGrayCmykProfile()
    unsupportedClass.set(Uint8Array.of(0x6d, 0x41, 0x42, 0x20), 144)
    const unsupportedProfile = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8, 8],
      compression: 1,
      photometric: 5,
      iccProfile: unsupportedClass,
      strips: [Uint8Array.of(0, 0, 0, 0)],
    })
    await expect(decodeDirect(unsupportedProfile)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'CMYK ICC profile must provide a lut16 A2B0 transform',
    })
  })

  it('converts CMYK and subsampled YCbCr samples to RGB', async () => {
    const cmyk = tiffFixture({
      width: 4,
      height: 1,
      bitsPerSample: [8, 8, 8, 8],
      compression: 1,
      photometric: 5,
      strips: [Uint8Array.from([0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 128, 64, 0, 128])],
    })
    const ycbcr = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 6,
      extraEntries: [{ tag: 530, type: 3, values: [2, 2] }],
      strips: [Uint8Array.from([76, 76, 76, 76, 85, 255, 29, 29, 29, 29, 255, 107])],
    })
    const cmykPixels = await decodedPng(cmyk)
    const ycbcrPixels = await decodedPng(ycbcr)

    expect(pixel(cmykPixels, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(cmykPixels, 1, 0)).toEqual([0, 255, 255, 255])
    expect(pixel(cmykPixels, 2, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(cmykPixels, 3, 0)).toEqual([63, 95, 127, 255])
    expect(pixel(ycbcrPixels, 0, 0)).toEqual([254, 0, 0, 255])
    expect(pixel(ycbcrPixels, 1, 0)).toEqual([254, 0, 0, 255])
    expect(pixel(ycbcrPixels, 2, 0)).toEqual([0, 0, 254, 255])
  })

  it('converts signed and floating-point CMYK through declared display ranges', async () => {
    const signed = tiffFixture({
      width: 4,
      height: 1,
      bitsPerSample: [8, 8, 8, 8],
      compression: 1,
      photometric: 5,
      extraEntries: [{ tag: 339, type: 3, values: [2, 2, 2, 2] }],
      strips: [
        signedPayload(
          [-128, -128, -128, -128, 127, -128, -128, -128, -128, -128, -128, 127, 0, -64, -128, 0],
          8,
          true,
        ),
      ],
    })
    const floating = tiffFixture({
      width: 4,
      height: 1,
      bitsPerSample: [32, 32, 32, 32],
      compression: 1,
      photometric: 5,
      extraEntries: [
        { tag: 339, type: 3, values: [3, 3, 3, 3] },
        { tag: 340, type: 11, values: [0, 0, 0, 0] },
        { tag: 341, type: 11, values: [1, 1, 1, 1] },
      ],
      strips: [floatPayload([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0.5, 0.25, 0, 0.5], 32, true)],
    })

    const signedPixels = await decodedPng(signed)
    const floatPixels = await decodedPng(floating)
    expect(pixel(signedPixels, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(signedPixels, 1, 0)).toEqual([0, 255, 255, 255])
    expect(pixel(signedPixels, 2, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(signedPixels, 3, 0)).toEqual([63, 95, 127, 255])
    expect(pixel(floatPixels, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(floatPixels, 1, 0)).toEqual([0, 255, 255, 255])
    expect(pixel(floatPixels, 2, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(floatPixels, 3, 0)).toEqual([64, 96, 128, 255])
  })

  it('covers signed16, float16, and float64 CMYK sample depths', async () => {
    const signed16Values = [-32_768, -32_768, -32_768, -32_768, 32_767, -32_768, -32_768, -32_768]
    const signed16 = tiffFixture({
      width: 2,
      height: 1,
      littleEndian: false,
      bitsPerSample: [16, 16, 16, 16],
      compression: 1,
      photometric: 5,
      strips: [signedPayload(signed16Values, 16, false)],
      extraEntries: [{ tag: 339, type: 3, values: [2, 2, 2, 2] }],
    })

    const halfBits = [0, 0, 0, 0, 0x3c00, 0, 0, 0, 0, 0, 0, 0x3c00, 0x3800, 0x3400, 0, 0x3800]
    const halfSamples = new Uint8Array(halfBits.length * 2)
    const halfView = new DataView(halfSamples.buffer)
    for (let index = 0; index < halfBits.length; index += 1) {
      halfView.setUint16(index * 2, halfBits[index] ?? 0, true)
    }
    const float16 = tiffFixture({
      width: 4,
      height: 1,
      bitsPerSample: [16, 16, 16, 16],
      compression: 1,
      photometric: 5,
      strips: [halfSamples],
      extraEntries: [{ tag: 339, type: 3, values: [3, 3, 3, 3] }],
    })

    const float64Values = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0.5, 0.25, 0, 0.5]
    const float64 = tiffFixture({
      width: 4,
      height: 1,
      littleEndian: false,
      bitsPerSample: [64, 64, 64, 64],
      compression: 1,
      photometric: 5,
      strips: [floatPayload(float64Values, 64, false)],
      extraEntries: [{ tag: 339, type: 3, values: [3, 3, 3, 3] }],
    })

    const signed16Pixels = await decodeDirect(signed16)
    const float16Pixels = await decodeDirect(float16)
    const float64Pixels = await decodeDirect(float64)
    expect(signed16Pixels.data).toEqual(Uint8Array.of(255, 255, 255, 0, 255, 255))
    const expectedFloat = Uint8Array.of(255, 255, 255, 0, 255, 255, 0, 0, 0, 64, 96, 128)
    expect(float16Pixels.data).toEqual(expectedFloat)
    expect(float64Pixels.data).toEqual(expectedFloat)
  })

  it('rejects DotRange for numeric CMYK samples', async () => {
    const input = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8, 8],
      compression: 1,
      photometric: 5,
      extraEntries: [
        { tag: 336, type: 3, values: [0, 255] },
        { tag: 339, type: 3, values: [2, 2, 2, 2] },
      ],
      strips: [signedPayload([0, 0, 0, 0], 8, true)],
    })

    await expect(decodeDirect(input)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })

  it('accepts bounded LZW padding in the final subsampled YCbCr strip', async () => {
    const firstStrip = Uint8Array.from([10, 20, 30, 40, 128, 128, 50, 60, 70, 80, 128, 128])
    const paddedLastStrip = Uint8Array.from([90, 100, 200, 200, 128, 128, 0, 0, 0, 0, 128, 128])
    const input = tiffFixture({
      width: 2,
      height: 5,
      bitsPerSample: [8, 8, 8],
      compression: 5,
      photometric: 6,
      rowsPerStrip: 4,
      extraEntries: [{ tag: 530, type: 3, values: [2, 2] }],
      strips: [
        packNineBitCodes([256, ...firstStrip, 257]),
        packNineBitCodes([256, ...paddedLastStrip, 257]),
      ],
    })

    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 4)).toEqual([90, 90, 90, 255])
    expect(pixel(decoded, 1, 4)).toEqual([100, 100, 100, 255])
  })

  it('matches independently encoded LZW CMYK, YCbCr, and 16-bit RGB fixtures', async () => {
    // ImageMagick 7.1.2/libtiff 4.7 encoded these fixtures independently.
    const cmyk = Buffer.from(
      'SUkqAHAAAACAJgSuxiAAAHA4QaFQuGQ2HQ+IRGJROKRWLACBQSDQiLx2PR+QSGIRmCweEyKUSmVSqSRuTyuYTGZQ+WyaZzecTCaxycz2fR2dy+f0OiQ2g0WkUmj0mmT+l02oTen1GqSup1WsSGAgABEAAAEDAAEAAAAQAAAAAQEDAAEAAAAMAAAAAgEDAAQAAABCAQAAAwEDAAEAAAAFAAAABgEDAAEAAAAFAAAACgEDAAEAAAABAAAAEQEEAAEAAAAIAAAAEgEDAAEAAAABAAAAFQEDAAEAAAAEAAAAFgEDAAEAAAAMAAAAFwEEAAEAAABnAAAAHAEDAAEAAAABAAAAKQEDAAIAAAAAAAEAPQEDAAEAAAACAAAAPgEFAAIAAAB6AQAAPwEFAAYAAABKAQAATAEDAAEAAAABAAAAAAAAABAAEAAQABAAhetRAAAAgADD9agAAAAAAs3MTAAAAAABzcxMAAAAgADNzEwAAAAAAo/C9QAAAAAQNxqgAAAAAAIrhwoAAAAgAA==',
      'base64',
    )
    const rgb16 = Buffer.from(
      'SUkqAJgAAACABIJDQaFYrACEQmFQuGQ2HQ+IRGJRJOCdEkM7F+JxuOR2PRwTD1vFJLmiPyeUSmJK8pDMxLc4yqZTOUjk0Ig4tc9TSeT2JMM+t1APhBz6jUeEk1JjNIBhG0ioT1rqhEJ8cpao1mZGFfN1XFlP1qxSd1NMZL48qix2uOHR0odmppY2y6RF/P5uNxdLq632GwEQAAABAwABAAAAEAAAAAEBAwABAAAADAAAAAIBAwADAAAAXgEAAAMBAwABAAAABQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAABEBBAABAAAACAAAABIBAwABAAAAAQAAABUBAwABAAAAAwAAABYBAwABAAAADAAAABcBBAABAAAAkAAAABwBAwABAAAAAQAAACkBAwACAAAAAAABAD0BAwABAAAAAgAAAD4BBQACAAAAlAEAAD8BBQAGAAAAZAEAAAAAAAAQABAAEACF61EAAACAAMP1qAAAAAACzcxMAAAAAAHNzEwAAACAAM3MTAAAAAACj8L1AAAAABA3GqAAAAAAAiuHCgAAACAA',
      'base64',
    )
    const ycbcr = Buffer.from(
      'SUkqAEwAAACAGhSomBQSBwWEQeFQaGQmGwuHRGIROHxWJRaKReNRmORiPRuPx2QSORSWQyeSSiTSmWSuXSqYS2Yy+ZTWaTeZzmHQEBAAAAEDAAEAAAAQAAAAAQEDAAEAAAAMAAAAAgEDAAMAAAASAQAAAwEDAAEAAAAFAAAABgEDAAEAAAAGAAAACgEDAAEAAAABAAAAEQEEAAEAAAAIAAAAEgEDAAEAAAABAAAAFQEDAAEAAAADAAAAFgEDAAEAAAAMAAAAFwEEAAEAAABEAAAAHAEDAAEAAAABAAAAKQEDAAIAAAAAAAEAPgEFAAIAAABIAQAAPwEFAAYAAAAYAQAAEgIDAAIAAAABAAEAAAAAAAgACAAIAIXrUQAAAIAAw/WoAAAAAALNzEwAAAAAAc3MTAAAAIAAzcxMAAAAAAKPwvUAAAAAEDcaoAAAAAACK4cKAAAAIAA=',
      'base64',
    )
    const cmykPixels = await decodedPng(cmyk)
    const rgb16Pixels = await decodedPng(rgb16)
    const ycbcrPixels = await decodedPng(ycbcr)

    expect(pixel(cmykPixels, 8, 6)).toEqual([122, 33, 143, 255])
    expect(pixel(rgb16Pixels, 0, 0)).toEqual([18, 52, 86, 255])
    expect(pixel(rgb16Pixels, 15, 11)).toEqual([254, 220, 186, 255])
    expect(pixel(ycbcrPixels, 8, 6)).toEqual([117, 85, 170, 255])
  })

  it('decodes complete old-style JPEG and abbreviated new-style JPEG segments', async () => {
    const rgba = Uint8Array.from([
      240, 20, 30, 255, 240, 20, 30, 255, 20, 210, 50, 255, 20, 210, 50, 255, 240, 20, 30, 255, 240,
      20, 30, 255, 20, 210, 50, 255, 20, 210, 50, 255,
    ])
    const encoded = jpeg.encode({ width: 4, height: 2, data: rgba }, 100).data
    const split = splitJpegTables(encoded)
    const oldParts = oldJpegFixtureParts(encoded)
    const oldStyle = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8],
      compression: 6,
      photometric: 6,
      strips: [],
      jpegInterchange: encoded,
    })
    const newStyle = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8],
      compression: 7,
      photometric: 6,
      extraEntries: [{ tag: 347, type: 7, values: Array.from(split.tables) }],
      strips: [split.image],
    })
    const oldStyleTables = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8],
      compression: 6,
      photometric: 6,
      extraEntries: [
        { tag: 512, type: 3, values: [1] },
        {
          tag: 530,
          type: 3,
          values: [oldParts.horizontalSubsampling, oldParts.verticalSubsampling],
        },
      ],
      pointedEntries: [
        { tag: 519, tables: oldParts.quantizationTables },
        { tag: 520, tables: oldParts.dcTables },
        { tag: 521, tables: oldParts.acTables },
      ],
      strips: [oldParts.entropy],
    })
    const oldPixels = await decodedPng(oldStyle)
    const newPixels = await decodedPng(newStyle)
    const tablePixels = await decodedPng(oldStyleTables)

    expect(newPixels.data).toEqual(oldPixels.data)
    expect(tablePixels.data).toEqual(oldPixels.data)
    expect(pixel(newPixels, 0, 0)[0]).toBeGreaterThan(220)
    expect(pixel(newPixels, 2, 0)[1]).toBeGreaterThan(190)
  })

  it('decodes Aperio JPEG2000 MCT and YCbCr TIFF tiles', async () => {
    const codestream = await readFile('tests/fixtures/aperio-33003-first-tile.j2k')
    expect(createHash('sha256').update(codestream).digest('hex')).toBe(
      aperioFixture.extraction.sha256,
    )
    const mct = tiffFixture({
      width: 17,
      height: 13,
      bitsPerSample: [8, 8, 8],
      compression: 33005,
      photometric: 2,
      tileWidth: 17,
      tileHeight: 13,
      strips: [await jp2CodestreamFixture()],
    })
    const ycbcr = tiffFixture({
      width: 256,
      height: 256,
      bitsPerSample: [8, 8, 8],
      compression: 33003,
      photometric: 2,
      tileWidth: 256,
      tileHeight: 256,
      extraEntries: [
        {
          tag: 270,
          type: 2,
          values: [
            ...new TextEncoder().encode('Aperio Image Library v12.4.0|AppMag = 20|MPP = 0.5'),
            0,
          ],
        },
      ],
      strips: [codestream],
    })
    const mctOutput = await decodeDirect(mct)
    const ycbcrOutput = await decodeDirect(ycbcr)
    expect(mctOutput.format).toBe('rgb8')
    expect(Array.from(mctOutput.data.subarray(0, 3))).toEqual([255, 0, 0])
    expect(Array.from(mctOutput.data.subarray(-3))).toEqual([0, 0, 255])
    expect(Array.from(ycbcrOutput.data.subarray(0, 3))).toEqual([255, 253, 255])
    const oracleBytes = await readFile('tests/fixtures/aperio-33003-first-tile-openslide.png')
    expect(createHash('sha256').update(oracleBytes).digest('hex')).toBe(aperioFixture.oracle.sha256)
    const oracle = PNG.sync.read(oracleBytes)
    let differingChannels = 0
    let maximumDifference = 0
    for (let pixelIndex = 0; pixelIndex < 256 * 256; pixelIndex += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const difference = Math.abs(
          (ycbcrOutput.data[pixelIndex * 3 + channel] ?? 0) -
            (oracle.data[pixelIndex * 4 + channel] ?? 0),
        )
        if (difference !== 0) differingChannels += 1
        maximumDifference = Math.max(maximumDifference, difference)
      }
    }
    expect({ maximumDifference, differingChannels }).toEqual({
      maximumDifference: aperioFixture.oracle.maximumChannelDifference,
      differingChannels: aperioFixture.oracle.differingChannels,
    })
    const slide = await openAperioSvs(await openTiffDocument(new MemorySource(ycbcr)))
    const slideBlocks: PixelBlock[] = []
    for await (const block of slide.readRegion({
      level: 0,
      x: 0,
      y: 0,
      width: 2,
      height: 1,
    })) {
      slideBlocks.push(block)
    }
    expect(Array.from(slideBlocks[0]?.data ?? [])).toEqual(
      Array.from(ycbcrOutput.data.subarray(0, 6)),
    )
    const midpoint = (6 * 17 + 8) * 3
    expect(Math.abs((mctOutput.data[midpoint] ?? 0) - 128)).toBeLessThanOrEqual(1)
    expect(mctOutput.data[midpoint + 1]).toBe(0)
    expect(Math.abs((mctOutput.data[midpoint + 2] ?? 0) - 128)).toBeLessThanOrEqual(1)
  })

  it('reconstructs legacy old-style JPEG strip boundaries and padded IFDs', async () => {
    const solidRgba = (red: number, green: number, blue: number): Uint8Array => {
      const output = new Uint8Array(4 * 2 * 4)
      for (let offset = 0; offset < output.byteLength; offset += 4) {
        output[offset] = red
        output[offset + 1] = green
        output[offset + 2] = blue
        output[offset + 3] = 255
      }
      return output
    }
    const topJpeg = jpeg.encode({ width: 4, height: 2, data: solidRgba(240, 20, 30) }, 100).data
    const bottomJpeg = jpeg.encode({ width: 4, height: 2, data: solidRgba(20, 40, 230) }, 100).data
    const top = oldJpegFixtureParts(topJpeg)
    const bottom = oldJpegFixtureParts(bottomJpeg)
    const scanOffset = topJpeg.byteLength - top.scan.byteLength - 2
    const commonEntries: readonly TiffEntryFixture[] = [
      { tag: 512, type: 3, values: [1] },
      {
        tag: 530,
        type: 3,
        values: [top.horizontalSubsampling, top.verticalSubsampling],
      },
    ]
    const commonTables = [
      { tag: 519, tables: top.quantizationTables },
      { tag: 520, tables: top.dcTables },
      { tag: 521, tables: top.acTables },
    ]
    const multiStrip = tiffFixture({
      width: 4,
      height: 4,
      bitsPerSample: [8, 8, 8],
      compression: 6,
      photometric: 6,
      rowsPerStrip: 2,
      extraEntries: commonEntries,
      pointedEntries: commonTables,
      strips: [top.scan, bottom.scan],
      jpegInterchange: topJpeg.slice(0, scanOffset),
    })
    const missingRowsPerStrip = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8],
      compression: 6,
      photometric: 6,
      extraEntries: commonEntries,
      pointedEntries: commonTables,
      strips: [top.entropy],
    })
    clearClassicTiffTag(missingRowsPerStrip, 278)
    clearClassicTiffTag(missingRowsPerStrip, 284)

    const malformedInterchange = Uint8Array.from(topJpeg)
    malformedInterchange[scanOffset + 11] = 0
    malformedInterchange[scanOffset + 12] = 0
    malformedInterchange[scanOffset + 13] = 0
    const malformedScan = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8],
      compression: 6,
      photometric: 6,
      extraEntries: commonEntries,
      pointedEntries: commonTables,
      strips: [top.entropy],
      jpegInterchange: malformedInterchange,
    })

    const multiPixels = await decodedPng(multiStrip)
    const missingRowsPixels = await decodedPng(missingRowsPerStrip)
    const malformedPixels = await decodedPng(malformedScan)
    const expectedTop = await decodedPng(topJpeg)

    expect(pixel(multiPixels, 0, 0)[0]).toBeGreaterThan(220)
    expect(pixel(multiPixels, 0, 3)[2]).toBeGreaterThan(210)
    expect(missingRowsPixels.data).toEqual(expectedTop.data)
    expect(malformedPixels.data).toEqual(expectedTop.data)
  })

  it('rejects corrupt BigTIFF, tile tables, JPEG tables, and Group 3 data as ImageErrors', async () => {
    const invalidBigTiff = bigTiffRgbFixture()
    new DataView(invalidBigTiff.buffer).setBigUint64(8, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)

    const incompleteTiles = tiffFixture({
      width: 2,
      height: 2,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      tileWidth: 2,
      tileHeight: 2,
      strips: [Uint8Array.of(1, 2, 3, 4)],
    })
    const oversizedTile = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      tileWidth: 0xffff_ffff,
      tileHeight: 1,
      strips: [Uint8Array.of(1)],
    })
    const tileView = new DataView(incompleteTiles.buffer)
    const tileEntryCount = tileView.getUint16(8, true)
    for (let index = 0; index < tileEntryCount; index += 1) {
      const offset = 10 + index * 12
      if (tileView.getUint16(offset, true) === 325) tileView.setUint16(offset, 326, true)
    }

    const encoded = jpeg.encode(
      { width: 1, height: 1, data: Uint8Array.of(20, 40, 60, 255) },
      90,
    ).data
    const split = splitJpegTables(encoded)
    const invalidJpegTables = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 7,
      photometric: 6,
      extraEntries: [{ tag: 347, type: 7, values: [1, 2, 3, 4] }],
      strips: [split.image],
    })
    const invalidGroup3 = tiffFixture({
      width: 8,
      height: 1,
      bitsPerSample: [1],
      compression: 3,
      photometric: 0,
      strips: [Uint8Array.of(0)],
    })

    await expect((await Image.open(invalidBigTiff)).metadata()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'INVALID_INPUT',
    })
    await expect((await Image.open(incompleteTiles)).metadata()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'INVALID_INPUT',
      message: 'TIFF tiled image is missing a required tile tag',
    })
    await expect((await Image.open(oversizedTile)).metadata()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'LIMIT_EXCEEDED',
      message: 'TIFF segment row is too large',
    })
    await expect((await Image.open(invalidJpegTables)).png().toBuffer()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'INVALID_INPUT',
      message: 'TIFF JPEGTables must be bounded by SOI and EOI markers',
    })
    await expect((await Image.open(invalidGroup3)).png().toBuffer()).rejects.toMatchObject({
      name: 'ImageError',
    })
  })

  it('decodes CCITT Modified Huffman and mixed one/two-dimensional Group 3 rows', async () => {
    const modifiedHuffman = tiffFixture({
      width: 8,
      height: 2,
      bitsPerSample: [1],
      compression: 2,
      photometric: 0,
      strips: [Uint8Array.of(0x98, 0x35, 0x14)],
    })
    const group3 = tiffFixture({
      width: 8,
      height: 2,
      bitsPerSample: [1],
      compression: 3,
      photometric: 0,
      t4Options: 1,
      strips: [packedFaxBits(`0000000000011${'10011'}00000000000101`)],
    })
    const modifiedPixels = await decodedPng(modifiedHuffman)
    const group3Pixels = await decodedPng(group3)

    expect(pixel(modifiedPixels, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(modifiedPixels, 7, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(modifiedPixels, 0, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(modifiedPixels, 7, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(group3Pixels, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(group3Pixels, 7, 1)).toEqual([255, 255, 255, 255])
  })

  it('decodes one-dimensional Group 3 rows without EOL markers', async () => {
    const input = tiffFixture({
      width: 8,
      height: 2,
      bitsPerSample: [1],
      compression: 3,
      photometric: 0,
      strips: [packedFaxBits('1001110011')],
    })

    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 7, 1)).toEqual([255, 255, 255, 255])
  })

  it('decodes independently encoded CCITT Group 4 fax strips', async () => {
    // ImageMagick 7.1.2/libtiff 4.7 encoded this 1728-pixel-wide bilevel fax fixture.
    const input = Buffer.from(
      'SUkqABgAAACRAGYLRblgEwGv8RgAgAgADQAAAQMAAQAAAMAGAAABAQMAAQAAAAQAAAACAQMAAQAAAAEAAAADAQMAAQAAAAQAAAAGAQMAAQAAAAAAAAAKAQMAAQAAAAEAAAARAQQAAQAAAAgAAAASAQMAAQAAAAEAAAAVAQMAAQAAAAEAAAAWAQMAAQAAAAQAAAAXAQQAAQAAAA8AAAAcAQMAAQAAAAEAAAApAQMAAgAAAAAAAQAAAAAA',
      'base64',
    )
    const image = await Image.open(input)

    await expect(image.metadata()).resolves.toMatchObject({
      format: 'tiff',
      width: 1728,
      height: 4,
      bitDepth: 1,
      hasAlpha: false,
    })
    const decoded = await decodedPng(input)
    expect(pixel(decoded, 700, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 19, 1)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 20, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 400, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 401, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 699, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 700, 2)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 1500, 2)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 1501, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 1200, 3)).toEqual([255, 255, 255, 255])
  })

  it('resets CCITT Group 4 references per strip and honors FillOrder 2', async () => {
    // This four-row strip was independently encoded by ImageMagick/libtiff.
    const strip = Buffer.from('lxecB/wAQAQ=', 'base64')
    const input = tiffFixture({
      width: 32,
      height: 8,
      bitsPerSample: [1],
      compression: 4,
      photometric: 0,
      fillOrder: 2,
      rowsPerStrip: 4,
      strips: [reverseByteBits(strip), reverseByteBits(strip)],
    })
    const decoded = await decodedPng(input)

    for (let row = 0; row < 8; row += 1) {
      const stripRow = row & 3
      for (let x = 0; x < 32; x += 1) {
        const black = (stripRow >= 1 && x >= 2 && x <= 9) || (stripRow >= 2 && x >= 15 && x <= 28)
        expect(pixel(decoded, x, row)).toEqual(black ? [0, 0, 0, 255] : [255, 255, 255, 255])
      }
    }
  })

  it('rejects corrupt and unsupported CCITT Group 4 streams as ImageErrors', async () => {
    const corrupt = tiffFixture({
      width: 8,
      height: 1,
      bitsPerSample: [1],
      compression: 4,
      photometric: 0,
      strips: [Uint8Array.of(0)],
    })
    const unsupportedMode = tiffFixture({
      width: 8,
      height: 1,
      bitsPerSample: [1],
      compression: 4,
      photometric: 0,
      t6Options: 2,
      strips: [Uint8Array.of(0x03, 0x80)],
    })

    await expect((await Image.open(corrupt)).png().toBuffer()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'INVALID_INPUT',
    })
    await expect((await Image.open(unsupportedMode)).png().toBuffer()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'UNSUPPORTED_OPERATION',
      message: 'TIFF CCITT Group 4 uncompressed mode is unsupported',
    })
  })

  it('encodes canonical Deflate-predicted RGB and RGBA strip TIFF output', async () => {
    const source = new PNG({ width: 2, height: 1 })
    source.data.set([10, 20, 30, 255, 70, 80, 90, 0])
    const png = PNG.sync.write(source)

    const rgba = await (await Image.open(png)).tiff().toBuffer()
    expect(rgba.subarray(0, 4)).toEqual(Buffer.from([0x49, 0x49, 0x2a, 0]))
    expect(classicTiffValues(rgba, 258)).toEqual([8, 8, 8, 8])
    expect(classicTiffValues(rgba, 259)).toEqual([8])
    expect(classicTiffValues(rgba, 262)).toEqual([2])
    expect(classicTiffValues(rgba, 277)).toEqual([4])
    expect(classicTiffValues(rgba, 284)).toEqual([1])
    expect(classicTiffValues(rgba, 317)).toEqual([2])
    expect(classicTiffValues(rgba, 338)).toEqual([2])
    await expect((await Image.open(rgba)).metadata()).resolves.toMatchObject({
      format: 'tiff',
      width: 2,
      height: 1,
      hasAlpha: true,
    })
    const rgbaRoundTrip = await decodeDirect(rgba)
    expect(rgbaRoundTrip.format).toBe('rgba8')
    expect(Array.from(rgbaRoundTrip.data)).toEqual(Array.from(source.data))

    const viaEncode = await (await Image.open(png))
      .encode('tiff', {
        compression: 'deflate',
        predictor: 'horizontal',
        layout: 'strips',
        compressionLevel: 6,
      })
      .toBuffer()
    expect(viaEncode).toEqual(rgba)

    const rgbPixels = Uint8Array.from([12, 34, 56, 210, 45, 90])
    const rgbSource = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      strips: [rgbPixels],
    })
    const rgb = await (await Image.open(rgbSource)).tiff({ compressionLevel: 9 }).toBuffer()
    expect(classicTiffValues(rgb, 258)).toEqual([8, 8, 8])
    expect(classicTiffValues(rgb, 277)).toEqual([3])
    await expect((await Image.open(rgb)).metadata()).resolves.toMatchObject({ hasAlpha: false })
    const rgbRoundTrip = await decodeDirect(rgb)
    expect(rgbRoundTrip.format).toBe('rgb8')
    expect(rgbRoundTrip.data).toEqual(rgbPixels)
  })

  it('encodes tiled RGB and RGBA BigTIFF output with padded edge tiles', async () => {
    const source = new PNG({ width: 19, height: 17 })
    for (let index = 0; index < source.data.length; index += 4) {
      source.data[index] = index & 0xff
      source.data[index + 1] = (index * 3) & 0xff
      source.data[index + 2] = (index * 7) & 0xff
      source.data[index + 3] = index % 12 === 0 ? 64 : 255
    }
    const png = PNG.sync.write(source)
    const output = await (await Image.open(png))
      .tiff({
        layout: 'tiles',
        tileWidth: 16,
        tileHeight: 16,
        format: 'bigtiff',
      })
      .toBuffer()
    expect(Array.from(output.subarray(0, 8))).toEqual([0x49, 0x49, 43, 0, 8, 0, 0, 0])
    const document = await openTiffDocument(new MemorySource(output))
    expect(document.bigTiff).toBe(true)
    expect(document.getDirectory(0)).toMatchObject({
      tiled: true,
      tileWidth: 16,
      tileHeight: 16,
    })
    const decoded = await decodeDirect(output)
    expect(decoded.format).toBe('rgba8')
    const rendered = PNG.sync.read(await (await Image.open(output)).png().toBuffer())
    expect(rendered.data).toEqual(source.data)
    const oracleFile = await openGeoTiffOracle(output.slice().buffer)
    const oracleImage = await oracleFile.getImage()
    expect([oracleImage.getWidth(), oracleImage.getHeight()]).toEqual([19, 17])
    const oraclePixels = await oracleImage.readRasters({ interleave: true })
    if (!(oraclePixels instanceof Uint8Array)) {
      throw new Error('Expected independent TIFF oracle to return interleaved bytes')
    }
    expect(oraclePixels.byteLength).toBe(source.data.byteLength)
    expect(createHash('sha256').update(oraclePixels).digest('hex')).toBe(
      createHash('sha256').update(source.data).digest('hex'),
    )
  })

  it('writes multi-page TIFF with reduced-resolution SubIFD pyramids', async () => {
    const blocks = (
      width: number,
      height: number,
      format: 'rgb8' | 'rgba8',
      data: Uint8Array,
    ): AsyncIterable<PixelBlock> => ({
      async *[Symbol.asyncIterator]() {
        yield {
          x: 0,
          y: 0,
          width,
          height,
          stride: width * (format === 'rgb8' ? 3 : 4),
          format,
          data,
        }
      },
    })
    const first = Uint8Array.of(1, 2, 3, 4, 5, 6)
    const reduced = Uint8Array.of(7, 8, 9)
    const second = Uint8Array.of(10, 11, 12, 13)
    const sink = new Uint8ArraySink()
    await encodeTiffDocument(sink, {
      runtime: nodeRuntime,
      options: { rowsPerStrip: 1, format: 'classic' },
      pages: [
        {
          width: 2,
          height: 1,
          pixelFormat: 'rgb8',
          blocks: blocks(2, 1, 'rgb8', first),
          reducedImages: [
            {
              width: 1,
              height: 1,
              pixelFormat: 'rgb8',
              blocks: blocks(1, 1, 'rgb8', reduced),
            },
          ],
        },
        {
          width: 1,
          height: 1,
          pixelFormat: 'rgba8',
          blocks: blocks(1, 1, 'rgba8', second),
        },
      ],
    })
    const output = sink.toUint8Array()
    const document = await openTiffDocument(new MemorySource(output))
    expect(document.topLevelDirectories).toHaveLength(2)
    expect(document.directories).toHaveLength(3)
    expect(document.topLevelDirectories[0]?.subIfds).toHaveLength(1)
    await expect(document.topLevelDirectories[0]?.subIfds[0]?.getTag(254)).resolves.toMatchObject({
      kind: 'numbers',
      values: [1],
    })

    const decodeDirectory = async (index: number): Promise<Uint8Array> => {
      const decoder = await document.getDirectory(index)?.createImageDecoder()
      if (!decoder) throw new Error(`TIFF directory ${index} decoder is missing`)
      const decoded = await decoder.decode()
      const chunks: Uint8Array[] = []
      for await (const block of decoded) chunks.push(block.data)
      return Uint8Array.from(chunks.flatMap((chunk) => Array.from(chunk)))
    }
    expect(await decodeDirectory(0)).toEqual(first)
    expect(await decodeDirectory(1)).toEqual(second)
    expect(await decodeDirectory(2)).toEqual(reduced)
    const oracleFile = await openGeoTiffOracle(output.slice().buffer)
    expect(await oracleFile.getImageCount()).toBe(2)
    const oracleFirst = await oracleFile.getImage(0)
    const oracleSecond = await oracleFile.getImage(1)
    const oracleFirstPixels = await oracleFirst.readRasters({ interleave: true })
    const oracleSecondPixels = await oracleSecond.readRasters({ interleave: true })
    if (!(oracleFirstPixels instanceof Uint8Array) || !(oracleSecondPixels instanceof Uint8Array)) {
      throw new Error('Expected independent multi-page TIFF oracle byte output')
    }
    expect(Array.from(oracleFirstPixels)).toEqual(Array.from(first))
    expect(Array.from(oracleSecondPixels)).toEqual(Array.from(second))
  })

  it('encodes bounded independently compressed strips without full-frame raw staging', async () => {
    const width = 1024
    const height = 100
    const rowBytes = width * 3
    const pixels = new Uint8Array(rowBytes * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = y * rowBytes + x * 3
        pixels[offset] = x & 0xff
        pixels[offset + 1] = y & 0xff
        pixels[offset + 2] = (x + y) & 0xff
      }
    }
    const source = tiffFixture({
      width,
      height,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      rowsPerStrip: height,
      strips: [pixels],
    })
    const output = await (await Image.open(source)).tiff().toBuffer()
    const rowsPerStrip = classicTiffValues(output, 278)[0]
    const stripOffsets = classicTiffValues(output, 273)
    const stripByteCounts = classicTiffValues(output, 279)
    expect(rowsPerStrip).toBe(42)
    expect((rowsPerStrip ?? 0) * rowBytes).toBeGreaterThanOrEqual(64 * 1024)
    expect((rowsPerStrip ?? 0) * rowBytes).toBeLessThanOrEqual(256 * 1024)
    expect(stripOffsets).toHaveLength(3)
    expect(stripByteCounts).toHaveLength(3)
    expect(stripByteCounts.every((bytes) => bytes > 0)).toBe(true)
    expect(output.byteLength).toBeLessThan(source.byteLength)
    const decoded = await decodeDirect(output)
    expect(decoded.format).toBe('rgb8')
    expect(decoded.data).toEqual(pixels)
  })

  it('rejects pixels and TIFF strategies outside the canonical encoding profile', async () => {
    const graySource = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      strips: [Uint8Array.from([25, 200])],
    })
    await expect((await Image.open(graySource)).tiff().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'TIFF encoding supports only 8-bit RGB or RGBA pixels, not gray8',
    })

    const createEncoder = tiffCodec.createEncoder
    if (!createEncoder) throw new Error('TIFF encoder is unavailable')
    for (const options of [{ compression: 'lzw' }, { predictor: 'none' }, { layout: 'planar' }]) {
      await expect(
        createEncoder(new Uint8ArraySink(), {
          width: 1,
          height: 1,
          pixelFormat: 'rgb8',
          options,
          runtime: nodeRuntime,
        }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    }
    expect(() => createTiffEncodeOperation({ compressionLevel: -1 })).toThrow(
      'TIFF compressionLevel must be an integer from 0 to 9',
    )
    expect(() => createTiffEncodeOperation({ compressionLevel: 10 })).toThrow(
      'TIFF compressionLevel must be an integer from 0 to 9',
    )
  })

  it('rejects invalid IFDs, truncated strips, unsupported compression, and expansion overruns', async () => {
    const invalidIfd = Uint8Array.from([0x49, 0x49, 0x2a, 0, 0xf0, 0xff, 0xff, 0xff])
    await expect((await Image.open(invalidIfd)).metadata()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })

    const unsupported = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8],
      compression: 999,
      photometric: 1,
      strips: [Uint8Array.of(0)],
    })
    await expect((await Image.open(unsupported)).png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })

    const overrun = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8],
      compression: 32773,
      photometric: 1,
      strips: [Uint8Array.from([2, 1, 2, 3])],
    })
    await expect((await Image.open(overrun)).png().toBuffer()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })

    const truncated = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      strips: [Uint8Array.of(10)],
    }).subarray(0, -1)
    await expect((await Image.open(truncated)).png().toBuffer()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
  })
})

describe('TIFF document and scientific raster API', () => {
  it('inspects bounded public tags and decodes chunky five-channel uint16 samples', async () => {
    const samples = [0, 1, 255, 256, 65_535, 500, 600, 700, 800, 900]
    const strip = new Uint8Array(samples.length * 2)
    const stripView = new DataView(strip.buffer)
    for (let index = 0; index < samples.length; index += 1) {
      stripView.setUint16(index * 2, samples[index] ?? 0, true)
    }
    const description = new TextEncoder().encode('<science channels="5"/>')
    const fixture = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [16, 16, 16, 16, 16],
      compression: 1,
      photometric: 1,
      strips: [strip],
      extraEntries: [
        { tag: 270, type: 2, values: [...description, 0] },
        { tag: 339, type: 3, values: [1, 1, 1, 1, 1] },
      ],
    })
    const document = await openTiffDocument(new MemorySource(fixture))
    const directory = document.getDirectory(0)
    expect(document).toMatchObject({ littleEndian: true, bigTiff: false })
    expect(directory).toMatchObject({
      width: 2,
      height: 1,
      compression: 1,
      photometric: 1,
      samplesPerPixel: 5,
      bitsPerSample: [16, 16, 16, 16, 16],
      sampleFormats: [1, 1, 1, 1, 1],
      planar: false,
    })
    await expect(directory?.getTag(270)).resolves.toEqual({
      kind: 'ascii',
      value: '<science channels="5"/>',
    })
    const decoder = await directory?.createRasterDecoder()
    const blocks = []
    if (!decoder) throw new Error('Raster decoder is missing')
    for await (const block of decoder.decode()) blocks.push(block)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.format).toEqual({ sampleType: 'uint16', channels: 5, planar: false })
    const output = blocks[0]?.data
    if (!output) throw new Error('Raster output is missing')
    const outputView = new DataView(output.buffer, output.byteOffset, output.byteLength)
    expect(samples.map((_, index) => outputView.getUint16(index * 2, false))).toEqual(samples)
  })

  it('exposes directory offsets, bounded source reads, and cached immutable tags', async () => {
    const descriptionBytes = [...new TextEncoder().encode('cached profile metadata'), 0]
    const privateBytes = [9, 8, 7, 6, 5, 4]
    const fixture = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      strips: [Uint8Array.of(42)],
      extraEntries: [
        { tag: 270, type: 2, values: descriptionBytes },
        { tag: 65_000, type: 7, values: privateBytes },
      ],
    })
    let reads = 0
    const source: ImageSource = {
      size: fixture.byteLength,
      async read(offset, length) {
        reads += 1
        return fixture.subarray(offset, Math.min(offset + length, fixture.byteLength))
      },
    }
    const document = await openTiffDocument(source)
    const directory = document.getDirectory(0)
    if (!directory) throw new Error('TIFF directory is missing')
    expect(directory.offset).toBe(8)
    expect(document.getDirectoryByOffset(directory.offset)).toBe(directory)
    expect(document.getDirectoryByOffset(-1)).toBeUndefined()

    const description = await directory.getTag(270, { maxBytes: 64 })
    expect(description).toEqual({ kind: 'ascii', value: 'cached profile metadata' })
    expect(Object.isFrozen(description)).toBe(true)
    const readsAfterDescription = reads
    await expect(directory.getTag(270, { maxBytes: 4 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    expect(await directory.getTag(270, { maxBytes: 64 })).toBe(description)
    expect(reads).toBe(readsAfterDescription)

    const firstPrivate = await directory.getTag(65_000, { maxBytes: 6 })
    if (firstPrivate?.kind !== 'bytes') throw new Error('Private TIFF tag is missing')
    firstPrivate.value[0] = 0
    const readsAfterPrivate = reads
    await expect(directory.getTag(65_000, { maxBytes: 5 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    const secondPrivate = await directory.getTag(65_000, { maxBytes: 6 })
    expect(secondPrivate).toEqual({ kind: 'bytes', value: Uint8Array.from(privateBytes) })
    expect(secondPrivate).not.toBe(firstPrivate)
    expect(reads).toBe(readsAfterPrivate)

    const header = await document.readBytes(0, 4, { maxBytes: 4 })
    expect(Array.from(header)).toEqual([0x49, 0x49, 0x2a, 0])
    header[0] = 0
    await expect(document.readBytes(0, 5, { maxBytes: 4 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(
      document.readBytes(fixture.byteLength - 1, 2, { maxBytes: 2 }),
    ).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })
    expect(Array.from(await document.readBytes(0, 4, { maxBytes: 4 }))).toEqual([
      0x49, 0x49, 0x2a, 0,
    ])
  })

  it('resolves parsed SubIFD directories by their absolute offsets', async () => {
    const fixture = tiffGraphFixture([
      { width: 2, height: 2, pixels: Uint8Array.of(1, 2, 3, 4), subIfds: [1] },
      { width: 1, height: 1, pixels: Uint8Array.of(5) },
    ])
    const document = await openTiffDocument(new MemorySource(fixture))
    const parent = document.topLevelDirectories[0]
    const child = parent?.subIfds[0]
    if (!parent || !child) throw new Error('TIFF SubIFD graph is missing')
    expect(document.getDirectoryByOffset(parent.offset)).toBe(parent)
    expect(document.getDirectoryByOffset(child.offset)).toBe(child)
  })

  it('preserves planar float32 channels and validates tag read bounds', async () => {
    const planes = [
      new Float32Array([0.25, 0.5]),
      new Float32Array([0.75, 1]),
      new Float32Array([-1, 2]),
    ].map((values) => {
      const bytes = new Uint8Array(values.length * 4)
      const view = new DataView(bytes.buffer)
      for (let index = 0; index < values.length; index += 1) {
        view.setFloat32(index * 4, values[index] ?? 0, true)
      }
      return bytes
    })
    const fixture = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [32, 32, 32],
      compression: 1,
      photometric: 1,
      planarConfiguration: 2,
      strips: planes,
      extraEntries: [
        { tag: 270, type: 2, values: [...new TextEncoder().encode('bounded tag'), 0] },
        { tag: 339, type: 3, values: [3, 3, 3] },
      ],
    })
    const document = await openTiffDocument(new MemorySource(fixture))
    const directory = document.getDirectory(0)
    await expect(directory?.getTag(270, { maxBytes: 4 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    const decoder = await directory?.createRasterDecoder()
    if (!decoder) throw new Error('Raster decoder is missing')
    const blocks = []
    for await (const block of decoder.decode({ x: 1, y: 0, width: 1, height: 1 })) {
      blocks.push(block)
    }
    expect(blocks[0]?.format).toEqual({ sampleType: 'float32', channels: 3, planar: true })
    expect(blocks[0]?.planeStride).toBe(4)
    const output = blocks[0]?.data
    if (!output) throw new Error('Raster output is missing')
    const outputView = new DataView(output.buffer, output.byteOffset, output.byteLength)
    expect([0, 4, 8].map((offset) => outputView.getFloat32(offset, false))).toEqual([0.5, 1, 2])
  })

  it('keeps public directory region decode bounded to intersecting strips', async () => {
    const fixture = tiffFixture({
      width: 2,
      height: 2,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      rowsPerStrip: 1,
      strips: [Uint8Array.of(1, 2), Uint8Array.of(3, 4)],
    })
    const pixelOffset = fixture.byteLength - 4
    const touchedStrips = new Set<number>()
    const source: ImageSource = {
      size: fixture.byteLength,
      async read(offset, length) {
        const end = Math.min(offset + length, fixture.byteLength)
        if (offset < pixelOffset + 2 && end > pixelOffset) touchedStrips.add(0)
        if (offset < pixelOffset + 4 && end > pixelOffset + 2) touchedStrips.add(1)
        return fixture.subarray(offset, end)
      },
    }
    const document = await openTiffDocument(source)
    const decoder = await document.getDirectory(0)?.createRasterDecoder()
    if (!decoder) throw new Error('Raster decoder is missing')
    const blocks = []
    for await (const block of decoder.decode({ y: 1, height: 1 })) blocks.push(block)
    expect(touchedStrips).toEqual(new Set([1]))
    expect(Array.from(blocks[0]?.data ?? [])).toEqual([3, 4])
  })
})

describe('GeoTIFF metadata profile', () => {
  it('decodes GeoKeys, affine coordinates, GDAL metadata, and nodata', async () => {
    const geoAscii = new TextEncoder().encode('WGS 84|')
    const gdalXml = new TextEncoder().encode(
      '<GDALMetadata><Item name="STATISTICS_MINIMUM" sample="0" role="minimum">1.5</Item></GDALMetadata>',
    )
    const fixture = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      strips: [Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)],
      extraEntries: [
        { tag: 33_550, type: 12, values: [10, 20, 0] },
        { tag: 33_922, type: 12, values: [0, 0, 0, 100, 200, 0] },
        {
          tag: 34_735,
          type: 3,
          values: [
            1,
            1,
            0,
            4,
            1_024,
            0,
            1,
            2,
            1_025,
            0,
            1,
            1,
            2_048,
            0,
            1,
            4_326,
            2_049,
            34_737,
            geoAscii.byteLength,
            0,
          ],
        },
        { tag: 34_737, type: 2, values: [...geoAscii, 0] },
        { tag: 42_112, type: 2, values: [...gdalXml, 0] },
        { tag: 42_113, type: 2, values: [...new TextEncoder().encode('-9999'), 0] },
      ],
    })
    const document = await openTiffDocument(new MemorySource(fixture))
    expect(await geoTiffProfile.detect({ document })).toBe(true)
    const profile = await geoTiffProfile.open({ document })
    expect({
      modelType: profile.modelType,
      rasterType: profile.rasterType,
      geographicCrs: profile.geographicCrs,
      citation: profile.citation,
      origin: profile.origin,
      resolution: profile.resolution,
      boundingBox: profile.boundingBox,
      noData: profile.noData,
      metadata: profile.gdalMetadata,
    }).toEqual({
      modelType: 2,
      rasterType: 'pixel-is-area',
      geographicCrs: 4_326,
      citation: 'WGS 84',
      origin: { x: 100, y: 200, z: 0 },
      resolution: { x: 10, y: -20, z: 0 },
      boundingBox: { minX: 100, minY: 160, maxX: 140, maxY: 200 },
      noData: -9_999,
      metadata: [{ name: 'STATISTICS_MINIMUM', value: '1.5', sample: 0, role: 'minimum' }],
    })
    expect(profile.model?.kind).toBe('tiepoint-scale')
    expect(profile.model?.pixelToModel(2, 1)).toEqual({ x: 120, y: 180, z: 0 })
    const oracleFile = await openGeoTiffOracle(fixture.slice().buffer)
    const oracleImage = await oracleFile.getImage()
    expect(profile.origin && [profile.origin.x, profile.origin.y, profile.origin.z]).toEqual(
      oracleImage.getOrigin(),
    )
    expect(
      profile.resolution && [profile.resolution.x, profile.resolution.y, profile.resolution.z],
    ).toEqual(oracleImage.getResolution())
    expect(
      profile.boundingBox && [
        profile.boundingBox.minX,
        profile.boundingBox.minY,
        profile.boundingBox.maxX,
        profile.boundingBox.maxY,
      ],
    ).toEqual(oracleImage.getBoundingBox())
    expect(profile.geographicCrs).toBe(oracleImage.getGeoKeys()?.GeographicTypeGeoKey)
  })

  it('keeps arbitrary five-band GeoTIFF samples available through the raster API', async () => {
    const fixture = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8, 8, 8, 8, 8],
      compression: 1,
      photometric: 1,
      strips: [Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)],
      extraEntries: [{ tag: 34_735, type: 3, values: [1, 1, 0, 1, 1_024, 0, 1, 1] }],
    })
    const document = await openTiffDocument(new MemorySource(fixture))
    const decoder = await document.getDirectory(0)?.createRasterDecoder()
    if (!decoder) throw new Error('GeoTIFF raster decoder is missing')
    const blocks: RasterBlock[] = []
    for await (const block of decoder.decode()) blocks.push(block)
    expect(blocks[0]?.format).toEqual({ sampleType: 'uint8', channels: 5, planar: false })
    expect(Array.from(blocks[0]?.data ?? [])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('OME-TIFF scientific semantics', () => {
  const omeFixture = (xml: string): Uint8Array =>
    tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      strips: [Uint8Array.of(10, 20, 30, 40, 50, 60)],
      extraEntries: [{ tag: 270, type: 2, values: [...new TextEncoder().encode(xml), 0] }],
    })

  it('maps an interleaved XYC OME plane to selected planar raster channels', async () => {
    const input = omeFixture(`<?xml version="1.0"?>
<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels ID="Pixels:0" DimensionOrder="XYCZT" Type="uint8"
      SizeX="2" SizeY="1" SizeZ="1" SizeC="3" SizeT="1"
      PhysicalSizeX="0.25" PhysicalSizeXUnit="µm">
      <Channel ID="Channel:0" Name="RGB" SamplesPerPixel="3"/>
      <TiffData IFD="0" PlaneCount="1"/>
    </Pixels>
  </Image>
</OME>`)
    const document = await openTiffDocument(new MemorySource(input))
    expect(await isOmeTiff(document)).toBe(true)
    const dataset = await openOmeTiff(document)
    expect({
      dimensions: [dataset.sizeX, dataset.sizeY, dataset.sizeZ, dataset.sizeC, dataset.sizeT],
      type: dataset.sampleType,
      order: dataset.dimensionOrder,
      physicalX: dataset.physicalSizeX,
      channel: dataset.channels[0],
    }).toEqual({
      dimensions: [2, 1, 1, 3, 1],
      type: 'uint8',
      order: 'XYCZT',
      physicalX: { value: 0.25, unit: 'µm' },
      channel: { id: 'Channel:0', name: 'RGB', samplesPerPixel: 3 },
    })
    const blocks: RasterBlock[] = []
    for await (const block of dataset.readPlane({ z: 0, c: [2, 0], t: 0 })) blocks.push(block)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.format).toEqual({ sampleType: 'uint8', channels: 2, planar: true })
    expect(Array.from(blocks[0]?.data ?? [])).toEqual([30, 60, 10, 40])
  })

  it('maps multidimensional TiffData planes and reduced-resolution SubIFDs', async () => {
    const xml = `<OME><Image><Pixels DimensionOrder="XYZCT" Type="uint8"
      SizeX="1" SizeY="1" SizeZ="2" SizeC="2" SizeT="1">
      <Channel ID="Channel:0" SamplesPerPixel="1"/>
      <Channel ID="Channel:1" SamplesPerPixel="1"/>
      <TiffData IFD="0" FirstZ="0" FirstC="0" FirstT="0" PlaneCount="4"/>
    </Pixels></Image></OME>`
    const input = tiffGraphFixture([
      {
        width: 1,
        height: 1,
        pixels: Uint8Array.of(10),
        imageDescription: xml,
        subIfds: [4],
        next: 1,
      },
      { width: 1, height: 1, pixels: Uint8Array.of(20), next: 2 },
      { width: 1, height: 1, pixels: Uint8Array.of(30), next: 3 },
      { width: 1, height: 1, pixels: Uint8Array.of(40) },
      { width: 1, height: 1, pixels: Uint8Array.of(99), newSubfileType: 1 },
    ])
    const document = await openTiffDocument(new MemorySource(input))
    expect(document.topLevelDirectories).toHaveLength(4)
    expect(document.directories).toHaveLength(5)
    const dataset = await openOmeTiff(document)
    const selected: RasterBlock[] = []
    for await (const block of dataset.readPlane({ z: 1, c: [1, 0], t: 0 })) {
      selected.push(block)
    }
    expect(Array.from(selected[0]?.data ?? [])).toEqual([40, 20])

    const reduced: RasterBlock[] = []
    for await (const block of dataset.readPlane({
      z: 0,
      c: 0,
      t: 0,
      resolutionLevel: 1,
    })) {
      reduced.push(block)
    }
    expect(Array.from(reduced[0]?.data ?? [])).toEqual([99])
  })
  it('rejects unsafe XML and incomplete OME plane mappings', async () => {
    const unsafe = omeFixture(
      '<!DOCTYPE OME [<!ENTITY x SYSTEM "file:///etc/passwd">]><OME>&x;</OME>',
    )
    const unsafeDocument = await openTiffDocument(new MemorySource(unsafe))
    await expect(openOmeTiff(unsafeDocument)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    const incomplete = omeFixture(`<OME>
      <Image><Pixels DimensionOrder="XYZCT" Type="uint8"
        SizeX="2" SizeY="1" SizeZ="2" SizeC="1" SizeT="1">
        <Channel SamplesPerPixel="1"/>
        <TiffData IFD="0" FirstZ="0" PlaneCount="1"/>
      </Pixels></Image>
    </OME>`)
    const incompleteDocument = await openTiffDocument(new MemorySource(incomplete))
    await expect(openOmeTiff(incompleteDocument)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('isolates detector failures and rejects equal-priority profile conflicts', async () => {
    const input = omeFixture(`<OME><Image><Pixels DimensionOrder="XYCZT" Type="uint8"
      SizeX="2" SizeY="1" SizeZ="1" SizeC="3" SizeT="1">
      <Channel SamplesPerPixel="3"/><TiffData/>
    </Pixels></Image></OME>`)
    const document = await openTiffDocument(new MemorySource(input))
    const broken = {
      id: 'broken-vendor',
      priority: 200,
      detect: (): boolean => {
        throw new Error('malformed private metadata')
      },
      open: (): never => {
        throw new Error('unreachable')
      },
    } as const
    const registry = createTiffProfileRegistry([broken, omeTiffProfile])
    const result = await registry.open(document)
    expect(result?.profileId).toBe('ome-tiff')
    expect(result?.detectionFailures.map((failure) => failure.id)).toEqual(['broken-vendor'])
    const typedDataset = await registry.openWith(document, omeTiffProfile)
    expect(typedDataset.sizeX).toBe(2)

    const conflict = createTiffProfileRegistry([
      omeTiffProfile,
      {
        id: 'other-ome',
        priority: 100,
        detect: (): boolean => true,
        open: (): string => 'other',
      },
    ])
    await expect(conflict.open(document)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})

describe('Aperio whole-slide profile', () => {
  it('discovers pyramid levels, properties, associated images, and bounded regions', async () => {
    const mainPixels = new Uint8Array(64)
    mainPixels.fill(11)
    const levelPixels = new Uint8Array(16)
    levelPixels.fill(22)
    const input = tiffGraphFixture([
      {
        width: 8,
        height: 8,
        pixels: mainPixels,
        tiled: true,
        imageDescription: 'Aperio Image Library v12.4.0|AppMag = 40|MPP = 0.25',
        next: 1,
      },
      {
        width: 4,
        height: 4,
        pixels: levelPixels,
        tiled: true,
        newSubfileType: 1,
        next: 2,
      },
      {
        width: 2,
        height: 1,
        pixels: Uint8Array.of(7, 8),
        imageDescription: 'Aperio label image',
      },
    ])
    const document = await openTiffDocument(new MemorySource(input))
    expect(await isAperioSvs(document)).toBe(true)
    const slide = await openAperioSvs(document)
    expect({
      size: [slide.width, slide.height],
      levels: slide.levels,
      associated: slide.associatedImages.map((image) => image.id),
      mpp: slide.micronsPerPixel,
      power: slide.objectivePower,
    }).toEqual({
      size: [8, 8],
      levels: [
        { index: 0, width: 8, height: 8, downsample: 1, tileWidth: 8, tileHeight: 8 },
        { index: 1, width: 4, height: 4, downsample: 2, tileWidth: 4, tileHeight: 4 },
      ],
      associated: ['label'],
      mpp: 0.25,
      power: 40,
    })
    const region: PixelBlock[] = []
    for await (const block of slide.readRegion({
      level: 1,
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    })) {
      region.push(block)
    }
    expect(region.map((block) => Array.from(block.data))).toEqual([[22, 22, 22, 22]])
    const label: PixelBlock[] = []
    for await (const block of slide.associatedImages[0]?.read() ?? []) label.push(block)
    expect(Array.from(label[0]?.data ?? [])).toEqual([7, 8])
  })
})
