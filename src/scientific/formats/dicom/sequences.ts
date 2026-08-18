import { invalidInput } from '../../../errors.ts'
import { dicomTag, formatDicomTag } from './constants.ts'
import type {
  DicomCursor,
  DicomDataset,
  DicomElement,
  DicomElementHeader,
  DicomFragmentLocator,
  DicomItem,
  DicomSequence,
} from './elements.ts'
import { parseDicomElementHeader } from './elements.ts'

export interface DicomParseHandlers {
  parseElement(
    cursor: DicomCursor,
    header: DicomElementHeader,
    explicitVr: boolean,
  ): Promise<DicomElement>
}

const requireItem = (header: DicomElementHeader, context: string): void => {
  if (header.tag !== dicomTag.item) {
    throw invalidInput(`DICOM ${context} expected an Item but found ${formatDicomTag(header.tag)}`)
  }
}

export const parseDicomDataset = async (
  cursor: DicomCursor,
  explicitVr: boolean,
  handlers: DicomParseHandlers,
  options: Readonly<{
    readonly endOffset?: number
    readonly stopOnGroupChange?: number
    readonly stopOnDelimiter?: 'item' | 'sequence'
  }> = {},
): Promise<{
  readonly dataset: DicomDataset
  readonly terminator?: DicomElementHeader
}> => {
  const elements: DicomElement[] = []
  while (cursor.position < cursor.size) {
    if (options.endOffset !== undefined && cursor.position >= options.endOffset) break
    if (options.stopOnDelimiter !== undefined && cursor.remaining() < 8) {
      throw invalidInput(
        options.stopOnDelimiter === 'item'
          ? 'DICOM undefined-length item is missing its delimiter'
          : 'DICOM undefined-length sequence is missing its delimiter',
      )
    }
    if (options.stopOnGroupChange !== undefined && cursor.remaining() >= 2) {
      const groupBytes = await cursor.peek(2)
      const group = (groupBytes[0] ?? 0) | ((groupBytes[1] ?? 0) << 8)
      if (group !== options.stopOnGroupChange) {
        return Object.freeze({
          dataset: Object.freeze({
            elements: Object.freeze(elements),
            endOffset: cursor.position,
          }),
        })
      }
    }
    const header = await parseDicomElementHeader(cursor, explicitVr)
    if (header.tag === dicomTag.itemDelimitation) {
      if (options.stopOnDelimiter === 'item') {
        return Object.freeze({
          dataset: Object.freeze({
            elements: Object.freeze(elements),
            endOffset: header.headerOffset,
          }),
          terminator: header,
        })
      }
      throw invalidInput('DICOM Item Delimitation Item appeared outside an undefined-length item')
    }
    if (header.tag === dicomTag.sequenceDelimitation) {
      if (options.stopOnDelimiter === 'sequence') {
        return Object.freeze({
          dataset: Object.freeze({
            elements: Object.freeze(elements),
            endOffset: header.headerOffset,
          }),
          terminator: header,
        })
      }
      throw invalidInput(
        'DICOM Sequence Delimitation Item appeared outside an undefined-length sequence',
      )
    }
    if (header.tag === dicomTag.item) {
      throw invalidInput('DICOM Item tag appeared outside a sequence')
    }
    elements.push(await handlers.parseElement(cursor, header, explicitVr))
  }
  if (options.endOffset !== undefined && cursor.position !== options.endOffset) {
    throw invalidInput('DICOM dataset did not end at its declared length')
  }
  if (options.stopOnDelimiter !== undefined) {
    throw invalidInput(
      options.stopOnDelimiter === 'item'
        ? 'DICOM undefined-length item is missing its delimiter'
        : 'DICOM undefined-length sequence is missing its delimiter',
    )
  }
  return Object.freeze({
    dataset: Object.freeze({
      elements: Object.freeze(elements),
      endOffset: cursor.position,
    }),
  })
}

export const parseDicomItem = async (
  cursor: DicomCursor,
  header: DicomElementHeader,
  explicitVr: boolean,
  handlers: DicomParseHandlers,
): Promise<DicomItem> => {
  requireItem(header, 'sequence')
  cursor.admitSequenceItem()
  if (header.undefinedLength) {
    const parsed = await parseDicomDataset(cursor, explicitVr, handlers, {
      stopOnDelimiter: 'item',
    })
    return Object.freeze({
      headerOffset: header.headerOffset,
      valueOffset: header.valueOffset,
      undefinedLength: true,
      elements: parsed.dataset.elements,
    })
  }
  const valueLength = header.valueLength ?? 0
  const endOffset = header.valueOffset + valueLength
  const parsed = await parseDicomDataset(cursor, explicitVr, handlers, { endOffset })
  return Object.freeze({
    headerOffset: header.headerOffset,
    valueOffset: header.valueOffset,
    valueLength,
    undefinedLength: false,
    elements: parsed.dataset.elements,
  })
}

export const parseDicomSequence = async (
  cursor: DicomCursor,
  header: DicomElementHeader,
  explicitVr: boolean,
  handlers: DicomParseHandlers,
): Promise<DicomSequence> => {
  cursor.enterSequence()
  try {
    const items: DicomItem[] = []
    if (header.undefinedLength) {
      while (true) {
        if (cursor.remaining() < 8) {
          throw invalidInput('DICOM undefined-length sequence is missing its delimiter')
        }
        const next = await parseDicomElementHeader(cursor, explicitVr)
        if (next.tag === dicomTag.sequenceDelimitation) break
        items.push(await parseDicomItem(cursor, next, explicitVr, handlers))
      }
      return Object.freeze({ undefinedLength: true, items: Object.freeze(items) })
    }
    const endOffset = header.valueOffset + (header.valueLength ?? 0)
    while (cursor.position < endOffset) {
      const next = await parseDicomElementHeader(cursor, explicitVr)
      items.push(await parseDicomItem(cursor, next, explicitVr, handlers))
    }
    if (cursor.position !== endOffset) {
      throw invalidInput('DICOM sequence did not end at its declared length')
    }
    return Object.freeze({ undefinedLength: false, items: Object.freeze(items) })
  } finally {
    cursor.leaveSequence()
  }
}

export const parseEncapsulatedPixelFragments = async (
  cursor: DicomCursor,
): Promise<readonly DicomFragmentLocator[]> => {
  const fragments: DicomFragmentLocator[] = []
  while (true) {
    if (cursor.remaining() < 8) {
      throw invalidInput('DICOM encapsulated Pixel Data is missing its delimiter')
    }
    const header = await parseDicomElementHeader(cursor, true)
    if (header.tag === dicomTag.sequenceDelimitation) return Object.freeze(fragments)
    if (
      header.tag !== dicomTag.item ||
      header.undefinedLength ||
      header.valueLength === undefined
    ) {
      throw invalidInput('DICOM encapsulated Pixel Data contains a malformed fragment')
    }
    if (fragments.length > 0 && header.valueLength < 2) {
      throw invalidInput('DICOM encoded fragment Item must have a Value Length of at least 2')
    }
    cursor.admitFragment()
    fragments.push(
      Object.freeze({
        headerOffset: header.headerOffset,
        valueOffset: header.valueOffset,
        valueLength: header.valueLength,
      }),
    )
    cursor.skip(header.valueLength)
  }
}
