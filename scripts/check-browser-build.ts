import { build } from 'esbuild'

const result = await build({
  bundle: true,
  format: 'esm',
  logLevel: 'silent',
  platform: 'browser',
  stdin: {
    contents: `
      import { createImageLibrary } from './src/browser.ts'
      import { allCodecs } from './src/codec-entries/all.ts'
      export const images = createImageLibrary(allCodecs)
    `,
    loader: 'ts',
    resolveDir: process.cwd(),
  },
  write: false,
})

const output = result.outputFiles[0]?.text
if (!output) throw new Error('Browser bundle did not produce JavaScript output')

for (const forbidden of ['node:fs', 'node:os', 'node:path', 'node:zlib']) {
  if (output.includes(forbidden)) {
    throw new Error(`Browser bundle contains forbidden Node import: ${forbidden}`)
  }
}

console.log(`Browser bundle OK (${output.length.toLocaleString()} bytes, all codecs)`)
