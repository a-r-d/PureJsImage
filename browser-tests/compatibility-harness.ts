import {
  generatedDigitalMicrographEelsFixture,
  generatedDigitalMicrographFixture,
} from '../benchmark/digital-micrograph/generated-fixture.ts'
import {
  createGeneratedCompactLayoutMessage,
  createGeneratedDataspaceMessage,
  createGeneratedIntegerDatatypeMessage,
} from '../benchmark/hdf5/generated-dataset-fixture.ts'
import { createGeneratedHdf5Fixture } from '../benchmark/hdf5/generated-fixture.ts'
import { createGeneratedVersion2ObjectHeader } from '../benchmark/hdf5/generated-object-fixture.ts'
import { createGeneratedNcemEmdFixture } from '../benchmark/ncem-emd/generated-fixture.ts'
import {
  generatedTiaEmiObject,
  generateTiaEmiFixture,
} from '../benchmark/tia-ser/generated-emi-fixture.ts'
import {
  generatedTiaSerPointSpectrum,
  generatedTiaSerSpectrumImage,
} from '../benchmark/tia-ser/generated-fixture.ts'
import { createGeneratedVeloxEmdFixture } from '../benchmark/velox-emd/generated-fixture.ts'
import { createGeneratedVeloxSpectrumFixture } from '../benchmark/velox-emd/generated-spectrum-fixture.ts'
import { createWasmJpegAccelerator } from '../src/accelerator-entries/wasm-jpeg-browser.ts'
import { createWasmPngAccelerator } from '../src/accelerator-entries/wasm-png-browser.ts'
import { createWasmWebpAccelerator } from '../src/accelerator-entries/wasm-webp-browser.ts'
import { createWasmJpegAcceleratorWithLoaders } from '../src/accelerators/wasm/jpeg.ts'
import { createWasmPngAcceleratorWithLoaders } from '../src/accelerators/wasm/png.ts'
import { createWasmWebpAcceleratorWithLoaders } from '../src/accelerators/wasm/webp.ts'
import * as browserPublicApi from '../src/browser.ts'
import { createImageLibrary, ImageError } from '../src/browser.ts'
import { browserRuntime } from '../src/browser-runtime.ts'
import { avifCodec } from '../src/codec-entries/avif.ts'
import { bmpCodec } from '../src/codec-entries/bmp.ts'
import { experimentalHeifCodec } from '../src/codec-entries/experimental/heic.ts'
import { gifCodec } from '../src/codec-entries/gif.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { jpeg2000Codec } from '../src/codec-entries/jpeg2000.ts'
import { jpegxlCodec } from '../src/codec-entries/jpegxl.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { createTiffCodec, tiffCodec } from '../src/codec-entries/tiff.ts'
import { webpCodec } from '../src/codec-entries/webp.ts'
import { crc32 } from '../src/codecs/crc32.ts'
import { acceleratePngCodec, type PngDecodeAcceleration } from '../src/codecs/png.ts'
import { geoZarrReader } from '../src/geo/readers/geozarr/index.ts'
import { geoNetCdfReader } from '../src/geo/readers/netcdf.ts'
import { worldFileReader } from '../src/geo/readers/world-file.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { openAperioSvs } from '../src/pathology/index.ts'
import type { PixelBlock } from '../src/pixel.ts'
import { createScientificFileContext } from '../src/scientific/browser.ts'
import {
  encapsulatedUncompressedExplicitVrLittleEndianUid,
  jpegBaseline8BitUid,
  jpegLosslessSv1Uid,
} from '../src/scientific/formats/dicom/constants.ts'
import {
  decodeDicomText,
  dicomTag,
  findDicomElement,
  parseDicomPart10,
} from '../src/scientific/formats/dicom/parser.ts'
import { openHdf5File } from '../src/scientific/formats/hdf5-file.ts'
import type { Hdf5FilterPipeline } from '../src/scientific/formats/hdf5-filter-message.ts'
import { decodeHdf5ChunkFilters, hdf5Fletcher32 } from '../src/scientific/formats/hdf5-filters.ts'
import {
  inspectVeloxEmdSpectra,
  readVeloxPointSpectrum,
} from '../src/scientific/formats/velox-emd.ts'
import type {
  ScientificDataset,
  ScientificPlaneReadRequest,
  ScientificReader,
  ScientificResource,
  ScientificSeriesReadRequest,
} from '../src/scientific/index.ts'
import {
  createScientificLibrary,
  normalizeScientificDatasetDescriptor,
  normalizeScientificSeriesReadRequest,
  rasterToPixels,
  ScientificReaderRegistry,
} from '../src/scientific/index.ts'
import { blockfileReader } from '../src/scientific/readers/blockfile.ts'
import { bmpReader } from '../src/scientific/readers/bmp.ts'
import { dicomReader } from '../src/scientific/readers/dicom.ts'
import { digitalMicrographReader } from '../src/scientific/readers/digital-micrograph.ts'
import { digitalSurfReader } from '../src/scientific/readers/digital-surf.ts'
import { ebsdTextReader } from '../src/scientific/readers/ebsd-text.ts'
import { emsaReader } from '../src/scientific/readers/emsa.ts'
import { igorBinaryWaveReader } from '../src/scientific/readers/igor-binary-wave.ts'
import { jp2Reader } from '../src/scientific/readers/jp2.ts'
import { metaImageReader } from '../src/scientific/readers/meta-image.ts'
import { mibReader } from '../src/scientific/readers/mib.ts'
import { nanonisSxmReader } from '../src/scientific/readers/nanonis-sxm.ts'
import { createNcemEmdReader } from '../src/scientific/readers/ncem-emd.ts'
import { niftiReader } from '../src/scientific/readers/nifti.ts'
import { npyReader } from '../src/scientific/readers/npy.ts'
import { nrrdReader } from '../src/scientific/readers/nrrd.ts'
import { omeTiffReader } from '../src/scientific/readers/ome-tiff.ts'
import { omeZarrReader } from '../src/scientific/readers/ome-zarr.ts'
import { rplReader } from '../src/scientific/readers/rpl.ts'
import { tiaEmiReader } from '../src/scientific/readers/tia-emi.ts'
import { tiaSerReader } from '../src/scientific/readers/tia-ser.ts'
import { tiffReader } from '../src/scientific/readers/tiff.ts'
import { createVeloxEmdReader } from '../src/scientific/readers/velox-emd.ts'
import { webpReader } from '../src/scientific/readers/webp.ts'
import { x3pReader } from '../src/scientific/readers/x3p.ts'
import type { ImageSink } from '../src/sink.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import type { ImageInput } from '../src/source.ts'
import { BlobSource, MemorySource } from '../src/source.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'
import {
  encodeTiffDocument,
  geoTiffProfile,
  inspectCog,
  openTiffDocument,
} from '../src/tiff/index.ts'
import { encodeJpegLosslessGray } from '../tests/dicom/jpeg-lossless-encode.ts'
import {
  dicomDecimalBytes,
  dicomEncapsulatedFragments,
  dicomIdentityElements,
  dicomMonochromePixelElements,
  dicomTextBytes,
  writeDicomPart10,
} from '../tests/dicom/part10-writer.ts'
import { createNetCdfClassicFixture } from '../tests/helpers/netcdf-classic-fixture.ts'
import type { BrowserCompatibilityHarness, BrowserWorkflowResult } from './types.ts'

const images = createImageLibrary([
  gifCodec,
  jpegCodec,
  jpegxlCodec,
  pngCodec,
  webpCodec,
  jpeg2000Codec,
  bmpCodec,
  tiffCodec,
  avifCodec,
  experimentalHeifCodec,
])
const composedTiffImages = createImageLibrary([
  pngCodec,
  createTiffCodec({ embeddedCodecs: [webpCodec] }),
])

const wasmImages = createImageLibrary({
  codecs: [jpegCodec, pngCodec],
  accelerators: [createWasmJpegAccelerator({ minimumEncodePixels: 1, minimumPixels: 1 })],
})

const fetchBytes = async (path: string): Promise<Uint8Array<ArrayBuffer>> => {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status} ${path}`)
  return new Uint8Array(await response.arrayBuffer())
}

const dicomReaderFileSmoke = async (): Promise<BrowserWorkflowResult> => {
  const pixels = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)
  const bytes = writeDicomPart10({
    transferSyntax: 'explicit-vr-le',
    dataset: [
      ...dicomIdentityElements(),
      ...dicomMonochromePixelElements({ rows: 4, columns: 4, bitsAllocated: 8 }),
      { tag: dicomTag.rescaleIntercept, vr: 'DS', value: dicomDecimalBytes(-1024) },
      { tag: dicomTag.rescaleSlope, vr: 'DS', value: dicomDecimalBytes(1) },
      { tag: dicomTag.windowCenter, vr: 'DS', value: dicomDecimalBytes(40) },
      { tag: dicomTag.windowWidth, vr: 'DS', value: dicomDecimalBytes(80) },
      { tag: dicomTag.pixelData, vr: 'OB', value: pixels },
    ],
  })
  const file = new File([Uint8Array.from(bytes)], 'synthetic.dcm', { type: 'application/dicom' })
  const document = await createScientificLibrary({ readers: [dicomReader] }).open(
    createScientificFileContext(file, { readerId: 'purejsimage/dicom' }),
  )
  const dataset = await document.openDataset(document.datasets[0]?.id ?? '')
  const values: number[] = []
  for await (const block of dataset.readPlane({ displayAxes: ['x', 'y'], fixedIndices: [] })) {
    values.push(...block.data)
  }
  if (values.join(',') !== [...pixels].join(',')) {
    throw new Error(`Browser DICOM reader samples were ${values.join(',')}`)
  }
  const transform = document.metadata.storedValueTransform
  const presets = document.metadata.voiPresets
  const firstPreset = Array.isArray(presets) ? presets[0] : undefined
  if (
    transform === null ||
    typeof transform !== 'object' ||
    Array.isArray(transform) ||
    !('slope' in transform) ||
    !('intercept' in transform) ||
    transform.slope !== 1 ||
    transform.intercept !== -1024 ||
    firstPreset === null ||
    typeof firstPreset !== 'object' ||
    Array.isArray(firstPreset) ||
    firstPreset.center !== 40 ||
    firstPreset.width !== 80
  ) {
    throw new Error('Browser DICOM reader missing rescale or VOI metadata')
  }
  return {
    detail:
      'public DICOM reader opened an in-memory File and returned stored uint8 samples plus rescale/VOI metadata',
    outputBytes: values.length,
  }
}

const dicomEncapsulatedFileSmoke = async (): Promise<BrowserWorkflowResult> => {
  const pixels = Uint8Array.of(9, 8, 7, 6)
  const bytes = writeDicomPart10({
    transferSyntax: 'explicit-vr-le',
    transferSyntaxUid: encapsulatedUncompressedExplicitVrLittleEndianUid,
    dataset: [
      ...dicomIdentityElements(),
      ...dicomMonochromePixelElements({ rows: 2, columns: 2, bitsAllocated: 8 }),
      {
        tag: dicomTag.pixelData,
        vr: 'OB',
        fragments: dicomEncapsulatedFragments([[pixels]], 'empty'),
      },
    ],
  })
  const file = new File([Uint8Array.from(bytes)], 'encapsulated.dcm', { type: 'application/dicom' })
  const document = await createScientificLibrary({ readers: [dicomReader] }).open(
    createScientificFileContext(file, { readerId: 'purejsimage/dicom' }),
  )
  const dataset = await document.openDataset(document.datasets[0]?.id ?? '')
  const values: number[] = []
  for await (const block of dataset.readPlane({ displayAxes: ['x', 'y'], fixedIndices: [] })) {
    values.push(...block.data)
  }
  if (values.join(',') !== [...pixels].join(',')) {
    throw new Error(`Browser encapsulated DICOM samples were ${values.join(',')}`)
  }
  return {
    detail: 'public DICOM reader decoded encapsulated uncompressed File fragments',
    outputBytes: values.length,
  }
}

const dicomJpegBaselineFileSmoke = async (): Promise<BrowserWorkflowResult> => {
  const createEncoder = jpegCodec.createEncoder
  if (createEncoder === undefined) throw new Error('JPEG encoder is unavailable')
  const sink = new Uint8ArraySink()
  const encoder = await createEncoder(sink, {
    width: 4,
    height: 2,
    pixelFormat: 'gray8',
    options: { quality: 90 },
  })
  await encoder.write({
    x: 0,
    y: 0,
    width: 4,
    height: 2,
    stride: 4,
    format: 'gray8',
    data: Uint8Array.of(0, 40, 80, 120, 160, 180, 200, 220),
  })
  await encoder.finish()
  const jpeg = sink.toUint8Array()
  const bytes = writeDicomPart10({
    transferSyntax: 'explicit-vr-le',
    transferSyntaxUid: jpegBaseline8BitUid,
    dataset: [
      ...dicomIdentityElements(),
      ...dicomMonochromePixelElements({ rows: 2, columns: 4, bitsAllocated: 8 }),
      {
        tag: dicomTag.pixelData,
        vr: 'OB',
        fragments: dicomEncapsulatedFragments([[jpeg]], 'empty'),
      },
    ],
  })
  const file = new File([Uint8Array.from(bytes)], 'jpeg.dcm', { type: 'application/dicom' })
  const document = await createScientificLibrary({ readers: [dicomReader] }).open(
    createScientificFileContext(file, { readerId: 'purejsimage/dicom' }),
  )
  const dataset = await document.openDataset(document.datasets[0]?.id ?? '')
  const values: number[] = []
  for await (const block of dataset.readPlane({ displayAxes: ['x', 'y'], fixedIndices: [] })) {
    values.push(...block.data)
  }
  const createDecoder = jpegCodec.createDecoder
  if (createDecoder === undefined) throw new Error('JPEG decoder is unavailable')
  const oracleDecoder = await createDecoder(new MemorySource(jpeg), {
    maxWidth: 8,
    maxHeight: 8,
    maxPixels: 64,
    maxInputBytes: jpeg.byteLength,
    maxFrames: 1,
    maxDecodedBytes: 256,
  })
  const oracle: number[] = []
  for await (const block of oracleDecoder.decode()) {
    for (let row = 0; row < block.height; row += 1) {
      for (let column = 0; column < block.width; column += 1) {
        oracle.push(block.data[row * block.stride + column * 3] ?? 0)
      }
    }
  }
  if (values.length !== oracle.length) {
    throw new Error(`Browser JPEG Baseline DICOM sample count was ${values.length}`)
  }
  for (let index = 0; index < values.length; index += 1) {
    if (Math.abs((values[index] ?? 0) - (oracle[index] ?? 0)) > 1) {
      throw new Error(
        `Browser JPEG Baseline DICOM samples ${values.join(',')} exceeded lossy tolerance versus ${oracle.join(',')}`,
      )
    }
  }
  return {
    detail: 'public DICOM reader decoded JPEG Baseline 8-bit File fragments within lossy tolerance',
    outputBytes: values.length,
  }
}

const dicomJpegLosslessFileSmoke = async (): Promise<BrowserWorkflowResult> => {
  const samples = [0, 32, 64, 96, 128, 160, 192, 224]
  const jpeg = encodeJpegLosslessGray(4, 2, samples)
  const bytes = writeDicomPart10({
    transferSyntax: 'explicit-vr-le',
    transferSyntaxUid: jpegLosslessSv1Uid,
    dataset: [
      ...dicomIdentityElements(),
      ...dicomMonochromePixelElements({ rows: 2, columns: 4, bitsAllocated: 8 }),
      {
        tag: dicomTag.pixelData,
        vr: 'OB',
        fragments: dicomEncapsulatedFragments([[jpeg]], 'empty'),
      },
    ],
  })
  const file = new File([Uint8Array.from(bytes)], 'jpeg-lossless.dcm', {
    type: 'application/dicom',
  })
  const document = await createScientificLibrary({ readers: [dicomReader] }).open(
    createScientificFileContext(file, { readerId: 'purejsimage/dicom' }),
  )
  const dataset = await document.openDataset(document.datasets[0]?.id ?? '')
  const values: number[] = []
  for await (const block of dataset.readPlane({ displayAxes: ['x', 'y'], fixedIndices: [] })) {
    values.push(...block.data)
  }
  if (values.join(',') !== samples.join(',')) {
    throw new Error(`Browser JPEG Lossless DICOM samples were ${values.join(',')}`)
  }
  return {
    detail: 'public DICOM reader decoded JPEG Lossless SV1 File fragments',
    outputBytes: values.length,
  }
}

const dicomParserFileSmoke = async (): Promise<BrowserWorkflowResult> => {
  const bytes = writeDicomPart10({
    transferSyntax: 'explicit-vr-le',
    dataset: [
      ...dicomIdentityElements(),
      { tag: dicomTag.modality, vr: 'CS', value: dicomTextBytes('OT') },
      ...dicomMonochromePixelElements({ rows: 4, columns: 4, bitsAllocated: 16 }),
      { tag: dicomTag.pixelData, vr: 'OW', value: new Uint8Array(32).fill(0xab) },
    ],
  })
  const file = new File([Uint8Array.from(bytes)], 'synthetic.dcm', { type: 'application/dicom' })
  const parsed = await parseDicomPart10(new BlobSource(file))
  const modality = decodeDicomText(
    findDicomElement(parsed.dataset.elements, dicomTag.modality)?.value ?? new Uint8Array(),
  )
  if (parsed.transferSyntaxUid !== '1.2.840.10008.1.2.1' || modality !== 'OT') {
    throw new Error(`Browser DICOM parser returned ${parsed.transferSyntaxUid} / ${modality}`)
  }
  if (parsed.pixelData?.valueLength !== 32 || parsed.stats.sourceBytesRead >= bytes.byteLength) {
    throw new Error('Browser DICOM parser read Pixel Data while parsing metadata')
  }
  return {
    detail: 'package-private DICOM parser read an in-memory File without Pixel Data payload reads',
    outputBytes: parsed.stats.sourceBytesRead,
  }
}

const hdf5Filters = async (): Promise<BrowserWorkflowResult> => {
  const raw = new Uint8Array(64)
  const view = new DataView(raw.buffer)
  for (let index = 0; index < 16; index += 1) view.setInt32(index * 4, index * 7 - 20, true)
  const shuffled = new Uint8Array(raw.byteLength)
  for (let byte = 0; byte < 4; byte += 1) {
    for (let element = 0; element < 16; element += 1) {
      shuffled[byte * 16 + element] = raw[element * 4 + byte] ?? 0
    }
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([shuffled]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  )
  const encoded = new Uint8Array(compressed.byteLength + 4)
  encoded.set(compressed)
  new DataView(encoded.buffer).setUint32(compressed.byteLength, hdf5Fletcher32(compressed), true)
  const pipeline: Hdf5FilterPipeline = Object.freeze({
    version: 2,
    filters: Object.freeze([
      Object.freeze({ id: 2, optional: false, name: undefined, clientData: Object.freeze([4]) }),
      Object.freeze({ id: 1, optional: false, name: undefined, clientData: Object.freeze([6]) }),
      Object.freeze({ id: 3, optional: false, name: undefined, clientData: Object.freeze([]) }),
    ]),
  })
  const decoded = await decodeHdf5ChunkFilters(encoded, raw.byteLength, 4, pipeline, 0, {
    objectPath: '/browser-filter-test',
    maxDecodedChunkBytes: raw.byteLength,
    maxFilterScratchBytes: raw.byteLength,
  })
  if (decoded.some((value, index) => value !== raw[index])) {
    throw new Error('Browser HDF5 filter output did not match the input')
  }
  return {
    detail: 'portable HDF5 Fletcher32, Deflate, and Shuffle filters decoded in reverse order',
    outputBytes: decoded.byteLength,
  }
}

const hdf5DatasetBlocks = async (): Promise<BrowserWorkflowResult> => {
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 1_024 })
  if (fixture.rootObjectOffset === undefined) throw new Error('Browser HDF5 root is unavailable')
  const raw = new Uint8Array(12)
  const rawView = new DataView(raw.buffer)
  for (let index = 0; index < 6; index += 1) rawView.setUint16(index * 2, index, true)
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([
      {
        type: 0x0001,
        data: createGeneratedDataspaceMessage({
          version: 2,
          lengthSize: 8,
          dimensions: [2n, 3n],
        }),
      },
      { type: 0x0003, data: createGeneratedIntegerDatatypeMessage({ byteLength: 2 }) },
      {
        type: 0x0008,
        data: createGeneratedCompactLayoutMessage({ version: 4, dimensions: [], data: raw }),
      },
    ]),
    fixture.rootObjectOffset,
  )
  const file = await openHdf5File(new MemorySource(fixture.bytes))
  const values: number[] = []
  let outputBytes = 0
  for await (const block of file.readDataset('/', { start: [0, 1], shape: [2, 2] })) {
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let offset = 0; offset < block.data.byteLength; offset += 2) {
      values.push(view.getUint16(offset, true))
    }
    outputBytes += block.data.byteLength
  }
  file.close()
  if (values.join(',') !== '1,2,4,5') {
    throw new Error(`Browser HDF5 selection returned ${values.join(',')}`)
  }
  return {
    detail: 'package-private HDF5 file API returned exact compact selection blocks',
    outputBytes,
  }
}

const hdf5NcemEmd = async (): Promise<BrowserWorkflowResult> => {
  const fixture = createGeneratedNcemEmdFixture({ acquisitionMetadata: true })
  const document = await createNcemEmdReader().open({
    primary: { id: 'browser-ncem-emd', source: new MemorySource(fixture.bytes) },
  })
  const summary = document.datasets[0]
  const firstDimension = summary?.descriptor.axes[0]
  const dataset = await document.openDataset('/data/image')
  const samples: number[] = []
  for await (const block of dataset.readPlane({
    displayAxes: ['dim2', 'dim1'],
    fixedIndices: [],
    x: 1,
    y: 1,
    width: 2,
    height: 1,
  })) {
    samples.push(...block.data)
  }
  document.close?.()
  if (
    summary?.id !== '/data/image' ||
    summary.descriptor.axes.map(({ length }) => length).join(',') !== '3,4' ||
    firstDimension?.name !== 'Position Y' ||
    firstDimension.unit !== '[n_m]' ||
    firstDimension.coordinates.type !== 'linear' ||
    firstDimension.coordinates.step !== 0.5 ||
    document.metadata.acquisition === undefined ||
    samples.join(',') !== '0,6,0,7'
  ) {
    throw new Error('Browser NCEM EMD scientific dataset did not match the fixture')
  }
  return {
    detail:
      'public NCEM EMD 0.2 scientific dataset, calibration, acquisition metadata, and bounded region reads passed in-browser',
    outputBytes: samples.length,
  }
}

const hdf5VeloxEmd = async (): Promise<BrowserWorkflowResult> => {
  const fixture = createGeneratedVeloxEmdFixture({ variant: 'fft', metadataBytes: 131_072 })
  const document = await createVeloxEmdReader().open({
    primary: { id: 'browser-velox-emd', source: new MemorySource(fixture.bytes) },
  })
  const summary = document.datasets[0]
  const dataset = await document.openDataset(fixture.datasetId ?? '')
  const samples: number[] = []
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [{ axisId: 'frame', index: 0 }],
    width: 1,
    height: 1,
  })) {
    samples.push(...block.data)
  }
  document.close?.()
  const frequencyDomain = summary?.descriptor.metadata?.veloxEmd
  if (
    summary?.name !== 'Generated detector' ||
    summary.descriptor.sampleType !== 'float32' ||
    summary.descriptor.components.length !== 2 ||
    !frequencyDomain ||
    samples.join(',') !== '62,128,0,0,191,0,0,0'
  ) {
    throw new Error('Browser Velox EMD scientific dataset did not match the fixture')
  }
  return {
    detail:
      'public Velox EMD complex FFT dataset, 128 KiB per-frame metadata, and bounded native samples passed in-browser',
    outputBytes: samples.length,
  }
}

const hdf5VeloxSpectrum = async (): Promise<BrowserWorkflowResult> => {
  const fixture = createGeneratedVeloxSpectrumFixture()
  const file = await openHdf5File(new MemorySource(fixture.bytes))
  const inspection = await inspectVeloxEmdSpectra(file)
  const stream = inspection.spectrumStreams[0]
  if (stream === undefined) throw new Error('Browser Velox EMD spectrum stream is missing')
  const point = await readVeloxPointSpectrum(file, stream, {
    frame: 0,
    x: 0,
    y: 0,
    start: 1,
    length: 3,
    maxEventBlockEvents: 2,
  })
  file.close()
  if (
    inspection.denseSpectra.length !== 1 ||
    stream.energyBins !== 8 ||
    stream.width !== 2 ||
    stream.height !== 2 ||
    stream.frameOffsets.join(',') !== '0,10' ||
    point.scannedEvents !== 4 ||
    point.eventReadOperations !== 2 ||
    point.data.join(',') !== '0,0,0,2,0,0,0,0,0,0,0,1'
  ) {
    throw new Error('Browser Velox EMD point spectrum did not match the fixture')
  }
  return {
    detail: 'package-private Velox EMD sparse point spectrum stayed bounded in-browser',
    outputBytes: point.data.byteLength,
  }
}

const jpegXlLocalTreeRgb = Uint8Array.from(
  `ff0a205010090804010038018924512a542005921b638c318c3118610c638c8e
   113118ea82ddb7d06ab724b9774aaa2eb3aaaacaaeaaaa02aaabaa5af4a92ec252c1a1
   ec2d0bb13477a92f68611ffadbb639a13d214aa900e305`
    .replaceAll(/\s/g, '')
    .match(/../g) ?? [],
  (pair) => Number.parseInt(pair, 16),
)
const instantiateWasm = async (path: string): Promise<WebAssembly.Instance> => {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`WASM request failed: ${response.status} ${path}`)
  const result = await WebAssembly.instantiate(await response.arrayBuffer())
  return result.instance
}

const outputMetadata = async (bytes: Uint8Array) => (await images.open(bytes)).metadata()

const optionalApiEntries = async (): Promise<BrowserWorkflowResult> => {
  const specializedNames = [
    'aperioSvsProfile',
    'geoTiffProfile',
    'HttpRangeSource',
    'isAperioSvs',
    'isOmeTiff',
    'omeTiffProfile',
    'openAperioSvs',
    'openOmeTiff',
    'rasterSampleBytes',
    'rasterToPixels',
  ] as const
  const retained = specializedNames.filter((name) => name in browserPublicApi)
  if (retained.length > 0) {
    throw new Error(`Browser root retained optional exports: ${retained.join(', ')}`)
  }
  if (
    typeof openAperioSvs !== 'function' ||
    typeof omeTiffReader.open !== 'function' ||
    typeof rasterToPixels !== 'function' ||
    typeof HttpRangeSource.open !== 'function' ||
    geoTiffProfile.id !== 'geotiff'
  ) {
    throw new Error('An explicit optional browser entry is unavailable')
  }
  return {
    outputBytes: 0,
    detail: 'optional scientific, pathology, TIFF, and HTTP entries are explicit',
  }
}

const scientificOneDimensionalSeries = async (): Promise<BrowserWorkflowResult> => {
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: [
      {
        id: 'energy',
        kind: 'spectral',
        length: 5,
        unit: 'eV',
        coordinates: { type: 'linear', origin: 100, step: 0.5 },
      },
    ],
    sampleType: 'uint16',
    components: [{ id: 'intensity', kind: 'intensity', unit: 'counts' }],
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'none' },
      seriesReads: { kind: 'axes', axes: ['energy'] },
    },
  })
  const dataset: ScientificDataset = {
    descriptor,
    readPlane(_request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<never> {
      throw new Error('One-dimensional browser fixture does not support plane reads')
    },
    async *readSeries(request: Readonly<ScientificSeriesReadRequest>) {
      const normalized = normalizeScientificSeriesReadRequest(descriptor, request)
      const data = new Uint8Array(normalized.length * 2)
      const view = new DataView(data.buffer)
      for (let index = 0; index < normalized.length; index += 1) {
        view.setUint16(index * 2, normalized.start + index + 1, false)
      }
      yield {
        start: normalized.start,
        length: normalized.length,
        format: { sampleType: 'uint16', channels: 1, planar: false },
        data,
      }
    },
  }
  if (dataset.readSeries === undefined) throw new Error('Browser series reader is unavailable')
  let output: Uint8Array | undefined
  for await (const block of dataset.readSeries({
    axisId: 'energy',
    fixedIndices: [],
    start: 1,
    length: 3,
  })) {
    if (block.start !== 1 || block.length !== 3) {
      throw new Error('Browser series reader returned an invalid one-dimensional block')
    }
    output = block.data
  }
  if (output === undefined || output.join(',') !== '0,2,0,3,0,4') {
    throw new Error('Browser series reader returned unexpected uint16 values')
  }
  return {
    detail: 'one-dimensional energy series used one true axis and a bounded series block',
    outputBytes: output.byteLength,
  }
}

const scientificOrdinaryCodecFallbacks = async (): Promise<BrowserWorkflowResult> => {
  const png = await fetchBytes('/fixtures/webp-graphic.png')
  const [webp, bmp, jp2] = await Promise.all([
    (await images.open(png)).webp({ lossless: true }).toUint8Array(),
    (await images.open(png)).bmp().toUint8Array(),
    fetchBytes('/fixtures/openjpeg-lossless-rgb16.jp2'),
  ])
  const cases = [
    { reader: webpReader, bytes: webp, name: 'ordinary.webp', width: 192, height: 128 },
    { reader: bmpReader, bytes: bmp, name: 'ordinary.bmp', width: 192, height: 128 },
    { reader: jp2Reader, bytes: jp2, name: 'ordinary.jp2', width: 17, height: 13 },
  ] as const
  let outputBytes = 0
  for (const fixture of cases) {
    const document = await createScientificLibrary({ readers: [fixture.reader] }).open({
      primary: { id: fixture.name, name: fixture.name, source: new MemorySource(fixture.bytes) },
    })
    const summary = document.datasets[0]
    if (
      summary?.descriptor.axes[0]?.length !== fixture.width ||
      summary.descriptor.axes[1]?.length !== fixture.height
    ) {
      throw new Error(`${fixture.name} scientific fallback dimensions are incorrect`)
    }
    const dataset = await document.openDataset(summary.id)
    for await (const block of dataset.readPlane({ displayAxes: ['x', 'y'], fixedIndices: [] })) {
      outputBytes += block.data.byteLength
      block.release?.()
    }
  }
  return {
    detail: 'portable WebP, BMP, and JP2 low-confidence scientific fallbacks decoded in-browser',
    outputBytes,
  }
}
const inputTypes = async (): Promise<readonly BrowserWorkflowResult[]> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  const inputs: readonly (readonly [string, ImageInput])[] = [
    ['File', new File([bytes], 'browser-input.png', { type: 'image/png' })],
    ['Blob', new Blob([bytes], { type: 'image/png' })],
    ['ArrayBuffer', Uint8Array.from(bytes).buffer],
    ['Uint8Array', Uint8Array.from(bytes)],
  ]
  const results: BrowserWorkflowResult[] = []
  for (const [name, input] of inputs) {
    const image = await images.open(input)
    const metadata = await image.metadata()
    if (metadata.format !== 'png' || metadata.width !== 640 || metadata.height !== 480) {
      throw new Error(
        `${name} metadata was ${metadata.format} ${metadata.width}x${metadata.height}`,
      )
    }
    const output = await image.resize({ width: 64 }).png().toUint8Array()
    const outputInfo = await outputMetadata(output)
    if (outputInfo.width !== 64 || outputInfo.height !== 48) {
      throw new Error(`${name} output was ${outputInfo.width}x${outputInfo.height}`)
    }
    results.push({
      detail: `${name}: PNG 640x480 -> 64x48 Uint8Array`,
      outputBytes: output.byteLength,
    })
  }

  const blob = await (await images.open(new Blob([bytes]))).resize({ width: 80 }).jpeg().toBlob()
  if (blob.type !== 'image/jpeg' || blob.size === 0) throw new Error('toBlob() did not emit JPEG')
  results.push({ detail: `toBlob(): ${blob.type}`, outputBytes: blob.size })
  return results
}
const resizeDefaultKernel = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  const [defaultOutput, lanczosOutput, bilinearOutput] = await Promise.all([
    (await images.open(bytes)).resize({ width: 64 }).png().toUint8Array(),
    (await images.open(bytes)).resize({ width: 64, kernel: 'lanczos3' }).png().toUint8Array(),
    (await images.open(bytes)).resize({ width: 64, kernel: 'bilinear' }).png().toUint8Array(),
  ])
  if (
    defaultOutput.byteLength !== lanczosOutput.byteLength ||
    defaultOutput.some((value, offset) => value !== lanczosOutput[offset])
  ) {
    throw new Error('Default browser resize output did not match explicit Lanczos3 output')
  }
  if (
    defaultOutput.byteLength === bilinearOutput.byteLength &&
    defaultOutput.every((value, offset) => value === bilinearOutput[offset])
  ) {
    throw new Error('Default browser resize output still matched bilinear output')
  }
  return {
    detail: 'default browser resize matched explicit Lanczos3 and differed from bilinear',
    outputBytes: defaultOutput.byteLength,
  }
}

const jpegPipeline = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.jpg')
  const image = await images.open(new File([bytes], 'input.jpg', { type: 'image/jpeg' }))
  const metadata = await image.metadata()
  if (metadata.format !== 'jpeg' || metadata.width !== 640 || metadata.height !== 480) {
    throw new Error(`JPEG metadata was ${metadata.format} ${metadata.width}x${metadata.height}`)
  }
  const output = await image
    .crop({ x: 80, y: 40, width: 480, height: 400 })
    .resize({ width: 120 })
    .rotate(90)
    .jpeg({ quality: 82 })
    .toBlob()
  const result = await (await images.open(output)).metadata()
  if (result.format !== 'jpeg' || result.width !== 100 || result.height !== 120) {
    throw new Error(`JPEG pipeline output was ${result.format} ${result.width}x${result.height}`)
  }
  return {
    detail: 'JPEG crop + resize + rotate + JPEG encode -> 100x120',
    outputBytes: output.size,
  }
}

const jpegXlLossless = async (): Promise<BrowserWorkflowResult> => {
  const input = new Blob([jpegXlLocalTreeRgb], { type: 'image/jxl' })
  const image = await images.open(input)
  const metadata = await image.metadata()
  if (
    metadata.format !== 'jpegxl' ||
    metadata.width !== 8 ||
    metadata.height !== 5 ||
    metadata.hasAlpha
  ) {
    throw new Error('Browser JPEG XL metadata did not match the pinned RGB fixture')
  }

  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(jpegXlLocalTreeRgb),
    defaultImageLimits,
  )
  if (!decoder) throw new Error('Browser JPEG XL decoder is unavailable')
  const cropped: number[] = []
  for await (const block of decoder.decode({ x: 2, y: 1, width: 3, height: 2 })) {
    cropped.push(...block.data)
  }
  const expected = [
    43, 43, 65, 255, 60, 50, 96, 255, 77, 57, 127, 255, 52, 72, 68, 255, 69, 79, 99, 255, 86, 86,
    130, 255,
  ]
  if (
    cropped.length !== expected.length ||
    cropped.some((value, index) => value !== expected[index])
  ) {
    throw new Error('Browser JPEG XL crop did not match the djxl pixel oracle')
  }

  const output = await image.crop({ x: 2, y: 1, width: 3, height: 2 }).png().toUint8Array()
  return {
    detail: 'lossless JPEG XL local-tree ANS decode matched djxl RGB pixels',
    outputBytes: output.byteLength,
  }
}
const jpegXlHighBit = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/jpegxl-alpha-12bit.jxl')
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
  if (!decoder) throw new Error('Browser JPEG XL decoder is unavailable')
  const cropped: number[] = []
  let displayWhite = -1
  for await (const block of decoder.decode({ x: 0, y: 0, width: 2, height: 1 })) {
    if (block.format !== 'rgba16') {
      throw new Error(`Browser JPEG XL native output was ${block.format}, not rgba16`)
    }
    displayWhite = block.displayRanges?.[0]?.white ?? -1
    cropped.push(...block.data)
  }
  const expected = [0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 4, 0, 4, 0, 0]
  if (
    displayWhite !== 4_095 ||
    cropped.length !== expected.length ||
    cropped.some((value, index) => value !== expected[index])
  ) {
    throw new Error('Browser JPEG XL native 12-bit samples did not match the conformance oracle')
  }
  const output = await (await images.open(bytes))
    .crop({ x: 0, y: 0, width: 2, height: 1 })
    .png()
    .toUint8Array()
  return {
    detail: 'lossless JPEG XL preserved native 12-bit RGBA samples and normalized through PNG',
    outputBytes: output.byteLength,
  }
}
const jpegXlMultiGroup = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/jpegxl-permuted-large-gray8.jxl')
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
  if (!decoder) throw new Error('Browser JPEG XL decoder is unavailable')
  let rows = 0
  let outputBytes = 0
  for await (const block of decoder.decode({ x: 2_030, y: 2_040, width: 64, height: 64 })) {
    if (
      block.format !== 'gray8' ||
      block.x !== 0 ||
      block.y !== rows ||
      block.width !== 64 ||
      block.height !== 1
    ) {
      throw new Error('Browser JPEG XL multi-group crop geometry is inconsistent')
    }
    for (let x = 0; x < block.width; x += 1) {
      const expected = ((2_030 + x) * 3 + (2_040 + rows) * 5) & 255
      if (block.data[x] !== expected) {
        throw new Error(`Browser JPEG XL multi-group sample ${x},${rows} is incorrect`)
      }
    }
    rows += 1
    outputBytes += block.data.byteLength
  }
  if (rows !== 64) throw new Error(`Browser JPEG XL multi-group crop emitted ${rows} rows`)
  return {
    detail: 'lossless JPEG XL crop crossed four permuted Modular group boundaries',
    outputBytes,
  }
}
const unsupportedJpegBoundaries = async (): Promise<BrowserWorkflowResult> => {
  const source = await fetchBytes('/fixtures/benchmark-input.jpg')
  let frame = -1
  for (let offset = 0; offset + 4 < source.byteLength; offset += 1) {
    if (source[offset] === 0xff && source[offset + 1] === 0xc0) {
      frame = offset
      break
    }
  }
  if (frame < 0) throw new Error('Browser JPEG fixture is missing SOF0')

  const arithmetic = Uint8Array.from(source)
  arithmetic[frame + 1] = 0xc9
  const twelveBit = Uint8Array.from(source)
  twelveBit[frame + 4] = 12
  for (const [input, message] of [
    [arithmetic, 'Arithmetic-coded JPEG images are unsupported'],
    [twelveBit, '12-bit JPEG samples are unsupported'],
  ] as const) {
    try {
      await (await images.open(input)).png().toUint8Array()
      throw new Error(`Browser JPEG decode accepted: ${message}`)
    } catch (error) {
      if (
        !(error instanceof ImageError) ||
        error.code !== 'UNSUPPORTED_OPERATION' ||
        error.message !== message
      ) {
        throw error
      }
    }
  }
  const png = await fetchBytes('/fixtures/benchmark-input.png')
  const encoded = await (await images.open(png)).jpeg({ quality: 80 }).toUint8Array()
  const reference = await (await images.open(encoded)).png().toUint8Array()
  let motionJpeg = Uint8Array.from(encoded)
  const huffmanSegments: number[] = []
  for (let offset = 0; offset + 3 < motionJpeg.byteLength; offset += 1) {
    if (motionJpeg[offset] === 0xff && motionJpeg[offset + 1] === 0xc4) {
      huffmanSegments.push(offset)
    }
  }
  for (let index = huffmanSegments.length - 1; index >= 0; index -= 1) {
    const offset = huffmanSegments[index]
    if (offset === undefined) continue
    const length = ((motionJpeg[offset + 2] ?? 0) << 8) | (motionJpeg[offset + 3] ?? 0)
    const end = offset + 2 + length
    const next = new Uint8Array(motionJpeg.byteLength - (end - offset))
    next.set(motionJpeg.subarray(0, offset))
    next.set(motionJpeg.subarray(end), offset)
    motionJpeg = next
  }
  let application = -1
  for (let offset = 0; offset + 7 < motionJpeg.byteLength; offset += 1) {
    if (motionJpeg[offset] === 0xff && motionJpeg[offset + 1] === 0xe0) {
      application = offset
      break
    }
  }
  if (application < 0) throw new Error('Browser JPEG encoder did not write APP0')
  motionJpeg.set([0x41, 0x56, 0x49, 0x31], application + 4)
  const recovered = await (await images.open(motionJpeg)).png().toUint8Array()
  if (
    recovered.byteLength !== reference.byteLength ||
    recovered.some((value, offset) => value !== reference[offset])
  ) {
    throw new Error('Browser AVI1/MJPEG default Huffman tables changed decoded pixels')
  }

  return {
    detail:
      'arithmetic-coded and 12-bit JPEG returned UNSUPPORTED_OPERATION; AVI1/MJPEG default Huffman tables matched the explicit-table decode',
    outputBytes: recovered.byteLength,
  }
}

const tolerantJpegRestartRecovery = async (): Promise<BrowserWorkflowResult> => {
  const source = await fetchBytes('/fixtures/benchmark-input.png')
  const encoded = await (await images.open(source))
    .jpeg({ quality: 82, restartInterval: 3 })
    .toUint8Array()
  let restartMarkers = 0
  let corruptOffset = -1
  for (let offset = 0; offset + 1 < encoded.byteLength; offset += 1) {
    const marker = encoded[offset + 1] ?? 0
    if (encoded[offset] !== 0xff || marker < 0xd0 || marker > 0xd7) continue
    restartMarkers += 1
    if (restartMarkers === 2) {
      corruptOffset = offset + 1
      break
    }
  }
  if (corruptOffset < 0) throw new Error('Browser JPEG restart fixture is incomplete')
  const corrupted = Uint8Array.from(encoded)
  corrupted[corruptOffset] = 0xd7

  try {
    await (await wasmImages.open(corrupted, { tolerantDecoding: false })).png().toUint8Array()
    throw new Error('Strict browser JPEG decode accepted an out-of-order restart marker')
  } catch (error) {
    if (!(error instanceof ImageError) || error.message !== 'Expected JPEG restart marker 1') {
      throw error
    }
  }
  const [reference, output] = await Promise.all([
    (await images.open(corrupted)).png().toUint8Array(),
    (await wasmImages.open(corrupted)).png().toUint8Array(),
  ])
  if (reference.byteLength !== output.byteLength) {
    throw new Error('Tolerant WASM JPEG output length differs from the TypeScript reference')
  }
  for (let offset = 0; offset < reference.byteLength; offset += 1) {
    if (reference[offset] !== output[offset]) {
      throw new Error(`Tolerant WASM JPEG output differs at byte ${offset}`)
    }
  }
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 640 || metadata.height !== 480) {
    throw new Error(
      `Default JPEG recovery output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  return {
    detail: 'default tolerant Rust/WASM JPEG restart recovery matched TypeScript at 640x480',
    outputBytes: output.byteLength,
  }
}

const wasmJpeg = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.jpg')
  const [reference, accelerated] = await Promise.all([
    (await images.open(bytes)).png().toUint8Array(),
    (await wasmImages.open(bytes)).png().toUint8Array(),
  ])
  if (reference.byteLength !== accelerated.byteLength) {
    throw new Error('WASM JPEG output length differs from the TypeScript reference')
  }
  for (let offset = 0; offset < reference.byteLength; offset += 1) {
    if (reference[offset] !== accelerated[offset]) {
      throw new Error(`WASM JPEG output differs at byte ${offset}`)
    }
  }
  return {
    detail: 'Rust/WASM baseline JPEG decode matched the TypeScript reference in the browser',
    outputBytes: accelerated.byteLength,
  }
}
const wasmJpegEncode = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  let scalarLoads = 0
  let simdLoads = 0
  const scalarImages = createImageLibrary({
    codecs: [jpegCodec, pngCodec],
    accelerators: [
      createWasmJpegAcceleratorWithLoaders(
        {
          encoder: async () => {
            scalarLoads += 1
            return instantiateWasm('/jpeg-encoder.wasm')
          },
        },
        { minimumEncodePixels: 1 },
      ),
    ],
  })
  const selectedImages = createImageLibrary({
    codecs: [jpegCodec, pngCodec],
    accelerators: [
      createWasmJpegAcceleratorWithLoaders(
        {
          encoder: async () => {
            scalarLoads += 1
            return instantiateWasm('/jpeg-encoder.wasm')
          },
          simdEncoder: async () => {
            simdLoads += 1
            return instantiateWasm('/jpeg-encoder-simd.wasm')
          },
        },
        { minimumEncodePixels: 1 },
      ),
    ],
  })
  const options = { chromaSubsampling: '420' as const, quality: 84 }
  const [reference, scalar, selected] = await Promise.all([
    (await images.open(bytes)).jpeg(options).toUint8Array(),
    (await scalarImages.open(bytes)).jpeg(options).toUint8Array(),
    (await selectedImages.open(bytes)).jpeg(options).toUint8Array(),
  ])
  if (scalarLoads !== 1 || simdLoads !== 1) {
    throw new Error(`WASM JPEG encoder selection loaded scalar=${scalarLoads}, SIMD=${simdLoads}`)
  }
  if (reference.byteLength !== scalar.byteLength) {
    throw new Error('Scalar WASM JPEG output length differs from the TypeScript reference')
  }
  for (let offset = 0; offset < reference.byteLength; offset += 1) {
    if (reference[offset] !== scalar[offset]) {
      throw new Error(`Scalar WASM JPEG output differs at byte ${offset}`)
    }
  }
  const sizeDifference = Math.abs(selected.byteLength - reference.byteLength) / reference.byteLength
  if (sizeDifference > 0.01) {
    throw new Error(`SIMD WASM JPEG output size differs by ${(sizeDifference * 100).toFixed(2)}%`)
  }
  const metadata = await outputMetadata(selected)
  if (metadata.format !== 'jpeg' || metadata.width < 1 || metadata.height < 1) {
    throw new Error('SIMD WASM JPEG output metadata is invalid')
  }
  return {
    detail: 'SIMD selection and scalar JPEG encoder fallback passed in the browser',
    outputBytes: selected.byteLength,
  }
}
const wasmPng = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  let scalarDecoderLoads = 0
  let scalarEncoderLoads = 0
  let unavailableSimdDecoderLoads = 0
  let unavailableSimdEncoderLoads = 0
  let selectedSimdDecoderLoads = 0
  let selectedSimdEncoderLoads = 0
  let selectedScalarDecoderLoads = 0
  let selectedScalarEncoderLoads = 0
  const publicImages = createImageLibrary({
    codecs: [pngCodec],
    accelerators: [createWasmPngAccelerator({ minimumEncodePixels: 1, minimumPixels: 1 })],
  })
  const scalarFallbackImages = createImageLibrary({
    codecs: [pngCodec],
    accelerators: [
      createWasmPngAcceleratorWithLoaders(
        {
          decoder: async () => {
            scalarDecoderLoads += 1
            return instantiateWasm('/png-codec.wasm')
          },
          simdDecoder: async () => {
            unavailableSimdDecoderLoads += 1
            throw new Error('simulated unavailable SIMD PNG decoder')
          },
          encoder: async () => {
            scalarEncoderLoads += 1
            return instantiateWasm('/png-codec.wasm')
          },
          simdEncoder: async () => {
            unavailableSimdEncoderLoads += 1
            throw new Error('simulated unavailable SIMD PNG encoder')
          },
        },
        { minimumEncodePixels: 1, minimumPixels: 1 },
      ),
    ],
  })
  const simdImages = createImageLibrary({
    codecs: [pngCodec],
    accelerators: [
      createWasmPngAcceleratorWithLoaders(
        {
          decoder: async () => {
            selectedScalarDecoderLoads += 1
            return instantiateWasm('/png-codec.wasm')
          },
          simdDecoder: async () => {
            selectedSimdDecoderLoads += 1
            return instantiateWasm('/png-codec-simd.wasm')
          },
          encoder: async () => {
            selectedScalarEncoderLoads += 1
            return instantiateWasm('/png-codec.wasm')
          },
          simdEncoder: async () => {
            selectedSimdEncoderLoads += 1
            return instantiateWasm('/png-codec-simd.wasm')
          },
        },
        { minimumEncodePixels: 1, minimumPixels: 1 },
      ),
    ],
  })
  const failedDecode: PngDecodeAcceleration = {
    async decode() {
      throw new Error('simulated PNG WASM decode failure')
    },
  }
  const typescriptFallbackImages = createImageLibrary([acceleratePngCodec(pngCodec, failedDecode)])
  const [reference, publicOutput, scalarFallback, simd, typescriptFallback] = await Promise.all([
    (await images.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await publicImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await scalarFallbackImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await simdImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await typescriptFallbackImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
  ])
  const assertExact = (label: string, actual: Uint8Array): void => {
    if (reference.byteLength !== actual.byteLength) {
      throw new Error(`${label} PNG output length differs from the TypeScript reference`)
    }
    for (let offset = 0; offset < reference.byteLength; offset += 1) {
      if (reference[offset] !== actual[offset]) {
        throw new Error(`${label} PNG output differs at byte ${offset}`)
      }
    }
  }
  assertExact('Public Rust/WASM', publicOutput)
  assertExact('Scalar fallback Rust/WASM', scalarFallback)
  assertExact('SIMD Rust/WASM', simd)
  assertExact('TypeScript decode fallback', typescriptFallback)
  if (
    unavailableSimdDecoderLoads !== 1 ||
    unavailableSimdEncoderLoads !== 1 ||
    scalarDecoderLoads !== 1 ||
    scalarEncoderLoads !== 1
  ) {
    throw new Error(
      `PNG scalar fallback loaded SIMD decode=${unavailableSimdDecoderLoads}, SIMD encode=${unavailableSimdEncoderLoads}, scalar decode=${scalarDecoderLoads}, scalar encode=${scalarEncoderLoads}`,
    )
  }
  if (
    selectedSimdDecoderLoads !== 1 ||
    selectedSimdEncoderLoads !== 1 ||
    selectedScalarDecoderLoads !== 0 ||
    selectedScalarEncoderLoads !== 0
  ) {
    throw new Error(
      `PNG SIMD selection loaded SIMD decoder=${selectedSimdDecoderLoads}, SIMD encoder=${selectedSimdEncoderLoads}, scalar decoder=${selectedScalarDecoderLoads}, scalar encoder=${selectedScalarEncoderLoads}`,
    )
  }
  return {
    detail:
      'SIMD selection plus scalar and TypeScript PNG decode fallback matched exact public output',
    outputBytes: simd.byteLength,
  }
}

const wasmWebp = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  let scalarLoads = 0
  let simdLoads = 0
  let selectedScalarLoads = 0
  const publicImages = createImageLibrary({
    codecs: [pngCodec, webpCodec],
    accelerators: [createWasmWebpAccelerator({ minimumEncodePixels: 1, minimumPixels: 1 })],
  })
  const scalarImages = createImageLibrary({
    codecs: [pngCodec, webpCodec],
    accelerators: [
      createWasmWebpAcceleratorWithLoaders(
        {
          decoder: async () => {
            scalarLoads += 1
            return instantiateWasm('/webp-codec.wasm')
          },
          encoder: async () => {
            scalarLoads += 1
            return instantiateWasm('/webp-codec.wasm')
          },
        },
        { minimumEncodePixels: 1, minimumPixels: 1 },
      ),
    ],
  })
  const simdImages = createImageLibrary({
    codecs: [pngCodec, webpCodec],
    accelerators: [
      createWasmWebpAcceleratorWithLoaders(
        {
          decoder: async () => {
            selectedScalarLoads += 1
            return instantiateWasm('/webp-codec.wasm')
          },
          simdDecoder: async () => {
            simdLoads += 1
            return instantiateWasm('/webp-codec-simd.wasm')
          },
          encoder: async () => {
            selectedScalarLoads += 1
            return instantiateWasm('/webp-codec.wasm')
          },
          simdEncoder: async () => {
            simdLoads += 1
            return instantiateWasm('/webp-codec-simd.wasm')
          },
        },
        { minimumEncodePixels: 1, minimumPixels: 1 },
      ),
    ],
  })
  const assertExact = (label: string, expected: Uint8Array, actual: Uint8Array): void => {
    if (expected.byteLength !== actual.byteLength) {
      throw new Error(`${label} WebP output length differs from the TypeScript reference`)
    }
    for (let offset = 0; offset < expected.byteLength; offset += 1) {
      if (expected[offset] !== actual[offset]) {
        throw new Error(`${label} WebP output differs at byte ${offset}`)
      }
    }
  }
  for (const options of [{ lossless: true } as const, { quality: 80 } as const]) {
    const [reference, publicOutput, scalar, simd] = await Promise.all([
      (await images.open(bytes)).webp(options).toUint8Array(),
      (await publicImages.open(bytes)).webp(options).toUint8Array(),
      (await scalarImages.open(bytes)).webp(options).toUint8Array(),
      (await simdImages.open(bytes)).webp(options).toUint8Array(),
    ])
    assertExact('Public Rust/WASM', reference, publicOutput)
    assertExact('Scalar Rust/WASM', reference, scalar)
    assertExact('SIMD Rust/WASM', reference, simd)
    const [referencePixels, acceleratedPixels] = await Promise.all([
      (await images.open(reference)).png().toUint8Array(),
      (await simdImages.open(reference)).png().toUint8Array(),
    ])
    assertExact('SIMD decode', referencePixels, acceleratedPixels)
  }
  if (scalarLoads !== 1 || simdLoads !== 2 || selectedScalarLoads !== 0) {
    throw new Error(
      `WebP selection loaded scalar=${scalarLoads}, SIMD=${simdLoads}, selected scalar=${selectedScalarLoads}`,
    )
  }
  return {
    detail: 'Scalar and SIMD WebP decode and encode matched exact TypeScript output in the browser',
    outputBytes: bytes.byteLength,
  }
}

const progressiveJpeg = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  const resized = (await images.open(bytes)).resize({ width: 160 })
  const baseline = await resized.jpeg({ quality: 86, chromaSubsampling: '420' }).toUint8Array()
  const progressive = await resized
    .jpeg({ quality: 86, chromaSubsampling: '420', progressive: true })
    .toUint8Array()
  let frameMarkers = 0
  const scanOffsets: number[] = []
  const huffmanOffsets: number[] = []
  for (let offset = 0; offset + 1 < progressive.byteLength; offset += 1) {
    if (progressive[offset] !== 0xff) continue
    if (progressive[offset + 1] === 0xc2) frameMarkers += 1
    if (progressive[offset + 1] === 0xda) scanOffsets.push(offset)
    if (progressive[offset + 1] === 0xc4) huffmanOffsets.push(offset)
  }
  if (frameMarkers !== 1 || scanOffsets.length !== 6) {
    throw new Error(
      `Progressive JPEG structure had ${frameMarkers} frames and ${scanOffsets.length} scans`,
    )
  }
  const metadata = await outputMetadata(progressive)
  if (metadata.format !== 'jpeg' || metadata.width !== 160 || metadata.height !== 120) {
    throw new Error(
      `Progressive JPEG output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const baselinePixels = await browserPixels(baseline, 'image/jpeg')
  const progressivePixels = await browserPixels(progressive, 'image/jpeg')
  if (baselinePixels.length !== progressivePixels.length) {
    throw new Error('Progressive browser decode changed pixel dimensions')
  }
  for (let offset = 0; offset < baselinePixels.length; offset += 1) {
    if (baselinePixels[offset] !== progressivePixels[offset]) {
      throw new Error(`Progressive browser decode changed pixel ${offset}`)
    }
  }
  const acScan = scanOffsets[2]
  if (acScan === undefined) throw new Error('Progressive browser JPEG is missing its AC scan')
  const scanLength = ((progressive[acScan + 2] ?? 0) << 8) | (progressive[acScan + 3] ?? 0)
  const entropyStart = acScan + 2 + scanLength
  const nextHuffmanTable = huffmanOffsets.find((offset) => offset > entropyStart)
  if (nextHuffmanTable === undefined) {
    throw new Error('Progressive browser JPEG is missing its inter-scan DHT')
  }
  const huffmanLength =
    ((progressive[nextHuffmanTable + 2] ?? 0) << 8) | (progressive[nextHuffmanTable + 3] ?? 0)
  const huffmanEnd = nextHuffmanTable + 2 + huffmanLength
  const truncatedAt = entropyStart + Math.floor((nextHuffmanTable - entropyStart) / 2)
  const partial = new Uint8Array(truncatedAt + huffmanEnd - nextHuffmanTable + 2)
  partial.set(progressive.subarray(0, truncatedAt))
  partial.set(progressive.subarray(nextHuffmanTable, huffmanEnd), truncatedAt)
  partial.set([0xff, 0xd9], partial.byteLength - 2)
  const recovered = await (await images.open(partial)).png().toUint8Array()
  let strictRejected = false
  try {
    await (await images.open(partial, { tolerantDecoding: false })).png().toUint8Array()
  } catch (error) {
    strictRejected =
      error instanceof ImageError &&
      error.code === 'INVALID_INPUT' &&
      error.message === 'Unexpected JPEG marker ffc4'
  }
  if (recovered.byteLength < 50 || !strictRejected) {
    throw new Error('Progressive browser DHT-boundary recovery did not preserve strict opt-out')
  }

  return {
    detail:
      'six-scan progressive JPEG matched baseline pixels and recovered a partial AC scan at a DHT boundary in the browser',
    outputBytes: progressive.byteLength,
  }
}

const animatedGifFrameSelection = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/animated.gif')
  const image = await images.open(bytes)
  const metadata = await image.metadata()
  if (metadata.frames !== 2) {
    throw new Error(`Animated GIF metadata reported ${metadata.frames ?? 0} frames`)
  }

  try {
    await image.png().toUint8Array()
    throw new Error('Animated GIF pixel decode succeeded without a frame selection')
  } catch (error: unknown) {
    if (!(error instanceof ImageError) || error.code !== 'UNSUPPORTED_OPERATION') throw error
  }

  const output = await (await images.open(bytes, { frame: 0 })).png().toUint8Array()
  const selected = await outputMetadata(output)
  if (selected.format !== 'png' || selected.width !== 2 || selected.height !== 2) {
    throw new Error(
      `Explicit GIF frame 0 output was ${selected.format} ${selected.width}x${selected.height}`,
    )
  }
  return {
    detail: 'animated GIF required explicit frame 0 selection in the browser',
    outputBytes: output.byteLength,
  }
}

const pngAlphaPipeline = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/alpha.png')
  const image = await images.open(new Blob([bytes], { type: 'image/png' }))
  const metadata = await image.metadata()
  if (!metadata.hasAlpha || metadata.width !== 4 || metadata.height !== 3) {
    throw new Error('Alpha PNG metadata did not preserve the source shape and alpha flag')
  }
  const output = await image.rotate(90).png().toUint8Array()
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(output)], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D OffscreenCanvas context is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const alphaValues = new Set<number>()
  for (let offset = 3; offset < pixels.byteLength; offset += 4) {
    const alpha = pixels[offset]
    if (alpha !== undefined) alphaValues.add(alpha)
  }
  for (const expected of [0, 64, 128, 255]) {
    if (!alphaValues.has(expected)) throw new Error(`Rotated PNG lost alpha value ${expected}`)
  }
  const result = await outputMetadata(output)
  if (result.width !== 3 || result.height !== 4 || !result.hasAlpha) {
    throw new Error('Rotated alpha PNG output metadata is incorrect')
  }
  return {
    detail: 'RGBA PNG rotate + PNG encode preserved alpha values',
    outputBytes: output.byteLength,
  }
}

const nativePngPrecision = async (): Promise<BrowserWorkflowResult> => {
  const bytes = Uint8Array.of(
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    0,
    0,
    0,
    13,
    73,
    72,
    68,
    82,
    0,
    0,
    0,
    3,
    0,
    0,
    0,
    3,
    16,
    0,
    0,
    0,
    0,
    35,
    211,
    54,
    32,
    0,
    0,
    0,
    29,
    73,
    68,
    65,
    84,
    120,
    156,
    99,
    96,
    96,
    100,
    100,
    98,
    98,
    102,
    96,
    102,
    97,
    97,
    101,
    101,
    99,
    96,
    99,
    103,
    231,
    224,
    224,
    4,
    0,
    2,
    79,
    0,
    82,
    220,
    141,
    233,
    78,
    0,
    0,
    0,
    0,
    73,
    69,
    78,
    68,
    174,
    66,
    96,
    130,
  )
  const output = await (await images.open(bytes))
    .crop({ x: 1, y: 0, width: 2, height: 3 })
    .rotate(90)
    .resize({ width: 3, height: 2, fit: 'fill', kernel: 'nearest' })
    .png()
    .toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.width !== 3 || metadata.height !== 2 || metadata.bitDepth !== 16) {
    throw new Error(
      `Native PNG browser output was ${metadata.width}x${metadata.height} at ${metadata.bitDepth ?? 0} bits`,
    )
  }
  const decoder = await pngCodec.createDecoder?.(new MemorySource(output), defaultImageLimits)
  if (decoder?.pixelFormat !== 'gray16') {
    throw new Error(`Native PNG browser decoder emitted ${decoder?.pixelFormat ?? 'nothing'}`)
  }
  const samples: number[] = []
  for await (const block of decoder.decode()) samples.push(...block.data)
  const expected = [7, 8, 4, 5, 1, 2, 8, 9, 5, 6, 2, 3]
  if (
    samples.length !== expected.length ||
    samples.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`Native PNG browser samples changed: ${samples.join(',')}`)
  }
  return {
    detail: '16-bit PNG crop, quarter-turn, resize, and encode preserved low sample bytes',
    outputBytes: output.byteLength,
  }
}
const tiffEncodePipeline = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/benchmark-input.png')
  const encoded = await (await images.open(input))
    .tiff({
      compression: 'deflate',
      predictor: 'horizontal',
      layout: 'tiles',
      tileWidth: 128,
      tileHeight: 128,
      format: 'bigtiff',
      compressionLevel: 6,
    })
    .toUint8Array()
  const metadata = await (await images.open(encoded)).metadata()
  if (metadata.format !== 'tiff' || metadata.width !== 640 || metadata.height !== 480) {
    throw new Error(
      `Browser TIFF encode produced ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const reopened = await (await images.open(encoded)).png().toUint8Array()
  const [expectedPixels, actualPixels] = await Promise.all([
    browserPixels(input, 'image/png'),
    browserPixels(reopened, 'image/png'),
  ])
  if (actualPixels.byteLength !== expectedPixels.byteLength) {
    throw new Error('Browser TIFF round-trip pixel size changed')
  }
  for (let offset = 0; offset < expectedPixels.byteLength; offset += 1) {
    if (actualPixels[offset] !== expectedPixels[offset]) {
      throw new Error(`Browser TIFF round-trip pixel ${offset} changed`)
    }
  }
  const blocks = (
    width: number,
    height: number,
    format: 'rgb8' | 'rgba8',
    data: Uint8Array,
  ): AsyncIterable<PixelBlock> => ({
    async *[Symbol.asyncIterator]() {
      yield {
        x: 0,
        y: 0,
        width,
        height,
        stride: width * (format === 'rgb8' ? 3 : 4),
        format,
        data,
      }
    },
  })
  const documentSink = new Uint8ArraySink()
  await encodeTiffDocument(documentSink, {
    runtime: browserRuntime,
    options: {
      compression: 'deflate',
      predictor: 'horizontal',
      layout: 'tiles',
      tileWidth: 16,
      tileHeight: 16,
      format: 'bigtiff',
    },
    pages: [
      {
        width: 2,
        height: 1,
        pixelFormat: 'rgb8',
        blocks: blocks(2, 1, 'rgb8', Uint8Array.of(1, 2, 3, 4, 5, 6)),
        reducedImages: [
          {
            width: 1,
            height: 1,
            pixelFormat: 'rgb8',
            blocks: blocks(1, 1, 'rgb8', Uint8Array.of(7, 8, 9)),
          },
        ],
      },
      {
        width: 1,
        height: 1,
        pixelFormat: 'rgba8',
        blocks: blocks(1, 1, 'rgba8', Uint8Array.of(10, 11, 12, 13)),
      },
    ],
  })
  const documentBytes = documentSink.toUint8Array()
  const document = await openTiffDocument(new MemorySource(documentBytes))
  if (
    document.topLevelDirectories.length !== 2 ||
    document.directories.length !== 3 ||
    document.topLevelDirectories[0]?.subIfds.length !== 1
  ) {
    throw new Error('Browser structured TIFF document lost pages or its SubIFD pyramid')
  }
  return {
    detail:
      'Deflate-predicted tiled BigTIFF round-tripped exact browser pixels; structured multi-page and SubIFD-pyramid output reopened',
    outputBytes: encoded.byteLength + documentBytes.byteLength,
  }
}

interface BrowserImagePixels {
  readonly height: number
  readonly pixels: Uint8ClampedArray
  readonly width: number
}

const browserImagePixels = async (bytes: Uint8Array, type: string): Promise<BrowserImagePixels> => {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D OffscreenCanvas context is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return {
    width: canvas.width,
    height: canvas.height,
    pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
  }
}

const browserPixels = async (bytes: Uint8Array, type: string): Promise<Uint8ClampedArray> =>
  (await browserImagePixels(bytes, type)).pixels

const portablePngPixels = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const createDecoder = pngCodec.createDecoder
  if (!createDecoder) throw new Error('First-party PNG decoding is unavailable')
  const decoder = await createDecoder(new MemorySource(bytes), defaultImageLimits)
  if (decoder.pixelFormat !== 'rgb8' && decoder.pixelFormat !== 'rgba8') {
    throw new Error(`Expected RGB8 or RGBA8 PNG output, got ${decoder.pixelFormat}`)
  }
  const output = new Uint8Array(decoder.width * decoder.height * 4)
  const channels = decoder.pixelFormat === 'rgb8' ? 3 : 4
  let nextRow = 0
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== decoder.pixelFormat ||
        block.x !== 0 ||
        block.y !== nextRow ||
        block.width !== decoder.width
      ) {
        throw new Error('First-party PNG decoder emitted non-contiguous pixel blocks')
      }
      for (let row = 0; row < block.height; row += 1) {
        let sourceOffset = row * block.stride
        let outputOffset = (block.y + row) * decoder.width * 4
        for (let x = 0; x < block.width; x += 1) {
          output[outputOffset] = block.data[sourceOffset] ?? 0
          output[outputOffset + 1] = block.data[sourceOffset + 1] ?? 0
          output[outputOffset + 2] = block.data[sourceOffset + 2] ?? 0
          output[outputOffset + 3] = channels === 4 ? (block.data[sourceOffset + 3] ?? 0) : 255
          sourceOffset += channels
          outputOffset += 4
        }
      }
      nextRow += block.height
    } finally {
      block.release?.()
    }
  }
  if (nextRow !== decoder.height) {
    throw new Error(`First-party PNG decoder emitted ${nextRow} of ${decoder.height} rows`)
  }
  return output
}

const sha256 = async (bytes: Uint8Array | Uint8ClampedArray): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')
}

interface BrowserTiffEntry {
  readonly tag: number
  readonly type: 2 | 3 | 4 | 5 | 7 | 12
  readonly values: readonly number[]
}

const browserTiffFixture = (
  entriesFor: (stripOffsets: readonly number[]) => BrowserTiffEntry[],
  strips: readonly Uint8Array[],
): Uint8Array => {
  const placeholder = entriesFor(strips.map(() => 0)).sort((left, right) => left.tag - right.tag)
  const entryCount = (entry: BrowserTiffEntry): number =>
    entry.type === 5 ? entry.values.length / 2 : entry.values.length
  const entryBytes = (entry: BrowserTiffEntry): number =>
    entryCount(entry) *
    (entry.type === 3 ? 2 : entry.type === 4 ? 4 : entry.type === 5 || entry.type === 12 ? 8 : 1)
  const ifdBytes = 2 + placeholder.length * 12 + 4
  const externalBytes = placeholder.reduce((total, entry) => {
    const bytes = entryBytes(entry)
    return total + (bytes > 4 ? bytes : 0)
  }, 0)
  const pixelOffset = 8 + ifdBytes + externalBytes
  const stripOffsets: number[] = []
  let nextStripOffset = pixelOffset
  for (const strip of strips) {
    stripOffsets.push(nextStripOffset)
    nextStripOffset += strip.byteLength
  }
  const entries = entriesFor(stripOffsets).sort((left, right) => left.tag - right.tag)
  const output = new Uint8Array(nextStripOffset)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, 8, true)
  view.setUint16(8, entries.length, true)
  let externalOffset = 8 + ifdBytes
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const entryOffset = 10 + index * 12
    const valueBytes = entryBytes(entry)
    const valuesOffset = valueBytes > 4 ? externalOffset : entryOffset + 8
    view.setUint16(entryOffset, entry.tag, true)
    view.setUint16(entryOffset + 2, entry.type, true)
    view.setUint32(entryOffset + 4, entryCount(entry), true)
    if (valueBytes > 4) {
      view.setUint32(entryOffset + 8, externalOffset, true)
      externalOffset += valueBytes
    }
    if (entry.type === 5) {
      for (let valueIndex = 0; valueIndex < entry.values.length; valueIndex += 2) {
        const offset = valuesOffset + (valueIndex / 2) * 8
        view.setUint32(offset, entry.values[valueIndex] ?? 0, true)
        view.setUint32(offset + 4, entry.values[valueIndex + 1] ?? 1, true)
      }
    } else {
      for (let valueIndex = 0; valueIndex < entry.values.length; valueIndex += 1) {
        const elementBytes: number =
          entry.type === 3 ? 2 : entry.type === 4 ? 4 : entry.type === 12 ? 8 : 1
        const offset = valuesOffset + valueIndex * elementBytes
        const value = entry.values[valueIndex] ?? 0
        if (entry.type === 3) view.setUint16(offset, value, true)
        else if (entry.type === 4) view.setUint32(offset, value, true)
        else if (entry.type === 12) view.setFloat64(offset, value, true)
        else output[offset] = value
      }
    }
  }
  for (let index = 0; index < strips.length; index += 1) {
    output.set(strips[index] ?? new Uint8Array(), stripOffsets[index] ?? 0)
  }
  return output
}

const scientificTiffDocument = async (): Promise<BrowserWorkflowResult> => {
  const xml = new TextEncoder().encode(
    '<?xml version="1.0"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06"><Image ID="Image:0"><Pixels ID="Pixels:0" DimensionOrder="XYZCT" Type="uint16" SizeX="2" SizeY="1" SizeZ="1" SizeC="3" SizeT="1" PhysicalSizeX="0.5" PhysicalSizeXUnit="µm"><Channel ID="Channel:0" Name="RGB" SamplesPerPixel="3"/><TiffData IFD="0" PlaneCount="1"/></Pixels></Image></OME>',
  )
  const description = Uint8Array.from([...xml, 0])
  const feiMetadata = Uint8Array.from([
    ...new TextEncoder().encode(
      '[Scan]\nPixelWidth=3.10059e-10\nPixelHeight=3.10059e-10\n[System]\nSystemType=Helios NanoLab\n',
    ),
    0,
  ])
  const strip = Uint8Array.of(0, 0, 0, 128, 255, 255, 255, 255, 0, 128, 0, 0)
  const input = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [2] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [16, 16, 16] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [2] },
      { tag: 270, type: 2, values: [...description] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [strip.byteLength] },
      { tag: 284, type: 3, values: [1] },
      { tag: 282, type: 5, values: [20_000, 1] },
      { tag: 283, type: 5, values: [10_000, 1] },
      { tag: 296, type: 3, values: [3] },
      { tag: 339, type: 3, values: [1, 1, 1] },
      {
        tag: 34_264,
        type: 12,
        values: [0.5, 0, 0, 100, 0, -0.5, 0, 200, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      {
        tag: 34_735,
        type: 3,
        values: [1, 1, 0, 3, 1_024, 0, 1, 2, 1_025, 0, 1, 1, 2_048, 0, 1, 4_326],
      },
      { tag: 42_113, type: 2, values: [...new TextEncoder().encode('-9999'), 0] },
      { tag: 34_682, type: 2, values: [...feiMetadata] },
    ],
    [strip],
  )
  const document = await openTiffDocument(new MemorySource(input))
  const directory = document.topLevelDirectories[0]
  if (directory?.offset !== 8 || document.getDirectoryByOffset(8) !== directory) {
    throw new Error('Browser TIFF document did not expose stable IFD offsets')
  }
  const header = await document.readBytes(0, 4, { maxBytes: 4 })
  if (header.join(',') !== '73,73,42,0') {
    throw new Error('Browser TIFF document bounded byte read returned the wrong bytes')
  }
  try {
    await document.readBytes(0, 5, { maxBytes: 4 })
    throw new Error('Browser TIFF document accepted an over-budget byte read')
  } catch (error: unknown) {
    if (!(error instanceof ImageError) || error.code !== 'LIMIT_EXCEEDED') throw error
  }
  const tag = await directory.getTag(270, { maxBytes: 4096 })
  if (tag?.kind !== 'ascii' || !tag.value.includes('<OME')) {
    throw new Error('Browser TIFF document did not expose bounded OME metadata')
  }
  if ((await directory.getTag(270, { maxBytes: 4096 })) !== tag) {
    throw new Error('Browser TIFF document did not reuse an immutable parsed tag')
  }
  const detected = await new ScientificReaderRegistry([tiffReader, omeTiffReader]).detect({
    primary: { id: 'primary', source: new MemorySource(input), name: 'fixture.ome.tiff' },
  })
  if (detected.reader.id !== omeTiffReader.descriptor.id || detected.confidence !== 1) {
    throw new Error('Browser generic TIFF reader outranked the specialized OME-TIFF reader')
  }
  const ordinaryDocument = await createScientificLibrary({ readers: [tiffReader] }).open({
    primary: { id: 'primary', source: new MemorySource(input), name: 'fixture.tiff' },
  })
  const ordinarySummary = ordinaryDocument.datasets[0]
  if (ordinarySummary === undefined)
    throw new Error('Browser ordinary TIFF reader exposed no dataset')
  const ordinaryDataset = await ordinaryDocument.openDataset(ordinarySummary.id)
  const ordinaryBlocks = ordinaryDataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
    x: 1,
    y: 0,
    width: 1,
    height: 1,
  })
  const ordinarySamples: number[] = []
  for await (const block of ordinaryBlocks) {
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let offset = 0; offset < block.data.byteLength; offset += 2) {
      ordinarySamples.push(view.getUint16(offset, false))
    }
  }
  if (
    ordinaryDataset.descriptor.sampleType !== 'uint16' ||
    ordinaryDataset.descriptor.components.map(({ kind }) => kind).join(',') !== 'red,green,blue' ||
    ordinaryDataset.descriptor.axes[0]?.coordinates.type !== 'linear' ||
    Math.abs(ordinaryDataset.descriptor.axes[0].coordinates.step - 0.310059) > 1e-12 ||
    ordinaryDataset.descriptor.axes[1]?.coordinates.type !== 'linear' ||
    Math.abs(ordinaryDataset.descriptor.axes[1].coordinates.step - 0.310059) > 1e-12 ||
    !(JSON.stringify(ordinaryDataset.descriptor.metadata?.['purejsimage:tiff']) ?? '').includes(
      'fei-sem-tiff-calibration',
    ) ||
    ordinaryDataset.descriptor.spatialReference?.crs.code !== 4_326 ||
    ordinaryDataset.descriptor.spatialReference.pixelToModel?.join(',') !==
      '0.5,0,100,0,-0.5,200' ||
    ordinaryDataset.descriptor.spatialReference.noData?.kind !== 'scalar' ||
    ordinaryDataset.descriptor.spatialReference.noData.value !== -9_999 ||
    ordinarySamples.join(',') !== '65535,32768,0'
  ) {
    throw new Error(`Browser ordinary TIFF native samples were ${ordinarySamples.join(',')}`)
  }
  const scientificDocument = await createScientificLibrary({ readers: [omeTiffReader] }).open({
    primary: { id: 'primary', source: new MemorySource(input), name: 'fixture.ome.tiff' },
    readerId: omeTiffReader.descriptor.id,
  })
  const summary = scientificDocument.datasets[0]
  if (summary === undefined) throw new Error('Browser OME-TIFF reader exposed no dataset')
  const dataset = await scientificDocument.openDataset(summary.id)
  const x = dataset.descriptor.axes.find((axis) => axis.id === 'x')
  const y = dataset.descriptor.axes.find((axis) => axis.id === 'y')
  const channel = dataset.descriptor.axes.find((axis) => axis.id === 'channel')
  if (
    x?.length !== 2 ||
    y?.length !== 1 ||
    channel?.length !== 1 ||
    dataset.descriptor.components.length !== 3 ||
    dataset.descriptor.sampleType !== 'uint16' ||
    x.coordinates.type !== 'linear' ||
    x.coordinates.step !== 0.5
  ) {
    throw new Error('Browser OME-TIFF dataset metadata is incorrect')
  }
  const rasterBlocks = dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [
      { axisId: 'z', index: 0 },
      { axisId: 'channel', index: 0 },
      { axisId: 'time', index: 0 },
    ],
    x: 0,
    y: 0,
    width: 2,
    height: 1,
  })
  const pixels: number[] = []
  for await (const block of rasterToPixels(rasterBlocks, {
    channels: [0],
    ranges: [{ black: 0, white: 65_535 }],
  })) {
    pixels.push(...block.data)
  }
  if (pixels.join(',') !== '0,255') {
    throw new Error(`Browser OME-TIFF display conversion produced ${pixels.join(',')}`)
  }
  const aperioDescription = Uint8Array.from([
    ...new TextEncoder().encode('Aperio Image Library v12.4.0|AppMag = 20|MPP = 0.5'),
    0,
  ])
  const aperioInput = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [12] },
      { tag: 257, type: 4, values: [4] },
      { tag: 258, type: 3, values: [8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 270, type: 2, values: [...aperioDescription] },
      { tag: 277, type: 3, values: [1] },
      { tag: 284, type: 3, values: [1] },
      { tag: 322, type: 4, values: [4] },
      { tag: 323, type: 4, values: [4] },
      { tag: 324, type: 4, values: offsets },
      { tag: 325, type: 4, values: [16, 16, 16] },
    ],
    [new Uint8Array(16).fill(11), new Uint8Array(16).fill(22), new Uint8Array(16).fill(33)],
  )
  const aperioDocument = await openTiffDocument(new MemorySource(aperioInput), {
    maxWidth: 12,
    maxHeight: 4,
    maxPixels: 48,
    maxInputBytes: aperioInput.byteLength,
    maxDecodedBytes: 70,
  })
  const aperioDirectory = aperioDocument.topLevelDirectories[0]
  if (aperioDirectory === undefined) throw new Error('Browser Aperio TIFF has no directory')
  const cogInspection = await inspectCog(aperioDocument)
  if (
    !cogInspection.likelyCog ||
    cogInspection.container !== 'TIFF' ||
    cogInspection.directories[0]?.tileWidth !== 4 ||
    cogInspection.directories[0]?.compression.name !== 'Uncompressed'
  ) {
    throw new Error(`Browser COG structural inspection failed: ${JSON.stringify(cogInspection)}`)
  }
  const directDecoder = await aperioDirectory.createImageDecoder()
  try {
    for await (const _block of directDecoder.decode({ x: 0, y: 1, width: 12, height: 1 })) {
      // Decoded segments and output need 60 bytes; the encoded buffer raises the peak to 76.
    }
    throw new Error('Browser TIFF accepted an over-budget segment-row peak')
  } catch (error: unknown) {
    if (!(error instanceof ImageError) || error.code !== 'LIMIT_EXCEEDED') throw error
  }
  const slide = await openAperioSvs(aperioDocument, {
    limits: {
      maxWidth: 12,
      maxHeight: 4,
      maxSourceBytes: aperioInput.byteLength,
      maxRegionPixels: 48,
      maxRegionDecodedBytes: 70,
    },
  })
  const stripe: { readonly x: number; readonly values: readonly number[] }[] = []
  for await (const block of slide.readRegion({ level: 0, x: 2, y: 1, width: 8, height: 1 })) {
    stripe.push({ x: block.x, values: Array.from(block.data) })
  }
  if (
    JSON.stringify(stripe) !==
    JSON.stringify([
      { x: 0, values: [11, 11] },
      { x: 2, values: [22, 22, 22, 22] },
      { x: 6, values: [33, 33] },
    ])
  ) {
    throw new Error(`Browser Aperio stripe was ${JSON.stringify(stripe)}`)
  }
  return {
    detail:
      'bounded TIFF extension APIs and COG structural inspection, calibrated native-precision ordinary TIFF opening with typed GeoTIFF spatial reference, specialized OME-TIFF precedence, labeled OME-TIFF document opening, explicit display conversion, and native-tile Aperio stripe streaming passed',
    outputBytes: input.byteLength + aperioInput.byteLength,
  }
}

const scientificDigitalMicrograph = async (): Promise<BrowserWorkflowResult> => {
  const document = await createScientificLibrary({ readers: [digitalMicrographReader] }).open({
    primary: {
      id: 'browser-dm3',
      name: 'browser-fixture.dm3',
      source: new MemorySource(generatedDigitalMicrographFixture()),
    },
  })
  const summary = document.datasets[0]
  if (
    summary?.descriptor.sampleType !== 'uint16' ||
    summary.descriptor.axes[0]?.length !== 2 ||
    summary.descriptor.axes[1]?.length !== 2
  ) {
    throw new Error('Browser DigitalMicrograph descriptor did not preserve the 2x2 uint16 image')
  }
  const dataset = await document.openDataset(summary.id)
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
  if (output.join(',') !== '0,2,0,4') {
    throw new Error(`Browser DigitalMicrograph selected-region pixels were ${output.join(',')}`)
  }
  const eelsDocument = await createScientificLibrary({ readers: [digitalMicrographReader] }).open({
    primary: {
      id: 'browser-eels-dm3',
      name: 'browser-eels.dm3',
      source: new MemorySource(generatedDigitalMicrographEelsFixture()),
    },
  })
  const eels = eelsDocument.datasets[0]
  if (
    eels?.descriptor.axes[2]?.id !== 'energy' ||
    eels.descriptor.axes[2].kind !== 'spectral' ||
    eels.descriptor.axes[2].unit !== 'eV'
  ) {
    throw new Error('Browser DigitalMicrograph EELS evidence did not produce an energy axis')
  }
  return {
    detail:
      'portable DM3 reader preserved uint16 pixels, direct selected-region reads, and evidence-gated EELS energy semantics',
    outputBytes: output.length,
  }
}

const scientificInterchangeFormats = async (): Promise<BrowserWorkflowResult> => {
  const encode = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value)
  const primary = (name: string, bytes: Uint8Array): ScientificResource => ({
    id: name,
    name,
    source: new MemorySource(bytes),
  })
  const readFirst = async (
    reader: ScientificReader,
    name: string,
    bytes: Uint8Array,
    companions: Readonly<Record<string, ScientificResource>> = {},
    datasetId?: string,
  ): Promise<number> => {
    const document = await createScientificLibrary({ readers: [reader] }).open({
      primary: primary(name, bytes),
      companions: {
        async resolve(request) {
          const requested = request.kind === 'relative-name' ? request.name : request.relativeName
          return requested === undefined ? undefined : companions[requested]
        },
      },
    })
    const dataset = await document.openDataset(datasetId ?? document.datasets[0]?.id ?? '')
    if (dataset.descriptor.axes.length === 1) {
      const readSeries = dataset.readSeries
      if (readSeries === undefined) throw new Error(`${name} did not expose a series reader`)
      let bytesRead = 0
      for await (const block of readSeries.call(dataset, {
        axisId: dataset.descriptor.axes[0]?.id ?? '',
        fixedIndices: [],
      })) {
        bytesRead += block.data.byteLength
      }
      return bytesRead
    }
    const displayAxes = [
      dataset.descriptor.axes[0]?.id ?? '',
      dataset.descriptor.axes[1]?.id ?? '',
    ] as const
    const fixedIndices = dataset.descriptor.axes
      .slice(2)
      .map(({ id }) => ({ axisId: id, index: 0 }))
    let bytesRead = 0
    for await (const block of dataset.readPlane({ displayAxes, fixedIndices })) {
      bytesRead += block.data.byteLength
    }
    return bytesRead
  }

  const gzip = async (input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> => {
    const stream = new Blob([Uint8Array.from(input)])
      .stream()
      .pipeThrough(new CompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }

  const rplHeader = encode(`key\tvalue
width\t2
height\t2
depth\t1
data-type\tunsigned
data-length\t1
byte-order\tdont-care
record-by\tdont-care
`)
  const rplRaw = primary('map.raw', Uint8Array.from([1, 2, 3, 4]))

  const emsa = encode(`#FORMAT: EMSA/MAS Spectral Data File
#NPOINTS: 3
#DATATYPE: Y
#OFFSET: 0
#XPERCHAN: 1
#SPECTRUM:
1,2,3
#ENDOFDATA:
`)

  const nrrdHeader = encode(`NRRD0005
type: uchar
dimension: 2
sizes: 2 2
encoding: gzip

`)
  const nrrdPayload = await gzip(Uint8Array.from([1, 2, 3, 4]))
  const nrrd = new Uint8Array(nrrdHeader.byteLength + nrrdPayload.byteLength)
  nrrd.set(nrrdHeader)
  nrrd.set(nrrdPayload, nrrdHeader.byteLength)

  const mhaHeader = encode(`ObjectType = Image
NDims = 2
DimSize = 2 2
ElementType = MET_UCHAR
ElementDataFile = LOCAL
`)
  const mha = new Uint8Array(mhaHeader.byteLength + 4)
  mha.set(mhaHeader)
  mha.set([1, 2, 3, 4], mhaHeader.byteLength)

  const nifti = new Uint8Array(356)
  const niftiView = new DataView(nifti.buffer)
  niftiView.setInt32(0, 348, true)
  niftiView.setInt16(40, 2, true)
  niftiView.setInt16(42, 2, true)
  niftiView.setInt16(44, 2, true)
  niftiView.setInt16(70, 2, true)
  niftiView.setInt16(72, 8, true)
  niftiView.setFloat32(80, 1, true)
  niftiView.setFloat32(84, 1, true)
  niftiView.setFloat32(108, 352, true)
  niftiView.setFloat32(112, 1, true)
  nifti.set(encode('n+1\0'), 344)
  nifti.set([1, 2, 3, 4], 352)

  const npyDictionary = "{'descr': '|u1', 'fortran_order': False, 'shape': (2, 2), }"
  const npyPadding = (64 - ((10 + npyDictionary.length + 1) % 64)) % 64
  const npyHeader = encode(`${npyDictionary}${' '.repeat(npyPadding)}\n`)
  const npy = new Uint8Array(10 + npyHeader.byteLength + 4)
  npy.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0])
  new DataView(npy.buffer).setUint16(8, npyHeader.byteLength, true)
  npy.set(npyHeader, 10)
  npy.set([1, 2, 3, 4], 10 + npyHeader.byteLength)

  const blo = new Uint8Array(251)
  const bloView = new DataView(blo.buffer)
  blo.set(encode('IMGBLO'))
  bloView.setUint16(6, 0x0102, true)
  bloView.setUint32(8, 240, true)
  bloView.setUint32(12, 241, true)
  bloView.setUint16(20, 2, true)
  bloView.setUint16(24, 1, true)
  bloView.setUint16(26, 1, true)
  bloView.setFloat64(30, 1, true)
  bloView.setFloat64(38, 1, true)
  blo[240] = 9
  bloView.setUint16(241, 0x55aa, true)
  bloView.setUint32(243, 0, true)
  blo.set([1, 2, 3, 4], 247)

  const mibHeader = encode('MQ1,1,384,1,2,2,U08,1x1,2024-01-01,100ns,0,0')
  const mib = new Uint8Array(388)
  mib.fill(0x20, 0, 384)
  mib.set(mibHeader)
  mib.set([1, 2, 3, 4], 384)

  const ang = encode(`# GRID: SqrGrid
# XSTEP: 1
# YSTEP: 1
# NCOLS_ODD: 1
# NCOLS_EVEN: 1
# NROWS: 1
0.1 0.2 0.3 0 0 10 0.9 1
`)

  let outputBytes = 0
  outputBytes += await readFirst(rplReader, 'map.rpl', rplHeader, { 'map.raw': rplRaw })
  outputBytes += await readFirst(emsaReader, 'spectrum.msa', emsa)
  outputBytes += await readFirst(nrrdReader, 'volume.nrrd', nrrd)
  outputBytes += await readFirst(metaImageReader, 'volume.mha', mha)
  outputBytes += await readFirst(niftiReader, 'volume.nii', nifti)
  outputBytes += await readFirst(npyReader, 'array.npy', npy)
  outputBytes += await readFirst(blockfileReader, 'scan.blo', blo, {}, 'navigator')
  outputBytes += await readFirst(mibReader, 'detector.mib', mib)
  outputBytes += await readFirst(ebsdTextReader, 'map.ang', ang)
  return {
    detail: 'nine portable Milestone H readers passed selected data paths including browser gzip',
    outputBytes,
  }
}

const scientificSurfaceFormats = async (): Promise<BrowserWorkflowResult> => {
  const cases = [
    {
      path: '/fixtures/nanonis-afm-generic4.sxm',
      name: 'surface.sxm',
      reader: nanonisSxmReader,
      datasets: 18,
      sampleType: 'float32',
    },
    {
      path: '/fixtures/asylum-afm-v5.ibw',
      name: 'surface.ibw',
      reader: igorBinaryWaveReader,
      datasets: 1,
      sampleType: 'float32',
    },
    {
      path: '/fixtures/digital-surf-compressed.sur',
      name: 'surface.sur',
      reader: digitalSurfReader,
      datasets: 1,
      sampleType: 'float64',
    },
    {
      path: '/fixtures/iso5436-sample4.x3p',
      name: 'surface.x3p',
      reader: x3pReader,
      datasets: 1,
      sampleType: 'float64',
    },
  ] as const
  let outputBytes = 0
  for (const expected of cases) {
    const input = await fetchBytes(expected.path)
    const document = await createScientificLibrary({ readers: [expected.reader] }).open({
      primary: { id: expected.name, name: expected.name, source: new MemorySource(input) },
    })
    if (document.datasets.length !== expected.datasets) {
      throw new Error(`${expected.name} exposed ${document.datasets.length} datasets`)
    }
    const summary = document.datasets[0]
    if (summary?.descriptor.sampleType !== expected.sampleType) {
      throw new Error(`${expected.name} exposed the wrong sample type`)
    }
    const dataset = await document.openDataset(summary.id)
    const fixedIndices = dataset.descriptor.axes
      .slice(2)
      .map(({ id }) => ({ axisId: id, index: 0 }))
    let blocks = 0
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })) {
      outputBytes += block.data.byteLength
      blocks += 1
    }
    if (blocks !== 1) throw new Error(`${expected.name} did not return one selected block`)
  }
  return {
    detail:
      'Nanonis SXM, IBW v5, Digital Surf, and bounded ZIP-backed X3P selected regions passed in-browser',
    outputBytes,
  }
}

const scientificTiaSer = async (): Promise<BrowserWorkflowResult> => {
  const input = generatedTiaSerSpectrumImage()
  const document = await createScientificLibrary({ readers: [tiaSerReader] }).open({
    primary: {
      id: 'browser-tia-ser',
      name: 'browser-fixture.ser',
      source: new MemorySource(input),
    },
  })
  const summary = document.datasets[0]
  if (
    summary?.descriptor.sampleType !== 'uint16' ||
    summary.descriptor.axes.map(({ id }) => id).join(',') !== 'x,y,energy'
  ) {
    throw new Error('Browser TIA SER descriptor did not preserve the spectrum-image axes')
  }
  const dataset = await document.openDataset(summary.id)
  if (dataset.readSeries === undefined) throw new Error('Browser TIA SER lacks native series reads')
  const output: number[] = []
  for await (const block of dataset.readSeries({
    axisId: 'energy',
    fixedIndices: [
      { axisId: 'x', index: 1 },
      { axisId: 'y', index: 1 },
    ],
    start: 0,
    length: 3,
  })) {
    output.push(...block.data)
  }
  if (output.join(',') !== '0,31,0,32,0,33') {
    throw new Error(`Browser TIA SER spectrum pixels were ${output.join(',')}`)
  }
  return {
    detail: 'portable v544 TIA SER reader preserved calibrated spectrum-image native series reads',
    outputBytes: output.length,
  }
}

const storedZipArchive = (files: Readonly<Record<string, Uint8Array>>): Uint8Array<ArrayBuffer> => {
  const names = Object.keys(files)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const name of names) {
    const data = files[name]
    if (data === undefined) continue
    const nameBytes = new TextEncoder().encode(name)
    const checksum = crc32(data)
    const local = new Uint8Array(30 + nameBytes.byteLength + data.byteLength)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, data.byteLength, true)
    localView.setUint32(22, data.byteLength, true)
    localView.setUint16(26, nameBytes.byteLength, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.byteLength)
    locals.push(local)
    const central = new Uint8Array(46 + nameBytes.byteLength)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, data.byteLength, true)
    centralView.setUint32(24, data.byteLength, true)
    centralView.setUint16(28, nameBytes.byteLength, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)
    offset += local.byteLength
  }
  const centralSize = centrals.reduce((sum, entry) => sum + entry.byteLength, 0)
  const bytes = new Uint8Array(offset + centralSize + 22)
  let cursor = 0
  for (const local of locals) {
    bytes.set(local, cursor)
    cursor += local.byteLength
  }
  const centralOffset = cursor
  for (const central of centrals) {
    bytes.set(central, cursor)
    cursor += central.byteLength
  }
  const view = new DataView(bytes.buffer)
  view.setUint32(cursor, 0x06054b50, true)
  view.setUint16(cursor + 8, names.length, true)
  view.setUint16(cursor + 10, names.length, true)
  view.setUint32(cursor + 12, centralSize, true)
  view.setUint32(cursor + 16, centralOffset, true)
  return bytes
}

const scientificOmeZarr = async (): Promise<BrowserWorkflowResult> => {
  const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
  const root = json({
    zarr_format: 3,
    node_type: 'group',
    attributes: {
      ome: {
        version: '0.5',
        multiscales: [
          {
            name: 'browser',
            axes: [
              { name: 'y', type: 'space', unit: 'micrometer' },
              { name: 'x', type: 'space', unit: 'micrometer' },
            ],
            datasets: [
              { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
            ],
          },
        ],
      },
    },
  })
  const array = json({
    zarr_format: 3,
    node_type: 'array',
    shape: [2, 2],
    data_type: 'uint8',
    chunk_grid: { name: 'regular', configuration: { chunk_shape: [2, 2] } },
    chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
    fill_value: 0,
    codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
    dimension_names: ['y', 'x'],
    attributes: {},
  })
  const labelsIndex = json({
    zarr_format: 3,
    node_type: 'group',
    attributes: { ome: { version: '0.5', labels: ['cell'] } },
  })
  const labelRoot = json({
    zarr_format: 3,
    node_type: 'group',
    attributes: {
      ome: {
        version: '0.5',
        'image-label': { colors: [{ 'label-value': 1, rgba: [255, 0, 0, 255] }] },
        multiscales: [
          {
            name: 'cell',
            axes: [
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            datasets: [
              { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
            ],
          },
        ],
      },
    },
  })
  const document = await createScientificLibrary({ readers: [omeZarrReader] }).open(
    createScientificFileContext(new File([Uint8Array.from(root)], 'zarr.json'), {
      companions: [
        new File([Uint8Array.from(array)], '0/zarr.json'),
        new File([Uint8Array.of(1, 2, 3, 4)], '0/c/0/0'),
        new File([Uint8Array.from(labelsIndex)], 'labels/zarr.json'),
        new File([Uint8Array.from(labelRoot)], 'labels/cell/zarr.json'),
        new File([Uint8Array.from(array)], 'labels/cell/0/zarr.json'),
        new File([Uint8Array.of(0, 1, 1, 0)], 'labels/cell/0/c/0/0'),
      ],
    }),
  )
  const dataset = await document.openDataset(document.datasets[0]?.id ?? '')
  const values: number[] = []
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
  })) {
    values.push(...block.data)
  }
  if (values.join(',') !== '1,2,3,4') {
    throw new Error(`Browser OME-Zarr pixels were ${values.join(',')}`)
  }
  const label = await document.openDataset('labels/cell')
  const labelValues: number[] = []
  for await (const block of label.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
  })) {
    labelValues.push(...block.data)
  }
  if (label.descriptor.metadata?.kind !== 'label' || labelValues.join(',') !== '0,1,1,0') {
    throw new Error(`Browser OME-Zarr labels were ${labelValues.join(',')}`)
  }
  const group = json({ zarr_format: 2 })
  const attrs = json({
    multiscales: [
      {
        version: '0.4',
        name: 'legacy',
        axes: [
          { name: 'y', type: 'space', unit: 'micrometer' },
          { name: 'x', type: 'space', unit: 'micrometer' },
        ],
        datasets: [{ path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] }],
      },
    ],
  })
  const zarray = json({
    zarr_format: 2,
    shape: [2, 2],
    chunks: [2, 2],
    dtype: '|u1',
    compressor: null,
    fill_value: 0,
    order: 'C',
    filters: null,
    dimension_separator: '/',
  })
  const v2 = await createScientificLibrary({ readers: [omeZarrReader] }).open(
    createScientificFileContext(new File([Uint8Array.from(group)], '.zgroup'), {
      companions: [
        new File([Uint8Array.from(attrs)], '.zattrs'),
        new File([Uint8Array.from(zarray)], '0/.zarray'),
        new File([Uint8Array.of(9, 8, 7, 6)], '0/0/0'),
      ],
    }),
  )
  const v2Dataset = await v2.openDataset(v2.datasets[0]?.id ?? '')
  const v2Values: number[] = []
  for await (const block of v2Dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
  })) {
    v2Values.push(...block.data)
  }
  if (v2.metadata.omeNgffVersion !== '0.4' || v2Values.join(',') !== '9,8,7,6') {
    throw new Error(`Browser OME-Zarr 0.4 pixels were ${v2Values.join(',')}`)
  }
  const zipped = await createScientificLibrary({ readers: [omeZarrReader] }).open(
    createScientificFileContext(
      new File(
        [
          Uint8Array.from(
            storedZipArchive({
              'zarr.json': root,
              '0/zarr.json': array,
              '0/c/0/0': Uint8Array.of(5, 6, 7, 8),
            }),
          ),
        ],
        'image.ozx',
      ),
    ),
  )
  const zipDataset = await zipped.openDataset(zipped.datasets[0]?.id ?? '')
  const zipValues: number[] = []
  for await (const block of zipDataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
  })) {
    zipValues.push(...block.data)
  }
  if (zipped.metadata.store !== 'zip' || zipValues.join(',') !== '5,6,7,8') {
    throw new Error(`Browser OME-Zarr ZIP pixels were ${zipValues.join(',')}`)
  }
  const nestedZip = await createScientificLibrary({ readers: [omeZarrReader] }).open(
    createScientificFileContext(
      new File(
        [
          Uint8Array.from(
            storedZipArchive({
              'plate.zarr/zarr.json': root,
              'plate.zarr/0/zarr.json': array,
              'plate.zarr/0/c/0/0': Uint8Array.of(2, 2, 2, 2),
            }),
          ),
        ],
        'plate.zarr.zip',
      ),
    ),
  )
  const nestedValues: number[] = []
  for await (const block of (
    await nestedZip.openDataset(nestedZip.datasets[0]?.id ?? '')
  ).readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
  })) {
    nestedValues.push(...block.data)
  }
  if (nestedValues.join(',') !== '2,2,2,2') {
    throw new Error(`Browser nested OME-Zarr ZIP pixels were ${nestedValues.join(',')}`)
  }
  const zarrNamedZip = createScientificFileContext(
    new File(
      [
        Uint8Array.from(
          storedZipArchive({
            'plate.zarr/zarr.json': root,
            'plate.zarr/0/zarr.json': array,
            'plate.zarr/0/c/0/0': Uint8Array.of(2, 2, 2, 2),
            '__MACOSX/plate.zarr/zarr.json': root,
          }),
        ),
      ],
      'plate.ome.zarr',
    ),
  )
  const zarrNamedProbe = await omeZarrReader.probe(zarrNamedZip)
  if (zarrNamedProbe.confidence < 0.9) {
    throw new Error(`Browser *.ome.zarr ZIP probe confidence was ${zarrNamedProbe.confidence}`)
  }
  const zarrNamed = await createScientificLibrary({ readers: [omeZarrReader] }).open(zarrNamedZip)
  if (zarrNamed.metadata.store !== 'zip') {
    throw new Error('Browser *.ome.zarr ZIP store was not opened')
  }
  const layoutRoot = json({
    zarr_format: 3,
    node_type: 'group',
    attributes: { ome: { version: '0.5', 'bioformats2raw.layout': 3 } },
  })
  const seriesRoot = json({
    zarr_format: 3,
    node_type: 'group',
    attributes: {
      ome: {
        version: '0.5',
        multiscales: [
          {
            name: 'series-0',
            axes: [
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            datasets: [
              { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
            ],
          },
        ],
      },
    },
  })
  const series = await createScientificLibrary({ readers: [omeZarrReader] }).open(
    createScientificFileContext(new File([Uint8Array.from(layoutRoot)], 'zarr.json'), {
      companions: [
        new File([Uint8Array.from(seriesRoot)], '0/zarr.json'),
        new File([Uint8Array.from(array)], '0/0/zarr.json'),
        new File([Uint8Array.of(3, 3, 3, 3)], '0/0/c/0/0'),
      ],
    }),
  )
  if (series.metadata.bioformats2rawLayout !== 3 || series.datasets[0]?.id !== '0') {
    throw new Error('Browser bioformats2raw series root was not discovered')
  }
  const seriesValues: number[] = []
  for await (const block of (await series.openDataset('0')).readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
  })) {
    seriesValues.push(...block.data)
  }
  if (seriesValues.join(',') !== '3,3,3,3') {
    throw new Error(`Browser bioformats2raw pixels were ${seriesValues.join(',')}`)
  }
  return {
    detail:
      'portable OME-Zarr 0.5, labels, 0.4, ZIP, nested ZIP, and bioformats2raw readers resolved browser File stores and selected 2x2 planes',
    outputBytes:
      values.length +
      labelValues.length +
      v2Values.length +
      zipValues.length +
      nestedValues.length +
      seriesValues.length,
  }
}

const geoZarrRaster = async (): Promise<BrowserWorkflowResult> => {
  const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
  const conventions = [
    {
      schema_url:
        'https://raw.githubusercontent.com/zarr-conventions/proj/refs/tags/v0.1/schema.json',
      spec_url: 'https://github.com/zarr-conventions/proj/blob/v0.1/README.md',
      uuid: 'f17cb550-5864-4468-aeb7-f3180cfb622f',
      name: 'proj',
      description: 'Coordinate reference system information for geospatial data',
    },
    {
      schema_url:
        'https://raw.githubusercontent.com/zarr-conventions/spatial/refs/tags/v0.1/schema.json',
      spec_url: 'https://github.com/zarr-conventions/spatial/blob/v0.1/README.md',
      uuid: '689b58e2-cf7b-45e0-9fff-9cfc0883d6b4',
      name: 'spatial',
      description: 'Spatial coordinate information',
    },
  ]
  const root = json({
    zarr_format: 3,
    node_type: 'array',
    shape: [2, 3],
    data_type: 'uint8',
    chunk_grid: { name: 'regular', configuration: { chunk_shape: [2, 3] } },
    chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
    fill_value: 0,
    codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
    dimension_names: ['Y', 'X'],
    attributes: {
      zarr_conventions: conventions,
      'proj:code': 'EPSG:32632',
      'spatial:dimensions': ['Y', 'X'],
      'spatial:transform': [10, 1, 500000, 0, -10, 5000000],
    },
  })
  const document = await geoZarrReader.open(
    createScientificFileContext(new File([Uint8Array.from(root)], 'zarr.json'), {
      companions: [new File([Uint8Array.of(1, 2, 3, 4, 5, 6)], 'c/0/0')],
    }),
  )
  const dataset = await document.openDataset('root')
  const view = dataset.createView({
    spatialDimensions: ['X', 'Y'],
    nonSpatial: [],
    sourceBands: [0],
    levelId: '0',
  })
  const values: number[] = []
  for await (const tile of view.readPixelRegion({
    region: { x: 1, y: 0, width: 2, height: 2 },
  })) {
    values.push(...Array.from(tile.data, Number))
    tile.release()
  }
  if (
    values.join(',') !== '2,3,5,6' ||
    dataset.descriptor.grid.pixelToWorld.join(',') !== '10,1,500000,0,-10,5000000'
  ) {
    throw new Error(`Browser GeoZarr result was ${values.join(',')}`)
  }
  await document.close?.()
  return {
    detail: 'portable GeoZarr reader selected a bounded rotated-grid viewport from browser Files',
    outputBytes: values.length,
  }
}

const geoNetCdfRaster = async (): Promise<BrowserWorkflowResult> => {
  const fixture = createNetCdfClassicFixture({
    version: 1,
    dimensions: [
      { name: 'latitude', length: 2 },
      { name: 'longitude', length: 3 },
    ],
    variables: [
      {
        name: 'latitude',
        dimensions: ['latitude'],
        type: 'float',
        attributes: [
          { name: 'standard_name', type: 'char', values: 'latitude' },
          { name: 'units', type: 'char', values: 'degrees_north' },
        ],
        values: [51, 50],
      },
      {
        name: 'longitude',
        dimensions: ['longitude'],
        type: 'float',
        attributes: [
          { name: 'standard_name', type: 'char', values: 'longitude' },
          { name: 'units', type: 'char', values: 'degrees_east' },
        ],
        values: [-2, -1, 0],
      },
      {
        name: 'temperature',
        dimensions: ['latitude', 'longitude'],
        type: 'short',
        attributes: [{ name: 'units', type: 'char', values: 'K' }],
        values: [280, 281, 282, 283, 284, 285],
      },
    ],
  })
  if (fixture.bytes === undefined) throw new Error('Browser NetCDF fixture was not materialized')
  const browserBytes = new Uint8Array(fixture.bytes.byteLength)
  browserBytes.set(fixture.bytes)
  const document = await geoNetCdfReader.open(
    createScientificFileContext(new File([browserBytes], 'browser-grid.nc')),
  )
  const dataset = await document.openDataset('temperature')
  const view = dataset.createView({
    spatialDimensions: ['longitude', 'latitude'],
    nonSpatial: [],
    sourceBands: [0],
    levelId: '0',
  })
  const values: number[] = []
  for await (const tile of view.readPixelRegion({
    region: { x: 1, y: 0, width: 2, height: 2 },
  })) {
    values.push(...Array.from(tile.data, Number))
    tile.release()
  }
  if (
    values.join(',') !== '281,282,284,285' ||
    dataset.descriptor.grid.pixelToWorld.join(',') !== '1,0,-2,0,-1,51'
  ) {
    throw new Error(`Browser NetCDF result was ${values.join(',')}`)
  }
  await document.close?.()
  return {
    detail:
      'portable classic NetCDF reader selected a bounded CF grid viewport from a browser File',
    outputBytes: values.length * 2,
  }
}

const worldFileRaster = async (): Promise<BrowserWorkflowResult> => {
  const image = new File([await fetchBytes('/fixtures/benchmark-input.png')], 'browser-map.png', {
    type: 'image/png',
  })
  const world = new File(
    [new TextEncoder().encode('2\n-0.25\n0.5\n-3\n100\n200')],
    'browser-map.pgw',
    { type: 'text/plain' },
  )
  const wkt = 'GEOGCS["WGS 84",AUTHORITY["EPSG","4326"]]'
  const prj = new File([new TextEncoder().encode(wkt)], 'browser-map.prj', {
    type: 'text/plain',
  })
  const document = await worldFileReader.open(
    createScientificFileContext(image, { companions: [world, prj] }),
  )
  const dataset = await document.openDataset('image')
  const affine = dataset.descriptor.grid.pixelToWorld
  const evidence = dataset.descriptor.spatialReference.evidence
  const originalWkt = evidence.find((item) => item.locator === 'browser-map.prj')?.metadata
    ?.originalWkt
  if (
    affine.join(',') !== '2,0.5,98.75,-0.25,-3,201.625' ||
    dataset.descriptor.grid.pixelRegistration !== 'pixel-is-area' ||
    originalWkt !== wkt
  ) {
    throw new Error(`Browser world-file result was ${affine.join(',')}`)
  }
  const view = dataset.createView({
    spatialDimensions: ['x', 'y'],
    nonSpatial: [],
    sourceBands: [0],
    levelId: '0',
  })
  let outputBytes = 0
  for await (const tile of view.readPixelRegion({
    region: { x: 2, y: 3, width: 1, height: 1 },
  })) {
    outputBytes += tile.data.byteLength
    tile.release()
  }
  await document.close?.()
  return {
    detail: 'portable PNG decoding and bounded File companions produced a world-file Geo raster',
    outputBytes,
  }
}

const scientificTiaEmi = async (): Promise<BrowserWorkflowResult> => {
  const emi = generateTiaEmiFixture([
    generatedTiaEmiObject({
      uuid: 'browser-emi-object',
      mode: 'TEM EELS',
      microscope: 'Browser microscope',
      acceleratingVoltageVolts: 200_000,
    }),
  ])
  const primary = new File([Uint8Array.from(emi)], 'browser-capture.emi', {
    type: 'application/x-tia-emi',
  })
  const companion = new File(
    [Uint8Array.from(generatedTiaSerPointSpectrum())],
    'browser-capture_1.ser',
    {
      type: 'application/x-tia-ser',
    },
  )
  const document = await createScientificLibrary({ readers: [tiaEmiReader] }).open(
    createScientificFileContext(primary, { companions: [companion] }),
  )
  const summary = document.datasets[0]
  if (
    summary?.id !== 'ser-1/spectra' ||
    summary.identity.resources.length !== 2 ||
    summary.descriptor.metadata?.['purejsimage:tiaEmi'] === undefined
  ) {
    throw new Error('Browser TIA EMI did not preserve companion identity and metadata')
  }
  const dataset = await document.openDataset(summary.id)
  if (dataset.readSeries === undefined) throw new Error('Browser TIA EMI lacks native series reads')
  const output: number[] = []
  for await (const block of dataset.readSeries({
    axisId: 'energy',
    fixedIndices: [],
    start: 0,
    length: 4,
  })) {
    output.push(...block.data)
  }
  if (output.join(',') !== '0,0,0,1,255,255,255,254,0,0,0,3,0,0,0,4') {
    throw new Error(`Browser TIA EMI spectrum pixels were ${output.join(',')}`)
  }
  return {
    detail: 'portable TIA EMI reader resolved a browser File companion with metadata and identity',
    outputBytes: output.length,
  }
}

const browserConstantGrayCmykProfile = (): Uint8Array => {
  const tagOffset = 144
  const tagBytes = 176
  const profile = new Uint8Array(tagOffset + tagBytes)
  const view = new DataView(profile.buffer)
  const signature = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      profile[offset + index] = value.charCodeAt(index)
    }
  }
  view.setUint32(0, profile.byteLength, false)
  signature(12, 'mntr')
  signature(16, 'CMYK')
  signature(20, 'XYZ ')
  signature(36, 'acsp')
  view.setUint32(128, 1, false)
  signature(132, 'A2B0')
  view.setUint32(136, tagOffset, false)
  view.setUint32(140, tagBytes, false)
  signature(tagOffset, 'mft2')
  profile[tagOffset + 8] = 4
  profile[tagOffset + 9] = 3
  profile[tagOffset + 10] = 2
  view.setInt32(tagOffset + 12, 65_536, false)
  view.setInt32(tagOffset + 28, 65_536, false)
  view.setInt32(tagOffset + 44, 65_536, false)
  view.setUint16(tagOffset + 48, 2, false)
  view.setUint16(tagOffset + 50, 2, false)
  let offset = tagOffset + 52
  for (let channel = 0; channel < 4; channel += 1) {
    view.setUint16(offset, 0, false)
    view.setUint16(offset + 2, 65_535, false)
    offset += 4
  }
  for (let point = 0; point < 16; point += 1) {
    for (const xyz of [15_797, 16_384, 13_515]) {
      view.setUint16(offset, xyz, false)
      offset += 2
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    view.setUint16(offset, 0, false)
    view.setUint16(offset + 2, 65_535, false)
    offset += 4
  }
  return profile
}

const browserPyramidTiffFixture = (): Uint8Array => {
  const rootIfdOffset = 8
  const entriesPerIfd = 11
  const ifdBytes = 2 + entriesPerIfd * 12 + 4
  const levelIfdOffset = rootIfdOffset + ifdBytes
  const rootPixelOffset = levelIfdOffset + ifdBytes
  const levelPixelOffset = rootPixelOffset + 4
  const output = new Uint8Array(levelPixelOffset + 1)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, rootIfdOffset, true)
  const writeIfd = (
    offset: number,
    entries: readonly {
      readonly tag: number
      readonly type: 3 | 4
      readonly value: number
    }[],
  ): void => {
    view.setUint16(offset, entries.length, true)
    const sorted = [...entries].sort((left, right) => left.tag - right.tag)
    for (let index = 0; index < sorted.length; index += 1) {
      const entry = sorted[index]
      if (!entry) continue
      const entryOffset = offset + 2 + index * 12
      view.setUint16(entryOffset, entry.tag, true)
      view.setUint16(entryOffset + 2, entry.type, true)
      view.setUint32(entryOffset + 4, 1, true)
      if (entry.type === 3) view.setUint16(entryOffset + 8, entry.value, true)
      else view.setUint32(entryOffset + 8, entry.value, true)
    }
  }
  const imageEntries = (
    width: number,
    height: number,
    pixelOffset: number,
  ): {
    readonly tag: number
    readonly type: 3 | 4
    readonly value: number
  }[] => [
    { tag: 256, type: 4, value: width },
    { tag: 257, type: 4, value: height },
    { tag: 258, type: 3, value: 8 },
    { tag: 259, type: 3, value: 1 },
    { tag: 262, type: 3, value: 1 },
    { tag: 273, type: 4, value: pixelOffset },
    { tag: 277, type: 3, value: 1 },
    { tag: 278, type: 4, value: height },
    { tag: 279, type: 4, value: width * height },
    { tag: 284, type: 3, value: 1 },
  ]
  writeIfd(rootIfdOffset, [
    ...imageEntries(2, 2, rootPixelOffset),
    { tag: 330, type: 4, value: levelIfdOffset },
  ])
  writeIfd(levelIfdOffset, [
    { tag: 254, type: 4, value: 1 },
    ...imageEntries(1, 1, levelPixelOffset),
  ])
  output.set([1, 2, 3, 4], rootPixelOffset)
  output[levelPixelOffset] = 222
  return output
}

const packBrowserTiffLzw = (values: Uint8Array): Uint8Array => {
  const codes = [256, ...values, 257]
  const output = new Uint8Array(Math.ceil((codes.length * 9) / 8))
  let bitOffset = 0
  for (const code of codes) {
    for (let bit = 8; bit >= 0; bit -= 1) {
      if ((code & (1 << bit)) !== 0) {
        const byte = bitOffset >>> 3
        output[byte] = (output[byte] ?? 0) | (1 << (7 - (bitOffset & 7)))
      }
      bitOffset += 1
    }
  }
  return output
}

const packBrowserFaxBits = (bits: string): Uint8Array => {
  const output = new Uint8Array(Math.ceil(bits.length / 8))
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index] === '1') {
      const byte = index >>> 3
      output[byte] = (output[byte] ?? 0) | (1 << (7 - (index & 7)))
    }
  }
  return output
}
const browserZstdRawFrame = (data: Uint8Array): Uint8Array => {
  if (data.byteLength > 255) throw new Error('Browser Zstandard fixture is too large')
  const output = new Uint8Array(data.byteLength + 9)
  output.set([0x28, 0xb5, 0x2f, 0xfd, 0x20, data.byteLength])
  const blockHeader = (data.byteLength << 3) | 1
  output[6] = blockHeader & 0xff
  output[7] = (blockHeader >>> 8) & 0xff
  output[8] = blockHeader >>> 16
  output.set(data, 9)
  return output
}

const legacyTiffAndBmp = async (): Promise<BrowserWorkflowResult> => {
  const encoded = atob(
    'SUkqAAgAAAAKAAABBAABAAAALAEAAAEBBAABAAAAAQAAAAIBAwABAAAACAAAAAMBAwABAAAABQAAAAYBAwABAAAAAQAAABEBBAABAAAAhgAAABUBAwABAAAAAQAAABYBBAABAAAAAQAAABcBBAABAAAAWgEAABwBAwABAAAAAQAAAAAAAAAAAQQQMIBAAQMHECRQsIBBAwcPIESQMIFCBQsXMGTQsIFDBw8fQIQQMYJECRMnUKRQsYJFCxcvYMSQMYNGDRs3cOTQsYNHDx8/gAQRMoRIESNHkCRRsoRJEydPoESRMoVKFStXsGTRsoVLFy9fwIQRM4ZMGTNn0KRRs4ZNGzdv4MSRM4dOHTt38OTRs4dPHz9/AAUSNIhQIUOHECVStIhRI0ePIEWSNIlSJUuXMGXStIlTJ0+fQIUSNYpUKVOnUKVStYpVK1evYMWSNYtWLVu3cOXStYtXL1+/gAUTNoxYMWPHkCVTtoxZM2fPoEWTNo1aNWvXsGXTto1bN2/fwIUTN45cOXPn0KVTt45dO3fv4MWTN49ePXv38OXTt49fP3//ABCAAAMQUIABByCQgAILMNCAAw9AEIEEE1BQgQUXYJCBBhtw0IEHH4AQgggjkFCCCSegkIIKKwQE',
  )
  const legacyTiff = Uint8Array.from(encoded, (value) => value.charCodeAt(0))
  const legacyOutput = await (await images.open(legacyTiff)).png().toUint8Array()
  const legacyPixels = await browserPixels(legacyOutput, 'image/png')
  for (const [x, expected] of [
    [0, 0],
    [255, 255],
    [299, 43],
  ] as const) {
    const offset = x * 4
    if (
      legacyPixels[offset] !== expected ||
      legacyPixels[offset + 1] !== expected ||
      legacyPixels[offset + 2] !== expected
    ) {
      throw new Error(`Legacy TIFF LZW pixel ${x} did not decode to ${expected}`)
    }
  }
  const zstdPixels = Uint8Array.of(0, 20, 80, 140, 220, 255)
  const zstdStrip = browserZstdRawFrame(zstdPixels)
  const zstdTiff = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [2] },
      { tag: 258, type: 3, values: [8] },
      { tag: 259, type: 3, values: [50_000] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [2] },
      { tag: 279, type: 4, values: [zstdStrip.byteLength] },
      { tag: 284, type: 3, values: [1] },
    ],
    [zstdStrip],
  )
  const zstdOutput = await (await images.open(zstdTiff)).png().toUint8Array()
  const decodedZstdPixels = await browserPixels(zstdOutput, 'image/png')
  for (let index = 0; index < zstdPixels.byteLength; index += 1) {
    if (decodedZstdPixels[index * 4] !== zstdPixels[index]) {
      throw new Error(`Zstandard TIFF pixel ${index} changed in the browser`)
    }
  }
  const lercStrip = await fetchBytes('/fixtures/bluemarble_256_256_3_byte.lerc2')
  const lercTiff = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [256] },
      { tag: 257, type: 4, values: [256] },
      { tag: 258, type: 3, values: [8, 8, 8] },
      { tag: 259, type: 3, values: [34_887] },
      { tag: 262, type: 3, values: [2] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 4, values: [256] },
      { tag: 279, type: 4, values: [lercStrip.byteLength] },
      { tag: 284, type: 3, values: [1] },
      { tag: 50_674, type: 4, values: [4, 0] },
    ],
    [lercStrip],
  )
  const lercOutput = await (await images.open(lercTiff)).png().toUint8Array()
  const lercPixels = await browserPixels(lercOutput, 'image/png')
  if (
    lercPixels[0] !== 1 ||
    lercPixels[1] !== 4 ||
    lercPixels[2] !== 19 ||
    lercPixels[(256 * 256 - 1) * 4] !== 0
  ) {
    throw new Error('First-party LERC TIFF pixels changed in the browser')
  }

  const entries = [
    [256, 4, 1, 2],
    [257, 3, 1, 1],
    [258, 3, 3, 0x0008_0008_0008],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 16, 1, 0],
    [277, 3, 1, 3],
    [278, 4, 1, 1],
    [279, 16, 1, 6],
    [284, 3, 1, 1],
  ] as const
  const bigTiffPixelOffset = 16 + 8 + entries.length * 20 + 8
  const bigTiff = new Uint8Array(bigTiffPixelOffset + 6)
  const bigView = new DataView(bigTiff.buffer)
  bigTiff.set([0x49, 0x49, 0x2b, 0])
  bigView.setUint16(4, 8, true)
  bigView.setBigUint64(8, 16n, true)
  bigView.setBigUint64(16, BigInt(entries.length), true)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const offset = 24 + index * 20
    bigView.setUint16(offset, entry[0], true)
    bigView.setUint16(offset + 2, entry[1], true)
    bigView.setBigUint64(offset + 4, BigInt(entry[2]), true)
    bigView.setBigUint64(
      offset + 12,
      BigInt(entry[0] === 273 ? bigTiffPixelOffset : entry[3]),
      true,
    )
    if (entry[0] === 257) bigTiff[offset + 19] = 0xff
  }
  bigTiff.set([10, 20, 30, 200, 150, 100], bigTiffPixelOffset)
  const bigOutput = await (await images.open(bigTiff)).png().toUint8Array()
  const bigPixels = await browserPixels(bigOutput, 'image/png')
  if (
    bigPixels[0] !== 10 ||
    bigPixels[1] !== 20 ||
    bigPixels[2] !== 30 ||
    bigPixels[4] !== 200 ||
    bigPixels[5] !== 150 ||
    bigPixels[6] !== 100
  ) {
    throw new Error('BigTIFF inline SHORT padding changed decoded pixels')
  }

  const tileSegments = [Uint8Array.of(10, 20), Uint8Array.of(30, 99)]
  const legacyTile = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 279, type: 4, values: [2, 2] },
      { tag: 284, type: 3, values: [1] },
      { tag: 322, type: 4, values: [2] },
      { tag: 323, type: 4, values: [1] },
    ],
    tileSegments,
  )
  const tileOutput = await (await images.open(legacyTile)).png().toUint8Array()
  const tilePixels = await browserPixels(tileOutput, 'image/png')
  if (tilePixels[0] !== 10 || tilePixels[4] !== 20 || tilePixels[8] !== 30) {
    throw new Error('Legacy TIFF tile tables in strip tags changed decoded pixels')
  }

  const faxStrip = packBrowserFaxBits('1001110011')
  const fax = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [8] },
      { tag: 257, type: 4, values: [2] },
      { tag: 258, type: 3, values: [1] },
      { tag: 259, type: 3, values: [3] },
      { tag: 262, type: 3, values: [0] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [2] },
      { tag: 279, type: 4, values: [faxStrip.byteLength] },
      { tag: 284, type: 3, values: [1] },
    ],
    [faxStrip],
  )
  const faxOutput = await (await images.open(fax)).png().toUint8Array()
  const faxPixels = await browserPixels(faxOutput, 'image/png')
  if (faxPixels[0] !== 255 || faxPixels[(8 * 2 - 1) * 4] !== 255) {
    throw new Error('TIFF Group 3 rows without EOL markers changed decoded pixels')
  }

  const ycbcrValues = [
    Uint8Array.from([10, 20, 30, 40, 128, 128, 50, 60, 70, 80, 128, 128]),
    Uint8Array.from([90, 100, 200, 200, 128, 128, 0, 0, 0, 0, 128, 128]),
  ]
  const ycbcrStrips = ycbcrValues.map(packBrowserTiffLzw)
  const ycbcr = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [2] },
      { tag: 257, type: 4, values: [5] },
      { tag: 258, type: 3, values: [8, 8, 8] },
      { tag: 259, type: 3, values: [5] },
      { tag: 262, type: 3, values: [6] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 4, values: [4] },
      { tag: 279, type: 4, values: ycbcrStrips.map((strip) => strip.byteLength) },
      { tag: 284, type: 3, values: [1] },
      { tag: 530, type: 3, values: [2, 2] },
    ],
    ycbcrStrips,
  )
  const ycbcrOutput = await (await images.open(ycbcr)).png().toUint8Array()
  const ycbcrPixels = await browserPixels(ycbcrOutput, 'image/png')
  const lastRow = 4 * 2 * 4
  if (
    ycbcrPixels[lastRow] !== 90 ||
    ycbcrPixels[lastRow + 1] !== 90 ||
    ycbcrPixels[lastRow + 4] !== 100 ||
    ycbcrPixels[lastRow + 5] !== 100
  ) {
    throw new Error('Bounded TIFF YCbCr LZW strip padding changed decoded pixels')
  }

  const packed12 = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [12] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [5] },
      { tag: 284, type: 3, values: [1] },
    ],
    [Uint8Array.of(0, 8, 0, 0xff, 0xf0)],
  )
  const packedOutput = await (await images.open(packed12)).png().toUint8Array()
  const packedPixels = await browserPixels(packedOutput, 'image/png')
  if (packedPixels[0] !== 0 || packedPixels[4] !== 128 || packedPixels[8] !== 255) {
    throw new Error('Packed 12-bit TIFF samples did not preserve their full range')
  }

  const signed8 = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [3] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [2] },
    ],
    [Uint8Array.of(0x80, 0, 0x7f)],
  )
  const signedOutput = await (await images.open(signed8)).png().toUint8Array()
  const signedPixels = await browserPixels(signedOutput, 'image/png')
  if (signedPixels[0] !== 0 || signedPixels[4] !== 128 || signedPixels[8] !== 255) {
    throw new Error(
      `Signed 8-bit TIFF display conversion changed in the browser: ${signedPixels[0]},${signedPixels[4]},${signedPixels[8]}`,
    )
  }

  const floatSamples = new Uint8Array(12)
  const floatView = new DataView(floatSamples.buffer)
  floatView.setFloat32(0, 0, true)
  floatView.setFloat32(4, 0.5, true)
  floatView.setFloat32(8, 1, true)
  const float32 = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [32] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [floatSamples.byteLength] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [3] },
    ],
    [floatSamples],
  )
  const floatOutput = await (await images.open(float32)).png().toUint8Array()
  const floatPixels = await browserPixels(floatOutput, 'image/png')
  if (floatPixels[0] !== 0 || floatPixels[4] !== 127 || floatPixels[8] !== 255) {
    throw new Error(
      `Float32 TIFF display conversion changed in the browser: ${floatPixels[0]},${floatPixels[4]},${floatPixels[8]}`,
    )
  }

  const signedCmyk = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [4] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8, 8, 8, 8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [5] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [4] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [16] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [2, 2, 2, 2] },
    ],
    [
      Uint8Array.of(
        0x80,
        0x80,
        0x80,
        0x80,
        0x7f,
        0x80,
        0x80,
        0x80,
        0x80,
        0x80,
        0x80,
        0x7f,
        0,
        0xc0,
        0x80,
        0,
      ),
    ],
  )
  const signedCmykOutput = await (await images.open(signedCmyk)).png().toUint8Array()
  const signedCmykPixels = await browserPixels(signedCmykOutput, 'image/png')
  if (
    signedCmykPixels[0] !== 255 ||
    signedCmykPixels[4] !== 0 ||
    signedCmykPixels[5] !== 255 ||
    signedCmykPixels[6] !== 255 ||
    signedCmykPixels[8] !== 0 ||
    signedCmykPixels[9] !== 0 ||
    signedCmykPixels[10] !== 0 ||
    signedCmykPixels[12] !== 63 ||
    signedCmykPixels[13] !== 95 ||
    signedCmykPixels[14] !== 127
  ) {
    throw new Error('Signed CMYK TIFF display conversion changed in the browser')
  }

  const floatCmykSamples = new Uint8Array(64)
  const floatCmykView = new DataView(floatCmykSamples.buffer)
  const floatCmykValues = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0.5, 0.25, 0, 0.5]
  for (let index = 0; index < floatCmykValues.length; index += 1) {
    floatCmykView.setFloat32(index * 4, floatCmykValues[index] ?? 0, true)
  }
  const floatCmyk = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [4] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [32, 32, 32, 32] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [5] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [4] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [floatCmykSamples.byteLength] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [3, 3, 3, 3] },
    ],
    [floatCmykSamples],
  )
  const floatCmykOutput = await (await images.open(floatCmyk)).png().toUint8Array()
  const floatCmykPixels = await browserPixels(floatCmykOutput, 'image/png')
  if (
    floatCmykPixels[0] !== 255 ||
    floatCmykPixels[4] !== 0 ||
    floatCmykPixels[5] !== 255 ||
    floatCmykPixels[6] !== 255 ||
    floatCmykPixels[8] !== 0 ||
    floatCmykPixels[9] !== 0 ||
    floatCmykPixels[10] !== 0 ||
    floatCmykPixels[12] !== 64 ||
    floatCmykPixels[13] !== 96 ||
    floatCmykPixels[14] !== 128
  ) {
    throw new Error('Float32 CMYK TIFF display conversion changed in the browser')
  }

  const cieLab = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8, 8, 8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [8] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [9] },
      { tag: 284, type: 3, values: [1] },
    ],
    [Uint8Array.of(0, 0, 0, 138, 81, 70, 75, 68, 144)],
  )
  const cieLabOutput = await (await images.open(cieLab)).png().toUint8Array()
  const cieLabPixels = await browserPixels(cieLabOutput, 'image/png')
  if (
    cieLabPixels[0] !== 0 ||
    cieLabPixels[1] !== 0 ||
    cieLabPixels[2] !== 0 ||
    cieLabPixels[4] !== 255 ||
    cieLabPixels[5] !== 1 ||
    cieLabPixels[6] !== 0 ||
    cieLabPixels[8] !== 0 ||
    cieLabPixels[9] !== 34 ||
    cieLabPixels[10] !== 254
  ) {
    throw new Error('CIELab TIFF color conversion changed in the browser')
  }

  const cmykIccProfile = browserConstantGrayCmykProfile()
  const cmykIcc = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [1] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8, 8, 8, 8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [5] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [4] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [4] },
      { tag: 284, type: 3, values: [1] },
      { tag: 34675, type: 7, values: Array.from(cmykIccProfile) },
    ],
    [Uint8Array.of(255, 0, 0, 0)],
  )
  const cmykIccOutput = await (await images.open(cmykIcc)).png().toUint8Array()
  const cmykIccPixels = await browserPixels(cmykIccOutput, 'image/png')
  if (cmykIccPixels[0] !== 188 || cmykIccPixels[1] !== 188 || cmykIccPixels[2] !== 187) {
    throw new Error(
      `CMYK ICC TIFF color conversion changed in the browser: ${cmykIccPixels[0]},${cmykIccPixels[1]},${cmykIccPixels[2]}`,
    )
  }

  const fillOrder = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [6] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 266, type: 3, values: [2] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [3] },
      { tag: 284, type: 3, values: [1] },
    ],
    [Uint8Array.of(0x40, 0xf0, 0x03)],
  )
  const fillOrderOutput = await (await images.open(fillOrder)).png().toUint8Array()
  const fillOrderPixels = await browserPixels(fillOrderOutput, 'image/png')
  if (fillOrderPixels[0] !== 0 || fillOrderPixels[4] !== 129 || fillOrderPixels[8] !== 255) {
    throw new Error('FillOrder 2 packed TIFF decoding changed in the browser')
  }

  const paletteColors = 65_536
  const colorMap = new Array<number>(paletteColors * 3).fill(0)
  colorMap[paletteColors] = 65_535
  colorMap[0x1234] = 0xab00
  colorMap[paletteColors + 0x1234] = 0xcd00
  colorMap[paletteColors * 2 + 0x1234] = 0xef00
  colorMap[0xffff] = 65_535
  const palette16 = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [16] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [3] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [6] },
      { tag: 284, type: 3, values: [1] },
      { tag: 320, type: 3, values: colorMap },
    ],
    [Uint8Array.of(0, 0, 0x34, 0x12, 0xff, 0xff)],
  )
  const palette16Output = await (await images.open(palette16)).png().toUint8Array()
  const palette16Pixels = await browserPixels(palette16Output, 'image/png')
  if (
    palette16Pixels[0] !== 0 ||
    palette16Pixels[1] !== 255 ||
    palette16Pixels[2] !== 0 ||
    palette16Pixels[4] !== 170 ||
    palette16Pixels[5] !== 204 ||
    palette16Pixels[6] !== 238 ||
    palette16Pixels[8] !== 255 ||
    palette16Pixels[9] !== 0 ||
    palette16Pixels[10] !== 0
  ) {
    throw new Error('16-bit palette TIFF display conversion changed in the browser')
  }

  const wide64Samples = Uint8Array.of(
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0x80,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
  )
  const wide64 = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [64] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [wide64Samples.byteLength] },
      { tag: 284, type: 3, values: [1] },
    ],
    [wide64Samples],
  )
  const wide64Output = await (await images.open(wide64)).png().toUint8Array()
  const wide64Pixels = await browserPixels(wide64Output, 'image/png')
  if (wide64Pixels[0] !== 0 || wide64Pixels[4] !== 127 || wide64Pixels[8] !== 255) {
    throw new Error(
      `Unsigned 64-bit TIFF display conversion changed in the browser: ${wide64Pixels[0]},${wide64Pixels[4]},${wide64Pixels[8]}`,
    )
  }

  const logLStrip = Uint8Array.of(4, 0, 0x3f, 0xbf, 0x40, 130, 0)
  const logL = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [4] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [16] },
      { tag: 259, type: 3, values: [34676] },
      { tag: 262, type: 3, values: [32844] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [logLStrip.byteLength] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [2] },
    ],
    [logLStrip],
  )
  const logLOutput = await (await images.open(logL)).png().toUint8Array()
  const logLPixels = await browserPixels(logLOutput, 'image/png')
  if (
    logLPixels[0] !== 0 ||
    logLPixels[4] !== 181 ||
    logLPixels[8] !== 0 ||
    logLPixels[12] !== 255
  ) {
    throw new Error(
      `SGILog TIFF display conversion changed in the browser: ${logLPixels[0]},${logLPixels[4]},${logLPixels[8]},${logLPixels[12]}`,
    )
  }

  const embeddedWebp = await (await images.open(legacyOutput))
    .webp({ lossless: true })
    .toUint8Array()
  const webpTiff = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [300] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8, 8, 8] },
      { tag: 259, type: 3, values: [50001] },
      { tag: 262, type: 3, values: [2] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [embeddedWebp.byteLength] },
      { tag: 284, type: 3, values: [1] },
    ],
    [embeddedWebp],
  )
  const webpTiffOutput = await (await composedTiffImages.open(webpTiff)).png().toUint8Array()
  const webpTiffPixels = await browserPixels(webpTiffOutput, 'image/png')
  for (const x of [0, 255, 299]) {
    const offset = x * 4
    if (
      webpTiffPixels[offset] !== legacyPixels[offset] ||
      webpTiffPixels[offset + 1] !== legacyPixels[offset + 1] ||
      webpTiffPixels[offset + 2] !== legacyPixels[offset + 2]
    ) {
      throw new Error(`Explicit WebP-in-TIFF composition changed browser pixel ${x}`)
    }
  }

  const pyramid = browserPyramidTiffFixture()
  const pyramidImage = await images.open(pyramid, { resolutionLevel: 1 })
  const pyramidMetadata = await pyramidImage.metadata()
  if (
    pyramidMetadata.width !== 1 ||
    pyramidMetadata.height !== 1 ||
    pyramidMetadata.resolutionLevels !== 2
  ) {
    throw new Error('TIFF SubIFD metadata did not report the selected pyramid level')
  }
  const pyramidOutput = await pyramidImage.png().toUint8Array()
  const pyramidPixels = await browserPixels(pyramidOutput, 'image/png')
  if (
    pyramidPixels[0] !== 222 ||
    pyramidPixels[1] !== 222 ||
    pyramidPixels[2] !== 222 ||
    pyramidPixels[3] !== 255
  ) {
    throw new Error('TIFF SubIFD selection changed browser pixels')
  }

  const bmp = new Uint8Array(76)
  const bmpView = new DataView(bmp.buffer)
  bmp.set([0x42, 0x4d])
  bmpView.setUint32(2, bmp.byteLength, true)
  bmpView.setUint32(10, 70, true)
  bmpView.setUint32(14, 40, true)
  bmpView.setInt32(18, 3, true)
  bmpView.setInt32(22, 1, true)
  bmpView.setUint16(26, 1, true)
  bmpView.setUint16(28, 4, true)
  bmpView.setUint32(30, 2, true)
  bmpView.setUint32(34, 6, true)
  bmpView.setUint32(46, 4, true)
  bmp.set([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0], 54)
  bmp.set([4, 0x12, 0, 0, 0, 1], 70)
  const bmpOutput = await (await images.open(bmp)).png().toUint8Array()
  const bmpPixels = await browserPixels(bmpOutput, 'image/png')
  if (
    bmpPixels[0] !== 0 ||
    bmpPixels[1] !== 255 ||
    bmpPixels[2] !== 0 ||
    bmpPixels[4] !== 0 ||
    bmpPixels[5] !== 0 ||
    bmpPixels[6] !== 255 ||
    bmpPixels[8] !== 0 ||
    bmpPixels[9] !== 255 ||
    bmpPixels[10] !== 0
  ) {
    throw new Error('Odd-width RLE4 padding changed decoded BMP pixels')
  }

  return {
    detail:
      'legacy TIFF LZW, first-party Zstandard and LERC, packed 12-bit and FillOrder 2 TIFF, signed, float, numeric and ICC-managed CMYK, CIELab, 16-bit palette, wide unsigned, and SGILog TIFF, TIFF SubIFD pyramids, explicit WebP-in-TIFF, tile aliases, no-EOL Group 3, padded YCbCr LZW, BigTIFF inline values, and odd-width BMP RLE4 decoded exactly',
    outputBytes:
      legacyOutput.byteLength +
      zstdOutput.byteLength +
      lercOutput.byteLength +
      wide64Output.byteLength +
      packedOutput.byteLength +
      webpTiffOutput.byteLength +
      signedOutput.byteLength +
      floatOutput.byteLength +
      signedCmykOutput.byteLength +
      floatCmykOutput.byteLength +
      cieLabOutput.byteLength +
      cmykIccOutput.byteLength +
      fillOrderOutput.byteLength +
      palette16Output.byteLength +
      logLOutput.byteLength +
      pyramidOutput.byteLength +
      bigOutput.byteLength +
      tileOutput.byteLength +
      faxOutput.byteLength +
      ycbcrOutput.byteLength +
      bmpOutput.byteLength,
  }
}

const rgbPsnr = (expected: Uint8ClampedArray, actual: Uint8ClampedArray): number => {
  if (actual.byteLength !== expected.byteLength) {
    throw new Error(`Browser pixel lengths differ: ${actual.byteLength} != ${expected.byteLength}`)
  }
  let squaredError = 0
  let samples = 0
  for (let offset = 0; offset < expected.byteLength; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = (actual[offset + channel] ?? 0) - (expected[offset + channel] ?? 0)
      squaredError += difference * difference
      samples += 1
    }
  }
  return squaredError === 0
    ? Number.POSITIVE_INFINITY
    : 10 * Math.log10((255 * 255 * samples) / squaredError)
}

const webpLossless = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/webp-graphic.png')
  const output = await (await images.open(input)).webp({ lossless: true, effort: 6 }).toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'webp' || metadata.width !== 192 || metadata.height !== 128) {
    throw new Error(
      `Lossless WebP output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const sourcePixels = await browserPixels(input, 'image/png')
  const decoded = await (await images.open(output)).png().toUint8Array()
  const outputPixels = await browserPixels(decoded, 'image/png')
  if (sourcePixels.length !== outputPixels.length)
    throw new Error('Lossless WebP pixel size changed')
  for (let offset = 0; offset < sourcePixels.length; offset += 1) {
    if (sourcePixels[offset] !== outputPixels[offset]) {
      throw new Error(`Lossless WebP changed browser pixel ${offset}`)
    }
  }
  const nearOutput = await (await images.open(input))
    .webp({ lossless: true, effort: 3, nearLossless: 80 })
    .toUint8Array()
  const nearMetadata = await outputMetadata(nearOutput)
  if (nearMetadata.format !== 'webp' || nearMetadata.width !== 192 || nearMetadata.height !== 128) {
    throw new Error(
      `Near-lossless WebP output was ${nearMetadata.format} ${nearMetadata.width}x${nearMetadata.height}`,
    )
  }
  const nearDecoded = await (await images.open(nearOutput)).png().toUint8Array()
  const nearPixels = await browserPixels(nearDecoded, 'image/png')
  for (let offset = 0; offset < sourcePixels.length; offset += 1) {
    if (Math.abs((sourcePixels[offset] ?? 0) - (nearPixels[offset] ?? 0)) > 1) {
      throw new Error(`Near-lossless WebP exceeded one-value error at browser pixel ${offset}`)
    }
  }
  return {
    detail:
      'first-party lossless WebP matched browser RGBA pixels; effort and near-lossless controls passed',
    outputBytes: output.byteLength + nearOutput.byteLength,
  }
}

const jpeg2000Decode = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/openjpeg-lossless-rgb16.jp2')
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 17 || metadata.height !== 13) {
    throw new Error(
      `Browser JPEG 2000 decode produced ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const pixels = await portablePngPixels(output)
  const digest = await sha256(pixels)
  if (digest !== '4750925af7e10c4b3ec572ee014ddf8a4995d5bea92e06a8d6e7d91ec4568acc') {
    throw new Error(`Browser JPEG 2000 RGBA hash was ${digest}`)
  }
  return {
    detail: 'first-party JPEG 2000 matched the pinned portable RGBA output',
    outputBytes: output.byteLength,
  }
}

const webpLossyDecode = async (): Promise<BrowserWorkflowResult> => {
  const encoded = atob(
    'UklGRqQAAABXRUJQVlA4IJgAAABwBACdASogABgAPmUmj0WkIiEb/VQAQAZEs4BmwkBKSJFI4AHVyHQgWMclgAD+/qV1+gM5jXoqf8T/xA/L7f0lia3y/8Hn4WHFIQuFlP1xw1tSDx+ucwX+ndmTYQ35mZkrIBYOX9PWp0ByLB1fAb9EWwcebp60J6lOM+Wjvcp762MmOBNj6axIrCC/NsuuSyHsh32LLNAAAA==',
  )
  const input = Uint8Array.from(encoded, (value) => value.charCodeAt(0))
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 32 || metadata.height !== 24) {
    throw new Error(`Lossy WebP decode was ${metadata.format} ${metadata.width}x${metadata.height}`)
  }
  const pixels = await browserPixels(output, 'image/png')
  const center = (12 * 32 + 16) * 4
  if (
    Math.abs((pixels[center] ?? 0) - 149) > 18 ||
    Math.abs((pixels[center + 1] ?? 0) - 171) > 18 ||
    Math.abs((pixels[center + 2] ?? 0) - 189) > 18
  ) {
    throw new Error('Lossy WebP center pixel is outside the validated tolerance')
  }
  return {
    detail: 'first-party lossy WebP macroblock rows decoded to 32x24 PNG',
    outputBytes: output.byteLength,
  }
}

const avifEncode = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/alpha.png')
  const encoded = await (await images.open(input)).avif({ background: '#204060' }).toUint8Array()
  const metadata = await (await images.open(encoded)).metadata()
  if (
    metadata.format !== 'avif' ||
    metadata.width !== 4 ||
    metadata.height !== 3 ||
    metadata.hasAlpha
  ) {
    throw new Error(
      `Browser AVIF encode produced ${metadata.format} ${metadata.width}x${metadata.height} alpha=${metadata.hasAlpha}`,
    )
  }
  const encodedHash = await sha256(encoded)
  if (encodedHash !== '5e81045f4d8806506a65991a413169fd0488a0ab8e8b1e15c4f5b0081cba742e') {
    throw new Error(`Browser AVIF encoded hash was ${encodedHash}`)
  }
  const portablePng = await (await images.open(encoded)).png().toUint8Array()
  const portablePixels = await portablePngPixels(portablePng)
  const portableHash = await sha256(portablePixels)
  if (portableHash !== '1dfeb910ff1550707761d89117b07207aff069940c60665c61667b5aaac2f9c5') {
    throw new Error(`Browser AVIF portable RGBA hash was ${portableHash}`)
  }
  const nativePixels = await browserPixels(encoded, 'image/avif')
  if (nativePixels.byteLength !== portablePixels.byteLength) {
    throw new Error('Browser-native AVIF decode dimensions changed')
  }
  let maximumRgbDifference = 0
  for (let offset = 0; offset < nativePixels.byteLength; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      maximumRgbDifference = Math.max(
        maximumRgbDifference,
        Math.abs((nativePixels[offset + channel] ?? 0) - (portablePixels[offset + channel] ?? 0)),
      )
    }
  }
  if (maximumRgbDifference > 48) {
    throw new Error(`Browser-native AVIF maximum RGB difference was ${maximumRgbDifference}`)
  }
  return {
    detail: `first-party AVIF encode round-tripped through portable and browser-native decoders (maximum RGB difference ${maximumRgbDifference})`,
    outputBytes: encoded.byteLength,
  }
}

const avifPinnedPng = async (
  file: string,
  width: number,
  height: number,
  expectedSha256: string,
  detail: string,
  chromium?: {
    readonly maximumRgbDifference: number
    readonly rgbaSha256: string
  },
): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes(`/fixtures/${file}`)
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== width || metadata.height !== height) {
    throw new Error(`${detail} output was ${metadata.format} ${metadata.width}x${metadata.height}`)
  }
  const outputPixels = await portablePngPixels(output)
  const outputSha256 = await sha256(outputPixels)
  if (outputSha256 !== expectedSha256) {
    throw new Error(`${detail} portable RGBA hash was ${outputSha256}`)
  }
  let chromiumDetail = ''
  if (chromium !== undefined && navigator.userAgent.includes('Chrome/')) {
    const chromiumPixels = await browserPixels(input, 'image/avif')
    if (chromiumPixels.byteLength !== outputPixels.byteLength) {
      throw new Error(`${detail} Chromium RGBA dimensions changed`)
    }
    const chromiumSha256 = await sha256(chromiumPixels)
    if (chromiumSha256 !== chromium.rgbaSha256) {
      throw new Error(`${detail} Chromium RGBA hash was ${chromiumSha256}`)
    }
    let maximumRgbDifference = 0
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        maximumRgbDifference = Math.max(
          maximumRgbDifference,
          Math.abs(
            (outputPixels[pixel * 4 + channel] ?? 0) - (chromiumPixels[pixel * 4 + channel] ?? 0),
          ),
        )
      }
    }
    if (maximumRgbDifference !== chromium.maximumRgbDifference) {
      throw new Error(`${detail} maximum Chromium RGB difference was ${maximumRgbDifference}`)
    }
    chromiumDetail = ` and pinned Chromium RGBA output (maximum RGB difference ${maximumRgbDifference})`
  }
  return {
    detail: `${detail} matched the pinned portable RGBA output${chromiumDetail}`,
    outputBytes: output.byteLength,
  }
}

const avifImir = async (): Promise<BrowserWorkflowResult> => {
  const fixtures = [
    {
      file: 'libavif-imir-axis0-160x160.avif',
      portableWidth: 160,
      portableHeight: 160,
      portableSha256: 'ecc5d7baa51289462eb57ed3e9e2202872d4e24438849531f15b04d0d1d8cc8a',
      chromiumWidth: 160,
      chromiumHeight: 160,
      chromiumSha256: 'ecc5d7baa51289462eb57ed3e9e2202872d4e24438849531f15b04d0d1d8cc8a',
    },
    {
      file: 'libavif-imir-axis1-160x160.avif',
      portableWidth: 160,
      portableHeight: 160,
      portableSha256: '150d389f0f9ec73685c3b301933f344e68d045114e96b06d4e09c2ae2d056569',
      chromiumWidth: 160,
      chromiumHeight: 160,
      chromiumSha256: '150d389f0f9ec73685c3b301933f344e68d045114e96b06d4e09c2ae2d056569',
    },
    {
      file: 'libavif-imir-clap-irot-grid-alpha-160x160.avif',
      portableWidth: 96,
      portableHeight: 112,
      portableSha256: 'b3cca86fed0bf074641663fea9611be3ed3a217498b0095864300df265acf533',
      chromiumWidth: 160,
      chromiumHeight: 160,
      chromiumSha256: '5f22a0d268ac2f295e8c8d2fbaa90267a04ea03f5597eb782cf4210738ee9d1f',
    },
  ] as const
  let outputBytes = 0
  for (const fixture of fixtures) {
    const input = await fetchBytes(`/fixtures/${fixture.file}`)
    const output = await (await images.open(input)).autoOrient().png().toUint8Array()
    const metadata = await outputMetadata(output)
    if (
      metadata.format !== 'png' ||
      metadata.width !== fixture.portableWidth ||
      metadata.height !== fixture.portableHeight
    ) {
      throw new Error(
        `${fixture.file} auto-oriented output was ${metadata.format} ${metadata.width}x${metadata.height}`,
      )
    }
    const portableHash = await sha256(await portablePngPixels(output))
    if (portableHash !== fixture.portableSha256) {
      throw new Error(`${fixture.file} portable imir RGBA hash was ${portableHash}`)
    }

    if (navigator.userAgent.includes('Chrome/')) {
      const chromium = await browserImagePixels(input, 'image/avif')
      const chromiumHash = await sha256(Uint8Array.from(chromium.pixels))
      if (
        chromium.width !== fixture.chromiumWidth ||
        chromium.height !== fixture.chromiumHeight ||
        chromiumHash !== fixture.chromiumSha256
      ) {
        throw new Error(
          `${fixture.file} Chromium AVIF output was ${chromium.width}x${chromium.height} ${chromiumHash}`,
        )
      }
    }
    outputBytes += output.byteLength
  }
  return {
    detail: navigator.userAgent.includes('Chrome/')
      ? 'AVIF imir axes and clap+irot grid alpha composition matched pinned portable output; Chromium native outputs were pinned independently'
      : 'AVIF imir axes and clap+irot grid alpha composition matched pinned portable output',
    outputBytes,
  }
}

const avifAlphaStraight = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'alpha-straight-64x48.avif',
    64,
    48,
    '54633c27b86e4034c8c1916134b5bfdd3209e43344bdfbaaaa53abde94b33d02',
    'Straight-alpha AVIF',
  )

const avifAlphaPremultiplied = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'alpha-premultiplied-64x48.avif',
    64,
    48,
    '797e6c9b789c30cdedb63c7f92adc127378f21cfae36809b7eb3499456ab3457',
    'Premultiplied-alpha AVIF',
  )
const avifBoundedAlphaRows = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'bounded-row-alpha-lossless-64x192.avif',
    64,
    192,
    'a56c5a9dfcf52461d2e0000933d1215e011f2d3b82c533b2a0b8eaec8f1f1ec2',
    'Synchronized color-and-alpha-ring AVIF',
  )
const avifBoundedRows = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'bounded-row-lossless-64x192.avif',
    64,
    192,
    '7e977b27d1c17fcac0d6092bca89bc47b4ad289dbff356e38302cc9fce300287',
    'Two-superblock-ring AVIF',
  )
const avifBoundedResize = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/bounded-row-lossless-64x192.avif')
  const output = await (await images.open(input))
    .resize({ width: 16, height: 48, fit: 'fill' })
    .png()
    .toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 16 || metadata.height !== 48) {
    throw new Error(
      `Bounded-YUV AVIF resize output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const outputPixels = await browserPixels(output, 'image/png')
  const outputSha256 = await sha256(Uint8Array.from(outputPixels))
  if (outputSha256 !== '518122334ebc8a3ca083eb18eb8eb95c8de499076a30dc38a5a16d88cbd70c2b') {
    throw new Error(`Bounded-YUV AVIF resize browser RGBA hash was ${outputSha256}`)
  }
  return {
    detail: 'bounded-YUV AVIF resize matched the pinned portable RGBA output',
    outputBytes: output.byteLength,
  }
}

const avifQ0Lossless = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'lossless-q0-64x48.avif',
    64,
    48,
    'd49269082c04c18e7c81ef36bed98bbcd34dd0217e7d4042dad22801fbbbd7bf',
    'Lossless quantizer-context-0 identity-color AVIF',
  )
const avifSegmentation = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'rav1e-segmentation-q60-512x512.avif',
    512,
    512,
    '91010159de46936ec760a1b60f7f2cc62a59674a101755e308aa0c3b8bdad5ad',
    'rav1e spatial-segmentation AVIF',
  )
const avifPalette = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'draw_points_idat.avif',
    33,
    11,
    'f803b121d2471ac44b32170380ab02f8174ddf1079f9425de921dde00ac91fc7',
    'Palette-coded screen-content AVIF',
  )
const avifIntrabc = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'blue-and-magenta-crop.avif',
    180,
    100,
    'dfd67e0ae631102f05399763ccae1f0b0e639c38b38f21d000927741c089cc00',
    'Clean-aperture cropped skipped intra-block-copy AVIF',
  )
const avifResidualIntrabc = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'ms-monochrome-residual-intrabc.avif',
    1280,
    720,
    '6e036207ef682d41edad54421d20bb36ec7f03e34113e2f6fa4ab954779d71c0',
    'Residual intra-block-copy AVIF',
  )
const avifStillPictureEntropy = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'ms-Tomsk-with-thumbnails.avif',
    1280,
    720,
    '3277bbd3ada1d7dc560080465c9957bf9595ff6eaf2b023c62aca4e7a3679c3b',
    'Still-picture intra-block-copy AVIF',
  )
const avifSvtSkippedTransform = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'svt-skipped-intra-tx-size-512x512.avif',
    512,
    512,
    'f181140e5c9a4702d4c0b931ac638c83d5c7a1b5a08f85e5dd53e3e258c5e275',
    'SVT-AV1 skipped intra transform-selection AVIF',
  )

const avifRec2020 = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'libavif-colors-text-wcg-sdr-rec2020.avif',
    200,
    200,
    '087173f8afaaf7c42640d07ef6f0ab873abb494dd3a89d920b11e13b2ad66717',
    'Linear BT.2020 NCLX color-managed AVIF',
  )

const avifHdrGainMap = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'libavif-seine-hdr-gainmap-srgb.avif',
    400,
    300,
    '352475a2b3f3c60de9b6feee3f756a00cfcaa3b4ad19594ea72260064f84bc57',
    'ISO gain-map HDR-to-SDR AVIF',
  )

const avifIcc = async (): Promise<BrowserWorkflowResult> => {
  const decoded = await avifPinnedPng(
    'libavif-paris-icc-exif-xmp.avif',
    403,
    302,
    '2a283d662a75d7b522146ee8e559153b00fe16523e2958a17f988e34929e0b33',
    'RGB matrix/TRC ICC color-managed AVIF',
  )
  const input = await fetchBytes('/fixtures/libavif-paris-icc-exif-xmp.avif')
  const sourceMetadata = await avifCodec.preservedMetadata?.(
    new MemorySource(input),
    defaultImageLimits,
  )
  if (!sourceMetadata?.exif || !sourceMetadata.icc) {
    throw new Error('Pinned AVIF source did not expose EXIF and ICC metadata')
  }
  const encoded = await (await images.open(input))
    .keepExif()
    .keepIcc()
    .resize({ width: 32 })
    .avif()
    .toUint8Array()
  const encodedMetadata = await avifCodec.preservedMetadata?.(
    new MemorySource(encoded),
    defaultImageLimits,
  )
  if (
    !encodedMetadata?.exif ||
    !encodedMetadata.icc ||
    (await sha256(encodedMetadata.exif)) !== (await sha256(sourceMetadata.exif)) ||
    (await sha256(encodedMetadata.icc)) !== (await sha256(sourceMetadata.icc))
  ) {
    throw new Error('Browser AVIF re-encode did not preserve EXIF and ICC metadata')
  }
  return {
    detail: `${decoded.detail}; EXIF and ICC preserved through browser re-encode`,
    outputBytes: decoded.outputBytes + encoded.byteLength,
  }
}

const avifCleanAperture = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'clean-aperture-lossless-16x12.avif',
      8,
      6,
      'b4f3dd1a9180c53513814f078199ea69d943409cafcd1befdd90595bd66c04dc',
      'Integer-origin clean-aperture AVIF',
    ),
    avifPinnedPng(
      'linku-kimono-crop.avif',
      385,
      330,
      'cec4a971ed62d803ff8e4bb3635e2064b95e6f93868e8aab11aa0b7b15a525bf',
      'Half-integer-origin clean-aperture AVIF',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}

const avifHighBit10 = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'lossless-identity-16x12-10bpc.avif',
    16,
    12,
    '54ce76855c1541d9a61bf24e543cac163c038f47e1e441450ba359c6ceb36a1c',
    'Coded-lossless 10-bit AVIF',
  )

const avifHighBit12 = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'lossless-identity-16x12-12bpc.avif',
    16,
    12,
    '54ce76855c1541d9a61bf24e543cac163c038f47e1e441450ba359c6ceb36a1c',
    'Coded-lossless 12-bit AVIF',
  )

const avifHighBitTiles = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'tiled-lossless-10bpc-yuv444-2x2-256x256.avif',
    256,
    256,
    '50ce8c229e978291fd1ac9397ed3c7becb270c4e81eb5661759ac25b943adff5',
    'Coded-lossless 10-bit 2x2-tile AVIF',
  )

const avifExpandedHighBit = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'coded-lossless-10bpc-yuv420-32x24.avif',
      32,
      24,
      'dd5a14ac11b1c93d66f85cf2cad18c53f87e7beb3c7d53f6d41bd001fa2f0d85',
      'Coded-lossless 10-bit YUV 4:2:0 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-10bpc-yuv420-32x24.avif',
      32,
      24,
      '49fa5a03211fed7d1d0a1f7d47fd1cf3f017b2931423ed9e63597d611035087e',
      'Filter-free lossy 10-bit YUV 4:2:0 AVIF',
    ),
    avifPinnedPng(
      'coded-lossless-12bpc-yuv420-32x24.avif',
      32,
      24,
      'dcbcade0a186058362a48c34b1401d8059ac793d4cd8072eb91ff9d3d8423fba',
      'Coded-lossless 12-bit YUV 4:2:0 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-12bpc-yuv420-32x24.avif',
      32,
      24,
      '07682df7721f5e784519a6a2195f224c61fc256f9aa4f23dcf9068da115fb368',
      'Filter-free lossy 12-bit YUV 4:2:0 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-10bpc-yuv422-32x24.avif',
      32,
      24,
      'b2925f663a008378105940675c9fe1f250c25f7e07d2455ef6c3dd80d6459294',
      'Filter-free lossy 10-bit YUV 4:2:2 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-12bpc-yuv422-32x24.avif',
      32,
      24,
      '6ca5d5de7728ec1be99c4fe5bfa9a9e7458ad15f27c6d8fc4c5fcb21eb6e0baf',
      'Filter-free lossy 12-bit YUV 4:2:2 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-12bpc-yuv444-32x24.avif',
      32,
      24,
      '7b137477c628a55948b560e2af5a95c53803a8eafaccf42c64509e57251efafc',
      'Filter-free lossy 12-bit YUV 4:4:4 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-10bpc-yuv444-32x24.avif',
      32,
      24,
      '432698d3b277e8f80d0c3e1d518bd432a64aed3ff6b1ee78dbf658863fc0a818',
      'Filter-free lossy 10-bit YUV 4:4:4 AVIF',
    ),
    avifPinnedPng(
      'filtered-lossy-10bpc-yuv444-96x64.avif',
      96,
      64,
      'e9e2f8be7c4a179341c0ac312482e5a5d96b209698df253d73fcc642d65e8096',
      'Lossy 10-bit YUV 4:4:4 AVIF with deblocking, CDEF, and Wiener restoration',
    ),
    avifPinnedPng(
      'filtered-lossy-10bpc-yuv420-192x128.avif',
      192,
      128,
      '026ecbc3e3256500066f44b6bdca81dcad6ec99e674e5550cda43291a73594d1',
      'Lossy 10-bit YUV 4:2:0 AVIF with deblocking, CDEF, and Wiener restoration',
      {
        maximumRgbDifference: 3,
        rgbaSha256: '7443afcbe7796fcada187a67a6ab357241cfd0f9e7dca30aa0cb84c1af95c76d',
      },
    ),
    avifPinnedPng(
      'filtered-lossy-10bpc-yuv422-64x64.avif',
      64,
      64,
      '32e1e6c6c8f80c33c099d3cd58351a75fa63fa352177713d67b93fd7ed19d50e',
      'Lossy 10-bit YUV 4:2:2 AVIF with CDEF and Wiener restoration',
      {
        maximumRgbDifference: 3,
        rgbaSha256: 'baca323bd5540446c8e07f66aa037024dcae16e7da0a3b412eb661f25c1eaf1a',
      },
    ),
    avifPinnedPng(
      'self-guided-10bpc-yuv420-320x192.avif',
      320,
      192,
      'e382b8f0373e80e4c9abe67e9c30666db7a39b2d850b3b86af8aa5baea466f5c',
      'Lossy 10-bit YUV 4:2:0 AVIF with self-guided restoration',
      {
        maximumRgbDifference: 6,
        rgbaSha256: 'db0ce9ffa65137d06ebbc394b35f66fb3ae074b4ff9d606ed55aff50e5c62cb0',
      },
    ),
    avifPinnedPng(
      'filtered-lossy-12bpc-yuv420-64x64.avif',
      64,
      64,
      'e44124196c3e453abf158e571592c14b8388ca71875cff1be6f856916c7755f9',
      'Lossy 12-bit YUV 4:2:0 AVIF with deblocking and CDEF',
      {
        maximumRgbDifference: 158,
        rgbaSha256: '45ae308afcdea548bae4ced23d52feab9c00308d1c649986e9265acd77e7fc17',
      },
    ),
    avifPinnedPng(
      'filtered-lossy-12bpc-yuv422-64x64.avif',
      64,
      64,
      'f9b58fa7193daa31e3d4ef22349aeb67a5b1c3f802103c7c7c3fe93f889d8e87',
      'Lossy 12-bit YUV 4:2:2 AVIF with deblocking and CDEF',
      {
        maximumRgbDifference: 3,
        rgbaSha256: 'f116a8766e3887a5c9f9a965951b4edcf88d352e46db3ee3c9cce130ccb96da7',
      },
    ),
    avifPinnedPng(
      'filtered-lossy-12bpc-yuv444-64x64.avif',
      64,
      64,
      '28b88bd4ba31908bab42a410a959bb7d2831ce60572be8dbd4e4685cf3e126f3',
      'Lossy 12-bit YUV 4:4:4 AVIF with deblocking and CDEF',
      {
        maximumRgbDifference: 0,
        rgbaSha256: '28b88bd4ba31908bab42a410a959bb7d2831ce60572be8dbd4e4685cf3e126f3',
      },
    ),
    avifPinnedPng(
      'wiener-12bpc-yuv420-320x192.avif',
      320,
      192,
      '79acf6df2ce865f8ed52b187f4ce446bc5738c50c26d467293f3d2fdd0cbbed1',
      'Lossy 12-bit YUV 4:2:0 AVIF with Wiener restoration',
      {
        maximumRgbDifference: 12,
        rgbaSha256: 'c995dc8727fdb5fc7efa6a54f731c995880d0bded435dce37cf9cea0051140af',
      },
    ),
    avifPinnedPng(
      'self-guided-12bpc-yuv420-320x192.avif',
      320,
      192,
      'f124a01d322a1e0019630803aa12268333635d4e63b25b08e4f19515dfed817a',
      'Lossy 12-bit YUV 4:2:0 AVIF with self-guided restoration',
      {
        maximumRgbDifference: 13,
        rgbaSha256: '163c615b5e0a2b7e740fd29dbb98334026c9db179b16d61dedbf7ff9312d4b2f',
      },
    ),
    avifPinnedPng(
      'restoration-12bpc-yuv422-320x192.avif',
      320,
      192,
      '04ea989226d955c84a78ff1a90c19c0e26abde741ddb9a1fb89f669a5de6818e',
      'Lossy 12-bit YUV 4:2:2 AVIF with mixed self-guided and Wiener restoration',
      {
        maximumRgbDifference: 6,
        rgbaSha256: 'e3c8bc10763f70b0ede67de210abc844f34459f6d4a988ac68528e0a60f1f3ba',
      },
    ),
    avifPinnedPng(
      'restoration-12bpc-yuv444-320x192.avif',
      320,
      192,
      '5a0e8988799830bb3ace1b186757b9e2fdbf6d51aaffea30a9570c5573976d87',
      'Lossy 12-bit YUV 4:4:4 AVIF with self-guided restoration',
      {
        maximumRgbDifference: 6,
        rgbaSha256: 'eccdabe069e925d59e4c3e1e0135f82d3b5c6d3eda13355572a36a5529de8b14',
      },
    ),
    avifPinnedPng(
      'restoration-matrix-wiener-12bpc-yuv422-642x386.avif',
      642,
      386,
      '4765e211c8862752d3781a55685148d39dcd17e758e3df6f8a0ab04704279716',
      'Lossy 12-bit YUV 4:2:2 AVIF with all-plane Wiener restoration',
      {
        maximumRgbDifference: 16,
        rgbaSha256: '001678cb08643031d2d9f8c01ecb8101a1172c0a36b032013f170bf77b61b604',
      },
    ),
    avifPinnedPng(
      'restoration-matrix-sgr-12bpc-yuv422-642x386.avif',
      642,
      386,
      'f88ccd5a55623378062eee8eac32a945ad936a2d51fb59f2a923a1d5515e04b7',
      'Lossy 12-bit YUV 4:2:2 AVIF with all-plane self-guided restoration',
      {
        maximumRgbDifference: 15,
        rgbaSha256: '6214b8c8aa0a5f906b305bb447ddb52227b662aeffd573943e28d90569497437',
      },
    ),
    avifPinnedPng(
      'restoration-matrix-switchable-12bpc-yuv444-642x386.avif',
      642,
      386,
      '6670c75a5b75294ce983a46ddc9e1ad64f56577d3dfab2a66098923adbf2fc09',
      'Lossy 12-bit YUV 4:4:4 AVIF with mixed-plane switchable restoration',
      {
        maximumRgbDifference: 16,
        rgbaSha256: 'b92c4e9e5fe345deb9b863fc3cb0febae420e364bd47d82881dd7c330946e34e',
      },
    ),
    avifPinnedPng(
      'self-guided-10bpc-yuv444-320x192.avif',
      320,
      192,
      '4e2f4a1eca619ae7d00d8e9cae8956570579e909ba48796236537c235937ce6b',
      'Lossy 10-bit YUV 4:4:4 AVIF with self-guided restoration',
      {
        maximumRgbDifference: 5,
        rgbaSha256: '78f84b0dc636c9e4fa37a654a63690054075b1053de035ce5492002ae0a9a174',
      },
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}
const avifExpandedAlpha = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'xiph-alpha-limited-8bpc-2048x2048.avif',
      2048,
      2048,
      '8264cd14f144270bc3594da6f02ef3c6b22658e93a0844f660ac8648871e8d1a',
      'Limited-range 8-bit alpha AVIF',
    ),
    avifPinnedPng(
      'alpha-full-10bpc-64x48.avif',
      64,
      48,
      'dfc169edd84afdb59f30abcbfd09ddb277783e82ffda2489b60e9429d9f3d5f4',
      'Full-range 10-bit alpha AVIF',
    ),
    avifPinnedPng(
      'alpha-full-12bpc-64x48.avif',
      64,
      48,
      'dfc169edd84afdb59f30abcbfd09ddb277783e82ffda2489b60e9429d9f3d5f4',
      'Full-range 12-bit alpha AVIF',
    ),
    avifPinnedPng(
      'libavif-color-grid-alpha-items-80x80.avif',
      80,
      80,
      'bfc6eb86c18a9be89e5b52ff7dfc2faba3e84d4c1368bf18b478ec4f4947ff49',
      'Color grid with per-tile alpha auxiliaries',
    ),
    avifPinnedPng(
      'libavif-color-irot-alpha-noirot-512x256.avif',
      512,
      256,
      '5102863ca73f618c60944e490aa3982e7a1afd6975f4d0edf12b40ac85c88f82',
      'Primary irot with independently signaled alpha transform',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}
const avifHdrToneMap = async (): Promise<BrowserWorkflowResult> => {
  const fixtures = [
    {
      file: 'libavif-colors-hdr-p3.avif',
      width: 200,
      height: 200,
      rgbaSha256: 'ef957216a73d4aac1ddf6a0ccfe2159a1d3f361bea95d93bb2fbe009c06a9848',
      detail: 'Display-P3 PQ AVIF tone map',
    },
    {
      file: 'hdr-hlg-10bpc-yuv444-32x24.avif',
      width: 32,
      height: 24,
      rgbaSha256: '51dd3264ec19aa0af645a145c84159581ebd121a2296c071c58e5dda04c9cec4',
      detail: 'Rec.2020 HLG AVIF tone map',
    },
    {
      file: 'identity-pq-10bpc-yuv444-16x12.avif',
      width: 16,
      height: 12,
      rgbaSha256: 'faf9e43856c554015a4940a2647a6d053fafb42cf22ebbb2600d4d61d4c018d9',
      detail: 'Rec.2020 identity PQ AVIF tone map',
    },
    {
      file: 'libavif-cosmos1650-yuv444-10bpc-p3pq.avif',
      width: 1024,
      height: 428,
      rgbaSha256: 'b39faa860e8fd51bfc22173d5c376f5b837a1eca2776e6bd3bbbcbbbfeb630bb',
      detail: 'Chroma-derived Display-P3 PQ AVIF tone map',
    },
    {
      file: 'ms-chimera-hdr-matrix10-1920x1008.avif',
      width: 1920,
      height: 1008,
      rgbaSha256: '25578215c89bf9600eb54fc66dc6e3a9ad9d1e379c7d5a739a75ca3aebfa5c05',
      detail: 'Rec.2020 constant-luminance matrix 10 PQ AVIF tone map',
    },
  ] as const
  const results: BrowserWorkflowResult[] = []
  for (const fixture of fixtures) {
    results.push(
      await avifPinnedPng(
        fixture.file,
        fixture.width,
        fixture.height,
        fixture.rgbaSha256,
        fixture.detail,
      ),
    )
  }
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}

const avifAnimationKeySamples = async (): Promise<BrowserWorkflowResult> => {
  const fixtures = [
    {
      file: 'colors-animated-12bpc-keyframes-0-2-3.avif',
      frame: 0,
      width: 64,
      height: 64,
      rgbaSha256: 'cef05e2501d6fe214a10be9acd4aeef15db8263529bcfb0111bf2cdc98285b57',
    },
    {
      file: 'colors-animated-12bpc-keyframes-0-2-3.avif',
      frame: 2,
      width: 64,
      height: 64,
      rgbaSha256: 'e90c27ddd2ed208f3ac37fd03860804246dda7daee94e8e03d3fd5a8d7b26b93',
    },
    {
      file: 'colors-animated-12bpc-keyframes-0-2-3.avif',
      frame: 3,
      width: 64,
      height: 64,
      rgbaSha256: '9ba384ef84bba2807859a554d4fdde0ef81cc7fe383e60ec712ae1bb0687ad8a',
    },
    {
      file: 'colors-animated-8bpc-alpha-exif-xmp.avif',
      frame: 0,
      width: 150,
      height: 150,
      rgbaSha256: 'c87fd8f3ac6aed6d680f138fc41fccde73a75a0a0b2c8bc9bca4fbc5d935b84a',
    },
  ] as const
  const inputs = new Map<string, Uint8Array<ArrayBuffer>>()
  let outputBytes = 0
  for (const fixture of fixtures) {
    let input = inputs.get(fixture.file)
    if (input === undefined) {
      input = await fetchBytes(`/fixtures/${fixture.file}`)
      inputs.set(fixture.file, input)
    }
    const selected = await images.open(input, { frame: fixture.frame })
    const metadata = await selected.metadata()
    const output = await selected.png().toUint8Array()
    const outputMetadataValue = await outputMetadata(output)
    if (
      metadata.frames !== 5 ||
      outputMetadataValue.width !== fixture.width ||
      outputMetadataValue.height !== fixture.height
    ) {
      throw new Error(`${fixture.file} frame ${fixture.frame} metadata changed`)
    }
    const rgbaSha256 = await sha256(await portablePngPixels(output))
    if (rgbaSha256 !== fixture.rgbaSha256) {
      throw new Error(`${fixture.file} frame ${fixture.frame} RGBA hash was ${rgbaSha256}`)
    }
    outputBytes += output.byteLength
  }

  const dependentInput = inputs.get('colors-animated-12bpc-keyframes-0-2-3.avif')
  if (dependentInput === undefined) throw new Error('Animated AVIF fixture was not loaded')
  try {
    await (await images.open(dependentInput, { frame: 1 })).png().toUint8Array()
    throw new Error('Dependent animated AVIF frame unexpectedly decoded')
  } catch (error: unknown) {
    if (!(error instanceof ImageError) || error.code !== 'UNSUPPORTED_OPERATION') throw error
  }
  return {
    detail:
      'Four independently decodable AVIF color/alpha key samples matched pinned portable RGBA output; a dependent frame remained unsupported',
    outputBytes,
  }
}

const avifLossyMultitile = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'libaom-lossy-multitile-yuv420-256x256.avif',
      256,
      256,
      '64d50b1df2d192b1dcac24d4bd0e0df6996c00a1a3ecbd97bd9a888edf3dd737',
      'Lossy 8-bit 2x2-tile AVIF with loop filter, CDEF, and restoration',
    ),
    avifPinnedPng(
      'libaom-full-header-tile-groups-yuv420-256x256.avif',
      256,
      256,
      '05ab2273ba3952c41d53daf0b45afd709e5025f709ea8c87fef4a0dbacb0a966',
      'Non-reduced AV1 frame header with four tile-group OBUs',
    ),
    avifPinnedPng(
      'libavif-bounded-filtered-yuv420-3840x2160.avif',
      3840,
      2160,
      'fa0ee4c2f74aef92f77ce700eb60f001b6502db9c5d540b43bdddb59fdcc3880',
      'Filtered 8-bit 8x2-tile 4K AVIF within the bounded codec working-set limit',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}
const avifGainMapGrid = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'libavif_color_grid_alpha_grid_gainmap_nogrid.avif',
      512,
      600,
      'ea8a15d99b5f28a7858b097b8b82056ce65898f51bb2ff0d2c5715bdcfeff2fd',
      'Resampled AVIF gain map over aligned color and alpha grids',
    ),
    avifPinnedPng(
      'libavif_color_grid_gainmap_different_grid.avif',
      512,
      600,
      '4091bcc2b181c37e1b03bb6ec2b086b77516318b58cef4c75e8a8b5b0989f81e',
      'Independently tiled and resampled AVIF gain-map grid',
    ),
    avifPinnedPng(
      'libavif_color_nogrid_alpha_nogrid_gainmap_grid.avif',
      128,
      200,
      'b6ab4171d2d9030704c753aff99765c47b0829f537b2e92138eb90e64f3e0441',
      'AVIF gain-map grid over single color and alpha items',
    ),
    avifPinnedPng(
      'libavif_seine_hdr_gainmap_small_srgb.avif',
      400,
      300,
      'a3a2ea2482c9d96b7b98b47dc1d874229a079d0860ccac0ed8ee77e19b3580b1',
      'Resampled single-item AVIF gain map',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}
const avifFilmGrain = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'film-grain-test1-yuv420-64x48.avif',
    64,
    48,
    'ceff8604f5dc42f3a16a67dc2b8afc56d3fe8674567353b82c2e8384f10835dd',
    'Normative AV1 film-grain synthesis',
  )

const avifNonstillSequence = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'ms-mexico-nonstill-sequence.avif',
    1920,
    1080,
    '99f28f0e2fdc30dab25ad903ce043e7af30b7097d1f3402e692b3f8629bff6c1',
    'Non-still AV1 sequence header with one shown key frame',
  )
const avifLayeredSelection = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'xiph-tiger-3layer-lsel0-1216x832.avif',
    1216,
    832,
    'd04f5c88fa8e105b354967755d1261ade0e214f85bb8707b97fcd0568098b68e',
    'Three-frame AVIF item with lsel spatial layer 0',
  )
const avifSelectedBaseLayer = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'tiger-3layer-3res-lsel0.avif',
    304,
    208,
    'd9f8a13bbe9f0e86540c431cf3cfdcd1ffd00b345526cefcd7faa1904ab6ba3a',
    'Selected 304x208 AVIF base layer with a frame-dimension override',
  )
const avifCommonPhotoSyntax = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'diagnostic-baby-ffmpeg-crf30-yuv420.avif',
      576,
      576,
      '819d046be8dfc6b72fb722488216cdb4dfcb8e6eb2953a53932a7a2f03baeccb',
      'FFmpeg 4:2:0 coefficient-context AVIF',
    ),
    avifPinnedPng(
      'diagnostic-baby-ffmpeg-crf45-yuv444.avif',
      576,
      576,
      '030e44892698be8cb28a3d2fd75bfc65b0fc656f2e03314c89dadd1e8f99f89f',
      'FFmpeg 4:4:4 coefficient-context AVIF',
    ),
    avifPinnedPng(
      'diagnostic-mc3-sharp-q50-yuv420.avif',
      576,
      576,
      'cfac5f91515b6bdea3a784881a9918584f8058996192cb9616cca33a52cbf78b',
      'Sharp palette-context AVIF',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}

const avifSuperres = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'libaom-superres-denom12-96x64.avif',
      96,
      64,
      'bb31c24e26095af2032ca9f0d039e4061fae90a426cb3b446cb2199191f96e8b',
      'Filter-free single-band AV1 super-resolution AVIF',
    ),
    avifPinnedPng(
      'libaom-superres-denom12-yuv420-320x192.avif',
      320,
      192,
      '9bc16a4112c7b0b41b2fc587802b50e321c3bf669a4e66f6404887532384af5d',
      'Filter-free multi-band AV1 super-resolution AVIF',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}

const avifFilteredSuperres = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'libaom-filtered-superres-denom12-yuv420-320x192.avif',
    320,
    192,
    '87d8605b420d0aeb1e2f012fdab7a8fa9c30ff4f7fa9115a927485122125f8a8',
    'CDEF and loop-restored AV1 super-resolution AVIF',
  )

const avifGrid = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'sofa_grid1x5_420.avif',
    1024,
    770,
    '7d3fb76660d21f8ffc24a440dc62f3e0ff90dcd933d5b3ee045b93b013dfd962',
    'Cropped-edge 1x5 AVIF grid',
  )

const avifQuantizationMatrix = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/sharp-qmatrix-q30-256x192.avif')
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 256 || metadata.height !== 192) {
    throw new Error(
      `Quantization-matrix AVIF output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const [oraclePixels, outputPixels] = await Promise.all([
    browserPixels(input, 'image/avif'),
    browserPixels(output, 'image/png'),
  ])
  const psnr = rgbPsnr(oraclePixels, outputPixels)
  if (psnr <= 39) {
    throw new Error(`Quantization-matrix AVIF browser RGB PSNR was ${psnr.toFixed(2)} dB`)
  }
  return {
    detail: `Sharp/libaom quantization-matrix AVIF matched Chromium at ${psnr.toFixed(2)} dB`,
    outputBytes: output.byteLength,
  }
}

const avifMonochrome = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/fox.profile0.8bpc.yuv420.monochrome.avif')
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 1204 || metadata.height !== 800) {
    throw new Error(
      `Monochrome AVIF output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const [oraclePixels, outputPixels] = await Promise.all([
    browserPixels(input, 'image/avif'),
    browserPixels(output, 'image/png'),
  ])
  const psnr = rgbPsnr(oraclePixels, outputPixels)
  if (psnr <= 60) {
    throw new Error(`Monochrome AVIF browser RGB PSNR was ${psnr.toFixed(2)} dB`)
  }
  return {
    detail: `8-bit monochrome AVIF matched Chromium at ${psnr.toFixed(2)} dB`,
    outputBytes: output.byteLength,
  }
}

const avifYuv422 = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/fox.profile2.8bpc.yuv422.avif')
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 1204 || metadata.height !== 800) {
    throw new Error(
      `YUV 4:2:2 AVIF output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const outputPixels = await browserPixels(output, 'image/png')
  if (outputPixels.byteLength !== 1204 * 800 * 4) {
    throw new Error(`YUV 4:2:2 AVIF browser output had ${outputPixels.byteLength} RGBA bytes`)
  }
  const outputSha256 = await sha256(Uint8Array.from(outputPixels))
  if (outputSha256 !== '4ef692312c9c87692b548ebbd6ba100feb3ec53f5b1929bdd9f2c86d78a31f95') {
    throw new Error(`YUV 4:2:2 AVIF browser RGBA hash was ${outputSha256}`)
  }
  return {
    detail: '8-bit YUV 4:2:2 AVIF matched the pinned browser RGBA output',
    outputBytes: output.byteLength,
  }
}

const avifYuv444 = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/fox.profile1.8bpc.yuv444.avif')
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 1204 || metadata.height !== 800) {
    throw new Error(
      `YUV 4:4:4 AVIF output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const [oraclePixels, outputPixels] = await Promise.all([
    browserPixels(input, 'image/avif'),
    browserPixels(output, 'image/png'),
  ])
  const psnr = rgbPsnr(oraclePixels, outputPixels)
  if (psnr <= 50) {
    throw new Error(`YUV 4:4:4 AVIF browser RGB PSNR was ${psnr.toFixed(2)} dB`)
  }
  return {
    detail: `8-bit YUV 4:4:4 AVIF matched Chromium at ${psnr.toFixed(2)} dB`,
    outputBytes: output.byteLength,
  }
}

const heifPqDisplay = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/main10-pq.heic')
  const image = await images.open(input)
  const metadata = await image.metadata()
  if (metadata.format !== 'heif' || metadata.width !== 32 || metadata.height !== 32) {
    throw new Error(
      `Main 10/PQ HEIF metadata was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const output = await image.png().toUint8Array()
  const result = await outputMetadata(output)
  if (result.format !== 'png' || result.width !== 32 || result.height !== 32) {
    throw new Error(`Main 10/PQ HEIF output was ${result.format} ${result.width}x${result.height}`)
  }
  return {
    detail: 'Main 10/PQ HEIF displayed as 32x32 PNG in the browser',
    outputBytes: output.byteLength,
  }
}

const orientation = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/oriented-6.jpg')
  const source = await images.open(bytes.buffer)
  const metadata = await source.metadata()
  if (metadata.orientation !== 6 || metadata.width !== 640 || metadata.height !== 480) {
    throw new Error(`Oriented JPEG metadata was orientation ${metadata.orientation ?? 1}`)
  }
  const output = await source.autoOrient().png().toBlob()
  const result = await (await images.open(output)).metadata()
  if (result.width !== 480 || result.height !== 640 || (result.orientation ?? 1) !== 1) {
    throw new Error('autoOrient() did not normalize orientation 6 to 480x640')
  }
  return { detail: 'EXIF orientation 6 normalized to 480x640 PNG', outputBytes: output.size }
}

const httpRangeCancellation = async (): Promise<BrowserWorkflowResult> => {
  let markStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const fetcher: typeof fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get('range')
    if (range === 'bytes=0-0') {
      return new Response(Uint8Array.of(0), {
        status: 206,
        headers: {
          'content-range': 'bytes 0-0/1024',
          etag: '"browser-cancellation"',
        },
      })
    }
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) {
        reject(new Error('Range fetch did not receive an AbortSignal'))
        return
      }
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      markStarted?.()
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }
  const source = await HttpRangeSource.open('https://example.invalid/slide.tiff', {
    blockBytes: 64,
    fetch: fetcher,
  })
  const controller = new AbortController()
  const read = source.read(0, 32, { signal: controller.signal })
  await started
  controller.abort()
  let aborted = false
  try {
    await read
  } catch (error: unknown) {
    aborted = error instanceof DOMException && error.name === 'AbortError'
  }
  if (!aborted) throw new Error('In-flight browser range read did not abort')
  return {
    detail: 'AbortSignal cancelled an in-flight browser HTTP range read',
    outputBytes: 0,
  }
}

class FailingSink implements ImageSink {
  aborted = false
  #writes = 0

  async write(_chunk: Uint8Array): Promise<void> {
    this.#writes += 1
    if (this.#writes >= 6) throw new Error('intentional browser sink failure')
  }

  async close(): Promise<void> {
    throw new Error('failing sink must not close successfully')
  }

  async abort(_reason: unknown): Promise<void> {
    this.aborted = true
  }
}

const failureCleanup = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/alpha.png')
  const sink = new FailingSink()
  let failed = false
  try {
    await (await images.open(bytes)).rotate(90).png().toSink(sink)
  } catch (error: unknown) {
    failed = error instanceof Error && error.message === 'intentional browser sink failure'
  }
  if (!failed || !sink.aborted) throw new Error('Failed browser output did not abort its sink')

  const jpegSink = new FailingSink()
  failed = false
  try {
    await (await images.open(bytes))
      .resize({ width: 32 })
      .jpeg({ progressive: true })
      .toSink(jpegSink)
  } catch (error: unknown) {
    failed = error instanceof Error && error.message === 'intentional browser sink failure'
  }
  if (!failed || !jpegSink.aborted) {
    throw new Error('Failed progressive JPEG output did not abort its sink')
  }

  const recovered = await (await images.open(bytes)).rotate(90).png().toUint8Array()
  const metadata = await outputMetadata(recovered)
  if (metadata.width !== 3 || metadata.height !== 4) {
    throw new Error('A failed pipeline left browser execution unable to recover')
  }
  return {
    detail: 'failed PNG and progressive JPEG outputs aborted their sinks; next output succeeded',
    outputBytes: recovered.byteLength,
  }
}

const harness: BrowserCompatibilityHarness = Object.freeze({
  animatedGifFrameSelection,
  avifAlphaPremultiplied,
  avifAnimationKeySamples,
  avifAlphaStraight,
  avifEncode,
  avifBoundedAlphaRows,
  avifBoundedRows,
  avifBoundedResize,
  avifCleanAperture,
  avifCommonPhotoSyntax,
  avifGrid,
  avifHighBit10,
  avifHighBit12,
  avifHighBitTiles,
  avifExpandedHighBit,
  avifExpandedAlpha,
  avifHdrToneMap,
  avifHdrGainMap,
  avifIcc,
  avifImir,
  avifFilteredSuperres,
  avifLossyMultitile,
  avifGainMapGrid,
  avifFilmGrain,
  avifNonstillSequence,
  avifLayeredSelection,
  avifSelectedBaseLayer,
  avifSuperres,
  avifIntrabc,
  avifResidualIntrabc,
  avifStillPictureEntropy,
  avifSvtSkippedTransform,
  avifQuantizationMatrix,
  avifRec2020,
  avifQ0Lossless,
  avifSegmentation,
  avifPalette,
  avifMonochrome,
  avifYuv422,
  avifYuv444,
  failureCleanup,
  heifPqDisplay,
  hdf5DatasetBlocks,
  hdf5Filters,
  dicomEncapsulatedFileSmoke,
  dicomJpegBaselineFileSmoke,
  dicomJpegLosslessFileSmoke,
  dicomParserFileSmoke,
  dicomReaderFileSmoke,
  hdf5NcemEmd,
  hdf5VeloxEmd,
  hdf5VeloxSpectrum,
  httpRangeCancellation,
  inputTypes,
  optionalApiEntries,
  legacyTiffAndBmp,
  jpegPipeline,
  jpeg2000Decode,
  jpegXlLossless,
  jpegXlHighBit,
  jpegXlMultiGroup,
  unsupportedJpegBoundaries,
  tolerantJpegRestartRecovery,
  orientation,
  geoZarrRaster,
  geoNetCdfRaster,
  worldFileRaster,
  scientificTiffDocument,
  scientificDigitalMicrograph,
  scientificInterchangeFormats,
  scientificOmeZarr,
  scientificSurfaceFormats,
  scientificTiaEmi,
  scientificTiaSer,
  scientificOneDimensionalSeries,
  scientificOrdinaryCodecFallbacks,
  pngAlphaPipeline,
  nativePngPrecision,
  progressiveJpeg,
  resizeDefaultKernel,
  tiffEncodePipeline,
  wasmJpeg,
  wasmJpegEncode,
  wasmPng,
  wasmWebp,
  webpLossless,
  webpLossyDecode,
})

window.pureJsImageBrowserTests = harness
