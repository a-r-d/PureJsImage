import { describe, expect, it } from 'vitest'
import type { RasterSampleType } from '../src/raster.ts'
import { openFits } from '../src/scientific/formats/fits.ts'
import { fitsReader, ScientificReaderRegistry } from '../src/scientific/index.ts'
import { readRasterSample } from '../src/scientific/samples.ts'
import { MemorySource, type ImageSource } from '../src/source.ts'

type FixtureValue = string | boolean | number

interface FixtureHdu {
  readonly primary: boolean
  readonly bitpix: number
  readonly dimensions: readonly number[]
  readonly values?: readonly FixtureValue[]
  readonly extensionType?: string
  readonly extraCards?: readonly string[]
}

const valueText = (value: FixtureValue): string => {
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  if (typeof value === 'boolean') return value ? 'T' : 'F'
  return String(value)
}

const card = (keyword: string, value?: FixtureValue, comment?: string): string => {
  const prefix = keyword.padEnd(8, ' ')
  if (value === undefined) return `${prefix}${comment ?? ''}`.padEnd(80, ' ')
  const text = valueText(value)
  const field = typeof value === 'string' ? text.padEnd(20, ' ') : text.padStart(20, ' ')
  return `${prefix}= ${field}${comment ? ` / ${comment}` : ''}`.padEnd(80, ' ').slice(0, 80)
}

const sampleBytes = (bitpix: number): number => Math.abs(bitpix) / 8

const dataBytes = (bitpix: number, values: readonly FixtureValue[]): Uint8Array => {
  const output = new Uint8Array(values.length * sampleBytes(bitpix))
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (typeof value !== 'number') throw new Error('FITS fixture samples must be numeric')
    const offset = index * sampleBytes(bitpix)
    if (bitpix === 8) view.setUint8(offset, value)
    else if (bitpix === 16) view.setInt16(offset, value, false)
    else if (bitpix === 32) view.setInt32(offset, value, false)
    else if (bitpix === 64) view.setBigInt64(offset, BigInt(value), false)
    else if (bitpix === -32) view.setFloat32(offset, value, false)
    else view.setFloat64(offset, value, false)
  }
  return output
}

const hduBytes = (options: FixtureHdu): Uint8Array => {
  const cards = [
    card(
      options.primary ? 'SIMPLE' : 'XTENSION',
      options.primary ? true : (options.extensionType ?? 'IMAGE'),
    ),
    card('BITPIX', options.bitpix),
    card('NAXIS', options.dimensions.length),
    ...options.dimensions.map((dimension, index) => card(`NAXIS${index + 1}`, dimension)),
    ...(options.primary ? [] : [card('PCOUNT', 0), card('GCOUNT', 1)]),
    ...(options.extraCards ?? []),
    card('END'),
  ]
  const headerLength = Math.ceil((cards.length * 80) / 2_880) * 2_880
  const values = options.values ?? []
  const data = dataBytes(options.bitpix, values)
  const dataLength = Math.ceil(data.byteLength / 2_880) * 2_880
  const output = new Uint8Array(headerLength + dataLength)
  output.fill(0x20, 0, headerLength)
  output.set(new TextEncoder().encode(cards.join('')))
  output.set(data, headerLength)
  return output
}

const documentBytes = (...hdus: readonly FixtureHdu[]): Uint8Array => {
  const parts = hdus.map(hduBytes)
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const readValues = async (
  dataset: Awaited<ReturnType<Awaited<ReturnType<typeof openFits>>['openImage']>>,
  request: {
    readonly z: number
    readonly x?: number
    readonly y?: number
    readonly width?: number
    readonly height?: number
  } = { z: 0 },
): Promise<number[]> => {
  const values: number[] = []
  for await (const block of dataset.readPlane({ c: 0, t: 0, ...request })) {
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    const bytes = sampleBytesForType(block.format.sampleType)
    for (let row = 0; row < block.height; row += 1) {
      for (let x = 0; x < block.width; x += 1) {
        values.push(
          readRasterSample(
            block.data,
            view,
            row * block.stride + x * bytes,
            block.format.sampleType,
          ),
        )
      }
    }
  }
  return values
}

const sampleBytesForType = (sampleType: RasterSampleType): number =>
  sampleType === 'uint8' || sampleType === 'int8'
    ? 1
    : sampleType === 'uint16' || sampleType === 'int16' || sampleType === 'float16'
      ? 2
      : sampleType === 'uint32' || sampleType === 'int32' || sampleType === 'float32'
        ? 4
        : 8

class RecordingSource implements ImageSource {
  readonly size: number
  readonly reads: { readonly offset: number; readonly length: number }[] = []
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.reads.push({ offset, length })
    return this.#bytes.subarray(offset, Math.min(this.size, offset + length))
  }
}

describe('FITS scientific image arrays', () => {
  it.each([
    [8, 'uint8', [0, 127, 255]],
    [16, 'int16', [-32_768, 0, 32_767]],
    [32, 'int32', [-2_000_000_000, 0, 2_000_000_000]],
    [-32, 'float32', [-1.5, 0.25, 100.5]],
    [-64, 'float64', [-1.25, Math.PI, 1e100]],
  ] as const)('decodes BITPIX=%i big-endian samples as %s', async (bitpix, sampleType, values) => {
    const document = await openFits(
      documentBytes({ primary: true, bitpix, dimensions: [3], values }),
    )
    const dataset = await document.openImage(0)
    expect(dataset.sampleType).toBe(sampleType)
    const decoded = await readValues(dataset)
    values.forEach((value, index) => {
      expect(decoded[index]).toBeCloseTo(value, bitpix === -32 ? 5 : 12)
    })
  })

  it('maps 1D, 2D, and selected 3D Z/ROI arrays onto raster coordinates', async () => {
    const one = await openFits(
      documentBytes({ primary: true, bitpix: 8, dimensions: [4], values: [1, 2, 3, 4] }),
    )
    const oneDataset = await one.openImage(0)
    expect([oneDataset.sizeX, oneDataset.sizeY, oneDataset.sizeZ]).toEqual([4, 1, 1])
    const two = await openFits(
      documentBytes({ primary: true, bitpix: 16, dimensions: [3, 2], values: [0, 1, 2, 3, 4, 5] }),
    )
    expect(
      await readValues(await two.openImage(0), { z: 0, x: 1, y: 0, width: 2, height: 2 }),
    ).toEqual([1, 2, 4, 5])
    const cubeValues = Array.from({ length: 24 }, (_, index) => index)
    const cube = await openFits(
      documentBytes({ primary: true, bitpix: 32, dimensions: [4, 3, 2], values: cubeValues }),
    )
    expect(
      await readValues(await cube.openImage(0), { z: 1, x: 1, y: 1, width: 2, height: 2 }),
    ).toEqual([17, 18, 21, 22])
  })

  it('opens an IMAGE extension after an empty primary and retains typed/repeated header cards', async () => {
    const bytes = documentBytes(
      { primary: true, bitpix: 8, dimensions: [] },
      {
        primary: false,
        bitpix: 16,
        dimensions: [2, 2],
        values: [1, 2, 3, 4],
        extraCards: [
          card('OBJECT', "M87's core", 'slash / remains in comment'),
          card('COMMENT', undefined, ' first note'),
          card('COMMENT', undefined, ' second note'),
          card('HISTORY', undefined, ' calibrated'),
          card('CUSTOM', 42),
        ],
      },
    )
    const document = await openFits(bytes)
    expect(document.hdus).toHaveLength(2)
    expect(document.hdus[0]?.canOpenRaster).toBe(false)
    expect(document.hdus[1]).toMatchObject({
      primary: false,
      extensionType: 'IMAGE',
      dimensions: [2, 2],
      canOpenRaster: true,
    })
    expect(document.hdus[1]?.cards.filter(({ keyword }) => keyword === 'COMMENT')).toHaveLength(2)
    expect(document.hdus[1]?.cards.find(({ keyword }) => keyword === 'OBJECT')).toMatchObject({
      value: "M87's core",
      comment: 'slash / remains in comment',
    })
    expect(await readValues(await document.openImage(1))).toEqual([1, 2, 3, 4])
  })

  it('applies BSCALE/BZERO, preserves unsigned conventions, and maps integer BLANK to NaN', async () => {
    const scaled = await openFits(
      documentBytes({
        primary: true,
        bitpix: 16,
        dimensions: [3],
        values: [-2, 0, 2],
        extraCards: [card('BSCALE', 0.5), card('BZERO', 10)],
      }),
    )
    const scaledDataset = await scaled.openImage(0)
    expect(scaledDataset.sampleType).toBe('float64')
    expect(await readValues(scaledDataset)).toEqual([9, 10, 11])

    const unsigned = await openFits(
      documentBytes({
        primary: true,
        bitpix: 16,
        dimensions: [3],
        values: [-32_768, 0, 32_767],
        extraCards: [card('BZERO', 32_768)],
      }),
    )
    const unsignedDataset = await unsigned.openImage(0)
    expect(unsignedDataset.sampleType).toBe('uint16')
    expect(await readValues(unsignedDataset)).toEqual([0, 32_768, 65_535])

    const blank = await openFits(
      documentBytes({
        primary: true,
        bitpix: 32,
        dimensions: [3],
        values: [1, -999, 3],
        extraCards: [card('BLANK', -999), card('BSCALE', 2), card('BZERO', 1)],
      }),
    )
    const blankValues = await readValues(await blank.openImage(0))
    expect(blankValues[0]).toBe(3)
    expect(blankValues[1]).toBeNaN()
    expect(blankValues[2]).toBe(7)
  })

  it('preserves floating-point NaN and infinities', async () => {
    const document = await openFits(
      documentBytes({
        primary: true,
        bitpix: -64,
        dimensions: [3],
        values: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      }),
    )
    const values = await readValues(await document.openImage(0))
    expect(values[0]).toBeNaN()
    expect(values[1]).toBe(Number.POSITIVE_INFINITY)
    expect(values[2]).toBe(Number.NEGATIVE_INFINITY)
  })

  it('reads only selected cube regions after aligned header parsing', async () => {
    const values = Array.from({ length: 512 * 256 * 3 }, (_, index) => index % 32_000)
    const bytes = documentBytes({ primary: true, bitpix: 16, dimensions: [512, 256, 3], values })
    const source = new RecordingSource(bytes)
    const document = await openFits(source, { maxInputBytes: bytes.byteLength, rowsPerBlock: 1 })
    const dataset = await document.openImage(0)
    const before = document.sourceBytesRead
    expect(await readValues(dataset, { z: 2, x: 20, y: 30, width: 5, height: 2 })).toHaveLength(10)
    expect(dataset.sourceBytesRead - before).toBe(20)
    expect(source.reads.every(({ length }) => length < bytes.byteLength)).toBe(true)
  })

  it('enumerates image HDUs and preserves arbitrary FITS rank in V2', async () => {
    const values = Array.from({ length: 2 * 2 * 2 * 2 }, (_, index) => index)
    const bytes = documentBytes({
      primary: true,
      bitpix: 16,
      dimensions: [2, 2, 2, 2],
      values,
      extraCards: [
        card('CTYPE3', 'FREQ'),
        card('CUNIT3', 'Hz'),
        card('CRVAL3', 100),
        card('CRPIX3', 1),
        card('CDELT3', 5),
        card('CTYPE4', 'TIME'),
      ],
    })
    const document = await new ScientificReaderRegistry([fitsReader]).open({
      primary: { id: 'ranked', source: new MemorySource(bytes) },
    })
    expect(document.datasets.map(({ id }) => id)).toEqual(['hdu-0'])
    const dataset = await document.openDataset('hdu-0')
    expect(dataset.descriptor.axes).toMatchObject([
      { id: 'x', length: 2 },
      { id: 'y', length: 2 },
      {
        id: 'axis-3',
        name: 'FREQ',
        kind: 'spectral',
        unit: 'Hz',
        length: 2,
        coordinates: { type: 'linear', origin: 100, step: 5 },
      },
      { id: 'axis-4', name: 'TIME', kind: 'time', length: 2 },
    ])
    const blocks = []
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [
        { axisId: 'axis-3', index: 1 },
        { axisId: 'axis-4', index: 1 },
      ],
    })) {
      blocks.push(block)
    }
    const block = blocks[0]
    if (block === undefined) throw new Error('FITS V2 block is missing')
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    expect([0, 2, 4, 6].map((offset) => view.getInt16(offset, false))).toEqual([12, 13, 14, 15])

    const direct = await openFits(bytes)
    await expect(direct.openImage(0)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })

  it('rejects malformed headers, unsafe arrays, unsupported HDUs, and truncated data', async () => {
    const valid = hduBytes({ primary: true, bitpix: 8, dimensions: [2, 2], values: [1, 2, 3, 4] })
    const noEnd = valid.slice()
    noEnd.fill(0x20, 5 * 80, 6 * 80)
    await expect(openFits(noEnd)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const reordered = valid.slice()
    reordered.set(valid.subarray(80, 160), 0)
    reordered.set(valid.subarray(0, 80), 80)
    await expect(openFits(reordered)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const invalidBitpix = valid.slice()
    invalidBitpix.set(new TextEncoder().encode(card('BITPIX', 24)), 80)
    await expect(openFits(invalidBitpix)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const huge = hduBytes({
      primary: true,
      bitpix: -64,
      dimensions: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    })
    await expect(openFits(huge)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    await expect(openFits(valid.subarray(0, 2_881))).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })

    const int64 = await openFits(
      documentBytes({ primary: true, bitpix: 64, dimensions: [1], values: [1] }),
    )
    await expect(int64.openImage(0)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })

    const table = await openFits(
      documentBytes(
        { primary: true, bitpix: 8, dimensions: [] },
        {
          primary: false,
          extensionType: 'BINTABLE',
          bitpix: 8,
          dimensions: [4, 1],
          values: [0, 0, 0, 0],
        },
      ),
    )
    await expect(table.openImage(1)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })

    const four = await openFits(
      documentBytes({ primary: true, bitpix: 8, dimensions: [1, 1, 1, 1], values: [1] }),
    )
    await expect(four.openImage(0)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })
})
