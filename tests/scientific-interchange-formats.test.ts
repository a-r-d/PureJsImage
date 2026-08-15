import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { rasterSampleBytes } from '../src/raster.ts'
import type { ScientificDataset } from '../src/scientific/dataset.ts'
import { blockfileReader, createBlockfileReader } from '../src/scientific/readers/blockfile.ts'
import { createEbsdTextReader, ebsdTextReader } from '../src/scientific/readers/ebsd-text.ts'
import { emsaReader } from '../src/scientific/readers/emsa.ts'
import { metaImageReader } from '../src/scientific/readers/meta-image.ts'
import { mibReader } from '../src/scientific/readers/mib.ts'
import { niftiReader } from '../src/scientific/readers/nifti.ts'
import { createNpyReader, npyReader } from '../src/scientific/readers/npy.ts'
import { createNrrdReader, nrrdReader } from '../src/scientific/readers/nrrd.ts'
import { rplReader } from '../src/scientific/readers/rpl.ts'
import { readRasterSample } from '../src/scientific/samples.ts'
import type {
  ScientificOpenContext,
  ScientificReader,
  ScientificResource,
} from '../src/scientific/reader.ts'
import { MemorySource, type ImageSource, type ImageSourceReadOptions } from '../src/source.ts'

class TrackingSource implements ImageSource {
  readonly size: number
  readonly reads: { readonly offset: number; readonly length: number }[] = []
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    if (options.signal?.aborted === true) throw options.signal.reason
    this.reads.push(Object.freeze({ offset, length }))
    return this.#bytes.slice(offset, Math.min(this.size, offset + length))
  }
}

const text = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value)

const resource = (id: string, name: string, bytes: Uint8Array): ScientificResource =>
  Object.freeze({ id, name, source: new MemorySource(bytes) })

const context = (
  name: string,
  bytes: Uint8Array,
  companions: Readonly<Record<string, ScientificResource>> = {},
): ScientificOpenContext => ({
  primary: resource('primary', name, bytes),
  companions: {
    async resolve(request) {
      const name = request.kind === 'relative-name' ? request.name : request.relativeName
      return name === undefined ? undefined : companions[name]
    },
  },
})

const openDataset = async (
  reader: ScientificReader,
  openContext: ScientificOpenContext,
  id?: string,
): Promise<ScientificDataset> => {
  const document = await reader.open(openContext)
  return document.openDataset(id ?? document.datasets[0]?.id ?? '')
}

const planeValues = async (
  dataset: ScientificDataset,
  displayAxes?: readonly [string, string],
  fixedIndices: readonly { readonly axisId: string; readonly index: number }[] = [],
): Promise<number[]> => {
  const values: number[] = []
  const resolvedAxes = displayAxes ?? [
    dataset.descriptor.axes[0]?.id ?? '',
    dataset.descriptor.axes[1]?.id ?? '',
  ]
  for await (const block of dataset.readPlane({
    displayAxes: resolvedAxes,
    fixedIndices,
  })) {
    const sampleBytes = rasterSampleBytes(block.format.sampleType)
    const pixelBytes = sampleBytes * block.format.channels
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let y = 0; y < block.height; y += 1) {
      for (let x = 0; x < block.width; x += 1) {
        for (let channel = 0; channel < block.format.channels; channel += 1) {
          values.push(
            readRasterSample(
              block.data,
              view,
              y * block.stride + x * pixelBytes + channel * sampleBytes,
              block.format.sampleType,
            ),
          )
        }
      }
    }
  }
  return values
}

const seriesValues = async (dataset: ScientificDataset): Promise<number[]> => {
  const values: number[] = []
  const axis = dataset.descriptor.axes[0]
  if (axis === undefined) throw new Error('Test dataset has no series axis')
  const readSeries = dataset.readSeries
  if (readSeries === undefined) throw new Error('Test dataset has no series reader')
  for await (const block of readSeries.call(dataset, { axisId: axis.id, fixedIndices: [] })) {
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    const sampleBytes = rasterSampleBytes(block.format.sampleType)
    for (let index = 0; index < block.length; index += 1) {
      values.push(
        readRasterSample(
          block.data,
          view,
          index * sampleBytes * block.format.channels,
          block.format.sampleType,
        ),
      )
    }
  }
  return values
}

const npy = (
  shape: readonly number[],
  values: readonly number[],
  fortranOrder = false,
): Uint8Array<ArrayBuffer> => {
  const dictionary = `{'descr': '<u2', 'fortran_order': ${fortranOrder ? 'True' : 'False'}, 'shape': (${shape.join(', ')},), }`
  const padding = (64 - ((10 + dictionary.length + 1) % 64)) % 64
  const header = text(`${dictionary}${' '.repeat(padding)}\n`)
  const output = new Uint8Array(10 + header.byteLength + values.length * 2)
  output.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0])
  new DataView(output.buffer).setUint16(8, header.byteLength, true)
  output.set(header, 10)
  const view = new DataView(output.buffer)
  for (const [index, value] of values.entries()) {
    view.setUint16(10 + header.byteLength + index * 2, value, true)
  }
  return output
}

const nifti1 = (): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(356)
  const view = new DataView(output.buffer)
  view.setInt32(0, 348, true)
  view.setInt16(40, 2, true)
  view.setInt16(42, 2, true)
  view.setInt16(44, 1, true)
  view.setInt16(70, 4, true)
  view.setInt16(72, 16, true)
  view.setFloat32(80, 0.5, true)
  view.setFloat32(84, 2, true)
  view.setFloat32(108, 352, true)
  view.setFloat32(112, 2, true)
  view.setFloat32(116, 1, true)
  output[123] = 2
  output.set(text('test volume'), 148)
  output.set(text('n+1\0'), 344)
  view.setInt16(352, 3, true)
  view.setInt16(354, 7, true)
  return output
}

const nifti2 = (): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(548)
  const view = new DataView(output.buffer)
  view.setInt32(0, 540, true)
  output.set(text('n+2\0\r\n\x1a\n'), 4)
  view.setInt16(12, 2, true)
  view.setInt16(14, 8, true)
  view.setBigInt64(16, 2n, true)
  view.setBigInt64(24, 2n, true)
  view.setBigInt64(32, 2n, true)
  view.setFloat64(112, 1, true)
  view.setFloat64(120, 1, true)
  view.setBigInt64(168, 544n, true)
  view.setFloat64(176, 1, true)
  view.setInt32(500, 2, true)
  output.set([1, 2, 3, 4], 544)
  return output
}

const blockfile = (): Uint8Array<ArrayBuffer> => {
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

const mib = (): Uint8Array<ArrayBuffer> => {
  const headerText = 'MQ1,1,384,1,2,2,U08,1x1,2024-01-01,100ns,0,0'
  const output = new Uint8Array(388)
  output.fill(0x20, 0, 384)
  output.set(text(headerText))
  output.set([1, 2, 3, 4], 384)
  return output
}

describe('Milestone H interchange and detector readers', () => {
  it('reads C-order and Fortran-order NPY arrays without inventing axis semantics', async () => {
    const c = await openDataset(npyReader, context('array.npy', npy([2, 3], [1, 2, 3, 4, 5, 6])))
    expect(c.descriptor.axes.map(({ id, length, kind }) => ({ id, length, kind }))).toEqual([
      { id: 'axis1', length: 3, kind: 'index' },
      { id: 'axis0', length: 2, kind: 'index' },
    ])
    await expect(planeValues(c)).resolves.toEqual([1, 2, 3, 4, 5, 6])

    const f = await openDataset(
      npyReader,
      context('fortran.npy', npy([3, 2], [1, 2, 3, 4, 5, 6], true)),
    )
    await expect(planeValues(f)).resolves.toEqual([1, 2, 3, 4, 5, 6])
  })

  it('reads paired RPL/RAW vector records with sidecar calibration', async () => {
    const header = text(`key\tvalue
width\t2
height\t2
depth\t2
data-type\tunsigned
data-length\t1
byte-order\tdont-care
record-by\tvector
width-scale\t0.5
width-units\tnm
height-scale\t1
height-units\tnm
ev-per-chan\t10
signal\tEDS
`)
    const raw = resource('raw', 'map.raw', Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]))
    const dataset = await openDataset(rplReader, context('map.rpl', header, { 'map.raw': raw }))
    expect(dataset.descriptor.axes.map(({ id }) => id)).toEqual(['depth', 'x', 'y'])
    expect(dataset.descriptor.axes[0]).toMatchObject({ unit: 'eV', coordinates: { step: 10 } })
    await expect(
      planeValues(dataset, ['x', 'y'], [{ axisId: 'depth', index: 1 }]),
    ).resolves.toEqual([1, 3, 5, 7])
  })

  it('reads EMSA Y and XY spectra with native calibrated series coordinates', async () => {
    const y = text(`#FORMAT: EMSA/MAS Spectral Data File
#VERSION: 1.0
#TITLE: Test
#NPOINTS: 3
#DATATYPE: Y
#XUNITS: eV
#YUNITS: counts
#OFFSET: 100
#XPERCHAN: 5
#SPECTRUM:
1, 2, 3
#ENDOFDATA:
`)
    const yDataset = await openDataset(emsaReader, context('spectrum.msa', y))
    expect(yDataset.descriptor.axes[0]).toMatchObject({
      unit: 'eV',
      coordinates: { type: 'linear', origin: 100, step: 5 },
    })
    await expect(seriesValues(yDataset)).resolves.toEqual([1, 2, 3])

    const xy = text(`#FORMAT: EMSA/MAS Spectral Data File
#NPOINTS: 3
#DATATYPE: XY
#SPECTRUM:
1, 9, 2, 8, 4, 7
#ENDOFDATA:
`)
    const xyDataset = await openDataset(emsaReader, context('lookup.emsa', xy))
    expect(xyDataset.descriptor.axes[0]?.coordinates).toEqual({ type: 'lookup', values: [1, 2, 4] })
    await expect(seriesValues(xyDataset)).resolves.toEqual([9, 8, 7])
  })

  it('reads attached and gzip NRRD arrays with vector-valued direction fields', async () => {
    const header = text(`NRRD0005
type: ushort
dimension: 2
sizes: 2 2
encoding: raw
endian: little
space directions: (0.5, 0, 0) (0, 2, 0)
space origin: (10, 20, 0)
units: "mm" "mm"

`)
    const bytes = new Uint8Array(header.byteLength + 8)
    bytes.set(header)
    const view = new DataView(bytes.buffer)
    for (const [index, value] of [1, 2, 3, 4].entries()) {
      view.setUint16(header.byteLength + index * 2, value, true)
    }
    const dataset = await openDataset(nrrdReader, context('array.nrrd', bytes))
    expect(dataset.descriptor.axes[0]).toMatchObject({ unit: 'mm', coordinates: { step: 0.5 } })
    await expect(planeValues(dataset)).resolves.toEqual([1, 2, 3, 4])

    const gzHeader = text(`NRRD0005
type: uchar
dimension: 2
sizes: 2 2
encoding: gzip

`)
    const compressed = Uint8Array.from(gzipSync(Uint8Array.from([5, 6, 7, 8])))
    const gz = new Uint8Array(gzHeader.byteLength + compressed.byteLength)
    gz.set(gzHeader)
    gz.set(compressed, gzHeader.byteLength)
    await expect(
      planeValues(await openDataset(nrrdReader, context('array-gzip.nrrd', gz))),
    ).resolves.toEqual([5, 6, 7, 8])
  })

  it('reads local MHA and detached MHD payloads', async () => {
    const localHeader = text(`ObjectType = Image
NDims = 2
DimSize = 2 2
ElementType = MET_UCHAR
ElementSpacing = 0.25 0.5
ElementDataFile = LOCAL
`)
    const mha = new Uint8Array(localHeader.byteLength + 4)
    mha.set(localHeader)
    mha.set([1, 2, 3, 4], localHeader.byteLength)
    const local = await openDataset(metaImageReader, context('image.mha', mha))
    await expect(planeValues(local)).resolves.toEqual([1, 2, 3, 4])

    const mhd = text(`ObjectType = Image
NDims = 2
DimSize = 2 1
ElementType = MET_USHORT
ElementByteOrderMSB = True
ElementDataFile = image.raw
`)
    const raw = resource('raw', 'image.raw', Uint8Array.from([0, 10, 0, 20]))
    await expect(
      planeValues(
        await openDataset(metaImageReader, context('image.mhd', mhd, { 'image.raw': raw })),
      ),
    ).resolves.toEqual([10, 20])
  })

  it('reads NIfTI-1, gzip-wrapped NIfTI-1, and NIfTI-2 arrays', async () => {
    const first = await openDataset(niftiReader, context('volume.nii', nifti1()))
    expect(first.descriptor.sampleType).toBe('float64')
    expect(first.descriptor.axes[0]).toMatchObject({ unit: 'mm', coordinates: { step: 0.5 } })
    await expect(planeValues(first)).resolves.toEqual([7, 15])

    const compressed = Uint8Array.from(gzipSync(nifti1()))
    await expect(
      planeValues(await openDataset(niftiReader, context('volume.nii.gz', compressed))),
    ).resolves.toEqual([7, 15])

    await expect(
      planeValues(await openDataset(niftiReader, context('volume-v2.nii', nifti2()))),
    ).resolves.toEqual([1, 2, 3, 4])
  })

  it('exposes BLO navigator and vertically normalized diffraction frames', async () => {
    const document = await blockfileReader.open(context('scan.blo', blockfile()))
    expect(document.datasets.map(({ id }) => id)).toEqual(['diffraction', 'navigator'])
    await expect(planeValues(await document.openDataset('navigator'))).resolves.toEqual([
      10, 20, 30, 40,
    ])
    await expect(
      planeValues(
        await document.openDataset('diffraction'),
        ['kx', 'ky'],
        [
          { axisId: 'scanX', index: 1 },
          { axisId: 'scanY', index: 0 },
        ],
      ),
    ).resolves.toEqual([7, 8, 5, 6])
  })

  it('reads processed Merlin MIB frames and rejects packed raw R64 data', async () => {
    const dataset = await openDataset(mibReader, context('detector.mib', mib()))
    await expect(
      planeValues(dataset, ['kx', 'ky'], [{ axisId: 'frame', index: 0 }]),
    ).resolves.toEqual([3, 4, 1, 2])
    const raw = mib()
    raw.set(text('R64'), 'MQ1,1,384,1,2,2,'.length)
    await expect(mibReader.open(context('raw.mib', raw))).rejects.toThrow(/R64/u)
  })

  it('reads rectangular ANG and CTF orientation maps and rejects hexagonal ANG grids', async () => {
    const ang = text(`# GRID: SqrGrid
# XSTEP: 1
# YSTEP: 2
# NCOLS_ODD: 2
# NCOLS_EVEN: 2
# NROWS: 2
0.1 0.2 0.3 0 0 10 0.9 1
0.4 0.5 0.6 1 0 11 0.8 1
0.7 0.8 0.9 0 2 12 0.7 2
1.0 1.1 1.2 1 2 13 0.6 2
`)
    const angDataset = await openDataset(ebsdTextReader, context('map.ang', ang))
    expect(angDataset.descriptor.components.map(({ id }) => id)).toEqual([
      'euler1',
      'euler2',
      'euler3',
      'xPosition',
      'yPosition',
      'imageQuality',
      'confidenceIndex',
      'phase',
    ])
    expect((await planeValues(angDataset)).slice(0, 8)).toEqual([0.1, 0.2, 0.3, 0, 0, 10, 0.9, 1])

    const ctf = text(`Channel Text File
Prj test
XCells 2
YCells 1
XStep 0.5
YStep 1
Phases 0
Phase X Y Bands Error Euler1 Euler2 Euler3 MAD BC BS
1 0 0 8 0 10 20 30 0.5 100 20
1 0.5 0 8 0 11 21 31 0.6 101 21
`)
    const ctfDataset = await openDataset(ebsdTextReader, context('map.ctf', ctf))
    expect((await planeValues(ctfDataset)).slice(0, 11)).toEqual([
      1, 0, 0, 8, 0, 10, 20, 30, 0.5, 100, 20,
    ])

    const hex = new TextEncoder().encode(
      new TextDecoder().decode(ang).replace('SqrGrid', 'HexGrid'),
    )
    await expect(ebsdTextReader.open(context('hex.ang', hex))).rejects.toThrow(/Hexagonal/u)
  })

  it('keeps uncompressed NIfTI metadata and selected reads lazy across a sparse source', async () => {
    const sparse = new Uint8Array(1_000_004)
    sparse.set(nifti1().subarray(0, 348))
    const view = new DataView(sparse.buffer)
    view.setFloat32(108, 1_000_000, true)
    sparse.set(text('n+1\0'), 344)
    view.setInt16(1_000_000, 3, true)
    view.setInt16(1_000_002, 7, true)
    const source = new TrackingSource(sparse)
    const document = await niftiReader.open({
      primary: { id: 'sparse', name: 'sparse.nii', source },
    })
    expect(source.reads).toEqual([
      { offset: 0, length: 2 },
      { offset: 0, length: 540 },
    ])
    const dataset = await document.openDataset('volume')
    await expect(planeValues(dataset)).resolves.toEqual([7, 15])
    expect(source.reads.slice(2)).toEqual([{ offset: 1_000_000, length: 4 }])
  })

  it('resolves detached NRRD data and preserves the same descriptor and samples', async () => {
    const header = text(`NRRD0005
type: uchar
dimension: 2
sizes: 2 2
encoding: raw
data file: payload.raw
`)
    const raw = resource('raw', 'payload.raw', Uint8Array.from([4, 3, 2, 1]))
    const detached = await openDataset(
      nrrdReader,
      context('array.nhdr', header, { 'payload.raw': raw }),
    )
    await expect(planeValues(detached)).resolves.toEqual([4, 3, 2, 1])
    expect(detached.descriptor.axes.map(({ id, length }) => ({ id, length }))).toEqual([
      { id: 'axis0', length: 2 },
      { id: 'axis1', length: 2 },
    ])
  })

  it('enforces operation, element, compression, cancellation, and truncation limits', async () => {
    const operationLimited = createNpyReader({
      limits: { maxReadOperations: 1, rowsPerBlock: 2 },
    })
    const dataset = await openDataset(
      operationLimited,
      context('limited.npy', npy([2, 2], [1, 2, 3, 4])),
    )
    await expect(planeValues(dataset)).rejects.toThrow(/maxReadOperations/u)
    await expect(
      createNpyReader({ limits: { maxElements: 3 } }).open(
        context('too-many.npy', npy([2, 2], [1, 2, 3, 4])),
      ),
    ).rejects.toThrow(/element count/u)

    const corruptHeader = text(`NRRD0005
type: uchar
dimension: 2
sizes: 2 2
encoding: gzip

`)
    const corrupt = new Uint8Array(corruptHeader.byteLength + 4)
    corrupt.set(corruptHeader)
    corrupt.set([1, 2, 3, 4], corruptHeader.byteLength)
    await expect(nrrdReader.open(context('corrupt.nrrd', corrupt))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      emsaReader.open({ ...context('cancelled.msa', text('unused')), signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    await expect(
      npyReader.open(context('truncated.npy', npy([2, 2], [1, 2, 3, 4]).slice(0, -1))),
    ).rejects.toThrow(/exactly one complete array/u)
    await expect(
      blockfileReader.open(context('truncated.blo', blockfile().slice(0, -1))),
    ).rejects.toThrow(/file size/u)
    await expect(mibReader.open(context('truncated.mib', mib().slice(0, -1)))).rejects.toThrow(
      /incomplete frame/u,
    )

    const detachedHeader = text(`NRRD0005
type: uchar
dimension: 1
sizes: 1
encoding: gzip
data file: oversized.raw
`)
    const detachedSource = new TrackingSource(new Uint8Array(16))
    await expect(
      createNrrdReader({ limits: { maxInputBytes: 8 } }).open({
        ...context('oversized.nhdr', detachedHeader),
        companions: {
          async resolve() {
            return { id: 'oversized', name: 'oversized.raw', source: detachedSource }
          },
        },
      }),
    ).rejects.toThrow(/maxInputBytes/u)
    expect(detachedSource.reads).toEqual([])

    const oversizedBlo = new Uint8Array(blockfile().byteLength + 2)
    oversizedBlo.set(blockfile().subarray(0, 240))
    oversizedBlo.set([1, 2], 240)
    oversizedBlo.set(blockfile().subarray(240), 242)
    const oversizedBloView = new DataView(oversizedBlo.buffer)
    oversizedBloView.setUint32(8, 242, true)
    oversizedBloView.setUint32(12, 246, true)
    await expect(
      createBlockfileReader({ limits: { maxHeaderBytes: 241 } }).open(
        context('oversized-header.blo', oversizedBlo),
      ),
    ).rejects.toThrow(/header exceeds/u)

    await expect(
      createEbsdTextReader({ limits: { maxDecodedBytes: 64 } }).open(
        context(
          'oversized.ang',
          text(`# GRID: SqrGrid
# XSTEP: 1
# YSTEP: 1
# NCOLS_ODD: 2
# NCOLS_EVEN: 2
# NROWS: 1
0 0 0 0 0 1 1 1
0 0 0 1 0 1 1 1
`),
        ),
      ),
    ).rejects.toThrow(/maxDecodedBytes/u)
  })
})
