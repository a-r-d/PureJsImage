import { readFile } from 'node:fs/promises'

import type { ImageCodecAccelerator } from '../accelerator.ts'
import {
  createWasmPngAcceleratorWithLoaders,
  type WasmPngAcceleratorOptions,
} from '../accelerators/wasm/png.ts'

const wasmUrl = new URL('./png-codec.wasm', import.meta.url)
const simdWasmUrl = new URL('./png-codec-simd.wasm', import.meta.url)

const loadInstance = async (url: URL): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(url))
  return result.instance
}

export type { WasmPngAcceleratorOptions } from '../accelerators/wasm/png.ts'

export const createWasmPngAccelerator = (
  options: WasmPngAcceleratorOptions = {},
): ImageCodecAccelerator =>
  createWasmPngAcceleratorWithLoaders(
    {
      decoder: () => loadInstance(wasmUrl),
      simdDecoder: () => loadInstance(simdWasmUrl),
      encoder: () => loadInstance(wasmUrl),
      simdEncoder: () => loadInstance(simdWasmUrl),
    },
    options,
  )

export const wasmPngAccelerator = createWasmPngAccelerator()
