import { decode } from '@jsquash/webp'
import type { BrowserBenchmarkModule } from '../types.ts'
import { pixelChecksum } from './common.ts'

let input: ArrayBuffer | undefined
let output: ImageData | undefined

const module: BrowserBenchmarkModule = {
  async prepare(bytes) {
    input = bytes
  },
  async run() {
    if (!input) throw new Error('jSquash WebP decode benchmark is not prepared')
    output = await decode(input)
    return output.data.byteLength
  },
  async verify() {
    if (output?.width !== 386 || output.height !== 395) {
      throw new Error('jSquash WebP decode output dimensions are incorrect')
    }
    return `jSquash decoded RGBA 386x395; pixel checksum ${pixelChecksum(output.data)}`
  },
}

export const prepare = module.prepare
export const run = module.run
export const verify = module.verify
