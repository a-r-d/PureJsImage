import { hdf5MetadataChecksum, type Hdf5IntegerWidth } from '../../src/scientific/formats/hdf5.ts'

export interface GeneratedHdf5ObjectMessage {
  readonly type: number
  readonly flags?: number
  readonly creationOrder?: number
  readonly data: Uint8Array
}

export interface GeneratedVersion2ObjectHeaderOptions {
  readonly trackCreationOrder?: boolean
  readonly includeTimes?: boolean
  readonly includeAttributePhaseChange?: boolean
  readonly referenceCount?: number
}

export interface GeneratedSharedMessageLocatorOptions {
  readonly version: 1 | 2 | 3
  readonly offsetSize: Hdf5IntegerWidth
  readonly lengthSize: Hdf5IntegerWidth
  readonly address: bigint
  readonly type?: 0 | 1 | 2 | 3
}

const writeUnsigned = (output: Uint8Array, offset: number, width: number, value: bigint): void => {
  let remaining = value
  for (let index = 0; index < width; index += 1) {
    output[offset + index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  if (remaining !== 0n) throw new Error(`Generated HDF5 value ${value} does not fit ${width} bytes`)
}

const writeUint16 = (output: Uint8Array, offset: number, value: number): void => {
  new DataView(output.buffer).setUint16(offset, value, true)
}

const writeUint32 = (output: Uint8Array, offset: number, value: number): void => {
  new DataView(output.buffer).setUint32(offset, value, true)
}

const paddedToEight = (value: number): number => (value + 7) & ~7

const writeChecksum = (output: Uint8Array): void => {
  writeUint32(
    output,
    output.byteLength - 4,
    hdf5MetadataChecksum(output.subarray(0, output.byteLength - 4)),
  )
}

export const createGeneratedSharedMessageLocator = (
  options: Readonly<GeneratedSharedMessageLocatorOptions>,
): Uint8Array<ArrayBuffer> => {
  if (options.version === 1) {
    const output = new Uint8Array(4 + options.lengthSize + options.offsetSize)
    output[0] = 1
    output[1] = options.type ?? 0
    writeUnsigned(output, 4 + options.lengthSize, options.offsetSize, options.address)
    return output
  }
  const locationBytes = options.version === 3 && options.type === 1 ? 8 : options.offsetSize
  const output = new Uint8Array(2 + locationBytes)
  output[0] = options.version
  output[1] = options.type ?? (options.version === 2 ? 0 : 2)
  writeUnsigned(output, 2, locationBytes, options.address)
  return output
}

export const createGeneratedVersion1ObjectHeader = (
  messages: readonly GeneratedHdf5ObjectMessage[],
  referenceCount = 1,
  totalMessages = messages.length,
): Uint8Array<ArrayBuffer> => {
  const chunkBytes = messages.reduce(
    (sum, message) => sum + 8 + paddedToEight(message.data.byteLength),
    0,
  )
  const output = new Uint8Array(16 + chunkBytes)
  output[0] = 1
  writeUint16(output, 2, totalMessages)
  writeUint32(output, 4, referenceCount)
  writeUint32(output, 8, chunkBytes)
  let position = 16
  for (const message of messages) {
    writeUint16(output, position, message.type)
    writeUint16(output, position + 2, paddedToEight(message.data.byteLength))
    output[position + 4] = message.flags ?? 0
    output.set(message.data, position + 8)
    position += 8 + paddedToEight(message.data.byteLength)
  }
  return output
}

const createVersion2ChunkData = (
  messages: readonly GeneratedHdf5ObjectMessage[],
  trackCreationOrder: boolean,
): Uint8Array<ArrayBuffer> => {
  const prefixBytes = trackCreationOrder ? 6 : 4
  const chunkBytes = messages.reduce(
    (sum, message) => sum + prefixBytes + message.data.byteLength,
    0,
  )
  const output = new Uint8Array(chunkBytes)
  let position = 0
  for (const message of messages) {
    output[position] = message.type
    writeUint16(output, position + 1, message.data.byteLength)
    output[position + 3] = message.flags ?? 0
    if (trackCreationOrder) writeUint16(output, position + 4, message.creationOrder ?? 0)
    output.set(message.data, position + prefixBytes)
    position += prefixBytes + message.data.byteLength
  }
  return output
}

export const createGeneratedVersion2ObjectHeader = (
  messages: readonly GeneratedHdf5ObjectMessage[],
  options: Readonly<GeneratedVersion2ObjectHeaderOptions> = {},
): Uint8Array<ArrayBuffer> => {
  const trackCreationOrder = options.trackCreationOrder ?? false
  const includeTimes = options.includeTimes ?? false
  const includeAttributePhaseChange = options.includeAttributePhaseChange ?? false
  const explicitMessages =
    options.referenceCount === undefined
      ? messages
      : [
          ...messages,
          {
            type: 0x0016,
            data: Uint8Array.of(
              0,
              options.referenceCount & 0xff,
              (options.referenceCount >>> 8) & 0xff,
              (options.referenceCount >>> 16) & 0xff,
              (options.referenceCount >>> 24) & 0xff,
            ),
          },
        ]
  const chunk = createVersion2ChunkData(explicitMessages, trackCreationOrder)
  if (chunk.byteLength > 0xffff) throw new Error('Generated version 2 object chunk is too large')
  const flags =
    0x01 |
    (trackCreationOrder ? 0x04 : 0) |
    (includeAttributePhaseChange ? 0x10 : 0) |
    (includeTimes ? 0x20 : 0)
  const prefixBytes = 8 + (includeTimes ? 16 : 0) + (includeAttributePhaseChange ? 4 : 0)
  const output = new Uint8Array(prefixBytes + chunk.byteLength + 4)
  output.set(Uint8Array.of(0x4f, 0x48, 0x44, 0x52, 2, flags))
  writeUint16(output, prefixBytes - 2, chunk.byteLength)
  output.set(chunk, prefixBytes)
  writeChecksum(output)
  return output
}

export const createGeneratedVersion2Continuation = (
  messages: readonly GeneratedHdf5ObjectMessage[],
  trackCreationOrder = false,
): Uint8Array<ArrayBuffer> => {
  const chunk = createVersion2ChunkData(messages, trackCreationOrder)
  const output = new Uint8Array(4 + chunk.byteLength + 4)
  output.set(Uint8Array.of(0x4f, 0x43, 0x48, 0x4b))
  output.set(chunk, 4)
  writeChecksum(output)
  return output
}

export const createGeneratedContinuationMessage = (
  address: bigint,
  bytes: number,
  offsetSize: Hdf5IntegerWidth,
  lengthSize: Hdf5IntegerWidth,
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(offsetSize + lengthSize)
  writeUnsigned(output, 0, offsetSize, address)
  writeUnsigned(output, offsetSize, lengthSize, BigInt(bytes))
  return output
}

export const createGeneratedSymbolTableMessage = (
  btreeAddress: bigint,
  localHeapAddress: bigint,
  offsetSize: Hdf5IntegerWidth,
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(offsetSize * 2)
  writeUnsigned(output, 0, offsetSize, btreeAddress)
  writeUnsigned(output, offsetSize, offsetSize, localHeapAddress)
  return output
}

interface GeneratedLinkOptions {
  readonly name: string
  readonly creationOrder?: bigint
  readonly utf8?: boolean
}

const encodedName = (options: Readonly<GeneratedLinkOptions>): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(options.name)

const createLinkPrefix = (
  options: Readonly<GeneratedLinkOptions>,
  linkType: number | undefined,
): { readonly output: Uint8Array<ArrayBuffer>; readonly position: number } => {
  const name = encodedName(options)
  if (name.byteLength > 0xff) throw new Error('Generated compact link name is too long')
  let flags = 0
  if (options.creationOrder !== undefined) flags |= 0x04
  if (linkType !== undefined) flags |= 0x08
  if (options.utf8 === true) flags |= 0x10
  const prefixBytes =
    2 +
    (linkType === undefined ? 0 : 1) +
    (options.creationOrder === undefined ? 0 : 8) +
    (options.utf8 === true ? 1 : 0) +
    1
  const output = new Uint8Array(prefixBytes + name.byteLength)
  output[0] = 1
  output[1] = flags
  let position = 2
  if (linkType !== undefined) {
    output[position] = linkType
    position += 1
  }
  if (options.creationOrder !== undefined) {
    writeUnsigned(output, position, 8, options.creationOrder)
    position += 8
  }
  if (options.utf8 === true) {
    output[position] = 1
    position += 1
  }
  output[position] = name.byteLength
  position += 1
  output.set(name, position)
  return { output, position: position + name.byteLength }
}

export const createGeneratedHardLink = (
  options: Readonly<GeneratedLinkOptions>,
  objectAddress: bigint,
  offsetSize: Hdf5IntegerWidth,
): Uint8Array<ArrayBuffer> => {
  const prefix = createLinkPrefix(options, undefined)
  const output = new Uint8Array(prefix.output.byteLength + offsetSize)
  output.set(prefix.output)
  writeUnsigned(output, prefix.position, offsetSize, objectAddress)
  return output
}

export const createGeneratedSoftLink = (
  options: Readonly<GeneratedLinkOptions>,
  target: string,
): Uint8Array<ArrayBuffer> => {
  const prefix = createLinkPrefix(options, 1)
  const encodedTarget = new TextEncoder().encode(target)
  if (encodedTarget.byteLength > 0xffff) throw new Error('Generated soft-link target is too long')
  const output = new Uint8Array(prefix.output.byteLength + 2 + encodedTarget.byteLength)
  output.set(prefix.output)
  writeUint16(output, prefix.position, encodedTarget.byteLength)
  output.set(encodedTarget, prefix.position + 2)
  return output
}
