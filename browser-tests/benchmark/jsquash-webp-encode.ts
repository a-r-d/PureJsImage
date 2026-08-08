import { encode } from '@jsquash/webp'
import type { BrowserBenchmarkModule } from '../types.ts'
import { imageDataFromInput, verifyEncodedImage } from './common.ts'

let input: ImageData | undefined
let output: ArrayBuffer | undefined

const module: BrowserBenchmarkModule = {
  async prepare(bytes) {
    input = await imageDataFromInput(bytes)
  },
  async run() {
    if (!input) throw new Error('jSquash WebP encode benchmark is not prepared')
    output = await encode(input, { quality: 82 })
    return output.byteLength
  },
  async verify() {
    return verifyEncodedImage(output, 640, 480)
  },
}

export const prepare = module.prepare
export const run = module.run
export const verify = module.verify
