import { hdf5MetadataChecksum } from '../../src/scientific/formats/hdf5.ts'

export type GeneratedDenseGroupLink =
  | {
      readonly kind: 'hard'
      readonly name: string
      readonly objectAddress: bigint
      readonly characterSet?: 'ascii' | 'utf-8'
      readonly creationOrder?: bigint
    }
  | {
      readonly kind: 'soft'
      readonly name: string
      readonly target: string
      readonly characterSet?: 'ascii' | 'utf-8'
      readonly creationOrder?: bigint
    }

export interface GeneratedDenseGroupFixtureOptions {
  readonly links: readonly GeneratedDenseGroupLink[]
  readonly depth?: 0 | 1
  readonly rootBlock?: 'direct' | 'indirect'
}

export interface GeneratedDenseGroupFixture {
  readonly fractalHeapAddress: bigint
  readonly nameIndexAddress: bigint
  readonly rootIndirectAddress: bigint
  readonly directBlockAddresses: readonly bigint[]
  readonly btreeRootAddress: bigint
  readonly blocks: readonly (readonly [bigint, Uint8Array<ArrayBuffer>])[]
}

const offsetSize = 8
const lengthSize = 8
const heapIdBytes = 7
const heapOffsetBytes = 4
const heapLengthBytes = 2
const tableWidth = 4
const directBlockBytes = 512
const directHeaderBytes = 5 + offsetSize + heapOffsetBytes + 4
const btreeNodeBytes = 512
const btreeRecordBytes = 11
const fractalHeapAddress = 4_096n
const nameIndexAddress = 4_352n
const rootIndirectAddress = 4_608n
const directBlockAddresses = Object.freeze([8_192n, 8_704n, 9_216n, 9_728n])
const btreeRootAddress = 12_288n
const leftLeafAddress = 12_800n
const rightLeafAddress = 13_312n

const writeUnsigned = (output: Uint8Array, offset: number, width: number, value: bigint): void => {
  let remaining = value
  for (let index = 0; index < width; index += 1) {
    output[offset + index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  if (remaining !== 0n) throw new Error(`Generated dense HDF5 value ${value} does not fit`)
}

const writeUint16 = (output: Uint8Array, offset: number, value: number): void => {
  new DataView(output.buffer, output.byteOffset, output.byteLength).setUint16(offset, value, true)
}

const writeUint32 = (output: Uint8Array, offset: number, value: number): void => {
  new DataView(output.buffer, output.byteOffset, output.byteLength).setUint32(offset, value, true)
}

const undefinedValue = (width: number): bigint => (1n << BigInt(width * 8)) - 1n

const encodeLinkMessage = (link: GeneratedDenseGroupLink): Uint8Array<ArrayBuffer> => {
  const characterSet = link.characterSet ?? 'ascii'
  const name = new TextEncoder().encode(link.name)
  const target = link.kind === 'soft' ? new TextEncoder().encode(link.target) : undefined
  if (name.byteLength < 1 || name.byteLength > 255 || name.includes(0)) {
    throw new Error('Generated dense HDF5 link name must use 1-255 non-NUL UTF-8 bytes')
  }
  if (characterSet === 'ascii' && name.some((byte) => byte > 0x7f)) {
    throw new Error('Generated dense HDF5 ASCII link name is not ASCII')
  }
  if (target !== undefined && (target.byteLength > 0xffff || target.includes(0))) {
    throw new Error('Generated dense HDF5 soft-link target is invalid')
  }
  let flags = 0
  if (link.kind === 'soft') flags |= 0x08
  if (link.creationOrder !== undefined) flags |= 0x04
  if (characterSet === 'utf-8') flags |= 0x10
  const bytes =
    2 +
    (link.kind === 'soft' ? 1 : 0) +
    (link.creationOrder === undefined ? 0 : 8) +
    (characterSet === 'ascii' ? 0 : 1) +
    1 +
    name.byteLength +
    (link.kind === 'hard' ? offsetSize : 2 + (target?.byteLength ?? 0))
  const output = new Uint8Array(bytes)
  output[0] = 1
  output[1] = flags
  let position = 2
  if (link.kind === 'soft') output[position++] = 1
  if (link.creationOrder !== undefined) {
    writeUnsigned(output, position, 8, link.creationOrder)
    position += 8
  }
  if (characterSet === 'utf-8') output[position++] = 1
  output[position++] = name.byteLength
  output.set(name, position)
  position += name.byteLength
  if (link.kind === 'hard') {
    writeUnsigned(output, position, offsetSize, link.objectAddress)
  } else {
    const encodedTarget = target ?? new Uint8Array()
    writeUint16(output, position, encodedTarget.byteLength)
    output.set(encodedTarget, position + 2)
  }
  return output
}

interface DenseRecord {
  readonly hash: number
  readonly name: string
  readonly heapId: Uint8Array<ArrayBuffer>
}

const createDirectBlocks = (
  links: readonly GeneratedDenseGroupLink[],
): {
  readonly blocks: readonly Uint8Array<ArrayBuffer>[]
  readonly records: readonly DenseRecord[]
  readonly usedBlocks: number
} => {
  const blocks = directBlockAddresses.map(() => new Uint8Array(directBlockBytes))
  const positions = directBlockAddresses.map(() => directHeaderBytes)
  const records: DenseRecord[] = []
  let usedBlocks = 0
  for (const link of links) {
    const message = encodeLinkMessage(link)
    const blockIndex = positions.findIndex(
      (position) => position + message.byteLength <= directBlockBytes,
    )
    if (blockIndex < 0) throw new Error('Generated dense HDF5 direct blocks are full')
    const position = positions[blockIndex]
    if (position === undefined)
      throw new Error('Generated dense HDF5 block position is unavailable')
    usedBlocks = Math.max(usedBlocks, blockIndex + 1)
    blocks[blockIndex]?.set(message, position)
    positions[blockIndex] = position + message.byteLength
    const heapOffset = BigInt(blockIndex * directBlockBytes + position)
    const heapId = new Uint8Array(heapIdBytes)
    writeUnsigned(heapId, 1, heapOffsetBytes, heapOffset)
    writeUnsigned(heapId, 1 + heapOffsetBytes, heapLengthBytes, BigInt(message.byteLength))
    records.push(
      Object.freeze({
        hash: hdf5MetadataChecksum(new TextEncoder().encode(link.name)),
        name: link.name,
        heapId,
      }),
    )
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block === undefined) continue
    block.set(new TextEncoder().encode('FHDB'))
    writeUnsigned(block, 5, offsetSize, fractalHeapAddress)
    writeUnsigned(block, 5 + offsetSize, heapOffsetBytes, BigInt(index * directBlockBytes))
    const checksumOffset = 5 + offsetSize + heapOffsetBytes
    writeUint32(block, checksumOffset, 0)
    writeUint32(block, checksumOffset, hdf5MetadataChecksum(block))
  }
  records.sort((left, right) =>
    left.hash !== right.hash
      ? left.hash - right.hash
      : left.name === right.name
        ? 0
        : left.name < right.name
          ? -1
          : 1,
  )
  return { blocks: Object.freeze(blocks), records: Object.freeze(records), usedBlocks }
}

const writeRecord = (output: Uint8Array, offset: number, record: DenseRecord): void => {
  writeUint32(output, offset, record.hash)
  output.set(record.heapId, offset + 4)
}

const createLeaf = (records: readonly DenseRecord[]): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(btreeNodeBytes)
  output.set(new TextEncoder().encode('BTLF'))
  output[5] = 5
  let position = 6
  for (const record of records) {
    writeRecord(output, position, record)
    position += btreeRecordBytes
  }
  writeUint32(output, position, hdf5MetadataChecksum(output.subarray(0, position)))
  return output
}

const createInternal = (
  record: DenseRecord,
  leftRecords: number,
  rightRecords: number,
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(btreeNodeBytes)
  output.set(new TextEncoder().encode('BTIN'))
  output[5] = 5
  writeRecord(output, 6, record)
  let position = 6 + btreeRecordBytes
  writeUnsigned(output, position, offsetSize, leftLeafAddress)
  position += offsetSize
  output[position++] = leftRecords
  writeUnsigned(output, position, offsetSize, rightLeafAddress)
  position += offsetSize
  output[position++] = rightRecords
  writeUint32(output, position, hdf5MetadataChecksum(output.subarray(0, position)))
  return output
}

const createBtreeHeader = (
  depth: 0 | 1,
  rootRecords: number,
  totalRecords: number,
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(22 + offsetSize + lengthSize)
  output.set(new TextEncoder().encode('BTHD'))
  output[5] = 5
  writeUint32(output, 6, btreeNodeBytes)
  writeUint16(output, 10, btreeRecordBytes)
  writeUint16(output, 12, depth)
  output[14] = 100
  output[15] = 40
  writeUnsigned(output, 16, offsetSize, btreeRootAddress)
  writeUint16(output, 16 + offsetSize, rootRecords)
  writeUnsigned(output, 18 + offsetSize, lengthSize, BigInt(totalRecords))
  writeUint32(
    output,
    output.byteLength - 4,
    hdf5MetadataChecksum(output.subarray(0, output.byteLength - 4)),
  )
  return output
}

const createFractalHeapHeader = (
  objects: number,
  rootBlock: 'direct' | 'indirect',
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(26 + lengthSize * 12 + offsetSize * 3)
  output.set(new TextEncoder().encode('FRHP'))
  writeUint16(output, 5, heapIdBytes)
  output[9] = 0x02
  writeUint32(output, 10, 4_096)
  let position = 14
  writeUnsigned(output, position, lengthSize, 0n)
  position += lengthSize
  writeUnsigned(output, position, offsetSize, undefinedValue(offsetSize))
  position += offsetSize
  writeUnsigned(output, position, lengthSize, 0n)
  position += lengthSize
  writeUnsigned(output, position, offsetSize, undefinedValue(offsetSize))
  position += offsetSize
  const allocatedBytes = rootBlock === 'direct' ? directBlockBytes : tableWidth * directBlockBytes
  writeUnsigned(output, position, lengthSize, BigInt(allocatedBytes))
  position += lengthSize
  writeUnsigned(output, position, lengthSize, BigInt(allocatedBytes))
  position += lengthSize
  writeUnsigned(output, position, lengthSize, BigInt(allocatedBytes))
  position += lengthSize
  writeUnsigned(output, position, lengthSize, BigInt(objects))
  position += lengthSize
  writeUnsigned(output, position, lengthSize, 0n)
  position += lengthSize
  writeUnsigned(output, position, lengthSize, 0n)
  position += lengthSize
  writeUnsigned(output, position, lengthSize, 0n)
  position += lengthSize
  writeUnsigned(output, position, lengthSize, 0n)
  position += lengthSize
  writeUint16(output, position, tableWidth)
  position += 2
  writeUnsigned(output, position, lengthSize, BigInt(directBlockBytes))
  position += lengthSize
  writeUnsigned(output, position, lengthSize, BigInt(directBlockBytes))
  position += lengthSize
  writeUint16(output, position, 32)
  position += 2
  writeUint16(output, position, 1)
  position += 2
  writeUnsigned(
    output,
    position,
    offsetSize,
    rootBlock === 'direct' ? (directBlockAddresses[0] ?? rootIndirectAddress) : rootIndirectAddress,
  )
  position += offsetSize
  writeUint16(output, position, rootBlock === 'direct' ? 0 : 1)
  writeUint32(
    output,
    output.byteLength - 4,
    hdf5MetadataChecksum(output.subarray(0, output.byteLength - 4)),
  )
  return output
}

const createRootIndirectBlock = (): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(5 + offsetSize + heapOffsetBytes + tableWidth * offsetSize + 4)
  output.set(new TextEncoder().encode('FHIB'))
  writeUnsigned(output, 5, offsetSize, fractalHeapAddress)
  writeUnsigned(output, 5 + offsetSize, heapOffsetBytes, 0n)
  let position = 5 + offsetSize + heapOffsetBytes
  for (const address of directBlockAddresses) {
    writeUnsigned(output, position, offsetSize, address)
    position += offsetSize
  }
  writeUint32(
    output,
    output.byteLength - 4,
    hdf5MetadataChecksum(output.subarray(0, output.byteLength - 4)),
  )
  return output
}

export const createGeneratedDenseGroupFixture = (
  options: Readonly<GeneratedDenseGroupFixtureOptions>,
): GeneratedDenseGroupFixture => {
  if (options.links.length < 1) throw new Error('Generated dense HDF5 fixture needs links')
  const depth = options.depth ?? 0
  const rootBlock = options.rootBlock ?? 'indirect'
  const generated = createDirectBlocks(options.links)
  if (rootBlock === 'direct' && generated.usedBlocks > 1) {
    throw new Error('Generated dense HDF5 root direct block cannot hold all links')
  }
  if (depth === 0 && generated.records.length > 45) {
    throw new Error('Generated dense HDF5 leaf has too many records')
  }
  if (depth === 1 && (generated.records.length < 3 || generated.records.length > 91)) {
    throw new Error('Generated dense HDF5 internal tree needs 3-91 records')
  }
  const blocks: Array<readonly [bigint, Uint8Array<ArrayBuffer>]> = [
    [fractalHeapAddress, createFractalHeapHeader(options.links.length, rootBlock)],
  ]
  if (rootBlock === 'indirect') blocks.push([rootIndirectAddress, createRootIndirectBlock()])
  if (depth === 0) {
    blocks.push(
      [nameIndexAddress, createBtreeHeader(0, generated.records.length, generated.records.length)],
      [btreeRootAddress, createLeaf(generated.records)],
    )
  } else {
    const middle = Math.floor(generated.records.length / 2)
    const rootRecord = generated.records[middle]
    if (rootRecord === undefined) throw new Error('Generated dense HDF5 root record is unavailable')
    const left = generated.records.slice(0, middle)
    const right = generated.records.slice(middle + 1)
    blocks.push(
      [nameIndexAddress, createBtreeHeader(1, 1, generated.records.length)],
      [btreeRootAddress, createInternal(rootRecord, left.length, right.length)],
      [leftLeafAddress, createLeaf(left)],
      [rightLeafAddress, createLeaf(right)],
    )
  }
  for (let index = 0; index < generated.blocks.length; index += 1) {
    const block = generated.blocks[index]
    const address = directBlockAddresses[index]
    if (block !== undefined && address !== undefined && (rootBlock === 'indirect' || index === 0)) {
      blocks.push([address, block])
    }
  }
  return Object.freeze({
    fractalHeapAddress,
    nameIndexAddress,
    rootIndirectAddress,
    directBlockAddresses,
    btreeRootAddress,
    blocks: Object.freeze(blocks),
  })
}
