import { build } from 'esbuild'

const result = await build({
  bundle: true,
  format: 'esm',
  logLevel: 'silent',
  metafile: true,
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

for (const [input, metadata] of Object.entries(result.metafile.inputs)) {
  for (const imported of metadata.imports) {
    if (imported.path.startsWith('node:')) {
      throw new Error(`Browser bundle input ${input} contains Node built-in ${imported.path}`)
    }
  }
}
if (output.includes('from"node:') || output.includes("from'node:")) {
  throw new Error('Browser bundle contains a Node built-in import')
}

console.log(`Browser bundle OK (${output.length.toLocaleString()} bytes, all codecs)`)
