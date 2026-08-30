import { invalidInput, limitExceeded } from '../errors.ts'

export interface BoundedXmlLimits {
  readonly maxBytes?: number
  readonly maxDepth?: number
  readonly maxElements?: number
  readonly maxAttributes?: number
  readonly maxNameLength?: number
  readonly maxTextLength?: number
}

export interface BoundedXmlAttribute {
  readonly namespace: string
  readonly localName: string
  readonly value: string
}

export interface BoundedXmlElement {
  readonly namespace: string
  readonly localName: string
  readonly attributes: readonly BoundedXmlAttribute[]
  readonly children: readonly BoundedXmlElement[]
  readonly text: string
}

interface MutableElement {
  namespace: string
  localName: string
  attributes: BoundedXmlAttribute[]
  children: MutableElement[]
  text: string
  namespaces: ReadonlyMap<string, string>
  qualifiedName: string
}

interface ResolvedLimits {
  maxBytes: number
  maxDepth: number
  maxElements: number
  maxAttributes: number
  maxNameLength: number
  maxTextLength: number
}

const defaults: ResolvedLimits = Object.freeze({
  maxBytes: 1_048_576,
  maxDepth: 32,
  maxElements: 4_096,
  maxAttributes: 8_192,
  maxNameLength: 256,
  maxTextLength: 1_048_576,
})

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

const resolveLimits = (options: Readonly<BoundedXmlLimits>): ResolvedLimits => ({
  maxBytes: positive(options.maxBytes, defaults.maxBytes, 'XML maxBytes'),
  maxDepth: positive(options.maxDepth, defaults.maxDepth, 'XML maxDepth'),
  maxElements: positive(options.maxElements, defaults.maxElements, 'XML maxElements'),
  maxAttributes: positive(options.maxAttributes, defaults.maxAttributes, 'XML maxAttributes'),
  maxNameLength: positive(options.maxNameLength, defaults.maxNameLength, 'XML maxNameLength'),
  maxTextLength: positive(options.maxTextLength, defaults.maxTextLength, 'XML maxTextLength'),
})

const whitespace = (character: string | undefined): boolean =>
  character === ' ' || character === '\t' || character === '\r' || character === '\n'

const nameCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[A-Za-z0-9_.:-]/u.test(character)

const readName = (text: string, start: number, maxLength: number): readonly [string, number] => {
  let end = start
  while (nameCharacter(text[end])) end += 1
  if (end === start || end - start > maxLength) throw invalidInput('XMP XML name is invalid')
  return [text.slice(start, end), end]
}

const decodeEntities = (value: string): string => {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character !== '&') {
      output += character
      continue
    }
    const end = value.indexOf(';', index + 1)
    if (end < 0) throw invalidInput('XMP XML entity reference is truncated')
    const entity = value.slice(index + 1, end)
    if (entity === 'amp') output += '&'
    else if (entity === 'lt') output += '<'
    else if (entity === 'gt') output += '>'
    else if (entity === 'quot') output += '"'
    else if (entity === 'apos') output += "'"
    else if (entity.startsWith('#x')) {
      const code = Number.parseInt(entity.slice(2), 16)
      if (!Number.isSafeInteger(code) || code < 0 || code > 0x10ffff) {
        throw invalidInput('XMP XML numeric entity is invalid')
      }
      output += String.fromCodePoint(code)
    } else if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      if (!Number.isSafeInteger(code) || code < 0 || code > 0x10ffff) {
        throw invalidInput('XMP XML numeric entity is invalid')
      }
      output += String.fromCodePoint(code)
    } else {
      throw invalidInput('XMP XML named entities are not supported')
    }
    index = end
  }
  return output
}

const resolveName = (
  qualifiedName: string,
  namespaces: ReadonlyMap<string, string>,
  attribute: boolean,
): readonly [string, string] => {
  const separator = qualifiedName.indexOf(':')
  if (separator < 0) return [attribute ? '' : (namespaces.get('') ?? ''), qualifiedName]
  const prefix = qualifiedName.slice(0, separator)
  const localName = qualifiedName.slice(separator + 1)
  const namespace = namespaces.get(prefix)
  if (namespace === undefined) throw invalidInput(`XMP XML prefix ${prefix} is not declared`)
  return [namespace, localName]
}

const freezeElement = (element: MutableElement): BoundedXmlElement =>
  Object.freeze({
    namespace: element.namespace,
    localName: element.localName,
    attributes: Object.freeze(element.attributes),
    children: Object.freeze(element.children.map(freezeElement)),
    text: element.text,
  })

export const parseBoundedXml = (
  bytes: Uint8Array,
  options: Readonly<BoundedXmlLimits> = {},
): BoundedXmlElement => {
  const limits = resolveLimits(options)
  if (bytes.byteLength > limits.maxBytes) throw limitExceeded('XMP XML exceeds its byte limit')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput('XMP XML is not valid UTF-8')
  }
  const upper = text.toUpperCase()
  if (upper.includes('<!DOCTYPE') || upper.includes('<!ENTITY')) {
    throw invalidInput('XMP XML document types and entity declarations are forbidden')
  }

  const roots: MutableElement[] = []
  const stack: MutableElement[] = []
  let elementCount = 0
  let attributeCount = 0
  let textLength = 0
  let position = 0
  while (position < text.length) {
    const open = text.indexOf('<', position)
    const plainEnd = open < 0 ? text.length : open
    if (plainEnd > position && stack.length > 0) {
      const decoded = decodeEntities(text.slice(position, plainEnd))
      textLength += decoded.length
      if (textLength > limits.maxTextLength) throw limitExceeded('XMP XML text exceeds its limit')
      const current = stack[stack.length - 1]
      if (current) current.text += decoded
    } else if (plainEnd > position && text.slice(position, plainEnd).trim().length > 0) {
      throw invalidInput('XMP XML has text outside its root element')
    }
    if (open < 0) break
    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2)
      if (end < 0) throw invalidInput('XMP XML processing instruction is truncated')
      position = end + 2
      continue
    }
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4)
      if (end < 0) throw invalidInput('XMP XML comment is truncated')
      position = end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9)
      if (end < 0) throw invalidInput('XMP XML CDATA is truncated')
      const current = stack[stack.length - 1]
      if (!current) throw invalidInput('XMP XML CDATA is outside its root element')
      const value = text.slice(open + 9, end)
      textLength += value.length
      if (textLength > limits.maxTextLength) throw limitExceeded('XMP XML text exceeds its limit')
      current.text += value
      position = end + 3
      continue
    }
    if (text.startsWith('<!', open)) throw invalidInput('Unsupported XMP XML declaration')
    if (text.startsWith('</', open)) {
      let cursor = open + 2
      while (whitespace(text[cursor])) cursor += 1
      const [name, afterName] = readName(text, cursor, limits.maxNameLength)
      cursor = afterName
      while (whitespace(text[cursor])) cursor += 1
      if (text[cursor] !== '>') throw invalidInput('XMP XML closing tag is invalid')
      const current = stack.pop()
      if (!current || current.qualifiedName !== name) {
        throw invalidInput('XMP XML closing tag does not match')
      }
      position = cursor + 1
      continue
    }

    let cursor = open + 1
    while (whitespace(text[cursor])) cursor += 1
    const [qualifiedName, afterName] = readName(text, cursor, limits.maxNameLength)
    cursor = afterName
    const rawAttributes: Array<readonly [string, string]> = []
    let selfClosing = false
    while (cursor < text.length) {
      while (whitespace(text[cursor])) cursor += 1
      if (text[cursor] === '>') {
        cursor += 1
        break
      }
      if (text[cursor] === '/' && text[cursor + 1] === '>') {
        selfClosing = true
        cursor += 2
        break
      }
      const [attributeName, afterAttributeName] = readName(text, cursor, limits.maxNameLength)
      cursor = afterAttributeName
      while (whitespace(text[cursor])) cursor += 1
      if (text[cursor] !== '=') throw invalidInput('XMP XML attribute has no value')
      cursor += 1
      while (whitespace(text[cursor])) cursor += 1
      const quote = text[cursor]
      if (quote !== '"' && quote !== "'") throw invalidInput('XMP XML attribute is not quoted')
      const valueStart = cursor + 1
      const valueEnd = text.indexOf(quote, valueStart)
      if (valueEnd < 0) throw invalidInput('XMP XML attribute is truncated')
      if (rawAttributes.some(([name]) => name === attributeName)) {
        throw invalidInput('XMP XML element repeats an attribute')
      }
      rawAttributes.push([attributeName, decodeEntities(text.slice(valueStart, valueEnd))])
      attributeCount += 1
      if (attributeCount > limits.maxAttributes) {
        throw limitExceeded('XMP XML attributes exceed their limit')
      }
      cursor = valueEnd + 1
    }
    if (cursor > text.length) throw invalidInput('XMP XML start tag is truncated')

    const inherited = stack[stack.length - 1]?.namespaces ?? new Map<string, string>()
    const namespaceMap = new Map(inherited)
    for (const [name, value] of rawAttributes) {
      if (name === 'xmlns') namespaceMap.set('', value)
      else if (name.startsWith('xmlns:')) namespaceMap.set(name.slice(6), value)
    }
    const [namespace, localName] = resolveName(qualifiedName, namespaceMap, false)
    const attributes: BoundedXmlAttribute[] = []
    for (const [name, value] of rawAttributes) {
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue
      const [attributeNamespace, attributeLocalName] = resolveName(name, namespaceMap, true)
      attributes.push(
        Object.freeze({ namespace: attributeNamespace, localName: attributeLocalName, value }),
      )
    }
    const element: MutableElement = {
      namespace,
      localName,
      attributes,
      children: [],
      text: '',
      namespaces: namespaceMap,
      qualifiedName,
    }
    elementCount += 1
    if (elementCount > limits.maxElements)
      throw limitExceeded('XMP XML elements exceed their limit')
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(element)
    else roots.push(element)
    if (!selfClosing) {
      stack.push(element)
      if (stack.length > limits.maxDepth) throw limitExceeded('XMP XML nesting exceeds its limit')
    }
    position = cursor
  }
  if (stack.length !== 0) throw invalidInput('XMP XML element is not closed')
  if (roots.length !== 1 || !roots[0]) throw invalidInput('XMP XML must contain one root element')
  return freezeElement(roots[0])
}

export const xmlElements = (
  root: BoundedXmlElement,
  namespace: string,
  localName: string,
): readonly BoundedXmlElement[] => {
  const matches: BoundedXmlElement[] = []
  const visit = (element: BoundedXmlElement): void => {
    if (element.namespace === namespace && element.localName === localName) matches.push(element)
    for (const child of element.children) visit(child)
  }
  visit(root)
  return matches
}

export const xmlAttribute = (
  element: BoundedXmlElement,
  namespace: string,
  localName: string,
): string | undefined =>
  element.attributes.find(
    (attribute) => attribute.namespace === namespace && attribute.localName === localName,
  )?.value
