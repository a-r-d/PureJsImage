import { type BundleSizeBudget, bundleSizeBudgets } from './bundle-size-budgets.ts'
import type { CapabilityManifest, CodecCapability } from './capability-manifest.ts'

export type BundleCodec = string

export type BundleImplementation =
  | 'native-wrapper'
  | 'package-core'
  | 'pure-javascript'
  | 'webassembly'

export type BundleTargetCategory = 'competitor' | 'purejsimage-entry'

export interface BundleTarget {
  /** Recorded minified byte count when this gate was introduced. */
  readonly baselineMinifiedBytes?: number
  readonly category: BundleTargetCategory
  readonly codecs?: readonly BundleCodec[]
  readonly contents: string
  readonly id: string
  readonly implementation: BundleImplementation
  readonly maxMinifiedBytes?: number
  readonly name: string
  readonly packageExport?: string
  readonly packageExports?: readonly string[]
  readonly packageName: string
  readonly packageNames?: readonly string[]
  readonly sourceEntries?: readonly string[]
  /** Selects one side of an ESM split build for a lazily loaded public entry. */
  readonly splitOutput?: 'entry' | 'chunks'
}

export interface CompetitorBundleTarget extends BundleTarget {
  readonly category: 'competitor'
  readonly codecs: readonly BundleCodec[]
  readonly implementation: Exclude<BundleImplementation, 'package-core'>
  readonly packageName: '@jsquash/jpeg' | 'image-js' | 'jimp' | 'purejsimage' | 'sharp'
  readonly packageNames?: readonly string[]
}

export interface WasmAssetTarget {
  readonly id: string
  readonly name: string
  readonly sourceEntry: string
}

export const commonCompetitorCodecs = ['JPEG', 'PNG'] as const satisfies readonly BundleCodec[]

export const wasmAssetTargets: readonly WasmAssetTarget[] = [
  {
    id: 'jpeg-decoder',
    name: 'JPEG decoder WASM',
    sourceEntry: 'src/accelerator-entries/jpeg-decoder.wasm',
  },
  {
    id: 'jpeg-decoder-simd',
    name: 'JPEG decoder SIMD WASM',
    sourceEntry: 'src/accelerator-entries/jpeg-decoder-simd.wasm',
  },
  {
    id: 'jpeg-encoder',
    name: 'JPEG encoder WASM',
    sourceEntry: 'src/accelerator-entries/jpeg-encoder.wasm',
  },
  {
    id: 'jpeg-encoder-simd',
    name: 'JPEG encoder SIMD WASM',
    sourceEntry: 'src/accelerator-entries/jpeg-encoder-simd.wasm',
  },
  {
    id: 'png-codec',
    name: 'PNG codec WASM',
    sourceEntry: 'src/accelerator-entries/png-codec.wasm',
  },
  {
    id: 'png-codec-simd',
    name: 'PNG codec SIMD WASM',
    sourceEntry: 'src/accelerator-entries/png-codec-simd.wasm',
  },
  {
    id: 'webp-codec',
    name: 'WebP codec WASM',
    sourceEntry: 'src/accelerator-entries/webp-codec.wasm',
  },
  {
    id: 'webp-codec-simd',
    name: 'WebP codec SIMD WASM',
    sourceEntry: 'src/accelerator-entries/webp-codec-simd.wasm',
  },
]

const exportsFrom = (entries: readonly string[]): string =>
  entries.map((entry) => `export * from '${entry}'`).join('\n')

const budgeted = (
  target: Omit<BundleTarget, 'baselineMinifiedBytes' | 'maxMinifiedBytes'>,
): BundleTarget => {
  const budget: BundleSizeBudget | undefined = bundleSizeBudgets[target.id]
  return {
    ...target,
    ...(budget?.baselineMinifiedBytes === undefined
      ? {}
      : { baselineMinifiedBytes: budget.baselineMinifiedBytes }),
    ...(budget?.maxMinifiedBytes === undefined
      ? {}
      : { maxMinifiedBytes: budget.maxMinifiedBytes }),
  }
}

const sourceTarget = ({
  category = 'purejsimage-entry',
  codecs,
  id,
  implementation,
  name,
  packageExport,
  packageName = 'purejsimage',
  sourceEntries,
  splitOutput,
}: {
  readonly category?: BundleTargetCategory
  readonly codecs?: readonly BundleCodec[]
  readonly id: string
  readonly implementation: BundleImplementation
  readonly name: string
  readonly packageExport?: string
  readonly packageName?: string
  readonly sourceEntries: readonly string[]
  readonly splitOutput?: BundleTarget['splitOutput']
}): BundleTarget =>
  budgeted({
    category,
    ...(codecs === undefined ? {} : { codecs }),
    contents: exportsFrom(sourceEntries),
    id,
    implementation,
    name,
    ...(packageExport === undefined ? {} : { packageExport }),
    packageName,
    sourceEntries,
    ...(splitOutput === undefined ? {} : { splitOutput }),
  })

const packageTarget = ({
  codecs,
  contents,
  id,
  implementation,
  name,
  packageExport,
  packageExports,
  packageName,
  packageNames,
}: {
  readonly codecs: readonly BundleCodec[]
  readonly contents: string
  readonly id: string
  readonly implementation: Exclude<BundleImplementation, 'package-core'>
  readonly name: string
  readonly packageExport?: string
  readonly packageExports?: readonly string[]
  readonly packageName: CompetitorBundleTarget['packageName']
  readonly packageNames?: readonly string[]
}): CompetitorBundleTarget => ({
  category: 'competitor',
  codecs,
  contents,
  id,
  implementation,
  name,
  ...(packageExport === undefined ? {} : { packageExport }),
  ...(packageNames === undefined ? {} : { packageNames }),
  packageName,
  packageExports:
    packageExports ??
    (packageExport === undefined ? (packageNames ?? [packageName]) : [packageExport]),
})

const scientificReaderSlug = (packageExport: string): string => {
  const slash = packageExport.lastIndexOf('/')
  if (slash < 0 || slash === packageExport.length - 1) {
    throw new Error(`Scientific reader package export has no reader name: ${packageExport}`)
  }
  return packageExport.slice(slash + 1)
}

export const scientificReaderTargetId = (packageExport: string): string =>
  `scientific-reader-${scientificReaderSlug(packageExport)}`

export const scientificReaderSourceEntry = (packageExport: string): string =>
  `./src/scientific/readers/${scientificReaderSlug(packageExport)}.ts`

const codecSourceEntry = (codec: CodecCapability): string =>
  codec.id === 'heif'
    ? './src/codec-entries/experimental/heic.ts'
    : `./src/codec-entries/${codec.id}.ts`

export const codecPackageExport = (codec: CodecCapability): string =>
  codec.id === 'heif' ? 'purejsimage/codecs/experimental/heic' : `purejsimage/codecs/${codec.id}`

export const codecTargetId = (codec: CodecCapability): string => `codec-${codec.id}`

const publicCodecTargets = (manifest: CapabilityManifest): readonly BundleTarget[] =>
  manifest.codecs
    .filter((codec) => codec.packageFormat !== undefined)
    .map((codec) =>
      sourceTarget({
        id: codecTargetId(codec),
        implementation: 'pure-javascript',
        name: `Core + ${codec.name}`,
        packageExport: codecPackageExport(codec),
        sourceEntries: ['./src/index.ts', codecSourceEntry(codec)],
      }),
    )

const publicCodecNames = (manifest: CapabilityManifest): readonly BundleCodec[] =>
  manifest.codecs
    .filter((codec) => codec.packageFormat !== undefined && !codec.experimental)
    .map((codec) => codec.name)

const staticPureJsImageTargets = (): readonly BundleTarget[] => [
  sourceTarget({
    id: 'core',
    implementation: 'package-core',
    name: 'Core API initial chunk',
    packageExport: 'purejsimage',
    sourceEntries: ['./src/index.ts'],
    splitOutput: 'entry',
  }),
  sourceTarget({
    id: 'core-execution',
    implementation: 'package-core',
    name: 'Core execution chunk',
    packageExport: 'purejsimage',
    sourceEntries: ['./src/index.ts'],
    splitOutput: 'chunks',
  }),
  sourceTarget({
    id: 'hdr',
    implementation: 'pure-javascript',
    name: 'HDR Surgery',
    packageExport: 'purejsimage/hdr',
    sourceEntries: ['./src/hdr/index.ts'],
  }),
  sourceTarget({
    id: 'scientific',
    implementation: 'package-core',
    name: 'Core + scientific platform',
    packageExport: 'purejsimage/scientific',
    sourceEntries: ['./src/index.ts', './src/scientific/index.ts'],
  }),
  sourceTarget({
    id: 'geo',
    implementation: 'package-core',
    name: 'Geo raster platform',
    packageExport: 'purejsimage/geo',
    sourceEntries: ['./src/geo/index.ts'],
  }),
  sourceTarget({
    id: 'geo-readers-all',
    implementation: 'package-core',
    name: 'Geo readers: all',
    packageExport: 'purejsimage/geo/readers/all',
    sourceEntries: ['./src/geo/readers/all.ts'],
  }),
  sourceTarget({
    id: 'operations',
    implementation: 'package-core',
    name: 'Operation descriptors and runtime',
    packageExport: 'purejsimage/operations',
    sourceEntries: ['./src/operations/index.ts'],
  }),
  sourceTarget({
    id: 'analysis',
    implementation: 'package-core',
    name: 'Analysis application API',
    packageExport: 'purejsimage/analysis',
    sourceEntries: ['./src/analysis/index.ts'],
  }),
  sourceTarget({
    id: 'analysis-results',
    implementation: 'package-core',
    name: 'Analysis result schemas',
    packageExport: 'purejsimage/analysis/results',
    sourceEntries: ['./src/analysis/results.ts'],
  }),
  sourceTarget({
    id: 'analysis-roi',
    implementation: 'package-core',
    name: 'Analysis ROI utilities',
    packageExport: 'purejsimage/analysis/roi',
    sourceEntries: ['./src/analysis/roi-entry.ts'],
  }),
  sourceTarget({
    id: 'analysis-runtime',
    implementation: 'package-core',
    name: 'Analysis tile runtime',
    packageExport: 'purejsimage/analysis/runtime',
    sourceEntries: ['./src/analysis/runtime.ts'],
  }),
  sourceTarget({
    id: 'analysis-project',
    implementation: 'package-core',
    name: 'Analysis project and migrations',
    packageExport: 'purejsimage/analysis/project',
    sourceEntries: ['./src/analysis/project-entry.ts'],
  }),
  sourceTarget({
    id: 'extensions',
    implementation: 'package-core',
    name: 'Trusted extension host',
    packageExport: 'purejsimage/extensions',
    sourceEntries: ['./src/extensions/index.ts'],
  }),
]

export const createPureJsImageEntryTargets = (
  manifest: CapabilityManifest,
): readonly BundleTarget[] => {
  const readers = manifest.scientificReaders.map((reader) =>
    sourceTarget({
      id: scientificReaderTargetId(reader.packageExport),
      implementation: 'package-core',
      name: `Scientific reader: ${reader.format}`,
      packageExport: reader.packageExport,
      sourceEntries: [scientificReaderSourceEntry(reader.packageExport)],
    }),
  )
  const allReaders = sourceTarget({
    id: 'scientific-readers-all',
    implementation: 'package-core',
    name: 'Scientific readers: all',
    packageExport: 'purejsimage/scientific/readers/all',
    sourceEntries: ['./src/scientific/readers/all.ts'],
  })
  const codecTargets = publicCodecTargets(manifest)
  const allCodecs = sourceTarget({
    codecs: publicCodecNames(manifest),
    id: 'codecs-all',
    implementation: 'pure-javascript',
    name: 'Core + all stable codecs',
    packageExport: 'purejsimage/codecs/all',
    sourceEntries: ['./src/index.ts', './src/codec-entries/all.ts'],
  })
  const webCodecs = sourceTarget({
    codecs: ['JPEG', 'PNG', 'WebP', 'AVIF'],
    id: 'codecs-web',
    implementation: 'pure-javascript',
    name: 'Core + common web codecs',
    packageExport: 'purejsimage/codecs/web',
    sourceEntries: ['./src/index.ts', './src/codec-entries/web.ts'],
  })
  const targets = [
    ...staticPureJsImageTargets(),
    ...readers,
    allReaders,
    ...codecTargets,
    webCodecs,
    allCodecs,
  ]
  const targetIds = new Set(targets.map(({ id }) => id))
  const staleBudgets = Object.keys(bundleSizeBudgets).filter((id) => !targetIds.has(id))
  if (staleBudgets.length > 0) {
    throw new Error(`Bundle size budgets reference stale targets: ${staleBudgets.join(', ')}`)
  }
  return targets
}

export const createCompetitorBundleTargets = (
  manifest: CapabilityManifest,
): readonly CompetitorBundleTarget[] => {
  const allCodecs = publicCodecNames(manifest)
  return [
    packageTarget({
      codecs: commonCompetitorCodecs,
      contents: exportsFrom([
        './src/index.ts',
        './src/codec-entries/jpeg.ts',
        './src/codec-entries/png.ts',
      ]),
      id: 'purejsimage-matched',
      implementation: 'pure-javascript',
      name: 'PureJsImage (matched)',
      packageName: 'purejsimage',
      packageExport: 'purejsimage',
      packageNames: ['purejsimage'],
    }),
    packageTarget({
      codecs: allCodecs,
      contents: exportsFrom(['./src/index.ts', './src/codec-entries/all.ts']),
      id: 'purejsimage-all',
      implementation: 'pure-javascript',
      name: 'PureJsImage (all stable codecs)',
      packageName: 'purejsimage',
      packageExport: 'purejsimage/codecs/all',
      packageNames: ['purejsimage'],
    }),
    packageTarget({
      codecs: ['JPEG', 'PNG', 'TIFF', 'BMP', 'GIF'],
      contents: "export * from 'jimp'",
      id: 'jimp',
      implementation: 'pure-javascript',
      name: 'Jimp',
      packageName: 'jimp',
      packageExport: 'jimp',
    }),
    packageTarget({
      codecs: ['JPEG', 'PNG', 'TIFF', 'BMP'],
      contents: "export * from 'image-js'",
      id: 'image-js',
      implementation: 'pure-javascript',
      name: 'image-js',
      packageName: 'image-js',
      packageExport: 'image-js',
    }),
    packageTarget({
      codecs: commonCompetitorCodecs,
      contents: [
        "export { decode as decodeJpeg, encode as encodeJpeg } from '@jsquash/jpeg'",
        "export { decode as decodePng, encode as encodePng } from '@jsquash/png'",
        "export { default as resize } from '@jsquash/resize'",
      ].join('\n'),
      id: 'jsquash',
      implementation: 'webassembly',
      name: 'jSquash',
      packageName: '@jsquash/jpeg',
      packageExports: ['@jsquash/jpeg', '@jsquash/png', '@jsquash/resize'],
      packageNames: ['@jsquash/jpeg', '@jsquash/png', '@jsquash/resize'],
    }),
    packageTarget({
      codecs: ['JPEG', 'PNG', 'TIFF', 'WebP', 'GIF', 'AVIF'],
      contents: "export { default } from 'sharp'",
      id: 'sharp',
      implementation: 'native-wrapper',
      name: 'Sharp JS wrapper',
      packageName: 'sharp',
      packageExport: 'sharp',
    }),
  ]
}
