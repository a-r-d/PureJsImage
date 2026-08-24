import { readFile } from 'node:fs/promises'

import type { ImageCodecAccelerator } from '../accelerator.ts'
import {
  createWasmWebpAcceleratorWithLoaders,
  type WasmWebpAcceleratorOptions,
} from '../accelerators/wasm/webp.ts'

const wasmUrl = new URL('./webp-codec.wasm', import.meta.url)
const simdWasmUrl = new URL('./webp-codec-simd.wasm', import.meta.url)

const loadInstance = async (url: URL): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(url))
  return result.instance
}

export type { WasmWebpAcceleratorOptions } from '../accelerators/wasm/webp.ts'

export const createWasmWebpAccelerator = (
  options: WasmWebpAcceleratorOptions = {},
): ImageCodecAccelerator =>
  createWasmWebpAcceleratorWithLoaders(
    {
      decoder: () => loadInstance(wasmUrl),
      simdDecoder: () => loadInstance(simdWasmUrl),
      encoder: () => loadInstance(wasmUrl),
      simdEncoder: () => loadInstance(simdWasmUrl),
    },
    options,
  )

export const wasmWebpAccelerator = createWasmWebpAccelerator()
