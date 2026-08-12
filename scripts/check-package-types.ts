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
import { createScientificLibrary, encodeGsf, gsfReader, rasterBlockToNumericTile } from 'purejsimage/scientific'
import type { ScientificReader } from 'purejsimage/scientific'
import { createExtensionHost } from 'purejsimage/extensions'
import { createOperationDefinition, createOperationProvider, createValueTypeDefinition } from 'purejsimage/operations'
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
export const extensionCapabilities = createExtensionHost({
  extensions: [{
    descriptor: { id: 'example.science', version: 1, apiVersion: 1 },
    readers: [extensionReader], valueTypes: [extensionValue], operations: [extensionOperation],
    providers: [extensionProvider],
  }],
}).manifest

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
