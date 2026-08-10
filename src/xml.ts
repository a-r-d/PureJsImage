import { invalidInput, limitExceeded } from './errors.ts'

export interface XmlElement {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly XmlElement[]
  readonly text: string
}

interface MutableXmlElement {
  readonly name: string
  readonly attributes: Record<string, string>
  readonly children: MutableXmlElement[]
  readonly text: string[]
}

export interface XmlParseOptions {
  readonly maxDepth?: number
  readonly maxElements?: number
  readonly maxCharacters?: number
}

const namePattern = /^[A-Za-z_][A-Za-z0-9_.:-]*/

const decodeEntities = (value: string): string =>
  value.replaceAll(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_match, entity: string) => {
    if (entity === 'amp') return '&'
    if (entity === 'lt') return '<'
    if (entity === 'gt') return '>'
    if (entity === 'quot') return '"'
    if (entity === 'apos') return "'"
    const numeric = entity.startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10)
    if (
      !Number.isSafeInteger(numeric) ||
      numeric < 0 ||
      numeric > 0x10ffff ||
      (numeric >= 0xd800 && numeric <= 0xdfff)
    ) {
      throw invalidInput('XML character reference is invalid')
    }
    return String.fromCodePoint(numeric)
  })

const decodedText = (value: string): string => {
  if (/&(?!(?:#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);)/.test(value)) {
    throw invalidInput('XML contains an unsupported entity reference')
  }
  return decodeEntities(value)
}

const immutableElement = (node: MutableXmlElement): XmlElement =>
  Object.freeze({
    name: node.name,
    attributes: Object.freeze({ ...node.attributes }),
    children: Object.freeze(node.children.map(immutableElement)),
    text: node.text.join(''),
  })

export const xmlLocalName = (name: string): string => {
  const separator = name.indexOf(':')
  return separator < 0 ? name : name.slice(separator + 1)
}

export const parseXmlDocument = (
  source: string,
  options: Readonly<XmlParseOptions> = {},
): XmlElement => {
  const maxDepth = options.maxDepth ?? 64
  const maxElements = options.maxElements ?? 100_000
  const maxCharacters = options.maxCharacters ?? 4_194_304
  if (
    !Number.isSafeInteger(maxDepth) ||
    maxDepth < 1 ||
    !Number.isSafeInteger(maxElements) ||
    maxElements < 1 ||
    !Number.isSafeInteger(maxCharacters) ||
    maxCharacters < 1
  ) {
    throw invalidInput('XML parser limits must be positive safe integers')
  }
  if (source.length > maxCharacters) {
    throw limitExceeded(`XML has ${source.length} characters; limit is ${maxCharacters}`)
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) {
    throw invalidInput('XML document type and entity declarations are unsupported')
  }

  const stack: MutableXmlElement[] = []
  let root: MutableXmlElement | undefined
  let elements = 0
  let offset = 0
  while (offset < source.length) {
    const opening = source.indexOf('<', offset)
    if (opening < 0) {
      const tail = decodedText(source.slice(offset))
      if (stack.length === 0) {
        if (tail.trim().length !== 0) throw invalidInput('XML has text outside its root element')
      } else stack[stack.length - 1]?.text.push(tail)
      break
    }
    const text = decodedText(source.slice(offset, opening))
    if (stack.length === 0) {
      if (text.trim().length !== 0) throw invalidInput('XML has text outside its root element')
    } else stack[stack.length - 1]?.text.push(text)

    if (source.startsWith('<!--', opening)) {
      const end = source.indexOf('-->', opening + 4)
      if (end < 0) throw invalidInput('XML comment is truncated')
      offset = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', opening)) {
      const end = source.indexOf(']]>', opening + 9)
      if (end < 0) throw invalidInput('XML CDATA section is truncated')
      const current = stack[stack.length - 1]
      if (!current) throw invalidInput('XML CDATA appears outside the root element')
      current.text.push(source.slice(opening + 9, end))
      offset = end + 3
      continue
    }
    if (source.startsWith('<?', opening)) {
      const end = source.indexOf('?>', opening + 2)
      if (end < 0) throw invalidInput('XML processing instruction is truncated')
      offset = end + 2
      continue
    }
    const closing = source.indexOf('>', opening + 1)
    if (closing < 0) throw invalidInput('XML element is truncated')
    const body = source.slice(opening + 1, closing)
    if (body.startsWith('/')) {
      const closingName = body.slice(1).trim()
      const current = stack.pop()
      if (!current || closingName !== current.name) {
        throw invalidInput(`XML closing element ${closingName || '<empty>'} does not match`)
      }
      offset = closing + 1
      continue
    }
    if (body.startsWith('!')) throw invalidInput('XML declaration is unsupported')
    const selfClosing = /\/\s*$/.test(body)
    const content = selfClosing ? body.replace(/\/\s*$/, '') : body
    const nameMatch = content.match(namePattern)
    if (!nameMatch) throw invalidInput('XML element name is invalid')
    const name = nameMatch[0]
    const attributes: Record<string, string> = {}
    let attributeOffset = name.length
    while (attributeOffset < content.length) {
      while (/\s/.test(content[attributeOffset] ?? '')) attributeOffset += 1
      if (attributeOffset >= content.length) break
      const attributeMatch = content.slice(attributeOffset).match(namePattern)
      if (!attributeMatch) throw invalidInput(`XML element ${name} has an invalid attribute`)
      const attributeName = attributeMatch[0]
      if (attributes[attributeName] !== undefined) {
        throw invalidInput(`XML element ${name} repeats attribute ${attributeName}`)
      }
      attributeOffset += attributeName.length
      while (/\s/.test(content[attributeOffset] ?? '')) attributeOffset += 1
      if (content[attributeOffset] !== '=') {
        throw invalidInput(`XML attribute ${attributeName} is missing '='`)
      }
      attributeOffset += 1
      while (/\s/.test(content[attributeOffset] ?? '')) attributeOffset += 1
      const quote = content[attributeOffset]
      if (quote !== '"' && quote !== "'") {
        throw invalidInput(`XML attribute ${attributeName} is not quoted`)
      }
      const valueEnd = content.indexOf(quote, attributeOffset + 1)
      if (valueEnd < 0) throw invalidInput(`XML attribute ${attributeName} is truncated`)
      attributes[attributeName] = decodedText(content.slice(attributeOffset + 1, valueEnd))
      attributeOffset = valueEnd + 1
    }
    elements += 1
    if (elements > maxElements) throw limitExceeded(`XML element count exceeds ${maxElements}`)
    const node: MutableXmlElement = { name, attributes, children: [], text: [] }
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else if (root) throw invalidInput('XML contains more than one root element')
    else root = node
    if (!selfClosing) {
      stack.push(node)
      if (stack.length > maxDepth) throw limitExceeded(`XML depth exceeds ${maxDepth}`)
    }
    offset = closing + 1
  }
  if (stack.length !== 0)
    throw invalidInput(`XML element ${stack[stack.length - 1]?.name} is unclosed`)
  if (!root) throw invalidInput('XML root element is missing')
  return immutableElement(root)
}

export const xmlChildren = (element: XmlElement, localName: string): readonly XmlElement[] =>
  element.children.filter((child) => xmlLocalName(child.name) === localName)

export const xmlChild = (element: XmlElement, localName: string): XmlElement | undefined =>
  xmlChildren(element, localName)[0]
