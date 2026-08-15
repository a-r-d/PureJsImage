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
  readonly imageCount?: number
  readonly userBlockBytes?: number
  readonly metadataBytes?: number
  readonly invalidJson?: boolean
  readonly conflictingFrameCalibration?: boolean
  readonly zeroPixelWidth?: boolean
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

const jsonColumns = (
  storedBytes: number,
  invalidJson: boolean,
  conflictingFrameCalibration: boolean,
  zeroPixelWidth: boolean,
): Uint8Array<ArrayBuffer> => {
  const metadata = invalidJson
    ? '{invalid'
    : JSON.stringify({
        BinaryResult: {
          Detector: 'Generated detector',
          PixelSize: { width: zeroPixelWidth ? '0' : '0.5', height: '0.25' },
          PixelUnitX: 'm',
          PixelUnitY: 'm',
          Offset: { x: '-1', y: '2' },
        },
        Scan: { FrameTime: '0.125' },
      })
  const conflictingMetadata = conflictingFrameCalibration
    ? metadata.replace('"width":"0.5"', '"width":"0.75"')
    : metadata
  const columns = [metadata, conflictingMetadata].map((value) => new TextEncoder().encode(value))
  if (columns.some((encoded) => encoded.byteLength >= storedBytes)) {
    throw new Error('Generated Velox metadata is too small')
  }
  const bytes = new Uint8Array(storedBytes * 2)
  for (let column = 0; column < columns.length; column += 1) {
    const encoded = columns[column]
    if (encoded === undefined) continue
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
  const imageCount = options.imageCount ?? 1
  if (!Number.isSafeInteger(imageCount) || imageCount < 1) {
    throw new Error('Generated Velox imageCount must be a positive safe integer')
  }
  if (variant === 'pruned' && imageCount !== 1) {
    throw new Error('Generated Velox pruned fixtures contain one image hierarchy')
  }
  const storedMetadataBytes = options.metadataBytes ?? 512
  const userBlockBytes = options.userBlockBytes ?? 0
  if (
    !Number.isSafeInteger(userBlockBytes) ||
    userBlockBytes < 0 ||
    (userBlockBytes !== 0 &&
      (userBlockBytes < 512 || (userBlockBytes & (userBlockBytes - 1)) !== 0))
  ) {
    throw new Error('Generated Velox userBlockBytes must be zero or a power of two at least 512')
  }
  const objectStride = 1_024
  const metadataStride = Math.max(4_096, storedMetadataBytes * 2 + 1_024)
  const fixture = createGeneratedHdf5Fixture({
    version: 2,
    fileBytes: Math.max(
      32_768,
      userBlockBytes +
        rawMetadataAddress +
        (imageCount - 1) * metadataStride +
        storedMetadataBytes * 2,
    ),
    userBlockBytes,
  })
  if (fixture.rootObjectOffset === undefined) throw new Error('Generated Velox root is unavailable')
  const physical = (address: number | bigint): number => userBlockBytes + Number(address)
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
    physical(versionAddress),
  )
  fixture.bytes.set(
    group([
      ...(variant === 'pruned'
        ? [hardLink('SpectrumImage', spectrumImageGroupAddress)]
        : [hardLink('Image', imageGroupAddress)]),
    ]),
    physical(dataGroupAddress),
  )
  if (variant === 'pruned') {
    fixture.bytes.set(
      group([hardLink(datasetId, entryAddress)]),
      physical(spectrumImageGroupAddress),
    )
    fixture.bytes.set(group([]), physical(entryAddress))
    return Object.freeze({ bytes: fixture.bytes })
  }

  const rawMetadata = jsonColumns(
    storedMetadataBytes,
    options.invalidJson ?? false,
    options.conflictingFrameCalibration ?? false,
    options.zeroPixelWidth ?? false,
  )
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
  fixture.bytes.set(
    group(
      Array.from({ length: imageCount }, (_value, index) =>
        hardLink(
          index === 0 ? datasetId : `${datasetId}-${index + 1}`,
          entryAddress + BigInt(index * objectStride),
        ),
      ),
    ),
    physical(imageGroupAddress),
  )
  for (let index = 0; index < imageCount; index += 1) {
    const entryObjectAddress = entryAddress + BigInt(index * objectStride)
    const dataObjectAddress = dataAddress + BigInt(index * objectStride)
    const metadataObjectAddress = metadataAddress + BigInt(index * objectStride)
    const rawDataOffset = rawDataAddress + index * 2_048
    const rawMetadataOffset = rawMetadataAddress + index * metadataStride
    fixture.bytes.set(
      group([hardLink('Data', dataObjectAddress), hardLink('Metadata', metadataObjectAddress)]),
      physical(entryObjectAddress),
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
          address: BigInt(rawDataOffset),
          storageBytes: BigInt(rawData.byteLength),
        }),
      ),
      physical(dataObjectAddress),
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
          address: BigInt(rawMetadataOffset),
          storageBytes: BigInt(rawMetadata.byteLength),
        }),
      ),
      physical(metadataObjectAddress),
    )
    fixture.bytes.set(rawData, physical(rawDataOffset))
    fixture.bytes.set(rawMetadata, physical(rawMetadataOffset))
  }
  return Object.freeze({ bytes: fixture.bytes, dataAddress: physical(rawDataAddress), datasetId })
}
