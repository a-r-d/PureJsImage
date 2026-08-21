export type FixtureNetCdfType = 'byte' | 'char' | 'short' | 'int' | 'float' | 'double'

export interface FixtureNetCdfAttribute {
  readonly name: string
  readonly type: FixtureNetCdfType
  readonly values: string | readonly number[]
}

export interface FixtureNetCdfDimension {
  readonly name: string
  readonly length: number
  readonly unlimited?: boolean
}

export interface FixtureNetCdfVariable {
  readonly name: string
  readonly dimensions: readonly string[]
  readonly type: FixtureNetCdfType
  readonly attributes?: readonly FixtureNetCdfAttribute[]
  readonly values: string | readonly number[]
}

export interface FixtureNetCdfOptions {
  readonly version: 1 | 2
  readonly dimensions: readonly FixtureNetCdfDimension[]
  readonly variables: readonly FixtureNetCdfVariable[]
  readonly globalAttributes?: readonly FixtureNetCdfAttribute[]
  readonly numRecords?: number
  readonly dataStart?: number
}

export interface FixtureNetCdfResult {
  readonly bytes?: Uint8Array
  readonly header: Uint8Array
  readonly size: number
  readonly segments: readonly { readonly offset: number; readonly bytes: Uint8Array }[]
  readonly variableOffsets: Readonly<Record<string, number>>
}

const typeCode = (type: FixtureNetCdfType): number => {
  if (type === 'byte') return 1
  if (type === 'char') return 2
  if (type === 'short') return 3
  if (type === 'int') return 4
  if (type === 'float') return 5
  return 6
}

const typeBytes = (type: FixtureNetCdfType): number => {
  if (type === 'byte' || type === 'char') return 1
  if (type === 'short') return 2
  if (type === 'int' || type === 'float') return 4
  return 8
}

const align4 = (value: number): number => value + ((4 - (value & 3)) & 3)

class Writer {
  readonly chunks: number[] = []

  u32(value: number): void {
    this.chunks.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    )
  }

  u64(value: number): void {
    const bigint = BigInt(value)
    this.u32(Number((bigint >> 32n) & 0xffff_ffffn))
    this.u32(Number(bigint & 0xffff_ffffn))
  }

  bytes(value: Uint8Array): void {
    this.chunks.push(...value)
  }

  name(value: string): void {
    const bytes = new TextEncoder().encode(value)
    this.u32(bytes.byteLength)
    this.bytes(bytes)
    while ((this.chunks.length & 3) !== 0) this.chunks.push(0)
  }

  output(): Uint8Array {
    return Uint8Array.from(this.chunks)
  }
}

const encodeValues = (type: FixtureNetCdfType, values: string | readonly number[]): Uint8Array => {
  if (type === 'char') {
    if (typeof values !== 'string') throw new Error('Character fixture values must be a string')
    return new TextEncoder().encode(values)
  }
  if (typeof values === 'string') throw new Error('Numeric fixture values must be an array')
  const bytes = new Uint8Array(values.length * typeBytes(type))
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0
    const offset = index * typeBytes(type)
    if (type === 'byte') view.setInt8(offset, value)
    else if (type === 'short') view.setInt16(offset, value, false)
    else if (type === 'int') view.setInt32(offset, value, false)
    else if (type === 'float') view.setFloat32(offset, value, false)
    else view.setFloat64(offset, value, false)
  }
  return bytes
}

const writeAttributes = (writer: Writer, attributes: readonly FixtureNetCdfAttribute[]): void => {
  if (attributes.length === 0) {
    writer.u32(0)
    writer.u32(0)
    return
  }
  writer.u32(12)
  writer.u32(attributes.length)
  for (const attribute of attributes) {
    writer.name(attribute.name)
    writer.u32(typeCode(attribute.type))
    const bytes = encodeValues(attribute.type, attribute.values)
    writer.u32(
      attribute.type === 'char' ? bytes.byteLength : bytes.byteLength / typeBytes(attribute.type),
    )
    writer.bytes(bytes)
    while ((writer.chunks.length & 3) !== 0) writer.chunks.push(0)
  }
}

const elementCount = (
  variable: FixtureNetCdfVariable,
  dimensions: ReadonlyMap<string, FixtureNetCdfDimension>,
  numRecords: number,
  oneRecord: boolean,
): number =>
  variable.dimensions.reduce((product, name, index) => {
    const dimension = dimensions.get(name)
    if (dimension === undefined) throw new Error(`Unknown fixture dimension ${name}`)
    const length =
      dimension.unlimited === true ? (oneRecord && index === 0 ? 1 : numRecords) : dimension.length
    return product * length
  }, 1)

const buildHeader = (
  options: FixtureNetCdfOptions,
  offsets: Readonly<Record<string, number>>,
  sizes: Readonly<Record<string, number>>,
): Uint8Array => {
  const writer = new Writer()
  writer.bytes(Uint8Array.of(0x43, 0x44, 0x46, options.version))
  writer.u32(options.numRecords ?? 0)
  if (options.dimensions.length === 0) {
    writer.u32(0)
    writer.u32(0)
  } else {
    writer.u32(10)
    writer.u32(options.dimensions.length)
    for (const dimension of options.dimensions) {
      writer.name(dimension.name)
      writer.u32(dimension.unlimited === true ? 0 : dimension.length)
    }
  }
  writeAttributes(writer, options.globalAttributes ?? [])
  if (options.variables.length === 0) {
    writer.u32(0)
    writer.u32(0)
  } else {
    writer.u32(11)
    writer.u32(options.variables.length)
    for (const variable of options.variables) {
      writer.name(variable.name)
      writer.u32(variable.dimensions.length)
      for (const dimension of variable.dimensions) {
        const id = options.dimensions.findIndex(({ name }) => name === dimension)
        if (id < 0) throw new Error(`Unknown fixture dimension ${dimension}`)
        writer.u32(id)
      }
      writeAttributes(writer, variable.attributes ?? [])
      writer.u32(typeCode(variable.type))
      writer.u32(sizes[variable.name] ?? 0)
      if (options.version === 1) writer.u32(offsets[variable.name] ?? 0)
      else writer.u64(offsets[variable.name] ?? 0)
    }
  }
  return writer.output()
}

export const createNetCdfClassicFixture = (options: FixtureNetCdfOptions): FixtureNetCdfResult => {
  const numRecords = options.numRecords ?? 0
  const dimensions = new Map(options.dimensions.map((dimension) => [dimension.name, dimension]))
  const recordVariables = options.variables.filter(
    (variable) => dimensions.get(variable.dimensions[0] ?? '')?.unlimited === true,
  )
  const fixedVariables = options.variables.filter((variable) => !recordVariables.includes(variable))
  const sizes: Record<string, number> = {}
  for (const variable of options.variables) {
    const count = elementCount(variable, dimensions, numRecords, recordVariables.includes(variable))
    sizes[variable.name] = align4(count * typeBytes(variable.type))
  }
  const emptyOffsets = Object.fromEntries(options.variables.map(({ name }) => [name, 0]))
  const provisional = buildHeader(options, emptyOffsets, sizes)
  let position = options.dataStart ?? align4(provisional.byteLength)
  if (position < provisional.byteLength) throw new Error('Fixture dataStart overlaps its header')
  const offsets: Record<string, number> = {}
  const segments: { offset: number; bytes: Uint8Array }[] = []
  for (const variable of fixedVariables) {
    offsets[variable.name] = position
    const data = encodeValues(variable.type, variable.values)
    const expected =
      elementCount(variable, dimensions, numRecords, false) * typeBytes(variable.type)
    if (data.byteLength !== expected)
      throw new Error(`Fixture variable ${variable.name} data length is invalid`)
    const padded = new Uint8Array(sizes[variable.name] ?? expected)
    padded.set(data)
    segments.push({ offset: position, bytes: padded })
    position += padded.byteLength
  }
  const recordStart = position
  let recordOffset = 0
  for (const variable of recordVariables) {
    offsets[variable.name] = recordStart + recordOffset
    recordOffset += sizes[variable.name] ?? 0
  }
  const onlyRecordVariable = recordVariables.length === 1 ? recordVariables[0] : undefined
  const recordStride =
    onlyRecordVariable === undefined
      ? recordOffset
      : elementCount(onlyRecordVariable, dimensions, numRecords, true) *
        typeBytes(onlyRecordVariable.type)
  for (let record = 0; record < numRecords; record += 1) {
    let slot = 0
    for (const variable of recordVariables) {
      const source = encodeValues(variable.type, variable.values)
      const recordBytes =
        elementCount(variable, dimensions, numRecords, true) * typeBytes(variable.type)
      if (source.byteLength !== recordBytes * numRecords) {
        throw new Error(`Fixture record variable ${variable.name} data length is invalid`)
      }
      const padded = new Uint8Array(
        onlyRecordVariable === undefined ? (sizes[variable.name] ?? recordBytes) : recordBytes,
      )
      padded.set(source.subarray(record * recordBytes, (record + 1) * recordBytes))
      segments.push({ offset: recordStart + record * recordStride + slot, bytes: padded })
      slot += padded.byteLength
    }
  }
  const header = buildHeader(options, offsets, sizes)
  const size = Math.max(
    header.byteLength,
    ...segments.map(({ offset, bytes }) => offset + bytes.byteLength),
  )
  const canMaterialize = size <= 64 * 1024 * 1024
  const bytes = canMaterialize ? new Uint8Array(size) : undefined
  if (bytes !== undefined) {
    bytes.set(header)
    for (const segment of segments) bytes.set(segment.bytes, segment.offset)
  }
  return Object.freeze({
    ...(bytes === undefined ? {} : { bytes }),
    header,
    size,
    segments: Object.freeze(segments.map((segment) => Object.freeze(segment))),
    variableOffsets: Object.freeze(offsets),
  })
}
