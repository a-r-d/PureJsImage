import { describe, expect, it } from 'vitest'
import type {
  DigitalMicrographByteOrder,
  DigitalMicrographGroupNode,
  DigitalMicrographNode,
  DigitalMicrographValueNode,
  DigitalMicrographVersion,
} from '../src/scientific/formats/digital-micrograph.ts'
import { indexDigitalMicrograph } from '../src/scientific/formats/digital-micrograph.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'
import { HostileSource } from './hostile-source.ts'

interface FixtureValue {
  readonly kind: 'value'
  readonly name: string
  readonly info: readonly bigint[]
  readonly payload: Uint8Array
}

interface FixtureGroup {
  readonly kind: 'group'
  readonly name: string
  readonly children: readonly FixtureNode[]
}

type FixtureNode = FixtureValue | FixtureGroup

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const size = parts.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const uint8 = (value: number): Uint8Array => Uint8Array.of(value)

const uint16BigEndian = (value: number): Uint8Array => {
  const output = new Uint8Array(2)
  new DataView(output.buffer).setUint16(0, value, false)
  return output
}

const uint32BigEndian = (value: number): Uint8Array => {
  const output = new Uint8Array(4)
  new DataView(output.buffer).setUint32(0, value, false)
  return output
}

const uint64BigEndian = (value: bigint): Uint8Array => {
  const output = new Uint8Array(8)
  new DataView(output.buffer).setBigUint64(0, value, false)
  return output
}

const structuralInteger = (version: DigitalMicrographVersion, value: bigint): Uint8Array =>
  version === 4 ? uint64BigEndian(value) : uint32BigEndian(Number(value))

const encodedName = (name: string): Uint8Array => new TextEncoder().encode(name)

const encodeGroupContents = (
  version: DigitalMicrographVersion,
  children: readonly FixtureNode[],
): Uint8Array =>
  concat([
    uint8(1),
    uint8(0),
    structuralInteger(version, BigInt(children.length)),
    ...children.map((child) => encodeEntry(version, child)),
  ])

const encodeEntry = (version: DigitalMicrographVersion, node: FixtureNode): Uint8Array => {
  const name = encodedName(node.name)
  const content =
    node.kind === 'group'
      ? encodeGroupContents(version, node.children)
      : concat([
          new TextEncoder().encode('%%%%'),
          structuralInteger(version, BigInt(node.info.length)),
          ...node.info.map((value) => structuralInteger(version, value)),
          node.payload,
        ])
  return concat([
    uint8(node.kind === 'group' ? 20 : 21),
    uint16BigEndian(name.byteLength),
    name,
    ...(version === 4 ? [uint64BigEndian(BigInt(content.byteLength))] : []),
    content,
  ])
}

const encodedFile = (
  version: DigitalMicrographVersion,
  byteOrder: DigitalMicrographByteOrder,
  children: readonly FixtureNode[],
): Uint8Array => {
  const root = encodeGroupContents(version, children)
  const declaredRootBytes = BigInt(root.byteLength + (version === 3 ? 4 : 0))
  return concat([
    uint32BigEndian(version),
    structuralInteger(version, declaredRootBytes),
    uint32BigEndian(byteOrder === 'little-endian' ? 1 : 0),
    root,
    new Uint8Array(8),
  ])
}

const float64Payload = (value: number, byteOrder: DigitalMicrographByteOrder): Uint8Array => {
  const output = new Uint8Array(8)
  new DataView(output.buffer).setFloat64(0, value, byteOrder === 'little-endian')
  return output
}

const int32Payload = (value: number, byteOrder: DigitalMicrographByteOrder): Uint8Array => {
  const output = new Uint8Array(4)
  new DataView(output.buffer).setInt32(0, value, byteOrder === 'little-endian')
  return output
}

const int64Payload = (value: bigint, byteOrder: DigitalMicrographByteOrder): Uint8Array => {
  const output = new Uint8Array(8)
  new DataView(output.buffer).setBigInt64(0, value, byteOrder === 'little-endian')
  return output
}

const uint16ArrayPayload = (
  values: readonly number[],
  byteOrder: DigitalMicrographByteOrder,
): Uint8Array => {
  const output = new Uint8Array(values.length * 2)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setUint16(index * 2, values[index] ?? 0, byteOrder === 'little-endian')
  }
  return output
}

const structPayload = (
  byteOrder: DigitalMicrographByteOrder,
  first: number,
  second: number,
  third: number,
): Uint8Array =>
  concat([
    int32Payload(first, byteOrder),
    int32Payload(second, byteOrder),
    float64Payload(third, byteOrder),
  ])

const fixtureTree = (
  version: DigitalMicrographVersion,
  byteOrder: DigitalMicrographByteOrder,
): readonly FixtureNode[] => {
  const imageSamples = Array.from({ length: 4_096 }, (_value, index) => index & 0xffff)
  const metadata: FixtureNode[] = [
    { kind: 'value', name: 'Scale', info: [7n], payload: float64Payload(0.5, byteOrder) },
    { kind: 'value', name: 'Scale', info: [7n], payload: float64Payload(0.75, byteOrder) },
    {
      kind: 'value',
      name: 'Title',
      info: [18n, 12n],
      payload: encodedName('TEM specimen'),
    },
    {
      kind: 'value',
      name: 'Bounds',
      info: [15n, 0n, 3n, 0n, 3n, 0n, 3n, 0n, 7n],
      payload: structPayload(byteOrder, 4, 8, 2.5),
    },
    {
      kind: 'value',
      name: 'Palette',
      info: [20n, 15n, 0n, 3n, 0n, 4n, 0n, 4n, 0n, 4n, 2n],
      payload: uint16ArrayPayload([1, 2, 3, 4, 5, 6], byteOrder),
    },
  ]
  if (version === 4) {
    metadata.push({
      kind: 'value',
      name: 'SignedCounter',
      info: [11n],
      payload: int64Payload(-9_007_199_254_740_993n, byteOrder),
    })
  }
  return [
    {
      kind: 'group',
      name: 'ImageList',
      children: [
        {
          kind: 'group',
          name: '0',
          children: [
            {
              kind: 'group',
              name: 'ImageData',
              children: [
                {
                  kind: 'value',
                  name: 'Data',
                  info: [20n, 4n, BigInt(imageSamples.length)],
                  payload: uint16ArrayPayload(imageSamples, byteOrder),
                },
              ],
            },
            { kind: 'group', name: 'Metadata', children: metadata },
          ],
        },
      ],
    },
  ]
}

const child = (
  group: Readonly<{ readonly children: readonly DigitalMicrographNode[] }>,
  name: string,
  occurrence = 0,
): DigitalMicrographNode => {
  const result = group.children.find(
    (entry) => entry.name === name && entry.occurrence === occurrence,
  )
  if (result === undefined) throw new Error(`Missing fixture node ${name}[${occurrence}]`)
  return result
}

const asGroup = (node: DigitalMicrographNode): DigitalMicrographGroupNode => {
  if (node.kind !== 'group') throw new Error(`Expected ${node.name} to be a group`)
  return node
}

const asValue = (node: DigitalMicrographNode): DigitalMicrographValueNode => {
  if (node.kind !== 'value') throw new Error(`Expected ${node.name} to be a value`)
  return node
}

const pathKey = (path: readonly { readonly name: string; readonly occurrence: number }[]): string =>
  path.map(({ name, occurrence }) => `${name}[${occurrence}]`).join('/')

interface SourceRead {
  readonly offset: number
  readonly length: number
}

class TrackingSource implements ImageSource {
  readonly size: number
  readonly reads: SourceRead[] = []
  readonly #source: MemorySource

  constructor(bytes: Uint8Array) {
    this.#source = new MemorySource(bytes)
    this.size = bytes.byteLength
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    this.reads.push(Object.freeze({ offset, length }))
    return this.#source.read(offset, length, options)
  }
}

const setBigUint64 = (bytes: Uint8Array, offset: number, value: bigint): void => {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(offset, value, false)
}

describe('DigitalMicrograph tag-tree index', () => {
  for (const fixture of [
    { version: 3 as const, byteOrder: 'big-endian' as const },
    { version: 3 as const, byteOrder: 'little-endian' as const },
    { version: 4 as const, byteOrder: 'little-endian' as const },
  ]) {
    it(`indexes DM${fixture.version} ${fixture.byteOrder} descriptors without reading image samples`, async () => {
      const bytes = encodedFile(
        fixture.version,
        fixture.byteOrder,
        fixtureTree(fixture.version, fixture.byteOrder),
      )
      const source = new TrackingSource(bytes)
      const index = await indexDigitalMicrograph(source)
      expect(index).toMatchObject({
        version: fixture.version,
        byteOrder: fixture.byteOrder,
        tagCount: fixture.version === 4 ? 11 : 10,
      })
      const imageList = asGroup(child(index.root, 'ImageList'))
      const image = asGroup(child(imageList, '0'))
      const imageData = asGroup(child(image, 'ImageData'))
      const data = asValue(child(imageData, 'Data'))
      expect(data.descriptor).toMatchObject({
        kind: 'array',
        length: 4_096,
        byteLength: 8_192,
        element: { kind: 'scalar', type: 'uint16', byteLength: 2 },
      })
      expect(index.metadataOmissions).toContainEqual({
        path: data.path,
        reason: 'image-payload',
      })
      expect(
        source.reads.some(
          ({ offset, length }) =>
            offset < data.payload.offset + data.payload.byteLength &&
            offset + length > data.payload.offset,
        ),
      ).toBe(false)

      const metadata = asGroup(child(image, 'Metadata'))
      const firstScale = asValue(child(metadata, 'Scale', 0))
      const secondScale = asValue(child(metadata, 'Scale', 1))
      expect(firstScale.path.at(-1)).toEqual({ name: 'Scale', occurrence: 0 })
      expect(secondScale.path.at(-1)).toEqual({ name: 'Scale', occurrence: 1 })
      expect(asValue(child(metadata, 'Title')).descriptor).toMatchObject({
        kind: 'string',
        length: 12,
      })
      expect(asValue(child(metadata, 'Bounds')).descriptor).toMatchObject({
        kind: 'struct',
        fields: [
          { descriptor: { kind: 'scalar', type: 'int32' } },
          { descriptor: { kind: 'scalar', type: 'int32' } },
          { descriptor: { kind: 'scalar', type: 'float64' } },
        ],
      })
      expect(asValue(child(metadata, 'Palette')).descriptor).toMatchObject({
        kind: 'array',
        length: 2,
        element: { kind: 'struct', fields: [{}, {}, {}] },
      })

      const projected = new Map(index.metadata.map((entry) => [pathKey(entry.path), entry.value]))
      expect(projected.get(pathKey(firstScale.path))).toBe(0.5)
      expect(projected.get(pathKey(secondScale.path))).toBe(0.75)
      expect(projected.get(pathKey(asValue(child(metadata, 'Title')).path))).toBe('TEM specimen')
      expect(projected.get(pathKey(asValue(child(metadata, 'Bounds')).path))).toEqual([4, 8, 2.5])
      expect(projected.get(pathKey(asValue(child(metadata, 'Palette')).path))).toEqual([
        [1, 2, 3],
        [4, 5, 6],
      ])
      if (fixture.version === 4) {
        expect(projected.get(pathKey(asValue(child(metadata, 'SignedCounter')).path))).toBe(
          '-9007199254740993',
        )
      }
    })
  }

  it('applies aggregate, per-value, and decoded-value metadata limits independently', async () => {
    const bytes = encodedFile(4, 'little-endian', fixtureTree(4, 'little-endian'))
    const aggregate = await indexDigitalMicrograph(new MemorySource(bytes), {
      maxMetadataBytes: 8,
    })
    expect(aggregate.metadata).toHaveLength(1)
    expect(aggregate.metadataOmissions.map(({ reason }) => reason)).toContain('aggregate-limit')

    const perValue = await indexDigitalMicrograph(new MemorySource(bytes), {
      maxMetadataValueBytes: 7,
    })
    expect(perValue.metadataOmissions.map(({ reason }) => reason)).toContain('value-limit')

    const decodedValues = await indexDigitalMicrograph(new MemorySource(bytes), {
      maxMetadataValues: 4,
    })
    expect(decodedValues.metadataOmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'image-payload' }),
        expect.objectContaining({ reason: 'value-limit' }),
      ]),
    )
  })

  it('does not retain source buffers across structural reads', async () => {
    const bytes = encodedFile(4, 'little-endian', fixtureTree(4, 'little-endian'))
    const index = await indexDigitalMicrograph(new HostileSource(bytes))
    expect(index.version).toBe(4)
    expect(index.tagCount).toBe(11)
    expect(index.metadata.map(({ value }) => value)).toContain('TEM specimen')
  })

  it('rejects depth, tag-count, name, and info-array limit violations before allocation', async () => {
    const nested: FixtureGroup = {
      kind: 'group',
      name: 'one',
      children: [
        {
          kind: 'group',
          name: 'two',
          children: [{ kind: 'group', name: 'three', children: [] }],
        },
      ],
    }
    await expect(
      indexDigitalMicrograph(new MemorySource(encodedFile(3, 'big-endian', [nested])), {
        maxDepth: 2,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const normal = encodedFile(4, 'little-endian', fixtureTree(4, 'little-endian'))
    await expect(
      indexDigitalMicrograph(new MemorySource(normal), { maxTags: 2 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(
      indexDigitalMicrograph(new MemorySource(normal), { maxNameBytes: 3 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(
      indexDigitalMicrograph(new MemorySource(normal), { maxInfoEntries: 2 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const nestedType = encodedFile(4, 'little-endian', [
      {
        kind: 'value',
        name: 'NestedArray',
        info: [20n, 20n, 2n, 1n, 1n],
        payload: new Uint8Array(2),
      },
    ])
    await expect(
      indexDigitalMicrograph(new MemorySource(nestedType), { maxTypeDepth: 1 }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('rejects unsafe 64-bit extents, invalid IDs and flags, bad delimiters, and DM4 length mismatches', async () => {
    const original = encodedFile(4, 'little-endian', fixtureTree(4, 'little-endian'))

    const unsafeRoot = original.slice()
    setBigUint64(unsafeRoot, 4, BigInt(Number.MAX_SAFE_INTEGER) + 1n)
    await expect(indexDigitalMicrograph(new MemorySource(unsafeRoot))).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })

    const unsafeEntryLength = original.slice()
    const rootEntryOffset = 16 + 10
    const groupLengthOffset = rootEntryOffset + 1 + 2 + 'ImageList'.length
    setBigUint64(unsafeEntryLength, groupLengthOffset, BigInt(Number.MAX_SAFE_INTEGER) + 1n)
    await expect(indexDigitalMicrograph(new MemorySource(unsafeEntryLength))).rejects.toMatchObject(
      { code: 'LIMIT_EXCEEDED' },
    )

    const unsafeArrayLength = encodedFile(4, 'little-endian', [
      {
        kind: 'value',
        name: 'UnsafeArray',
        info: [20n, 2n, BigInt(Number.MAX_SAFE_INTEGER) + 1n],
        payload: new Uint8Array(),
      },
    ])
    await expect(indexDigitalMicrograph(new MemorySource(unsafeArrayLength))).rejects.toMatchObject(
      { code: 'LIMIT_EXCEEDED' },
    )

    const invalidByteOrder = original.slice()
    new DataView(invalidByteOrder.buffer).setUint32(12, 2, false)
    await expect(indexDigitalMicrograph(new MemorySource(invalidByteOrder))).rejects.toThrow(
      'byte-order flag',
    )

    const invalidTagId = original.slice()
    invalidTagId[rootEntryOffset] = 19
    await expect(indexDigitalMicrograph(new MemorySource(invalidTagId))).rejects.toThrow('tag ID')

    const invalidGroupLength = original.slice()
    const view = new DataView(invalidGroupLength.buffer)
    view.setBigUint64(groupLengthOffset, view.getBigUint64(groupLengthOffset, false) + 1n, false)
    await expect(indexDigitalMicrograph(new MemorySource(invalidGroupLength))).rejects.toThrow(
      'tag-group length',
    )

    const delimiter = original.findIndex(
      (value, offset) =>
        value === 0x25 &&
        original[offset + 1] === 0x25 &&
        original[offset + 2] === 0x25 &&
        original[offset + 3] === 0x25,
    )
    expect(delimiter).toBeGreaterThan(0)
    const invalidDelimiter = original.slice()
    invalidDelimiter[delimiter] = 0
    await expect(indexDigitalMicrograph(new MemorySource(invalidDelimiter))).rejects.toThrow(
      'delimiter',
    )
  })

  it('rejects malformed and unsupported type descriptors and truncated payloads', async () => {
    const malformed = encodedFile(3, 'big-endian', [
      { kind: 'value', name: 'BrokenArray', info: [20n, 2n], payload: new Uint8Array() },
    ])
    await expect(indexDigitalMicrograph(new MemorySource(malformed))).rejects.toThrow(
      'array length descriptor is truncated',
    )

    const unsupported = encodedFile(4, 'little-endian', [
      { kind: 'value', name: 'UnknownArray', info: [20n, 99n, 1n], payload: new Uint8Array() },
    ])
    await expect(indexDigitalMicrograph(new MemorySource(unsupported))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })

    const complete = encodedFile(3, 'little-endian', fixtureTree(3, 'little-endian'))
    const valid = await indexDigitalMicrograph(new MemorySource(complete))
    const imageList = asGroup(child(valid.root, 'ImageList'))
    const image = asGroup(child(imageList, '0'))
    const data = asValue(child(asGroup(child(image, 'ImageData')), 'Data'))
    const truncated = complete.slice(0, data.payload.offset + data.payload.byteLength - 1)
    new DataView(truncated.buffer).setUint32(4, truncated.byteLength - 16, false)
    await expect(indexDigitalMicrograph(new MemorySource(truncated))).rejects.toThrow(
      'payload exceeds the input',
    )
    await expect(indexDigitalMicrograph(new MemorySource(truncated))).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
  })

  it('observes cancellation before indexing', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      indexDigitalMicrograph(
        new MemorySource(encodedFile(3, 'big-endian', fixtureTree(3, 'big-endian'))),
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
