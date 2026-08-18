import { invalidInput } from '../../../errors.ts'
import { type DicomVr, isDicomPrivateTag, isDicomVr } from './constants.ts'
import {
  dicomDictionaryExactPacked,
  dicomDictionaryPatternPacked,
  dicomDictionarySource,
} from './dictionary.generated.ts'

export interface DicomDictionaryEntry {
  readonly tag: number
  readonly vr: DicomVr | readonly DicomVr[]
  readonly keyword: string
  readonly retired: boolean
  readonly pattern: boolean
}

export interface DicomDictionaryLookup {
  readonly known: boolean
  readonly private: boolean
  readonly entry?: DicomDictionaryEntry
}

interface PackedPattern {
  readonly value: number
  readonly mask: number
  readonly vr: DicomVr | readonly DicomVr[]
  readonly keyword: string
  readonly retired: boolean
}

const exactEntries = new Map<number, DicomDictionaryEntry>()
const patternEntries: PackedPattern[] = []
let initialized = false

const parseVrField = (value: string, label: string): DicomVr | readonly DicomVr[] => {
  const codes = value.split('/')
  const vrs: DicomVr[] = []
  for (const code of codes) {
    if (!isDicomVr(code)) throw invalidInput(`DICOM dictionary ${label} has invalid VR ${code}`)
    vrs.push(code)
  }
  if (vrs.length === 0) throw invalidInput(`DICOM dictionary ${label} has no VR`)
  return vrs.length === 1 ? (vrs[0] as DicomVr) : Object.freeze(vrs)
}

const parseExactTag = (value: string): number => {
  const group = Number.parseInt(value.slice(0, 4), 16)
  const element = Number.parseInt(value.slice(5, 9), 16)
  if (!Number.isInteger(group) || !Number.isInteger(element)) {
    throw invalidInput(`DICOM dictionary tag ${value} is invalid`)
  }
  return ((group << 16) | element) >>> 0
}

const parsePattern = (value: string): { readonly value: number; readonly mask: number } => {
  const groupText = value.slice(0, 4)
  const elementText = value.slice(5, 9)
  let tag = 0
  let mask = 0
  const hex = `${groupText}${elementText}`
  for (let index = 0; index < 8; index += 1) {
    const character = hex[index]
    tag <<= 4
    mask <<= 4
    if (character === undefined) throw invalidInput(`DICOM dictionary pattern ${value} is invalid`)
    if (character === 'X') continue
    const nibble = Number.parseInt(character, 16)
    if (!Number.isInteger(nibble))
      throw invalidInput(`DICOM dictionary pattern ${value} is invalid`)
    tag |= nibble
    mask |= 0xf
  }
  return { value: tag >>> 0, mask: mask >>> 0 }
}

const loadPacked = (): void => {
  if (initialized) return
  const exactLines = dicomDictionaryExactPacked.split('\n')
  for (const line of exactLines) {
    const [tagText, vrText, keyword, retiredText] = line.split('\t')
    if (
      tagText === undefined ||
      vrText === undefined ||
      keyword === undefined ||
      retiredText === undefined
    ) {
      throw invalidInput('Generated DICOM dictionary exact table is malformed')
    }
    const tag = parseExactTag(tagText)
    exactEntries.set(
      tag,
      Object.freeze({
        tag,
        vr: parseVrField(vrText, tagText),
        keyword,
        retired: retiredText === '1',
        pattern: false,
      }),
    )
  }
  const patternLines =
    dicomDictionaryPatternPacked.length === 0 ? [] : dicomDictionaryPatternPacked.split('\n')
  for (const line of patternLines) {
    const [tagText, vrText, keyword, retiredText] = line.split('\t')
    if (
      tagText === undefined ||
      vrText === undefined ||
      keyword === undefined ||
      retiredText === undefined
    ) {
      throw invalidInput('Generated DICOM dictionary pattern table is malformed')
    }
    const pattern = parsePattern(tagText)
    patternEntries.push({
      value: pattern.value,
      mask: pattern.mask,
      vr: parseVrField(vrText, tagText),
      keyword,
      retired: retiredText === '1',
    })
  }
  if (exactEntries.size !== dicomDictionarySource.exactCount) {
    throw invalidInput('Generated DICOM dictionary exact count does not match provenance')
  }
  if (patternEntries.length !== dicomDictionarySource.patternCount) {
    throw invalidInput('Generated DICOM dictionary pattern count does not match provenance')
  }
  initialized = true
}

export const getDicomDictionarySource = (): typeof dicomDictionarySource => dicomDictionarySource

export const lookupDicomDictionary = (tag: number): DicomDictionaryLookup => {
  loadPacked()
  const normalized = tag >>> 0
  const privateTag = isDicomPrivateTag(normalized)
  if (privateTag) return Object.freeze({ known: false, private: true })
  const exact = exactEntries.get(normalized)
  if (exact !== undefined) return Object.freeze({ known: true, private: false, entry: exact })
  for (const pattern of patternEntries) {
    if ((normalized & pattern.mask) >>> 0 === pattern.value) {
      return Object.freeze({
        known: true,
        private: false,
        entry: Object.freeze({
          tag: normalized,
          vr: pattern.vr,
          keyword: pattern.keyword,
          retired: pattern.retired,
          pattern: true,
        }),
      })
    }
  }
  return Object.freeze({ known: false, private: false })
}

export const resolveImplicitVr = (tag: number): DicomVr | undefined => {
  const lookup = lookupDicomDictionary(tag)
  if (lookup.entry === undefined) return undefined
  const vr = lookup.entry.vr
  if (typeof vr === 'string') return vr
  if (vr.includes('SQ')) return 'SQ'
  if (tag === 0x7fe0_0010 || vr.includes('OW')) return 'OW'
  return vr[0]
}
