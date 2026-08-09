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
  const response = await fetch(url)
  if (!response.ok) throw new Error(`JPEG WASM request failed with status ${response.status}`)
  const result = await WebAssembly.instantiate(await response.arrayBuffer())
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
