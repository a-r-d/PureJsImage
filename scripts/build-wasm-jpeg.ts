import { spawnSync } from 'node:child_process'
import { copyFile } from 'node:fs/promises'

const result = spawnSync(
  'cargo',
  [
    'build',
    '--manifest-path',
    'wasm/jpeg-decoder/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
  ],
  { stdio: 'inherit' },
)
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`Rust JPEG WASM build exited with status ${result.status}`)

await copyFile(
  'wasm/jpeg-decoder/target/wasm32-unknown-unknown/release/purejsimage_jpeg_decoder.wasm',
  'src/accelerator-entries/jpeg-decoder.wasm',
)
