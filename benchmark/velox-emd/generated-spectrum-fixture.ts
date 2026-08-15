import {
  createGeneratedCompactLayoutMessage,
  createGeneratedContiguousLayoutMessage,
  createGeneratedDataspaceMessage,
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

export interface GeneratedVeloxSpectrumFixtureOptions {
  readonly streamEncoding?: string
  readonly energyBins?: number
  readonly frameOffsets?: readonly bigint[]
  readonly scanRight?: string
  readonly prettyMetadata?: boolean
  readonly streamEvents?: readonly number[]
}

export interface GeneratedVeloxSpectrumFixture {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly denseId: string
  readonly streamId: string
  readonly eventDataAddress: number
}

const versionAddress = 512n
const dataGroupAddress = 768n
const spectrumGroupAddress = 1_024n
const streamGroupAddress = 1_280n
const denseEntryAddress = 1_536n
const streamEntryAddress = 2_048n
const denseDataAddress = 2_560n
const denseMetadataAddress = 3_072n
const streamDataAddress = 3_584n
const streamMetadataAddress = 4_096n
const settingsAddress = 4_608n
const frameTableAddress = 5_120n
const globalHeapAddress = 6_144n
const denseRawAddress = 16_384
const denseMetadataRawAddress = 17_408
const streamRawAddress = 20_480
const streamMetadataRawAddress = 21_504
const frameTableRawAddress = 24_576
const denseId = 'generated-dense'
const streamId = 'generated-stream'

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

const contiguous = (address: number, byteLength: number): Uint8Array<ArrayBuffer> =>
  createGeneratedContiguousLayoutMessage({
    version: 4,
    offsetSize: 8,
    lengthSize: 8,
    dimensions: [],
    address: BigInt(address),
    storageBytes: BigInt(byteLength),
  })

const integerBytes = (values: readonly number[], byteLength: 2 | 4): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(values.length * byteLength)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < values.length; index += 1) {
    if (byteLength === 2) view.setUint16(index * byteLength, values[index] ?? 0, true)
    else view.setUint32(index * byteLength, values[index] ?? 0, true)
  }
  return bytes
}

const uint64Bytes = (values: readonly bigint[]): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(values.length * 8)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setBigUint64(index * 8, values[index] ?? 0n, true)
  }
  return bytes
}

const jsonBytes = (scanRight: string, pretty: boolean): Uint8Array<ArrayBuffer> => {
  const value = {
    BinaryResult: { Detector: 'EDS-A' },
    Detectors: {
      'Detector-0': {
        DetectorName: 'EDS-A',
        Dispersion: '5',
        OffsetEnergy: '-100',
      },
    },
    Scan: {
      ScanSize: { width: '4', height: '4' },
      ScanArea: { left: '0', top: '0', right: scanRight, bottom: '0.5' },
    },
  }
  const encoded = new TextEncoder().encode(JSON.stringify(value, undefined, pretty ? 2 : undefined))
  const bytes = new Uint8Array(1_024)
  bytes.set(encoded)
  return bytes
}

const globalHeap = (value: Uint8Array): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(1_024)
  bytes.set([0x47, 0x43, 0x4f, 0x4c, 1])
  const view = new DataView(bytes.buffer)
  view.setBigUint64(8, BigInt(bytes.byteLength), true)
  view.setUint16(16, 1, true)
  view.setBigUint64(24, BigInt(value.byteLength), true)
  bytes.set(value, 32)
  const next = 32 + Math.ceil(value.byteLength / 8) * 8
  view.setBigUint64(next + 8, BigInt(bytes.byteLength - next), true)
  return bytes
}

export const createGeneratedVeloxSpectrumFixture = (
  options: Readonly<GeneratedVeloxSpectrumFixtureOptions> = {},
): GeneratedVeloxSpectrumFixture => {
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 32_768 })
  if (fixture.rootObjectOffset === undefined) throw new Error('Generated Velox root is unavailable')
  const version = new TextEncoder().encode('{"format":"Velox","version":"11"}')
  const denseRaw = integerBytes([1, 2, 3, 4, 5, 6, 7, 8], 4)
  const streamRaw = integerBytes(
    options.streamEvents ?? [
      1, 1, 3, 65_535, 65_535, 2, 65_535, 7, 7, 65_535, 0, 65_535, 3, 65_535, 65_535, 7, 65_535,
    ],
    2,
  )
  const metadata = jsonBytes(options.scanRight ?? '0.5', options.prettyMetadata ?? true)
  const settings = new TextEncoder().encode(
    JSON.stringify({
      encoding: options.streamEncoding ?? 'uint16',
      bincount: String(options.energyBins ?? 8),
      StreamEncoding: options.streamEncoding ?? 'uint16',
      RasterScanDefinition: { Width: '4', Height: '4' },
    }),
  )
  const settingsDescriptor = new Uint8Array(16)
  const descriptorView = new DataView(settingsDescriptor.buffer)
  descriptorView.setUint32(0, settings.byteLength, true)
  descriptorView.setBigUint64(4, globalHeapAddress, true)
  descriptorView.setUint32(12, 1, true)
  const frameRaw = uint64Bytes(options.frameOffsets ?? [0n, 10n])

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
      hardLink('Spectrum', spectrumGroupAddress),
      hardLink('SpectrumStream', streamGroupAddress),
    ]),
    Number(dataGroupAddress),
  )
  fixture.bytes.set(group([hardLink(denseId, denseEntryAddress)]), Number(spectrumGroupAddress))
  fixture.bytes.set(group([hardLink(streamId, streamEntryAddress)]), Number(streamGroupAddress))
  fixture.bytes.set(
    group([hardLink('Data', denseDataAddress), hardLink('Metadata', denseMetadataAddress)]),
    Number(denseEntryAddress),
  )
  fixture.bytes.set(
    group([
      hardLink('Data', streamDataAddress),
      hardLink('Metadata', streamMetadataAddress),
      hardLink('AcquisitionSettings', settingsAddress),
      hardLink('FrameLocationTable', frameTableAddress),
    ]),
    Number(streamEntryAddress),
  )
  fixture.bytes.set(
    dataset(
      [8n, 1n],
      createGeneratedIntegerDatatypeMessage({ byteLength: 4 }),
      contiguous(denseRawAddress, denseRaw.byteLength),
    ),
    Number(denseDataAddress),
  )
  fixture.bytes.set(
    dataset(
      [1_024n, 1n],
      createGeneratedIntegerDatatypeMessage({ byteLength: 1 }),
      contiguous(denseMetadataRawAddress, metadata.byteLength),
    ),
    Number(denseMetadataAddress),
  )
  fixture.bytes.set(
    dataset(
      [BigInt(streamRaw.byteLength / 2), 1n],
      createGeneratedIntegerDatatypeMessage({ byteLength: 2 }),
      contiguous(streamRawAddress, streamRaw.byteLength),
    ),
    Number(streamDataAddress),
  )
  fixture.bytes.set(
    dataset(
      [1_024n, 1n],
      createGeneratedIntegerDatatypeMessage({ byteLength: 1 }),
      contiguous(streamMetadataRawAddress, metadata.byteLength),
    ),
    Number(streamMetadataAddress),
  )
  fixture.bytes.set(
    dataset(
      [1n],
      createGeneratedVariableStringDatatypeMessage({
        descriptorBytes: 16,
        characterSet: 'utf-8',
      }),
      createGeneratedCompactLayoutMessage({ version: 4, dimensions: [], data: settingsDescriptor }),
    ),
    Number(settingsAddress),
  )
  fixture.bytes.set(
    dataset(
      [BigInt(frameRaw.byteLength / 8), 1n],
      createGeneratedIntegerDatatypeMessage({ byteLength: 8 }),
      contiguous(frameTableRawAddress, frameRaw.byteLength),
    ),
    Number(frameTableAddress),
  )
  fixture.bytes.set(globalHeap(settings), Number(globalHeapAddress))
  fixture.bytes.set(denseRaw, denseRawAddress)
  fixture.bytes.set(metadata, denseMetadataRawAddress)
  fixture.bytes.set(streamRaw, streamRawAddress)
  fixture.bytes.set(metadata, streamMetadataRawAddress)
  fixture.bytes.set(frameRaw, frameTableRawAddress)
  return Object.freeze({
    bytes: fixture.bytes,
    denseId,
    streamId,
    eventDataAddress: streamRawAddress,
  })
}
