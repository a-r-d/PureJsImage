import { copyFile, mkdir } from 'node:fs/promises'

const outputDirectory = 'dist/accelerator-entries'
await mkdir(outputDirectory, { recursive: true })
await copyFile('src/accelerator-entries/jpeg-decoder.wasm', `${outputDirectory}/jpeg-decoder.wasm`)
await copyFile(
  'src/accelerator-entries/jpeg-decoder-simd.wasm',
  `${outputDirectory}/jpeg-decoder-simd.wasm`,
)
await copyFile('src/accelerator-entries/jpeg-encoder.wasm', `${outputDirectory}/jpeg-encoder.wasm`)
await copyFile(
  'src/accelerator-entries/jpeg-encoder-simd.wasm',
  `${outputDirectory}/jpeg-encoder-simd.wasm`,
)
