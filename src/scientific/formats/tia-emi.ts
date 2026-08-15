import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded } from '../../errors.ts'
import type { ImageSource } from '../../source.ts'
import { readExactly } from '../../source.ts'
import {
  parseXmlDocument,
  xmlChild,
  xmlChildren,
  xmlLocalName,
  type XmlElement,
} from '../../xml.ts'

export const tiaEmiSignature = Uint8Array.of(
  0x4a,
  0x4b,
  0x00,
  0x02,
  0x00,
  0x00,
  0x00,
  0x00,
  0x04,
  0x4d,
  0x01,
  0x00,
  0x60,
  0x00,
  0x00,
  0x01,
)

const openingMarker = new TextEncoder().encode('<ObjectInfo>')
const closingMarker = new TextEncoder().encode('</ObjectInfo>')

export interface TiaEmiLimits {
  readonly maxSourceBytes: number
  readonly maxObjects: number
  readonly maxXmlBytes: number
  readonly maxXmlDepth: number
  readonly maxXmlElements: number
  readonly maxMetadataFields: number
  readonly maxMetadataValueCharacters: number
}

export interface TiaEmiMetadataField {
  readonly label: string
  readonly value: string | number
  readonly unit?: string
}

export interface TiaEmiPathValue {
  readonly path: string
  readonly value: string | number
}

export interface TiaEmiObject {
  readonly index: number
  readonly uuid?: string
  readonly acquireDate?: string
  readonly microscopeConditions?: Readonly<{
    readonly acceleratingVoltageVolts?: number
    readonly tiltAlphaRadians?: number
    readonly tiltBetaRadians?: number
  }>
  readonly experimentalDescription: readonly TiaEmiMetadataField[]
  readonly acquireInfo: readonly TiaEmiPathValue[]
  readonly trueImageHeader: readonly TiaEmiPathValue[]
}

export interface TiaEmiIndex {
  readonly objects: readonly TiaEmiObject[]
  readonly xmlBytes: number
}

export const hasTiaEmiSignature = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= tiaEmiSignature.byteLength &&
  tiaEmiSignature.every((value, index) => bytes[index] === value)

const findBytes = (bytes: Uint8Array, marker: Uint8Array, start: number): number => {
  const last = bytes.byteLength - marker.byteLength
  outer: for (let offset = start; offset <= last; offset += 1) {
    for (let index = 0; index < marker.byteLength; index += 1) {
      if (bytes[offset + index] !== marker[index]) continue outer
    }
    return offset
  }
  return -1
}

const finiteNumber = (value: string): number | undefined => {
  if (value.trim().length === 0) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

const boundedText = (element: XmlElement | undefined, limit: number): string | undefined => {
  if (element === undefined) return undefined
  const value = element.text.trim()
  if (value.length === 0) return undefined
  if (value.length > limit) {
    throw limitExceeded(`TIA EMI metadata value has ${value.length} characters; limit is ${limit}`)
  }
  return value
}

const metadataValue = (value: string): string | number => finiteNumber(value) ?? value

const experimentalDescription = (
  root: XmlElement,
  limits: Readonly<TiaEmiLimits>,
): readonly TiaEmiMetadataField[] => {
  const description = xmlChild(root, 'ExperimentalDescription')
  const dataRoot = description === undefined ? undefined : xmlChild(description, 'Root')
  if (dataRoot === undefined) return Object.freeze([])
  const fields: TiaEmiMetadataField[] = []
  for (const data of xmlChildren(dataRoot, 'Data')) {
    if (fields.length >= limits.maxMetadataFields) {
      throw limitExceeded(`TIA EMI metadata field count exceeds ${limits.maxMetadataFields}`)
    }
    const label = boundedText(xmlChild(data, 'Label'), limits.maxMetadataValueCharacters)
    const value = boundedText(xmlChild(data, 'Value'), limits.maxMetadataValueCharacters)
    if (label === undefined || value === undefined) continue
    const unit = boundedText(xmlChild(data, 'Unit'), limits.maxMetadataValueCharacters)
    fields.push(
      Object.freeze({
        label,
        value: unit === undefined ? value : metadataValue(value),
        ...(unit === undefined ? {} : { unit }),
      }),
    )
  }
  return Object.freeze(fields)
}

const flattenLeaves = (
  element: XmlElement | undefined,
  prefix: string,
  limits: Readonly<TiaEmiLimits>,
): readonly TiaEmiPathValue[] => {
  if (element === undefined) return Object.freeze([])
  const output: TiaEmiPathValue[] = []
  const visit = (node: XmlElement, path: string): void => {
    if (node.children.length === 0) {
      const value = boundedText(node, limits.maxMetadataValueCharacters)
      if (value !== undefined) {
        if (output.length >= limits.maxMetadataFields) {
          throw limitExceeded(`TIA EMI metadata field count exceeds ${limits.maxMetadataFields}`)
        }
        output.push(Object.freeze({ path, value: metadataValue(value) }))
      }
      return
    }
    for (const child of node.children) {
      visit(child, `${path}/${xmlLocalName(child.name)}`)
    }
  }
  visit(element, prefix)
  return Object.freeze(output)
}

const trueImageHeader = (
  root: XmlElement,
  limits: Readonly<TiaEmiLimits>,
): readonly TiaEmiPathValue[] => {
  const container = xmlChild(root, 'TrueImageHeaderInfo')
  const source = boundedText(container, limits.maxXmlBytes)
  if (source === undefined) return Object.freeze([])
  const inner = parseXmlDocument(source, {
    maxDepth: limits.maxXmlDepth,
    maxElements: limits.maxXmlElements,
    maxCharacters: limits.maxXmlBytes,
  })
  const output: TiaEmiPathValue[] = []
  for (const data of xmlChildren(inner, 'Data')) {
    if (output.length >= limits.maxMetadataFields) {
      throw limitExceeded(
        `TIA EMI TrueImageHeaderInfo field count exceeds ${limits.maxMetadataFields}`,
      )
    }
    const index = boundedText(xmlChild(data, 'Index'), limits.maxMetadataValueCharacters)
    const value = boundedText(xmlChild(data, 'Value'), limits.maxMetadataValueCharacters)
    if (index !== undefined && value !== undefined) {
      output.push(Object.freeze({ path: index, value: metadataValue(value) }))
    }
  }
  return Object.freeze(output)
}

const optionalFinite = (element: XmlElement | undefined, limit: number): number | undefined => {
  const value = boundedText(element, limit)
  return value === undefined ? undefined : finiteNumber(value)
}

const parseObject = (
  source: string,
  index: number,
  limits: Readonly<TiaEmiLimits>,
): TiaEmiObject => {
  const root = parseXmlDocument(source, {
    maxDepth: limits.maxXmlDepth,
    maxElements: limits.maxXmlElements,
    maxCharacters: limits.maxXmlBytes,
  })
  if (xmlLocalName(root.name) !== 'ObjectInfo') {
    throw invalidInput('TIA EMI embedded XML root is not ObjectInfo')
  }
  const conditions = xmlChild(root, 'ExperimentalConditions')
  const microscope =
    conditions === undefined ? undefined : xmlChild(conditions, 'MicroscopeConditions')
  const acceleratingVoltageVolts = optionalFinite(
    microscope === undefined ? undefined : xmlChild(microscope, 'AcceleratingVoltage'),
    limits.maxMetadataValueCharacters,
  )
  const tiltAlphaRadians = optionalFinite(
    microscope === undefined ? undefined : xmlChild(microscope, 'Tilt1'),
    limits.maxMetadataValueCharacters,
  )
  const tiltBetaRadians = optionalFinite(
    microscope === undefined ? undefined : xmlChild(microscope, 'Tilt2'),
    limits.maxMetadataValueCharacters,
  )
  const hasMicroscopeConditions =
    acceleratingVoltageVolts !== undefined ||
    tiltAlphaRadians !== undefined ||
    tiltBetaRadians !== undefined
  const uuid = boundedText(xmlChild(root, 'Uuid'), limits.maxMetadataValueCharacters)
  const acquireDate = boundedText(xmlChild(root, 'AcquireDate'), limits.maxMetadataValueCharacters)
  return Object.freeze({
    index,
    ...(uuid === undefined ? {} : { uuid }),
    ...(acquireDate === undefined ? {} : { acquireDate }),
    ...(hasMicroscopeConditions
      ? {
          microscopeConditions: Object.freeze({
            ...(acceleratingVoltageVolts === undefined ? {} : { acceleratingVoltageVolts }),
            ...(tiltAlphaRadians === undefined ? {} : { tiltAlphaRadians }),
            ...(tiltBetaRadians === undefined ? {} : { tiltBetaRadians }),
          }),
        }
      : {}),
    experimentalDescription: experimentalDescription(root, limits),
    acquireInfo: flattenLeaves(xmlChild(root, 'AcquireInfo'), 'AcquireInfo', limits),
    trueImageHeader: trueImageHeader(root, limits),
  })
}

export const indexTiaEmi = async (
  source: ImageSource,
  limits: Readonly<TiaEmiLimits>,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<TiaEmiIndex> => {
  throwIfAborted(options.signal)
  if (source.size > limits.maxSourceBytes) {
    throw limitExceeded(
      `TIA EMI source has ${source.size} bytes; maxSourceBytes is ${limits.maxSourceBytes}`,
    )
  }
  const bytes = await readExactly(source, 0, source.size, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (!hasTiaEmiSignature(bytes)) throw invalidInput('TIA EMI signature is absent')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const objects: TiaEmiObject[] = []
  let xmlBytes = 0
  let offset = tiaEmiSignature.byteLength
  while (offset < bytes.byteLength) {
    throwIfAborted(options.signal)
    const start = findBytes(bytes, openingMarker, offset)
    if (start < 0) break
    const closing = findBytes(bytes, closingMarker, start + openingMarker.byteLength)
    if (closing < 0) throw invalidInput('TIA EMI ObjectInfo XML is truncated')
    const end = closing + closingMarker.byteLength
    const length = end - start
    xmlBytes += length
    if (objects.length >= limits.maxObjects) {
      throw limitExceeded(`TIA EMI object count exceeds ${limits.maxObjects}`)
    }
    if (xmlBytes > limits.maxXmlBytes) {
      throw limitExceeded(`TIA EMI XML has ${xmlBytes} bytes; maxXmlBytes is ${limits.maxXmlBytes}`)
    }
    let xml: string
    try {
      xml = decoder.decode(bytes.subarray(start, end))
    } catch {
      throw invalidInput('TIA EMI ObjectInfo XML is not valid UTF-8')
    }
    objects.push(parseObject(xml, objects.length, limits))
    offset = end
  }
  if (objects.length === 0) throw invalidInput('TIA EMI contains no ObjectInfo XML records')
  return Object.freeze({ objects: Object.freeze(objects), xmlBytes })
}
