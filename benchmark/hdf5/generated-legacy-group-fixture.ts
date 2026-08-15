export type GeneratedLegacyGroupLink =
  | {
      readonly kind: 'hard'
      readonly name: string
      readonly objectAddress: bigint
      readonly cachedGroup?: {
        readonly btreeAddress: bigint
        readonly localHeapAddress: bigint
      }
    }
  | {
      readonly kind: 'soft'
      readonly name: string
      readonly target: string
    }

export interface GeneratedLegacyGroupFixtureOptions {
  readonly links: readonly GeneratedLegacyGroupLink[]
  readonly depth?: 0 | 1
}

export interface GeneratedLegacyGroupFixture {
  readonly btreeAddress: bigint
  readonly localHeapAddress: bigint
  readonly heapDataAddress: bigint
  readonly blocks: readonly (readonly [bigint, Uint8Array<ArrayBuffer>])[]
}

const offsetSize = 8
const lengthSize = 8
const groupInternalNodeK = 16
const groupLeafNodeK = 4
const localHeapAddress = 1_024n
const heapDataAddress = 1_280n
const btreeAddress = 2_048n
const leftBtreeAddress = 3_072n
const rightBtreeAddress = 3_712n
const leftSymbolAddress = 4_608n
const rightSymbolAddress = 5_120n
const heapBytes = 512

const writeUnsigned = (output: Uint8Array, offset: number, width: number, value: bigint): void => {
  let remaining = value
  for (let index = 0; index < width; index += 1) {
    output[offset + index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  if (remaining !== 0n) throw new Error(`Generated legacy HDF5 value ${value} does not fit`)
}

const writeUint16 = (output: Uint8Array, offset: number, value: number): void => {
  new DataView(output.buffer).setUint16(offset, value, true)
}

const writeUint32 = (output: Uint8Array, offset: number, value: number): void => {
  new DataView(output.buffer).setUint32(offset, value, true)
}

const undefinedValue = (width: number): bigint => (1n << BigInt(width * 8)) - 1n

const alignEight = (value: number): number => (value + 7) & ~7

interface HeapBuilder {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly offsets: Map<string, bigint>
  position: number
}

const addHeapString = (heap: HeapBuilder, value: string): bigint => {
  const existing = heap.offsets.get(value)
  if (existing !== undefined) return existing
  const encoded = new TextEncoder().encode(value)
  if (encoded.some((byte) => byte > 0x7f)) {
    throw new Error('Generated legacy HDF5 heap strings must be ASCII')
  }
  const start = alignEight(heap.position)
  if (start + encoded.byteLength + 1 > heap.bytes.byteLength) {
    throw new Error('Generated legacy HDF5 heap is full')
  }
  heap.bytes.set(encoded, start)
  heap.position = start + encoded.byteLength + 1
  const offset = BigInt(start)
  heap.offsets.set(value, offset)
  return offset
}

const createLocalHeapHeader = (): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(8 + lengthSize * 2 + offsetSize)
  output.set(new TextEncoder().encode('HEAP'))
  writeUnsigned(output, 8, lengthSize, BigInt(heapBytes))
  writeUnsigned(output, 8 + lengthSize, lengthSize, undefinedValue(lengthSize))
  writeUnsigned(output, 8 + lengthSize * 2, offsetSize, heapDataAddress)
  return output
}

const createSymbolTableNode = (
  links: readonly GeneratedLegacyGroupLink[],
  heap: HeapBuilder,
): Uint8Array<ArrayBuffer> => {
  const entryBytes = lengthSize + offsetSize + 24
  const output = new Uint8Array(8 + 2 * groupLeafNodeK * entryBytes)
  output.set(new TextEncoder().encode('SNOD'))
  output[4] = 1
  writeUint16(output, 6, links.length)
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index]
    if (link === undefined) continue
    const start = 8 + index * entryBytes
    writeUnsigned(output, start, lengthSize, addHeapString(heap, link.name))
    const cacheTypeOffset = start + lengthSize + offsetSize
    if (link.kind === 'hard') {
      writeUnsigned(output, start + lengthSize, offsetSize, link.objectAddress)
      if (link.cachedGroup !== undefined) {
        writeUint32(output, cacheTypeOffset, 1)
        writeUnsigned(output, cacheTypeOffset + 8, offsetSize, link.cachedGroup.btreeAddress)
        writeUnsigned(
          output,
          cacheTypeOffset + 8 + offsetSize,
          offsetSize,
          link.cachedGroup.localHeapAddress,
        )
      }
    } else {
      writeUnsigned(output, start + lengthSize, offsetSize, undefinedValue(offsetSize))
      writeUint32(output, cacheTypeOffset, 2)
      const targetOffset = addHeapString(heap, link.target)
      if (targetOffset > 0xffff_ffffn) throw new Error('Generated soft-link offset is too large')
      writeUint32(output, cacheTypeOffset + 8, Number(targetOffset))
    }
  }
  return output
}

const createBtreeNode = (
  level: number,
  children: readonly bigint[],
  keyOffsets: readonly bigint[],
): Uint8Array<ArrayBuffer> => {
  if (keyOffsets.length !== children.length + 1) {
    throw new Error('Generated legacy HDF5 B-tree requires one more key than child')
  }
  const nodeBytes =
    8 + offsetSize * 2 + 2 * groupInternalNodeK * (lengthSize + offsetSize) + lengthSize
  const output = new Uint8Array(nodeBytes)
  output.set(new TextEncoder().encode('TREE'))
  output[4] = 0
  output[5] = level
  writeUint16(output, 6, children.length)
  writeUnsigned(output, 8, offsetSize, undefinedValue(offsetSize))
  writeUnsigned(output, 8 + offsetSize, offsetSize, undefinedValue(offsetSize))
  let position = 8 + offsetSize * 2
  for (let index = 0; index < children.length; index += 1) {
    writeUnsigned(output, position, lengthSize, keyOffsets[index] ?? 0n)
    position += lengthSize
    writeUnsigned(output, position, offsetSize, children[index] ?? 0n)
    position += offsetSize
  }
  writeUnsigned(output, position, lengthSize, keyOffsets[children.length] ?? 0n)
  return output
}

export const createGeneratedLegacyGroupFixture = (
  options: Readonly<GeneratedLegacyGroupFixtureOptions>,
): GeneratedLegacyGroupFixture => {
  if (options.links.length > groupLeafNodeK * 4) {
    throw new Error('Generated legacy HDF5 fixture has too many links')
  }
  const heap: HeapBuilder = {
    bytes: new Uint8Array(heapBytes),
    offsets: new Map([['', 0n]]),
    position: 8,
  }
  const midpoint = Math.ceil(options.links.length / 2)
  const leftLinks = options.depth === 1 ? options.links.slice(0, midpoint) : options.links
  const rightLinks = options.depth === 1 ? options.links.slice(midpoint) : []
  const leftSymbol = createSymbolTableNode(leftLinks, heap)
  const leftKey = leftLinks[0] === undefined ? 0n : addHeapString(heap, leftLinks[0].name)
  const leftEnd = leftLinks.at(-1)
  const leftEndKey = leftEnd === undefined ? 0n : addHeapString(heap, leftEnd.name)
  const blocks: Array<readonly [bigint, Uint8Array<ArrayBuffer>]> = [
    [localHeapAddress, createLocalHeapHeader()],
    [leftSymbolAddress, leftSymbol],
  ]

  if (options.depth === 1) {
    const rightSymbol = createSymbolTableNode(rightLinks, heap)
    const rightKey =
      rightLinks[0] === undefined ? leftEndKey : addHeapString(heap, rightLinks[0].name)
    const rightEnd = rightLinks.at(-1)
    const rightEndKey = rightEnd === undefined ? rightKey : addHeapString(heap, rightEnd.name)
    blocks.push(
      [leftBtreeAddress, createBtreeNode(0, [leftSymbolAddress], [leftKey, leftEndKey])],
      [rightBtreeAddress, createBtreeNode(0, [rightSymbolAddress], [rightKey, rightEndKey])],
      [
        btreeAddress,
        createBtreeNode(1, [leftBtreeAddress, rightBtreeAddress], [leftKey, rightKey, rightEndKey]),
      ],
      [rightSymbolAddress, rightSymbol],
    )
  } else {
    blocks.push([btreeAddress, createBtreeNode(0, [leftSymbolAddress], [leftKey, leftEndKey])])
  }
  blocks.push([heapDataAddress, heap.bytes])
  return Object.freeze({
    btreeAddress,
    localHeapAddress,
    heapDataAddress,
    blocks: Object.freeze(blocks),
  })
}
