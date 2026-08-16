/**
 * Benchmark profile definitions that are derived from published capability
 * data.  The ordinary competitor profile intentionally remains in
 * `workflows.ts`; this profile is a PureJsImage baseline and must not be
 * interpreted as a cross-library comparison.
 */

export type StableCodecReadStatus = 'supported' | 'limited'
export type StableCodecWriteStatus = StableCodecReadStatus | 'unsupported'
export type StableCodecLossiness = 'lossless' | 'lossy' | 'independent-oracle' | 'not-applicable'
export type StableFixtureSize = 'small' | 'medium' | 'large'

export interface StableCodecCapability {
  readonly id: string
  readonly packageFormat: string
  readonly read: StableCodecReadStatus
  readonly write: StableCodecWriteStatus
  readonly lossiness: StableCodecLossiness
}

export interface StableCodecFixture {
  readonly id: string
  readonly path: string
  readonly format: string
  readonly width: number
  readonly height: number
  readonly size: StableFixtureSize
  readonly frame?: number
}

export interface StableCodecPlan {
  readonly id: string
  readonly format: string
  readonly read: StableCodecReadStatus
  readonly write: StableCodecWriteStatus
  readonly lossiness: StableCodecLossiness
  readonly fixtures: readonly StableCodecFixture[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const status = (value: unknown, allowed: readonly string[]): string => {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`Invalid capability status: ${String(value)}`)
  }
  return value
}

const lossinessFor = (value: Record<string, unknown>): StableCodecLossiness => {
  const lossy = value.lossyPixelValidation
  if (!isRecord(lossy)) return 'not-applicable'
  return lossy.status === 'independent-oracle' ? 'independent-oracle' : 'not-applicable'
}

export const readStableCodecCapabilities = (value: unknown): readonly StableCodecCapability[] => {
  if (!isRecord(value) || !Array.isArray(value.codecs)) {
    throw new Error('Capability manifest does not contain a codecs array')
  }
  const capabilities: StableCodecCapability[] = []
  for (const candidate of value.codecs) {
    if (!isRecord(candidate)) throw new Error('Capability codec entry is not an object')
    const id = candidate.id
    const packageFormat = candidate.packageFormat
    const read = isRecord(candidate.read) ? candidate.read.status : undefined
    const write = isRecord(candidate.write) ? candidate.write.status : undefined
    if (
      typeof id !== 'string' ||
      typeof packageFormat !== 'string' ||
      !['supported', 'limited'].includes(String(read)) ||
      !['supported', 'limited', 'unsupported'].includes(String(write))
    ) {
      continue
    }
    if (id === 'heif' || read === 'planned') continue
    capabilities.push({
      id,
      packageFormat,
      read: status(read, ['supported', 'limited']) as StableCodecReadStatus,
      write: status(write, ['supported', 'limited', 'unsupported']) as StableCodecWriteStatus,
      lossiness: lossinessFor(candidate),
    })
  }
  return capabilities
}

const fixture = (
  id: string,
  path: string,
  format: string,
  width: number,
  height: number,
  size: StableFixtureSize,
  frame?: number,
): StableCodecFixture => ({
  id,
  path,
  format,
  width,
  height,
  size,
  ...(frame === undefined ? {} : { frame }),
})

const fixturesByCodec: Readonly<Record<string, readonly StableCodecFixture[]>> = {
  jpeg: [
    fixture(
      'tundra-4000x3000',
      'benchmark/corpus/files/tundra-4000x3000.jpg',
      'jpeg',
      4000,
      3000,
      'medium',
    ),
    fixture(
      'old-faithful-6000x4000',
      'benchmark/corpus/files/old-faithful-6000x4000.jpg',
      'jpeg',
      6000,
      4000,
      'large',
    ),
  ],
  png: [
    fixture(
      'rgba-gradient-4000x3000',
      'benchmark/corpus/files/rgba-gradient-4000x3000.png',
      'png',
      4000,
      3000,
      'medium',
    ),
    fixture(
      'stress-gradient-10000x10000',
      'benchmark/corpus/files/stress-gradient-10000x10000.png',
      'png',
      10000,
      10000,
      'large',
    ),
  ],
  webp: [
    fixture(
      'webp-gradient-lossy-4000x3000',
      'benchmark/corpus/files/webp-gradient-lossy-4000x3000.webp',
      'webp',
      4000,
      3000,
      'medium',
    ),
    fixture(
      'webp-gradient-lossless-4000x3000',
      'benchmark/corpus/files/webp-gradient-lossless-4000x3000.webp',
      'webp',
      4000,
      3000,
      'large',
    ),
  ],
  bmp: [
    fixture(
      'bmp-gradient-4000x3000',
      'benchmark/corpus/files/bmp-gradient-4000x3000.bmp',
      'bmp',
      4000,
      3000,
      'large',
    ),
    fixture(
      'bmpsuite-rgba32-v5',
      'benchmark/corpus/files/bmpsuite-rgba32-v5.bmp',
      'bmp',
      127,
      64,
      'medium',
    ),
  ],
  gif: [
    fixture(
      'animated-gif-cc0',
      'benchmark/corpus/files/animated-gif-cc0.gif',
      'gif',
      200,
      200,
      'medium',
      0,
    ),
  ],
  tiff: [
    fixture(
      'tiff-gradient-4000x3000',
      'benchmark/corpus/files/tiff-gradient-4000x3000.tiff',
      'tiff',
      4000,
      3000,
      'large',
    ),
    fixture(
      'tiff-bigtiff-rgb16-1024x768',
      'benchmark/corpus/files/tiff-bigtiff-rgb16-1024x768.tiff',
      'tiff',
      1024,
      768,
      'medium',
    ),
    fixture(
      'libtiff-lzw-single-strip',
      'benchmark/corpus/files/libtiff-lzw-single-strip.tiff',
      'tiff',
      7795,
      3122,
      'large',
    ),
  ],
  ico: [
    fixture(
      'ico-mixed-16-32-256',
      'benchmark/corpus/files/ico-mixed-16-32-256.ico',
      'ico',
      256,
      256,
      'medium',
    ),
  ],
  jpeg2000: [
    fixture(
      'wikimedia-blue-marble-openjpeg-lossless',
      'benchmark/corpus/files/jp2/wikimedia-blue-marble-openjpeg-lossless.jp2',
      'jp2',
      1920,
      2172,
      'large',
    ),
    fixture(
      'openjpeg-lossless-rgb16',
      'benchmark/corpus/files/jp2/openjpeg-lossless-rgb16.jp2',
      'jp2',
      17,
      13,
      'small',
    ),
  ],
  avif: [
    fixture(
      'fox-profile0-8bpc-yuv420',
      'benchmark/corpus/files/avif/fox.profile0.8bpc.yuv420.avif',
      'avif',
      1204,
      800,
      'medium',
    ),
    fixture(
      'libavif-bounded-filtered-yuv420-3840x2160',
      'benchmark/corpus/files/avif/libavif-bounded-filtered-yuv420-3840x2160.avif',
      'avif',
      3840,
      2160,
      'large',
    ),
  ],
  jpegxl: [
    fixture(
      'multi-group-gray8',
      'tests/fixtures/jpegxl/multi-group-gray8.jxl',
      'jpegxl',
      600,
      530,
      'medium',
    ),
    fixture(
      'permuted-large-gray8',
      'tests/fixtures/jpegxl/permuted-large-gray8.jxl',
      'jpegxl',
      4096,
      4096,
      'large',
    ),
  ],
  hdr: [
    fixture(
      'small-hdr-potsdamer',
      'benchmark/corpus/files/small-codec-potsdamer.hdr',
      'hdr',
      1024,
      512,
      'medium',
    ),
  ],
  qoi: [
    fixture(
      'small-qoi-city',
      'benchmark/corpus/files/small-codec-city.qoi',
      'qoi',
      576,
      576,
      'medium',
    ),
  ],
  netpbm: [
    fixture(
      'small-ppm-city',
      'benchmark/corpus/files/small-codec-city.ppm',
      'netpbm',
      576,
      576,
      'medium',
    ),
    fixture(
      'small-pfm-potsdamer',
      'benchmark/corpus/files/small-codec-potsdamer.pfm',
      'netpbm',
      1024,
      512,
      'medium',
    ),
    fixture(
      'rgb-alpha-4x4-pam',
      'tests/fixtures/small-codecs/rgb-alpha-4x4.pam',
      'netpbm',
      4,
      4,
      'small',
    ),
  ],
  tga: [
    fixture(
      'small-tga-city',
      'benchmark/corpus/files/small-codec-city.tga',
      'tga',
      576,
      576,
      'medium',
    ),
  ],
}

export const stableCodecProfile = (
  capabilities: readonly StableCodecCapability[],
): readonly StableCodecPlan[] =>
  capabilities.map((capability) => ({
    id: capability.id,
    format: capability.packageFormat,
    read: capability.read,
    write: capability.write,
    lossiness: capability.lossiness,
    fixtures: fixturesByCodec[capability.id] ?? [],
  }))
