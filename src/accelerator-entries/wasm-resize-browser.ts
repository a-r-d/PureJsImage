import type { ImageResizeAccelerator } from '../accelerator.ts'
import {
  createWasmResizeAcceleratorWithLoader,
  type WasmResizeAcceleratorOptions,
} from '../accelerators/wasm/resize.ts'

const wasmUrl = new URL('./resize.wasm', import.meta.url)
const simdWasmUrl = new URL('./resize-simd.wasm', import.meta.url)

const loadModule = async (url: URL): Promise<WebAssembly.Module> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Resize WASM request failed with status ${response.status}`)
  return WebAssembly.compile(await response.arrayBuffer())
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
