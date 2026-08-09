import { readFile } from 'node:fs/promises'

import type { ImageCodecAccelerator } from '../accelerator.ts'
import {
  createWasmJpegAcceleratorWithLoaders,
  type WasmJpegAcceleratorOptions,
} from '../accelerators/wasm/jpeg.ts'

const decoderWasmUrl = new URL('./jpeg-decoder.wasm', import.meta.url)
const simdDecoderWasmUrl = new URL('./jpeg-decoder-simd.wasm', import.meta.url)
const encoderWasmUrl = new URL('./jpeg-encoder.wasm', import.meta.url)
const simdEncoderWasmUrl = new URL('./jpeg-encoder-simd.wasm', import.meta.url)

const loadInstance = async (url: URL): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(url))
  return result.instance
}

export type { WasmJpegAcceleratorOptions } from '../accelerators/wasm/jpeg.ts'

export const createWasmJpegAccelerator = (
  options: WasmJpegAcceleratorOptions = {},
): ImageCodecAccelerator =>
  createWasmJpegAcceleratorWithLoaders(
    {
      decoder: () => loadInstance(decoderWasmUrl),
      simdDecoder: () => loadInstance(simdDecoderWasmUrl),
      encoder: () => loadInstance(encoderWasmUrl),
      simdEncoder: () => loadInstance(simdEncoderWasmUrl),
    },
    options,
  )

export const wasmJpegAccelerator = createWasmJpegAccelerator()
