import { invalidInput } from '../../../errors.ts'
import { dicomFileMetaGroup, dicomTag } from './constants.ts'
import type { DicomCursor, DicomElement } from './elements.ts'
import { decodeDicomText, findDicomElement } from './elements.ts'
import { type DicomParseHandlers, parseDicomDataset } from './sequences.ts'
import {
  type DicomTransferSyntax,
  decodeDicomUid,
  resolveDicomTransferSyntax,
} from './transfer-syntax.ts'

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

const optionalUid = (element: DicomElement | undefined, label: string): string | undefined => {
  if (element?.value === undefined) return undefined
  return decodeDicomUid(element.value, label)
}

export const parseDicomFileMeta = async (
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
  const transferSyntaxElement = findDicomElement(
    parsed.dataset.elements,
    dicomTag.transferSyntaxUid,
  )
  if (transferSyntaxElement?.value === undefined) {
    throw invalidInput('DICOM File Meta Information is missing Transfer Syntax UID')
  }
  const transferSyntaxUid = decodeDicomUid(transferSyntaxElement.value, 'Transfer Syntax UID')
  const transferSyntax = resolveDicomTransferSyntax(transferSyntaxUid)
  const mediaStorageSopClassUid = optionalUid(
    findDicomElement(parsed.dataset.elements, dicomTag.mediaStorageSopClassUid),
    'Media Storage SOP Class UID',
  )
  const mediaStorageSopInstanceUid = optionalUid(
    findDicomElement(parsed.dataset.elements, dicomTag.mediaStorageSopInstanceUid),
    'Media Storage SOP Instance UID',
  )
  const implementationClassUid = optionalUid(
    findDicomElement(parsed.dataset.elements, dicomTag.implementationClassUid),
    'Implementation Class UID',
  )
  const implementationVersionNameElement = findDicomElement(
    parsed.dataset.elements,
    dicomTag.implementationVersionName,
  )
  const implementationVersionName =
    implementationVersionNameElement?.value === undefined
      ? undefined
      : decodeDicomText(implementationVersionNameElement.value)
  return Object.freeze({
    elements: parsed.dataset.elements,
    endOffset: parsed.dataset.endOffset,
    transferSyntaxUid,
    transferSyntax,
    ...(mediaStorageSopClassUid === undefined ? {} : { mediaStorageSopClassUid }),
    ...(mediaStorageSopInstanceUid === undefined ? {} : { mediaStorageSopInstanceUid }),
    ...(implementationClassUid === undefined ? {} : { implementationClassUid }),
    ...(implementationVersionName === undefined ? {} : { implementationVersionName }),
  })
}
