import type { ImageCodecAccelerator } from '../accelerator.ts'
import {
  createWasmJpegAcceleratorWithLoader,
  type WasmJpegAcceleratorOptions,
} from '../accelerators/wasm/jpeg.ts'

const wasmUrl = new URL('./jpeg-decoder.wasm', import.meta.url)

const loadInstance = async (): Promise<WebAssembly.Instance> => {
  const response = await fetch(wasmUrl)
  if (!response.ok) throw new Error(`JPEG WASM request failed with status ${response.status}`)
  const result = await WebAssembly.instantiate(await response.arrayBuffer())
  return result.instance
}

export type { WasmJpegAcceleratorOptions } from '../accelerators/wasm/jpeg.ts'

export const createWasmJpegAccelerator = (
  options: WasmJpegAcceleratorOptions = {},
): ImageCodecAccelerator => createWasmJpegAcceleratorWithLoader(loadInstance, options)

export const wasmJpegAccelerator = createWasmJpegAccelerator()
