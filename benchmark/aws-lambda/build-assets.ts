import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const assetDirectory = fileURLToPath(new URL('./.asset/', import.meta.url))
const fixtureDirectory = fileURLToPath(new URL('./.asset/fixtures/', import.meta.url))
const fixturePaths = [
  fileURLToPath(new URL('../corpus/files/tundra-4000x3000.jpg', import.meta.url)),
  fileURLToPath(new URL('../corpus/files/rgba-gradient-4000x3000.png', import.meta.url)),
] as const

await rm(assetDirectory, { force: true, recursive: true })
await mkdir(fixtureDirectory, { recursive: true })

for (const fixturePath of fixturePaths) {
  const fixtureStat = await stat(fixturePath)
  if (!fixtureStat.isFile() || fixtureStat.size === 0) {
    throw new Error(`Lambda benchmark fixture is missing or empty: ${fixturePath}`)
  }
  await copyFile(fixturePath, `${fixtureDirectory}/${basename(fixturePath)}`)
}

const result = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: [`${benchmarkDirectory}/handler.ts`],
  outfile: `${assetDirectory}/index.mjs`,
  bundle: true,
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
console.log(`Prepared Lambda asset: ${bundledBytes} bundled bytes, ${fixturePaths.length} fixtures`)
