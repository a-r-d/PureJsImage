import { jpegCodec } from '../../../src/codecs/jpeg.ts'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { createEvidenceSession } from '../../../src/evidence.ts'
import {
  inspectJpegReconstructionEligibility,
  inspectJpegXl,
  reconstructJpegFromJpegXl,
  transcodeJpegToJpegXl,
} from '../../../src/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { normalizePixelBlocks } from '../../../src/pixel.ts'
import { MemorySource } from '../../../src/source.ts'
import {
  isJpegXlWorkbenchRequest,
  type JpegXlWorkbenchPreview,
  type JpegXlWorkbenchResponse,
} from './jpegxl-workbench-types.ts'

interface StoredInput {
  readonly name: string
  readonly kind: 'jpeg' | 'jpegxl'
  readonly bytes: Uint8Array
}

let stored: StoredInput | undefined
let generatedJpegXl: Uint8Array | undefined

const copyBuffer = (data: Uint8Array | Uint8ClampedArray): ArrayBuffer => {
  const output = new ArrayBuffer(data.byteLength)
  new Uint8Array(output).set(data)
  return output
}

const isJpeg = (data: Uint8Array): boolean => data[0] === 0xff && data[1] === 0xd8

const preview = async (
  codec: typeof jpegCodec | typeof jpegxlCodec,
  data: Uint8Array,
): Promise<JpegXlWorkbenchPreview> => {
  const decoder = await codec.createDecoder?.(new MemorySource(data), defaultImageLimits)
  if (!decoder) throw new Error(`${codec.format} decoder is unavailable`)
  const rgba = new Uint8ClampedArray(decoder.width * decoder.height * 4)
  const blocks = normalizePixelBlocks(decoder.decode(), decoder.pixelFormat)
  for await (const block of blocks) {
    try {
      if (block.format !== 'gray8' && block.format !== 'rgb8' && block.format !== 'rgba8') {
        throw new Error(`Workbench preview does not support ${block.format}`)
      }
      const channels = block.format === 'gray8' ? 1 : block.format === 'rgb8' ? 3 : 4
      for (let row = 0; row < block.height; row += 1) {
        for (let x = 0; x < block.width; x += 1) {
          const source = row * block.stride + x * channels
          const target = ((block.y + row) * decoder.width + block.x + x) * 4
          const red = block.data[source] ?? 0
          rgba[target] = red
          rgba[target + 1] = channels === 1 ? red : (block.data[source + 1] ?? 0)
          rgba[target + 2] = channels === 1 ? red : (block.data[source + 2] ?? 0)
          rgba[target + 3] = channels === 4 ? (block.data[source + 3] ?? 0) : 255
        }
      }
    } finally {
      block.release?.()
    }
  }
  return Object.freeze({ width: decoder.width, height: decoder.height, rgba: copyBuffer(rgba) })
}

const post = (response: JpegXlWorkbenchResponse, transfer: Transferable[] = []): void => {
  self.postMessage(response, { transfer })
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isJpegXlWorkbenchRequest(event.data)) return
  const request = event.data
  void (async () => {
    try {
      if (request.type === 'open') {
        const bytes = new Uint8Array(request.bytes)
        const kind = isJpeg(bytes) ? 'jpeg' : 'jpegxl'
        stored = Object.freeze({ name: request.name, kind, bytes })
        generatedJpegXl = undefined
        const rendered = await preview(kind === 'jpeg' ? jpegCodec : jpegxlCodec, bytes)
        const response: JpegXlWorkbenchResponse = {
          type: 'opened',
          requestId: request.requestId,
          name: request.name,
          sourceKind: kind,
          inputBytes: bytes.byteLength,
          ...(kind === 'jpeg'
            ? { eligibility: await inspectJpegReconstructionEligibility(bytes) }
            : { inspection: await inspectJpegXl(bytes) }),
          preview: rendered,
        }
        post(response, [rendered.rgba])
        return
      }
      if (!stored) throw new Error('Open a JPEG or JPEG XL file first')
      if (request.type === 'transcode') {
        if (stored.kind !== 'jpeg') throw new Error('Exact transcode requires a JPEG input')
        const session = createEvidenceSession({ mode: 'summary' })
        const result = await transcodeJpegToJpegXl(stored.bytes, {
          reconstruction: 'required',
          evidence: session.context,
        })
        const report = session.finalize()
        generatedJpegXl = result.data.slice()
        const rendered = await preview(jpegxlCodec, result.data)
        const bytes = copyBuffer(result.data)
        const transcode = Object.freeze({
          mode: result.mode,
          exactReconstruction: result.exactReconstruction,
          inputBytes: result.inputBytes,
          outputBytes: result.outputBytes,
          savingsBytes: result.savingsBytes,
          savingsPercentage: result.savingsPercentage,
          sourceProfile: result.sourceProfile,
          preservedMetadata: result.preservedMetadata,
          warnings: result.warnings,
          outputStructure: result.outputStructure,
          managedPeakBytes: result.managedPeakBytes,
        })
        const response: JpegXlWorkbenchResponse = {
          type: 'output',
          requestId: request.requestId,
          action: 'transcode',
          name: `${stored.name.replace(/\.[^.]+$/u, '')}.jxl`,
          bytes,
          preview: rendered,
          inspection: await inspectJpegXl(result.data),
          transcode,
          evidence: report,
        }
        post(response, [bytes, rendered.rgba])
        return
      }
      const source = stored.kind === 'jpegxl' ? stored.bytes : generatedJpegXl
      if (!source) throw new Error('Transcode the JPEG before reconstruction')
      const jpeg = await reconstructJpegFromJpegXl(source)
      const rendered = await preview(jpegCodec, jpeg)
      const bytes = copyBuffer(jpeg)
      const response: JpegXlWorkbenchResponse = {
        type: 'output',
        requestId: request.requestId,
        action: 'reconstruct',
        name: `${stored.name.replace(/\.[^.]+$/u, '')}-reconstructed.jpg`,
        bytes,
        preview: rendered,
      }
      post(response, [bytes, rendered.rgba])
    } catch (error) {
      post({
        type: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : 'JPEG XL workbench failed',
      })
    }
  })()
})
