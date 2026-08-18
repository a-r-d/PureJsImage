import { throwIfAborted } from '../../../abort.ts'
import { invalidInput, limitExceeded } from '../../../errors.ts'
import { type ImageSource, type ImageSourceReadOptions, readExactly } from '../../../source.ts'
import {
  type DicomVr,
  dicomLongValueLengthVrs,
  dicomTag,
  dicomUndefinedLength,
  formatDicomTag,
  isDicomDelimiterTag,
  isDicomVr,
} from './constants.ts'
import { lookupDicomDictionary, resolveImplicitVr } from './dictionary.ts'
import { addDicomSafe, type DicomLimits, requireDicomSafeInteger } from './limits.ts'

export interface DicomCursor {
  readonly size: number
  readonly position: number
  readonly bytesRead: number
  readonly readCalls: number
  readonly limits: Readonly<DicomLimits>
  readonly signal: AbortSignal | undefined
  read(length: number): Promise<Uint8Array>
  peek(length: number): Promise<Uint8Array>
  skip(length: number): void
  remaining(): number
  admitElement(): void
  admitSequenceItem(): void
  admitFragment(): void
  enterSequence(): void
  leaveSequence(): void
}

export interface DicomElementHeader {
  readonly tag: number
  readonly vr?: DicomVr
  readonly keyword?: string
  readonly retired: boolean
  readonly known: boolean
  readonly private: boolean
  readonly headerOffset: number
  readonly valueOffset: number
  readonly valueLength?: number
  readonly undefinedLength: boolean
}

export interface DicomElement extends DicomElementHeader {
  readonly value?: Uint8Array
  readonly sequence?: DicomSequence
  readonly fragments?: readonly DicomFragmentLocator[]
}

export interface DicomSequence {
  readonly undefinedLength: boolean
  readonly items: readonly DicomItem[]
}

export interface DicomItem {
  readonly headerOffset: number
  readonly valueOffset: number
  readonly valueLength?: number
  readonly undefinedLength: boolean
  readonly elements: readonly DicomElement[]
}

export interface DicomFragmentLocator {
  readonly headerOffset: number
  readonly valueOffset: number
  readonly valueLength: number
}

export interface DicomDataset {
  readonly elements: readonly DicomElement[]
  readonly endOffset: number
}

export class DicomSourceCursor implements DicomCursor {
  readonly size: number
  readonly limits: Readonly<DicomLimits>
  readonly signal: AbortSignal | undefined
  position = 0
  bytesRead = 0
  readCalls = 0
  elementCount = 0
  sequenceItemCount = 0
  fragmentCount = 0
  sequenceDepth = 0
  maxSequenceDepth = 0
  readonly #source: ImageSource
  #pending: Uint8Array | undefined
  #pendingOffset = 0

  constructor(
    source: ImageSource,
    limits: Readonly<DicomLimits>,
    signal: AbortSignal | undefined,
    position = 0,
  ) {
    this.#source = source
    this.size = source.size
    this.limits = limits
    this.signal = signal
    this.position = requireDicomSafeInteger(position, 'cursor offset')
    if (this.position > this.size) throw invalidInput('DICOM cursor offset exceeds the source')
  }

  remaining(): number {
    return this.size - this.position
  }

  #readOptions(): ImageSourceReadOptions {
    return this.signal === undefined ? {} : { signal: this.signal }
  }

  #admitRead(length: number): void {
    const next = addDicomSafe(this.bytesRead, length, 'metadata bytes')
    if (next > this.limits.maxMetadataBytes) {
      throw limitExceeded(
        `DICOM metadata read ${next} exceeds maxMetadataBytes ${this.limits.maxMetadataBytes}`,
      )
    }
    this.bytesRead = next
    this.readCalls += 1
  }

  async read(length: number): Promise<Uint8Array> {
    throwIfAborted(this.signal)
    const amount = requireDicomSafeInteger(length, 'read length')
    const end = addDicomSafe(this.position, amount, 'read end')
    if (end > this.size) {
      throw invalidInput(
        `DICOM value is truncated at offset ${this.position}; needed ${amount} bytes`,
      )
    }
    if (amount === 0) return new Uint8Array()
    const pending = this.#pending
    if (pending !== undefined) {
      const available = pending.byteLength - this.#pendingOffset
      if (amount <= available) {
        const slice = pending.subarray(this.#pendingOffset, this.#pendingOffset + amount)
        this.#pendingOffset += amount
        this.position = end
        if (this.#pendingOffset === pending.byteLength) {
          this.#pending = undefined
          this.#pendingOffset = 0
        }
        return Uint8Array.from(slice)
      }
    }
    this.#pending = undefined
    this.#pendingOffset = 0
    this.#admitRead(amount)
    const data = await readExactly(this.#source, this.position, amount, this.#readOptions())
    this.position = end
    return Uint8Array.from(data)
  }

  async peek(length: number): Promise<Uint8Array> {
    const pending = this.#pending
    if (pending !== undefined && pending.byteLength - this.#pendingOffset >= length) {
      return Uint8Array.from(pending.subarray(this.#pendingOffset, this.#pendingOffset + length))
    }
    const data = await this.read(length)
    this.position -= length
    this.#pending = data
    this.#pendingOffset = 0
    return data
  }

  skip(length: number): void {
    throwIfAborted(this.signal)
    const amount = requireDicomSafeInteger(length, 'skip length')
    const end = addDicomSafe(this.position, amount, 'skip end')
    if (end > this.size) {
      throw invalidInput(
        `DICOM skip exceeds the source at offset ${this.position}; needed ${amount} bytes`,
      )
    }
    if (this.#pending !== undefined) {
      const available = this.#pending.byteLength - this.#pendingOffset
      if (amount > available) {
        this.#pending = undefined
        this.#pendingOffset = 0
      } else {
        this.#pendingOffset += amount
        if (this.#pendingOffset === this.#pending.byteLength) {
          this.#pending = undefined
          this.#pendingOffset = 0
        }
      }
    }
    this.position = end
  }

  admitElement(): void {
    if (this.elementCount >= this.limits.maxElements) {
      throw limitExceeded(`DICOM element count exceeds maxElements ${this.limits.maxElements}`)
    }
    this.elementCount += 1
  }

  admitSequenceItem(): void {
    if (this.sequenceItemCount >= this.limits.maxSequenceItems) {
      throw limitExceeded(
        `DICOM sequence item count exceeds maxSequenceItems ${this.limits.maxSequenceItems}`,
      )
    }
    this.sequenceItemCount += 1
  }

  admitFragment(): void {
    if (this.fragmentCount >= this.limits.maxFragments) {
      throw limitExceeded(`DICOM fragment count exceeds maxFragments ${this.limits.maxFragments}`)
    }
    this.fragmentCount += 1
  }

  enterSequence(): void {
    const depth = this.sequenceDepth + 1
    if (depth > this.limits.maxSequenceDepth) {
      throw limitExceeded(
        `DICOM sequence depth exceeds maxSequenceDepth ${this.limits.maxSequenceDepth}`,
      )
    }
    this.sequenceDepth = depth
    if (depth > this.maxSequenceDepth) this.maxSequenceDepth = depth
  }

  leaveSequence(): void {
    if (this.sequenceDepth === 0) throw invalidInput('DICOM sequence depth underflow')
    this.sequenceDepth -= 1
  }
}

const readUint16 = (bytes: Uint8Array, offset: number): number => {
  const low = bytes[offset]
  const high = bytes[offset + 1]
  if (low === undefined || high === undefined) throw invalidInput('DICOM integer is truncated')
  return low | (high << 8)
}

const readUint32 = (bytes: Uint8Array, offset: number): number => {
  const b0 = bytes[offset]
  const b1 = bytes[offset + 1]
  const b2 = bytes[offset + 2]
  const b3 = bytes[offset + 3]
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw invalidInput('DICOM integer is truncated')
  }
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0
}

const readTag = (bytes: Uint8Array): number =>
  ((readUint16(bytes, 0) << 16) | readUint16(bytes, 2)) >>> 0

const readAscii = (bytes: Uint8Array): string => String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)

const requireEvenLength = (length: number, tag: number): void => {
  if ((length & 1) !== 0) {
    throw invalidInput(`DICOM ${formatDicomTag(tag)} has an odd value length ${length}`)
  }
}

export const parseDicomElementHeader = async (
  cursor: DicomCursor,
  explicitVr: boolean,
): Promise<DicomElementHeader> => {
  const headerOffset = cursor.position
  const tagBytes = await cursor.read(4)
  const tag = readTag(tagBytes)
  if (isDicomDelimiterTag(tag)) {
    const lengthBytes = await cursor.read(4)
    const length = readUint32(lengthBytes, 0)
    if (length !== 0 && tag !== dicomTag.item) {
      throw invalidInput(`DICOM delimiter ${formatDicomTag(tag)} has a non-zero length`)
    }
    if (tag === dicomTag.item && length !== dicomUndefinedLength) requireEvenLength(length, tag)
    return Object.freeze({
      tag,
      retired: false,
      known: true,
      private: false,
      headerOffset,
      valueOffset: cursor.position,
      ...(length === dicomUndefinedLength ? {} : { valueLength: length }),
      undefinedLength: length === dicomUndefinedLength,
      keyword:
        tag === dicomTag.item
          ? 'Item'
          : tag === dicomTag.itemDelimitation
            ? 'ItemDelimitationItem'
            : 'SequenceDelimitationItem',
    })
  }

  const lookup = lookupDicomDictionary(tag)
  let vr: DicomVr | undefined
  let valueLength: number
  if (explicitVr) {
    const vrBytes = await cursor.read(2)
    const vrText = readAscii(vrBytes)
    if (!isDicomVr(vrText)) {
      throw invalidInput(`DICOM ${formatDicomTag(tag)} has invalid VR ${JSON.stringify(vrText)}`)
    }
    vr = vrText
    if (dicomLongValueLengthVrs.has(vr)) {
      const rest = await cursor.read(6)
      const reserved = readUint16(rest, 0)
      if (reserved !== 0) {
        throw invalidInput(`DICOM ${formatDicomTag(tag)} has a non-zero reserved VR field`)
      }
      valueLength = readUint32(rest, 2)
    } else {
      const lengthBytes = await cursor.read(2)
      valueLength = readUint16(lengthBytes, 0)
    }
  } else {
    const lengthBytes = await cursor.read(4)
    valueLength = readUint32(lengthBytes, 0)
    vr = resolveImplicitVr(tag)
  }

  const undefinedLength = valueLength === dicomUndefinedLength
  if (!undefinedLength) requireEvenLength(valueLength, tag)
  if (
    undefinedLength &&
    vr !== undefined &&
    vr !== 'SQ' &&
    vr !== 'OB' &&
    vr !== 'OW' &&
    vr !== 'UN' &&
    vr !== 'OD' &&
    vr !== 'OF' &&
    vr !== 'OL' &&
    vr !== 'OV' &&
    vr !== 'UT'
  ) {
    throw invalidInput(`DICOM ${formatDicomTag(tag)} VR ${vr} cannot use undefined length`)
  }

  return Object.freeze({
    tag,
    ...(vr === undefined ? {} : { vr }),
    ...(lookup.entry === undefined ? {} : { keyword: lookup.entry.keyword }),
    retired: lookup.entry?.retired === true,
    known: lookup.known,
    private: lookup.private,
    headerOffset,
    valueOffset: cursor.position,
    ...(undefinedLength ? {} : { valueLength }),
    undefinedLength,
  })
}

export const defaultDicomSelectedTags: ReadonlySet<number> = new Set([
  dicomTag.fileMetaInformationGroupLength,
  dicomTag.fileMetaInformationVersion,
  dicomTag.mediaStorageSopClassUid,
  dicomTag.mediaStorageSopInstanceUid,
  dicomTag.transferSyntaxUid,
  dicomTag.implementationClassUid,
  dicomTag.implementationVersionName,
  dicomTag.sopClassUid,
  dicomTag.sopInstanceUid,
  dicomTag.modality,
  dicomTag.samplesPerPixel,
  dicomTag.photometricInterpretation,
  dicomTag.planarConfiguration,
  dicomTag.numberOfFrames,
  dicomTag.rows,
  dicomTag.columns,
  dicomTag.pixelSpacing,
  dicomTag.bitsAllocated,
  dicomTag.bitsStored,
  dicomTag.highBit,
  dicomTag.pixelRepresentation,
  dicomTag.windowCenter,
  dicomTag.windowWidth,
  dicomTag.rescaleIntercept,
  dicomTag.rescaleSlope,
  dicomTag.rescaleType,
  dicomTag.windowCenterWidthExplanation,
  dicomTag.voiLutFunction,
  dicomTag.modalityLutSequence,
  dicomTag.voiLutSequence,
  dicomTag.imagePositionPatient,
  dicomTag.imageOrientationPatient,
  dicomTag.frameOfReferenceUid,
  dicomTag.frameContentSequence,
  dicomTag.planePositionSequence,
  dicomTag.planeOrientationSequence,
  dicomTag.pixelMeasuresSequence,
  dicomTag.frameVoiLutSequence,
  dicomTag.pixelValueTransformationSequence,
  dicomTag.sharedFunctionalGroupsSequence,
  dicomTag.perFrameFunctionalGroupsSequence,
  dicomTag.extendedOffsetTable,
  dicomTag.extendedOffsetTableLengths,
])

export const shouldMaterializeDicomValue = (
  header: DicomElementHeader,
  selected: ReadonlySet<number>,
  limits: Readonly<DicomLimits>,
): boolean => {
  if (header.undefinedLength || header.valueLength === undefined) return false
  if (header.tag === dicomTag.pixelData) return false
  if (header.vr === 'SQ') return false
  if (!selected.has(header.tag)) return false
  if (header.valueLength > limits.maxElementValueBytes) return false
  if (
    header.tag === dicomTag.extendedOffsetTable ||
    header.tag === dicomTag.extendedOffsetTableLengths
  ) {
    return header.valueLength <= limits.maxOffsetTableBytes
  }
  if (
    header.valueLength > limits.maxStringBytes &&
    header.vr !== 'US' &&
    header.vr !== 'SS' &&
    header.vr !== 'UL' &&
    header.vr !== 'UV' &&
    header.vr !== 'OV' &&
    header.vr !== 'OW' &&
    header.vr !== 'OB'
  ) {
    return false
  }
  return true
}

export const findDicomElement = (
  elements: readonly DicomElement[],
  tag: number,
): DicomElement | undefined => {
  for (const element of elements) {
    if (element.tag === tag) return element
  }
  return undefined
}

export const collectDicomElements = (
  elements: readonly DicomElement[],
  tag: number,
): readonly DicomElement[] => {
  const matches: DicomElement[] = []
  for (const element of elements) {
    if (element.tag === tag) matches.push(element)
  }
  return Object.freeze(matches)
}

export const requireUniqueDicomElement = (
  elements: readonly DicomElement[],
  tag: number,
  label: string,
): DicomElement => {
  const matches = collectDicomElements(elements, tag)
  if (matches.length === 0) throw invalidInput(`DICOM ${label} is missing`)
  if (matches.length > 1) throw invalidInput(`DICOM ${label} is duplicated`)
  const element = matches[0]
  if (element === undefined) throw invalidInput(`DICOM ${label} is missing`)
  return element
}

export const decodeDicomText = (bytes: Uint8Array): string => {
  let end = bytes.byteLength
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) end -= 1
  let text = ''
  for (let index = 0; index < end; index += 1) {
    text += String.fromCharCode(bytes[index] ?? 0)
  }
  return text
}

export const decodeDicomUInt16Values = (bytes: Uint8Array): readonly number[] => {
  if ((bytes.byteLength & 1) !== 0) throw invalidInput('DICOM US value length is not even')
  const values: number[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    values.push(readUint16(bytes, offset))
  }
  return Object.freeze(values)
}

export const decodeDicomIntegerString = (bytes: Uint8Array, label: string): number => {
  const text = decodeDicomText(bytes)
  if (!/^[+-]?\d+$/.test(text)) throw invalidInput(`DICOM ${label} is not an integer string`)
  const value = Number(text)
  if (!Number.isSafeInteger(value)) throw invalidInput(`DICOM ${label} exceeds safe integers`)
  return value
}

export const decodeDicomDecimalStrings = (bytes: Uint8Array, label: string): readonly number[] => {
  const text = decodeDicomText(bytes)
  if (text.length === 0) throw invalidInput(`DICOM ${label} is empty`)
  const parts = text.split('\\')
  const values: number[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.length === 0) throw invalidInput(`DICOM ${label} contains an empty component`)
    const value = Number(trimmed)
    if (!Number.isFinite(value)) throw invalidInput(`DICOM ${label} is not a finite decimal`)
    values.push(value)
  }
  return Object.freeze(values)
}

export const decodeDicomUInt32Values = (bytes: Uint8Array): readonly number[] => {
  if ((bytes.byteLength & 3) !== 0)
    throw invalidInput('DICOM UL value length is not a multiple of 4')
  const values: number[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    values.push(readUint32(bytes, offset))
  }
  return Object.freeze(values)
}

export const decodeDicomUInt64Values = (bytes: Uint8Array, label: string): readonly number[] => {
  if ((bytes.byteLength & 7) !== 0) {
    throw invalidInput(`DICOM ${label} length is not a multiple of 8`)
  }
  const values: number[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += 8) {
    const low = readUint32(bytes, offset)
    const high = readUint32(bytes, offset + 4)
    if (high > 0x1f_ffff) {
      throw invalidInput(`DICOM ${label} exceeds the JavaScript safe integer range`)
    }
    values.push(high * 0x1_0000_0000 + low)
  }
  return Object.freeze(values)
}
