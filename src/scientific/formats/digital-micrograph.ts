import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../../errors.ts'
import { type ImageSource, type ImageSourceReadOptions, readExactly } from '../../source.ts'

export type DigitalMicrographVersion = 3 | 4
export type DigitalMicrographByteOrder = 'little-endian' | 'big-endian'

export type DigitalMicrographScalarType =
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'
  | 'float32'
  | 'float64'
  | 'boolean'

export interface DigitalMicrographScalarDescriptor {
  readonly kind: 'scalar'
  readonly typeCode: number
  readonly type: DigitalMicrographScalarType
  readonly byteLength: number
}

export interface DigitalMicrographStringDescriptor {
  readonly kind: 'string'
  readonly typeCode: 18
  readonly length: number
  readonly byteLength: number
}

export interface DigitalMicrographStructFieldDescriptor {
  readonly nameLength: number
  readonly descriptor: DigitalMicrographValueDescriptor
}

export interface DigitalMicrographStructDescriptor {
  readonly kind: 'struct'
  readonly typeCode: 15
  readonly nameLength: number
  readonly fields: readonly DigitalMicrographStructFieldDescriptor[]
  readonly byteLength: number
}

export interface DigitalMicrographArrayDescriptor {
  readonly kind: 'array'
  readonly typeCode: 20
  readonly length: number
  readonly element: DigitalMicrographValueDescriptor
  readonly byteLength: number
}

export type DigitalMicrographValueDescriptor =
  | DigitalMicrographScalarDescriptor
  | DigitalMicrographStringDescriptor
  | DigitalMicrographStructDescriptor
  | DigitalMicrographArrayDescriptor

export interface DigitalMicrographPathSegment {
  readonly name: string
  readonly occurrence: number
}

export interface DigitalMicrographPayloadSpan {
  readonly offset: number
  readonly byteLength: number
  readonly byteOrder: DigitalMicrographByteOrder
}

interface DigitalMicrographNodeBase {
  readonly name: string
  readonly occurrence: number
  readonly path: readonly DigitalMicrographPathSegment[]
  readonly entryOffset: number
  readonly entryByteLength: number
  readonly declaredContentBytes?: number
}

export interface DigitalMicrographValueNode extends DigitalMicrographNodeBase {
  readonly kind: 'value'
  readonly descriptor: DigitalMicrographValueDescriptor
  readonly payload: DigitalMicrographPayloadSpan
}

export interface DigitalMicrographGroupNode extends DigitalMicrographNodeBase {
  readonly kind: 'group'
  readonly sorted: boolean
  readonly open: boolean
  readonly children: readonly DigitalMicrographNode[]
}

export type DigitalMicrographNode = DigitalMicrographValueNode | DigitalMicrographGroupNode

export type DigitalMicrographMetadataValue =
  | boolean
  | number
  | string
  | readonly DigitalMicrographMetadataValue[]

export interface DigitalMicrographMetadataEntry {
  readonly path: readonly DigitalMicrographPathSegment[]
  readonly value: DigitalMicrographMetadataValue
}

export type DigitalMicrographMetadataOmissionReason =
  | 'aggregate-limit'
  | 'image-payload'
  | 'value-limit'

export interface DigitalMicrographMetadataOmission {
  readonly path: readonly DigitalMicrographPathSegment[]
  readonly reason: DigitalMicrographMetadataOmissionReason
}

export interface DigitalMicrographIndex {
  readonly version: DigitalMicrographVersion
  readonly byteOrder: DigitalMicrographByteOrder
  readonly declaredRootBytes: number
  readonly root: Readonly<{
    readonly sorted: boolean
    readonly open: boolean
    readonly children: readonly DigitalMicrographNode[]
  }>
  readonly metadata: readonly DigitalMicrographMetadataEntry[]
  readonly metadataOmissions: readonly DigitalMicrographMetadataOmission[]
  readonly sourceBytesRead: number
  readonly tagCount: number
}

export interface DigitalMicrographIndexOptions extends AbortOptions {
  readonly maxDepth?: number
  readonly maxTags?: number
  readonly maxNameBytes?: number
  readonly maxInfoEntries?: number
  readonly maxTypeDepth?: number
  readonly maxMetadataBytes?: number
  readonly maxMetadataValueBytes?: number
  readonly maxMetadataValues?: number
}

interface ResolvedIndexOptions {
  readonly signal?: AbortSignal
  readonly maxDepth: number
  readonly maxTags: number
  readonly maxNameBytes: number
  readonly maxInfoEntries: number
  readonly maxTypeDepth: number
  readonly maxMetadataBytes: number
  readonly maxMetadataValueBytes: number
  readonly maxMetadataValues: number
}

const defaultOptions: Omit<ResolvedIndexOptions, 'signal'> = Object.freeze({
  maxDepth: 64,
  maxTags: 100_000,
  maxNameBytes: 4_096,
  maxInfoEntries: 4_096,
  maxTypeDepth: 16,
  maxMetadataBytes: 1_048_576,
  maxMetadataValueBytes: 65_536,
  maxMetadataValues: 16_384,
})

const positiveInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const nonNegativeInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${name} must be a non-negative safe integer`)
  }
  return value
}

const resolveOptions = (options: Readonly<DigitalMicrographIndexOptions>): ResolvedIndexOptions =>
  Object.freeze({
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    maxDepth: positiveInteger('DM maxDepth', options.maxDepth ?? defaultOptions.maxDepth),
    maxTags: positiveInteger('DM maxTags', options.maxTags ?? defaultOptions.maxTags),
    maxNameBytes: positiveInteger(
      'DM maxNameBytes',
      options.maxNameBytes ?? defaultOptions.maxNameBytes,
    ),
    maxInfoEntries: positiveInteger(
      'DM maxInfoEntries',
      options.maxInfoEntries ?? defaultOptions.maxInfoEntries,
    ),
    maxTypeDepth: positiveInteger(
      'DM maxTypeDepth',
      options.maxTypeDepth ?? defaultOptions.maxTypeDepth,
    ),
    maxMetadataBytes: nonNegativeInteger(
      'DM maxMetadataBytes',
      options.maxMetadataBytes ?? defaultOptions.maxMetadataBytes,
    ),
    maxMetadataValueBytes: nonNegativeInteger(
      'DM maxMetadataValueBytes',
      options.maxMetadataValueBytes ?? defaultOptions.maxMetadataValueBytes,
    ),
    maxMetadataValues: positiveInteger(
      'DM maxMetadataValues',
      options.maxMetadataValues ?? defaultOptions.maxMetadataValues,
    ),
  })

class CountingSource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  bytesRead = 0

  constructor(source: ImageSource) {
    this.#source = source
    this.size = source.size
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    const data = await this.#source.read(offset, length, options)
    this.bytesRead += data.byteLength
    return data
  }
}

class DigitalMicrographCursor {
  readonly #source: ImageSource
  readonly #signal: AbortSignal | undefined
  position = 0

  constructor(source: ImageSource, signal: AbortSignal | undefined) {
    this.#source = source
    this.#signal = signal
  }

  async read(length: number): Promise<Uint8Array> {
    throwIfAborted(this.#signal)
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidInput('DM structural read length is invalid')
    }
    const offset = this.position
    const end = BigInt(offset) + BigInt(length)
    if (end > BigInt(this.#source.size)) {
      throw truncatedInput(`DM structure exceeds the input at offset ${offset}`)
    }
    const data = await readExactly(this.#source, offset, length, {
      ...(this.#signal === undefined ? {} : { signal: this.#signal }),
    })
    this.position += length
    return data
  }

  skip(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidInput('DM structural skip length is invalid')
    }
    const end = BigInt(this.position) + BigInt(length)
    if (end > BigInt(this.#source.size)) {
      throw truncatedInput(`DM payload exceeds the input at offset ${this.position}`)
    }
    this.position += length
  }
}

const safeNumber = (value: bigint, label: string): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw limitExceeded(`DM ${label} exceeds the JavaScript safe integer range`)
  }
  return Number(value)
}

const safeByteLength = (value: bigint, label: string): number => {
  const length = safeNumber(value, label)
  if (length < 0) throw invalidInput(`DM ${label} is negative`)
  return length
}

const checkedAdd = (left: number, right: number, label: string): number =>
  safeNumber(BigInt(left) + BigInt(right), label)

const decodeTagName = (bytes: Uint8Array): string => {
  for (const byte of bytes) {
    if (byte < 0x20 || byte === 0x7f) {
      throw invalidInput('DM tag name contains control data')
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    let output = ''
    for (const byte of bytes) output += String.fromCharCode(byte)
    return output
  }
}

const scalarDescriptors: ReadonlyMap<number, DigitalMicrographScalarDescriptor> = new Map<
  number,
  DigitalMicrographScalarDescriptor
>([
  [2, Object.freeze({ kind: 'scalar', typeCode: 2, type: 'int16', byteLength: 2 })],
  [3, Object.freeze({ kind: 'scalar', typeCode: 3, type: 'int32', byteLength: 4 })],
  [4, Object.freeze({ kind: 'scalar', typeCode: 4, type: 'uint16', byteLength: 2 })],
  [5, Object.freeze({ kind: 'scalar', typeCode: 5, type: 'uint32', byteLength: 4 })],
  [6, Object.freeze({ kind: 'scalar', typeCode: 6, type: 'float32', byteLength: 4 })],
  [7, Object.freeze({ kind: 'scalar', typeCode: 7, type: 'float64', byteLength: 8 })],
  [8, Object.freeze({ kind: 'scalar', typeCode: 8, type: 'boolean', byteLength: 1 })],
  [9, Object.freeze({ kind: 'scalar', typeCode: 9, type: 'int8', byteLength: 1 })],
  [10, Object.freeze({ kind: 'scalar', typeCode: 10, type: 'uint8', byteLength: 1 })],
  [11, Object.freeze({ kind: 'scalar', typeCode: 11, type: 'int64', byteLength: 8 })],
  [12, Object.freeze({ kind: 'scalar', typeCode: 12, type: 'uint64', byteLength: 8 })],
])

interface InfoCursor {
  readonly values: readonly bigint[]
  position: number
}

const infoValue = (cursor: InfoCursor, label: string): bigint => {
  const value = cursor.values[cursor.position]
  if (value === undefined) throw invalidInput(`DM ${label} descriptor is truncated`)
  cursor.position += 1
  return value
}

const parseValueDescriptor = (
  cursor: InfoCursor,
  depth: number,
  options: ResolvedIndexOptions,
): DigitalMicrographValueDescriptor => {
  if (depth > options.maxTypeDepth) {
    throw limitExceeded(`DM type descriptor depth exceeds ${options.maxTypeDepth}`)
  }
  const typeCode = safeNumber(infoValue(cursor, 'type'), 'type code')
  const scalar = scalarDescriptors.get(typeCode)
  if (scalar !== undefined) return scalar
  if (typeCode === 18) {
    const length = safeNumber(infoValue(cursor, 'string'), 'string length')
    return Object.freeze({ kind: 'string', typeCode: 18, length, byteLength: length })
  }
  if (typeCode === 15) {
    const nameLength = safeNumber(infoValue(cursor, 'struct name'), 'struct name length')
    const fieldCount = safeNumber(infoValue(cursor, 'struct field count'), 'struct field count')
    if (fieldCount > options.maxInfoEntries) {
      throw limitExceeded(`DM struct field count exceeds ${options.maxInfoEntries}`)
    }
    const fields: DigitalMicrographStructFieldDescriptor[] = []
    let byteLength = 0n
    for (let field = 0; field < fieldCount; field += 1) {
      const fieldNameLength = safeNumber(
        infoValue(cursor, 'struct field name'),
        'struct field name length',
      )
      const descriptor = parseValueDescriptor(cursor, depth + 1, options)
      byteLength += BigInt(descriptor.byteLength)
      fields.push(Object.freeze({ nameLength: fieldNameLength, descriptor }))
    }
    return Object.freeze({
      kind: 'struct',
      typeCode: 15,
      nameLength,
      fields: Object.freeze(fields),
      byteLength: safeByteLength(byteLength, 'struct payload size'),
    })
  }
  if (typeCode === 20) {
    const element = parseValueDescriptor(cursor, depth + 1, options)
    const length = safeNumber(infoValue(cursor, 'array length'), 'array length')
    const byteLength = safeByteLength(
      BigInt(element.byteLength) * BigInt(length),
      'array payload size',
    )
    return Object.freeze({ kind: 'array', typeCode: 20, length, element, byteLength })
  }
  throw unsupportedOperation(`DM encoded type ${typeCode} is unsupported`)
}

const descriptorFromInfo = (
  values: readonly bigint[],
  options: ResolvedIndexOptions,
): DigitalMicrographValueDescriptor => {
  const cursor: InfoCursor = { values, position: 0 }
  const descriptor = parseValueDescriptor(cursor, 1, options)
  if (cursor.position !== values.length) {
    throw invalidInput('DM type descriptor contains trailing info values')
  }
  return descriptor
}

const descriptorValueCount = (descriptor: DigitalMicrographValueDescriptor): bigint => {
  if (descriptor.kind === 'scalar' || descriptor.kind === 'string') return 1n
  if (descriptor.kind === 'struct') {
    return descriptor.fields.reduce(
      (total, field) => total + descriptorValueCount(field.descriptor),
      0n,
    )
  }
  return BigInt(descriptor.length) * descriptorValueCount(descriptor.element)
}

interface DecodeCursor {
  readonly bytes: Uint8Array
  readonly view: DataView
  readonly littleEndian: boolean
  position: number
}

const finiteNumber = (value: number): number | string => {
  if (Number.isFinite(value)) return value
  if (Number.isNaN(value)) return 'NaN'
  return value > 0 ? 'Infinity' : '-Infinity'
}

const decodeString = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\0', '')
  } catch {
    let output = ''
    for (const byte of bytes) output += String.fromCharCode(byte)
    return output.replaceAll('\0', '')
  }
}

const decodeMetadataValue = (
  descriptor: DigitalMicrographValueDescriptor,
  cursor: DecodeCursor,
): DigitalMicrographMetadataValue => {
  const start = cursor.position
  const end = checkedAdd(start, descriptor.byteLength, 'metadata value end')
  if (end > cursor.bytes.byteLength) throw invalidInput('DM metadata payload is truncated')
  if (descriptor.kind === 'string') {
    cursor.position = end
    return decodeString(cursor.bytes.subarray(start, end))
  }
  if (descriptor.kind === 'struct') {
    const values = descriptor.fields.map((field) => decodeMetadataValue(field.descriptor, cursor))
    return Object.freeze(values)
  }
  if (descriptor.kind === 'array') {
    const values: DigitalMicrographMetadataValue[] = []
    for (let index = 0; index < descriptor.length; index += 1) {
      values.push(decodeMetadataValue(descriptor.element, cursor))
    }
    return Object.freeze(values)
  }
  cursor.position = end
  if (descriptor.type === 'int8') return cursor.view.getInt8(start)
  if (descriptor.type === 'uint8') return cursor.view.getUint8(start)
  if (descriptor.type === 'int16') return cursor.view.getInt16(start, cursor.littleEndian)
  if (descriptor.type === 'uint16') return cursor.view.getUint16(start, cursor.littleEndian)
  if (descriptor.type === 'int32') return cursor.view.getInt32(start, cursor.littleEndian)
  if (descriptor.type === 'uint32') return cursor.view.getUint32(start, cursor.littleEndian)
  if (descriptor.type === 'int64') {
    return cursor.view.getBigInt64(start, cursor.littleEndian).toString(10)
  }
  if (descriptor.type === 'uint64') {
    return cursor.view.getBigUint64(start, cursor.littleEndian).toString(10)
  }
  if (descriptor.type === 'float32') {
    return finiteNumber(cursor.view.getFloat32(start, cursor.littleEndian))
  }
  if (descriptor.type === 'float64') {
    return finiteNumber(cursor.view.getFloat64(start, cursor.littleEndian))
  }
  const boolean = cursor.view.getUint8(start)
  if (boolean !== 0 && boolean !== 1) throw invalidInput('DM boolean metadata must be 0 or 1')
  return boolean === 1
}

const isImagePayload = (node: DigitalMicrographValueNode): boolean =>
  node.name === 'Data' &&
  node.descriptor.kind === 'array' &&
  node.path.some(({ name }) => name === 'ImageData')

class DigitalMicrographIndexer {
  readonly #source: ImageSource
  readonly #cursor: DigitalMicrographCursor
  readonly #options: ResolvedIndexOptions
  readonly #version: DigitalMicrographVersion
  readonly #byteOrder: DigitalMicrographByteOrder
  readonly #structuralIntegerBytes: 4 | 8
  readonly #valueNodes: DigitalMicrographValueNode[] = []
  tagCount = 0

  constructor(
    source: ImageSource,
    cursor: DigitalMicrographCursor,
    options: ResolvedIndexOptions,
    version: DigitalMicrographVersion,
    byteOrder: DigitalMicrographByteOrder,
  ) {
    this.#source = source
    this.#cursor = cursor
    this.#options = options
    this.#version = version
    this.#byteOrder = byteOrder
    this.#structuralIntegerBytes = version === 4 ? 8 : 4
  }

  #structuralInteger(bytes: Uint8Array, offset: number, label: string): bigint {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, this.#structuralIntegerBytes)
    const value =
      this.#structuralIntegerBytes === 8
        ? view.getBigUint64(0, false)
        : BigInt(view.getUint32(0, false))
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw limitExceeded(`DM ${label} exceeds the JavaScript safe integer range`)
    }
    return value
  }

  async #groupContents(
    path: readonly DigitalMicrographPathSegment[],
    depth: number,
  ): Promise<
    Readonly<{ sorted: boolean; open: boolean; children: readonly DigitalMicrographNode[] }>
  > {
    if (depth > this.#options.maxDepth) {
      throw limitExceeded(`DM tag-tree depth exceeds ${this.#options.maxDepth}`)
    }
    const groupHeader = await this.#cursor.read(2 + this.#structuralIntegerBytes)
    const sortedFlag = groupHeader[0] ?? 0
    const openFlag = groupHeader[1] ?? 0
    if ((sortedFlag !== 0 && sortedFlag !== 1) || (openFlag !== 0 && openFlag !== 1)) {
      throw invalidInput('DM tag group flags must be 0 or 1')
    }
    const count = safeNumber(this.#structuralInteger(groupHeader, 2, 'tag count'), 'tag count')
    if (count > this.#options.maxTags - this.tagCount) {
      throw limitExceeded(`DM tag count exceeds ${this.#options.maxTags}`)
    }
    const occurrences = new Map<string, number>()
    const children: DigitalMicrographNode[] = []
    for (let entry = 0; entry < count; entry += 1) {
      throwIfAborted(this.#options.signal)
      const entryOffset = this.#cursor.position
      const entryHeader = await this.#cursor.read(3)
      const tagId = entryHeader[0] ?? 0
      if (tagId !== 20 && tagId !== 21) {
        throw invalidInput(`DM tag ID ${tagId} is invalid at offset ${entryOffset}`)
      }
      const nameLength = new DataView(entryHeader.buffer, entryHeader.byteOffset + 1, 2).getUint16(
        0,
        false,
      )
      if (nameLength > this.#options.maxNameBytes) {
        throw limitExceeded(`DM tag name exceeds ${this.#options.maxNameBytes} bytes`)
      }
      const entryDetails = await this.#cursor.read(
        nameLength + (this.#version === 4 ? this.#structuralIntegerBytes : 0),
      )
      const name = decodeTagName(entryDetails.subarray(0, nameLength))
      const occurrence = occurrences.get(name) ?? 0
      occurrences.set(name, occurrence + 1)
      const segment = Object.freeze({ name, occurrence })
      const childPath = Object.freeze([...path, segment])
      const declaredContentBytes =
        this.#version === 4
          ? safeNumber(
              this.#structuralInteger(entryDetails, nameLength, 'entry byte length'),
              'entry byte length',
            )
          : undefined
      const contentOffset = this.#cursor.position
      const declaredEnd =
        declaredContentBytes === undefined
          ? undefined
          : checkedAdd(contentOffset, declaredContentBytes, 'entry end')
      if (declaredEnd !== undefined && declaredEnd > this.#source.size) {
        throw truncatedInput('DM4 declared entry length exceeds the input')
      }
      this.tagCount += 1
      const node =
        tagId === 20
          ? await this.#groupNode(
              name,
              occurrence,
              childPath,
              depth + 1,
              entryOffset,
              declaredContentBytes,
              declaredEnd,
            )
          : await this.#valueNode(
              name,
              occurrence,
              childPath,
              entryOffset,
              declaredContentBytes,
              declaredEnd,
            )
      children.push(node)
    }
    return Object.freeze({
      sorted: sortedFlag === 1,
      open: openFlag === 1,
      children: Object.freeze(children),
    })
  }

  async #groupNode(
    name: string,
    occurrence: number,
    path: readonly DigitalMicrographPathSegment[],
    depth: number,
    entryOffset: number,
    declaredContentBytes: number | undefined,
    declaredEnd: number | undefined,
  ): Promise<DigitalMicrographGroupNode> {
    const group = await this.#groupContents(path, depth)
    if (declaredEnd !== undefined && this.#cursor.position !== declaredEnd) {
      throw invalidInput('DM4 tag-group length does not match its contents')
    }
    return Object.freeze({
      kind: 'group',
      name,
      occurrence,
      path,
      entryOffset,
      entryByteLength: this.#cursor.position - entryOffset,
      ...(declaredContentBytes === undefined ? {} : { declaredContentBytes }),
      ...group,
    })
  }

  async #valueNode(
    name: string,
    occurrence: number,
    path: readonly DigitalMicrographPathSegment[],
    entryOffset: number,
    declaredContentBytes: number | undefined,
    declaredEnd: number | undefined,
  ): Promise<DigitalMicrographValueNode> {
    const valueHeader = await this.#cursor.read(4 + this.#structuralIntegerBytes)
    const delimiter = valueHeader.subarray(0, 4)
    if (
      delimiter[0] !== 0x25 ||
      delimiter[1] !== 0x25 ||
      delimiter[2] !== 0x25 ||
      delimiter[3] !== 0x25
    ) {
      throw invalidInput('DM data tag delimiter is not %%%%')
    }
    const infoCount = safeNumber(
      this.#structuralInteger(valueHeader, 4, 'info count'),
      'info count',
    )
    if (infoCount < 1) throw invalidInput('DM data tag info array is empty')
    if (infoCount > this.#options.maxInfoEntries) {
      throw limitExceeded(`DM info array exceeds ${this.#options.maxInfoEntries} entries`)
    }
    const infoBytes = await this.#cursor.read(infoCount * this.#structuralIntegerBytes)
    const info: bigint[] = []
    for (let index = 0; index < infoCount; index += 1) {
      info.push(
        this.#structuralInteger(infoBytes, index * this.#structuralIntegerBytes, 'info value'),
      )
    }
    const descriptor = descriptorFromInfo(Object.freeze(info), this.#options)
    const payloadOffset = this.#cursor.position
    const payloadEnd = checkedAdd(payloadOffset, descriptor.byteLength, 'payload end')
    if (payloadEnd > this.#source.size) throw truncatedInput('DM data payload exceeds the input')
    this.#cursor.skip(descriptor.byteLength)
    if (declaredEnd !== undefined && this.#cursor.position !== declaredEnd) {
      throw invalidInput('DM4 data-tag length does not match its descriptor and payload')
    }
    const node: DigitalMicrographValueNode = Object.freeze({
      kind: 'value',
      name,
      occurrence,
      path,
      entryOffset,
      entryByteLength: this.#cursor.position - entryOffset,
      ...(declaredContentBytes === undefined ? {} : { declaredContentBytes }),
      descriptor,
      payload: Object.freeze({
        offset: payloadOffset,
        byteLength: descriptor.byteLength,
        byteOrder: this.#byteOrder,
      }),
    })
    this.#valueNodes.push(node)
    return node
  }

  async root(): Promise<
    Readonly<{ sorted: boolean; open: boolean; children: readonly DigitalMicrographNode[] }>
  > {
    return this.#groupContents(Object.freeze([]), 0)
  }

  async metadata(): Promise<
    Readonly<{
      entries: readonly DigitalMicrographMetadataEntry[]
      omissions: readonly DigitalMicrographMetadataOmission[]
    }>
  > {
    const entries: DigitalMicrographMetadataEntry[] = []
    const omissions: DigitalMicrographMetadataOmission[] = []
    let remaining = this.#options.maxMetadataBytes
    for (const node of this.#valueNodes) {
      let reason: DigitalMicrographMetadataOmissionReason | undefined
      if (isImagePayload(node)) reason = 'image-payload'
      else if (
        node.payload.byteLength > this.#options.maxMetadataValueBytes ||
        descriptorValueCount(node.descriptor) > BigInt(this.#options.maxMetadataValues)
      ) {
        reason = 'value-limit'
      } else if (node.payload.byteLength > remaining) reason = 'aggregate-limit'
      if (reason !== undefined) {
        omissions.push(Object.freeze({ path: node.path, reason }))
        continue
      }
      throwIfAborted(this.#options.signal)
      const bytes = await readExactly(this.#source, node.payload.offset, node.payload.byteLength, {
        ...(this.#options.signal === undefined ? {} : { signal: this.#options.signal }),
      })
      const cursor: DecodeCursor = {
        bytes,
        view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        littleEndian: this.#byteOrder === 'little-endian',
        position: 0,
      }
      const value = decodeMetadataValue(node.descriptor, cursor)
      if (cursor.position !== bytes.byteLength) {
        throw invalidInput('DM metadata descriptor did not consume its payload')
      }
      entries.push(Object.freeze({ path: node.path, value }))
      remaining -= node.payload.byteLength
    }
    return Object.freeze({
      entries: Object.freeze(entries),
      omissions: Object.freeze(omissions),
    })
  }
}

/**
 * Build a bounded random-access index of a DM3 or DM4 tag tree.
 *
 * This internal B1 surface indexes payload spans and small metadata only. It does not expose image
 * datasets or interpret DigitalMicrograph axis semantics; those belong to the explicit reader.
 */
export const indexDigitalMicrograph = async (
  source: ImageSource,
  options: Readonly<DigitalMicrographIndexOptions> = {},
): Promise<DigitalMicrographIndex> => {
  if (!Number.isSafeInteger(source.size) || source.size < 0) {
    throw invalidInput('DM source size is invalid')
  }
  const resolved = resolveOptions(options)
  throwIfAborted(resolved.signal)
  const counted = new CountingSource(source)
  const cursor = new DigitalMicrographCursor(counted, resolved.signal)
  const versionBytes = await cursor.read(4)
  const rawVersion = new DataView(
    versionBytes.buffer,
    versionBytes.byteOffset,
    versionBytes.byteLength,
  ).getUint32(0, false)
  if (rawVersion !== 3 && rawVersion !== 4) {
    throw invalidInput(`DM version ${rawVersion} is unsupported; expected 3 or 4`)
  }
  const version: DigitalMicrographVersion = rawVersion
  const remainingHeader = await cursor.read(version === 4 ? 12 : 8)
  const remainingView = new DataView(
    remainingHeader.buffer,
    remainingHeader.byteOffset,
    remainingHeader.byteLength,
  )
  const declaredRootBigInt =
    version === 4 ? remainingView.getBigUint64(0, false) : BigInt(remainingView.getUint32(0, false))
  const declaredRootBytes = safeNumber(declaredRootBigInt, 'root byte length')
  const byteOrderFlag = remainingView.getUint32(version === 4 ? 8 : 4, false)
  if (byteOrderFlag !== 0 && byteOrderFlag !== 1) {
    throw invalidInput('DM payload byte-order flag must be 0 or 1')
  }
  const byteOrder: DigitalMicrographByteOrder = byteOrderFlag === 1 ? 'little-endian' : 'big-endian'
  const minimumRootBytes = version === 4 ? 10 : 6
  if (declaredRootBytes < minimumRootBytes) throw invalidInput('DM root byte length is too small')
  const declaredRootEnd = checkedAdd(cursor.position, declaredRootBytes, 'declared root end')
  if (declaredRootEnd > source.size) {
    throw truncatedInput('DM declared root length exceeds the input')
  }
  const indexer = new DigitalMicrographIndexer(counted, cursor, resolved, version, byteOrder)
  const root = await indexer.root()
  if (cursor.position > declaredRootEnd) {
    throw invalidInput('DM tag tree exceeds the declared root length')
  }
  const metadata = await indexer.metadata()
  return Object.freeze({
    version,
    byteOrder,
    declaredRootBytes,
    root,
    metadata: metadata.entries,
    metadataOmissions: metadata.omissions,
    sourceBytesRead: counted.bytesRead,
    tagCount: indexer.tagCount,
  })
}
