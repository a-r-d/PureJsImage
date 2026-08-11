import { describe, expect, it } from 'vitest'
import { rasterSampleBytes } from '../src/raster.ts'
import { openCbf } from '../src/scientific/formats/cbf.ts'
import { readRasterSample } from '../src/scientific/samples.ts'

interface CbfFixtureOptions {
  readonly width?: number
  readonly height?: number
  readonly values?: readonly number[]
  readonly elementType?: string
  readonly compression?: string
  readonly byteOrder?: string
  readonly declaredElements?: number
  readonly padding?: number
  readonly commentMetadata?: boolean
}

const encodeByteOffset = (values: readonly number[]): Uint8Array => {
  const output: number[] = []
  let base = 0n
  for (const value of values) {
    const current = BigInt(value)
    const delta = current - base
    base = current
    if (delta >= -127n && delta <= 127n) {
      output.push(Number(delta & 0xffn))
      continue
    }
    output.push(0x80)
    if (delta >= -32_767n && delta <= 32_767n) {
      const short = Number(delta & 0xffffn)
      output.push(short & 0xff, (short >>> 8) & 0xff)
      continue
    }
    output.push(0, 0x80)
    if (delta >= -2_147_483_647n && delta <= 2_147_483_647n) {
      const integer = Number(delta & 0xffff_ffffn)
      output.push(integer & 0xff, (integer >>> 8) & 0xff, (integer >>> 16) & 0xff, integer >>> 24)
      continue
    }
    output.push(0, 0, 0, 0x80)
    const long = BigInt.asUintN(64, delta)
    for (let byte = 0n; byte < 8n; byte += 1n) {
      output.push(Number((long >> (byte * 8n)) & 0xffn))
    }
  }
  return Uint8Array.from(output)
}

const fixture = (options: CbfFixtureOptions = {}): Uint8Array => {
  const width = options.width ?? 4
  const height = options.height ?? 2
  const values = options.values ?? [1, 2, 3, 4, 5, 6, 7, 8]
  const binary = encodeByteOffset(values)
  const padding = options.padding ?? 0
  const metadata = options.commentMetadata
    ? `# Detector: PILATUS 300K, S/N test
# Exposure_time 1.25 s
# Wavelength 0.9763 A`
    : `_diffrn_detector.detector 'PILATUS 6M'
_diffrn_scan_frame.integration_time 0.25
_diffrn_radiation_wavelength.wavelength 0.9795`
  const header = new TextEncoder().encode(`###CBF: VERSION 1.5
data_test
${metadata}
_array_data.data
;
--CIF-BINARY-FORMAT-SECTION--
Content-Type: application/octet-stream;
 conversions="${options.compression ?? 'x-CBF_BYTE_OFFSET'}"
Content-Transfer-Encoding: BINARY
X-Binary-Size: ${binary.byteLength}
X-Binary-ID: 1
X-Binary-Element-Type: "${options.elementType ?? 'signed 32-bit integer'}"
X-Binary-Element-Byte-Order: ${options.byteOrder ?? 'LITTLE_ENDIAN'}
X-Binary-Number-of-Elements: ${options.declaredElements ?? width * height}
X-Binary-Size-Fastest-Dimension: ${width}
X-Binary-Size-Second-Dimension: ${height}
X-Binary-Size-Padding: ${padding}

`)
  const marker = Uint8Array.of(0x0c, 0x1a, 0x04, 0xd5)
  const footer = new TextEncoder().encode('\n--CIF-BINARY-FORMAT-SECTION----\n;\n')
  const output = new Uint8Array(
    header.byteLength + marker.byteLength + binary.byteLength + padding + footer.byteLength,
  )
  output.set(header)
  output.set(marker, header.byteLength)
  output.set(binary, header.byteLength + marker.byteLength)
  output.set(footer, header.byteLength + marker.byteLength + binary.byteLength + padding)
  return output
}

const findSequence = (data: Uint8Array, sequence: Uint8Array): number => {
  for (let offset = 0; offset <= data.byteLength - sequence.byteLength; offset += 1) {
    if (sequence.every((value, index) => data[offset + index] === value)) return offset
  }
  return -1
}

const collect = async (
  dataset: Awaited<ReturnType<typeof openCbf>>,
  request: {
    readonly x?: number
    readonly y?: number
    readonly width?: number
    readonly height?: number
  } = {},
): Promise<number[]> => {
  const values: number[] = []
  for await (const block of dataset.readPlane({ z: 0, c: 0, t: 0, ...request })) {
    const bytes = rasterSampleBytes(block.format.sampleType)
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let y = 0; y < block.height; y += 1) {
      for (let x = 0; x < block.width; x += 1) {
        values.push(
          readRasterSample(block.data, view, y * block.stride + x * bytes, block.format.sampleType),
        )
      }
    }
  }
  return values
}

describe('CBF X-ray detector images', () => {
  it('decodes byte-offset deltas and preserves signed detector counts', async () => {
    const values = [10, 11, -5, 200, -40_000, 1_000_000, -2_000_000_000, 2_000_000_000]
    const dataset = await openCbf(fixture({ values }))
    expect(dataset.encoding).toBe('x-CBF_BYTE_OFFSET')
    expect(dataset.sampleType).toBe('int32')
    expect(await collect(dataset)).toEqual(values)
    expect(dataset.detector).toEqual({
      detectorName: 'PILATUS 6M',
      exposureTimeSeconds: 0.25,
      wavelengthAngstroms: 0.9795,
    })
  })

  it('supports unsigned integer declarations, padding, and long zero-delta runs', async () => {
    const values = Array.from({ length: 128 }, () => 60_000)
    const dataset = await openCbf(
      fixture({
        width: 16,
        height: 8,
        values,
        elementType: 'unsigned 16-bit integer',
        padding: 31,
      }),
      { rowsPerBlock: 3 },
    )
    expect(dataset.sampleType).toBe('uint16')
    expect(await collect(dataset)).toEqual(values)
  })

  it('extracts common miniCBF acquisition comments when CIF fields are absent', async () => {
    const dataset = await openCbf(fixture({ commentMetadata: true }))
    expect(dataset.detector).toEqual({
      detectorName: 'PILATUS 300K, S/N test',
      exposureTimeSeconds: 1.25,
      wavelengthAngstroms: 0.9763,
    })
  })

  it('returns selected ROIs while decoding sequentially with bounded buffers', async () => {
    const values = Array.from({ length: 100 }, (_, index) => index * 2)
    const dataset = await openCbf(fixture({ width: 10, height: 10, values }), {
      rowsPerBlock: 1,
    })
    const before = dataset.sourceBytesRead
    expect(await collect(dataset, { x: 2, y: 3, width: 3, height: 2 })).toEqual([
      64, 66, 68, 84, 86, 88,
    ])
    expect(dataset.sourceBytesRead - before).toBeLessThanOrEqual(dataset.binarySectionBytes)
  })

  it('rejects unsupported compression, byte order, element types, and dimensions', async () => {
    await expect(openCbf(fixture({ compression: 'x-CBF_PACKED' }))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    await expect(openCbf(fixture({ byteOrder: 'BIG_ENDIAN' }))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    await expect(openCbf(fixture({ elementType: 'signed 64-bit integer' }))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    await expect(openCbf(fixture({ declaredElements: 7 }))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects truncated escapes, output count mismatches, bad footers, and bounded-scan attacks', async () => {
    const valid = fixture({ width: 1, height: 1, values: [1_000] })
    const marker = valid.findIndex(
      (value, index) =>
        value === 0x0c &&
        valid[index + 1] === 0x1a &&
        valid[index + 2] === 0x04 &&
        valid[index + 3] === 0xd5,
    )
    const truncatedEscape = valid.slice()
    const binarySizeText = new TextEncoder().encode('X-Binary-Size: 1')
    const sizeOffset = new TextDecoder().decode(truncatedEscape).indexOf('X-Binary-Size: 3')
    truncatedEscape.set(binarySizeText, sizeOffset)
    const footer = new TextEncoder().encode('\n--CIF-BINARY-FORMAT-SECTION----\n;\n')
    truncatedEscape.set(footer, marker + 5)
    await expect(
      openCbf(truncatedEscape).then((dataset) => collect(dataset)),
    ).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })

    const extraValue = fixture({ width: 1, height: 1, values: [1, 2], declaredElements: 1 })
    await expect(openCbf(extraValue).then((dataset) => collect(dataset))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    const badFooter = fixture().slice()
    const closing = new TextEncoder().encode('--CIF-BINARY-FORMAT-SECTION----')
    const closingOffset = findSequence(badFooter, closing)
    badFooter[closingOffset] = 0
    await expect(openCbf(badFooter)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const noMarker = new TextEncoder().encode(`###CBF: VERSION 1.5\n${'x'.repeat(256)}`)
    await expect(openCbf(noMarker, { maxHeaderBytes: 64 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })
})
