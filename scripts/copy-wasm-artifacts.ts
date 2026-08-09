import { copyFile, mkdir } from 'node:fs/promises'

const outputDirectory = 'dist/accelerator-entries'
await mkdir(outputDirectory, { recursive: true })
await copyFile('src/accelerator-entries/jpeg-decoder.wasm', `${outputDirectory}/jpeg-decoder.wasm`)
