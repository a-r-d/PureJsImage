import { gzipSync } from 'node:zlib'

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
import { encodeGsf } from '../../src/scientific/readers/gsf.ts'

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
    '<?xml version="1.0" encoding="UTF-8"?><OME><Image ID="Image:0" Name="Generated"><Pixels DimensionOrder="XYZCT" Type="uint8" SizeX="2" SizeY="2" SizeZ="1" SizeC="1" SizeT="1"><Channel ID="Channel:0:0" SamplesPerPixel="1"/><TiffData IFD="0" PlaneCount="1"/></Pixels></Image></OME>\0',
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
  'cbf-generated': () => ({ resources: [{ name: 'frame.cbf', bytes: cbf() }], payloadRanges: {} }),
  'ome-tiff-generated': () => ({
    resources: [{ name: 'image.ome.tiff', bytes: omeTiff() }],
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
  'nifti-gzip-generated': () => ({
    resources: [{ name: 'volume.nii.gz', bytes: Uint8Array.from(gzipSync(nifti())) }],
    payloadRanges: {},
  }),
  'npy-c-generated': () => ({
    resources: [{ name: 'array.npy', bytes: npy([2, 3], [1, 2, 3, 4, 5, 6]) }],
    payloadRanges: {},
  }),
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
