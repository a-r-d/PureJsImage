import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import packageJson from '../package.json' with { type: 'json' }

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const run = (command: string, arguments_: readonly string[], cwd: string): void => {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_dry_run: 'false' },
  })
  if (result.error) throw result.error
  if (result.status === 0) return
  throw new Error(
    `${command} ${arguments_.join(' ')} exited with status ${result.status ?? 'unknown'}\n${result.stdout}${result.stderr}`,
  )
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-package-types-'))
try {
  run('npm', ['pack', '--ignore-scripts', '--pack-destination', temporaryDirectory], repositoryRoot)

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
        include: ['index.ts'],
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
export { geoTiffProfile } from 'purejsimage/tiff'
import { createScientificLibrary, encodeGsf, gsfReader, normalizeScientificDatasetDescriptor, rasterBlockToNumericTile } from 'purejsimage/scientific'
import type { ScientificReader } from 'purejsimage/scientific'
import { createExtensionHost } from 'purejsimage/extensions'
import { createOperationDefinition, createOperationProvider, createValueTypeDefinition } from 'purejsimage/operations'
import { createAnalysisController, createAnalysisResultValueTypeRegistry, createRoiLineSamplingPlan, createRoiMask, createRoiValueTypeRegistry, getImageSourceIdentity, hashAnalysisGraph, normalizeRoi, summarizeResult, validateScalarResult } from 'purejsimage/analysis'
import type { AnalysisGraph, Roi } from 'purejsimage/analysis'
export { openOmeTiff, rasterToPixels } from 'purejsimage/scientific'
export { createScientificFileContext } from 'purejsimage/scientific/browser'
export { createScientificPathContext } from 'purejsimage/scientific/node'
export { openAperioSvs } from 'purejsimage/pathology'
export { HttpRangeSource } from 'purejsimage/sources/http-range'

const nodeImages = createImageLibrary([pngCodec, jpegxlCodec])
const browserImages = createBrowserImageLibrary([pngCodec, jpegxlCodec])
const science = createScientificLibrary({ readers: [gsfReader] })
const extensionReader: ScientificReader = {
  descriptor: {
    id: 'example/readers/cube',
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
  descriptor: { id: 'example.data.cube', version: 1, title: 'Example cube' },
})
const extensionOperation = createOperationDefinition({
  descriptor: {
    id: 'example.analysis.mean', version: 1, title: 'Mean', category: 'analysis', tags: [],
    inputs: [{ name: 'cube', valueType: { id: 'example.data.cube', version: 1 } }],
    outputs: [],
    parameters: { type: 'object', properties: {}, closed: true },
    execution: 'reduction', reproducibility: { class: 'backend-stable' },
  },
})
const extensionProvider = createOperationProvider({
  descriptor: {
    id: 'example.reference', version: 1, kind: 'reference', buildFingerprint: 'example-1',
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
  providers: [extensionProvider],
  library: { version: '0.9.0', buildFingerprint: 'consumer-build' },
})
export const emptyGraphHash = hashAnalysisGraph(emptyGraph)
export const emptyWorkspace = analysisController.createWorkspace(emptyGraph)
export const memoryIdentity = getImageSourceIdentity(new MemorySource(Uint8Array.of(1)))
const roiDatasetDescriptor = {
  schemaVersion: 2 as const,
  axes: [
    { id: 'x', kind: 'space' as const, length: 4, coordinates: { type: 'index' as const } },
    { id: 'y', kind: 'space' as const, length: 3, coordinates: { type: 'index' as const } },
  ],
  sampleType: 'uint8' as const,
  components: [{ id: 'value', kind: 'scalar' as const }],
  capabilities: { regionReads: true, resolutionLevels: false },
}
const normalizedRoiDataset = normalizeScientificDatasetDescriptor(roiDatasetDescriptor)
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

  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball],
    consumerDirectory,
  )
  run(
    process.execPath,
    [resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
    consumerDirectory,
  )
  console.log('Packed declarations compile for a strict consumer without Node ambient types')
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
