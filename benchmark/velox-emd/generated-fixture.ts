import {
  createGeneratedCompactLayoutMessage,
  createGeneratedCompoundDatatypeMessage,
  createGeneratedContiguousLayoutMessage,
  createGeneratedDataspaceMessage,
  createGeneratedFloatDatatypeMessage,
  createGeneratedIntegerDatatypeMessage,
  createGeneratedStringDatatypeMessage,
} from '../hdf5/generated-dataset-fixture.ts'
import { createGeneratedHdf5Fixture } from '../hdf5/generated-fixture.ts'
import {
  createGeneratedHardLink,
  createGeneratedVersion2ObjectHeader,
  type GeneratedHdf5ObjectMessage,
} from '../hdf5/generated-object-fixture.ts'

export interface GeneratedVeloxEmdFixtureOptions {
  readonly variant?: 'image' | 'fft' | 'pruned'
  readonly metadataBytes?: number
  readonly invalidJson?: boolean
}

export interface GeneratedVeloxEmdFixture {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly dataAddress?: number
  readonly datasetId?: string
}

const versionAddress = 512n
const dataGroupAddress = 768n
const imageGroupAddress = 1_024n
const spectrumImageGroupAddress = 1_280n
const entryAddress = 1_536n
const dataAddress = 1_792n
const metadataAddress = 2_048n
const rawDataAddress = 16_384
const rawMetadataAddress = 20_480
const datasetId = 'generated-dataset'

const hardLink = (name: string, address: bigint): GeneratedHdf5ObjectMessage =>
  Object.freeze({ type: 0x0006, data: createGeneratedHardLink({ name }, address, 8) })

const group = (links: readonly GeneratedHdf5ObjectMessage[]): Uint8Array<ArrayBuffer> =>
  createGeneratedVersion2ObjectHeader([{ type: 0x000a, data: new Uint8Array() }, ...links])

const dataset = (
  dimensions: readonly bigint[],
  datatype: Uint8Array,
  layout: Uint8Array,
): Uint8Array<ArrayBuffer> =>
  createGeneratedVersion2ObjectHeader([
    {
      type: 0x0001,
      data: createGeneratedDataspaceMessage({ version: 2, lengthSize: 8, dimensions }),
    },
    { type: 0x0003, data: datatype },
    { type: 0x0008, data: layout },
  ])

const uint16Bytes = (values: readonly number[]): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => {
    view.setUint16(index * 2, value, true)
  })
  return bytes
}

const complexFloat32Bytes = (): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(3 * 2 * 2 * 8)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < 12; index += 1) {
    view.setFloat32(index * 8, index + 0.25, true)
    view.setFloat32(index * 8 + 4, -(index + 0.5), true)
  }
  return bytes
}

const jsonColumns = (storedBytes: number, invalidJson: boolean): Uint8Array<ArrayBuffer> => {
  const metadata = invalidJson
    ? '{invalid'
    : JSON.stringify({
        BinaryResult: {
          Detector: 'Generated detector',
          PixelSize: { width: '0.5', height: '0.25' },
          PixelUnitX: 'm',
          PixelUnitY: 'm',
          Offset: { x: '-1', y: '2' },
        },
        Scan: { FrameTime: '0.125' },
      })
  const encoded = new TextEncoder().encode(metadata)
  if (encoded.byteLength >= storedBytes) throw new Error('Generated Velox metadata is too small')
  const bytes = new Uint8Array(storedBytes * 2)
  for (let column = 0; column < 2; column += 1) {
    for (let index = 0; index < encoded.byteLength; index += 1) {
      bytes[index * 2 + column] = encoded[index] ?? 0
    }
  }
  return bytes
}

export const createGeneratedVeloxEmdFixture = (
  options: Readonly<GeneratedVeloxEmdFixtureOptions> = {},
): GeneratedVeloxEmdFixture => {
  const variant = options.variant ?? 'image'
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 32_768 })
  if (fixture.rootObjectOffset === undefined) throw new Error('Generated Velox root is unavailable')
  const version = new TextEncoder().encode('{"format":"Velox","version":"11"}')
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([
      hardLink('Version', versionAddress),
      hardLink('Data', dataGroupAddress),
    ]),
    fixture.rootObjectOffset,
  )
  fixture.bytes.set(
    dataset(
      [1n],
      createGeneratedStringDatatypeMessage({ byteLength: version.byteLength }),
      createGeneratedCompactLayoutMessage({ version: 4, dimensions: [], data: version }),
    ),
    Number(versionAddress),
  )
  fixture.bytes.set(
    group([
      ...(variant === 'pruned'
        ? [hardLink('SpectrumImage', spectrumImageGroupAddress)]
        : [hardLink('Image', imageGroupAddress)]),
    ]),
    Number(dataGroupAddress),
  )
  if (variant === 'pruned') {
    fixture.bytes.set(group([hardLink(datasetId, entryAddress)]), Number(spectrumImageGroupAddress))
    fixture.bytes.set(group([]), Number(entryAddress))
    return Object.freeze({ bytes: fixture.bytes })
  }

  const storedMetadataBytes = options.metadataBytes ?? 512
  const rawMetadata = jsonColumns(storedMetadataBytes, options.invalidJson ?? false)
  const rawData =
    variant === 'fft'
      ? complexFloat32Bytes()
      : uint16Bytes(Array.from({ length: 12 }, (_value, index) => index + 1))
  const datatype =
    variant === 'fft'
      ? createGeneratedCompoundDatatypeMessage({
          version: 3,
          byteLength: 8,
          members: [
            {
              name: 'realFloatHalfEven',
              offset: 0,
              datatype: createGeneratedFloatDatatypeMessage({ format: 'binary32' }),
            },
            {
              name: 'imagFloatHalfEven',
              offset: 4,
              datatype: createGeneratedFloatDatatypeMessage({ format: 'binary32' }),
            },
          ],
        })
      : createGeneratedIntegerDatatypeMessage({ byteLength: 2 })
  fixture.bytes.set(group([hardLink(datasetId, entryAddress)]), Number(imageGroupAddress))
  fixture.bytes.set(
    group([hardLink('Data', dataAddress), hardLink('Metadata', metadataAddress)]),
    Number(entryAddress),
  )
  fixture.bytes.set(
    dataset(
      [3n, 2n, 2n],
      datatype,
      createGeneratedContiguousLayoutMessage({
        version: 4,
        offsetSize: 8,
        lengthSize: 8,
        dimensions: [],
        address: BigInt(rawDataAddress),
        storageBytes: BigInt(rawData.byteLength),
      }),
    ),
    Number(dataAddress),
  )
  fixture.bytes.set(
    dataset(
      [BigInt(storedMetadataBytes), 2n],
      createGeneratedIntegerDatatypeMessage({ byteLength: 1 }),
      createGeneratedContiguousLayoutMessage({
        version: 4,
        offsetSize: 8,
        lengthSize: 8,
        dimensions: [],
        address: BigInt(rawMetadataAddress),
        storageBytes: BigInt(rawMetadata.byteLength),
      }),
    ),
    Number(metadataAddress),
  )
  fixture.bytes.set(rawData, rawDataAddress)
  fixture.bytes.set(rawMetadata, rawMetadataAddress)
  return Object.freeze({ bytes: fixture.bytes, dataAddress: rawDataAddress, datasetId })
}
