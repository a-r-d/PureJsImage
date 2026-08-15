import { describe, expect, it } from 'vitest'
import type {
  DigitalMicrographByteOrder,
  DigitalMicrographGroupNode,
  DigitalMicrographNode,
  DigitalMicrographValueNode,
  DigitalMicrographVersion,
} from '../src/scientific/formats/digital-micrograph.ts'
import { indexDigitalMicrograph } from '../src/scientific/formats/digital-micrograph.ts'
import {
  createDigitalMicrographReader,
  digitalMicrographReader,
} from '../src/scientific/readers/digital-micrograph.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'
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

type NumericFixtureType =
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'float32'
  | 'float64'

const numericArrayPayload = (
  type: NumericFixtureType,
  values: readonly number[],
  byteOrder: DigitalMicrographByteOrder,
): Uint8Array => {
  const bytesPerSample =
    type === 'int8' || type === 'uint8'
      ? 1
      : type === 'int16' || type === 'uint16'
        ? 2
        : type === 'float64'
          ? 8
          : 4
  const output = new Uint8Array(values.length * bytesPerSample)
  const view = new DataView(output.buffer)
  const littleEndian = byteOrder === 'little-endian'
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0
    const offset = index * bytesPerSample
    if (type === 'int8') view.setInt8(offset, value)
    else if (type === 'uint8') view.setUint8(offset, value)
    else if (type === 'int16') view.setInt16(offset, value, littleEndian)
    else if (type === 'uint16') view.setUint16(offset, value, littleEndian)
    else if (type === 'int32') view.setInt32(offset, value, littleEndian)
    else if (type === 'uint32') view.setUint32(offset, value, littleEndian)
    else if (type === 'float32') view.setFloat32(offset, value, littleEndian)
    else view.setFloat64(offset, value, littleEndian)
  }
  return output
}

const descriptorCode: Readonly<Record<NumericFixtureType, bigint>> = Object.freeze({
  int8: 9n,
  uint8: 10n,
  int16: 2n,
  uint16: 4n,
  int32: 3n,
  uint32: 5n,
  float32: 6n,
  float64: 7n,
})

interface ReaderImageFixture {
  readonly dataType: number
  readonly dimensions: readonly number[]
  readonly type: NumericFixtureType
  readonly values: readonly number[]
  readonly name?: string
  readonly marker?: 'encrypted' | 'external'
  readonly semantics?: 'eels' | '4d-stem' | 'diffraction-image'
}

const readerImage = (
  fixture: ReaderImageFixture,
  byteOrder: DigitalMicrographByteOrder,
): FixtureGroup => {
  const text = (value: string): Uint8Array =>
    uint16ArrayPayload(
      Array.from(value, (character) => character.charCodeAt(0)),
      byteOrder,
    )
  const imageDataChildren: FixtureNode[] = [
    {
      kind: 'value',
      name: 'DataType',
      info: [3n],
      payload: int32Payload(fixture.dataType, byteOrder),
    },
    {
      kind: 'group',
      name: 'Dimensions',
      children: fixture.dimensions.map((length) => ({
        kind: 'value' as const,
        name: '',
        info: [3n],
        payload: int32Payload(length, byteOrder),
      })),
    },
  ]
  if (fixture.marker !== undefined) {
    imageDataChildren.push({
      kind: 'group',
      name: fixture.marker === 'encrypted' ? 'EncryptedData' : 'ExternalReference',
      children: [],
    })
  } else {
    imageDataChildren.push({
      kind: 'value',
      name: 'Data',
      info: [20n, descriptorCode[fixture.type], BigInt(fixture.values.length)],
      payload: numericArrayPayload(fixture.type, fixture.values, byteOrder),
    })
  }
  const stringValue = (name: string, value: string): FixtureValue => ({
    kind: 'value',
    name,
    info: [20n, 4n, BigInt(value.length)],
    payload: text(value),
  })
  const imageChildren: FixtureNode[] = [
    {
      kind: 'value',
      name: 'Name',
      info: [20n, 4n, BigInt((fixture.name ?? 'Image').length)],
      payload: text(fixture.name ?? 'Image'),
    },
    { kind: 'group', name: 'ImageData', children: imageDataChildren },
  ]
  if (fixture.semantics !== undefined) {
    const metaDataChildren: FixtureNode[] = [
      stringValue('Format', fixture.semantics === 'eels' ? 'Spectrum image' : 'Diffraction image'),
    ]
    if (fixture.semantics === 'eels') metaDataChildren.push(stringValue('Signal', 'EELS'))
    if (fixture.semantics === '4d-stem') {
      metaDataChildren.push({
        kind: 'value',
        name: 'Data Order Swapped',
        info: [8n],
        payload: uint8(1),
      })
    }
    const imageTagsChildren: FixtureNode[] = [
      { kind: 'group', name: 'Meta Data', children: metaDataChildren },
    ]
    if (fixture.semantics === '4d-stem') {
      imageTagsChildren.push({
        kind: 'group',
        name: 'SI',
        children: [
          {
            kind: 'group',
            name: 'Acquisition',
            children: [
              {
                kind: 'group',
                name: 'SI Application Mode',
                children: [stringValue('Name', '2D Array')],
              },
              {
                kind: 'group',
                name: 'Spatial Sampling',
                children: [
                  {
                    kind: 'value',
                    name: 'Width (pixels)',
                    info: [3n],
                    payload: int32Payload(fixture.dimensions[2] ?? 0, byteOrder),
                  },
                  {
                    kind: 'value',
                    name: 'Height (pixels)',
                    info: [3n],
                    payload: int32Payload(fixture.dimensions[3] ?? 0, byteOrder),
                  },
                ],
              },
            ],
          },
        ],
      })
    }
    imageChildren.push({ kind: 'group', name: 'ImageTags', children: imageTagsChildren })
  }
  return {
    kind: 'group',
    name: '',
    children: imageChildren,
  }
}

const readerImages = (
  fixtures: readonly ReaderImageFixture[],
  byteOrder: DigitalMicrographByteOrder,
): readonly FixtureNode[] => [
  {
    kind: 'group',
    name: 'ImageList',
    children: fixtures.map((fixture) => readerImage(fixture, byteOrder)),
  },
]

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

const readerFixtureTree = (
  semantic: 'volume' | 'eels' = 'volume',
  incompleteFirstCalibration = false,
): readonly FixtureNode[] => {
  const byteOrder = 'little-endian' as const
  const text = (value: string): Uint8Array =>
    uint16ArrayPayload(
      Array.from(value, (character) => character.charCodeAt(0)),
      byteOrder,
    )
  const dimensionCalibration = (origin: number, scale: number, unit: string): FixtureGroup => ({
    kind: 'group',
    name: '',
    children: [
      { kind: 'value', name: 'Origin', info: [7n], payload: float64Payload(origin, byteOrder) },
      { kind: 'value', name: 'Scale', info: [7n], payload: float64Payload(scale, byteOrder) },
      {
        kind: 'value',
        name: 'Units',
        info: [20n, 4n, BigInt(unit.length)],
        payload: text(unit),
      },
    ],
  })
  const title = semantic === 'eels' ? 'EELS SI' : 'Volume'
  const imageChildren: FixtureNode[] = [
    {
      kind: 'value',
      name: 'Name',
      info: [20n, 4n, BigInt(title.length)],
      payload: text(title),
    },
    {
      kind: 'group',
      name: 'ImageData',
      children: [
        {
          kind: 'value',
          name: 'DataType',
          info: [3n],
          payload: int32Payload(10, byteOrder),
        },
        {
          kind: 'group',
          name: 'Dimensions',
          children: [3, 2, 2].map((length) => ({
            kind: 'value' as const,
            name: '',
            info: [3n],
            payload: int32Payload(length, byteOrder),
          })),
        },
        {
          kind: 'group',
          name: 'Calibrations',
          children: [
            {
              kind: 'group',
              name: 'Dimension',
              children: [
                dimensionCalibration(2, incompleteFirstCalibration ? 0 : 0.5, 'nm'),
                dimensionCalibration(4, 0.25, 'nm'),
                dimensionCalibration(1, 2, semantic === 'eels' ? 'eV' : 'nm'),
              ],
            },
            {
              kind: 'group',
              name: 'Brightness',
              children: [
                {
                  kind: 'value',
                  name: 'Origin',
                  info: [7n],
                  payload: float64Payload(3, byteOrder),
                },
                {
                  kind: 'value',
                  name: 'Scale',
                  info: [7n],
                  payload: float64Payload(4, byteOrder),
                },
                {
                  kind: 'value',
                  name: 'Units',
                  info: [20n, 4n, 6n],
                  payload: text('counts'),
                },
              ],
            },
          ],
        },
        {
          kind: 'value',
          name: 'Data',
          info: [20n, 4n, 12n],
          payload: uint16ArrayPayload(
            Array.from({ length: 12 }, (_value, index) => index + 1),
            byteOrder,
          ),
        },
      ],
    },
  ]
  if (semantic === 'eels') {
    imageChildren.push({
      kind: 'group',
      name: 'ImageTags',
      children: [
        {
          kind: 'group',
          name: 'Meta Data',
          children: [
            {
              kind: 'value',
              name: 'Format',
              info: [20n, 4n, 14n],
              payload: text('Spectrum image'),
            },
            {
              kind: 'value',
              name: 'Signal',
              info: [20n, 4n, 4n],
              payload: text('EELS'),
            },
          ],
        },
      ],
    })
  }
  return [
    {
      kind: 'group',
      name: 'ImageList',
      children: [
        {
          kind: 'group',
          name: '',
          children: imageChildren,
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

  it('decodes UTF-8 tag names without weakening control-byte rejection', async () => {
    const bytes = encodedFile(4, 'little-endian', [
      { kind: 'value', name: 'µScale', info: [7n], payload: float64Payload(2, 'little-endian') },
    ])
    const index = await indexDigitalMicrograph(new MemorySource(bytes))
    expect(index.root.children[0]?.name).toBe('µScale')

    const invalid = bytes.slice()
    const nameOffset = 16 + 10 + 1 + 2
    invalid[nameOffset] = 0
    await expect(indexDigitalMicrograph(new MemorySource(invalid))).rejects.toThrow('control data')
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

describe('DigitalMicrograph scientific reader', () => {
  it('opens a calibrated volume and reads selected regions directly from its payload', async () => {
    const bytes = encodedFile(4, 'little-endian', readerFixtureTree())
    const context = {
      primary: { id: 'fixture', name: 'volume.dm4', source: new TrackingSource(bytes) },
    }
    await expect(digitalMicrographReader.probe(context)).resolves.toMatchObject({ confidence: 1 })
    const document = await digitalMicrographReader.open(context)
    expect(document.datasets).toHaveLength(1)
    expect(document.datasets[0]).toMatchObject({
      id: 'image-0',
      name: 'Volume',
      descriptor: {
        sampleType: 'uint16',
        axes: [
          { id: 'x', length: 3, unit: 'nm', coordinates: { origin: -1, step: 0.5 } },
          { id: 'y', length: 2, unit: 'nm', coordinates: { origin: -1, step: 0.25 } },
          {
            id: 'z',
            length: 2,
            unit: 'nm',
            coordinates: { origin: -2, step: 2 },
          },
        ],
        components: [{ id: 'intensity', unit: 'counts' }],
      },
    })
    const dataset = await document.openDataset('image-0')
    const blocks = []
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [{ axisId: 'z', index: 1 }],
      x: 1,
      y: 0,
      width: 2,
      height: 2,
    })) {
      blocks.push(block)
    }
    expect(
      blocks.map(({ x, y, width, height, data }) => ({
        x,
        y,
        width,
        height,
        data: Array.from(data),
      })),
    ).toEqual([
      { x: 1, y: 0, width: 2, height: 1, data: [0, 8, 0, 9] },
      { x: 1, y: 1, width: 2, height: 1, data: [0, 11, 0, 12] },
    ])
    const descriptorMetadata = document.datasets[0]?.descriptor.metadata
    expect(descriptorMetadata).toMatchObject({
      'purejsimage:gatan': {
        imageIndex: 0,
        dataType: 10,
        axisSemantics: { kind: 'volume', evidence: ['rank-3'] },
        intensityCalibration: expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining('Brightness') }),
        ]),
      },
    })
  })

  it('maps EELS energy only from matching signal, format, and calibrated-unit evidence', async () => {
    const document = await digitalMicrographReader.open({
      primary: {
        id: 'eels-fixture',
        name: 'eels.dm4',
        source: new MemorySource(encodedFile(4, 'little-endian', readerFixtureTree('eels'))),
      },
    })
    expect(document.datasets[0]).toMatchObject({
      name: 'EELS SI',
      descriptor: {
        axes: [
          { id: 'x', kind: 'space', length: 3 },
          { id: 'y', kind: 'space', length: 2 },
          { id: 'energy', name: 'Energy loss', kind: 'spectral', length: 2, unit: 'eV' },
        ],
        metadata: {
          'purejsimage:gatan': {
            axisSemantics: {
              kind: 'eels-spectrum-image',
              evidence: [
                'dm:ImageTags/Meta Data/Format',
                'dm:ImageTags/Meta Data/Signal',
                'dm:ImageData/Calibrations/Dimension/2/Units',
              ],
            },
          },
        },
      },
    })
    const dataset = await document.openDataset('image-0')
    const data = []
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [{ axisId: 'energy', index: 1 }],
      width: 1,
      height: 1,
    })) {
      data.push(...block.data)
    }
    expect(data).toEqual([0, 7])

    const incompleteDocument = await digitalMicrographReader.open({
      primary: {
        id: 'eels-without-energy-calibration',
        name: 'eels-without-energy-calibration.dm4',
        source: new MemorySource(
          encodedFile(
            4,
            'little-endian',
            readerImages(
              [
                {
                  dataType: 10,
                  dimensions: [2, 1, 2],
                  type: 'uint16',
                  values: [1, 2, 3, 4],
                  semantics: 'eels',
                },
              ],
              'little-endian',
            ),
          ),
        ),
      },
    })
    expect(incompleteDocument.datasets[0]?.descriptor.axes.map(({ id }) => id)).toEqual([
      'dimension-0',
      'dimension-1',
      'dimension-2',
    ])
  })

  it('preserves incomplete DM calibration tags without claiming a physical axis unit', async () => {
    const document = await digitalMicrographReader.open({
      primary: {
        id: 'incomplete-calibration',
        name: 'incomplete.dm4',
        source: new MemorySource(
          encodedFile(4, 'little-endian', readerFixtureTree('volume', true)),
        ),
      },
    })
    expect(document.datasets[0]?.descriptor.axes[0]).toMatchObject({
      id: 'x',
      coordinates: { type: 'index' },
    })
    expect(document.datasets[0]?.descriptor.axes[0]).not.toHaveProperty('unit')
    expect(document.datasets[0]?.descriptor.axes[0]).not.toHaveProperty('calibration')
    expect(document.datasets[0]?.descriptor.metadata).toMatchObject({
      'purejsimage:gatan': {
        tags: expect.arrayContaining([expect.objectContaining({ value: 0 })]),
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: 'incomplete-axis-calibration', axisId: 'x' }),
        ]),
      },
    })
    expect(JSON.stringify(document.datasets[0]?.descriptor.metadata)).toContain('Units')
  })

  it('preserves every supported scalar sample type in canonical big-endian blocks', async () => {
    const fixtures = [
      { dataType: 1, type: 'int16' as const, values: [-2, 3] },
      { dataType: 2, type: 'float32' as const, values: [1.5, -2.25] },
      { dataType: 6, type: 'uint8' as const, values: [1, 254] },
      { dataType: 7, type: 'int32' as const, values: [-70_000, 80_000] },
      { dataType: 9, type: 'int8' as const, values: [-8, 7] },
      { dataType: 10, type: 'uint16' as const, values: [500, 60_000] },
      { dataType: 11, type: 'uint32' as const, values: [70_000, 4_000_000_000] },
      { dataType: 12, type: 'float64' as const, values: [Math.PI, -0.5] },
    ]
    for (let fixtureIndex = 0; fixtureIndex < fixtures.length; fixtureIndex += 1) {
      const fixture = fixtures[fixtureIndex]
      if (fixture === undefined) continue
      const version = fixtureIndex % 2 === 0 ? 3 : 4
      const byteOrder = fixtureIndex % 3 === 0 ? 'big-endian' : 'little-endian'
      const document = await digitalMicrographReader.open({
        primary: {
          id: `scalar-${fixtureIndex}`,
          name: `scalar-${fixtureIndex}.dm${version}`,
          source: new MemorySource(
            encodedFile(
              version,
              byteOrder,
              readerImages([{ ...fixture, dimensions: [2, 1], name: fixture.type }], byteOrder),
            ),
          ),
        },
      })
      expect(document.datasets[0]?.descriptor.sampleType).toBe(fixture.type)
      const dataset = await document.openDataset('image-0')
      const blocks = []
      for await (const block of dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
      })) {
        blocks.push(...block.data)
      }
      expect(blocks, fixture.type).toEqual([
        ...numericArrayPayload(fixture.type, fixture.values, 'big-endian'),
      ])
    }
  })

  it('maps fixture-proven packed BGRA to RGBA and preserves neutral 4D axis order', async () => {
    const byteOrder = 'little-endian' as const
    const packedDocument = await digitalMicrographReader.open({
      primary: {
        id: 'packed',
        name: 'packed.dm4',
        source: new MemorySource(
          encodedFile(
            4,
            byteOrder,
            readerImages(
              [
                {
                  dataType: 23,
                  dimensions: [2, 1],
                  type: 'int32',
                  values: [0x0401_0203, 0x0805_0607],
                },
              ],
              byteOrder,
            ),
          ),
        ),
      },
    })
    const packed = await packedDocument.openDataset('image-0')
    const packedBlocks = []
    for await (const block of packed.readPlane({ displayAxes: ['x', 'y'], fixedIndices: [] })) {
      packedBlocks.push(...block.data)
    }
    expect(packedBlocks).toEqual([1, 2, 3, 4, 5, 6, 7, 8])

    const values = Array.from({ length: 16 }, (_value, index) => index + 1)
    const source = new TrackingSource(
      encodedFile(
        4,
        byteOrder,
        readerImages(
          [{ dataType: 10, dimensions: [2, 2, 2, 2], type: 'uint16', values }],
          byteOrder,
        ),
      ),
    )
    const document = await digitalMicrographReader.open({
      primary: { id: 'four-dimensional', name: 'four-dimensional.dm4', source },
    })
    expect(document.datasets[0]?.descriptor.axes).toMatchObject([
      { id: 'dimension-0', name: 'Dimension 0', length: 2 },
      { id: 'dimension-1', name: 'Dimension 1', length: 2 },
      { id: 'dimension-2', name: 'Dimension 2', length: 2 },
      { id: 'dimension-3', name: 'Dimension 3', length: 2 },
    ])
    expect(document.datasets[0]?.descriptor.metadata).toMatchObject({
      'purejsimage:gatan': { axisSemantics: { kind: 'neutral', evidence: [] } },
    })
    const readsBeforePlane = source.reads.length
    const dataset = await document.openDataset('image-0')
    const data = []
    for await (const block of dataset.readPlane({
      displayAxes: ['dimension-0', 'dimension-1'],
      fixedIndices: [
        { axisId: 'dimension-2', index: 1 },
        { axisId: 'dimension-3', index: 1 },
      ],
      x: 0,
      y: 1,
      width: 2,
      height: 1,
    })) {
      data.push(...block.data)
    }
    expect(data).toEqual([0, 15, 0, 16])
    expect(source.reads.slice(readsBeforePlane)).toEqual([expect.objectContaining({ length: 4 })])
  })

  it('maps 4D-STEM roles only from exact diffraction and scan-shape evidence', async () => {
    const byteOrder = 'little-endian' as const
    const values = Array.from({ length: 24 }, (_value, index) => index + 1)
    const document = await digitalMicrographReader.open({
      primary: {
        id: '4d-stem',
        name: '4d-stem.dm4',
        source: new MemorySource(
          encodedFile(
            4,
            byteOrder,
            readerImages(
              [
                {
                  dataType: 10,
                  dimensions: [2, 2, 3, 2],
                  type: 'uint16',
                  values,
                  name: 'Diffraction SI',
                  semantics: '4d-stem',
                },
              ],
              byteOrder,
            ),
          ),
        ),
      },
    })
    expect(document.datasets[0]).toMatchObject({
      descriptor: {
        axes: [
          { id: 'scanX', name: 'Scan X', kind: 'space', length: 3 },
          { id: 'scanY', name: 'Scan Y', kind: 'space', length: 2 },
          { id: 'kx', name: 'Diffraction X', kind: 'reciprocal-space', length: 2 },
          { id: 'ky', name: 'Diffraction Y', kind: 'reciprocal-space', length: 2 },
        ],
        capabilities: {
          planeReads: { kind: 'ordered-axis-pairs', pairs: [['kx', 'ky']] },
        },
        metadata: {
          'purejsimage:gatan': {
            axisSemantics: {
              kind: '4d-stem',
              evidence: [
                'dm:ImageTags/Meta Data/Format',
                'dm:ImageTags/Meta Data/Data Order Swapped',
                'dm:ImageTags/SI/Acquisition/SI Application Mode/Name',
                'dm:ImageTags/SI/Acquisition/Spatial Sampling',
              ],
            },
          },
        },
      },
    })
    const dataset = await document.openDataset('image-0')
    const data = []
    for await (const block of dataset.readPlane({
      displayAxes: ['kx', 'ky'],
      fixedIndices: [
        { axisId: 'scanX', index: 1 },
        { axisId: 'scanY', index: 1 },
      ],
    })) {
      data.push(...block.data)
    }
    expect(data).toEqual([0, 17, 0, 18, 0, 19, 0, 20])

    const partialDocument = await digitalMicrographReader.open({
      primary: {
        id: 'partial-4d',
        name: 'partial-4d.dm4',
        source: new MemorySource(
          encodedFile(
            4,
            byteOrder,
            readerImages(
              [
                {
                  dataType: 10,
                  dimensions: [2, 2, 3, 2],
                  type: 'uint16',
                  values,
                  name: '4D STEM by title only',
                  semantics: 'diffraction-image',
                },
              ],
              byteOrder,
            ),
          ),
        ),
      },
    })
    expect(partialDocument.datasets[0]?.descriptor.axes.map(({ id }) => id)).toEqual([
      'dimension-0',
      'dimension-1',
      'dimension-2',
      'dimension-3',
    ])
  })

  it('keeps supported images while reporting one-dimensional entries exactly', async () => {
    const byteOrder = 'little-endian' as const
    const document = await digitalMicrographReader.open({
      primary: {
        id: 'mixed',
        name: 'mixed.dm3',
        source: new MemorySource(
          encodedFile(
            3,
            byteOrder,
            readerImages(
              [
                { dataType: 6, dimensions: [2, 2], type: 'uint8', values: [1, 2, 3, 4] },
                { dataType: 2, dimensions: [2], type: 'float32', values: [1, 2] },
              ],
              byteOrder,
            ),
          ),
        ),
      },
    })
    expect(document.datasets.map(({ id }) => id)).toEqual(['image-0'])
    expect(document.metadata).toMatchObject({
      unsupportedDatasets: [{ imageIndex: 1, reason: 'is a one-dimensional signal' }],
    })
  })

  it('rejects complex, undocumented, encrypted, external, and rank-1-only images exactly', async () => {
    const cases: readonly {
      readonly fixture: ReaderImageFixture
      readonly message: string
    }[] = [
      {
        fixture: { dataType: 3, dimensions: [2, 2], type: 'float32', values: [1, 2, 3, 4] },
        message: 'uses unsupported complex or packed-complex DataType 3',
      },
      {
        fixture: { dataType: 99, dimensions: [2, 2], type: 'uint8', values: [1, 2, 3, 4] },
        message: 'uses unsupported or undocumented packed DataType 99',
      },
      {
        fixture: {
          dataType: 6,
          dimensions: [2, 2],
          type: 'uint8',
          values: [],
          marker: 'encrypted',
        },
        message: 'uses unsupported encrypted image content',
      },
      {
        fixture: {
          dataType: 6,
          dimensions: [2, 2],
          type: 'uint8',
          values: [],
          marker: 'external',
        },
        message: 'uses unsupported externally referenced image content',
      },
      {
        fixture: { dataType: 2, dimensions: [4], type: 'float32', values: [1, 2, 3, 4] },
        message: 'is a one-dimensional signal',
      },
    ]
    for (const [caseIndex, testCase] of cases.entries()) {
      const bytes = encodedFile(
        4,
        'little-endian',
        readerImages([testCase.fixture], 'little-endian'),
      )
      await expect(
        digitalMicrographReader.open({
          primary: {
            id: `unsupported-${caseIndex}`,
            name: 'unsupported.dm4',
            source: new MemorySource(bytes),
          },
        }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
      await expect(
        digitalMicrographReader.open({
          primary: {
            id: `unsupported-${caseIndex}`,
            name: 'unsupported.dm4',
            source: new MemorySource(bytes),
          },
        }),
      ).rejects.toThrow(testCase.message)
    }
  })

  it('classifies malformed image descriptors and payload sizes as invalid input', async () => {
    const cases = [
      {
        fixture: { dataType: 10, dimensions: [2, 2], type: 'uint8' as const, values: [1, 2, 3, 4] },
        message: 'malformed Data descriptor for DataType 10',
      },
      {
        fixture: { dataType: 10, dimensions: [2, 2], type: 'uint16' as const, values: [1, 2, 3] },
        message: 'inconsistent data size',
      },
    ]
    for (const [caseIndex, testCase] of cases.entries()) {
      await expect(
        digitalMicrographReader.open({
          primary: {
            id: `malformed-${caseIndex}`,
            name: 'malformed.dm4',
            source: new MemorySource(
              encodedFile(4, 'little-endian', readerImages([testCase.fixture], 'little-endian')),
            ),
          },
        }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
      await expect(
        digitalMicrographReader.open({
          primary: {
            id: `malformed-${caseIndex}`,
            name: 'malformed.dm4',
            source: new MemorySource(
              encodedFile(4, 'little-endian', readerImages([testCase.fixture], 'little-endian')),
            ),
          },
        }),
      ).rejects.toThrow(testCase.message)
    }
  })

  it('does not generalize fixture-proven packed color to unproven byte orders', async () => {
    const bytes = encodedFile(
      3,
      'big-endian',
      readerImages(
        [{ dataType: 23, dimensions: [1, 1], type: 'int32', values: [0x0102_0304] }],
        'big-endian',
      ),
    )
    await expect(
      digitalMicrographReader.open({
        primary: { id: 'packed-big-endian', name: 'packed.dm3', source: new MemorySource(bytes) },
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    await expect(
      digitalMicrographReader.open({
        primary: { id: 'packed-big-endian', name: 'packed.dm3', source: new MemorySource(bytes) },
      }),
    ).rejects.toThrow('unsupported big-endian packed color DataType 23')
  })

  it('handles truncated probes and observes cancellation before selected-region reads', async () => {
    await expect(
      digitalMicrographReader.probe({
        primary: { id: 'short', name: 'short.dm4', source: new MemorySource(uint32BigEndian(4)) },
      }),
    ).resolves.toMatchObject({ confidence: 0 })

    const bytes = encodedFile(
      3,
      'big-endian',
      readerImages(
        [{ dataType: 6, dimensions: [2, 2], type: 'uint8', values: [1, 2, 3, 4] }],
        'big-endian',
      ),
    )
    const document = await digitalMicrographReader.open({
      primary: { id: 'cancel', name: 'cancel.dm3', source: new MemorySource(bytes) },
    })
    const dataset = await document.openDataset('image-0')
    const controller = new AbortController()
    controller.abort()
    const iterator = dataset
      .readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        signal: controller.signal,
      })
      [Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('enforces configurable source, dataset, dimension, count, and region limits', async () => {
    const bytes = encodedFile(
      3,
      'little-endian',
      readerImages(
        [{ dataType: 6, dimensions: [2, 2], type: 'uint8', values: [1, 2, 3, 4] }],
        'little-endian',
      ),
    )
    await expect(
      createDigitalMicrographReader({ limits: { maxSourceBytes: bytes.byteLength - 1 } }).open({
        primary: { id: 'source-limit', source: new MemorySource(bytes) },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(
      createDigitalMicrographReader({ limits: { maxDatasetBytes: 3 } }).open({
        primary: { id: 'dataset-limit', source: new MemorySource(bytes) },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(
      createDigitalMicrographReader({ limits: { maxDimensionLength: 1 } }).open({
        primary: { id: 'dimension-limit', source: new MemorySource(bytes) },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const twoImages = encodedFile(
      3,
      'little-endian',
      readerImages(
        [
          { dataType: 6, dimensions: [1, 1], type: 'uint8', values: [1] },
          { dataType: 6, dimensions: [1, 1], type: 'uint8', values: [2] },
        ],
        'little-endian',
      ),
    )
    await expect(
      createDigitalMicrographReader({ limits: { maxDatasets: 1 } }).open({
        primary: { id: 'dataset-count-limit', source: new MemorySource(twoImages) },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const regionReader = createDigitalMicrographReader({ limits: { maxRegionBytes: 3 } })
    const document = await regionReader.open({
      primary: { id: 'region-limit', source: new MemorySource(bytes) },
    })
    const dataset = await document.openDataset('image-0')
    const iterator = dataset
      .readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        width: 2,
        height: 2,
      })
      [Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(() => createDigitalMicrographReader({ limits: { maxRegionBytes: 0 } })).toThrow(
      'positive safe integer',
    )
  })

  it('preserves descriptors and samples through an HTTP range source', async () => {
    const bytes = encodedFile(
      4,
      'little-endian',
      readerImages(
        [{ dataType: 10, dimensions: [2, 2], type: 'uint16', values: [1, 2, 3, 4] }],
        'little-endian',
      ),
    )
    const ranges: string[] = []
    const fetchRange: typeof fetch = async (_input, init) => {
      const range = new Headers(init?.headers).get('range') ?? ''
      const match = range.match(/^bytes=(\d+)-(\d+)$/)
      if (match === null) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Math.min(Number(match[2]), bytes.byteLength - 1)
      ranges.push(range)
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
          etag: '"dm-fixture"',
        },
      })
    }
    const remote = await HttpRangeSource.open('https://example.test/fixture.dm4', {
      blockBytes: 32,
      maxCacheBytes: 256,
      fetch: fetchRange,
    })
    const [localDocument, remoteDocument] = await Promise.all([
      digitalMicrographReader.open({
        primary: { id: 'local', name: 'fixture.dm4', source: new MemorySource(bytes) },
      }),
      digitalMicrographReader.open({
        primary: { id: 'remote', name: 'fixture.dm4', source: remote },
      }),
    ])
    expect(remoteDocument.datasets[0]?.descriptor).toEqual(localDocument.datasets[0]?.descriptor)
    const dataset = await remoteDocument.openDataset('image-0')
    const output: number[] = []
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 1,
      y: 0,
      width: 1,
      height: 2,
    })) {
      output.push(...block.data)
    }
    expect(output).toEqual([0, 2, 0, 4])
    expect(ranges.length).toBeGreaterThan(1)
  })

  it('owns emitted rows when the source has the weakest allowed buffer lifetime', async () => {
    const bytes = encodedFile(
      3,
      'big-endian',
      readerImages(
        [{ dataType: 6, dimensions: [2, 2], type: 'uint8', values: [1, 2, 3, 4] }],
        'big-endian',
      ),
    )
    const document = await digitalMicrographReader.open({
      primary: { id: 'hostile', source: new HostileSource(bytes) },
    })
    const dataset = await document.openDataset('image-0')
    const rows: Uint8Array[] = []
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
    })) {
      rows.push(block.data)
    }
    expect(rows.map((row) => Array.from(row))).toEqual([
      [1, 2],
      [3, 4],
    ])
  })
})
