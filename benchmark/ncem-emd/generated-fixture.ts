import {
  createGeneratedAttributeMessage,
  generatedLittleEndianInteger,
} from '../hdf5/generated-attribute-fixture.ts'
import {
  createGeneratedCompactLayoutMessage,
  createGeneratedContiguousLayoutMessage,
  createGeneratedDataspaceMessage,
  createGeneratedFloatDatatypeMessage,
  createGeneratedIntegerDatatypeMessage,
  createGeneratedStringDatatypeMessage,
  createGeneratedVariableStringDatatypeMessage,
} from '../hdf5/generated-dataset-fixture.ts'
import { createGeneratedHdf5Fixture } from '../hdf5/generated-fixture.ts'
import {
  createGeneratedHardLink,
  createGeneratedVersion2ObjectHeader,
  type GeneratedHdf5ObjectMessage,
} from '../hdf5/generated-object-fixture.ts'

export interface GeneratedNcemEmdFixtureOptions {
  readonly versionMajor?: bigint
  readonly versionMinor?: bigint
  readonly versionStrings?: boolean
  readonly groupType?: bigint
  readonly dim1Values?: readonly number[]
  readonly dim2Values?: readonly number[]
  readonly acquisitionMetadata?: boolean
  readonly acquisitionArrays?: boolean
  readonly numericRoot?: 'data' | 'signals'
}

export interface GeneratedNcemEmdFixture {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly rawDataAddress: number
  readonly expectedData: readonly number[]
}

const dataGroupAddress = 512n
const imageGroupAddress = 768n
const imageDataAddress = 1_024n
const dim1Address = 1_280n
const dim2Address = 1_536n
const microscopeAddress = 2_048n
const sampleAddress = 2_560n
const userAddress = 3_072n
const commentsAddress = 3_584n
const globalHeapAddress = 6_144n
const rawDataAddress = 8_192

const hardLink = (name: string, address: bigint): GeneratedHdf5ObjectMessage =>
  Object.freeze({ type: 0x0006, data: createGeneratedHardLink({ name }, address, 8) })

const scalarIntegerAttribute = (name: string, value: bigint): GeneratedHdf5ObjectMessage =>
  Object.freeze({
    type: 0x000c,
    data: createGeneratedAttributeMessage({
      version: 3,
      name,
      datatype: createGeneratedIntegerDatatypeMessage({ byteLength: 8, signed: true }),
      dataspace: createGeneratedDataspaceMessage({ version: 2, lengthSize: 8 }),
      data: generatedLittleEndianInteger(value, 8),
    }),
  })

const scalarStringAttribute = (name: string, value: string): GeneratedHdf5ObjectMessage => {
  const data = new TextEncoder().encode(value)
  return Object.freeze({
    type: 0x000c,
    data: createGeneratedAttributeMessage({
      version: 3,
      name,
      datatype: createGeneratedStringDatatypeMessage({
        version: 3,
        byteLength: data.byteLength,
        padding: 'null-padded',
      }),
      dataspace: createGeneratedDataspaceMessage({ version: 2, lengthSize: 8 }),
      data,
    }),
  })
}

const float64Attribute = (name: string, value: number): GeneratedHdf5ObjectMessage => {
  const data = new Uint8Array(8)
  new DataView(data.buffer).setFloat64(0, value, true)
  return Object.freeze({
    type: 0x000c,
    data: createGeneratedAttributeMessage({
      version: 3,
      name,
      datatype: createGeneratedFloatDatatypeMessage({ format: 'binary64' }),
      dataspace: createGeneratedDataspaceMessage({ version: 2, lengthSize: 8 }),
      data,
    }),
  })
}

const float64ArrayAttribute = (
  name: string,
  values: readonly number[],
): GeneratedHdf5ObjectMessage =>
  Object.freeze({
    type: 0x000c,
    data: createGeneratedAttributeMessage({
      version: 3,
      name,
      datatype: createGeneratedFloatDatatypeMessage({ format: 'binary64' }),
      dataspace: createGeneratedDataspaceMessage({
        version: 2,
        lengthSize: 8,
        dimensions: [BigInt(values.length)],
      }),
      data: float64Bytes(values),
    }),
  })

const fixedStringArrayAttribute = (
  name: string,
  values: readonly string[],
): GeneratedHdf5ObjectMessage => {
  const elementBytes = Math.max(
    ...values.map((value) => new TextEncoder().encode(value).byteLength),
  )
  const data = new Uint8Array(elementBytes * values.length)
  values.forEach((value, index) => {
    data.set(new TextEncoder().encode(value), index * elementBytes)
  })
  return Object.freeze({
    type: 0x000c,
    data: createGeneratedAttributeMessage({
      version: 3,
      name,
      datatype: createGeneratedStringDatatypeMessage({
        version: 3,
        byteLength: elementBytes,
        padding: 'null-padded',
      }),
      dataspace: createGeneratedDataspaceMessage({
        version: 2,
        lengthSize: 8,
        dimensions: [BigInt(values.length)],
      }),
      data,
    }),
  })
}

const variableStringDescriptor = (value: string, index: number): Uint8Array<ArrayBuffer> => {
  const encoded = new TextEncoder().encode(value)
  const output = new Uint8Array(16)
  const view = new DataView(output.buffer)
  view.setUint32(0, encoded.byteLength, true)
  view.setBigUint64(4, globalHeapAddress, true)
  view.setUint32(12, index, true)
  return output
}

const variableStringAttribute = (
  name: string,
  value: string,
  index: number,
): GeneratedHdf5ObjectMessage =>
  Object.freeze({
    type: 0x000c,
    data: createGeneratedAttributeMessage({
      version: 3,
      name,
      datatype: createGeneratedVariableStringDatatypeMessage({
        descriptorBytes: 16,
        characterSet: 'utf-8',
      }),
      dataspace: createGeneratedDataspaceMessage({ version: 2, lengthSize: 8 }),
      data: variableStringDescriptor(value, index),
    }),
  })

const globalHeap = (values: readonly string[]): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(1_024)
  output.set([0x47, 0x43, 0x4f, 0x4c, 1], 0)
  new DataView(output.buffer).setBigUint64(8, BigInt(output.byteLength), true)
  let position = 16
  for (let index = 0; index < values.length; index += 1) {
    const encoded = new TextEncoder().encode(values[index] ?? '')
    const view = new DataView(output.buffer)
    view.setUint16(position, index + 1, true)
    view.setBigUint64(position + 8, BigInt(encoded.byteLength), true)
    output.set(encoded, position + 16)
    position += 16 + ((encoded.byteLength + 7) & ~7)
  }
  const freeBytes = output.byteLength - position
  new DataView(output.buffer).setBigUint64(position + 8, BigInt(freeBytes), true)
  return output
}

const metadataGroup = (
  attributes: readonly GeneratedHdf5ObjectMessage[],
): Uint8Array<ArrayBuffer> =>
  createGeneratedVersion2ObjectHeader([{ type: 0x000a, data: new Uint8Array() }, ...attributes])

const float64Bytes = (values: readonly number[]): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(values.length * 8)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat64(index * 8, values[index] ?? 0, true)
  }
  return output
}

const uint16Bytes = (values: readonly number[]): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(values.length * 2)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setUint16(index * 2, values[index] ?? 0, true)
  }
  return output
}

const dimensionDataset = (
  values: readonly number[],
  name: string,
  units: string,
): Uint8Array<ArrayBuffer> =>
  createGeneratedVersion2ObjectHeader([
    {
      type: 0x0001,
      data: createGeneratedDataspaceMessage({
        version: 2,
        lengthSize: 8,
        dimensions: [BigInt(values.length)],
      }),
    },
    { type: 0x0003, data: createGeneratedFloatDatatypeMessage({ format: 'binary64' }) },
    {
      type: 0x0008,
      data: createGeneratedCompactLayoutMessage({
        version: 4,
        dimensions: [],
        data: float64Bytes(values),
      }),
    },
    scalarStringAttribute('name', name),
    scalarStringAttribute('units', units),
  ])

export const createGeneratedNcemEmdFixture = (
  options: Readonly<GeneratedNcemEmdFixtureOptions> = {},
): GeneratedNcemEmdFixture => {
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 12_288 })
  if (fixture.rootObjectOffset === undefined)
    throw new Error('Generated NCEM EMD root is unavailable')
  const expectedData = Object.freeze(Array.from({ length: 12 }, (_value, index) => index + 1))
  const raw = uint16Bytes(expectedData)
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([
      ...(options.versionStrings === true
        ? [
            variableStringAttribute('version_major', String(options.versionMajor ?? 0n), 5),
            variableStringAttribute('version_minor', String(options.versionMinor ?? 2n), 6),
          ]
        : [
            scalarIntegerAttribute('version_major', options.versionMajor ?? 0n),
            scalarIntegerAttribute('version_minor', options.versionMinor ?? 2n),
          ]),
      hardLink(options.numericRoot ?? 'data', dataGroupAddress),
      ...(options.acquisitionMetadata === true
        ? [
            hardLink('microscope', microscopeAddress),
            hardLink('sample', sampleAddress),
            hardLink('user', userAddress),
            hardLink('comments', commentsAddress),
          ]
        : []),
    ]),
    fixture.rootObjectOffset,
  )
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([hardLink('image', imageGroupAddress)]),
    Number(dataGroupAddress),
  )
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([
      scalarIntegerAttribute('emd_group_type', options.groupType ?? 1n),
      hardLink('data', imageDataAddress),
      hardLink('dim1', dim1Address),
      hardLink('dim2', dim2Address),
    ]),
    Number(imageGroupAddress),
  )
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([
      {
        type: 0x0001,
        data: createGeneratedDataspaceMessage({
          version: 2,
          lengthSize: 8,
          dimensions: [3n, 4n],
        }),
      },
      { type: 0x0003, data: createGeneratedIntegerDatatypeMessage({ byteLength: 2 }) },
      {
        type: 0x0008,
        data: createGeneratedContiguousLayoutMessage({
          version: 4,
          offsetSize: 8,
          lengthSize: 8,
          dimensions: [],
          address: BigInt(rawDataAddress),
          storageBytes: BigInt(raw.byteLength),
        }),
      },
    ]),
    Number(imageDataAddress),
  )
  fixture.bytes.set(
    dimensionDataset(options.dim1Values ?? [0, 0.5, 1], 'Position Y', '[n_m]'),
    Number(dim1Address),
  )
  fixture.bytes.set(
    dimensionDataset(options.dim2Values ?? [-1, 0.25], 'Position X', '[n_m]'),
    Number(dim2Address),
  )
  if (options.acquisitionMetadata === true) {
    fixture.bytes.set(
      metadataGroup([
        float64Attribute('accelerating_voltage', 200_000),
        variableStringAttribute('operator', 'Ada Lovelace', 1),
        ...(options.acquisitionArrays === true
          ? [
              float64ArrayAttribute('stage_position', [1.25, -2.5, 3.75]),
              fixedStringArrayAttribute('detectors', ['BF', 'HAADF']),
            ]
          : []),
      ]),
      Number(microscopeAddress),
    )
    fixture.bytes.set(
      metadataGroup([variableStringAttribute('material', 'Si3N4', 2)]),
      Number(sampleAddress),
    )
    fixture.bytes.set(
      metadataGroup([variableStringAttribute('name', 'Microscopist', 3)]),
      Number(userAddress),
    )
    fixture.bytes.set(
      metadataGroup([variableStringAttribute('note', 'generated fixture', 4)]),
      Number(commentsAddress),
    )
    fixture.bytes.set(
      globalHeap([
        'Ada Lovelace',
        'Si3N4',
        'Microscopist',
        'generated fixture',
        String(options.versionMajor ?? 0n),
        String(options.versionMinor ?? 2n),
      ]),
      Number(globalHeapAddress),
    )
  } else if (options.versionStrings === true) {
    fixture.bytes.set(
      globalHeap([
        '',
        '',
        '',
        '',
        String(options.versionMajor ?? 0n),
        String(options.versionMinor ?? 2n),
      ]),
      Number(globalHeapAddress),
    )
  }
  fixture.bytes.set(raw, rawDataAddress)
  return Object.freeze({ bytes: fixture.bytes, rawDataAddress, expectedData })
}
