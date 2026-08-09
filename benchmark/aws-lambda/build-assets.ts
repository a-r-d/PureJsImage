import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const assetDirectory = fileURLToPath(new URL('./.asset/', import.meta.url))
const wasmPath = fileURLToPath(
  new URL('../../src/accelerator-entries/jpeg-decoder.wasm', import.meta.url),
)

await rm(assetDirectory, { force: true, recursive: true })
await mkdir(assetDirectory, { recursive: true })
const wasmStat = await stat(wasmPath)
if (!wasmStat.isFile() || wasmStat.size === 0) {
  throw new Error(`Lambda benchmark WASM module is missing or empty: ${wasmPath}`)
}
await copyFile(wasmPath, `${assetDirectory}/jpeg-decoder.wasm`)

const result = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: [`${benchmarkDirectory}/handler.ts`],
  outfile: `${assetDirectory}/index.mjs`,
  bundle: true,
  external: ['@aws-sdk/client-s3'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
  minify: false,
  sourcemap: false,
})

const bundledBytes = Object.values(result.metafile.outputs).reduce(
  (total, output) => total + output.bytes,
  0,
)
console.log(`Prepared Lambda asset: ${bundledBytes} bundled bytes, ${wasmStat.size} WASM bytes`)
