import { access, copyFile, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { hash, json, root, run, work } from './io.ts'
import { number, object, string } from './model.ts'

let priorAssets: Record<string, unknown>[] = []
try {
  await access(`${root}/subjects.json`)
  const previous = await readFile(`${root}/subjects.json`),
    identity = hash(previous)
  const inventory = object(JSON.parse(previous.toString())).files
  if (Array.isArray(inventory)) priorAssets = inventory.map(object)
  await mkdir(`${work}/asset-history/${identity}`, { recursive: true })
  await writeFile(`${root}/results/subjects-${identity}.json.gz`, gzipSync(previous))
  await cp(`${work}/web`, `${work}/asset-history/${identity}/web`, { recursive: true })
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
}
await mkdir(`${work}/assets/vips`, { recursive: true })
const assets = [
  ['node_modules/@jsquash/jxl/codec/dec/jxl_dec.wasm', 'jsquash-dec.wasm'],
  ['node_modules/@jsquash/jxl/codec/enc/jxl_enc.wasm', 'jsquash-enc.wasm'],
  ['node_modules/jxl-oxide-wasm/jxl_oxide_wasm_bg.wasm', 'oxide.wasm'],
]
for (const [source, target] of assets) {
  if (source && target) await copyFile(source, `${work}/assets/${target}`)
}
for (const name of ['vips-es6.js', 'vips.wasm', 'vips-jxl.wasm'])
  await copyFile(`node_modules/wasm-vips/lib/${name}`, `${work}/assets/vips/${name}`)
await build({
  entryPoints: [`${root}/browser-worker.ts`],
  outdir: `${work}/web`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  splitting: true,
  minify: true,
  metafile: true,
  external: ['node:*', 'fs', 'path'],
  alias: { 'wasm-vips': './node_modules/wasm-vips/lib/vips-es6.js' },
  plugins: [
    {
      name: 'vips-external',
      setup(api) {
        api.onResolve({ filter: /^wasm-vips$/ }, () => ({
          path: '/assets/vips/vips-es6.js',
          external: true,
        }))
      },
    },
  ],
  tsconfigRaw: { compilerOptions: {} },
})
const packages = []
for (const name of ['@jsquash/jxl', 'jxl-oxide-wasm', 'wasm-vips']) {
  const bytes = await readFile(`node_modules/${name}/package.json`)
  packages.push({
    name,
    manifest: object(JSON.parse(bytes.toString())),
    manifestSha256: hash(bytes),
  })
}
const files = []
for (const directory of [`${work}/web`, `${work}/assets`, `${work}/assets/vips`])
  for (const name of await readdir(directory, { withFileTypes: true })) {
    if (!name.isFile()) continue
    const path = `${directory}/${name.name}`,
      bytes = await readFile(path)
    const cached = priorAssets.find((asset) => asset.sha256 === hash(bytes))
    files.push({
      path,
      sha256: hash(bytes),
      bytes: bytes.length,
      gzipBytes: cached ? number(cached.gzipBytes) : gzipSync(bytes, { level: 9 }).length,
      brotliBytes: cached
        ? number(cached.brotliBytes)
        : brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    })
  }
await json(`${root}/subjects.json`, {
  schemaVersion: 1,
  date: new Date().toISOString(),
  implementationRevision: run('git', ['rev-parse', 'HEAD']).trim(),
  packages,
  files,
  build: {
    esbuild: string(
      object(JSON.parse(await readFile('node_modules/esbuild/package.json', 'utf8'))).version,
    ),
    target:
      'ESM modern browser; minified; code splitting; public PureJsImage dist exports; published WASM assets unchanged',
    node: process.version,
  },
  threads: {
    purejsimage: 1,
    jsquash: 'single thread on non-isolated browser origin and Node default',
    oxide: 1,
    vips: 'concurrency(1), pthread runtime; isolated browser origin required',
  },
  cache:
    'Cold worker/module initialization and asset fetch; fresh browser context, HTTP no-store. Warm operations reuse initialized module but no operation-result cache. Browser compilation code cache controlled only by fresh context, not OS cache.',
})
console.log(`Pinned ${files.length} assets`)
