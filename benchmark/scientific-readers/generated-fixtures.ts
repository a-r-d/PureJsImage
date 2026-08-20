import { gzipSync } from 'node:zlib'
import { crc32c } from '../../src/scientific/formats/crc32c.ts'
import { dicomTag } from '../../src/scientific/formats/dicom/constants.ts'
import { encodeGsf } from '../../src/scientific/readers/gsf.ts'
import {
  dicomDecimalBytes,
  dicomIdentityElements,
  dicomMonochromePixelElements,
  writeDicomPart10,
} from '../../tests/dicom/part10-writer.ts'
import {
  generatedDigitalMicrographFixture,
  generatedDigitalMicrographFourDStemFixture,
} from '../digital-micrograph/generated-fixture.ts'
import { createGeneratedNcemEmdFixture } from '../ncem-emd/generated-fixture.ts'
import { generatedTiaEmiObject, generateTiaEmiFixture } from '../tia-ser/generated-emi-fixture.ts'
import {
  generatedTiaSerImageSeries,
  generatedTiaSerPointSpectrum,
  generatedTiaSerSpectrumImage,
} from '../tia-ser/generated-fixture.ts'
import { createGeneratedVeloxEmdFixture } from '../velox-emd/generated-fixture.ts'

export interface GeneratedScientificResource {
  readonly name: string
  readonly bytes: Uint8Array
}

export interface GeneratedScientificFixture {
  readonly resources: readonly GeneratedScientificResource[]
  readonly payloadRanges: Readonly<Record<string, readonly (readonly [number, number])[]>>
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value)

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const npy = (
  shape: readonly number[],
  values: readonly number[],
  fortranOrder = false,
): Uint8Array => {
  const shapeText = shape.length === 1 ? `${shape[0]},` : shape.join(', ')
  const dictionary = `{'descr': '<u2', 'fortran_order': ${fortranOrder ? 'True' : 'False'}, 'shape': (${shapeText}), }`
  const padding = (64 - ((10 + dictionary.length + 1) % 64)) % 64
  const header = text(`${dictionary}${' '.repeat(padding)}\n`)
  const output = new Uint8Array(10 + header.byteLength + values.length * 2)
  output.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0])
  new DataView(output.buffer).setUint16(8, header.byteLength, true)
  output.set(header, 10)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setUint16(10 + header.byteLength + index * 2, values[index] ?? 0, true)
  }
  return output
}

const checkedSampleCount = (shape: readonly number[], bytesPerSample: number): number => {
  const samples = shape.reduce((total, length) => total * length, 1)
  const bytes = samples * bytesPerSample
  if (!Number.isSafeInteger(samples) || !Number.isSafeInteger(bytes) || samples < 1 || bytes < 1) {
    throw new Error(`Generated scientific fixture shape ${shape.join('x')} is invalid`)
  }
  return samples
}

const npyZeros = (shape: readonly [number, number]): Uint8Array => {
  const sampleCount = checkedSampleCount(shape, 2)
  const shapeText = shape.join(', ')
  const dictionary = `{'descr': '<u2', 'fortran_order': False, 'shape': (${shapeText}), }`
  const padding = (64 - ((10 + dictionary.length + 1) % 64)) % 64
  const header = text(`${dictionary}${' '.repeat(padding)}\n`)
  const output = new Uint8Array(10 + header.byteLength + sampleCount * 2)
  output.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0])
  const view = new DataView(output.buffer)
  view.setUint16(8, header.byteLength, true)
  output.set(header, 10)
  const payloadOffset = 10 + header.byteLength
  view.setUint16(payloadOffset, 1, true)
  view.setUint16(output.byteLength - 2, 2, true)
  return output
}

const nifti = (): Uint8Array => {
  const output = new Uint8Array(360)
  const view = new DataView(output.buffer)
  view.setInt32(0, 348, true)
  view.setInt16(40, 2, true)
  view.setInt16(42, 2, true)
  view.setInt16(44, 2, true)
  view.setInt16(46, 1, true)
  view.setInt16(70, 4, true)
  view.setInt16(72, 16, true)
  view.setFloat32(80, 0.5, true)
  view.setFloat32(84, 2, true)
  view.setFloat32(108, 352, true)
  view.setFloat32(112, 2, true)
  view.setFloat32(116, 1, true)
  output[123] = 2
  output.set(text('generated volume'), 148)
  output.set(text('n+1\0'), 344)
  view.setInt16(352, 3, true)
  view.setInt16(354, 7, true)
  view.setInt16(356, 11, true)
  view.setInt16(358, 13, true)
  return output
}

const niftiZeros = (width: number, height: number): Uint8Array => {
  const dataOffset = 352
  const sampleCount = checkedSampleCount([width, height], 2)
  const output = new Uint8Array(dataOffset + sampleCount * 2)
  const view = new DataView(output.buffer)
  view.setInt32(0, 348, true)
  view.setInt16(40, 2, true)
  view.setInt16(42, width, true)
  view.setInt16(44, height, true)
  view.setInt16(46, 1, true)
  view.setInt16(70, 4, true)
  view.setInt16(72, 16, true)
  view.setFloat32(76, 1, true)
  view.setFloat32(80, 1, true)
  view.setFloat32(84, 1, true)
  view.setFloat32(108, dataOffset, true)
  view.setFloat32(112, 1, true)
  output[123] = 2
  output.set(text('generated scaling volume'), 148)
  output.set(text('n+1\0'), 344)
  view.setInt16(dataOffset, 1, true)
  view.setInt16(output.byteLength - 2, 2, true)
  return output
}

const blockfile = (): Uint8Array => {
  const output = new Uint8Array(284)
  const view = new DataView(output.buffer)
  output.set(text('IMGBLO'))
  view.setUint16(6, 0x0102, true)
  view.setUint32(8, 240, true)
  view.setUint32(12, 244, true)
  view.setUint16(20, 2, true)
  view.setUint16(24, 2, true)
  view.setUint16(26, 2, true)
  view.setFloat64(30, 0.5, true)
  view.setFloat64(38, 0.75, true)
  view.setUint16(50, 200, true)
  output.set([10, 20, 30, 40], 240)
  for (let frame = 0; frame < 4; frame += 1) {
    const offset = 244 + frame * 10
    view.setUint16(offset, 0x55aa, true)
    view.setUint32(offset + 2, frame, true)
    output.set([frame * 4 + 1, frame * 4 + 2, frame * 4 + 3, frame * 4 + 4], offset + 6)
  }
  return output
}

const mib = (): Uint8Array => {
  const headerText = 'MQ1,1,384,1,2,2,U08,1x1,2024-01-01,100ns,0,0'
  const output = new Uint8Array(388)
  output.fill(0x20, 0, 384)
  output.set(text(headerText))
  output.set([1, 2, 3, 4], 384)
  return output
}

const nrrd = (encoding: 'raw' | 'gzip'): Uint8Array => {
  const payload = Uint8Array.from([1, 2, 3, 4])
  const encoded = encoding === 'gzip' ? Uint8Array.from(gzipSync(payload)) : payload
  const header = text(`NRRD0005\ntype: uchar\ndimension: 2\nsizes: 2 2\nencoding: ${encoding}\n\n`)
  return concat([header, encoded])
}

const nrrdZeros = (width: number, height: number): Uint8Array => {
  const sampleCount = checkedSampleCount([width, height], 1)
  const header = text(
    `NRRD0005\ntype: uchar\ndimension: 2\nsizes: ${width} ${height}\nencoding: raw\nendian: little\n\n`,
  )
  const output = new Uint8Array(header.byteLength + sampleCount)
  output.set(header)
  output[header.byteLength] = 1
  output[output.byteLength - 1] = 2
  return output
}

const metaImage = (detached: boolean): readonly GeneratedScientificResource[] => {
  if (!detached) {
    const header = text(
      `ObjectType = Image\nNDims = 2\nDimSize = 2 2\nElementType = MET_UCHAR\nElementSpacing = 0.25 0.5\nElementDataFile = LOCAL\n`,
    )
    return [{ name: 'image.mha', bytes: concat([header, Uint8Array.from([1, 2, 3, 4])]) }]
  }
  return [
    {
      name: 'image.mhd',
      bytes: text(
        `ObjectType = Image\nNDims = 2\nDimSize = 2 1\nElementType = MET_USHORT\nElementByteOrderMSB = True\nElementDataFile = image.raw\n`,
      ),
    },
    { name: 'image.raw', bytes: Uint8Array.from([0, 10, 0, 20]) },
  ]
}

const emsa = (): Uint8Array =>
  text(
    `#FORMAT: EMSA/MAS Spectral Data File\n#VERSION: 1.0\n#TITLE: Generated\n#NPOINTS: 4\n#DATATYPE: Y\n#XUNITS: eV\n#YUNITS: counts\n#OFFSET: 100\n#XPERCHAN: 5\n#SPECTRUM:\n1, 2, 3, 4\n#ENDOFDATA:\n`,
  )

const ebsd = (format: 'ang' | 'ctf'): Uint8Array => {
  if (format === 'ang') {
    return text(
      `# GRID: SqrGrid\n# XSTEP: 0.5\n# YSTEP: 0.5\n# NCOLS_ODD: 2\n# NCOLS_EVEN: 2\n# NROWS: 2\n0.1 0.2 0.3 0 0 10 0.9 1\n0.4 0.5 0.6 0.5 0 11 0.8 1\n0.7 0.8 0.9 0 0.5 12 0.7 2\n1.0 1.1 1.2 0.5 0.5 13 0.6 2\n`,
    )
  }
  return text(
    `Channel Text File\nPrj test\nXCells 2\nYCells 2\nXStep 0.5\nYStep 0.5\nPhases 0\nPhase X Y Bands Error Euler1 Euler2 Euler3 MAD BC BS\n1 0 0 8 0 10 20 30 0.5 100 20\n1 0.5 0 8 0 11 21 31 0.6 101 21\n1 0 0.5 8 0 12 22 32 0.7 102 22\n1 0.5 0.5 8 0 13 23 33 0.8 103 23\n`,
  )
}

const rpl = (): readonly GeneratedScientificResource[] => {
  const header = text(
    `key\tvalue\nwidth\t2\nheight\t2\ndepth\t2\ndata-type\tunsigned\ndata-length\t1\nbyte-order\tdont-care\nrecord-by\tvector\nwidth-scale\t0.5\nwidth-units\tnm\nheight-scale\t1\nheight-units\tnm\nev-per-chan\t10\nsignal\tEDS\n`,
  )
  return [
    { name: 'sample.rpl', bytes: header },
    { name: 'sample.raw', bytes: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]) },
  ]
}

const mrc = (): Uint8Array => {
  const output = new Uint8Array(1_024 + 8)
  const view = new DataView(output.buffer)
  const integer = (offset: number, value: number): void => view.setInt32(offset, value, true)
  const real = (offset: number, value: number): void => view.setFloat32(offset, value, true)
  integer(0, 2)
  integer(4, 2)
  integer(8, 1)
  integer(12, 1)
  integer(28, 2)
  integer(32, 2)
  integer(36, 1)
  real(40, 4)
  real(44, 6)
  real(48, 1)
  real(52, 90)
  real(56, 90)
  real(60, 90)
  integer(64, 1)
  integer(68, 2)
  integer(72, 3)
  output.set(text('MAP '), 208)
  output.set([0x44, 0x44, 0, 0], 212)
  for (const [index, value] of [10, 20, 30, 40].entries())
    view.setInt16(1_024 + index * 2, value, true)
  return output
}

const mrcZeros = (width: number, height: number): Uint8Array => {
  const sampleCount = checkedSampleCount([width, height], 2)
  const output = new Uint8Array(1_024 + sampleCount * 2)
  const view = new DataView(output.buffer)
  const integer = (offset: number, value: number): void => view.setInt32(offset, value, true)
  const real = (offset: number, value: number): void => view.setFloat32(offset, value, true)
  integer(0, width)
  integer(4, height)
  integer(8, 1)
  integer(12, 1)
  integer(28, width)
  integer(32, height)
  integer(36, 1)
  real(40, width)
  real(44, height)
  real(48, 1)
  real(52, 90)
  real(56, 90)
  real(60, 90)
  integer(64, 1)
  integer(68, 2)
  integer(72, 3)
  output.set(text('MAP '), 208)
  output.set([0x44, 0x44, 0, 0], 212)
  view.setInt16(1_024, 1, true)
  view.setInt16(output.byteLength - 2, 2, true)
  return output
}

const tiledTiffZeros = (
  width: number,
  height: number,
  tileWidth = 256,
  tileHeight = 256,
  minimumDataOffset = 0,
): Uint8Array => {
  if (width % tileWidth !== 0 || height % tileHeight !== 0) {
    throw new Error(
      `Generated tiled TIFF dimensions ${width}x${height} must be divisible by ${tileWidth}x${tileHeight}`,
    )
  }
  const tileBytes = tileWidth * tileHeight
  const tileCount = (width / tileWidth) * (height / tileHeight)
  const entryCount = 12
  const ifdOffset = 8
  const ifdBytes = 2 + entryCount * 12 + 4
  const offsetsOffset = ifdOffset + ifdBytes
  const byteCountsOffset = offsetsOffset + tileCount * 4
  const dataOffset = Math.max(byteCountsOffset + tileCount * 4, minimumDataOffset)
  const payloadBytes = checkedSampleCount([width, height], 1)
  const output = new Uint8Array(dataOffset + payloadBytes)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])
  view.setUint16(ifdOffset, entryCount, true)
  const entry = (index: number, tag: number, type: number, count: number, value: number): void => {
    const offset = ifdOffset + 2 + index * 12
    view.setUint16(offset, tag, true)
    view.setUint16(offset + 2, type, true)
    view.setUint32(offset + 4, count, true)
    view.setUint32(offset + 8, value, true)
  }
  const short = (index: number, tag: number, value: number): void => {
    entry(index, tag, 3, 1, value)
    view.setUint16(ifdOffset + 2 + index * 12 + 8, value, true)
  }
  entry(0, 256, 4, 1, width)
  entry(1, 257, 4, 1, height)
  short(2, 258, 8)
  short(3, 259, 1)
  short(4, 262, 1)
  short(5, 277, 1)
  entry(6, 322, 4, 1, tileWidth)
  entry(7, 323, 4, 1, tileHeight)
  entry(8, 324, 4, tileCount, offsetsOffset)
  entry(9, 325, 4, tileCount, byteCountsOffset)
  short(10, 284, 1)
  short(11, 339, 1)
  for (let tile = 0; tile < tileCount; tile += 1) {
    view.setUint32(offsetsOffset + tile * 4, dataOffset + tile * tileBytes, true)
    view.setUint32(byteCountsOffset + tile * 4, tileBytes, true)
  }
  output[dataOffset] = 1
  output[output.byteLength - 1] = 2
  return output
}

const viewerOmeTiff = (): Uint8Array => {
  const width = 4_096
  const height = 4_096
  const tileWidth = 256
  const tileHeight = 256
  const tileBytes = tileWidth * tileHeight
  const tileCount = (width / tileWidth) * (height / tileHeight)
  const description = text(
    `<?xml version="1.0" encoding="UTF-8"?><OME><Image ID="Image:0" Name="Representative viewer fixture"><Pixels ID="Pixels:0" DimensionOrder="XYZCT" Type="uint8" SizeX="${width}" SizeY="${height}" SizeZ="1" SizeC="2" SizeT="1"><Channel ID="Channel:0:0" SamplesPerPixel="1"/><Channel ID="Channel:0:1" SamplesPerPixel="1"/><TiffData IFD="0" FirstC="0" FirstZ="0" FirstT="0" PlaneCount="1"/><TiffData IFD="1" FirstC="1" FirstZ="0" FirstT="0" PlaneCount="1"/></Pixels></Image></OME>\0`,
  )
  const firstEntryCount = 13
  const secondEntryCount = 12
  const firstIfdOffset = 8
  const firstIfdBytes = 2 + firstEntryCount * 12 + 4
  const secondIfdOffset = firstIfdOffset + firstIfdBytes
  const secondIfdBytes = 2 + secondEntryCount * 12 + 4
  const descriptionOffset = secondIfdOffset + secondIfdBytes
  const firstOffsetsOffset = descriptionOffset + description.byteLength
  const firstByteCountsOffset = firstOffsetsOffset + tileCount * 4
  const secondOffsetsOffset = firstByteCountsOffset + tileCount * 4
  const secondByteCountsOffset = secondOffsetsOffset + tileCount * 4
  const dataOffset = secondByteCountsOffset + tileCount * 4
  const planeBytes = width * height
  const output = new Uint8Array(dataOffset + planeBytes * 2)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])

  const writeIfd = (
    ifdOffset: number,
    entryCount: number,
    nextIfdOffset: number,
    offsetsOffset: number,
    byteCountsOffset: number,
    includeDescription: boolean,
  ): void => {
    view.setUint16(ifdOffset, entryCount, true)
    let entryIndex = 0
    const entry = (tag: number, type: number, count: number, value: number): void => {
      const offset = ifdOffset + 2 + entryIndex * 12
      view.setUint16(offset, tag, true)
      view.setUint16(offset + 2, type, true)
      view.setUint32(offset + 4, count, true)
      view.setUint32(offset + 8, value, true)
      entryIndex += 1
    }
    const short = (tag: number, value: number): void => entry(tag, 3, 1, value)
    entry(256, 4, 1, width)
    entry(257, 4, 1, height)
    short(258, 8)
    short(259, 1)
    short(262, 1)
    if (includeDescription) entry(270, 2, description.byteLength, descriptionOffset)
    short(277, 1)
    entry(322, 4, 1, tileWidth)
    entry(323, 4, 1, tileHeight)
    entry(324, 4, tileCount, offsetsOffset)
    entry(325, 4, tileCount, byteCountsOffset)
    short(284, 1)
    short(339, 1)
    view.setUint32(ifdOffset + 2 + entryCount * 12, nextIfdOffset, true)
  }

  writeIfd(
    firstIfdOffset,
    firstEntryCount,
    secondIfdOffset,
    firstOffsetsOffset,
    firstByteCountsOffset,
    true,
  )
  writeIfd(secondIfdOffset, secondEntryCount, 0, secondOffsetsOffset, secondByteCountsOffset, false)
  output.set(description, descriptionOffset)
  for (let plane = 0; plane < 2; plane += 1) {
    const offsetsOffset = plane === 0 ? firstOffsetsOffset : secondOffsetsOffset
    const byteCountsOffset = plane === 0 ? firstByteCountsOffset : secondByteCountsOffset
    const planeOffset = dataOffset + plane * planeBytes
    for (let tile = 0; tile < tileCount; tile += 1) {
      view.setUint32(offsetsOffset + tile * 4, planeOffset + tile * tileBytes, true)
      view.setUint32(byteCountsOffset + tile * 4, tileBytes, true)
    }
    output[planeOffset] = plane + 1
    output[planeOffset + planeBytes - 1] = plane + 2
  }
  return output
}

const viewerCog = (): Uint8Array => {
  const width = 8_192
  const height = 8_192
  const tileWidth = 256
  const tileHeight = 256
  const tileBytes = tileWidth * tileHeight
  const tileCount = (width / tileWidth) * (height / tileHeight)
  const entryCount = 15
  const ifdOffset = 8
  const ifdBytes = 2 + entryCount * 12 + 4
  const pixelScaleOffset = ifdOffset + ifdBytes
  const tiePointOffset = pixelScaleOffset + 3 * 8
  const geoKeysOffset = tiePointOffset + 6 * 8
  const offsetsOffset = geoKeysOffset + 8 * 2
  const byteCountsOffset = offsetsOffset + tileCount * 4
  const dataOffset = byteCountsOffset + tileCount * 4
  const output = new Uint8Array(dataOffset + width * height)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])
  view.setUint16(ifdOffset, entryCount, true)
  let entryIndex = 0
  const entry = (tag: number, type: number, count: number, value: number): void => {
    const offset = ifdOffset + 2 + entryIndex * 12
    view.setUint16(offset, tag, true)
    view.setUint16(offset + 2, type, true)
    view.setUint32(offset + 4, count, true)
    view.setUint32(offset + 8, value, true)
    entryIndex += 1
  }
  const short = (tag: number, value: number): void => entry(tag, 3, 1, value)
  entry(256, 4, 1, width)
  entry(257, 4, 1, height)
  short(258, 8)
  short(259, 1)
  short(262, 1)
  short(277, 1)
  entry(322, 4, 1, tileWidth)
  entry(323, 4, 1, tileHeight)
  entry(324, 4, tileCount, offsetsOffset)
  entry(325, 4, tileCount, byteCountsOffset)
  short(284, 1)
  short(339, 1)
  entry(33_550, 12, 3, pixelScaleOffset)
  entry(33_922, 12, 6, tiePointOffset)
  entry(34_735, 3, 8, geoKeysOffset)
  view.setUint32(ifdOffset + 2 + entryCount * 12, 0, true)
  for (const [index, value] of [1, 1, 0].entries())
    view.setFloat64(pixelScaleOffset + index * 8, value, true)
  for (const [index, value] of [0, 0, 0, 0, 0, 0].entries())
    view.setFloat64(tiePointOffset + index * 8, value, true)
  for (const [index, value] of [1, 1, 0, 1, 1_024, 0, 1, 2].entries())
    view.setUint16(geoKeysOffset + index * 2, value, true)
  for (let tile = 0; tile < tileCount; tile += 1) {
    view.setUint32(offsetsOffset + tile * 4, dataOffset + tile * tileBytes, true)
    view.setUint32(byteCountsOffset + tile * 4, tileBytes, true)
  }
  output[dataOffset] = 1
  output[output.byteLength - 1] = 2
  return output
}

const cbf = (): Uint8Array => {
  const values = [1, 3, 6, 10]
  const encoded: number[] = []
  let previous = 0
  for (const value of values) {
    encoded.push((value - previous) & 0xff)
    previous = value
  }
  const binary = Uint8Array.from(encoded)
  const header = text(
    `###CBF: VERSION 1.5\ndata_test\n_diffrn_detector.detector 'GENERATED DETECTOR'\n_array_data.data\n;\n--CIF-BINARY-FORMAT-SECTION--\nContent-Type: application/octet-stream; conversions="x-CBF_BYTE_OFFSET"\nContent-Transfer-Encoding: BINARY\nX-Binary-Size: ${binary.byteLength}\nX-Binary-ID: 1\nX-Binary-Element-Type: "signed 32-bit integer"\nX-Binary-Element-Byte-Order: LITTLE_ENDIAN\nX-Binary-Number-of-Elements: 4\nX-Binary-Size-Fastest-Dimension: 2\nX-Binary-Size-Second-Dimension: 2\nX-Binary-Size-Padding: 0\n\n`,
  )
  return concat([
    header,
    Uint8Array.of(0x0c, 0x1a, 0x04, 0xd5),
    binary,
    text('\n--CIF-BINARY-FORMAT-SECTION----\n;\n'),
  ])
}

const omeTiff = (): Uint8Array => {
  const description = text(
    '<?xml version="1.0" encoding="UTF-8"?><OME><Image ID="Image:0" Name="Generated"><Pixels ID="Pixels:0" DimensionOrder="XYZCT" Type="uint8" SizeX="2" SizeY="2" SizeZ="1" SizeC="1" SizeT="1"><Channel ID="Channel:0:0" SamplesPerPixel="1"/><TiffData IFD="0" PlaneCount="1"/></Pixels></Image></OME>\0',
  )
  const entryCount = 12
  const ifdOffset = 8
  const ifdBytes = 2 + entryCount * 12 + 4
  const descriptionOffset = ifdOffset + ifdBytes
  const dataOffset = descriptionOffset + description.byteLength
  const output = new Uint8Array(dataOffset + 4)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])
  view.setUint16(ifdOffset, entryCount, true)
  const entry = (index: number, tag: number, type: number, count: number, value: number): void => {
    const offset = ifdOffset + 2 + index * 12
    view.setUint16(offset, tag, true)
    view.setUint16(offset + 2, type, true)
    view.setUint32(offset + 4, count, true)
    view.setUint32(offset + 8, value, true)
  }
  const short = (index: number, tag: number, value: number): void => {
    const offset = ifdOffset + 2 + index * 12
    entry(index, tag, 3, 1, value)
    view.setUint16(offset + 8, value, true)
    view.setUint16(offset + 10, 0, true)
  }
  short(0, 256, 2)
  short(1, 257, 2)
  short(2, 258, 8)
  short(3, 259, 1)
  short(4, 262, 1)
  entry(5, 270, 2, description.byteLength, descriptionOffset)
  entry(6, 273, 4, 1, dataOffset)
  short(7, 277, 1)
  entry(8, 278, 4, 1, 2)
  entry(9, 279, 4, 1, 4)
  short(10, 284, 1)
  short(11, 339, 1)
  output.set(description, descriptionOffset)
  output.set([1, 2, 3, 4], dataOffset)
  return output
}

const envi = (): readonly GeneratedScientificResource[] => [
  {
    name: 'generated.hdr',
    bytes: text(
      `ENVI\nsamples = 2\nlines = 2\nbands = 2\ndata type = 2\ninterleave = bip\nbyte order = 0\nband names = {band 1, band 2}\n`,
    ),
  },
  {
    name: 'generated.bin',
    bytes: Uint8Array.from([1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0]),
  },
]

const omeZarrWsi = (): GeneratedScientificFixture => {
  const json = (value: unknown): Uint8Array => text(JSON.stringify(value))
  const logicalHeight = 128
  const logicalWidth = 128
  const shardHeight = 512
  const shardWidth = 512
  const innerRows = shardHeight / logicalHeight
  const innerColumns = shardWidth / logicalWidth
  const levels = [
    { height: 1_280, width: 1_792, scale: 1 },
    { height: 640, width: 896, scale: 2 },
    { height: 320, width: 448, scale: 4 },
  ] as const
  const resources: GeneratedScientificResource[] = [
    {
      name: 'zarr.json',
      bytes: json({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                name: 'deterministic-rgb-wsi',
                axes: [
                  { name: 't', type: 'time' },
                  { name: 'c', type: 'channel' },
                  { name: 'z', type: 'space' },
                  { name: 'y', type: 'space', unit: 'micrometer' },
                  { name: 'x', type: 'space', unit: 'micrometer' },
                ],
                datasets: levels.map((level, index) => ({
                  path: String(index),
                  coordinateTransformations: [
                    { type: 'scale', scale: [1, 1, 1, level.scale, level.scale] },
                  ],
                })),
              },
            ],
            omero: {
              channels: [
                { label: 'Red tissue', color: 'FF0000' },
                { label: 'Green structure', color: '00FF00' },
                { label: 'Blue detail', color: '0000FF' },
              ],
            },
            plate: {
              name: 'deterministic-demo-plate',
              rows: [{ name: 'A' }],
              columns: [{ name: '1' }, { name: '2' }],
              wells: [
                { path: 'A/1', rowIndex: 0, columnIndex: 0 },
                { path: 'A/2', rowIndex: 0, columnIndex: 1 },
              ],
            },
          },
        },
      }),
    },
    {
      name: 'labels/zarr.json',
      bytes: json({
        zarr_format: 3,
        node_type: 'group',
        attributes: { ome: { version: '0.5', labels: ['segmentation'] } },
      }),
    },
    {
      name: 'labels/segmentation/zarr.json',
      bytes: json({
        zarr_format: 3,
        node_type: 'group',
        attributes: {
          ome: {
            version: '0.5',
            multiscales: [
              {
                name: 'deterministic-segmentation',
                axes: [
                  { name: 'z', type: 'space' },
                  { name: 'y', type: 'space', unit: 'micrometer' },
                  { name: 'x', type: 'space', unit: 'micrometer' },
                ],
                datasets: levels.map((level, index) => ({
                  path: String(index),
                  coordinateTransformations: [
                    { type: 'scale', scale: [1, level.scale, level.scale] },
                  ],
                })),
              },
            ],
            'image-label': {
              colors: [
                { 'label-value': 1, rgba: [255, 210, 40, 220] },
                { 'label-value': 2, rgba: [0, 220, 255, 210] },
              ],
              source: { image: '../../' },
            },
          },
        },
      }),
    },
  ]
  const payloadRanges: Record<string, readonly (readonly [number, number])[]> = {}
  for (let well = 1; well <= 2; well += 1) {
    const wellPath = `A/${well}`
    resources.push(
      {
        name: `${wellPath}/zarr.json`,
        bytes: json({
          zarr_format: 3,
          node_type: 'group',
          attributes: { ome: { version: '0.5', well: { images: [{ path: '0' }] } } },
        }),
      },
      {
        name: `${wellPath}/0/zarr.json`,
        bytes: json({
          zarr_format: 3,
          node_type: 'group',
          attributes: {
            ome: {
              version: '0.5',
              multiscales: [
                {
                  name: `well-A${well}`,
                  axes: [
                    { name: 'y', type: 'space', unit: 'micrometer' },
                    { name: 'x', type: 'space', unit: 'micrometer' },
                  ],
                  datasets: [
                    {
                      path: '0',
                      coordinateTransformations: [{ type: 'scale', scale: [0.5, 0.5] }],
                    },
                  ],
                },
              ],
            },
          },
        }),
      },
      {
        name: `${wellPath}/0/0/zarr.json`,
        bytes: json({
          zarr_format: 3,
          node_type: 'array',
          shape: [256, 256],
          data_type: 'uint8',
          chunk_grid: { name: 'regular', configuration: { chunk_shape: [128, 128] } },
          chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
          fill_value: 0,
          codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
          dimension_names: ['y', 'x'],
          attributes: {},
        }),
      },
    )
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 2; column += 1) {
        const chunk = new Uint8Array(128 * 128)
        for (let y = 0; y < 128; y += 1) {
          for (let x = 0; x < 128; x += 1) {
            chunk[y * 128 + x] = (well * 60 + row * 35 + column * 20 + x + y) & 255
          }
        }
        const name = `${wellPath}/0/0/c/${row}/${column}`
        resources.push({ name, bytes: chunk })
        payloadRanges[name] = [[0, chunk.byteLength]]
      }
    }
  }
  for (const [levelIndex, level] of levels.entries()) {
    resources.push({
      name: `${levelIndex}/zarr.json`,
      bytes: json({
        zarr_format: 3,
        node_type: 'array',
        shape: [1, 3, 2, level.height, level.width],
        data_type: 'uint8',
        chunk_grid: {
          name: 'regular',
          configuration: { chunk_shape: [1, 3, 2, shardHeight, shardWidth] },
        },
        chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
        fill_value: 0,
        codecs: [
          {
            name: 'sharding_indexed',
            configuration: {
              chunk_shape: [1, 3, 1, logicalHeight, logicalWidth],
              codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
              index_codecs: [
                { name: 'bytes', configuration: { endian: 'little' } },
                { name: 'crc32c' },
              ],
              index_location: 'end',
            },
          },
        ],
        dimension_names: ['t', 'c', 'z', 'y', 'x'],
        attributes: {},
      }),
    })
    const shardRows = Math.ceil(level.height / shardHeight)
    const shardColumns = Math.ceil(level.width / shardWidth)
    for (let shardY = 0; shardY < shardRows; shardY += 1) {
      for (let shardX = 0; shardX < shardColumns; shardX += 1) {
        const chunks: Uint8Array[] = []
        const index = new Uint8Array(2 * innerRows * innerColumns * 16)
        const indexView = new DataView(index.buffer)
        let offset = 0
        for (let z = 0; z < 2; z += 1) {
          for (let innerY = 0; innerY < innerRows; innerY += 1) {
            for (let innerX = 0; innerX < innerColumns; innerX += 1) {
              const chunk = new Uint8Array(3 * logicalHeight * logicalWidth)
              const originY = shardY * shardHeight + innerY * logicalHeight
              const originX = shardX * shardWidth + innerX * logicalWidth
              for (let channel = 0; channel < 3; channel += 1) {
                const channelOffset = channel * logicalHeight * logicalWidth
                for (let y = 0; y < logicalHeight; y += 1) {
                  for (let x = 0; x < logicalWidth; x += 1) {
                    const imageX = (originX + x) * level.scale
                    const imageY = (originY + y) * level.scale
                    const value =
                      channel === 0
                        ? (imageX + Math.floor(imageY / 3)) & 255
                        : channel === 1
                          ? (imageY * 2 + Math.floor(imageX / 5)) & 255
                          : ((Math.floor(imageX / 16) ^ Math.floor(imageY / 16)) * 92 +
                              imageX +
                              imageY +
                              z * 37) &
                            255
                    chunk[channelOffset + y * logicalWidth + x] = value
                  }
                }
              }
              const entry = z * innerRows * innerColumns + innerY * innerColumns + innerX
              indexView.setBigUint64(entry * 16, BigInt(offset), true)
              indexView.setBigUint64(entry * 16 + 8, BigInt(chunk.byteLength), true)
              chunks.push(chunk)
              offset += chunk.byteLength
            }
          }
        }
        const encodedIndex = new Uint8Array(index.byteLength + 4)
        encodedIndex.set(index)
        new DataView(encodedIndex.buffer).setUint32(index.byteLength, crc32c(index), true)
        const shard = concat([...chunks, encodedIndex])
        const name = `${levelIndex}/c/0/0/0/${shardY}/${shardX}`
        resources.push({ name, bytes: shard })
        payloadRanges[name] = chunks.map((chunk, chunkIndex) => {
          const start = chunkIndex * chunk.byteLength
          return [start, start + chunk.byteLength] as const
        })
      }
    }
    resources.push({
      name: `labels/segmentation/${levelIndex}/zarr.json`,
      bytes: json({
        zarr_format: 3,
        node_type: 'array',
        shape: [2, level.height, level.width],
        data_type: 'uint8',
        chunk_grid: {
          name: 'regular',
          configuration: { chunk_shape: [1, logicalHeight, logicalWidth] },
        },
        chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
        fill_value: 0,
        codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
        dimension_names: ['z', 'y', 'x'],
        attributes: {},
      }),
    })
    const labelRows = Math.ceil(level.height / logicalHeight)
    const labelColumns = Math.ceil(level.width / logicalWidth)
    for (let z = 0; z < 2; z += 1) {
      for (let row = 0; row < labelRows; row += 1) {
        for (let column = 0; column < labelColumns; column += 1) {
          const chunk = new Uint8Array(logicalHeight * logicalWidth)
          for (let y = 0; y < logicalHeight; y += 1) {
            for (let x = 0; x < logicalWidth; x += 1) {
              const imageX = (column * logicalWidth + x) * level.scale
              const imageY = (row * logicalHeight + y) * level.scale
              const inside =
                imageX < levels[0].width &&
                imageY < levels[0].height &&
                (imageX - 620) ** 2 / 150_000 + (imageY - 450) ** 2 / 80_000 < 1
              chunk[y * logicalWidth + x] = inside ? (z === 0 ? 1 : 2) : 0
            }
          }
          const name = `labels/segmentation/${levelIndex}/c/${z}/${row}/${column}`
          resources.push({ name, bytes: chunk })
          payloadRanges[name] = [[0, chunk.byteLength]]
        }
      }
    }
  }
  return { resources, payloadRanges }
}

export const generatedScientificFixtures: Readonly<
  Record<string, () => GeneratedScientificFixture>
> = Object.freeze({
  'gsf-generated': () => ({
    resources: [
      {
        name: 'surface.gsf',
        bytes: encodeGsf({
          width: 4,
          height: 3,
          values: Array.from({ length: 12 }, (_, index) => index + 1),
          xyUnit: 'nm',
          xReal: 4,
          yReal: 3,
          valueUnit: 'V',
        }),
      },
    ],
    payloadRanges: {},
  }),
  'envi-generated': () => ({
    resources: envi(),
    payloadRanges: { 'generated.bin': [[0, 16] as const] },
  }),
  'mrc-generated': () => ({
    resources: [{ name: 'volume.mrc', bytes: mrc() }],
    payloadRanges: { 'volume.mrc': [[1_024, 1_032] as const] },
  }),
  'mrc-medium-generated': () => {
    const bytes = mrcZeros(8_192, 8_192)
    return {
      resources: [{ name: 'volume-medium.mrc', bytes }],
      payloadRanges: { 'volume-medium.mrc': [[1_024, bytes.byteLength] as const] },
    }
  },
  'mrc-large-generated': () => {
    const bytes = mrcZeros(16_384, 16_384)
    return {
      resources: [{ name: 'volume-large.mrc', bytes }],
      payloadRanges: { 'volume-large.mrc': [[1_024, bytes.byteLength] as const] },
    }
  },
  'cbf-generated': () => ({ resources: [{ name: 'frame.cbf', bytes: cbf() }], payloadRanges: {} }),
  'ome-tiff-generated': () => ({
    resources: [{ name: 'image.ome.tiff', bytes: omeTiff() }],
    payloadRanges: {},
  }),
  'ome-zarr-generated': () => {
    const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
    const pixels = Uint8Array.from([1, 2, 3, 4])
    return {
      resources: [
        {
          name: 'zarr.json',
          bytes: json({
            zarr_format: 3,
            node_type: 'group',
            attributes: {
              ome: {
                version: '0.5',
                multiscales: [
                  {
                    name: 'demo',
                    axes: [
                      { name: 'y', type: 'space', unit: 'micrometer' },
                      { name: 'x', type: 'space', unit: 'micrometer' },
                    ],
                    datasets: [
                      {
                        path: '0',
                        coordinateTransformations: [{ type: 'scale', scale: [1, 1] }],
                      },
                    ],
                  },
                ],
              },
            },
          }),
        },
        {
          name: '0/zarr.json',
          bytes: json({
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
          }),
        },
        { name: '0/c/0/0', bytes: pixels },
      ],
      payloadRanges: { '0/c/0/0': [[0, 4] as const] },
    }
  },
  'ome-zarr-sharded-generated': () => {
    const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
    const width = 64
    const height = 64
    const inner = 16
    const pixels = new Uint8Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) pixels[y * width + x] = (y * 3 + x) & 255
    }
    const perAxis = width / inner
    const innerCount = perAxis * perAxis
    const payloads: Uint8Array[] = []
    const index = new Uint8Array(innerCount * 16)
    const indexView = new DataView(index.buffer)
    let offset = 0
    for (let innerY = 0; innerY < perAxis; innerY += 1) {
      for (let innerX = 0; innerX < perAxis; innerX += 1) {
        const chunk = new Uint8Array(inner * inner)
        for (let y = 0; y < inner; y += 1) {
          for (let x = 0; x < inner; x += 1) {
            chunk[y * inner + x] = pixels[(innerY * inner + y) * width + innerX * inner + x] ?? 0
          }
        }
        const entry = innerY * perAxis + innerX
        indexView.setUint32(entry * 16, offset, true)
        indexView.setUint32(entry * 16 + 8, chunk.byteLength, true)
        payloads.push(chunk)
        offset += chunk.byteLength
      }
    }
    const encodedIndex = new Uint8Array(index.byteLength + 4)
    encodedIndex.set(index)
    new DataView(encodedIndex.buffer).setUint32(index.byteLength, crc32c(index), true)
    const shard = new Uint8Array(offset + encodedIndex.byteLength)
    let cursor = 0
    for (const payload of payloads) {
      shard.set(payload, cursor)
      cursor += payload.byteLength
    }
    shard.set(encodedIndex, offset)
    const intersecting: (readonly [number, number])[] = []
    for (const innerY of [1, 2]) {
      for (const innerX of [1, 2]) {
        const start = (innerY * perAxis + innerX) * inner * inner
        intersecting.push([start, start + inner * inner])
      }
    }
    return {
      resources: [
        {
          name: 'zarr.json',
          bytes: json({
            zarr_format: 3,
            node_type: 'group',
            attributes: {
              ome: {
                version: '0.5',
                multiscales: [
                  {
                    name: 'sharded',
                    axes: [
                      { name: 'y', type: 'space', unit: 'micrometer' },
                      { name: 'x', type: 'space', unit: 'micrometer' },
                    ],
                    datasets: [
                      {
                        path: '0',
                        coordinateTransformations: [{ type: 'scale', scale: [1, 1] }],
                      },
                    ],
                  },
                ],
              },
            },
          }),
        },
        {
          name: '0/zarr.json',
          bytes: json({
            zarr_format: 3,
            node_type: 'array',
            shape: [height, width],
            data_type: 'uint8',
            chunk_grid: { name: 'regular', configuration: { chunk_shape: [height, width] } },
            chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
            fill_value: 0,
            codecs: [
              {
                name: 'sharding_indexed',
                configuration: {
                  chunk_shape: [inner, inner],
                  codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
                  index_codecs: [
                    { name: 'bytes', configuration: { endian: 'little' } },
                    { name: 'crc32c' },
                  ],
                  index_location: 'end',
                },
              },
            ],
            dimension_names: ['y', 'x'],
            attributes: {},
          }),
        },
        { name: '0/c/0/0', bytes: shard },
      ],
      payloadRanges: { '0/c/0/0': intersecting },
    }
  },
  'ome-zarr-sharded-large-generated': () => {
    const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
    const width = 4096
    const height = 4096
    const shard = 1024
    const inner = 256
    const shardsPerAxis = width / shard
    const innersPerAxis = shard / inner
    const innerCount = innersPerAxis * innersPerAxis
    const resources: { name: string; bytes: Uint8Array }[] = [
      {
        name: 'zarr.json',
        bytes: json({
          zarr_format: 3,
          node_type: 'group',
          attributes: {
            ome: {
              version: '0.5',
              multiscales: [
                {
                  name: 'sharded-large',
                  axes: [
                    { name: 'y', type: 'space', unit: 'micrometer' },
                    { name: 'x', type: 'space', unit: 'micrometer' },
                  ],
                  datasets: [
                    {
                      path: '0',
                      coordinateTransformations: [{ type: 'scale', scale: [1, 1] }],
                    },
                  ],
                },
              ],
            },
          },
        }),
      },
      {
        name: '0/zarr.json',
        bytes: json({
          zarr_format: 3,
          node_type: 'array',
          shape: [height, width],
          data_type: 'uint8',
          chunk_grid: { name: 'regular', configuration: { chunk_shape: [shard, shard] } },
          chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
          fill_value: 0,
          codecs: [
            {
              name: 'sharding_indexed',
              configuration: {
                chunk_shape: [inner, inner],
                codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
                index_codecs: [
                  { name: 'bytes', configuration: { endian: 'little' } },
                  { name: 'crc32c' },
                ],
                index_location: 'end',
              },
            },
          ],
          dimension_names: ['y', 'x'],
          attributes: {},
        }),
      },
    ]
    const payloadRanges: Record<string, readonly (readonly [number, number])[]> = {}
    const innerBytes = inner * inner
    for (let shardY = 0; shardY < shardsPerAxis; shardY += 1) {
      for (let shardX = 0; shardX < shardsPerAxis; shardX += 1) {
        const index = new Uint8Array(innerCount * 16)
        const indexView = new DataView(index.buffer)
        const shardBytes = new Uint8Array(innerCount * innerBytes + innerCount * 16 + 4)
        let offset = 0
        for (let innerY = 0; innerY < innersPerAxis; innerY += 1) {
          for (let innerX = 0; innerX < innersPerAxis; innerX += 1) {
            const entry = innerY * innersPerAxis + innerX
            shardBytes.fill(
              (shardY * 17 + shardX * 3 + innerY + innerX) & 255,
              offset,
              offset + innerBytes,
            )
            indexView.setUint32(entry * 16, offset, true)
            indexView.setUint32(entry * 16 + 8, innerBytes, true)
            offset += innerBytes
          }
        }
        shardBytes.set(index, offset)
        new DataView(shardBytes.buffer).setUint32(offset + index.byteLength, crc32c(index), true)
        const name = `0/c/${shardY}/${shardX}`
        resources.push({ name, bytes: shardBytes })
        payloadRanges[name] = [[0, innerCount * innerBytes]]
      }
    }
    return { resources, payloadRanges }
  },
  'ome-zarr-wsi-generated': omeZarrWsi,
  'ome-tiff-viewer-generated': () => ({
    resources: [{ name: 'viewer.ome.tiff', bytes: viewerOmeTiff() }],
    payloadRanges: {},
  }),
  'cog-viewer-generated': () => ({
    resources: [{ name: 'viewer.tiff', bytes: viewerCog() }],
    payloadRanges: {},
  }),
  'digital-micrograph-generated': () => ({
    resources: [{ name: 'image.dm3', bytes: generatedDigitalMicrographFixture() }],
    payloadRanges: {},
  }),
  'digital-micrograph-4d-generated': () => ({
    resources: [{ name: 'stem.dm4', bytes: generatedDigitalMicrographFourDStemFixture() }],
    payloadRanges: {},
  }),
  'digital-micrograph-4d-medium-generated': () => ({
    resources: [
      {
        name: 'stem-medium.dm4',
        bytes: generatedDigitalMicrographFourDStemFixture({
          dimensions: [128, 128, 64, 32],
          zeroFilled: true,
        }),
      },
    ],
    payloadRanges: {},
  }),
  'tia-ser-image-generated': () => ({
    resources: [{ name: 'image.ser', bytes: generatedTiaSerImageSeries() }],
    payloadRanges: {},
  }),
  'tia-ser-spectrum-generated': () => ({
    resources: [{ name: 'spectra.ser', bytes: generatedTiaSerSpectrumImage() }],
    payloadRanges: {},
  }),
  'tia-ser-point-generated': () => ({
    resources: [{ name: 'point.ser', bytes: generatedTiaSerPointSpectrum() }],
    payloadRanges: {},
  }),
  'tia-emi-generated': () => ({
    resources: [
      {
        name: 'sample.emi',
        bytes: generateTiaEmiFixture([
          generatedTiaEmiObject({
            uuid: 'generated-emi',
            mode: 'STEM',
            microscope: 'Generated microscope',
            calibrationValue: 1.5,
          }),
        ]),
      },
      { name: 'sample_1.ser', bytes: generatedTiaSerImageSeries() },
    ],
    payloadRanges: {},
  }),
  'ncem-generated': () => ({
    resources: [
      {
        name: 'image.emd',
        bytes: createGeneratedNcemEmdFixture({ acquisitionMetadata: true, acquisitionArrays: true })
          .bytes,
      },
    ],
    payloadRanges: {},
  }),
  'velox-generated': () => ({
    resources: [
      {
        name: 'image.emd',
        bytes: createGeneratedVeloxEmdFixture({ variant: 'image', imageCount: 1 }).bytes,
      },
    ],
    payloadRanges: {},
  }),
  'velox-complex-generated': () => ({
    resources: [
      {
        name: 'complex.emd',
        bytes: createGeneratedVeloxEmdFixture({ variant: 'fft', imageCount: 1 }).bytes,
      },
    ],
    payloadRanges: {},
  }),
  'rpl-generated': () => ({ resources: rpl(), payloadRanges: { 'sample.raw': [[0, 8] as const] } }),
  'emsa-generated': () => ({
    resources: [{ name: 'spectrum.msa', bytes: emsa() }],
    payloadRanges: {},
  }),
  'nrrd-raw-generated': () => ({
    resources: [{ name: 'array.nrrd', bytes: nrrd('raw') }],
    payloadRanges: {},
  }),
  'nrrd-medium-generated': () => {
    const bytes = nrrdZeros(8_192, 8_192)
    const payloadOffset = bytes.byteLength - 8_192 * 8_192
    return {
      resources: [{ name: 'array-medium.nrrd', bytes }],
      payloadRanges: { 'array-medium.nrrd': [[payloadOffset, bytes.byteLength] as const] },
    }
  },
  'nrrd-large-generated': () => {
    const bytes = nrrdZeros(16_384, 16_384)
    const payloadOffset = bytes.byteLength - 16_384 * 16_384
    return {
      resources: [{ name: 'array-large.nrrd', bytes }],
      payloadRanges: { 'array-large.nrrd': [[payloadOffset, bytes.byteLength] as const] },
    }
  },
  'nrrd-gzip-generated': () => ({
    resources: [{ name: 'array.nrrd', bytes: nrrd('gzip') }],
    payloadRanges: {},
  }),
  'mha-generated': () => ({ resources: metaImage(false), payloadRanges: {} }),
  'mhd-generated': () => ({
    resources: metaImage(true),
    payloadRanges: { 'image.raw': [[0, 4] as const] },
  }),
  'nifti-generated': () => ({
    resources: [{ name: 'volume.nii', bytes: nifti() }],
    payloadRanges: {},
  }),
  'nifti-medium-generated': () => {
    const bytes = niftiZeros(8_192, 4_096)
    return {
      resources: [{ name: 'volume-medium.nii', bytes }],
      payloadRanges: { 'volume-medium.nii': [[352, bytes.byteLength] as const] },
    }
  },
  'nifti-large-generated': () => {
    const bytes = niftiZeros(16_384, 8_192)
    return {
      resources: [{ name: 'volume-large.nii', bytes }],
      payloadRanges: { 'volume-large.nii': [[352, bytes.byteLength] as const] },
    }
  },
  'nifti-gzip-generated': () => ({
    resources: [{ name: 'volume.nii.gz', bytes: Uint8Array.from(gzipSync(nifti())) }],
    payloadRanges: {},
  }),
  'dicom-generated': () => {
    const pixels = Uint8Array.of(0, 1, 2, 3)
    const bytes = writeDicomPart10({
      transferSyntax: 'explicit-vr-le',
      dataset: [
        ...dicomIdentityElements(),
        ...dicomMonochromePixelElements({ rows: 2, columns: 2, bitsAllocated: 8 }),
        { tag: dicomTag.pixelSpacing, vr: 'DS', value: dicomDecimalBytes(0.5, 0.4) },
        { tag: dicomTag.pixelData, vr: 'OB', value: pixels },
      ],
    })
    return {
      resources: [{ name: 'image.dcm', bytes }],
      payloadRanges: { 'image.dcm': [[bytes.byteLength - 4, bytes.byteLength] as const] },
    }
  },
  'npy-c-generated': () => ({
    resources: [{ name: 'array.npy', bytes: npy([2, 3], [1, 2, 3, 4, 5, 6]) }],
    payloadRanges: {},
  }),
  'npy-medium-generated': () => {
    const bytes = npyZeros([8_192, 4_096])
    const payloadOffset = bytes.byteLength - 8_192 * 4_096 * 2
    return {
      resources: [{ name: 'array-medium.npy', bytes }],
      payloadRanges: { 'array-medium.npy': [[payloadOffset, bytes.byteLength] as const] },
    }
  },
  'npy-large-generated': () => {
    const bytes = npyZeros([16_384, 8_192])
    const payloadOffset = bytes.byteLength - 16_384 * 8_192 * 2
    return {
      resources: [{ name: 'array-large.npy', bytes }],
      payloadRanges: { 'array-large.npy': [[payloadOffset, bytes.byteLength] as const] },
    }
  },
  'tiff-medium-generated': () => {
    const bytes = tiledTiffZeros(8_192, 8_192)
    const payloadOffset = bytes.byteLength - 8_192 * 8_192
    return {
      resources: [{ name: 'image-medium.tiff', bytes }],
      payloadRanges: { 'image-medium.tiff': [[payloadOffset, bytes.byteLength] as const] },
    }
  },
  'tiff-large-generated': () => {
    const bytes = tiledTiffZeros(16_384, 16_384)
    const payloadOffset = bytes.byteLength - 16_384 * 16_384
    return {
      resources: [{ name: 'image-large.tiff', bytes }],
      payloadRanges: { 'image-large.tiff': [[payloadOffset, bytes.byteLength] as const] },
    }
  },
  'tiff-small-tiles-generated': () => {
    const width = 2_048
    const height = 2_048
    const bytes = tiledTiffZeros(width, height, 64, 64, 80_000)
    const payloadOffset = bytes.byteLength - width * height
    return {
      resources: [{ name: 'image-small-tiles.tiff', bytes }],
      payloadRanges: { 'image-small-tiles.tiff': [[payloadOffset, bytes.byteLength] as const] },
    }
  },
  'npy-f-generated': () => ({
    resources: [{ name: 'array.npy', bytes: npy([3, 2], [1, 2, 3, 4, 5, 6], true) }],
    payloadRanges: {},
  }),
  'blockfile-generated': () => ({
    resources: [{ name: 'detector.blo', bytes: blockfile() }],
    payloadRanges: {},
  }),
  'mib-generated': () => ({
    resources: [{ name: 'detector.mib', bytes: mib() }],
    payloadRanges: {},
  }),
  'ebsd-ang-generated': () => ({
    resources: [{ name: 'map.ang', bytes: ebsd('ang') }],
    payloadRanges: {},
  }),
  'ebsd-ctf-generated': () => ({
    resources: [{ name: 'map.ctf', bytes: ebsd('ctf') }],
    payloadRanges: {},
  }),
})
