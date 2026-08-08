import type { BrowserBenchmarkModule } from '../types.ts'
import { verifyEncodedImage } from './common.ts'

let input: Blob | undefined
let output: Blob | undefined

const module: BrowserBenchmarkModule = {
  async prepare(bytes) {
    input = new Blob([bytes], { type: 'image/png' })
  },
  async run() {
    if (!input) throw new Error('Native PNG benchmark is not prepared')
    const bitmap = await createImageBitmap(input)
    const canvas = new OffscreenCanvas(320, 240)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D OffscreenCanvas context is unavailable')
    context.drawImage(bitmap, 0, 0, 320, 240)
    bitmap.close()
    output = await canvas.convertToBlob({ type: 'image/png' })
    return output.size
  },
  async verify() {
    return verifyEncodedImage(output, 320, 240)
  },
}

export const prepare = module.prepare
export const run = module.run
export const verify = module.verify
