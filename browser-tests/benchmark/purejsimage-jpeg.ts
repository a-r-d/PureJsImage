import { createImageLibrary } from '../../src/browser.ts'
import { jpegCodec } from '../../src/codec-entries/jpeg.ts'
import type { BrowserBenchmarkModule } from '../types.ts'
import { verifyEncodedImage } from './common.ts'

const images = createImageLibrary([jpegCodec])
let input: Uint8Array<ArrayBuffer> | undefined
let output: Uint8Array | undefined

const module: BrowserBenchmarkModule = {
  async prepare(bytes) {
    input = new Uint8Array(bytes)
  },
  async run() {
    if (!input) throw new Error('PureJsImage JPEG benchmark is not prepared')
    output = await (await images.open(input))
      .resize({ width: 320 })
      .jpeg({ quality: 82 })
      .toUint8Array()
    return output.byteLength
  },
  async verify() {
    if (!output) throw new Error('PureJsImage JPEG benchmark produced no output')
    const metadata = await (await images.open(output)).metadata()
    if (metadata.width !== 320 || metadata.height !== 240 || metadata.format !== 'jpeg') {
      throw new Error('PureJsImage JPEG benchmark output metadata is incorrect')
    }
    return `PureJsImage ${await verifyEncodedImage(new Blob([Uint8Array.from(output)]), 320, 240)}`
  },
}

export const prepare = module.prepare
export const run = module.run
export const verify = module.verify
