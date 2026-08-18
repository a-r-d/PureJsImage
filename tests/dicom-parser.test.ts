import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ImageError } from '../src/errors.ts'
import {
  decodeDicomText,
  decodeDicomUInt16Values,
  decodeDicomUid,
  dicomTag,
  encapsulatedUncompressedExplicitVrLittleEndianUid,
  explicitVrLittleEndianUid,
  findDicomElement,
  implicitVrLittleEndianUid,
  lookupDicomDictionary,
  parseDicomPart10,
} from '../src/scientific/formats/dicom/parser.ts'
import { BlobSource } from '../src/source.ts'
import {
  type DicomWriteElement,
  dicomEncapsulatedFragments,
  dicomIdentityElements,
  dicomMonochromePixelElements,
  dicomTestSopClassUid,
  dicomTextBytes,
  dicomUInt16Bytes,
  writeDicomPart10,
} from './dicom/part10-writer.ts'
import {
  writeExplicitElement,
  writeItemDelimitation,
  writeItemStart,
  writeRawFileMeta,
  writeRawGrayscaleIdentity,
  writeRawPart10Bytes,
  writeRawPart10Preamble,
  writeSequenceDelimitation,
  writeUndefinedLengthUn,
  writeUidBytes,
} from './dicom/raw-part10.ts'
import { rangesOverlap, TrackingSource } from './dicom/tracking-source.ts'

const pixelPlaceholder = (bytes: number, fill: number): Uint8Array =>
  Uint8Array.from({ length: bytes }, () => fill)

const technicalDataset = (
  extras: readonly DicomWriteElement[] = [],
  pixel: Uint8Array = pixelPlaceholder(32, 0xab),
): DicomWriteElement[] => [
  ...dicomIdentityElements(),
  { tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('OT') },
  { tag: 0x0008_0020, vr: 'DA', value: dicomTextBytes('20260101') },
  ...dicomMonochromePixelElements({ rows: 4, columns: 4, bitsAllocated: 16 }),
  ...extras,
  { tag: dicomTag.pixelData, vr: 'OW', value: pixel },
]

const parse = (bytes: Uint8Array, options?: Parameters<typeof parseDicomPart10>[1]) =>
  parseDicomPart10(new TrackingSource(bytes), options)

describe('DICOM Part 10 parser', () => {
  it('parses Explicit VR Little Endian File Meta Information and dataset tags', async () => {
    const bytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: technicalDataset(),
    })
    const source = new TrackingSource(bytes)
    const parsed = await parseDicomPart10(source)
    expect(parsed.transferSyntaxUid).toBe(explicitVrLittleEndianUid)
    expect(parsed.transferSyntax.explicitVr).toBe(true)
    expect(parsed.fileMeta.endOffset).toBeGreaterThan(132)
    const firstDataset = parsed.dataset.elements[0]
    expect(firstDataset?.tag).toBe(dicomTag.sopClassUid)
    expect(parsed.fileMeta.endOffset).toBe(firstDataset?.headerOffset)
    expect(
      decodeDicomUid(
        findDicomElement(parsed.dataset.elements, dicomTag.sopClassUid)?.value ?? new Uint8Array(),
        'SOP Class UID',
      ),
    ).toBe('1.2.840.10008.5.1.4.1.1.7')
    expect(
      decodeDicomText(
        findDicomElement(parsed.dataset.elements, dicomTag.modality)?.value ?? new Uint8Array(),
      ),
    ).toBe('OT')
    expect(
      decodeDicomUInt16Values(
        findDicomElement(parsed.dataset.elements, dicomTag.rows)?.value ?? new Uint8Array(),
      ),
    ).toEqual([4])
    const studyDate = findDicomElement(parsed.dataset.elements, 0x0008_0020)
    expect(studyDate?.keyword).toBe('StudyDate')
    expect(studyDate?.known).toBe(true)
    expect(studyDate?.value).toBeUndefined()
    expect(parsed.pixelData?.encapsulated).toBe(false)
    expect(parsed.pixelData?.valueLength).toBe(32)
    expect(
      rangesOverlap(
        parsed.pixelData?.valueOffset ?? 0,
        (parsed.pixelData?.valueOffset ?? 0) + 32,
        source.reads,
      ),
    ).toBe(false)
    expect(source.reads.reduce((sum, read) => sum + read.length, 0)).toBe(
      parsed.stats.sourceBytesRead,
    )
  })

  it('indexes encapsulated fragments without reading their payloads', async () => {
    const payload = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)
    const bytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      transferSyntaxUid: encapsulatedUncompressedExplicitVrLittleEndianUid,
      dataset: [
        { tag: dicomTag.rows, vr: 'US', value: dicomUInt16Bytes(2) },
        { tag: dicomTag.columns, vr: 'US', value: dicomUInt16Bytes(4) },
        {
          tag: dicomTag.pixelData,
          vr: 'OB',
          fragments: dicomEncapsulatedFragments([[payload]], 'empty'),
        },
      ],
    })
    const source = new TrackingSource(bytes)
    const parsed = await parseDicomPart10(source)
    expect(parsed.pixelData?.encapsulated).toBe(true)
    expect(parsed.pixelData?.fragments).toHaveLength(2)
    const pixelFragment = parsed.pixelData?.fragments?.[1]
    if (pixelFragment === undefined) throw new Error('expected a pixel fragment')
    expect(pixelFragment.valueLength).toBe(8)
    expect(
      rangesOverlap(
        pixelFragment.valueOffset,
        pixelFragment.valueOffset + pixelFragment.valueLength,
        source.reads,
      ),
    ).toBe(false)
  })

  it('parses Implicit VR Little Endian datasets using the generated dictionary', async () => {
    const bytes = writeDicomPart10({
      transferSyntax: 'implicit-vr-le',
      dataset: technicalDataset(),
    })
    const parsed = await parse(bytes)
    expect(parsed.transferSyntaxUid).toBe(implicitVrLittleEndianUid)
    expect(parsed.transferSyntax.explicitVr).toBe(false)
    expect(findDicomElement(parsed.dataset.elements, dicomTag.sopInstanceUid)?.vr).toBe('UI')
    expect(findDicomElement(parsed.dataset.elements, 0x0008_1115)).toBeUndefined()
    expect(lookupDicomDictionary(0x0008_1115).entry?.vr).toBe('SQ')
    expect(
      decodeDicomText(
        findDicomElement(parsed.dataset.elements, dicomTag.modality)?.value ?? new Uint8Array(),
      ),
    ).toBe('OT')
  })

  it('records unknown standard and private tags without materializing their values', async () => {
    const bytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: technicalDataset([
        { tag: 0x0009_0010, vr: 'LO', value: dicomTextBytes('PRIVATE_CREATOR') },
        { tag: 0x0009_1010, vr: 'UN', value: Uint8Array.of(1, 2, 3, 4) },
        { tag: 0x0008_9999, vr: 'LO', value: dicomTextBytes('UNKNOWN') },
      ]),
    })
    const parsed = await parse(bytes, { select: [0x0009_0010, 0x0009_1010, 0x0008_9999] })
    const privateCreator = findDicomElement(parsed.dataset.elements, 0x0009_0010)
    expect(privateCreator).toMatchObject({ known: false, private: true, vr: 'LO' })
    expect(privateCreator?.value).toBeDefined()
    const privateValue = findDicomElement(parsed.dataset.elements, 0x0009_1010)
    expect(privateValue).toMatchObject({ known: false, private: true })
    const unknownStandard = findDicomElement(parsed.dataset.elements, 0x0008_9999)
    expect(unknownStandard).toMatchObject({ known: false, private: false, vr: 'LO' })
    const unselected = await parse(bytes)
    expect(findDicomElement(unselected.dataset.elements, 0x0009_1010)?.value).toBeUndefined()
    expect(findDicomElement(unselected.dataset.elements, 0x0008_9999)?.value).toBeUndefined()
  })

  it('parses explicit-length and undefined-length sequences with nested items', async () => {
    const referenced = (
      uid: string,
      nested: readonly DicomWriteElement[] = [],
    ): DicomWriteElement => ({
      tag: 0x0008_1140,
      vr: 'SQ',
      items: [[{ tag: 0x0008_1150, vr: 'UI', value: dicomTextBytes(uid) }, ...nested]],
    })
    const explicitBytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: technicalDataset([
        referenced('1.2.840.10008.5.1.4.1.1.2', [
          {
            tag: 0x0008_1115,
            vr: 'SQ',
            items: [[{ tag: 0x0020_000e, vr: 'UI', value: dicomTextBytes('1.2.3') }]],
          },
        ]),
      ]),
    })
    const undefinedBytes = writeDicomPart10({
      transferSyntax: 'implicit-vr-le',
      dataset: technicalDataset([
        {
          ...referenced('1.2.840.10008.5.1.4.1.1.4'),
          undefinedLength: true,
        },
      ]),
    })
    const explicit = await parse(explicitBytes, { select: [0x0008_1150, 0x0020_000e] })
    const sequence = findDicomElement(explicit.dataset.elements, 0x0008_1140)
    expect(sequence?.vr).toBe('SQ')
    expect(sequence?.sequence?.undefinedLength).toBe(false)
    expect(sequence?.sequence?.items).toHaveLength(1)
    const nested = findDicomElement(sequence?.sequence?.items[0]?.elements ?? [], 0x0008_1115)
    expect(nested?.sequence?.items[0]?.elements[0]?.tag).toBe(0x0020_000e)
    expect(explicit.stats.maxSequenceDepth).toBe(2)
    const implicit = await parse(undefinedBytes, { select: [0x0008_1150] })
    const undefinedSequence = findDicomElement(implicit.dataset.elements, 0x0008_1140)
    expect(undefinedSequence?.sequence?.undefinedLength).toBe(true)
    expect(
      decodeDicomUid(
        findDicomElement(undefinedSequence?.sequence?.items[0]?.elements ?? [], 0x0008_1150)
          ?.value ?? new Uint8Array(),
        'Referenced SOP Class UID',
      ),
    ).toBe('1.2.840.10008.5.1.4.1.1.4')
  })

  it('skips native Pixel Data payload bytes while indexing the locator', async () => {
    const pixel = pixelPlaceholder(4_096, 0xcd)
    const bytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: technicalDataset([], pixel),
    })
    const source = new TrackingSource(bytes)
    const parsed = await parseDicomPart10(source)
    const start = parsed.pixelData?.valueOffset ?? 0
    expect(parsed.pixelData?.valueLength).toBe(4_096)
    expect(rangesOverlap(start, start + 4_096, source.reads)).toBe(false)
    expect(parsed.stats.sourceBytesRead).toBeLessThan(bytes.byteLength - 2_000)
  })

  it('rejects missing DICM, missing Transfer Syntax UID, and unsupported transfer syntaxes', async () => {
    await expect(
      parse(
        writeDicomPart10({
          transferSyntax: 'explicit-vr-le',
          includeDicomPrefix: false,
          dataset: technicalDataset(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('prefix') })
    await expect(
      parse(
        writeDicomPart10({
          transferSyntax: 'explicit-vr-le',
          omitTransferSyntax: true,
          dataset: technicalDataset(),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('Transfer Syntax UID'),
    })
    const unsupported = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      transferSyntaxUid: '1.2.840.10008.1.2.4.80',
      dataset: technicalDataset(),
    })
    await expect(parse(unsupported)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('1.2.840.10008.1.2.4.80'),
    })
  })

  it('rejects invalid VR, invalid length form, and truncated values', async () => {
    const invalidVr = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: [
        {
          tag: dicomTag.modality,
          rawHeader: Uint8Array.of(0x08, 0x00, 0x60, 0x00, 0x5a, 0x5a, 0x02, 0x00),
          value: Uint8Array.of(0x4f, 0x54),
        },
      ],
    })
    await expect(parse(invalidVr)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('invalid VR'),
    })
    const invalidLengthForm = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: [
        {
          tag: dicomTag.pixelData,
          rawHeader: Uint8Array.of(0xe0, 0x7f, 0x10, 0x00, 0x4f, 0x42, 0x04, 0x00),
          value: Uint8Array.of(1, 2, 3, 4),
        },
      ],
    })
    await expect(parse(invalidLengthForm)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/invalid VR|odd value length|reserved/),
    })
    const truncated = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: [
        { tag: dicomTag.modality, vr: 'CS', forceLength: 20, value: Uint8Array.of(0x4f, 0x54) },
      ],
    })
    await expect(parse(truncated)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('truncated'),
    })
  })

  it('enforces sequence depth, element, and item limits', async () => {
    const deep: DicomWriteElement = {
      tag: 0x0008_1140,
      vr: 'SQ',
      items: [
        [
          {
            tag: 0x0008_1115,
            vr: 'SQ',
            items: [[{ tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('CT') }]],
          },
        ],
      ],
    }
    await expect(
      parse(writeDicomPart10({ transferSyntax: 'explicit-vr-le', dataset: [deep] }), {
        limits: { maxSequenceDepth: 1 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: expect.stringContaining('depth') })
    await expect(
      parse(writeDicomPart10({ transferSyntax: 'explicit-vr-le', dataset: technicalDataset() }), {
        limits: { maxElements: 3 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: expect.stringContaining('element') })
    const manyItems: DicomWriteElement = {
      tag: 0x0008_1140,
      vr: 'SQ',
      items: [
        [{ tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('CT') }],
        [{ tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('MR') }],
      ],
    }
    await expect(
      parse(writeDicomPart10({ transferSyntax: 'explicit-vr-le', dataset: [manyItems] }), {
        limits: { maxSequenceItems: 1 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: expect.stringContaining('item') })
  })

  it('rejects an undefined-length sequence that is missing its delimiter', async () => {
    const bytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: [
        {
          tag: 0x0008_1140,
          vr: 'SQ',
          undefinedLength: true,
          items: [[{ tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('CT') }]],
        },
      ],
    })
    const delimiter = Uint8Array.of(0xfe, 0xff, 0xdd, 0xe0, 0x00, 0x00, 0x00, 0x00)
    let cut = bytes.byteLength
    for (let index = 0; index <= bytes.byteLength - delimiter.byteLength; index += 1) {
      if (bytes.subarray(index, index + 8).every((value, offset) => value === delimiter[offset])) {
        cut = index
        break
      }
    }
    await expect(parse(bytes.subarray(0, cut))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('delimiter'),
    })
  })

  it('propagates cancellation during metadata parsing', async () => {
    const bytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: technicalDataset(),
    })
    const controller = new AbortController()
    controller.abort(new Error('stop DICOM metadata'))
    await expect(
      parseDicomPart10(new TrackingSource(bytes), { signal: controller.signal }),
    ).rejects.toThrow('stop DICOM metadata')
    const midParse = new AbortController()
    const source: TrackingSource = new TrackingSource(bytes)
    const original = source.read.bind(source)
    let reads = 0
    source.read = async (offset, length, options) => {
      reads += 1
      if (reads === 3) midParse.abort(new Error('cancel during metadata'))
      return original(offset, length, options)
    }
    await expect(parseDicomPart10(source, { signal: midParse.signal })).rejects.toThrow(
      'cancel during metadata',
    )
  })

  it('parses an in-memory browser File through BlobSource', async () => {
    const bytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: technicalDataset(),
    })
    const file = new File([Uint8Array.from(bytes)], 'synthetic.dcm', { type: 'application/dicom' })
    const parsed = await parseDicomPart10(new BlobSource(file))
    expect(parsed.transferSyntaxUid).toBe(explicitVrLittleEndianUid)
    expect(
      decodeDicomText(
        findDicomElement(parsed.dataset.elements, dicomTag.modality)?.value ?? new Uint8Array(),
      ),
    ).toBe('OT')
  })

  it('does not put patient-identifying values in errors', async () => {
    const bytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: [
        { tag: 0x0010_0010, vr: 'PN', value: dicomTextBytes('DOE^JOHN') },
        { tag: dicomTag.pixelData, vr: 'OW', forceLength: 8, value: Uint8Array.of(1) },
      ],
    })
    try {
      await parse(bytes)
      throw new Error('expected parse to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ImageError)
      expect(String(error)).not.toContain('DOE')
      expect(String(error)).not.toContain('JOHN')
    }
  })

  it('parses explicit VR UN with undefined length as Implicit VR Little Endian items', async () => {
    const bytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: technicalDataset([
        {
          tag: 0x0009_1010,
          vr: 'UN',
          undefinedLength: true,
          items: [
            [
              { tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('CT') },
              {
                tag: 0x0008_1140,
                vr: 'SQ',
                items: [[{ tag: 0x0008_1150, vr: 'UI', value: dicomTextBytes('1.2.3') }]],
              },
            ],
          ],
        },
      ]),
    })
    const parsed = await parse(bytes, { select: [0x0009_1010, dicomTag.modality, 0x0008_1150] })
    const un = findDicomElement(parsed.dataset.elements, 0x0009_1010)
    expect(un?.vr).toBe('UN')
    expect(un?.sequence?.undefinedLength).toBe(true)
    const nested = un?.sequence?.items[0]?.elements ?? []
    expect(
      decodeDicomText(findDicomElement(nested, dicomTag.modality)?.value ?? new Uint8Array()),
    ).toBe('CT')
    const nestedSq = findDicomElement(nested, 0x0008_1140)
    expect(nestedSq?.vr).toBe('SQ')
    expect(
      decodeDicomUid(
        findDicomElement(nestedSq?.sequence?.items[0]?.elements ?? [], 0x0008_1150)?.value ??
          new Uint8Array(),
        'Referenced SOP Class UID',
      ),
    ).toBe('1.2.3')
    const explicitUn = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: technicalDataset([{ tag: 0x0009_1010, vr: 'UN', value: Uint8Array.of(1, 2, 3, 4) }]),
    })
    const opaque = await parse(explicitUn, { select: [0x0009_1010] })
    const opaqueElement = findDicomElement(opaque.dataset.elements, 0x0009_1010)
    expect(opaqueElement?.vr).toBe('UN')
    expect(opaqueElement?.sequence).toBeUndefined()
    expect(opaqueElement?.value).toEqual(Uint8Array.of(1, 2, 3, 4))
  })

  it('rejects malformed undefined-length UN containers and enforces nested limits', async () => {
    const missingSequenceDelimiter = writeRawPart10Bytes(explicitVrLittleEndianUid, (output) => {
      writeRawGrayscaleIdentity(output, { rows: 4, columns: 4, bitsAllocated: 16 })
      writeUndefinedLengthUn(output, 0x0009_1010)
      writeItemStart(output)
      writeItemDelimitation(output)
    })
    await expect(parse(missingSequenceDelimiter)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/missing its delimiter/),
    })
    const missingItem = writeRawPart10Bytes(explicitVrLittleEndianUid, (output) => {
      writeRawGrayscaleIdentity(output, { rows: 4, columns: 4, bitsAllocated: 16 })
      writeUndefinedLengthUn(output, 0x0009_1010)
      writeSequenceDelimitation(output)
    })
    const parsedEmpty = await parse(missingItem)
    expect(findDicomElement(parsedEmpty.dataset.elements, 0x0009_1010)?.sequence?.items).toEqual([])
    const missingItemDelimiter = writeRawPart10Bytes(explicitVrLittleEndianUid, (output) => {
      writeRawGrayscaleIdentity(output, { rows: 4, columns: 4, bitsAllocated: 16 })
      writeUndefinedLengthUn(output, 0x0009_1010)
      writeItemStart(output)
      writeSequenceDelimitation(output)
    })
    await expect(parse(missingItemDelimiter)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/Item|delimiter/),
    })
    const nestedSq: DicomWriteElement = {
      tag: 0x0009_1010,
      vr: 'UN',
      undefinedLength: true,
      items: [
        [
          {
            tag: 0x0008_1140,
            vr: 'SQ',
            items: [[{ tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('CT') }]],
          },
        ],
      ],
    }
    await expect(
      parse(writeDicomPart10({ transferSyntax: 'explicit-vr-le', dataset: [nestedSq] }), {
        limits: { maxSequenceDepth: 1 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: expect.stringContaining('depth') })
    await expect(
      parse(
        writeDicomPart10({
          transferSyntax: 'explicit-vr-le',
          dataset: [
            {
              tag: 0x0009_1010,
              vr: 'UN',
              undefinedLength: true,
              items: [
                [{ tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('CT') }],
                [{ tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('MR') }],
              ],
            },
          ],
        }),
        { limits: { maxSequenceItems: 1 } },
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: expect.stringContaining('item') })
    const cancelBytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: technicalDataset([nestedSq]),
    })
    const midParse = new AbortController()
    const source = new TrackingSource(cancelBytes)
    const original = source.read.bind(source)
    let reads = 0
    source.read = async (offset, length, options) => {
      reads += 1
      if (reads === 8) midParse.abort(new Error('cancel during UN'))
      return original(offset, length, options)
    }
    await expect(parseDicomPart10(source, { signal: midParse.signal })).rejects.toThrow(
      'cancel during UN',
    )
  })

  it('requires unique File Meta Information fields in strict mode', async () => {
    const requiredMeta = (
      omit?: number,
      extras: readonly DicomWriteElement[] = [],
    ): DicomWriteElement[] =>
      [
        { tag: dicomTag.fileMetaInformationVersion, vr: 'OB' as const, value: Uint8Array.of(0, 1) },
        {
          tag: dicomTag.mediaStorageSopClassUid,
          vr: 'UI' as const,
          value: dicomTextBytes(dicomTestSopClassUid),
        },
        {
          tag: dicomTag.mediaStorageSopInstanceUid,
          vr: 'UI' as const,
          value: dicomTextBytes('1.2.826.0.1.3680043.10.850.1.1'),
        },
        {
          tag: dicomTag.transferSyntaxUid,
          vr: 'UI' as const,
          value: dicomTextBytes(explicitVrLittleEndianUid),
        },
        {
          tag: dicomTag.implementationClassUid,
          vr: 'UI' as const,
          value: dicomTextBytes('1.2.826.0.1.3680043.10.850.1'),
        },
        ...extras,
      ].filter((element) => element.tag !== omit)
    const rejectMeta = async (bytes: Uint8Array, message: RegExp) => {
      await expect(parse(bytes)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        message: expect.stringMatching(message),
      })
    }
    await rejectMeta(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        omitFileMetaGroupLength: true,
        dataset: technicalDataset(),
      }),
      /Group Length must be the first/,
    )
    await rejectMeta(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        fileMeta: requiredMeta(dicomTag.fileMetaInformationVersion),
        dataset: technicalDataset(),
      }),
      /File Meta Information Version/,
    )
    await rejectMeta(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        fileMeta: requiredMeta(dicomTag.mediaStorageSopClassUid),
        dataset: technicalDataset(),
      }),
      /Media Storage SOP Class UID/,
    )
    await rejectMeta(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        fileMeta: requiredMeta(dicomTag.mediaStorageSopInstanceUid),
        dataset: technicalDataset(),
      }),
      /Media Storage SOP Instance UID/,
    )
    await rejectMeta(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        fileMeta: requiredMeta(dicomTag.implementationClassUid),
        dataset: technicalDataset(),
      }),
      /Implementation Class UID/,
    )
    await rejectMeta(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        fileMeta: requiredMeta(dicomTag.transferSyntaxUid),
        dataset: technicalDataset(),
      }),
      /Transfer Syntax UID/,
    )
    const duplicateTags = [
      dicomTag.fileMetaInformationVersion,
      dicomTag.mediaStorageSopClassUid,
      dicomTag.mediaStorageSopInstanceUid,
      dicomTag.transferSyntaxUid,
      dicomTag.implementationClassUid,
    ]
    for (const tag of duplicateTags) {
      const extra = requiredMeta().find((element) => element.tag === tag)
      if (extra === undefined) throw new Error('expected File Meta duplicate source')
      await rejectMeta(
        writeDicomPart10({
          transferSyntax: 'explicit-vr-le',
          fileMeta: requiredMeta(undefined, [extra]),
          dataset: technicalDataset(),
        }),
        /duplicated/,
      )
    }
    await rejectMeta(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        fileMeta: requiredMeta(undefined, [
          { tag: 0x0002_0013, vr: 'UN', value: Uint8Array.of(1, 2) },
        ]),
        dataset: technicalDataset(),
      }),
      /must not use VR UN/,
    )
    await rejectMeta(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        fileMeta: requiredMeta(undefined).map((element) =>
          element.tag === dicomTag.fileMetaInformationVersion
            ? { ...element, value: Uint8Array.of(1, 1) }
            : element,
        ),
        dataset: technicalDataset(),
      }),
      /reserved first byte/,
    )
    await rejectMeta(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        fileMeta: requiredMeta(undefined).map((element) =>
          element.tag === dicomTag.fileMetaInformationVersion
            ? { ...element, value: Uint8Array.of(0, 0) }
            : element,
        ),
        dataset: technicalDataset(),
      }),
      /required version bit/,
    )
    await rejectMeta(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        fileMeta: requiredMeta(undefined).map((element) =>
          element.tag === dicomTag.fileMetaInformationVersion
            ? { ...element, value: Uint8Array.of(0, 1, 0, 0) }
            : element,
        ),
        dataset: technicalDataset(),
      }),
      /two bytes/,
    )
    const tooShort: number[] = []
    writeRawPart10Preamble(tooShort)
    writeRawFileMeta(tooShort)
    writeExplicitElement(tooShort, dicomTag.implementationVersionName, 'SH', writeUidBytes('EXTRA'))
    writeRawGrayscaleIdentity(tooShort, { rows: 4, columns: 4, bitsAllocated: 16 })
    await rejectMeta(Uint8Array.from(tooShort), /shorter than group 0002/)
    const tooLong: number[] = []
    writeRawPart10Preamble(tooLong)
    const metaStart = tooLong.length
    writeRawFileMeta(tooLong)
    writeRawGrayscaleIdentity(tooLong, { rows: 4, columns: 4, bitsAllocated: 16 })
    const patched = Uint8Array.from(tooLong)
    const current = patched[metaStart + 8]
    const current1 = patched[metaStart + 9]
    const current2 = patched[metaStart + 10]
    const current3 = patched[metaStart + 11]
    if (
      current === undefined ||
      current1 === undefined ||
      current2 === undefined ||
      current3 === undefined
    ) {
      throw new Error('expected File Meta Information Group Length bytes')
    }
    const length = current | (current1 << 8) | (current2 << 16) | (current3 << 24)
    const grown = length + 32
    patched[metaStart + 8] = grown & 0xff
    patched[metaStart + 9] = (grown >>> 8) & 0xff
    patched[metaStart + 10] = (grown >>> 16) & 0xff
    patched[metaStart + 11] = (grown >>> 24) & 0xff
    await rejectMeta(patched, /does not match the remaining group 0002 bytes/)
    const overridden = await parse(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        transferSyntaxUid: encapsulatedUncompressedExplicitVrLittleEndianUid,
        dataset: technicalDataset(),
      }),
    )
    expect(overridden.transferSyntaxUid).toBe(encapsulatedUncompressedExplicitVrLittleEndianUid)
    expect(overridden.fileMeta.mediaStorageSopClassUid).toBe(dicomTestSopClassUid)
    expect(overridden.fileMeta.implementationClassUid).toBe('1.2.826.0.1.3680043.10.850.1')
    const tolerant = await parse(
      writeDicomPart10({
        transferSyntax: 'explicit-vr-le',
        fileMeta: [
          {
            tag: dicomTag.transferSyntaxUid,
            vr: 'UI',
            value: dicomTextBytes(explicitVrLittleEndianUid),
          },
        ],
        dataset: technicalDataset(),
      }),
      { fileMetaConformance: 'tolerant' },
    )
    expect(tolerant.transferSyntaxUid).toBe(explicitVrLittleEndianUid)
    expect(tolerant.fileMeta.mediaStorageSopClassUid).toBeUndefined()
  })
})

describe('committed synthetic DICOM fixtures', () => {
  it('matches pinned hashes and expected technical tags', async () => {
    const corpus = JSON.parse(readFileSync('tests/fixtures/dicom/corpus.json', 'utf8')) as {
      readonly files: readonly {
        readonly localFile: string
        readonly sha256: string
        readonly transferSyntaxUid: string
        readonly expected: {
          readonly modality: string
          readonly rows: number
          readonly columns: number
        }
      }[]
    }
    for (const entry of corpus.files) {
      const bytes = readFileSync(`tests/fixtures/dicom/${entry.localFile}`)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
      const parsed = await parseDicomPart10(new TrackingSource(bytes))
      expect(parsed.transferSyntaxUid).toBe(entry.transferSyntaxUid)
      expect(
        decodeDicomText(
          findDicomElement(parsed.dataset.elements, dicomTag.modality)?.value ?? new Uint8Array(),
        ),
      ).toBe(entry.expected.modality)
      expect(
        decodeDicomUInt16Values(
          findDicomElement(parsed.dataset.elements, dicomTag.rows)?.value ?? new Uint8Array(),
        )[0],
      ).toBe(entry.expected.rows)
    }
  })
})
