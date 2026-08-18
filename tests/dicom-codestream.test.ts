import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { jpegCodec } from '../src/codecs/jpeg.ts'
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
import { createDicomReader } from '../src/scientific/readers/dicom.ts'
import { readRasterSample } from '../src/scientific/samples.ts'
import { MemorySource } from '../src/source.ts'
import { encodeGrayJpeg, stripJpegJfif } from './dicom/jpeg-encode.ts'
import { encodeJpegLosslessGray } from './dicom/jpeg-lossless-encode.ts'
import {
  dicomEncapsulatedFragments,
  dicomTextBytes,
  dicomUInt16Bytes,
  writeDicomPart10,
} from './dicom/part10-writer.ts'

const losslessGray16 = readFileSync('tests/fixtures/dicom/lossless-gray16.j2k')
const lossyGray8 = readFileSync('tests/fixtures/dicom/lossy-gray8.j2k')

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
  },
): Uint8Array =>
  writeDicomPart10({
    transferSyntax: 'explicit-vr-le',
    transferSyntaxUid,
    dataset: [
      { tag: dicomTag.sopClassUid, vr: 'UI', value: dicomTextBytes('1.2.840.10008.5.1.4.1.1.7') },
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
        fragments: dicomEncapsulatedFragments([[options.frame]], 'empty'),
      },
    ],
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
    const oracle = jpeg.decode(Buffer.from(withJfif), {
      useTArray: true,
      formatAsRGBA: false,
      tolerantDecoding: false,
    })
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
    const channels = Math.max(1, Math.floor(oracle.data.byteLength / 32))
    const reference: number[] = []
    for (let index = 0; index < 32; index += 1) {
      reference.push(oracle.data[index * channels] ?? 0)
    }
    for (let index = 0; index < values.length; index += 1) {
      expect(Math.abs((values[index] ?? 0) - (reference[index] ?? 0))).toBeLessThanOrEqual(1)
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
      reversible: true,
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
      reversible: false,
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
            rows: 2,
            columns: 1,
            frame: encodeJpegLosslessGray(2, 1, [8, 9], { selection: 2 }),
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringMatching(/selection value 2/),
    })
  })
})
