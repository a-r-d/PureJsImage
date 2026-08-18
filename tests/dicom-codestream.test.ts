import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { inspectJpegCodestream, jpegCodec } from '../src/codecs/jpeg.ts'
import { decodeJpeg2000NativeGrayFrame } from '../src/codecs/jpeg2000.ts'
import { rasterSampleBytes } from '../src/raster.ts'
import type { ScientificDataset } from '../src/scientific/dataset.ts'
import {
  dicomTag,
  jpeg2000LosslessUid,
  jpeg2000Uid,
  jpegBaseline8BitUid,
  jpegLosslessSv1Uid,
} from '../src/scientific/formats/dicom/constants.ts'
import { packDicomCodecSamples } from '../src/scientific/formats/dicom/codestream.ts'
import type { DicomPixelDescription } from '../src/scientific/formats/dicom/pixel-description.ts'
import { createDicomReader } from '../src/scientific/readers/dicom.ts'
import { readRasterSample } from '../src/scientific/samples.ts'
import { MemorySource } from '../src/source.ts'
import { encodeGrayJpeg, encodeRgbJpeg, stripJpegJfif } from './dicom/jpeg-encode.ts'
import { encodeJpegLosslessGray } from './dicom/jpeg-lossless-encode.ts'
import {
  jpeg2000WithIrreversibleComponentCoc,
  jpeg2000WithScalarQuantization,
  jpeg2000WithTruncatedCodingPasses,
} from './dicom/jpeg2000-qualify-fixtures.ts'
import {
  dicomEncapsulatedFragments,
  dicomTextBytes,
  dicomUInt16Bytes,
  writeDicomPart10,
} from './dicom/part10-writer.ts'

const losslessGray16 = readFileSync('tests/fixtures/dicom/lossless-gray16.j2k')
const losslessGray8 = readFileSync('tests/fixtures/dicom/lossless-gray8.j2k')
const lossyGray8 = readFileSync('tests/fixtures/dicom/lossy-gray8.j2k')

const insertJpegFillBeforeEoi = (data: Uint8Array, fillCount: number): Uint8Array => {
  for (let index = data.byteLength - 2; index >= 0; index -= 1) {
    if (data[index] !== 0xff || data[index + 1] !== 0xd9) continue
    const output = new Uint8Array(data.byteLength + fillCount)
    output.set(data.subarray(0, index))
    output.fill(0xff, index, index + fillCount)
    output.set(data.subarray(index), index + fillCount)
    return output
  }
  throw new Error('JPEG EOI marker is missing')
}

const planeSamples = async (dataset: ScientificDataset): Promise<number[]> => {
  const values: number[] = []
  for await (const block of dataset.readPlane({ displayAxes: ['x', 'y'], fixedIndices: [] })) {
    const sampleBytes = rasterSampleBytes(block.format.sampleType)
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let y = 0; y < block.height; y += 1) {
      for (let x = 0; x < block.width; x += 1) {
        values.push(
          readRasterSample(
            block.data,
            view,
            y * block.stride + x * sampleBytes,
            block.format.sampleType,
          ),
        )
      }
    }
  }
  return values
}

const encapsulated = (
  transferSyntaxUid: string,
  options: {
    readonly bitsAllocated: 8 | 16
    readonly bitsStored?: number
    readonly rows: number
    readonly columns: number
    readonly signed?: boolean
    readonly photometric?: 'MONOCHROME1' | 'MONOCHROME2'
    readonly samplesPerPixel?: number
    readonly frame: Uint8Array
    readonly fragments?: readonly Uint8Array[]
    readonly offsetTable?: 'empty' | 'basic'
  },
): Uint8Array =>
  writeDicomPart10({
    transferSyntax: 'explicit-vr-le',
    transferSyntaxUid,
    dataset: [
      { tag: dicomTag.sopClassUid, vr: 'UI', value: dicomTextBytes('1.2.840.10008.5.1.4.1.1.7') },
      {
        tag: dicomTag.sopInstanceUid,
        vr: 'UI',
        value: dicomTextBytes('1.2.826.0.1.3680043.10.850.1.1'),
      },
      {
        tag: dicomTag.samplesPerPixel,
        vr: 'US',
        value: dicomUInt16Bytes(options.samplesPerPixel ?? 1),
      },
      {
        tag: dicomTag.photometricInterpretation,
        vr: 'CS',
        value: dicomTextBytes(options.photometric ?? 'MONOCHROME2'),
      },
      { tag: dicomTag.rows, vr: 'US', value: dicomUInt16Bytes(options.rows) },
      { tag: dicomTag.columns, vr: 'US', value: dicomUInt16Bytes(options.columns) },
      { tag: dicomTag.bitsAllocated, vr: 'US', value: dicomUInt16Bytes(options.bitsAllocated) },
      {
        tag: dicomTag.bitsStored,
        vr: 'US',
        value: dicomUInt16Bytes(options.bitsStored ?? options.bitsAllocated),
      },
      {
        tag: dicomTag.highBit,
        vr: 'US',
        value: dicomUInt16Bytes((options.bitsStored ?? options.bitsAllocated) - 1),
      },
      {
        tag: dicomTag.pixelRepresentation,
        vr: 'US',
        value: dicomUInt16Bytes(options.signed === true ? 1 : 0),
      },
      {
        tag: dicomTag.pixelData,
        vr: 'OB',
        fragments: dicomEncapsulatedFragments(
          [options.fragments ?? [options.frame]],
          options.offsetTable ?? 'empty',
        ),
      },
    ],
  })

const grayContainer16 = (overrides: Partial<DicomPixelDescription> = {}): DicomPixelDescription =>
  Object.freeze({
    rows: 1,
    columns: 4,
    numberOfFrames: 1,
    samplesPerPixel: 1,
    photometricInterpretation: 'MONOCHROME2',
    bitsAllocated: 16,
    bitsStored: 8,
    highBit: 7,
    pixelRepresentation: 'unsigned',
    sampleType: 'uint16',
    bytesPerSample: 2,
    frameBytes: 8,
    totalPixelBytes: 8,
    pixelDataOffset: 0,
    pixelDataLength: 8,
    encoding: 'jpeg-lossless-sv1',
    ...overrides,
  })

const openBytes = async (bytes: Uint8Array) => {
  const document = await createDicomReader().open({
    primary: { id: 'primary', name: 'codestream.dcm', source: new MemorySource(bytes) },
  })
  return document.openDataset(document.datasets[0]?.id ?? '')
}

const magickGraySamples = (path: string, depth: 8 | 16): number[] | undefined => {
  const result = spawnSync('magick', [path, '-depth', String(depth), `pgm:-`], {
    encoding: 'buffer',
  })
  if (result.status !== 0 || result.stdout.byteLength === 0) return undefined
  const header = result.stdout.subarray(0, 64).toString('latin1')
  const match = /^P5\n(\d+) (\d+)\n(\d+)\n/.exec(header)
  if (match === null || match[0] === undefined) return undefined
  const payload = result.stdout.subarray(match[0].length)
  const values: number[] = []
  if (depth === 8) {
    for (let index = 0; index < payload.byteLength; index += 1) values.push(payload[index] ?? 0)
    return values
  }
  for (let index = 0; index + 1 < payload.byteLength; index += 2) {
    values.push(((payload[index] ?? 0) << 8) | (payload[index + 1] ?? 0))
  }
  return values
}

describe('DICOM JPEG and JPEG 2000 codestreams', () => {
  it('decodes JPEG Baseline 8-bit without requiring JFIF and matches jpeg-js', async () => {
    const source = Uint8Array.from({ length: 32 }, (_, index) => (index * 7) & 0xff)
    const withJfif = await encodeGrayJpeg(8, 4, source, 92)
    const withoutJfif = stripJpegJfif(withJfif)
    expect(withoutJfif[2]).not.toBe(0xe0)
    const dataset = await openBytes(
      encapsulated(jpegBaseline8BitUid, {
        bitsAllocated: 8,
        rows: 4,
        columns: 8,
        frame: withoutJfif,
      }),
    )
    const values = await planeSamples(dataset)
    expect(values).toHaveLength(32)
    let jpegJsReference: number[] | undefined
    try {
      const oracle = jpeg.decode(Buffer.from(withJfif), {
        useTArray: true,
        formatAsRGBA: false,
        tolerantDecoding: false,
      })
      const channels = Math.max(1, Math.floor(oracle.data.byteLength / 32))
      jpegJsReference = []
      for (let index = 0; index < 32; index += 1) {
        jpegJsReference.push(oracle.data[index * channels] ?? 0)
      }
    } catch {
      jpegJsReference = undefined
    }
    if (jpegJsReference !== undefined) {
      for (let index = 0; index < values.length; index += 1) {
        expect(Math.abs((values[index] ?? 0) - (jpegJsReference[index] ?? 0))).toBeLessThanOrEqual(
          1,
        )
      }
    }
    const decoder = jpegCodec.createDecoder
    if (decoder === undefined) throw new Error('JPEG decoder missing')
    const ordinary = await decoder(new MemorySource(withJfif), {
      maxWidth: 64,
      maxHeight: 64,
      maxPixels: 4096,
      maxInputBytes: withJfif.byteLength,
      maxFrames: 1,
      maxDecodedBytes: 4096,
    })
    const ordinaryGray: number[] = []
    for await (const block of ordinary.decode()) {
      for (let row = 0; row < block.height; row += 1) {
        for (let column = 0; column < block.width; column += 1) {
          ordinaryGray.push(block.data[row * block.stride + column * 3] ?? 0)
        }
      }
    }
    expect(values).toEqual(ordinaryGray)
  })

  it('decodes JPEG 2000 Lossless 16-bit stored samples from a raw codestream', async () => {
    const native = decodeJpeg2000NativeGrayFrame(losslessGray16)
    expect(native).toMatchObject({
      width: 9,
      height: 7,
      precision: 16,
      signed: false,
      reversibleTransform: true,
      unquantized: true,
      bitPreserving: true,
    })
    const samples: number[] = []
    for (let index = 0; index < native.samplesLittleEndian.byteLength; index += 2) {
      samples.push(
        (native.samplesLittleEndian[index] ?? 0) |
          ((native.samplesLittleEndian[index + 1] ?? 0) << 8),
      )
    }
    expect(samples[0]).toBe(0)
    expect(samples[samples.length - 1]).toBe(65535)
    const magick = magickGraySamples('benchmark/corpus/files/jp2/openjpeg-lossless-gray16.jp2', 16)
    if (magick !== undefined) expect(samples).toEqual(magick)
    const dataset = await openBytes(
      encapsulated(jpeg2000LosslessUid, {
        bitsAllocated: 16,
        bitsStored: 16,
        rows: 7,
        columns: 9,
        frame: losslessGray16,
      }),
    )
    expect(dataset.descriptor.sampleType).toBe('uint16')
    expect(await planeSamples(dataset)).toEqual(samples)
  })

  it('decodes JPEG 2000 lossy 8-bit stored samples within an independent tolerance', async () => {
    const native = decodeJpeg2000NativeGrayFrame(lossyGray8)
    expect(native).toMatchObject({
      width: 8,
      height: 6,
      precision: 8,
      signed: false,
      reversibleTransform: false,
      unquantized: false,
      bitPreserving: false,
    })
    const dataset = await openBytes(
      encapsulated(jpeg2000Uid, {
        bitsAllocated: 8,
        rows: 6,
        columns: 8,
        frame: lossyGray8,
      }),
    )
    const values = await planeSamples(dataset)
    expect(values).toEqual([...native.samplesLittleEndian])
    const magick = magickGraySamples('tests/fixtures/dicom/lossy-gray8.j2k', 8)
    if (magick !== undefined) {
      expect(values).toHaveLength(magick.length)
      for (let index = 0; index < values.length; index += 1) {
        expect(Math.abs((values[index] ?? 0) - (magick[index] ?? 0))).toBeLessThanOrEqual(3)
      }
    }
  })

  it('decodes JPEG Lossless SV1 stored samples without changing signed 16-bit bits', async () => {
    const unsigned = [0, 16, 32, 48, 64, 80, 96, 112]
    const encoded = encodeJpegLosslessGray(4, 2, unsigned)
    const dataset = await openBytes(
      encapsulated(jpegLosslessSv1Uid, {
        bitsAllocated: 8,
        rows: 2,
        columns: 4,
        frame: encoded,
      }),
    )
    expect(await planeSamples(dataset)).toEqual(unsigned)

    const stored = [0xfffe, 0xffff, 0, 1]
    const signedFrame = encodeJpegLosslessGray(2, 2, stored, { precision: 16 })
    const signedDataset = await openBytes(
      encapsulated(jpegLosslessSv1Uid, {
        bitsAllocated: 16,
        signed: true,
        rows: 2,
        columns: 2,
        frame: signedFrame,
      }),
    )
    expect(signedDataset.descriptor.sampleType).toBe('int16')
    expect(await planeSamples(signedDataset)).toEqual([-2, -1, 0, 1])
  })

  it('rejects DICOM JPEG Lossless SV1 frames whose SOS declares a nonzero point transform', async () => {
    const encoded = encodeJpegLosslessGray(2, 2, [1, 2, 3, 4])
    expect(
      await planeSamples(
        await openBytes(
          encapsulated(jpegLosslessSv1Uid, {
            bitsAllocated: 8,
            rows: 2,
            columns: 2,
            frame: encoded,
          }),
        ),
      ),
    ).toEqual([1, 2, 3, 4])
    const mutated = Uint8Array.from(encoded)
    let sawSos = false
    for (let index = 0; index + 1 < mutated.byteLength; index += 1) {
      if (mutated[index] !== 0xff || mutated[index + 1] !== 0xda) continue
      const length = ((mutated[index + 2] ?? 0) << 8) | (mutated[index + 3] ?? 0)
      mutated[index + 1 + length] = ((mutated[index + 1 + length] ?? 0) & 0xf0) | 1
      sawSos = true
      break
    }
    expect(sawSos).toBe(true)
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpegLosslessSv1Uid, {
            bitsAllocated: 8,
            rows: 2,
            columns: 2,
            frame: mutated,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/point transform/),
    })
  })

  it('rejects JPEG Baseline 16-bit, JPEG 2000 metadata mismatch, and remaining medical JPEG syntaxes', async () => {
    const jpeg = await encodeGrayJpeg(2, 1, Uint8Array.of(10, 20), 95)
    await expect(
      openBytes(
        encapsulated(jpegBaseline8BitUid, {
          bitsAllocated: 16,
          rows: 1,
          columns: 2,
          frame: jpeg,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringMatching(/8-bit/),
    })
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpeg2000LosslessUid, {
            bitsAllocated: 16,
            bitsStored: 16,
            rows: 7,
            columns: 8,
            frame: losslessGray16,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/does not match/),
    })
    await expect(
      createDicomReader().open({
        primary: {
          id: 'primary',
          name: 'jpeg-ls.dcm',
          source: new MemorySource(
            writeDicomPart10({
              transferSyntax: 'explicit-vr-le',
              transferSyntaxUid: '1.2.840.10008.1.2.4.80',
              dataset: [
                { tag: dicomTag.rows, vr: 'US', value: dicomUInt16Bytes(1) },
                { tag: dicomTag.columns, vr: 'US', value: dicomUInt16Bytes(1) },
              ],
            }),
          ),
        },
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('1.2.840.10008.1.2.4.80'),
    })
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpegLosslessSv1Uid, {
            bitsAllocated: 8,
            rows: 1,
            columns: 2,
            frame: encodeJpegLosslessGray(2, 1, [8, 9], { selection: 2 }),
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringMatching(/selection value 2/),
    })
  })

  it('repacks 8-bit JPEG Lossless and JPEG 2000 samples into 16-bit DICOM containers', async () => {
    expect(packDicomCodecSamples(Uint8Array.of(0, 127, 128, 255), 8, grayContainer16())).toEqual(
      Uint8Array.of(0, 0, 127, 0, 128, 0, 255, 0),
    )
    const lossless8 = encodeJpegLosslessGray(2, 2, [0, 127, 128, 255])
    const losslessDataset = await openBytes(
      encapsulated(jpegLosslessSv1Uid, {
        bitsAllocated: 16,
        bitsStored: 8,
        rows: 2,
        columns: 2,
        frame: lossless8,
      }),
    )
    expect(losslessDataset.descriptor.sampleType).toBe('uint16')
    expect(await planeSamples(losslessDataset)).toEqual([0, 127, 128, 255])
    const signedLossless = encodeJpegLosslessGray(2, 2, [0x80, 0xff, 0x00, 0x7f])
    const signedDataset = await openBytes(
      encapsulated(jpegLosslessSv1Uid, {
        bitsAllocated: 16,
        bitsStored: 8,
        signed: true,
        rows: 2,
        columns: 2,
        frame: signedLossless,
      }),
    )
    expect(signedDataset.descriptor.sampleType).toBe('int16')
    expect(await planeSamples(signedDataset)).toEqual([-128, -1, 0, 127])
    const jpeg2000LosslessNative = decodeJpeg2000NativeGrayFrame(losslessGray8)
    expect(jpeg2000LosslessNative).toMatchObject({
      width: 2,
      height: 2,
      precision: 8,
      signed: false,
      reversibleTransform: true,
      unquantized: true,
      bitPreserving: true,
    })
    expect([...jpeg2000LosslessNative.samplesLittleEndian]).toEqual([0, 127, 128, 255])
    const jpeg2000Lossless8in16 = await openBytes(
      encapsulated(jpeg2000LosslessUid, {
        bitsAllocated: 16,
        bitsStored: 8,
        rows: 2,
        columns: 2,
        frame: losslessGray8,
      }),
    )
    expect(jpeg2000Lossless8in16.descriptor.sampleType).toBe('uint16')
    expect(await planeSamples(jpeg2000Lossless8in16)).toEqual([0, 127, 128, 255])
    const lossy8in16 = await openBytes(
      encapsulated(jpeg2000Uid, {
        bitsAllocated: 16,
        bitsStored: 8,
        rows: 6,
        columns: 8,
        frame: lossyGray8,
      }),
    )
    const native8 = decodeJpeg2000NativeGrayFrame(lossyGray8)
    expect(lossy8in16.descriptor.sampleType).toBe('uint16')
    expect(await planeSamples(lossy8in16)).toEqual([...native8.samplesLittleEndian])
  })

  it('rejects JPEG Baseline codestreams that are not Process 1 grayscale', async () => {
    const rgb = await encodeRgbJpeg(1, 1, Uint8Array.of(10, 20, 30))
    expect(inspectJpegCodestream(rgb).componentCount).toBeGreaterThan(1)
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpegBaseline8BitUid, {
            bitsAllocated: 8,
            rows: 1,
            columns: 1,
            photometric: 'MONOCHROME2',
            frame: rgb,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/exactly one component/),
    })
    const sof2 = Uint8Array.of(
      0xff,
      0xd8,
      0xff,
      0xc2,
      0x00,
      0x0b,
      8,
      0x00,
      0x01,
      0x00,
      0x02,
      1,
      1,
      0x11,
      0,
      0xff,
      0xda,
      0x00,
      0x08,
      1,
      1,
      0,
      0,
      0x3f,
      0,
      0,
      0xff,
      0xd9,
    )
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpegBaseline8BitUid, {
            bitsAllocated: 8,
            rows: 1,
            columns: 2,
            frame: sof2,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/requires SOF0/),
    })
    const sof1 = Uint8Array.from(sof2)
    sof1[3] = 0xc1
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpegBaseline8BitUid, {
            bitsAllocated: 8,
            rows: 1,
            columns: 2,
            frame: sof1,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/requires SOF0/),
    })
    const gray = await encodeGrayJpeg(2, 1, Uint8Array.of(10, 20), 95)
    expect(inspectJpegCodestream(gray).sofMarker).toBe(0xc0)
    expect(inspectJpegCodestream(gray).componentCount).toBe(1)
    const withoutEoi = gray.subarray(0, gray.byteLength - 2)
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpegBaseline8BitUid, {
            bitsAllocated: 8,
            rows: 1,
            columns: 2,
            frame: withoutEoi,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/missing EOI/),
    })
    const extraAfterEoi = new Uint8Array(gray.byteLength + 1)
    extraAfterEoi.set(gray)
    extraAfterEoi[gray.byteLength] = 0x01
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpegBaseline8BitUid, {
            bitsAllocated: 8,
            rows: 1,
            columns: 2,
            frame: extraAfterEoi,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/invalid bytes after EOI/),
    })
    const padded = new Uint8Array(gray.byteLength + 1)
    padded.set(gray)
    const paddedDataset = await openBytes(
      encapsulated(jpegBaseline8BitUid, {
        bitsAllocated: 8,
        rows: 1,
        columns: 2,
        frame: padded,
      }),
    )
    expect(await planeSamples(paddedDataset)).toHaveLength(2)
  })

  it('allows a JPEG Baseline frame split across BOT fragments', async () => {
    const samples = Uint8Array.of(0, 40, 80, 120, 160, 180, 200, 220)
    const jpeg = await encodeGrayJpeg(4, 2, samples, 90)
    const split = jpeg.byteLength & ~1
    const first = jpeg.subarray(0, Math.max(2, split / 2) & ~1)
    const second = jpeg.subarray(first.byteLength)
    const dataset = await openBytes(
      encapsulated(jpegBaseline8BitUid, {
        bitsAllocated: 8,
        rows: 2,
        columns: 4,
        frame: jpeg,
        fragments: [first, second],
        offsetTable: 'basic',
      }),
    )
    expect(await planeSamples(dataset)).toHaveLength(8)
  })

  it('rejects JPEG Lossless frames that lack a single terminated SOF3 scan', async () => {
    const encoded = encodeJpegLosslessGray(2, 2, [0, 127, 128, 255])
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpegLosslessSv1Uid, {
            bitsAllocated: 8,
            rows: 2,
            columns: 2,
            frame: encoded.subarray(0, encoded.byteLength - 2),
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/missing EOI/),
    })
    const extra = new Uint8Array(encoded.byteLength + 1)
    extra.set(encoded)
    extra[encoded.byteLength] = 0x01
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpegLosslessSv1Uid, {
            bitsAllocated: 8,
            rows: 2,
            columns: 2,
            frame: extra,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/invalid bytes after EOI/),
    })
    const concatenated = new Uint8Array(encoded.byteLength * 2)
    concatenated.set(encoded)
    concatenated.set(encoded, encoded.byteLength)
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpegLosslessSv1Uid, {
            bitsAllocated: 8,
            rows: 2,
            columns: 2,
            frame: concatenated,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/invalid bytes after EOI/),
    })
    const oddCodestream =
      (encoded.byteLength & 1) === 1 ? encoded : insertJpegFillBeforeEoi(encoded, 1)
    const padded = new Uint8Array(oddCodestream.byteLength + 1)
    padded.set(oddCodestream)
    expect(
      await planeSamples(
        await openBytes(
          encapsulated(jpegLosslessSv1Uid, {
            bitsAllocated: 8,
            rows: 2,
            columns: 2,
            frame: padded,
          }),
        ),
      ),
    ).toEqual([0, 127, 128, 255])
  })

  it('rejects JPEG 2000 frames that do not end at EOC except for one zero pad', async () => {
    const native = decodeJpeg2000NativeGrayFrame(losslessGray8)
    expect([...native.samplesLittleEndian]).toEqual([0, 127, 128, 255])
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpeg2000LosslessUid, {
            bitsAllocated: 16,
            bitsStored: 8,
            rows: 2,
            columns: 2,
            frame: losslessGray8.subarray(0, losslessGray8.byteLength - 2),
          }),
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/EOC/),
    })
    const evenZeroPad = new Uint8Array(losslessGray8.byteLength + 1)
    evenZeroPad.set(losslessGray8)
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpeg2000LosslessUid, {
            bitsAllocated: 16,
            bitsStored: 8,
            rows: 2,
            columns: 2,
            frame: evenZeroPad,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/invalid bytes after EOC/),
    })
    const extra = new Uint8Array(losslessGray8.byteLength + 1)
    extra.set(losslessGray8)
    extra[losslessGray8.byteLength] = 0x01
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpeg2000LosslessUid, {
            bitsAllocated: 16,
            bitsStored: 8,
            rows: 2,
            columns: 2,
            frame: extra,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/invalid bytes after EOC/),
    })
    const concatenated = new Uint8Array(losslessGray8.byteLength * 2)
    concatenated.set(losslessGray8)
    concatenated.set(losslessGray8, losslessGray8.byteLength)
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpeg2000LosslessUid, {
            bitsAllocated: 16,
            bitsStored: 8,
            rows: 2,
            columns: 2,
            frame: concatenated,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/invalid bytes after EOC/),
    })
    const lossyNative = decodeJpeg2000NativeGrayFrame(lossyGray8)
    const paddedLossy = new Uint8Array(lossyGray8.byteLength + 1)
    paddedLossy.set(lossyGray8)
    const paddedDataset = await openBytes(
      encapsulated(jpeg2000Uid, {
        bitsAllocated: 16,
        bitsStored: 8,
        rows: 6,
        columns: 8,
        frame: paddedLossy,
      }),
    )
    expect(await planeSamples(paddedDataset)).toEqual([...lossyNative.samplesLittleEndian])
    const losslessAgain = await openBytes(
      encapsulated(jpeg2000LosslessUid, {
        bitsAllocated: 16,
        bitsStored: 8,
        rows: 2,
        columns: 2,
        frame: losslessGray8,
      }),
    )
    expect(await planeSamples(losslessAgain)).toEqual([0, 127, 128, 255])
  })

  it('qualifies JPEG 2000 lossless from each tile component, quantization, and coding passes', async () => {
    const lossless = decodeJpeg2000NativeGrayFrame(losslessGray8)
    expect(lossless).toMatchObject({
      reversibleTransform: true,
      unquantized: true,
      bitPreserving: true,
    })
    expect([...lossless.samplesLittleEndian]).toEqual([0, 127, 128, 255])

    const irreversibleCoc = jpeg2000WithIrreversibleComponentCoc(losslessGray8)
    const irreversibleNative = decodeJpeg2000NativeGrayFrame(irreversibleCoc)
    expect(irreversibleNative).toMatchObject({
      reversibleTransform: false,
      unquantized: true,
      bitPreserving: false,
    })
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpeg2000LosslessUid, {
            bitsAllocated: 16,
            bitsStored: 8,
            rows: 2,
            columns: 2,
            frame: irreversibleCoc,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/irreversible component transform/),
    })
    expect(
      await planeSamples(
        await openBytes(
          encapsulated(jpeg2000Uid, {
            bitsAllocated: 16,
            bitsStored: 8,
            rows: 2,
            columns: 2,
            frame: irreversibleCoc,
          }),
        ),
      ),
    ).toEqual([...irreversibleNative.samplesLittleEndian])

    const quantized = jpeg2000WithScalarQuantization(losslessGray8)
    const quantizedNative = decodeJpeg2000NativeGrayFrame(quantized)
    expect(quantizedNative).toMatchObject({
      reversibleTransform: true,
      unquantized: false,
      bitPreserving: false,
    })
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpeg2000LosslessUid, {
            bitsAllocated: 16,
            bitsStored: 8,
            rows: 2,
            columns: 2,
            frame: quantized,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/quantized codestream/),
    })
    expect(
      await planeSamples(
        await openBytes(
          encapsulated(jpeg2000Uid, {
            bitsAllocated: 16,
            bitsStored: 8,
            rows: 2,
            columns: 2,
            frame: quantized,
          }),
        ),
      ),
    ).toEqual([...quantizedNative.samplesLittleEndian])

    const truncated = jpeg2000WithTruncatedCodingPasses(losslessGray8)
    const truncatedNative = decodeJpeg2000NativeGrayFrame(truncated)
    expect(truncatedNative).toMatchObject({
      reversibleTransform: true,
      unquantized: true,
      bitPreserving: false,
    })
    await expect(
      planeSamples(
        await openBytes(
          encapsulated(jpeg2000LosslessUid, {
            bitsAllocated: 16,
            bitsStored: 8,
            rows: 2,
            columns: 2,
            frame: truncated,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/rate-truncated/),
    })
    expect(
      await planeSamples(
        await openBytes(
          encapsulated(jpeg2000Uid, {
            bitsAllocated: 16,
            bitsStored: 8,
            rows: 2,
            columns: 2,
            frame: truncated,
          }),
        ),
      ),
    ).toEqual([...truncatedNative.samplesLittleEndian])
  })

  it('rejects an empty encoded fragment between JPEG Baseline fragments', async () => {
    const samples = Uint8Array.of(0, 40, 80, 120, 160, 180, 200, 220)
    const jpeg = await encodeGrayJpeg(4, 2, samples, 90)
    const split = jpeg.byteLength & ~1
    const first = jpeg.subarray(0, Math.max(2, split / 2) & ~1)
    const second = jpeg.subarray(first.byteLength)
    await expect(
      openBytes(
        encapsulated(jpegBaseline8BitUid, {
          bitsAllocated: 8,
          rows: 2,
          columns: 4,
          frame: jpeg,
          fragments: [first, new Uint8Array(), second],
          offsetTable: 'basic',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/Value Length of at least 2/),
    })
  })
})
