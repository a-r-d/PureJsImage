import { readFile } from 'node:fs/promises'

import type { ImageResizeAccelerator } from '../accelerator.ts'
import {
  createWasmResizeAcceleratorWithLoader,
  type WasmResizeAcceleratorOptions,
} from '../accelerators/wasm/resize.ts'

const wasmUrl = new URL('./resize.wasm', import.meta.url)
const simdWasmUrl = new URL('./resize-simd.wasm', import.meta.url)

const loadModule = async (url: URL): Promise<WebAssembly.Module> => {
  return WebAssembly.compile(await readFile(url))
}

export type { WasmResizeAcceleratorOptions } from '../accelerators/wasm/resize.ts'

export const createWasmResizeAccelerator = (
  options: WasmResizeAcceleratorOptions = {},
): ImageResizeAccelerator =>
  createWasmResizeAcceleratorWithLoader(
    (variant) => loadModule(variant === 'simd' ? simdWasmUrl : wasmUrl),
    options,
  )

export const wasmResizeAccelerator = createWasmResizeAccelerator()
