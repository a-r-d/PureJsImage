import { invalidInput } from '../../../errors.ts'
import { dicomFileMetaGroup, dicomTag, formatDicomTag, type DicomVr } from './constants.ts'
import type { DicomCursor, DicomElement } from './elements.ts'
import {
  collectDicomElements,
  decodeDicomText,
  decodeDicomUInt32Values,
  parseDicomElementHeader,
  requireUniqueDicomElement,
} from './elements.ts'
import { addDicomSafe } from './limits.ts'
import { type DicomParseHandlers, parseDicomDataset } from './sequences.ts'
import {
  type DicomTransferSyntax,
  decodeDicomUid,
  resolveDicomTransferSyntax,
} from './transfer-syntax.ts'

export type DicomFileMetaConformance = 'strict' | 'tolerant'

export interface DicomFileMetaInformation {
  readonly elements: readonly DicomElement[]
  readonly endOffset: number
  readonly transferSyntaxUid: string
  readonly transferSyntax: DicomTransferSyntax
  readonly mediaStorageSopClassUid?: string
  readonly mediaStorageSopInstanceUid?: string
  readonly implementationClassUid?: string
  readonly implementationVersionName?: string
}

export interface DicomFileMetaParseOptions {
  readonly conformance?: DicomFileMetaConformance
}

const requireFileMetaVr = (element: DicomElement, vr: DicomVr, label: string): void => {
  if (element.vr !== vr) {
    throw invalidInput(`DICOM File Meta ${label} must use VR ${vr}`)
  }
}

const optionalUid = (
  element: DicomElement | undefined,
  label: string,
  conformance: DicomFileMetaConformance,
): string | undefined => {
  if (element?.value === undefined) return undefined
  return decodeDicomUid(element.value, label, { conformance })
}

const requireUid = (elements: readonly DicomElement[], tag: number, label: string): string => {
  const element = requireUniqueDicomElement(elements, tag, label)
  requireFileMetaVr(element, 'UI', label)
  if (element.value === undefined) throw invalidInput(`DICOM ${label} value was not materialized`)
  return decodeDicomUid(element.value, label)
}

const validateFileMetaInformationVersion = (elements: readonly DicomElement[]): void => {
  const element = requireUniqueDicomElement(
    elements,
    dicomTag.fileMetaInformationVersion,
    'File Meta Information Version',
  )
  if (element.vr !== 'OB') {
    throw invalidInput('DICOM File Meta Information Version must use VR OB')
  }
  const value = element.value
  if (value === undefined) {
    throw invalidInput('DICOM File Meta Information Version value was not materialized')
  }
  if (value.byteLength !== 2) {
    throw invalidInput('DICOM File Meta Information Version must contain two bytes')
  }
  if (value[0] !== 0) {
    throw invalidInput('DICOM File Meta Information Version reserved first byte is invalid')
  }
  if (((value[1] ?? 0) & 1) !== 1) {
    throw invalidInput('DICOM File Meta Information Version is missing the required version bit')
  }
}

const rejectFileMetaUnAndDuplicates = (elements: readonly DicomElement[]): void => {
  const seen = new Set<number>()
  for (const element of elements) {
    if (element.vr === 'UN') {
      throw invalidInput(
        `DICOM File Meta Information must not use VR UN for ${formatDicomTag(element.tag)}`,
      )
    }
    if (seen.has(element.tag)) {
      throw invalidInput(`DICOM File Meta ${formatDicomTag(element.tag)} is duplicated`)
    }
    seen.add(element.tag)
  }
}

const parseTransferSyntax = (
  elements: readonly DicomElement[],
  required: boolean,
): {
  readonly transferSyntaxUid: string
  readonly transferSyntax: DicomTransferSyntax
} => {
  const transferSyntaxElement = requireUniqueDicomElement(
    elements,
    dicomTag.transferSyntaxUid,
    'Transfer Syntax UID',
  )
  if (required) requireFileMetaVr(transferSyntaxElement, 'UI', 'Transfer Syntax UID')
  if (transferSyntaxElement.vr === 'UN') {
    throw invalidInput('DICOM File Meta Transfer Syntax UID must not use VR UN')
  }
  if (transferSyntaxElement.value === undefined) {
    throw invalidInput('DICOM File Meta Information is missing Transfer Syntax UID')
  }
  const transferSyntaxUid = decodeDicomUid(transferSyntaxElement.value, 'Transfer Syntax UID', {
    conformance: required ? 'strict' : 'tolerant',
  })
  return Object.freeze({
    transferSyntaxUid,
    transferSyntax: resolveDicomTransferSyntax(transferSyntaxUid),
  })
}

const fileMetaResult = (
  elements: readonly DicomElement[],
  endOffset: number,
  required: boolean,
): DicomFileMetaInformation => {
  const { transferSyntaxUid, transferSyntax } = parseTransferSyntax(elements, required)
  const mediaStorageSopClassUid = required
    ? requireUid(elements, dicomTag.mediaStorageSopClassUid, 'Media Storage SOP Class UID')
    : optionalUid(
        collectDicomElements(elements, dicomTag.mediaStorageSopClassUid)[0],
        'Media Storage SOP Class UID',
        'tolerant',
      )
  const mediaStorageSopInstanceUid = required
    ? requireUid(elements, dicomTag.mediaStorageSopInstanceUid, 'Media Storage SOP Instance UID')
    : optionalUid(
        collectDicomElements(elements, dicomTag.mediaStorageSopInstanceUid)[0],
        'Media Storage SOP Instance UID',
        'tolerant',
      )
  const implementationClassUid = required
    ? requireUid(elements, dicomTag.implementationClassUid, 'Implementation Class UID')
    : optionalUid(
        collectDicomElements(elements, dicomTag.implementationClassUid)[0],
        'Implementation Class UID',
        'tolerant',
      )
  const implementationVersionNameElement = collectDicomElements(
    elements,
    dicomTag.implementationVersionName,
  )
  if (implementationVersionNameElement.length > 1) {
    throw invalidInput('DICOM Implementation Version Name is duplicated')
  }
  const versionName = implementationVersionNameElement[0]
  if (required && versionName !== undefined) {
    requireFileMetaVr(versionName, 'SH', 'Implementation Version Name')
  }
  const implementationVersionName =
    versionName?.value === undefined ? undefined : decodeDicomText(versionName.value)
  return Object.freeze({
    elements,
    endOffset,
    transferSyntaxUid,
    transferSyntax,
    ...(mediaStorageSopClassUid === undefined ? {} : { mediaStorageSopClassUid }),
    ...(mediaStorageSopInstanceUid === undefined ? {} : { mediaStorageSopInstanceUid }),
    ...(implementationClassUid === undefined ? {} : { implementationClassUid }),
    ...(implementationVersionName === undefined ? {} : { implementationVersionName }),
  })
}

const parseStrictDicomFileMeta = async (
  cursor: DicomCursor,
  handlers: DicomParseHandlers,
): Promise<DicomFileMetaInformation> => {
  if (cursor.remaining() < 8) throw invalidInput('DICOM File Meta Information is missing')
  const groupLengthHeader = await parseDicomElementHeader(cursor, true)
  if (groupLengthHeader.tag !== dicomTag.fileMetaInformationGroupLength) {
    throw invalidInput(
      'DICOM File Meta Information Group Length must be the first File Meta element',
    )
  }
  if (groupLengthHeader.vr !== 'UL' || groupLengthHeader.valueLength !== 4) {
    throw invalidInput('DICOM File Meta Information Group Length must be a 4-byte UL value')
  }
  cursor.admitElement()
  const remainingBytes = decodeDicomUInt32Values(await cursor.read(4))
  if (remainingBytes.length !== 1 || remainingBytes[0] === undefined) {
    throw invalidInput('DICOM File Meta Information Group Length must contain one value')
  }
  const remainingLength = remainingBytes[0]
  const fileMetaEnd = addDicomSafe(cursor.position, remainingLength, 'File Meta Information')
  if (fileMetaEnd > cursor.size) {
    throw invalidInput('DICOM File Meta Information Group Length exceeds the source')
  }
  const parsed = await parseDicomDataset(cursor, true, handlers, {
    endOffset: fileMetaEnd,
    stopOnGroupChange: dicomFileMetaGroup,
  })
  if (cursor.position !== fileMetaEnd) {
    throw invalidInput(
      'DICOM File Meta Information Group Length does not match the remaining group 0002 bytes',
    )
  }
  if (cursor.remaining() >= 2) {
    const groupBytes = await cursor.peek(2)
    const group = (groupBytes[0] ?? 0) | ((groupBytes[1] ?? 0) << 8)
    if (group === dicomFileMetaGroup) {
      throw invalidInput('DICOM File Meta Information Group Length is shorter than group 0002')
    }
  }
  const groupLengthElement: DicomElement = Object.freeze({
    ...groupLengthHeader,
    value: Uint8Array.of(
      remainingLength & 0xff,
      (remainingLength >>> 8) & 0xff,
      (remainingLength >>> 16) & 0xff,
      (remainingLength >>> 24) & 0xff,
    ),
  })
  const elements = Object.freeze([groupLengthElement, ...parsed.dataset.elements])
  if (
    collectDicomElements(parsed.dataset.elements, dicomTag.fileMetaInformationGroupLength).length >
    0
  ) {
    throw invalidInput('DICOM File Meta Information Group Length is duplicated')
  }
  rejectFileMetaUnAndDuplicates(elements)
  validateFileMetaInformationVersion(elements)
  requireUniqueDicomElement(
    elements,
    dicomTag.fileMetaInformationGroupLength,
    'File Meta Information Group Length',
  )
  return fileMetaResult(elements, parsed.dataset.endOffset, true)
}

const parseTolerantDicomFileMeta = async (
  cursor: DicomCursor,
  handlers: DicomParseHandlers,
): Promise<DicomFileMetaInformation> => {
  if (cursor.remaining() < 8) throw invalidInput('DICOM File Meta Information is missing')
  const parsed = await parseDicomDataset(cursor, true, handlers, {
    stopOnGroupChange: dicomFileMetaGroup,
  })
  if (parsed.dataset.elements.length === 0) {
    throw invalidInput('DICOM File Meta Information is missing')
  }
  return fileMetaResult(parsed.dataset.elements, parsed.dataset.endOffset, false)
}

export const parseDicomFileMeta = async (
  cursor: DicomCursor,
  handlers: DicomParseHandlers,
  options: Readonly<DicomFileMetaParseOptions> = {},
): Promise<DicomFileMetaInformation> => {
  if (options.conformance === 'tolerant') return parseTolerantDicomFileMeta(cursor, handlers)
  return parseStrictDicomFileMeta(cursor, handlers)
}
