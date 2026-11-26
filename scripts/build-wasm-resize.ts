import { spawnSync } from 'node:child_process'
import { copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const cargo = (() => {
  if (process.env.CARGO) return process.env.CARGO
  const probe = spawnSync('cargo', ['--version'], { stdio: 'ignore' })
  return probe.status === 0 ? 'cargo' : join(homedir(), '.cargo', 'bin', 'cargo')
})()

const manifest = 'wasm/resize/Cargo.toml'
const output = 'wasm/resize/target/wasm32-unknown-unknown/release/purejsimage_resize.wasm'
const stackRustflags = '-C link-arg=-zstack-size=32768 -C link-arg=--export-memory'

const build = async (destination: string, features?: string, rustflags?: string): Promise<void> => {
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
    throw new Error(`Rust resize WASM build exited with status ${result.status}`)
  }
  await copyFile(output, destination)
}

await build('src/accelerator-entries/resize.wasm', undefined, stackRustflags)
await build(
  'src/accelerator-entries/resize-simd.wasm',
  'simd',
  `${stackRustflags} -C target-feature=+simd128`,
)
