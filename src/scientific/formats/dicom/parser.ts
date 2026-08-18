import type { AbortOptions } from '../../../abort.ts'
import { throwIfAborted } from '../../../abort.ts'
import { invalidInput } from '../../../errors.ts'
import type { ImageSource } from '../../../source.ts'
import { dicomPart10HeaderLength, dicomPreambleLength, dicomPrefix, dicomTag } from './constants.ts'
import {
  type DicomCursor,
  type DicomDataset,
  type DicomElement,
  type DicomElementHeader,
  type DicomFragmentLocator,
  DicomSourceCursor,
  defaultDicomSelectedTags,
  findDicomElement,
  shouldMaterializeDicomValue,
} from './elements.ts'
import { type DicomFileMetaInformation, parseDicomFileMeta } from './file-meta.ts'
import { type DicomLimitOptions, type DicomLimits, resolveDicomLimits } from './limits.ts'
import {
  type DicomParseHandlers,
  parseDicomDataset,
  parseDicomSequence,
  parseEncapsulatedPixelFragments,
} from './sequences.ts'
import type { DicomTransferSyntax } from './transfer-syntax.ts'

export interface DicomParseOptions extends AbortOptions {
  readonly limits?: DicomLimitOptions
  readonly select?: readonly number[]
}

export interface DicomPixelDataLocator {
  readonly headerOffset: number
  readonly valueOffset: number
  readonly valueLength?: number
  readonly vr?: DicomElementHeader['vr']
  readonly encapsulated: boolean
  readonly fragments?: readonly DicomFragmentLocator[]
}

export interface DicomParseStats {
  readonly elementCount: number
  readonly sequenceItemCount: number
  readonly fragmentCount: number
  readonly maxSequenceDepth: number
  readonly sourceBytesRead: number
  readonly sourceReadCalls: number
  readonly metadataEndOffset: number
}

export interface DicomParsedPart10 {
  readonly transferSyntaxUid: string
  readonly transferSyntax: DicomTransferSyntax
  readonly fileMeta: DicomFileMetaInformation
  readonly dataset: DicomDataset
  readonly pixelData?: DicomPixelDataLocator
  readonly stats: DicomParseStats
}

const asciiEquals = (bytes: Uint8Array, value: string): boolean => {
  if (bytes.byteLength !== value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[index] !== value.charCodeAt(index)) return false
  }
  return true
}

const selectedTags = (select: readonly number[] | undefined): ReadonlySet<number> => {
  if (select === undefined) return defaultDicomSelectedTags
  const tags = new Set(defaultDicomSelectedTags)
  for (const tag of select) tags.add(tag)
  return tags
}

const parseElementValue = async (
  cursor: DicomCursor,
  header: DicomElementHeader,
  explicitVr: boolean,
  selected: ReadonlySet<number>,
  handlers: DicomParseHandlers,
): Promise<DicomElement> => {
  cursor.admitElement()
  const isPixelData = header.tag === dicomTag.pixelData
  const isSequence = header.vr === 'SQ' || (header.undefinedLength && header.vr === undefined)
  if (isSequence && !isPixelData) {
    const sequence = await parseDicomSequence(cursor, header, explicitVr, handlers)
    return Object.freeze({ ...header, sequence })
  }
  if (isPixelData && header.undefinedLength) {
    const fragments = await parseEncapsulatedPixelFragments(cursor)
    return Object.freeze({ ...header, fragments })
  }
  if (header.undefinedLength) {
    throw invalidInput(
      'DICOM undefined-length values are only supported for sequences and encapsulated Pixel Data',
    )
  }
  const length = header.valueLength ?? 0
  if (isPixelData || !shouldMaterializeDicomValue(header, selected, cursor.limits)) {
    cursor.skip(length)
    return Object.freeze({ ...header })
  }
  const value = await cursor.read(length)
  return Object.freeze({ ...header, value })
}

const createHandlers = (selected: ReadonlySet<number>): DicomParseHandlers => {
  const handlers: DicomParseHandlers = {
    parseElement: (cursor, header, explicitVr) =>
      parseElementValue(cursor, header, explicitVr, selected, handlers),
  }
  return handlers
}

export const parseDicomPart10 = async (
  source: ImageSource,
  options: Readonly<DicomParseOptions> = {},
): Promise<DicomParsedPart10> => {
  throwIfAborted(options.signal)
  if (!Number.isSafeInteger(source.size) || source.size < 0) {
    throw invalidInput('DICOM source size is invalid')
  }
  if (source.size < dicomPart10HeaderLength) {
    throw invalidInput('DICOM Part 10 prefix is missing')
  }
  const limits: Readonly<DicomLimits> = resolveDicomLimits(options.limits)
  const cursor = new DicomSourceCursor(source, limits, options.signal)
  await cursor.read(dicomPreambleLength)
  const prefix = await cursor.read(dicomPrefix.length)
  if (!asciiEquals(prefix, dicomPrefix)) {
    throw invalidInput('DICOM Part 10 prefix is missing')
  }
  const selected = selectedTags(options.select)
  const handlers = createHandlers(selected)
  const fileMeta = await parseDicomFileMeta(cursor, handlers)
  const parsed = await parseDicomDataset(cursor, fileMeta.transferSyntax.explicitVr, handlers)
  const pixelElement = findDicomElement(parsed.dataset.elements, dicomTag.pixelData)
  const pixelData =
    pixelElement === undefined
      ? undefined
      : Object.freeze({
          headerOffset: pixelElement.headerOffset,
          valueOffset: pixelElement.valueOffset,
          ...(pixelElement.valueLength === undefined
            ? {}
            : { valueLength: pixelElement.valueLength }),
          ...(pixelElement.vr === undefined ? {} : { vr: pixelElement.vr }),
          encapsulated: pixelElement.undefinedLength,
          ...(pixelElement.fragments === undefined ? {} : { fragments: pixelElement.fragments }),
        })
  return Object.freeze({
    transferSyntaxUid: fileMeta.transferSyntaxUid,
    transferSyntax: fileMeta.transferSyntax,
    fileMeta,
    dataset: parsed.dataset,
    ...(pixelData === undefined ? {} : { pixelData }),
    stats: Object.freeze({
      elementCount: cursor.elementCount,
      sequenceItemCount: cursor.sequenceItemCount,
      fragmentCount: cursor.fragmentCount,
      maxSequenceDepth: cursor.maxSequenceDepth,
      sourceBytesRead: cursor.bytesRead,
      sourceReadCalls: cursor.readCalls,
      metadataEndOffset: parsed.dataset.endOffset,
    }),
  })
}

export {
  dicomTag,
  encapsulatedUncompressedExplicitVrLittleEndianUid,
  explicitVrLittleEndianUid,
  formatDicomTag,
  implicitVrLittleEndianUid,
  jpeg2000LosslessUid,
  jpeg2000Uid,
  jpegBaseline8BitUid,
  jpegLosslessSv1Uid,
  rleLosslessUid,
} from './constants.ts'
export { getDicomDictionarySource, lookupDicomDictionary } from './dictionary.ts'
export {
  decodeDicomDecimalStrings,
  decodeDicomIntegerString,
  decodeDicomText,
  decodeDicomUInt16Values,
  decodeDicomUInt32Values,
  decodeDicomUInt64Values,
  defaultDicomSelectedTags,
  findDicomElement,
} from './elements.ts'
export { defaultDicomLimits, resolveDicomLimits } from './limits.ts'
export {
  decodeDicomUid,
  encapsulatedUncompressedExplicitVrLittleEndian,
  explicitVrLittleEndian,
  implicitVrLittleEndian,
  jpeg2000,
  jpeg2000Lossless,
  jpegBaseline8Bit,
  jpegLosslessSv1,
  rleLossless,
} from './transfer-syntax.ts'
