interface FixtureValue {
  readonly kind: 'value'
  readonly name: string
  readonly info: readonly number[]
  readonly payload: Uint8Array
}

interface FixtureGroup {
  readonly kind: 'group'
  readonly name: string
  readonly children: readonly FixtureNode[]
}

type FixtureNode = FixtureValue | FixtureGroup

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

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

const int32LittleEndian = (value: number): Uint8Array => {
  const output = new Uint8Array(4)
  new DataView(output.buffer).setInt32(0, value, true)
  return output
}

const uint16LittleEndian = (values: readonly number[]): Uint8Array => {
  const output = new Uint8Array(values.length * 2)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setUint16(index * 2, values[index] ?? 0, true)
  }
  return output
}

const encodeGroupContents = (children: readonly FixtureNode[]): Uint8Array =>
  concat([Uint8Array.of(1, 0), uint32BigEndian(children.length), ...children.map(encodeEntry)])

const encodeEntry = (node: FixtureNode): Uint8Array => {
  const name = new TextEncoder().encode(node.name)
  const content =
    node.kind === 'group'
      ? encodeGroupContents(node.children)
      : concat([
          new TextEncoder().encode('%%%%'),
          uint32BigEndian(node.info.length),
          ...node.info.map(uint32BigEndian),
          node.payload,
        ])
  return concat([
    Uint8Array.of(node.kind === 'group' ? 20 : 21),
    uint16BigEndian(name.byteLength),
    name,
    content,
  ])
}

/** Generated DM3 little-endian uint16 2x2 image used by browser portability coverage. */
export const generatedDigitalMicrographFixture = (): Uint8Array => {
  const root = encodeGroupContents([
    {
      kind: 'group',
      name: 'ImageList',
      children: [
        {
          kind: 'group',
          name: '',
          children: [
            {
              kind: 'group',
              name: 'ImageData',
              children: [
                {
                  kind: 'value',
                  name: 'DataType',
                  info: [3],
                  payload: int32LittleEndian(10),
                },
                {
                  kind: 'group',
                  name: 'Dimensions',
                  children: [2, 2].map((length) => ({
                    kind: 'value' as const,
                    name: '',
                    info: [3],
                    payload: int32LittleEndian(length),
                  })),
                },
                {
                  kind: 'value',
                  name: 'Data',
                  info: [20, 4, 4],
                  payload: uint16LittleEndian([1, 2, 3, 4]),
                },
              ],
            },
          ],
        },
      ],
    },
  ])
  return concat([
    uint32BigEndian(3),
    uint32BigEndian(root.byteLength + 4),
    uint32BigEndian(1),
    root,
    new Uint8Array(8),
  ])
}
