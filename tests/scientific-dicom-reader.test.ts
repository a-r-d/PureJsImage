import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ImageError } from '../src/errors.ts'
import { rasterSampleBytes } from '../src/raster.ts'
import type { ScientificDataset } from '../src/scientific/dataset.ts'
import {
  dicomTag,
  encapsulatedUncompressedExplicitVrLittleEndianUid,
  rleLosslessUid,
} from '../src/scientific/formats/dicom/constants.ts'
import { parseDicomPart10 } from '../src/scientific/formats/dicom/parser.ts'
import {
  applyDicomModalityTransform,
  applyDicomVoiWindow,
} from '../src/scientific/formats/dicom/presentation.ts'
import { createScientificLibrary } from '../src/scientific/library.ts'
import { createDicomReader, dicomReader } from '../src/scientific/readers/dicom.ts'
import { readRasterSample } from '../src/scientific/samples.ts'
import { BlobSource, type ImageSource, type ImageSourceReadOptions } from '../src/source.ts'
import { readDicomOraclePixels } from './dicom/oracle.ts'
import {
  type DicomWriteElement,
  type DicomWriteTransferSyntax,
  dicomDecimalBytes,
  dicomEncapsulatedFragments,
  dicomInt16Bytes,
  dicomTextBytes,
  dicomUInt16Bytes,
  dicomUInt64Bytes,
  writeDicomPart10,
} from './dicom/part10-writer.ts'
import { encodeDicomRleFrame } from './dicom/rle-encode.ts'
import { rangesOverlap, TrackingSource } from './dicom/tracking-source.ts'

const hashBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

class CountingSource implements ImageSource {
  readonly size: number
  readonly reads: { readonly offset: number; readonly length: number }[] = []
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    if (options.signal?.aborted === true) throw options.signal.reason
    this.reads.push(Object.freeze({ offset, length }))
    return this.#bytes.slice(offset, Math.min(this.size, offset + length))
  }
}

const grayscaleDataset = (options: {
  readonly photometric?: 'MONOCHROME1' | 'MONOCHROME2'
  readonly bitsAllocated: 8 | 16
  readonly bitsStored?: number
  readonly signed?: boolean
  readonly rows: number
  readonly columns: number
  readonly frames?: number
  readonly spacing?: readonly [number, number]
  readonly pixels: Uint8Array
  readonly extras?: readonly DicomWriteElement[]
}): DicomWriteElement[] => [
  { tag: dicomTag.sopClassUid, vr: 'UI', value: dicomTextBytes('1.2.840.10008.5.1.4.1.1.7') },
  {
    tag: dicomTag.sopInstanceUid,
    vr: 'UI',
    value: dicomTextBytes('1.2.826.0.1.3680043.10.850.1.2'),
  },
  { tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('OT') },
  {
    tag: dicomTag.samplesPerPixel,
    vr: 'US',
    value: dicomUInt16Bytes(1),
  },
  {
    tag: dicomTag.photometricInterpretation,
    vr: 'CS',
    value: dicomTextBytes(options.photometric ?? 'MONOCHROME2'),
  },
  ...(options.frames === undefined
    ? []
    : [
        {
          tag: dicomTag.numberOfFrames,
          vr: 'IS' as const,
          value: dicomTextBytes(String(options.frames)),
        },
      ]),
  { tag: dicomTag.rows, vr: 'US', value: dicomUInt16Bytes(options.rows) },
  { tag: dicomTag.columns, vr: 'US', value: dicomUInt16Bytes(options.columns) },
  ...(options.spacing === undefined
    ? []
    : [
        {
          tag: dicomTag.pixelSpacing,
          vr: 'DS' as const,
          value: dicomDecimalBytes(...options.spacing),
        },
      ]),
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
  ...(options.extras ?? []),
  { tag: dicomTag.pixelData, vr: options.bitsAllocated === 8 ? 'OB' : 'OW', value: options.pixels },
]

const part10 = (
  dataset: readonly DicomWriteElement[],
  transferSyntax: DicomWriteTransferSyntax = 'explicit-vr-le',
  transferSyntaxUid?: string,
): Uint8Array =>
  writeDicomPart10({
    transferSyntax,
    dataset,
    ...(transferSyntaxUid === undefined ? {} : { transferSyntaxUid }),
  })

const withEncapsulatedPixels = (
  options: Parameters<typeof grayscaleDataset>[0],
  frames: readonly (readonly Uint8Array[])[],
  offsetTable: 'empty' | 'basic' = 'empty',
): DicomWriteElement[] => {
  const elements = grayscaleDataset(options).filter((element) => element.tag !== dicomTag.pixelData)
  elements.push({
    tag: dicomTag.pixelData,
    vr: 'OB',
    fragments: dicomEncapsulatedFragments(frames, offsetTable),
  })
  return elements
}

const open = async (bytes: Uint8Array, name = 'synthetic.dcm') => {
  const source = new CountingSource(bytes)
  const document = await dicomReader.open({
    primary: { id: 'primary', name, source },
  })
  return { document, source, dataset: await document.openDataset(document.datasets[0]?.id ?? '') }
}

const planeSamples = async (
  dataset: ScientificDataset,
  frame = 0,
): Promise<{ readonly values: number[]; readonly bytes: Uint8Array }> => {
  const values: number[] = []
  const chunks: Uint8Array[] = []
  const hasFrame = dataset.descriptor.axes.some((axis) => axis.id === 'frame')
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: hasFrame ? [{ axisId: 'frame', index: frame }] : [],
  })) {
    chunks.push(block.data)
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
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { values, bytes }
}

describe('DICOM scientific reader', () => {
  it('reads unsigned 8-bit MONOCHROME2 stored samples and Pixel Spacing', async () => {
    const pixels = Uint8Array.of(0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33)
    const bytes = part10(
      grayscaleDataset({
        bitsAllocated: 8,
        rows: 4,
        columns: 4,
        spacing: [0.5, 0.4],
        pixels,
      }),
    )
    const { document, dataset } = await open(bytes)
    expect(document.metadata.photometricInterpretation).toBe('MONOCHROME2')
    expect(document.metadata.monochromeInverted).toBe(false)
    expect(dataset.descriptor.sampleType).toBe('uint8')
    expect(dataset.descriptor.axes.map((axis) => axis.id)).toEqual(['y', 'x'])
    expect(dataset.descriptor.axes[0]?.coordinates).toMatchObject({ type: 'linear', step: 0.5 })
    expect(dataset.descriptor.axes[1]?.coordinates).toMatchObject({ type: 'linear', step: 0.4 })
    const plane = await planeSamples(dataset)
    expect(plane.values).toEqual([...pixels])
    expect(hashBytes(plane.bytes)).toBe(hashBytes(pixels))
  })

  it('reads signed 16-bit and 12-bit-in-16 stored samples', async () => {
    const signed16 = part10(
      grayscaleDataset({
        bitsAllocated: 16,
        signed: true,
        rows: 2,
        columns: 2,
        pixels: dicomInt16Bytes(-32768, -1, 0, 32767),
      }),
    )
    const twelve = part10(
      grayscaleDataset({
        bitsAllocated: 16,
        bitsStored: 12,
        signed: true,
        rows: 2,
        columns: 2,
        pixels: dicomUInt16Bytes(0x0800, 0x0fff, 0x0000, 0x07ff),
      }),
    )
    const unsignedTwelve = part10(
      grayscaleDataset({
        bitsAllocated: 16,
        bitsStored: 12,
        rows: 1,
        columns: 4,
        pixels: dicomUInt16Bytes(0, 1, 2048, 4095),
      }),
    )
    expect((await planeSamples((await open(signed16)).dataset)).values).toEqual([
      -32768, -1, 0, 32767,
    ])
    expect((await planeSamples((await open(twelve)).dataset)).values).toEqual([-2048, -1, 0, 2047])
    const unsigned = await open(unsignedTwelve)
    expect(unsigned.dataset.descriptor.sampleType).toBe('uint16')
    expect((await planeSamples(unsigned.dataset)).values).toEqual([0, 1, 2048, 4095])
  })

  it('reads a selected multi-frame plane without reading prior frames', async () => {
    const frame0 = Uint8Array.of(1, 2, 3, 4)
    const frame1 = Uint8Array.of(9, 8, 7, 6)
    const pixels = new Uint8Array(8)
    pixels.set(frame0, 0)
    pixels.set(frame1, 4)
    const bytes = part10(
      grayscaleDataset({
        bitsAllocated: 8,
        rows: 2,
        columns: 2,
        frames: 2,
        pixels,
      }),
    )
    const source = new TrackingSource(bytes)
    const document = await dicomReader.open({
      primary: { id: 'primary', name: 'multi.dcm', source },
    })
    const dataset = await document.openDataset('frames')
    expect(dataset.descriptor.axes.map((axis) => axis.id)).toEqual(['frame', 'y', 'x'])
    const metadataReads = source.reads.length
    const plane = await planeSamples(dataset, 1)
    expect(plane.values).toEqual([9, 8, 7, 6])
    const pixelOffset = bytes.byteLength - 8
    const laterReads = source.reads.slice(metadataReads)
    expect(rangesOverlap(pixelOffset, pixelOffset + 4, laterReads)).toBe(false)
    expect(rangesOverlap(pixelOffset + 4, pixelOffset + 8, laterReads)).toBe(true)
  })

  it('reads implicit VR native grayscale and an in-memory File', async () => {
    const pixels = Uint8Array.of(4, 5, 6, 7)
    const bytes = part10(
      grayscaleDataset({ bitsAllocated: 8, rows: 2, columns: 2, pixels }),
      'implicit-vr-le',
    )
    const implicit = await open(bytes, 'implicit.dcm')
    expect((await planeSamples(implicit.dataset)).values).toEqual([4, 5, 6, 7])
    const file = new File([Uint8Array.from(bytes)], 'browser.dcm', { type: 'application/dicom' })
    const fromFile = await createScientificLibrary({ readers: [dicomReader] }).open({
      primary: { id: 'file', name: file.name, source: new BlobSource(file) },
    })
    expect(fromFile.metadata.transferSyntaxUid).toBe('1.2.840.10008.1.2')
  })

  it('exposes linear rescale and multiple VOI presets without changing stored samples', async () => {
    const pixels = Uint8Array.of(0, 64, 128, 255)
    const { document, dataset } = await open(
      part10(
        grayscaleDataset({
          bitsAllocated: 8,
          rows: 1,
          columns: 4,
          pixels,
          extras: [
            { tag: dicomTag.rescaleIntercept, vr: 'DS', value: dicomDecimalBytes(-1024) },
            { tag: dicomTag.rescaleSlope, vr: 'DS', value: dicomDecimalBytes(1) },
            { tag: dicomTag.rescaleType, vr: 'LO', value: dicomTextBytes('HU') },
            { tag: dicomTag.windowCenter, vr: 'DS', value: dicomDecimalBytes(40, -600) },
            { tag: dicomTag.windowWidth, vr: 'DS', value: dicomDecimalBytes(80, 1500) },
            {
              tag: dicomTag.windowCenterWidthExplanation,
              vr: 'LO',
              value: dicomTextBytes('SOFT_TISSUE\\LUNG'),
            },
            { tag: dicomTag.voiLutFunction, vr: 'CS', value: dicomTextBytes('LINEAR') },
          ],
        }),
      ),
    )
    expect(document.metadata.storedValueTransform).toEqual({
      kind: 'linear',
      slope: 1,
      intercept: -1024,
      type: 'HU',
    })
    expect(document.metadata.voiPresets).toEqual([
      { center: 40, width: 80, explanation: 'SOFT_TISSUE', function: 'LINEAR' },
      { center: -600, width: 1500, explanation: 'LUNG', function: 'LINEAR' },
    ])
    expect(dataset.descriptor.metadata?.storedValueTransform).toEqual(
      document.metadata.storedValueTransform,
    )
    const plane = await planeSamples(dataset)
    expect(plane.values).toEqual([0, 64, 128, 255])
    const transform = document.metadata.storedValueTransform
    const presets = document.metadata.voiPresets
    if (
      transform === null ||
      typeof transform !== 'object' ||
      Array.isArray(transform) ||
      !('slope' in transform) ||
      !('intercept' in transform) ||
      typeof transform.slope !== 'number' ||
      typeof transform.intercept !== 'number' ||
      !Array.isArray(presets)
    ) {
      throw new Error('expected rescale and VOI metadata')
    }
    const linear = {
      kind: 'linear' as const,
      slope: transform.slope,
      intercept: transform.intercept,
    }
    expect(plane.values.map((value) => applyDicomModalityTransform(value, linear))).toEqual([
      -1024, -960, -896, -769,
    ])
    const first = presets[0]
    if (
      first === null ||
      typeof first !== 'object' ||
      Array.isArray(first) ||
      typeof first.center !== 'number' ||
      typeof first.width !== 'number'
    ) {
      throw new Error('expected a LINEAR VOI preset')
    }
    expect(
      applyDicomVoiWindow(applyDicomModalityTransform(0, linear), {
        center: first.center,
        width: first.width,
        function: 'LINEAR',
      }),
    ).toBe(0)
  })

  it('uses shared functional-group rescale and spacing, and keeps conflicting frames raw', async () => {
    const shared = part10(
      grayscaleDataset({
        bitsAllocated: 8,
        rows: 1,
        columns: 2,
        pixels: Uint8Array.of(10, 20),
        extras: [
          {
            tag: dicomTag.sharedFunctionalGroupsSequence,
            vr: 'SQ',
            items: [
              [
                {
                  tag: dicomTag.pixelValueTransformationSequence,
                  vr: 'SQ',
                  items: [
                    [
                      { tag: dicomTag.rescaleIntercept, vr: 'DS', value: dicomDecimalBytes(0) },
                      { tag: dicomTag.rescaleSlope, vr: 'DS', value: dicomDecimalBytes(2) },
                      { tag: dicomTag.rescaleType, vr: 'LO', value: dicomTextBytes('US') },
                    ],
                  ],
                },
                {
                  tag: dicomTag.pixelMeasuresSequence,
                  vr: 'SQ',
                  items: [
                    [
                      {
                        tag: dicomTag.pixelSpacing,
                        vr: 'DS',
                        value: dicomDecimalBytes(0.8, 0.6),
                      },
                    ],
                  ],
                },
                {
                  tag: dicomTag.frameVoiLutSequence,
                  vr: 'SQ',
                  items: [
                    [
                      { tag: dicomTag.windowCenter, vr: 'DS', value: dicomDecimalBytes(100) },
                      { tag: dicomTag.windowWidth, vr: 'DS', value: dicomDecimalBytes(200) },
                    ],
                  ],
                },
              ],
            ],
          },
        ],
      }),
    )
    const sharedOpen = await open(shared)
    expect(sharedOpen.document.metadata.storedValueTransform).toEqual({
      kind: 'linear',
      slope: 2,
      intercept: 0,
      type: 'US',
    })
    expect(sharedOpen.document.metadata.pixelSpacingMm).toEqual({ row: 0.8, column: 0.6 })
    expect(sharedOpen.document.metadata.voiPresets).toEqual([
      { center: 100, width: 200, function: 'LINEAR' },
    ])
    expect(sharedOpen.dataset.descriptor.axes[0]?.coordinates).toMatchObject({
      type: 'linear',
      step: 0.8,
    })
    expect((await planeSamples(sharedOpen.dataset)).values).toEqual([10, 20])

    const conflicting = part10(
      grayscaleDataset({
        bitsAllocated: 8,
        rows: 1,
        columns: 2,
        frames: 2,
        pixels: Uint8Array.of(1, 2, 3, 4),
        extras: [
          {
            tag: dicomTag.perFrameFunctionalGroupsSequence,
            vr: 'SQ',
            items: [
              [
                {
                  tag: dicomTag.pixelValueTransformationSequence,
                  vr: 'SQ',
                  items: [
                    [
                      { tag: dicomTag.rescaleIntercept, vr: 'DS', value: dicomDecimalBytes(0) },
                      { tag: dicomTag.rescaleSlope, vr: 'DS', value: dicomDecimalBytes(1) },
                    ],
                  ],
                },
              ],
              [
                {
                  tag: dicomTag.pixelValueTransformationSequence,
                  vr: 'SQ',
                  items: [
                    [
                      { tag: dicomTag.rescaleIntercept, vr: 'DS', value: dicomDecimalBytes(10) },
                      { tag: dicomTag.rescaleSlope, vr: 'DS', value: dicomDecimalBytes(1) },
                    ],
                  ],
                },
              ],
            ],
          },
        ],
      }),
    )
    const conflictOpen = await open(conflicting)
    expect(conflictOpen.document.metadata.storedValueTransform).toBeUndefined()
    expect(conflictOpen.document.metadata.storedValueTransformConflict).toBe('inhomogeneous')
    expect((await planeSamples(conflictOpen.dataset, 0)).values).toEqual([1, 2])
    expect((await planeSamples(conflictOpen.dataset, 1)).values).toEqual([3, 4])

    const homogeneousFrame = [
      {
        tag: dicomTag.pixelValueTransformationSequence,
        vr: 'SQ' as const,
        items: [
          [
            { tag: dicomTag.rescaleIntercept, vr: 'DS' as const, value: dicomDecimalBytes(-1000) },
            { tag: dicomTag.rescaleSlope, vr: 'DS' as const, value: dicomDecimalBytes(1) },
          ],
        ],
      },
    ]
    const homogeneous = part10(
      grayscaleDataset({
        bitsAllocated: 8,
        rows: 1,
        columns: 2,
        frames: 2,
        pixels: Uint8Array.of(1, 2, 3, 4),
        extras: [
          {
            tag: dicomTag.perFrameFunctionalGroupsSequence,
            vr: 'SQ',
            items: [homogeneousFrame, homogeneousFrame],
          },
        ],
      }),
    )
    const same = await open(homogeneous)
    expect(same.document.metadata.storedValueTransform).toEqual({
      kind: 'linear',
      slope: 1,
      intercept: -1000,
    })
    expect(same.document.metadata.storedValueTransformConflict).toBeUndefined()
  })

  it('rejects Modality LUT and VOI LUT sequences', async () => {
    const modalityLut = part10(
      grayscaleDataset({
        bitsAllocated: 8,
        rows: 1,
        columns: 2,
        pixels: Uint8Array.of(1, 2),
        extras: [
          {
            tag: dicomTag.modalityLutSequence,
            vr: 'SQ',
            items: [[{ tag: dicomTag.rescaleType, vr: 'LO', value: dicomTextBytes('OD') }]],
          },
        ],
      }),
    )
    await expect(open(modalityLut)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('Modality LUT Sequence'),
    })
    const voiLut = part10(
      grayscaleDataset({
        bitsAllocated: 8,
        rows: 1,
        columns: 2,
        pixels: Uint8Array.of(1, 2),
        extras: [
          {
            tag: dicomTag.voiLutSequence,
            vr: 'SQ',
            items: [[{ tag: dicomTag.windowCenter, vr: 'DS', value: dicomDecimalBytes(40) }]],
          },
        ],
      }),
    )
    await expect(open(voiLut)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('VOI LUT Sequence'),
    })
  })

  it('records MONOCHROME1 inversion without changing stored samples', async () => {
    const pixels = Uint8Array.of(0, 255)
    const { document, dataset } = await open(
      part10(
        grayscaleDataset({
          photometric: 'MONOCHROME1',
          bitsAllocated: 8,
          rows: 1,
          columns: 2,
          pixels,
        }),
      ),
    )
    expect(document.metadata.monochromeInverted).toBe(true)
    expect((await planeSamples(dataset)).values).toEqual([0, 255])
  })

  it('rejects color and compressed transfer syntaxes with explicit unsupported errors', async () => {
    const color = part10([
      { tag: dicomTag.samplesPerPixel, vr: 'US', value: dicomUInt16Bytes(3) },
      { tag: dicomTag.photometricInterpretation, vr: 'CS', value: dicomTextBytes('RGB') },
      { tag: dicomTag.rows, vr: 'US', value: dicomUInt16Bytes(1) },
      { tag: dicomTag.columns, vr: 'US', value: dicomUInt16Bytes(1) },
      { tag: dicomTag.bitsAllocated, vr: 'US', value: dicomUInt16Bytes(8) },
      { tag: dicomTag.pixelData, vr: 'OB', value: Uint8Array.of(1, 2, 3) },
    ])
    await expect(open(color)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringMatching(/Samples per Pixel|Photometric/),
    })
    const jpeg = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      fileMeta: [
        {
          tag: dicomTag.transferSyntaxUid,
          vr: 'UI',
          value: dicomTextBytes('1.2.840.10008.1.2.4.80'),
        },
      ],
      dataset: grayscaleDataset({
        bitsAllocated: 8,
        rows: 1,
        columns: 2,
        pixels: Uint8Array.of(1, 2),
      }),
    })
    await expect(open(jpeg)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('1.2.840.10008.1.2.4.80'),
    })
    await expect(open(color)).rejects.toBeInstanceOf(ImageError)
  })

  it('reads encapsulated uncompressed frames without reading other fragments', async () => {
    const frame0 = Uint8Array.of(1, 2, 3, 4)
    const frame1a = Uint8Array.of(9, 8)
    const frame1b = Uint8Array.of(7, 6)
    const bytes = part10(
      withEncapsulatedPixels(
        { bitsAllocated: 8, rows: 2, columns: 2, frames: 2, pixels: Uint8Array.of(0, 0, 0, 0) },
        [[frame0], [frame1a, frame1b]],
        'basic',
      ),
      'explicit-vr-le',
      encapsulatedUncompressedExplicitVrLittleEndianUid,
    )
    const source = new TrackingSource(bytes)
    const document = await dicomReader.open({
      primary: { id: 'primary', name: 'encapsulated.dcm', source },
    })
    const dataset = await document.openDataset('frames')
    const parsed = await parseDicomPart10(new TrackingSource(bytes))
    const fragments = parsed.pixelData?.fragments ?? []
    const frame0Fragment = fragments[1]
    const frame1Start = fragments[2]
    const frame1End = fragments[3]
    if (frame0Fragment === undefined || frame1Start === undefined || frame1End === undefined) {
      throw new Error('expected BOT plus three pixel fragments')
    }
    const metadataReads = source.reads.length
    const plane = await planeSamples(dataset, 1)
    expect(plane.values).toEqual([9, 8, 7, 6])
    const laterReads = source.reads.slice(metadataReads)
    expect(
      rangesOverlap(
        frame0Fragment.valueOffset,
        frame0Fragment.valueOffset + frame0Fragment.valueLength,
        laterReads,
      ),
    ).toBe(false)
    expect(
      rangesOverlap(
        frame1Start.valueOffset,
        frame1End.valueOffset + frame1End.valueLength,
        laterReads,
      ),
    ).toBe(true)
  })

  it('indexes Extended Offset Table frames and rejects ambiguous empty tables', async () => {
    const frame0 = Uint8Array.of(4, 5, 6, 7)
    const frame1 = Uint8Array.of(8, 9, 10, 11)
    const fragments = dicomEncapsulatedFragments([[frame0], [frame1]], 'empty')
    const eot = part10(
      [
        ...withEncapsulatedPixels(
          { bitsAllocated: 8, rows: 2, columns: 2, frames: 2, pixels: Uint8Array.of(0, 0, 0, 0) },
          [[frame0], [frame1]],
          'empty',
        ).filter((element) => element.tag !== dicomTag.pixelData),
        {
          tag: dicomTag.extendedOffsetTable,
          vr: 'OV',
          value: dicomUInt64Bytes(0, 8 + frame0.byteLength),
        },
        {
          tag: dicomTag.extendedOffsetTableLengths,
          vr: 'OV',
          value: dicomUInt64Bytes(frame0.byteLength, frame1.byteLength),
        },
        { tag: dicomTag.pixelData, vr: 'OB', fragments },
      ],
      'explicit-vr-le',
      encapsulatedUncompressedExplicitVrLittleEndianUid,
    )
    expect((await planeSamples((await open(eot)).dataset, 1)).values).toEqual([8, 9, 10, 11])
    const ambiguous = part10(
      withEncapsulatedPixels(
        { bitsAllocated: 8, rows: 1, columns: 2, frames: 2, pixels: Uint8Array.of(0, 0) },
        [[Uint8Array.of(1), Uint8Array.of(2)], [Uint8Array.of(3, 4)]],
        'empty',
      ),
      'explicit-vr-le',
      encapsulatedUncompressedExplicitVrLittleEndianUid,
    )
    await expect(open(ambiguous)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringMatching(/empty offset table|ambiguous/),
    })
  })

  it('decodes RLE lossless stored samples without changing signedness', async () => {
    const unsigned = Uint8Array.of(0, 1, 2, 3)
    const signed = dicomInt16Bytes(-2, -1, 0, 1)
    const unsignedBytes = part10(
      withEncapsulatedPixels({ bitsAllocated: 8, rows: 2, columns: 2, pixels: unsigned }, [
        [encodeDicomRleFrame(unsigned, 8)],
      ]),
      'explicit-vr-le',
      rleLosslessUid,
    )
    const signedBytes = part10(
      withEncapsulatedPixels(
        { bitsAllocated: 16, signed: true, rows: 2, columns: 2, pixels: signed },
        [[encodeDicomRleFrame(signed, 16)]],
      ),
      'explicit-vr-le',
      rleLosslessUid,
    )
    const unsignedPlane = await planeSamples((await open(unsignedBytes)).dataset)
    const signedPlane = await planeSamples((await open(signedBytes)).dataset)
    expect(unsignedPlane.values).toEqual([0, 1, 2, 3])
    expect(signedPlane.values).toEqual([-2, -1, 0, 1])
    expect(hashBytes(unsignedPlane.bytes)).toBe(hashBytes(unsigned))
    const oracleDir = mkdtempSync(join(tmpdir(), 'purejsimage-dicom-rle-'))
    const oraclePath = join(oracleDir, 'rle.dcm')
    writeFileSync(oraclePath, unsignedBytes)
    const oracle = readDicomOraclePixels(oraclePath)
    if (oracle.available) expect(oracle.pixels).toEqual([0, 1, 2, 3])
  })

  it('probes Part 10 files and honors tighter decoded-frame limits', async () => {
    const pixels = Uint8Array.of(1, 2, 3, 4)
    const bytes = part10(grayscaleDataset({ bitsAllocated: 8, rows: 2, columns: 2, pixels }))
    const hinted = await dicomReader.probe({
      primary: { id: 'primary', name: 'ct.dcm', source: new TrackingSource(bytes) },
    })
    expect(hinted.confidence).toBe(1)
    const limited = createDicomReader({ limits: { maxDecodedFrameBytes: 2 } })
    await expect(
      limited.open({
        primary: { id: 'primary', name: 'ct.dcm', source: new TrackingSource(bytes) },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})
