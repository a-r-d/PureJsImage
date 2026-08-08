import { decode } from '@jsquash/png'
import type { BrowserBenchmarkModule } from '../types.ts'
import { pixelChecksum } from './common.ts'

let input: ArrayBuffer | undefined
let output: ImageData | undefined

const module: BrowserBenchmarkModule = {
  async prepare(bytes) {
    input = bytes
  },
  async run() {
    if (!input) throw new Error('jSquash PNG decode benchmark is not prepared')
    output = await decode(input)
    return output.data.byteLength
  },
  async verify() {
    if (output?.width !== 640 || output.height !== 480) {
      throw new Error('jSquash PNG decode output dimensions are incorrect')
    }
    return `jSquash decoded RGBA 640x480; pixel checksum ${pixelChecksum(output.data)}`
  },
}

export const prepare = module.prepare
export const run = module.run
export const verify = module.verify
