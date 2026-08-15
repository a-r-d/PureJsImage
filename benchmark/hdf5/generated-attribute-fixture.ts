export interface GeneratedAttributeMessageOptions {
  readonly version: 1 | 2 | 3
  readonly name: string
  readonly datatype: Uint8Array
  readonly dataspace: Uint8Array
  readonly data: Uint8Array
  readonly characterSet?: 'ascii' | 'utf-8'
  readonly sharedDatatype?: boolean
  readonly sharedDataspace?: boolean
}

const paddedToEight = (value: number): number => (value + 7) & ~7

const writeUint16 = (bytes: Uint8Array, offset: number, value: number): void => {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true)
}

export const createGeneratedAttributeMessage = (
  options: Readonly<GeneratedAttributeMessageOptions>,
): Uint8Array<ArrayBuffer> => {
  const encodedName = new TextEncoder().encode(options.name)
  if (encodedName.byteLength === 0 || encodedName.includes(0)) {
    throw new Error('Generated HDF5 attribute name must be non-empty and contain no NUL')
  }
  if (options.characterSet !== 'utf-8' && encodedName.some((value) => value > 0x7f)) {
    throw new Error('Generated ASCII HDF5 attribute name must contain only ASCII')
  }
  const nameBytes = encodedName.byteLength + 1
  for (const [label, value] of [
    ['name', nameBytes],
    ['datatype', options.datatype.byteLength],
    ['dataspace', options.dataspace.byteLength],
  ] as const) {
    if (value > 0xffff) throw new Error(`Generated HDF5 attribute ${label} is too large`)
  }
  const headerBytes = options.version === 3 ? 9 : 8
  const storedNameBytes = options.version === 1 ? paddedToEight(nameBytes) : nameBytes
  const storedDatatypeBytes =
    options.version === 1 ? paddedToEight(options.datatype.byteLength) : options.datatype.byteLength
  const storedDataspaceBytes =
    options.version === 1
      ? paddedToEight(options.dataspace.byteLength)
      : options.dataspace.byteLength
  const output = new Uint8Array(
    headerBytes +
      storedNameBytes +
      storedDatatypeBytes +
      storedDataspaceBytes +
      options.data.byteLength,
  )
  output[0] = options.version
  if (options.version !== 1) {
    output[1] =
      (options.sharedDatatype === true ? 1 : 0) | (options.sharedDataspace === true ? 2 : 0)
  }
  writeUint16(output, 2, nameBytes)
  writeUint16(output, 4, options.datatype.byteLength)
  writeUint16(output, 6, options.dataspace.byteLength)
  if (options.version === 3) output[8] = options.characterSet === 'utf-8' ? 1 : 0
  let position = headerBytes
  output.set(encodedName, position)
  position += storedNameBytes
  output.set(options.datatype, position)
  position += storedDatatypeBytes
  output.set(options.dataspace, position)
  position += storedDataspaceBytes
  output.set(options.data, position)
  return output
}

export const generatedLittleEndianInteger = (
  value: bigint,
  byteLength: number,
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(byteLength)
  const modulus = 1n << BigInt(byteLength * 8)
  let remaining = value < 0n ? modulus + value : value
  if (remaining < 0n || remaining >= modulus) {
    throw new Error(`Generated HDF5 integer ${value} does not fit ${byteLength} bytes`)
  }
  for (let index = 0; index < byteLength; index += 1) {
    output[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return output
}
