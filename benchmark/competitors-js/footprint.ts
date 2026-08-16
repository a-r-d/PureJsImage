import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'

import { measurePackageFootprint } from '../lib/package-footprint.ts'
import type { EngineMetadata, PackageFootprint } from '../types.ts'
import type {
  ScientificCompetitorBundleMetrics,
  ScientificCompetitorEngine,
} from '../scientific-readers/competitor-types.ts'

const adapterEntries: Readonly<Record<string, string>> = {
  geotiff: 'node-geotiff.ts',
  tiff: 'node-tiff.ts',
  utif2: 'node-utif2.ts',
  'image-js': 'node-image-js.ts',
  'nifti-reader-js': 'node-nifti.ts',
  npyjs: 'node-npy.ts',
  jsfive: 'node-jsfive.ts',
  h5wasm: 'node-h5wasm.ts',
  'itk-wasm-image-io': 'node-itk.ts',
}

const compressed = (
  bytes: Uint8Array,
): Pick<
  ScientificCompetitorBundleMetrics,
  'importedJavaScriptGzipBytes' | 'importedJavaScriptBrotliBytes'
> => ({
  importedJavaScriptGzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
  importedJavaScriptBrotliBytes: brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).byteLength,
})

const bundleBytes = async (entry: string): Promise<Uint8Array> => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  })
  const output = result.outputFiles?.[0]
  if (output === undefined) throw new Error(`No bundle output was created for ${entry}`)
  return output.contents
}

const packageFootprint = async (
  engine: ScientificCompetitorEngine,
  repositoryDirectory: string,
): Promise<PackageFootprint> => {
  const metadata: EngineMetadata = {
    id: engine.id,
    version: engine.packageVersion,
    kind: engine.implementationClass,
    packageName: engine.packageName,
    ...(engine.packageNames === undefined ? {} : { packageNames: engine.packageNames }),
  }
  return measurePackageFootprint({ engine: metadata, repositoryDirectory })
}

const assetNames = ['nifti', 'nrrd', 'meta', 'mrc', 'tiff'] as const

const itkAssets = async (
  rootDirectory: string,
): Promise<ScientificCompetitorBundleMetrics['wasmAssets']> => {
  const directory = join(
    rootDirectory,
    'benchmark/competitors-js/node_modules/@itk-wasm/image-io/dist/pipelines',
  )
  const assets: ScientificCompetitorBundleMetrics['wasmAssets'][number][] = []
  for (const name of assetNames) {
    const path = join(directory, `${name}-read-image.wasm.zst`)
    const bytes = await readFile(path)
    const sizes = compressed(bytes)
    assets.push({
      name: `${name}-read-image.wasm.zst`,
      rawBytes: bytes.byteLength,
      gzipBytes: sizes.importedJavaScriptGzipBytes ?? 0,
      brotliBytes: sizes.importedJavaScriptBrotliBytes ?? 0,
      embeddedInJavaScript: false,
    })
  }
  return Object.freeze(assets)
}

const assetsForEngine = async (
  engine: ScientificCompetitorEngine,
  rootDirectory: string,
): Promise<ScientificCompetitorBundleMetrics['wasmAssets']> => {
  if (engine.id === 'itk-wasm-image-io') return itkAssets(rootDirectory)
  if (engine.id === 'h5wasm') {
    return Object.freeze([
      {
        name: 'h5wasm Emscripten module (embedded)',
        rawBytes: 0,
        gzipBytes: 0,
        brotliBytes: 0,
        embeddedInJavaScript: true,
      },
    ])
  }
  return Object.freeze([])
}

export const measureScientificCompetitorFootprints = async (
  engines: readonly ScientificCompetitorEngine[],
  rootDirectory: string,
): Promise<Readonly<Record<string, ScientificCompetitorBundleMetrics>>> => {
  const isolatedDirectory = join(rootDirectory, 'benchmark/competitors-js')
  const entries: [string, ScientificCompetitorBundleMetrics][] = []
  for (const engine of engines) {
    const entryName = adapterEntries[engine.id]
    if (entryName === undefined) throw new Error(`Missing bundle entry for ${engine.id}`)
    const entry = join(isolatedDirectory, entryName)
    let importedJavaScriptBytes: number | null = null
    let importedJavaScriptGzipBytes: number | null = null
    let importedJavaScriptBrotliBytes: number | null = null
    try {
      const bytes = await bundleBytes(entry)
      const sizes = compressed(bytes)
      importedJavaScriptBytes = bytes.byteLength
      importedJavaScriptGzipBytes = sizes.importedJavaScriptGzipBytes
      importedJavaScriptBrotliBytes = sizes.importedJavaScriptBrotliBytes
    } catch (error) {
      console.warn(
        `Could not bundle ${engine.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const repositoryDirectory =
      engine.id === 'geotiff' ||
      engine.id === 'tiff' ||
      engine.id === 'utif2' ||
      engine.id === 'image-js'
        ? rootDirectory
        : isolatedDirectory
    let footprint: PackageFootprint
    try {
      footprint = await packageFootprint(engine, repositoryDirectory)
    } catch (error) {
      console.warn(
        `Could not measure installed footprint for ${engine.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
      footprint = { bytes: 0, packages: [], productionPackageCount: 0 }
    }
    entries.push([
      engine.id,
      Object.freeze({
        importedJavaScriptBytes,
        importedJavaScriptGzipBytes,
        importedJavaScriptBrotliBytes,
        wasmAssets: await assetsForEngine(engine, rootDirectory),
        installedBytes: footprint.bytes,
        installedPackageCount: footprint.productionPackageCount,
        installedPackages: Object.freeze(footprint.packages),
      }),
    ])
  }
  return Object.freeze(Object.fromEntries(entries))
}
