import { build } from 'esbuild'
import { assertGeoShowcaseSourceInputs, geoShowcaseSourceAliases } from './geo-showcase-build.ts'

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
if (
  Object.keys(result.metafile.inputs).some(
    (input) => input.includes('/accelerators/') || input.includes('/accelerator-entries/'),
  )
) {
  throw new Error('Default browser bundle contains an optional accelerator')
}
if (
  Object.keys(result.metafile.inputs).some(
    (input) =>
      input.endsWith('/codecs/heif.ts') || input.endsWith('/codec-entries/experimental/heic.ts'),
  )
) {
  throw new Error('Default browser bundle contains experimental HEIF/HEIC')
}
if (
  Object.keys(result.metafile.inputs).some(
    (input) =>
      input.includes('/operations/') ||
      input.includes('/analysis/') ||
      input.includes('/extensions/'),
  )
) {
  throw new Error('Default browser bundle installs application-platform infrastructure')
}
if (Object.keys(result.metafile.inputs).some((input) => input.includes('/hdr/'))) {
  throw new Error('Default browser bundle contains the opt-in HDR entry')
}

const hdrResult = await build({
  bundle: true,
  format: 'esm',
  logLevel: 'silent',
  metafile: true,
  platform: 'browser',
  stdin: {
    contents: `export * from './src/hdr/index.ts'`,
    loader: 'ts',
    resolveDir: process.cwd(),
  },
  write: false,
})
for (const [input, metadata] of Object.entries(hdrResult.metafile.inputs)) {
  for (const imported of metadata.imports) {
    if (imported.path.startsWith('node:')) {
      throw new Error(`Browser HDR input ${input} contains Node built-in ${imported.path}`)
    }
  }
}

const applicationPlatformResult = await build({
  bundle: true,
  format: 'esm',
  logLevel: 'silent',
  metafile: true,
  platform: 'browser',
  stdin: {
    contents: `
      export * from './src/scientific/index.ts'
      export * from './src/scientific/readers/all.ts'
      export * from './src/geo/index.ts'
      export * from './src/geo/readers/all.ts'
      export * from './src/geo/readers/geozarr/index.ts'
      export * from './src/geo/readers/netcdf.ts'
      export * from './src/operations/index.ts'
      export * from './src/analysis/index.ts'
      export * from './src/analysis/project-entry.ts'
      export * from './src/analysis/results.ts'
      export * from './src/analysis/roi-entry.ts'
      export * from './src/analysis/runtime.ts'
      export * from './src/extensions/index.ts'
      export * from './src/evidence.ts'
    `,
    loader: 'ts',
    resolveDir: process.cwd(),
  },
  write: false,
})

const geoShowcaseResult = await build({
  absWorkingDir: process.cwd(),
  alias: geoShowcaseSourceAliases,
  bundle: true,
  entryPoints: ['docs-astro/src/scripts/geo-showcase-worker.ts'],
  format: 'esm',
  logLevel: 'silent',
  metafile: true,
  platform: 'browser',
  write: false,
})
assertGeoShowcaseSourceInputs(Object.keys(geoShowcaseResult.metafile.inputs))

const webCodecResult = await build({
  bundle: true,
  format: 'esm',
  logLevel: 'silent',
  metafile: true,
  platform: 'browser',
  stdin: {
    contents: `
      import { createImageLibrary } from './src/browser.ts'
      import { allWebCodecs } from './src/codec-entries/web.ts'
      export const webImages = createImageLibrary(allWebCodecs)
    `,
    loader: 'ts',
    resolveDir: process.cwd(),
  },
  write: false,
})
for (const [input, metadata] of Object.entries(webCodecResult.metafile.inputs)) {
  for (const imported of metadata.imports) {
    if (imported.path.startsWith('node:')) {
      throw new Error(`Browser web-codec input ${input} contains Node built-in ${imported.path}`)
    }
  }
}
for (const [input, metadata] of Object.entries(applicationPlatformResult.metafile.inputs)) {
  for (const imported of metadata.imports) {
    if (imported.path.startsWith('node:')) {
      throw new Error(
        `Browser application-platform input ${input} contains Node built-in ${imported.path}`,
      )
    }
  }
}

const acceleratorResult = await build({
  bundle: true,
  format: 'esm',
  logLevel: 'silent',
  metafile: true,
  platform: 'browser',
  stdin: {
    contents: `
      export * from './src/accelerator-entries/wasm-jpeg-browser.ts'
      export * from './src/accelerator-entries/wasm-png-browser.ts'
      export * from './src/accelerator-entries/wasm-webp-browser.ts'
    `,
    loader: 'ts',
    resolveDir: process.cwd(),
  },
  write: false,
})
for (const [input, metadata] of Object.entries(acceleratorResult.metafile.inputs)) {
  for (const imported of metadata.imports) {
    if (imported.path.startsWith('node:')) {
      throw new Error(`Browser accelerator input ${input} contains Node built-in ${imported.path}`)
    }
  }
}

console.log(
  `Browser bundle OK (${output.length.toLocaleString()} bytes, 10 default codecs; scientific reader, optional JPEG/PNG/WebP WASM, and experimental HEIF/HEIC entries remain explicit)`,
)
