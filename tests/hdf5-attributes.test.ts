import { describe, expect, it } from 'vitest'
import {
  createGeneratedAttributeMessage,
  generatedLittleEndianInteger,
} from '../benchmark/hdf5/generated-attribute-fixture.ts'
import {
  createGeneratedDataspaceMessage,
  createGeneratedIntegerDatatypeMessage,
  createGeneratedStringDatatypeMessage,
} from '../benchmark/hdf5/generated-dataset-fixture.ts'
import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import { createGeneratedVersion2ObjectHeader } from '../benchmark/hdf5/generated-object-fixture.ts'
import {
  hdf5IntegerAttributeValue,
  hdf5StringAttributeValue,
} from '../src/scientific/formats/hdf5-attributes.ts'
import { openHdf5File } from '../src/scientific/formats/hdf5-file.ts'
import { MemorySource } from '../src/source.ts'

const attributeMessage = (
  version: 1 | 2 | 3,
  name: string,
  value: bigint,
  sharedDatatype = false,
) => ({
  type: 0x000c,
  data: createGeneratedAttributeMessage({
    version,
    name,
    characterSet: version === 3 ? 'utf-8' : 'ascii',
    sharedDatatype,
    datatype: createGeneratedIntegerDatatypeMessage({ byteLength: 8, signed: true }),
    dataspace: createGeneratedDataspaceMessage({ version: 2, lengthSize: 8 }),
    data: generatedLittleEndianInteger(value, 8),
  }),
})

const stringAttributeMessage = (
  name: string,
  value: string,
  padding: 'null-padded' | 'space-padded',
  characterSet: 'ascii' | 'utf-8' = 'ascii',
) => {
  const encoded = new TextEncoder().encode(value)
  const data = new Uint8Array(encoded.byteLength + 3)
  if (padding === 'space-padded') data.fill(0x20)
  data.set(encoded)
  return {
    type: 0x000c,
    data: createGeneratedAttributeMessage({
      version: 3,
      name,
      datatype: createGeneratedStringDatatypeMessage({
        version: 3,
        byteLength: data.byteLength,
        padding,
        characterSet,
      }),
      dataspace: createGeneratedDataspaceMessage({ version: 2, lengthSize: 8 }),
      data,
    }),
  }
}

const rootFixture = (
  messages: readonly Readonly<{ readonly type: number; readonly data: Uint8Array }>[],
): Uint8Array<ArrayBuffer> => {
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 2_048 })
  if (fixture.rootObjectOffset === undefined)
    throw new Error('Generated attribute root is unavailable')
  fixture.bytes.set(createGeneratedVersion2ObjectHeader(messages), fixture.rootObjectOffset)
  return fixture.bytes
}

const attributeInfo = (dense: boolean): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(18)
  output.fill(0xff, 2)
  if (dense) {
    const view = new DataView(output.buffer)
    view.setBigUint64(2, 1_024n, true)
    view.setBigUint64(10, 2_048n, true)
  }
  return output
}

describe('HDF5 compact attributes', () => {
  it('parses versions 1 through 3 and exact signed scalar integers', async () => {
    const file = await openHdf5File(
      new MemorySource(
        rootFixture([
          { type: 0x0015, data: attributeInfo(false) },
          attributeMessage(1, 'legacy', -2n),
          attributeMessage(2, 'middle', 7n),
          attributeMessage(3, 'μ-value', 42n),
        ]),
      ),
    )
    const attributes = await file.attributes('/')
    expect(attributes?.map(({ name, characterSet }) => ({ name, characterSet }))).toEqual([
      { name: 'legacy', characterSet: 'ascii' },
      { name: 'middle', characterSet: 'ascii' },
      { name: 'μ-value', characterSet: 'utf-8' },
    ])
    expect(attributes?.map(hdf5IntegerAttributeValue)).toEqual([-2n, 7n, 42n])
  })

  it('selects named attributes without parsing unrelated unsupported values', async () => {
    const file = await openHdf5File(
      new MemorySource(
        rootFixture([
          attributeMessage(3, 'selected', 9n),
          attributeMessage(3, 'unselected-shared', 10n, true),
        ]),
      ),
    )
    const attributes = await file.attributes('/', ['selected'])
    expect(attributes).toHaveLength(1)
    const selected = attributes?.[0]
    if (selected === undefined) throw new Error('Expected selected HDF5 attribute')
    expect(hdf5IntegerAttributeValue(selected)).toBe(9n)
    await expect(file.attributes('/')).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })

  it('decodes fixed ASCII and UTF-8 strings with exact declared padding', async () => {
    const file = await openHdf5File(
      new MemorySource(
        rootFixture([
          stringAttributeMessage('name', 'Position X', 'null-padded'),
          stringAttributeMessage('units', '[n_m]', 'space-padded'),
          stringAttributeMessage('label', 'μ-axis', 'null-padded', 'utf-8'),
        ]),
      ),
    )
    const attributes = await file.attributes('/')
    expect(attributes?.map(hdf5StringAttributeValue)).toEqual(['Position X', '[n_m]', 'μ-axis'])

    const malformed = stringAttributeMessage('bad', 'x', 'null-padded')
    malformed.data[malformed.data.byteLength - 2] = 0x78
    const invalid = await openHdf5File(new MemorySource(rootFixture([malformed])))
    const invalidAttributes = await invalid.attributes('/')
    const bad = invalidAttributes?.[0]
    if (bad === undefined) throw new Error('Expected malformed string attribute')
    expect(() => hdf5StringAttributeValue(bad)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
  })

  it('bounds attribute count, metadata, values, operations, and cancellation', async () => {
    const bytes = rootFixture([attributeMessage(3, 'first', 1n), attributeMessage(3, 'second', 2n)])
    for (const attributes of [
      { maxAttributes: 1 },
      { maxAttributeReadOperations: 1 },
      { maxAttributeMetadataBytes: 16 },
      { maxAttributeValueBytes: 4 },
      { maxAttributeNameBytes: 4 },
      { maxMessageBytes: 16 },
    ]) {
      const file = await openHdf5File(new MemorySource(bytes), { attributes })
      await expect(file.attributes('/')).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    }
    const controller = new AbortController()
    controller.abort(new Error('stop HDF5 attributes'))
    const file = await openHdf5File(new MemorySource(bytes))
    await expect(file.attributes('/', undefined, { signal: controller.signal })).rejects.toThrow(
      'stop HDF5 attributes',
    )
  })

  it('rejects dense attribute storage and duplicate compact names explicitly', async () => {
    const dense = await openHdf5File(
      new MemorySource(rootFixture([{ type: 0x0015, data: attributeInfo(true) }])),
    )
    await expect(dense.attributes('/')).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('dense attribute storage'),
    })
    const duplicate = await openHdf5File(
      new MemorySource(
        rootFixture([attributeMessage(3, 'same', 1n), attributeMessage(3, 'same', 2n)]),
      ),
    )
    await expect(duplicate.attributes('/')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
