import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import manifest from '../benchmark/jpegxl/jpeg-reconstruction-manifest.json' with { type: 'json' }
import { encodeBrotli, encodeUncompressedBrotli } from '../src/codecs/brotli.ts'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { inspectJpegExactTranscodeDisplaySemantics } from '../src/codecs/jpeg-display-semantics.ts'
import { parseJpegCoefficientImage } from '../src/codecs/jpeg-coefficients.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { pipeDecoderToJpegXlEncoder } from '../src/codecs/jpegxl-jpeg-transcode.ts'
import { inspectJpegXlSource } from '../src/codecs/jpegxl-container.ts'
import { parseJpegReconstructionData } from '../src/codecs/jpegxl-jpeg-data.ts'
import { reconstructJpegFromCoefficientImage } from '../src/codecs/jpegxl-jpeg-reconstruct.ts'
import { verifyJpegReconstructionFromJpegXl } from '../src/codecs/jpegxl-jpeg-reconstruct-source.ts'
import {
  decodeJpegXlJpegReconstructionBlobs,
  encodeJpegXlJpegReconstruction,
  parseJpegXlJpegReconstructionHeader,
} from '../src/codecs/jpegxl-jpeg-reconstruction.ts'
import { resolveJpegXlLimits } from '../src/codecs/jpegxl-limits.ts'
import { createEvidenceSession } from '../src/evidence.ts'
import { createPureJsImageSrgbIcc } from '../src/hdr/srgb-icc.ts'
import {
  inspectJpegReconstructionEligibility,
  inspectJpegXl,
  reconstructJpegFromJpegXl,
  transcodeJpegToJpegXl,
} from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'
import { displayP3RgbProfile } from './icc-fixtures.ts'

const primaryEntry = manifest.fixtures[0]
if (!primaryEntry) throw new Error('Pinned JPEG reconstruction manifest is empty')
const fixture = new Uint8Array(readFileSync(primaryEntry.jxl))

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const concatenate = (...parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const jpegSegment = (marker: number, payload: Uint8Array): Uint8Array => {
  const output = new Uint8Array(payload.byteLength + 4)
  output[0] = 0xff
  output[1] = marker
  new DataView(output.buffer).setUint16(2, payload.byteLength + 2, false)
  output.set(payload, 4)
  return output
}

const withLeadingMarker = (jpeg: Uint8Array, marker: Uint8Array): Uint8Array =>
  concatenate(jpeg.subarray(0, 2), marker, jpeg.subarray(2))

const jpegMarkerOffsets = (jpeg: Uint8Array, selectedMarker: number): readonly number[] => {
  const offsets: number[] = []
  let offset = 2
  while (offset + 1 < jpeg.byteLength) {
    if (jpeg[offset] !== 0xff) throw new Error('JPEG test fixture marker prefix is missing')
    const markerOffset = offset
    while (jpeg[offset] === 0xff) offset += 1
    const marker = jpeg[offset]
    if (marker === undefined) throw new Error('JPEG test fixture marker is truncated')
    offset += 1
    if (marker === selectedMarker) offsets.push(markerOffset)
    if (marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const high = jpeg[offset]
    const low = jpeg[offset + 1]
    if (high === undefined || low === undefined) {
      throw new Error('JPEG test fixture marker length is truncated')
    }
    const length = high * 256 + low
    if (length < 2 || offset + length > jpeg.byteLength) {
      throw new Error('JPEG test fixture marker length is invalid')
    }
    offset += length
    if (marker !== 0xda) continue
    while (offset + 1 < jpeg.byteLength) {
      if (jpeg[offset] !== 0xff) {
        offset += 1
        continue
      }
      const following = jpeg[offset + 1]
      if (
        following === 0x00 ||
        (following !== undefined && following >= 0xd0 && following <= 0xd7)
      ) {
        offset += 2
        continue
      }
      break
    }
  }
  return Object.freeze(offsets)
}

const withMarkerAt = (jpeg: Uint8Array, marker: Uint8Array, offset: number): Uint8Array =>
  concatenate(jpeg.subarray(0, offset), marker, jpeg.subarray(offset))

const exifOrientationMarker = (orientation: number): Uint8Array => {
  const payload = new Uint8Array(32)
  payload.set(Uint8Array.of(0x45, 0x78, 0x69, 0x66), 0)
  const view = new DataView(payload.buffer)
  payload[6] = 0x49
  payload[7] = 0x49
  view.setUint16(8, 42, true)
  view.setUint32(10, 8, true)
  view.setUint16(14, 1, true)
  view.setUint16(16, 0x0112, true)
  view.setUint16(18, 3, true)
  view.setUint32(20, 1, true)
  view.setUint16(24, orientation, true)
  return jpegSegment(0xe1, payload)
}

const exifColorMarker = (
  options: Readonly<{
    colorSpace?: number
    interoperability?: 'R98' | 'R03'
    colorSpaceType?: number
    colorSpaceCount?: number
  }>,
): Uint8Array => {
  const payload = new Uint8Array(92)
  payload.set(Uint8Array.of(0x45, 0x78, 0x69, 0x66), 0)
  const view = new DataView(payload.buffer)
  const tiff = 6
  payload[tiff] = 0x49
  payload[tiff + 1] = 0x49
  view.setUint16(tiff + 2, 42, true)
  view.setUint32(tiff + 4, 8, true)
  const ifd0 = tiff + 8
  view.setUint16(ifd0, 2, true)
  view.setUint16(ifd0 + 2, 0x0112, true)
  view.setUint16(ifd0 + 4, 3, true)
  view.setUint32(ifd0 + 6, 1, true)
  view.setUint16(ifd0 + 10, 1, true)
  view.setUint16(ifd0 + 14, 0x8769, true)
  view.setUint16(ifd0 + 16, 4, true)
  view.setUint32(ifd0 + 18, 1, true)
  view.setUint32(ifd0 + 22, 38, true)
  const exifIfd = tiff + 38
  const exifEntryCount =
    Number(options.colorSpace !== undefined) + Number(options.interoperability !== undefined)
  view.setUint16(exifIfd, exifEntryCount, true)
  let entry = exifIfd + 2
  if (options.colorSpace !== undefined) {
    view.setUint16(entry, 0xa001, true)
    view.setUint16(entry + 2, options.colorSpaceType ?? 3, true)
    view.setUint32(entry + 4, options.colorSpaceCount ?? 1, true)
    view.setUint16(entry + 8, options.colorSpace, true)
    entry += 12
  }
  if (options.interoperability !== undefined) {
    view.setUint16(entry, 0xa005, true)
    view.setUint16(entry + 2, 4, true)
    view.setUint32(entry + 4, 1, true)
    view.setUint32(entry + 8, 68, true)
    const interoperabilityIfd = tiff + 68
    view.setUint16(interoperabilityIfd, 1, true)
    view.setUint16(interoperabilityIfd + 2, 0x0001, true)
    view.setUint16(interoperabilityIfd + 4, 2, true)
    view.setUint32(interoperabilityIfd + 6, 4, true)
    payload.set(new TextEncoder().encode(`${options.interoperability}\0`), interoperabilityIfd + 10)
  }
  return jpegSegment(0xe1, payload)
}

const iccMarker = (profile: Uint8Array): Uint8Array =>
  jpegSegment(
    0xe2,
    concatenate(new TextEncoder().encode('ICC_PROFILE\0'), Uint8Array.of(1, 1), profile),
  )

const numberedIccMarker = (profile: Uint8Array, sequence: number, count: number): Uint8Array =>
  jpegSegment(
    0xe2,
    concatenate(new TextEncoder().encode('ICC_PROFILE\0'), Uint8Array.of(sequence, count), profile),
  )

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
  it('restricts exact transcode to display-equivalent Exif orientation and ICC semantics', async () => {
    const source = new Uint8Array(
      readFileSync('benchmark/corpus/files/jpeg-reference/generated-progressive.jpg'),
    )
    const orientationSix = withLeadingMarker(source, exifOrientationMarker(6))
    await expect(inspectJpegReconstructionEligibility(orientationSix)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['unsupported-display-orientation'],
    })
    await expect(transcodeJpegToJpegXl(orientationSix)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('orientation'),
    })

    const canonicalSrgb = withLeadingMarker(source, iccMarker(createPureJsImageSrgbIcc()))
    await expect(inspectJpegReconstructionEligibility(canonicalSrgb)).resolves.toMatchObject({
      eligible: true,
      sourceProfile: { orientation: 1, colorProfile: 'srgb' },
    })

    const nonSrgb = withLeadingMarker(source, iccMarker(displayP3RgbProfile()))
    await expect(inspectJpegReconstructionEligibility(nonSrgb)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['unsupported-color-profile'],
    })
    await expect(transcodeJpegToJpegXl(nonSrgb)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('color profile'),
    })

    const malformed = withLeadingMarker(source, iccMarker(Uint8Array.of(1, 2, 3, 4)))
    await expect(inspectJpegReconstructionEligibility(malformed)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['malformed-color-profile'],
    })
    await expect(
      transcodeJpegToJpegXl(malformed, {
        reconstruction: 'disabled',
        fallback: 'pixel-lossless',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects conflicting Exif and incomplete or duplicate ICC display metadata', async () => {
    const source = new Uint8Array(
      readFileSync('benchmark/corpus/files/jpeg-reference/generated-progressive.jpg'),
    )
    const conflictingOrientation = withLeadingMarker(
      withLeadingMarker(source, exifOrientationMarker(1)),
      exifOrientationMarker(6),
    )
    await expect(
      inspectJpegReconstructionEligibility(conflictingOrientation),
    ).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['unsupported-display-orientation'],
    })

    const profile = createPureJsImageSrgbIcc()
    const incomplete = withLeadingMarker(source, numberedIccMarker(profile, 1, 2))
    await expect(inspectJpegReconstructionEligibility(incomplete)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['malformed-color-profile'],
    })

    const duplicate = withLeadingMarker(
      withLeadingMarker(source, numberedIccMarker(profile, 1, 2)),
      numberedIccMarker(profile, 1, 2),
    )
    await expect(inspectJpegReconstructionEligibility(duplicate)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['malformed-color-profile'],
    })
  })

  it('accepts only explicit sRGB Exif color declarations for exact transcode', async () => {
    const source = new Uint8Array(
      readFileSync('benchmark/corpus/files/jpeg-reference/generated-progressive.jpg'),
    )
    const explicitSrgb = withLeadingMarker(source, exifColorMarker({ colorSpace: 1 }))
    await expect(inspectJpegReconstructionEligibility(explicitSrgb)).resolves.toMatchObject({
      eligible: true,
      sourceProfile: { colorProfile: 'none' },
    })

    const uncalibrated = withLeadingMarker(source, exifColorMarker({ colorSpace: 0xffff }))
    await expect(inspectJpegReconstructionEligibility(uncalibrated)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['unsupported-exif-color-space'],
    })

    const adobeRgb = withLeadingMarker(source, exifColorMarker({ interoperability: 'R03' }))
    await expect(inspectJpegReconstructionEligibility(adobeRgb)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['unsupported-exif-color-space'],
    })

    const malformed = withLeadingMarker(
      source,
      exifColorMarker({ colorSpace: 1, colorSpaceType: 4 }),
    )
    await expect(inspectJpegReconstructionEligibility(malformed)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['malformed-color-metadata'],
    })

    const conflictingExif = withLeadingMarker(
      withLeadingMarker(source, exifColorMarker({ colorSpace: 1 })),
      exifColorMarker({ interoperability: 'R03' }),
    )
    await expect(inspectJpegReconstructionEligibility(conflictingExif)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['conflicting-color-metadata'],
    })

    const conflictingIcc = withLeadingMarker(
      withLeadingMarker(source, iccMarker(createPureJsImageSrgbIcc())),
      exifColorMarker({ interoperability: 'R03' }),
    )
    await expect(inspectJpegReconstructionEligibility(conflictingIcc)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['conflicting-color-metadata'],
    })
  })

  it('does not let rendering metadata bypass exact-transcode policy after the first scan', async () => {
    const source = new Uint8Array(
      readFileSync('benchmark/corpus/files/jpeg-reference/generated-progressive.jpg'),
    )
    const scanOffsets = jpegMarkerOffsets(source, 0xda)
    const eoiOffset = jpegMarkerOffsets(source, 0xd9)[0]
    const secondScanOffset = scanOffsets[1]
    if (secondScanOffset === undefined || eoiOffset === undefined) {
      throw new Error('Progressive JPEG fixture does not expose the required marker boundaries')
    }

    const lateOrientation = withMarkerAt(source, exifOrientationMarker(6), secondScanOffset)
    expect(() =>
      inspectJpegExactTranscodeDisplaySemantics(lateOrientation, 16 * 1_024 * 1_024),
    ).toThrow('orientation')
    await expect(inspectJpegReconstructionEligibility(lateOrientation)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['unsupported-display-orientation'],
    })
    await expect(transcodeJpegToJpegXl(lateOrientation)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('orientation'),
    })

    const postScanOrientation = withMarkerAt(source, exifOrientationMarker(6), eoiOffset)
    expect(() =>
      inspectJpegExactTranscodeDisplaySemantics(postScanOrientation, 16 * 1_024 * 1_024),
    ).toThrow('orientation')

    const lateNonSrgb = withMarkerAt(source, iccMarker(displayP3RgbProfile()), secondScanOffset)
    expect(() =>
      inspectJpegExactTranscodeDisplaySemantics(lateNonSrgb, 16 * 1_024 * 1_024),
    ).toThrow('color profile')
    await expect(inspectJpegReconstructionEligibility(lateNonSrgb)).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['unsupported-color-profile'],
    })

    const profile = createPureJsImageSrgbIcc()
    const midpoint = Math.ceil(profile.byteLength / 2)
    const splitAcrossScans = withMarkerAt(
      withLeadingMarker(source, numberedIccMarker(profile.subarray(0, midpoint), 1, 2)),
      numberedIccMarker(profile.subarray(midpoint), 2, 2),
      secondScanOffset + numberedIccMarker(profile.subarray(0, midpoint), 1, 2).byteLength,
    )
    expect(() =>
      inspectJpegExactTranscodeDisplaySemantics(splitAcrossScans, 16 * 1_024 * 1_024),
    ).not.toThrow()
    await expect(inspectJpegReconstructionEligibility(splitAcrossScans)).resolves.toMatchObject({
      eligible: true,
      sourceProfile: { colorProfile: 'srgb' },
    })

    const conflictingOrientation = withMarkerAt(
      withLeadingMarker(source, exifOrientationMarker(1)),
      exifOrientationMarker(6),
      secondScanOffset + exifOrientationMarker(1).byteLength,
    )
    expect(() =>
      inspectJpegExactTranscodeDisplaySemantics(conflictingOrientation, 16 * 1_024 * 1_024),
    ).toThrow('conflicting')

    const duplicateIcc = withMarkerAt(
      withLeadingMarker(source, numberedIccMarker(profile, 1, 1)),
      numberedIccMarker(profile, 1, 1),
      secondScanOffset + numberedIccMarker(profile, 1, 1).byteLength,
    )
    expect(() =>
      inspectJpegExactTranscodeDisplaySemantics(duplicateIcc, 16 * 1_024 * 1_024),
    ).toThrow('malformed')

    const malformedIcc = withMarkerAt(
      source,
      jpegSegment(
        0xe2,
        concatenate(new TextEncoder().encode('ICC_PROFILE\0'), Uint8Array.of(0, 1)),
      ),
      secondScanOffset,
    )
    expect(() =>
      inspectJpegExactTranscodeDisplaySemantics(malformedIcc, 16 * 1_024 * 1_024),
    ).toThrow('ICC')
  })

  it('releases pixel-fallback blocks and closes the decoder iterator after encoder failure', async () => {
    let releases = 0
    let iteratorReturns = 0
    const failure = new Error('encoder write failed')
    const abortReasons: unknown[] = []
    const decoder = {
      width: 1,
      height: 2,
      pixelFormat: 'rgb8' as const,
      capabilities: Object.freeze({
        sequential: true,
        regionDecode: false,
        scaledDecode: false,
        progressive: false,
      }),
      async *decode() {
        try {
          yield Object.freeze({
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            stride: 3,
            format: 'rgb8' as const,
            data: Uint8Array.of(1, 2, 3),
            release: () => {
              releases += 1
            },
          })
          yield Object.freeze({
            x: 0,
            y: 1,
            width: 1,
            height: 1,
            stride: 3,
            format: 'rgb8' as const,
            data: Uint8Array.of(4, 5, 6),
          })
        } finally {
          iteratorReturns += 1
        }
      },
    }
    const encoder = {
      async write(): Promise<void> {
        throw failure
      },
      async finish(): Promise<void> {
        throw new Error('finish must not run')
      },
      async abort(reason: unknown): Promise<void> {
        abortReasons.push(reason)
      },
    }

    await expect(pipeDecoderToJpegXlEncoder(decoder, encoder)).rejects.toBe(failure)
    expect(releases).toBe(1)
    expect(iteratorReturns).toBe(1)
    expect(abortReasons).toEqual([failure])
  })

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

  it('decodes valid JPEG-derived pixels without trusting malformed reconstruction metadata', async () => {
    const damaged = fixture.slice()
    const source = new MemorySource(damaged)
    const structure = await inspectJpegXlSource(source, resolveJpegXlLimits())
    const box = structure.metadataBoxes.find(({ type }) => type === 'jbrd')
    if (!box) throw new Error('Pinned JPEG reconstruction fixture has no jbrd box')
    const contentStart = box.offset + box.length - box.payloadBytes
    damaged.fill(0xff, contentStart, Math.min(contentStart + 16, damaged.byteLength))

    await expect(decodeRgb(jpegxlCodec, damaged)).resolves.toEqual(
      await decodeRgb(jpegxlCodec, fixture),
    )
    await expect(reconstructJpegFromJpegXl(damaged)).rejects.toThrow()
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

  it('decodes compressed first-party opaque reconstruction data', async () => {
    const original = await readJbrd()
    const originalHeader = parseJpegXlJpegReconstructionHeader(original, resolveJpegXlLimits())
    const opaque = Uint8Array.from({ length: 4096 }, (_, index) => index & 3)
    const compressed = encodeBrotli(opaque)
    const payload = new Uint8Array(originalHeader.compressedDataOffset + compressed.byteLength)
    payload.set(original.subarray(0, originalHeader.compressedDataOffset))
    payload.set(compressed, originalHeader.compressedDataOffset)
    const header = parseJpegXlJpegReconstructionHeader(payload, resolveJpegXlLimits())
    const adjusted = Object.freeze({
      ...header,
      appMarkers: Object.freeze([{ type: 'unknown' as const, byteLength: opaque.byteLength }]),
    })

    expect(decodeJpegXlJpegReconstructionBlobs(payload, adjusted, resolveJpegXlLimits())).toEqual({
      unknownAppMarkers: [opaque],
      comments: [],
      interMarkerData: [],
      tail: new Uint8Array(),
      decodedBytes: opaque.byteLength,
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
    'extracts and re-encodes exact reconstruction data from $id',
    async (entry) => {
      const limits = resolveJpegXlLimits()
      const original = new Uint8Array(readFileSync(entry.source))
      const coefficients = await parseJpegCoefficientImage(
        new MemorySource(original),
        defaultImageLimits,
        16 * 1_024 * 1_024,
      )
      if (!coefficients) throw new Error('Pinned JPEG coefficients were rejected')
      const parsed = parseJpegReconstructionData(original, coefficients, limits)
      const payload = encodeJpegXlJpegReconstruction(parsed.header, parsed.blobs, limits)
      const header = parseJpegXlJpegReconstructionHeader(payload, limits)
      const blobs = decodeJpegXlJpegReconstructionBlobs(payload, header, limits)

      expect(header.markerOrder).toEqual(parsed.header.markerOrder)
      expect(header.scans).toEqual(parsed.header.scans)
      expect(header.huffmanTables).toEqual(parsed.header.huffmanTables)
      expect(
        reconstructJpegFromCoefficientImage(
          header,
          blobs,
          coefficients,
          {},
          limits.maxReconstructedJpegBytes,
        ),
      ).toEqual(original)
    },
  )

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

  it('verifies exact reconstruction against caller bytes without returning a duplicate JPEG', async () => {
    const source = new Uint8Array(readFileSync(primaryEntry.source))
    await expect(verifyJpegReconstructionFromJpegXl(fixture, source)).resolves.toBeUndefined()
    const changed = source.slice()
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1
    await expect(verifyJpegReconstructionFromJpegXl(fixture, changed)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it.each(manifest.fixtures)(
    'decodes $id pixels against the source JPEG and pinned djxl oracle',
    async (entry) => {
      const source = new Uint8Array(readFileSync(entry.source))
      const encoded = new Uint8Array(readFileSync(entry.jxl))
      const oracleFile = new Uint8Array(readFileSync(entry.pixelOracle))
      expect(sha256(oracleFile)).toBe(entry.pixelOracleSha256)
      const oracle = ppmPixels(oracleFile)
      const sourcePixels = await decodeRgb(jpegCodec, source)
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(encoded),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('JPEG XL decoder is unavailable')
      expect(decoder.colorSemantics).toEqual({
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'decoder-converted',
        renderingIntent: 'relative',
      })
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

  it.each(manifest.fixtures)(
    'transcodes $id without RGB and reconstructs it exactly',
    async (entry) => {
      const source = new Uint8Array(readFileSync(entry.source))
      await expect(inspectJpegReconstructionEligibility(source)).resolves.toMatchObject({
        eligible: true,
        sourceProfile: {
          progressive: true,
          components: 3,
        },
      })

      const result = await transcodeJpegToJpegXl(source)
      expect(result).toMatchObject({
        mode: 'exact-jpeg',
        exactReconstruction: true,
        inputBytes: source.byteLength,
        outputBytes: result.data.byteLength,
        sourceProfile: {
          width: 320,
          height: 240,
          progressive: true,
        },
        outputStructure: {
          kind: 'container',
          organization: 'jxlc',
          reconstruction: 'available',
        },
      })
      expect(await reconstructJpegFromJpegXl(result.data)).toEqual(source)
      expect(await decodeRgb(jpegxlCodec, result.data)).toEqual(await decodeRgb(jpegCodec, source))
    },
  )

  it('transcodes a one-group progressive JPEG exactly', async () => {
    const source = new Uint8Array(
      readFileSync('benchmark/corpus/files/jpeg-reference/generated-progressive.jpg'),
    )
    const result = await transcodeJpegToJpegXl(source)
    expect(result.sourceProfile).toMatchObject({
      width: 37,
      height: 23,
      progressive: true,
      colorTransform: 'ycbcr',
    })
    expect(await reconstructJpegFromJpegXl(result.data)).toEqual(source)
  })

  it.each([
    'benchmark/corpus/files/jpeg-reference/generated-sof1-8bit.jpg',
    'benchmark/corpus/files/jpeg-reference/generated-sequential-multiscan.jpg',
  ])('transcodes the baseline coefficient subset exactly: %s', async (file) => {
    const source = new Uint8Array(readFileSync(file))
    const result = await transcodeJpegToJpegXl(source)
    expect(result.sourceProfile.progressive).toBe(false)
    expect(await reconstructJpegFromJpegXl(result.data)).toEqual(source)
  })

  it('enforces explicit fallback and only-if-smaller policies', async () => {
    const source = new Uint8Array(readFileSync(primaryEntry.source))
    await expect(
      transcodeJpegToJpegXl(source, { reconstruction: 'disabled' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const fallback = await transcodeJpegToJpegXl(source, {
      reconstruction: 'disabled',
      fallback: 'pixel-lossless',
    })
    expect(fallback).toMatchObject({
      mode: 'pixel-lossless',
      exactReconstruction: false,
      outputStructure: { reconstruction: 'unavailable' },
    })
    expect(await decodeRgb(jpegxlCodec, fallback.data)).toEqual(await decodeRgb(jpegCodec, source))
    await expect(transcodeJpegToJpegXl(source, { onlyIfSmaller: true })).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })

  it('hands sink-mode output to the sink without returning duplicate bytes', async () => {
    const source = new Uint8Array(readFileSync(primaryEntry.source))
    const expected = await transcodeJpegToJpegXl(source)
    const sink = new Uint8ArraySink()
    const result = await transcodeJpegToJpegXl(source, { sink })
    expect(result.data).toBeUndefined()
    expect(sink.toUint8Array()).toEqual(expected.data)
  })

  it('does not retain a reconstructed JPEG during sink-mode verification', async () => {
    const source = new Uint8Array(readFileSync(primaryEntry.source))
    const session = createEvidenceSession({ mode: 'trace' })
    const sink = new Uint8ArraySink()
    await transcodeJpegToJpegXl(source, { sink, evidence: session.context })
    const report = session.finalize()
    expect(
      report.events?.some(
        (event) =>
          event.type === 'allocation' && event.category === 'jpeg-transcode-verification-jpeg',
      ),
    ).toBe(false)
  })

  it('aborts a caller sink and preserves its write failure', async () => {
    const source = new Uint8Array(readFileSync(primaryEntry.source))
    const failure = new Error('transcode sink write failed')
    const abortReasons: unknown[] = []
    const sink = {
      async write(): Promise<void> {
        throw failure
      },
      async close(): Promise<void> {
        throw new Error('close must not run')
      },
      async abort(reason: unknown): Promise<void> {
        abortReasons.push(reason)
      },
    }
    await expect(transcodeJpegToJpegXl(source, { sink })).rejects.toBe(failure)
    expect(abortReasons).toEqual([failure])
  })

  it('aborts a caller sink and preserves its close failure', async () => {
    const source = new Uint8Array(readFileSync(primaryEntry.source))
    const failure = new Error('transcode sink close failed')
    const abortReasons: unknown[] = []
    let writes = 0
    const sink = {
      async write(): Promise<void> {
        writes += 1
      },
      async close(): Promise<void> {
        throw failure
      },
      async abort(reason: unknown): Promise<void> {
        abortReasons.push(reason)
      },
    }
    await expect(transcodeJpegToJpegXl(source, { sink })).rejects.toBe(failure)
    expect(writes).toBe(1)
    expect(abortReasons).toEqual([failure])
  })

  it('determines only-if-smaller before writing caller output', async () => {
    const source = new Uint8Array(readFileSync(primaryEntry.source))
    const abortReasons: unknown[] = []
    let writes = 0
    const sink = {
      async write(): Promise<void> {
        writes += 1
      },
      async close(): Promise<void> {
        throw new Error('close must not run')
      },
      async abort(reason: unknown): Promise<void> {
        abortReasons.push(reason)
      },
    }
    await expect(
      transcodeJpegToJpegXl(source, { sink, onlyIfSmaller: true }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    expect(writes).toBe(0)
    expect(abortReasons).toHaveLength(1)
  })

  it.each([
    ['parse', 'jpeg-transcode-input'],
    ['encode', 'jpeg-transcode-reconstruction-payload'],
    ['verify', 'jpeg-transcode-output'],
  ] as const)(
    'cancels during the %s stage and releases every managed lease',
    async (_stage, category) => {
      const source = new Uint8Array(readFileSync(primaryEntry.source))
      const controller = new AbortController()
      const reason = new Error(`cancel at ${category}`)
      const session = createEvidenceSession({ mode: 'trace' })
      session.subscribe((event) => {
        if (event.type === 'allocation' && event.category === category) controller.abort(reason)
      })
      await expect(
        transcodeJpegToJpegXl(source, {
          signal: controller.signal,
          evidence: session.context,
        }),
      ).rejects.toBe(reason)
      const report = session.finalize('cancelled')
      expect(report.managedMemory).toMatchObject({ currentLiveBytes: 0, stillLiveLeases: 0 })
      expect(report.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operationId: 'jpeg-to-jxl', phase: 'cancelled' }),
        ]),
      )
      expect(report.cancellations).toEqual(
        expect.arrayContaining([expect.objectContaining({ target: 'jpeg-to-jxl' })]),
      )
    },
  )

  it('cancels after sink write, skips close, aborts the sink, and releases managed bytes', async () => {
    const source = new Uint8Array(readFileSync(primaryEntry.source))
    const controller = new AbortController()
    const reason = new Error('cancel during sink write')
    const abortReasons: unknown[] = []
    let closes = 0
    const session = createEvidenceSession({ mode: 'trace' })
    const sink = {
      async write(): Promise<void> {
        controller.abort(reason)
      },
      async close(): Promise<void> {
        closes += 1
      },
      async abort(error: unknown): Promise<void> {
        abortReasons.push(error)
      },
    }
    await expect(
      transcodeJpegToJpegXl(source, {
        sink,
        signal: controller.signal,
        evidence: session.context,
      }),
    ).rejects.toBe(reason)
    const report = session.finalize('cancelled')
    expect(closes).toBe(0)
    expect(abortReasons).toEqual([reason])
    expect(report.managedMemory).toMatchObject({ currentLiveBytes: 0, stillLiveLeases: 0 })
  })

  it('keeps exact output identical across evidence modes and releases managed bytes', async () => {
    const source = new Uint8Array(readFileSync(primaryEntry.source))
    const withoutEvidence = await transcodeJpegToJpegXl(source)
    const summarySession = createEvidenceSession({ mode: 'summary' })
    const summary = await transcodeJpegToJpegXl(source, { evidence: summarySession.context })
    const summaryReport = summarySession.finalize()
    const traceSession = createEvidenceSession({ mode: 'trace' })
    const trace = await transcodeJpegToJpegXl(source, { evidence: traceSession.context })
    const traceReport = traceSession.finalize()

    expect(summary.data).toEqual(withoutEvidence.data)
    expect(trace.data).toEqual(withoutEvidence.data)
    expect(summaryReport.events).toBeUndefined()
    expect(traceReport.events?.length).toBeGreaterThan(0)
    for (const report of [summaryReport, traceReport]) {
      expect(report.scopes.map(({ label }) => label)).toEqual(
        expect.arrayContaining(['jpegxl-jpeg-transcode', 'exact-coefficient-transcode']),
      )
      expect(report.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operationId: 'jpeg-to-jxl', phase: 'complete' }),
          expect.objectContaining({
            operationId: 'exact-coefficient-transcode',
            phase: 'complete',
          }),
        ]),
      )
      expect(report.managedMemory).toMatchObject({
        currentLiveBytes: 0,
        stillLiveLeases: 0,
      })
      expect(report.managedMemory.peakLiveBytes).toBe(withoutEvidence.managedPeakBytes)
    }
  })

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
