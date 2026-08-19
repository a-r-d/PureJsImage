export type TiffCompressionTestStatus =
  | 'fully-tested'
  | 'implemented-but-weakly-tested'
  | 'recognized-but-unsupported'
  | 'not-implemented'

export type TiffCompressionDecodeSupport =
  | 'display-and-raster'
  | 'display-only'
  | 'display-with-explicit-codec'
  | 'unsupported'

export interface TiffCompressionCapability {
  readonly id: number
  readonly name: string
  readonly status: TiffCompressionTestStatus
  readonly decodeSupport: TiffCompressionDecodeSupport
  readonly notes: string
}

/**
 * Audited TIFF compression assignments. Implemented entries correspond to an explicit decoder
 * branch; unsupported entries are retained so diagnostics and compatibility reports can name the
 * assigned compression instead of treating it as an anonymous number.
 */
export const tiffCompressionCapabilities: readonly TiffCompressionCapability[] = Object.freeze([
  {
    id: 1,
    name: 'Uncompressed',
    status: 'fully-tested',
    decodeSupport: 'display-and-raster',
    notes: 'Strips and tiles.',
  },
  {
    id: 2,
    name: 'CCITT Modified Huffman',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-only',
    notes: 'Bilevel display decoding.',
  },
  {
    id: 3,
    name: 'CCITT Group 3',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-only',
    notes: 'Bilevel display decoding with supported T4 options.',
  },
  {
    id: 4,
    name: 'CCITT Group 4',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-only',
    notes: 'Bilevel display decoding with supported T6 options.',
  },
  {
    id: 5,
    name: 'LZW',
    status: 'fully-tested',
    decodeSupport: 'display-and-raster',
    notes: 'Standard and legacy code packing.',
  },
  {
    id: 6,
    name: 'Old-style JPEG',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-only',
    notes: 'Complete streams and supported table reconstruction.',
  },
  {
    id: 7,
    name: 'JPEG',
    status: 'fully-tested',
    decodeSupport: 'display-and-raster',
    notes:
      'Complete or JPEGTables-composed streams. Native raster keeps 3-band YCbCr as converted RGB and 4-band photometric RGB ExtraSamples=0 as preserved components.',
  },
  {
    id: 8,
    name: 'Deflate',
    status: 'fully-tested',
    decodeSupport: 'display-and-raster',
    notes: 'TIFF Deflate assignment.',
  },
  {
    id: 32773,
    name: 'PackBits',
    status: 'fully-tested',
    decodeSupport: 'display-and-raster',
    notes: 'Bounded PackBits strips and tiles.',
  },
  {
    id: 32809,
    name: 'ThunderScan',
    status: 'recognized-but-unsupported',
    decodeSupport: 'unsupported',
    notes: 'No decoder; rejected explicitly.',
  },
  {
    id: 32946,
    name: 'Adobe Deflate',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-and-raster',
    notes: 'Decoded by the bounded Deflate path.',
  },
  {
    id: 33003,
    name: 'Aperio JPEG 2000 YCbCr',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-only',
    notes: 'Aperio codestream tiles.',
  },
  {
    id: 33005,
    name: 'Aperio JPEG 2000 MCT',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-only',
    notes: 'Aperio codestream tiles.',
  },
  {
    id: 34676,
    name: 'SGILog',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-only',
    notes: 'LogL and LogLuv layouts only.',
  },
  {
    id: 34677,
    name: 'SGILog24',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-only',
    notes: 'LogLuv layouts only.',
  },
  {
    id: 34712,
    name: 'JPEG 2000',
    status: 'not-implemented',
    decodeSupport: 'unsupported',
    notes:
      'The general TIFF assignment is not implemented; only the tested Aperio assignments are.',
  },
  {
    id: 34887,
    name: 'LERC',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-and-raster',
    notes: 'LERC2 and LERC plus Deflate; LERC plus Zstandard is unsupported.',
  },
  {
    id: 50000,
    name: 'Zstandard',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-and-raster',
    notes: 'First-party bounded Zstandard decoder.',
  },
  {
    id: 50001,
    name: 'WebP',
    status: 'implemented-but-weakly-tested',
    decodeSupport: 'display-with-explicit-codec',
    notes: 'Requires explicit TIFF/WebP codec composition.',
  },
  {
    id: 50002,
    name: 'JPEG XL',
    status: 'not-implemented',
    decodeSupport: 'unsupported',
    notes: 'No TIFF JPEG XL segment integration.',
  },
])

const capabilityById: ReadonlyMap<number, TiffCompressionCapability> = new Map(
  tiffCompressionCapabilities.map((capability) => [capability.id, capability]),
)

export const tiffCompressionCapability = (id: number): TiffCompressionCapability | undefined =>
  capabilityById.get(id)

export const tiffCompressionName = (id: number): string =>
  capabilityById.get(id)?.name ?? 'Unknown TIFF compression'
