import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import manifest from '../benchmark/jpegxl/jpeg-reconstruction-manifest.json' with { type: 'json' }
import { inspectJpegXlSource } from '../src/codecs/jpegxl-container.ts'
import { parseJpegCoefficientImage } from '../src/codecs/jpeg-coefficients.ts'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { reconstructJpegFromCoefficientImage } from '../src/codecs/jpegxl-jpeg-reconstruct.ts'
import {
  decodeJpegXlJpegReconstructionBlobs,
  parseJpegXlJpegReconstructionHeader,
} from '../src/codecs/jpegxl-jpeg-reconstruction.ts'
import { encodeUncompressedBrotli } from '../src/codecs/brotli.ts'
import { resolveJpegXlLimits } from '../src/codecs/jpegxl-limits.ts'
import { inspectJpegXl } from '../src/jpegxl.ts'
import { MemorySource } from '../src/source.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { reconstructJpegFromJpegXl } from '../src/jpegxl.ts'
import { Uint8ArraySink } from '../src/sink.ts'

const primaryEntry = manifest.fixtures[0]
if (!primaryEntry) throw new Error('Pinned JPEG reconstruction manifest is empty')
const fixture = new Uint8Array(readFileSync(primaryEntry.jxl))

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const decodeRgb = async (
  codec: typeof jpegCodec | typeof jpegxlCodec,
  input: Uint8Array,
): Promise<Uint8Array> => {
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error(`${codec.format} decoder is unavailable`)
  const output = new Uint8Array(decoder.width * decoder.height * 3)
  for await (const block of decoder.decode()) {
    if (block.format !== 'rgb8') throw new Error(`${codec.format} decoder did not return RGB8`)
    for (let row = 0; row < block.height; row += 1) {
      const sourceStart = row * block.stride
      output.set(
        block.data.subarray(sourceStart, sourceStart + block.width * 3),
        ((block.y + row) * decoder.width + block.x) * 3,
      )
    }
    block.release?.()
  }
  return output
}

const ppmPixels = (data: Uint8Array): Uint8Array => {
  const marker = new TextEncoder().encode('255\n')
  let start = -1
  for (let offset = 0; offset <= data.byteLength - marker.byteLength; offset += 1) {
    if (marker.every((value, index) => data[offset + index] === value)) {
      start = offset + marker.byteLength
      break
    }
  }
  if (start < 0) throw new Error('Pinned PPM oracle has no sample payload')
  return data.subarray(start)
}

const readJbrd = async (): Promise<Uint8Array> => {
  const source = new MemorySource(fixture)
  const structure = await inspectJpegXlSource(source, resolveJpegXlLimits())
  const box = structure.metadataBoxes.find(({ type }) => type === 'jbrd')
  if (!box) throw new Error('Pinned JPEG reconstruction fixture has no jbrd box')
  const contentStart = box.offset + box.length - box.payloadBytes
  return source.read(contentStart, box.payloadBytes)
}

describe('JPEG XL JPEG reconstruction metadata', () => {
  it('pins a byte-exact independent libjxl reconstruction fixture', () => {
    expect(manifest.revision).toMatch(/^[0-9a-f]{40}$/u)
    expect(manifest.sourceArchiveSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(manifest.fixtures.map(({ id }) => id)).toEqual([
      'progressive-yuv420-exif',
      'progressive-rgb-exif',
    ])
    for (const entry of manifest.fixtures) {
      expect(entry).toMatchObject({
        sourceSha256: entry.reconstructedJpegSha256,
        exact: true,
      })
      expect(sha256(new Uint8Array(readFileSync(entry.jxl)))).toBe(entry.jxlSha256)
      expect(sha256(new Uint8Array(readFileSync(entry.source)))).toBe(entry.sourceSha256)
    }
  })

  it('parses the bounded jbrd header without decoding image coefficients', async () => {
    const reconstruction = parseJpegXlJpegReconstructionHeader(
      await readJbrd(),
      resolveJpegXlLimits(),
    )

    expect(reconstruction.markerOrder).toEqual([
      0xe0, 0xe1, 0xdb, 0xc2, 0xc4, 0xda, 0xc4, 0xda, 0xc4, 0xda, 0xc4, 0xda, 0xc4, 0xda, 0xc4,
      0xda, 0xd9,
    ])
    expect(reconstruction.appMarkers).toEqual([
      { type: 'unknown', byteLength: 17 },
      { type: 'exif', byteLength: 99 },
    ])
    expect(reconstruction.componentIds).toEqual([1, 2, 3])
    expect(reconstruction.componentQuantizationTables).toEqual([0, 1, 1])
    expect(reconstruction.huffmanTables).toHaveLength(6)
    expect(reconstruction.scans).toHaveLength(6)
    expect(
      reconstruction.scans.map(({ spectralStart, spectralEnd }) => [spectralStart, spectralEnd]),
    ).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [1, 63],
      [1, 63],
      [1, 63],
    ])
    expect(reconstruction.compressedDataOffset).toBe(112)
    expect(reconstruction.compressedDataBytes).toBe(21)
  })

  it('reports validated reconstruction metadata separately from coefficient eligibility', async () => {
    await expect(inspectJpegXl(fixture)).resolves.toMatchObject({
      width: 320,
      height: 240,
      encoding: 'vardct',
      jpegReconstruction: 'metadata-valid',
      exactReconstructionEligibility: 'requires-coefficient-validation',
    })
  })

  it('decodes and partitions bounded first-party opaque reconstruction data', async () => {
    const original = await readJbrd()
    const originalHeader = parseJpegXlJpegReconstructionHeader(original, resolveJpegXlLimits())
    const jfif = Uint8Array.of(
      0xe0,
      0x00,
      0x10,
      0x4a,
      0x46,
      0x49,
      0x46,
      0x00,
      0x01,
      0x01,
      0x00,
      0x00,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00,
    )
    const compressed = encodeUncompressedBrotli(jfif)
    const payload = new Uint8Array(originalHeader.compressedDataOffset + compressed.byteLength)
    payload.set(original.subarray(0, originalHeader.compressedDataOffset))
    payload.set(compressed, originalHeader.compressedDataOffset)
    const header = parseJpegXlJpegReconstructionHeader(payload, resolveJpegXlLimits())

    expect(decodeJpegXlJpegReconstructionBlobs(payload, header, resolveJpegXlLimits())).toEqual({
      unknownAppMarkers: [jfif],
      comments: [],
      interMarkerData: [],
      tail: new Uint8Array(),
      decodedBytes: 17,
    })
  })

  it('decodes the pinned libjxl opaque reconstruction payload exactly', async () => {
    const payload = await readJbrd()
    const header = parseJpegXlJpegReconstructionHeader(payload, resolveJpegXlLimits())
    const decoded = decodeJpegXlJpegReconstructionBlobs(payload, header, resolveJpegXlLimits())
    expect(decoded.unknownAppMarkers).toEqual([
      Uint8Array.of(
        0xe0,
        0x00,
        0x10,
        0x4a,
        0x46,
        0x49,
        0x46,
        0x00,
        0x01,
        0x01,
        0x00,
        0x00,
        0x01,
        0x00,
        0x01,
        0x00,
        0x00,
      ),
    ])
    expect(decoded.decodedBytes).toBe(17)
  })

  it('reconstructs the pinned JPEG exactly from format-neutral source coefficients', async () => {
    const payload = await readJbrd()
    const limits = resolveJpegXlLimits()
    const header = parseJpegXlJpegReconstructionHeader(payload, limits)
    const blobs = decodeJpegXlJpegReconstructionBlobs(payload, header, limits)
    const entry = manifest.fixtures[0]
    if (!entry) throw new Error('Pinned JPEG reconstruction manifest is empty')
    const original = new Uint8Array(readFileSync(entry.source))
    const coefficients = await parseJpegCoefficientImage(
      new MemorySource(original),
      defaultImageLimits,
      16 * 1_024 * 1_024,
    )
    if (!coefficients) throw new Error('Pinned JPEG coefficients were rejected')
    const source = new MemorySource(fixture)
    const structure = await inspectJpegXlSource(source, limits)
    const exifBox = structure.metadataBoxes.find(({ type }) => type === 'Exif')
    if (!exifBox) throw new Error('Pinned JPEG reconstruction fixture has no Exif box')
    const exif = await source.read(
      exifBox.offset + exifBox.length - exifBox.payloadBytes,
      exifBox.payloadBytes,
    )

    const reconstructed = reconstructJpegFromCoefficientImage(
      header,
      blobs,
      coefficients,
      { exif },
      limits.maxReconstructedJpegBytes,
    )
    expect(reconstructed).toEqual(original)
    expect(sha256(reconstructed)).toBe(entry.sourceSha256)
  })

  it.each(manifest.fixtures)(
    'reconstructs $id exactly from JPEG XL coefficients',
    async (entry) => {
      const original = new Uint8Array(readFileSync(entry.source))
      const encoded = new Uint8Array(readFileSync(entry.jxl))
      const sink = new Uint8ArraySink()
      const reconstructed = await reconstructJpegFromJpegXl(encoded, { sink })

      expect(reconstructed).toEqual(original)
      expect(sink.toUint8Array()).toEqual(original)
      expect(sha256(reconstructed)).toBe(entry.sourceSha256)
    },
  )

  it.each(manifest.fixtures)(
    'decodes $id pixels against the source JPEG and pinned djxl oracle',
    async (entry) => {
      const source = new Uint8Array(readFileSync(entry.source))
      const encoded = new Uint8Array(readFileSync(entry.jxl))
      const oracleFile = new Uint8Array(readFileSync(entry.pixelOracle))
      expect(sha256(oracleFile)).toBe(entry.pixelOracleSha256)
      const oracle = ppmPixels(oracleFile)
      const sourcePixels = await decodeRgb(jpegCodec, source)
      const actual = await decodeRgb(jpegxlCodec, encoded)

      expect(actual).toEqual(sourcePixels)
      expect(actual.byteLength).toBe(oracle.byteLength)
      let maximumAbsoluteError = 0
      let squaredError = 0
      for (let index = 0; index < oracle.byteLength; index += 1) {
        const difference = Math.abs((actual[index] ?? 0) - (oracle[index] ?? 0))
        maximumAbsoluteError = Math.max(maximumAbsoluteError, difference)
        squaredError += difference * difference
      }
      const rmse = Math.sqrt(squaredError / oracle.byteLength)
      expect(maximumAbsoluteError).toBeLessThanOrEqual(
        entry.pixelOracleTolerance.maximumAbsoluteError,
      )
      expect(rmse).toBeLessThanOrEqual(entry.pixelOracleTolerance.maximumRmse)
    },
  )

  it('enforces the public reconstruction output limit', async () => {
    await expect(
      reconstructJpegFromJpegXl(fixture, { limits: { maxReconstructedJpegBytes: 64 } }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('fails closed when exact reconstruction inputs do not agree', async () => {
    const payload = await readJbrd()
    const limits = resolveJpegXlLimits()
    const header = parseJpegXlJpegReconstructionHeader(payload, limits)
    const blobs = decodeJpegXlJpegReconstructionBlobs(payload, header, limits)
    const entry = manifest.fixtures[0]
    if (!entry) throw new Error('Pinned JPEG reconstruction manifest is empty')
    const coefficients = await parseJpegCoefficientImage(
      new MemorySource(new Uint8Array(readFileSync(entry.source))),
      defaultImageLimits,
      16 * 1_024 * 1_024,
    )
    if (!coefficients) throw new Error('Pinned JPEG coefficients were rejected')
    const source = new MemorySource(fixture)
    const structure = await inspectJpegXlSource(source, limits)
    const exifBox = structure.metadataBoxes.find(({ type }) => type === 'Exif')
    if (!exifBox) throw new Error('Pinned JPEG reconstruction fixture has no Exif box')
    const exif = await source.read(
      exifBox.offset + exifBox.length - exifBox.payloadBytes,
      exifBox.payloadBytes,
    )

    expect(() =>
      reconstructJpegFromCoefficientImage(header, blobs, coefficients, {}, 16 * 1_024 * 1_024),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
    expect(() =>
      reconstructJpegFromCoefficientImage(
        { ...header, componentIds: [7, ...header.componentIds.slice(1)] },
        blobs,
        coefficients,
        {},
        16 * 1_024 * 1_024,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
    expect(() =>
      reconstructJpegFromCoefficientImage(header, blobs, coefficients, { exif }, 64),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
    expect(() =>
      reconstructJpegFromCoefficientImage(
        { ...header, paddingBits: [0] },
        blobs,
        coefficients,
        { exif },
        16 * 1_024 * 1_024,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })

  it('enforces explicit reconstruction marker limits', async () => {
    const payload = await readJbrd()
    expect(() =>
      parseJpegXlJpegReconstructionHeader(payload, resolveJpegXlLimits({ maxJpegMarkers: 16 })),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
  })

  it('rejects truncated reconstruction metadata', async () => {
    const payload = await readJbrd()
    expect(() =>
      parseJpegXlJpegReconstructionHeader(payload.subarray(0, 20), resolveJpegXlLimits()),
    ).toThrowError(expect.objectContaining({ code: 'TRUNCATED_INPUT' }))
  })
})
