import { spawnSync } from 'node:child_process'
import { copyFile } from 'node:fs/promises'

const cargo = process.env.CARGO ?? 'cargo'

const build = async (
  manifest: string,
  output: string,
  destination: string,
  features?: string,
  rustflags?: string,
): Promise<void> => {
  const arguments_ = [
    'build',
    '--manifest-path',
    manifest,
    '--target',
    'wasm32-unknown-unknown',
    '--release',
  ]
  if (features) arguments_.push('--features', features)
  const result = spawnSync(cargo, arguments_, {
    stdio: 'inherit',
    env: rustflags ? { ...process.env, RUSTFLAGS: rustflags } : process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Rust JPEG WASM build exited with status ${result.status}`)
  }
  await copyFile(output, destination)
}

await build(
  'wasm/jpeg-decoder/Cargo.toml',
  'wasm/jpeg-decoder/target/wasm32-unknown-unknown/release/purejsimage_jpeg_decoder.wasm',
  'src/accelerator-entries/jpeg-decoder.wasm',
)
await build(
  'wasm/jpeg-decoder/Cargo.toml',
  'wasm/jpeg-decoder/target/wasm32-unknown-unknown/release/purejsimage_jpeg_decoder.wasm',
  'src/accelerator-entries/jpeg-decoder-simd.wasm',
  'simd',
  '-C target-feature=+simd128 -C link-arg=--export-memory',
)
await build(
  'wasm/jpeg-encoder/Cargo.toml',
  'wasm/jpeg-encoder/target/wasm32-unknown-unknown/release/purejsimage_jpeg_encoder.wasm',
  'src/accelerator-entries/jpeg-encoder.wasm',
)
await build(
  'wasm/jpeg-encoder/Cargo.toml',
  'wasm/jpeg-encoder/target/wasm32-unknown-unknown/release/purejsimage_jpeg_encoder.wasm',
  'src/accelerator-entries/jpeg-encoder-simd.wasm',
  'simd',
  '-C target-feature=+simd128 -C link-arg=--export-memory',
)
