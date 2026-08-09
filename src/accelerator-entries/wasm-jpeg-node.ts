import { readFile } from 'node:fs/promises'

import type { ImageCodecAccelerator } from '../accelerator.ts'
import {
  createWasmJpegAcceleratorWithLoader,
  type WasmJpegAcceleratorOptions,
} from '../accelerators/wasm/jpeg.ts'

const wasmUrl = new URL('./jpeg-decoder.wasm', import.meta.url)

const loadInstance = async (): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(wasmUrl))
  return result.instance
}

export type { WasmJpegAcceleratorOptions } from '../accelerators/wasm/jpeg.ts'

export const createWasmJpegAccelerator = (
  options: WasmJpegAcceleratorOptions = {},
): ImageCodecAccelerator => createWasmJpegAcceleratorWithLoader(loadInstance, options)

export const wasmJpegAccelerator = createWasmJpegAccelerator()
