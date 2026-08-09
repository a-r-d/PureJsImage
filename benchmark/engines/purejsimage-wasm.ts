import { createPureJsImageEngine } from './purejsimage-shared.ts'

export const engine = await createPureJsImageEngine({
  id: 'purejsimage-wasm',
  kind: 'webassembly',
  versionSuffix: ' WASM',
  accelerators: [
    {
      path: './accelerator-entries/wasm-jpeg-node.js',
      exportName: 'wasmJpegAccelerator',
    },
    {
      path: './accelerator-entries/wasm-png-node.js',
      exportName: 'wasmPngAccelerator',
    },
  ],
})
