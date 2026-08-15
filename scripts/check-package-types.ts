import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import packageJson from '../package.json' with { type: 'json' }

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const fixtureRoot = join(repositoryRoot, 'test-fixtures/packed-package-consumer')

interface CommandResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

const execute = (
  command: string,
  arguments_: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
): CommandResult => {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  })
  if (result.error) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const run = (
  command: string,
  arguments_: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
): string => {
  const result = execute(command, arguments_, cwd, environment)
  if (result.status === 0) return result.stdout
  throw new Error(
    `${command} ${arguments_.join(' ')} exited with status ${result.status ?? 'unknown'}\n${result.stdout}${result.stderr}`,
  )
}

const expectBuildFailure = async (
  entryPoint: string,
  consumerDirectory: string,
  expectedText: RegExp,
): Promise<void> => {
  try {
    await build({
      absWorkingDir: consumerDirectory,
      bundle: true,
      entryPoints: [entryPoint],
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      write: false,
    })
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (expectedText.test(text)) return
    throw new Error(`Bundle failed for an unexpected reason: ${text}`)
  }
  throw new Error(`Expected browser bundle ${entryPoint} to fail`)
}

const assertPortableBundle = async (
  entryPoint: string,
  consumerDirectory: string,
): Promise<number> => {
  const result = await build({
    absWorkingDir: consumerDirectory,
    bundle: true,
    entryPoints: [entryPoint],
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    platform: 'browser',
    write: false,
  })
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
  for (const [input, metadata] of Object.entries(result.metafile.inputs)) {
    for (const imported of metadata.imports) {
      if (builtins.has(imported.path) || imported.path.startsWith('node:')) {
        throw new Error(`Packed browser input ${input} contains Node built-in ${imported.path}`)
      }
    }
  }
  const output = result.outputFiles[0]?.text
  if (output === undefined) throw new Error(`Browser bundle ${entryPoint} produced no output`)
  if (/\bnode:[a-z0-9_/-]+/iu.test(output)) {
    throw new Error(`Packed browser bundle ${entryPoint} contains a Node built-in specifier`)
  }
  return output.length
}

const packedFiles = (output: string): readonly string[] => {
  const parsed: unknown = JSON.parse(output)
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error('Unexpected npm pack report')
  const report: unknown = parsed[0]
  if (report === null || typeof report !== 'object' || !('files' in report)) {
    throw new Error('npm pack report omitted files')
  }
  const files: unknown = report.files
  if (!Array.isArray(files)) throw new Error('npm pack report files must be an array')
  return files.map((entry) => {
    if (entry === null || typeof entry !== 'object' || !('path' in entry)) {
      throw new Error('npm pack report contained an invalid file')
    }
    const path: unknown = entry.path
    if (typeof path !== 'string') throw new Error('npm pack file path must be a string')
    return path
  })
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-package-types-'))
try {
  const environment = {
    npm_config_cache: join(temporaryDirectory, 'npm-cache'),
    npm_config_dry_run: 'false',
  }
  const packReport = run(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryDirectory],
    repositoryRoot,
    environment,
  )
  const files = packedFiles(packReport)
  for (const expected of [
    'dist/index.js',
    'dist/browser.js',
    'dist/scientific/index.js',
    'dist/scientific/node.js',
    'dist/scientific/readers/all.js',
    'dist/scientific/readers/aperio-svs.js',
    'dist/scientific/readers/blockfile.js',
    'dist/scientific/readers/cbf.js',
    'dist/scientific/readers/digital-micrograph.js',
    'dist/scientific/readers/digital-surf.js',
    'dist/scientific/readers/ebsd-text.js',
    'dist/scientific/readers/emsa.js',
    'dist/scientific/readers/igor-binary-wave.js',
    'dist/scientific/readers/nanonis-sxm.js',
    'dist/scientific/readers/x3p.js',
    'dist/scientific/readers/tia-emi.js',
    'dist/scientific/readers/tia-ser.js',
    'dist/scientific/readers/ncem-emd.js',
    'dist/scientific/readers/velox-emd.js',
    'dist/scientific/readers/envi.js',
    'dist/scientific/readers/fits.js',
    'dist/scientific/readers/gsf.js',
    'dist/scientific/readers/mrc.js',
    'dist/scientific/readers/meta-image.js',
    'dist/scientific/readers/mib.js',
    'dist/scientific/readers/nifti.js',
    'dist/scientific/readers/npy.js',
    'dist/scientific/readers/nrrd.js',
    'dist/scientific/readers/ome-tiff.js',
    'dist/scientific/readers/png.js',
    'dist/scientific/readers/rpl.js',
    'dist/scientific/readers/tiff.js',
    'dist/scientific/readers/jpeg.js',
    'dist/scientific/readers/webp.js',
    'dist/scientific/readers/bmp.js',
    'dist/scientific/readers/jp2.js',
    'dist/operations/index.js',
    'dist/analysis/index.js',
    'dist/analysis/project-entry.js',
    'dist/analysis/results.js',
    'dist/analysis/roi-entry.js',
    'dist/analysis/runtime.js',
    'dist/extensions/index.js',
    'dist/sources/http-range.js',
  ]) {
    if (!files.includes(expected)) throw new Error(`Packed package omitted ${expected}`)
  }
  if (files.some((path) => path.startsWith('src/'))) {
    throw new Error('Packed package must not expose source files')
  }
  for (const path of files.filter(
    (candidate) => candidate.startsWith('dist/scientific/') && candidate.endsWith('.d.ts'),
  )) {
    const declaration = await readFile(join(repositoryRoot, path), 'utf8')
    if (/Labeled[A-Z]|\bV2\b|dataset-v2|public-v2/u.test(declaration)) {
      throw new Error(`Packed scientific declaration ${path} exposes migration-history vocabulary`)
    }
  }
  const runtimeDeclaration = await readFile(
    join(repositoryRoot, 'dist/analysis/tile-runtime.d.ts'),
    'utf8',
  )
  if (runtimeDeclaration.includes('reserveOperationWorkingBytes')) {
    throw new Error('Packed analysis runtime exposes the removed raw working-memory reservation')
  }

  const tarball = join(temporaryDirectory, `purejsimage-${packageJson.version}.tgz`)
  const consumerDirectory = join(temporaryDirectory, 'consumer')
  await mkdir(consumerDirectory)
  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ name: 'purejsimage-type-consumer', private: true, type: 'module' }, null, 2)}\n`,
  )
  await writeFile(
    join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: true,
          lib: ['ES2024', 'DOM', 'DOM.Iterable'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          types: [],
        },
        include: ['index.ts', 'runtime.ts', 'browser.ts', 'worker.ts', 'import-effects.ts'],
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(consumerDirectory, 'index.ts'),
    `import { BufferSink, createImageLibrary, MemorySource } from 'purejsimage'
import { createImageLibrary as createBrowserImageLibrary } from 'purejsimage/browser'
import { jpegxlCodec } from 'purejsimage/codecs/jpegxl'
import { pngCodec } from 'purejsimage/codecs/png'
export { defaultTiffCalibrationProfiles, digitalMicrographTiffCalibrationProfile, geoTiffProfile, imageJTiffCalibrationProfile, standardTiffCalibrationProfile } from 'purejsimage/tiff'
export type { TiffCalibrationProfileValue } from 'purejsimage/tiff'
import { createScientificLibrary, normalizeScientificDatasetDescriptor, normalizeScientificSeriesReadRequest, rasterBlockToNumericTile } from 'purejsimage/scientific'
import type { ScientificReader, ScientificSeriesBlock, ScientificSeriesReadRequest } from 'purejsimage/scientific'
export { createImageCodecScientificReader, readScientificSeriesFromPlane } from 'purejsimage/scientific'
export type { ScientificSeriesBlock }
import { encodeGsf, gsfReader } from 'purejsimage/scientific/readers/gsf'
export { aperioSvsReader, createAperioSvsReader } from 'purejsimage/scientific/readers/aperio-svs'
export type { AperioSvsLimits, AperioSvsReaderOptions } from 'purejsimage/scientific/readers/aperio-svs'
export { cbfReader } from 'purejsimage/scientific/readers/cbf'
export { createDigitalMicrographReader, digitalMicrographReader } from 'purejsimage/scientific/readers/digital-micrograph'
export type { DigitalMicrographReaderLimits, DigitalMicrographReaderOptions } from 'purejsimage/scientific/readers/digital-micrograph'
export { createDigitalSurfReader, digitalSurfReader } from 'purejsimage/scientific/readers/digital-surf'
export { createIgorBinaryWaveReader, igorBinaryWaveReader } from 'purejsimage/scientific/readers/igor-binary-wave'
export { createNanonisSxmReader, nanonisSxmReader } from 'purejsimage/scientific/readers/nanonis-sxm'
export { createX3pReader, x3pReader } from 'purejsimage/scientific/readers/x3p'
export { createRplReader, rplReader } from 'purejsimage/scientific/readers/rpl'
export { createEmsaReader, emsaReader } from 'purejsimage/scientific/readers/emsa'
export { createNrrdReader, nrrdReader } from 'purejsimage/scientific/readers/nrrd'
export { createMetaImageReader, metaImageReader } from 'purejsimage/scientific/readers/meta-image'
export { createNiftiReader, niftiReader } from 'purejsimage/scientific/readers/nifti'
export { createNpyReader, npyReader } from 'purejsimage/scientific/readers/npy'
export { blockfileReader, createBlockfileReader } from 'purejsimage/scientific/readers/blockfile'
export { createMibReader, mibReader } from 'purejsimage/scientific/readers/mib'
export { createEbsdTextReader, ebsdTextReader } from 'purejsimage/scientific/readers/ebsd-text'
export { createTiaSerReader, tiaSerReader } from 'purejsimage/scientific/readers/tia-ser'
export type { TiaSerReaderLimits, TiaSerReaderOptions } from 'purejsimage/scientific/readers/tia-ser'
export { createTiaEmiReader, tiaEmiReader } from 'purejsimage/scientific/readers/tia-emi'
export type { TiaEmiReaderLimits, TiaEmiReaderOptions } from 'purejsimage/scientific/readers/tia-emi'
export { createNcemEmdReader, ncemEmdReader } from 'purejsimage/scientific/readers/ncem-emd'
export type { NcemEmdReaderOptions } from 'purejsimage/scientific/readers/ncem-emd'
export { createVeloxEmdReader, veloxEmdReader } from 'purejsimage/scientific/readers/velox-emd'
export type { VeloxEmdReaderLimits, VeloxEmdReaderOptions } from 'purejsimage/scientific/readers/velox-emd'
export { enviReader } from 'purejsimage/scientific/readers/envi'
export { fitsReader } from 'purejsimage/scientific/readers/fits'
export { mrcReader } from 'purejsimage/scientific/readers/mrc'
export { jpegReader } from 'purejsimage/scientific/readers/jpeg'
export { pngReader } from 'purejsimage/scientific/readers/png'
export { webpReader } from 'purejsimage/scientific/readers/webp'
export { bmpReader } from 'purejsimage/scientific/readers/bmp'
export { jp2Reader } from 'purejsimage/scientific/readers/jp2'
export { createTiffReader, tiffReader } from 'purejsimage/scientific/readers/tiff'
export {
  feiSemTiffCalibrationProfile,
  zeissSemTiffCalibrationProfile,
} from 'purejsimage/tiff'
export type { TiffReaderOptions } from 'purejsimage/scientific/readers/tiff'
export * as allScientificReaders from 'purejsimage/scientific/readers/all'
import { createExtensionHost } from 'purejsimage/extensions'
import { createOperationDefinition, createOperationProvider, createValueTypeDefinition } from 'purejsimage/operations'
import { analysisGaussianBlurOperationId, createAnalysisController, createBuiltInAnalysisBundle, hashAnalysisGraph, normalizeRoi, summarizeResult } from 'purejsimage/analysis'
import type { AnalysisGraph, AnalysisProjectV1, Roi } from 'purejsimage/analysis'
import { canonicalTileKey, createTileRuntime } from 'purejsimage/analysis/runtime'
import type { TileRequest, TileSource } from 'purejsimage/analysis/runtime'
import { createAnalysisResultValueTypeRegistry, validateScalarResult } from 'purejsimage/analysis/results'
import { createRoiLineSamplingPlan, createRoiMask, createRoiValueTypeRegistry } from 'purejsimage/analysis/roi'
import { computeAnalysisProjectHashes, normalizeAnalysisProjectV1, validateAnalysisProjectV1 } from 'purejsimage/analysis/project'
import { getImageSourceIdentity } from 'purejsimage/scientific'
export { rasterToPixels } from 'purejsimage/scientific'
export { omeTiffReader } from 'purejsimage/scientific/readers/ome-tiff'
export { createScientificFileContext } from 'purejsimage/scientific/browser'
export { createScientificPathContext } from 'purejsimage/scientific/node'
export { openAperioSvs } from 'purejsimage/pathology'
export { HttpRangeSource } from 'purejsimage/sources/http-range'
export { computeAnalysisProjectHashes, normalizeAnalysisProjectV1, validateAnalysisProjectV1 }
export type { AnalysisProjectV1 }

const nodeImages = createImageLibrary([pngCodec, jpegxlCodec])
const browserImages = createBrowserImageLibrary([pngCodec, jpegxlCodec])
const science = createScientificLibrary({ readers: [gsfReader] })
const extensionReader: ScientificReader = {
  descriptor: {
    id: 'example.science/readers/cube',
    version: '1.0.0',
    format: 'Example cube',
    extensions: ['cube'],
    mediaTypes: ['application/x-example-cube'],
    capabilities: {},
  },
  probe: async () => ({ confidence: 0 }),
  open: async () => { throw new Error('compile-only reader') },
}
const extensionValue = createValueTypeDefinition({
  descriptor: { id: 'example.science.data.cube', version: 1, title: 'Example cube' },
})
const extensionOperation = createOperationDefinition({
  descriptor: {
    id: 'example.science.analysis.mean', version: 1, title: 'Mean', category: 'analysis', tags: [],
    inputs: [{ name: 'cube', valueType: { id: 'example.science.data.cube', version: 1 } }],
    outputs: [],
    parameters: { type: 'object', properties: {}, closed: true },
    execution: 'reduction', reproducibility: { class: 'backend-stable' },
  },
})
const extensionProvider = createOperationProvider({
  descriptor: {
    id: 'example.science.reference', version: 1, kind: 'reference', buildFingerprint: 'example-1',
  },
  prepare: async () => [],
})
const extensionHost = createExtensionHost({
  extensions: [{
    descriptor: { id: 'example.science', version: 1, apiVersion: 1 },
    readers: [extensionReader], valueTypes: [extensionValue], operations: [extensionOperation],
    providers: [extensionProvider],
  }],
})
export const extensionCapabilities = extensionHost.manifest
export const analysisValueTypes = createAnalysisResultValueTypeRegistry().capabilitySnapshot.valueTypes
export const scalarSummary = summarizeResult(validateScalarResult({
  kind: 'scalar', valueType: 'purejsimage.result.scalar', value: 12, nanPolicy: 'forbid', unit: 'K',
}))
const emptyGraph: AnalysisGraph = { schemaVersion: 1, inputs: [], nodes: [], outputs: [] }
export const analysisController = createAnalysisController({
  operations: extensionHost.operations,
  valueTypes: extensionHost.valueTypes,
  providers: extensionHost.providers,
  library: { version: '0.9.0', buildFingerprint: 'consumer-build' },
})
export const emptyGraphHash = hashAnalysisGraph(emptyGraph)
export const emptyWorkspace = analysisController.createWorkspace(emptyGraph)
export const memoryIdentity = getImageSourceIdentity(new MemorySource(Uint8Array.of(1)))
const tileRequest: TileRequest = {
  address: {
    cacheClass: 'source', namespace: 'consumer',
    dataset: {
      semantic: { kind: 'session-dataset', id: 'consumer' },
      generation: 0, sessionId: 'consumer-session',
    },
    displayAxes: ['x', 'y'], fixedIndices: [], resolutionLevel: 0,
    x: 0, y: 0, width: 1, height: 1,
  },
  priority: 'visible', signal: new AbortController().signal,
}
const tileSource: TileSource = {
  tileKey: canonicalTileKey,
  estimate: () => ({
    outputRetainedBytes: 1, peakWorkingBytes: 1, retainedAuxiliaryBytes: 0,
  }),
  readTile: async () => ({
    tile: {
      x: 0, y: 0, width: 1, height: 1, sampleType: 'uint8', componentCount: 1,
      layout: 'interleaved', rowStrideElements: 1, data: Uint8Array.of(1), release() {},
    },
  }),
}
export const tileRuntime = createTileRuntime({ limits: { maxCacheBytes: 1024 } })
export const tileRead = tileRuntime.request(tileSource, tileRequest)
const roiDatasetDescriptor = {
  schemaVersion: 1 as const,
  axes: [
    { id: 'x', kind: 'space' as const, length: 4, coordinates: { type: 'index' as const } },
    { id: 'y', kind: 'space' as const, length: 3, coordinates: { type: 'index' as const } },
  ],
  sampleType: 'uint8' as const,
  components: [{ id: 'value', kind: 'scalar' as const }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
}
const normalizedRoiDataset = normalizeScientificDatasetDescriptor(roiDatasetDescriptor)
const spectrumDescriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 1,
  axes: [{
    id: 'energy', kind: 'spectral', length: 4,
    unit: 'eV', coordinates: { type: 'linear', origin: 100, step: 0.5 },
  }],
  sampleType: 'uint16',
  components: [{ id: 'intensity', kind: 'intensity', unit: 'counts' }],
  capabilities: {
    regionReads: true, resolutionLevels: false, planeReads: { kind: 'none' },
    seriesReads: { kind: 'axes', axes: ['energy'] },
  },
})
const spectrumRequest = {
  axisId: 'energy', fixedIndices: [], start: 1, length: 2,
} satisfies ScientificSeriesReadRequest
export const normalizedSpectrumRequest = normalizeScientificSeriesReadRequest(
  spectrumDescriptor,
  spectrumRequest,
)
export const builtInAnalysis = createBuiltInAnalysisBundle({
  descriptor: normalizedRoiDataset, runtime: tileRuntime, tileWidth: 2, tileHeight: 2,
})
export const gaussianDescription = builtInAnalysis.operations.get(analysisGaussianBlurOperationId, 1)?.descriptor
export const polygonRoi: Roi = normalizeRoi({
  schemaVersion: 1, id: 'selection', axisIds: ['x', 'y'], fixedIndices: [],
  coordinateSpace: 'pixel',
  geometry: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 1, y: 2 }] },
}, normalizedRoiDataset)
export const roiValues = createRoiValueTypeRegistry(normalizedRoiDataset).capabilitySnapshot
export const roiMask = createRoiMask(polygonRoi, normalizedRoiDataset, {
  plane: { width: 4, height: 3 }, tile: { x: 0, y: 0, width: 2, height: 2 },
})
export const roiLine = createRoiLineSamplingPlan(normalizeRoi({
  ...polygonRoi,
  id: 'line',
  geometry: { kind: 'line-segment', start: { x: 0.5, y: 0.5 }, end: { x: 2.5, y: 0.5 } },
}, normalizedRoiDataset), normalizedRoiDataset, {
  spacing: 1, spacingSpace: 'pixel', interpolation: 'bilinear',
})

export const encodeNode = async (input: Uint8Array): Promise<Uint8Array> =>
  (await nodeImages.open(input)).png().toBuffer()
export const encodeBrowser = async (input: Uint8Array): Promise<Uint8Array> =>
  (await browserImages.open(input)).png().toUint8Array()
export const collected: Uint8Array = new BufferSink().toBuffer()
export const nativeTile = rasterBlockToNumericTile({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  stride: 2,
  format: { sampleType: 'uint16', channels: 1, planar: false },
  data: Uint8Array.of(0, 1),
})
export const openScientific = async () => {
  const document = await science.open({
    primary: {
      id: 'surface',
      source: new MemorySource(encodeGsf({ width: 1, height: 1, values: [1] })),
    },
  })
  const summaries = document.datasets
  const dataset = await document.openDataset(summaries[0]?.id ?? 'surface')
  return { summaries, dataset }
}
`,
  )

  for (const name of [
    'runtime.ts',
    'browser.ts',
    'worker.ts',
    'private-import.ts',
    'browser-node-import.ts',
    'import-effects.ts',
  ]) {
    await copyFile(join(fixtureRoot, name), join(consumerDirectory, name))
  }

  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball],
    consumerDirectory,
    environment,
  )
  run(
    process.execPath,
    [resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
    consumerDirectory,
    environment,
  )

  const browserBytes = await assertPortableBundle('browser.ts', consumerDirectory)
  const workerBytes = await assertPortableBundle('worker.ts', consumerDirectory)
  await expectBuildFailure(
    'private-import.ts',
    consumerDirectory,
    /not exported|could not resolve/iu,
  )
  await expectBuildFailure('browser-node-import.ts', consumerDirectory, /node:|built into node/iu)

  const runtimeBundle = join(consumerDirectory, 'runtime.mjs')
  await build({
    absWorkingDir: consumerDirectory,
    bundle: true,
    entryPoints: ['runtime.ts'],
    format: 'esm',
    logLevel: 'silent',
    outfile: runtimeBundle,
    platform: 'node',
  })
  const runtimeOutput = run(
    process.execPath,
    [runtimeBundle],
    consumerDirectory,
    environment,
  ).trim()
  const runtimeReport: unknown = JSON.parse(runtimeOutput)
  if (
    runtimeReport === null ||
    typeof runtimeReport !== 'object' ||
    !('provider' in runtimeReport) ||
    runtimeReport.provider !== 'purejsimage.analysis.reference'
  ) {
    throw new Error(`Unexpected packed runtime report: ${runtimeOutput}`)
  }

  const importEffectsBundle = join(consumerDirectory, 'import-effects.mjs')
  await build({
    absWorkingDir: consumerDirectory,
    bundle: true,
    entryPoints: ['import-effects.ts'],
    format: 'esm',
    logLevel: 'silent',
    outfile: importEffectsBundle,
    platform: 'node',
  })
  const importEffectsOutput = run(
    process.execPath,
    [importEffectsBundle],
    consumerDirectory,
    environment,
  ).trim()
  if (importEffectsOutput !== 'Packed imports are inert') {
    throw new Error(`Unexpected packed import-effects report: ${importEffectsOutput}`)
  }

  console.log(
    `Packed consumer OK (${files.length.toLocaleString()} files; browser ${browserBytes.toLocaleString()} bytes; worker ${workerBytes.toLocaleString()} bytes)`,
  )
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
