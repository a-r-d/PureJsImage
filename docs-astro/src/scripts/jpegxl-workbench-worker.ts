import { throwIfAborted } from '../../../src/abort.ts'
import { createImageLibrary } from '../../../src/browser.ts'
import type { ImageCodec, ImageDecoder } from '../../../src/codec.ts'
import { jpegCodec } from '../../../src/codecs/jpeg.ts'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { pngCodec } from '../../../src/codecs/png.ts'
import { tiffCodec } from '../../../src/codecs/tiff.ts'
import { createEvidenceSession } from '../../../src/evidence.ts'
import {
  inspectJpegReconstructionEligibility,
  inspectJpegXl,
  reconstructJpegFromJpegXl,
  transcodeJpegToJpegXl,
} from '../../../src/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import type { PixelFormat } from '../../../src/pixel.ts'
import { Uint8ArraySink } from '../../../src/sink.ts'
import { MemorySource } from '../../../src/source.ts'
import {
  isJpegXlWorkbenchPreviewPixelFormat,
  jpegXlWorkbenchPreviewMode,
  jpegXlWorkbenchPreviewPixel,
  jpegXlWorkbenchPreviewRanges,
} from './jpegxl-workbench-preview.ts'
import {
  isJpegXlWorkbenchRequest,
  type JpegXlWorkbenchPreview,
  type JpegXlWorkbenchResponse,
  jpegXlWorkbenchMaximumOutputBytes,
  planJpegXlWorkbenchNativeMemory,
  planJpegXlWorkbenchPreview,
} from './jpegxl-workbench-types.ts'

interface StoredInput {
  readonly generation: number
  readonly name: string
  readonly kind: 'jpeg' | 'jpegxl' | 'png' | 'tiff'
  readonly bytes: Uint8Array
}

type EncoderPixelFormat = 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16'

interface NativePixels {
  readonly width: number
  readonly height: number
  readonly format: EncoderPixelFormat
  readonly pixels: Uint8Array
  readonly decoder: ImageDecoder
}

let stored: StoredInput | undefined
let generatedJpegXl:
  | Readonly<{ readonly generation: number; readonly bytes: Uint8Array }>
  | undefined
let activeAbort: AbortController | undefined
let activeGeneration = -1
let activeRequestId = -1

const copyBuffer = (data: Uint8Array | Uint8ClampedArray): ArrayBuffer => {
  const output = new ArrayBuffer(data.byteLength)
  new Uint8Array(output).set(data)
  return output
}

const isJpeg = (data: Uint8Array): boolean => data[0] === 0xff && data[1] === 0xd8

const pinnedLibjxlReferenceBytes = new Map<string, number>([
  ['226671d7fcd032a237d7e195e936545f0b492628fd96b21e1b062ccbc40e2a6e', 1_081],
])

const libjxlReferenceBytes = async (data: Uint8Array): Promise<number | null> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copyBuffer(data)))
  let hash = ''
  for (const byte of digest) hash += byte.toString(16).padStart(2, '0')
  return pinnedLibjxlReferenceBytes.get(hash) ?? null
}

const inputCodec = (
  data: Uint8Array,
): Readonly<{ readonly kind: StoredInput['kind']; readonly codec: ImageCodec }> => {
  if (isJpeg(data)) return Object.freeze({ kind: 'jpeg', codec: jpegCodec })
  if (pngCodec.detect(data)) return Object.freeze({ kind: 'png', codec: pngCodec })
  if (tiffCodec.detect(data)) return Object.freeze({ kind: 'tiff', codec: tiffCodec })
  if (jpegxlCodec.detect(data)) return Object.freeze({ kind: 'jpegxl', codec: jpegxlCodec })
  throw new Error('Workbench input must be JPEG, JPEG XL, PNG, or TIFF')
}

const encoderPixelFormat = (format: PixelFormat): format is EncoderPixelFormat =>
  format === 'gray8' ||
  format === 'gray16' ||
  format === 'rgb8' ||
  format === 'rgb16' ||
  format === 'rgba8' ||
  format === 'rgba16'

const channelCount = (format: EncoderPixelFormat): 1 | 3 | 4 =>
  format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3

const nativePixels = async (
  codec: ImageCodec,
  data: Uint8Array,
  signal: AbortSignal,
): Promise<NativePixels> => {
  const decoder = await codec.createDecoder?.(new MemorySource(data), defaultImageLimits, {
    signal,
  })
  if (!decoder) throw new Error(`${codec.format} decoder is unavailable`)
  if (!encoderPixelFormat(decoder.pixelFormat)) {
    throw new Error(`Pixel-lossless JPEG XL encode does not support ${decoder.pixelFormat}`)
  }
  const format = decoder.pixelFormat
  const memoryPlan = planJpegXlWorkbenchNativeMemory(decoder.width, decoder.height, format)
  const sampleBytes = format.endsWith('16') ? 2 : 1
  const pixels = new Uint8Array(memoryPlan.nativePixelBytes)
  for await (const block of decoder.decode({ signal })) {
    try {
      throwIfAborted(signal)
      if (block.format !== format) throw new Error('Decoder changed pixel format between blocks')
      const blockRowBytes = block.width * channelCount(format) * sampleBytes
      for (let row = 0; row < block.height; row += 1) {
        pixels.set(
          block.data.subarray(row * block.stride, row * block.stride + blockRowBytes),
          ((block.y + row) * decoder.width + block.x) * channelCount(format) * sampleBytes,
        )
      }
    } finally {
      block.release?.()
    }
  }
  return Object.freeze({ width: decoder.width, height: decoder.height, format, pixels, decoder })
}

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

const displayOptions = async (
  codec: ImageCodec,
  data: Uint8Array,
  signal: AbortSignal,
  exporting = false,
) => {
  if (codec.format !== 'jpegxl') return { signal }
  const metadata = await codec.metadata(new MemorySource(data), defaultImageLimits, { signal })
  const color = metadata.colorSemantics
  return color?.transfer.kind === 'pq' || color?.transfer.kind === 'hlg'
    ? { signal, hdrOutput: 'tone-map-srgb' as const, alphaOutput: 'straight' as const }
    : {
        signal,
        alphaOutput: 'straight' as const,
        ...(color?.primaries !== 'srgb' || (exporting && color?.transfer.kind !== 'srgb')
          ? { colorOutput: 'srgb' as const }
          : {}),
      }
}

const preview = async (
  codec: ImageCodec,
  data: Uint8Array,
  signal: AbortSignal,
): Promise<JpegXlWorkbenchPreview> => {
  const decoder = await codec.createDecoder?.(
    new MemorySource(data),
    defaultImageLimits,
    await displayOptions(codec, data, signal),
  )
  if (!decoder) throw new Error(`${codec.format} decoder is unavailable`)
  if (encoderPixelFormat(decoder.pixelFormat)) {
    planJpegXlWorkbenchNativeMemory(decoder.width, decoder.height, decoder.pixelFormat)
  }
  const plan = planJpegXlWorkbenchPreview(decoder.width, decoder.height)
  const rgba = new Uint8ClampedArray(plan.width * plan.height * 4)
  const mode =
    decoder.colorSemantics === undefined && codec.format === 'jpeg'
      ? 'srgb'
      : jpegXlWorkbenchPreviewMode(decoder.colorSemantics)
  const blocks = decoder.decode({ signal })
  const iterator = blocks[Symbol.asyncIterator]()
  try {
    while (true) {
      throwIfAborted(signal)
      const next = await iterator.next()
      if (next.done) break
      const block = next.value
      try {
        if (!isJpegXlWorkbenchPreviewPixelFormat(block.format)) {
          throw new Error(`Workbench preview does not support ${block.format}`)
        }
        const ranges = jpegXlWorkbenchPreviewRanges(block)
        const sampleView = block.format.endsWith('f32')
          ? new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
          : undefined
        for (let y = 0; y < plan.height; y += 1) {
          const sourceY = Math.min(
            decoder.height - 1,
            Math.floor(((y + 0.5) * decoder.height) / plan.height),
          )
          if (sourceY < block.y || sourceY >= block.y + block.height) continue
          throwIfAborted(signal)
          for (let x = 0; x < plan.width; x += 1) {
            const sourceX = Math.min(
              decoder.width - 1,
              Math.floor(((x + 0.5) * decoder.width) / plan.width),
            )
            if (sourceX < block.x || sourceX >= block.x + block.width) continue
            const target = (y * plan.width + x) * 4
            const pixel = jpegXlWorkbenchPreviewPixel(
              block,
              sourceX,
              sourceY,
              mode,
              ranges,
              sampleView,
            )
            rgba[target] = pixel[0]
            rgba[target + 1] = pixel[1]
            rgba[target + 2] = pixel[2]
            rgba[target + 3] = pixel[3]
          }
        }
      } finally {
        block.release?.()
      }
    }
  } finally {
    await iterator.return?.(undefined)
  }
  return Object.freeze({ ...plan, rgba: copyBuffer(rgba) })
}

const post = (response: JpegXlWorkbenchResponse, transfer: Transferable[] = []): void => {
  self.postMessage(response, { transfer })
}

const isCurrent = (generation: number, requestId: number, abort: AbortController): boolean =>
  activeAbort === abort &&
  activeGeneration === generation &&
  activeRequestId === requestId &&
  !abort.signal.aborted

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isJpegXlWorkbenchRequest(event.data)) return
  const request = event.data
  if (
    request.generation < activeGeneration ||
    (request.generation === activeGeneration && request.requestId <= activeRequestId)
  ) {
    return
  }
  activeGeneration = request.generation
  activeRequestId = request.requestId
  if (request.type === 'cancel') {
    activeAbort?.abort(new DOMException('JPEG XL workbench operation cancelled', 'AbortError'))
    activeAbort = undefined
    return
  }
  activeAbort?.abort(new DOMException('Superseded by a newer JPEG XL request', 'AbortError'))
  const abort = new AbortController()
  activeAbort = abort
  if (request.type === 'open') {
    stored = undefined
    generatedJpegXl = undefined
  }
  void (async () => {
    try {
      if (request.type === 'open') {
        const bytes = new Uint8Array(request.bytes)
        const selected = inputCodec(bytes)
        const { kind, codec } = selected
        const rendered = await preview(codec, bytes, abort.signal)
        const details =
          kind === 'jpeg'
            ? {
                eligibility: await inspectJpegReconstructionEligibility(bytes, {
                  signal: abort.signal,
                }),
              }
            : kind === 'jpegxl'
              ? { inspection: await inspectJpegXl(bytes, { signal: abort.signal }) }
              : await (async () => {
                  const decoder = await codec.createDecoder?.(
                    new MemorySource(bytes),
                    defaultImageLimits,
                    { signal: abort.signal },
                  )
                  if (!decoder) throw new Error(`${codec.format} decoder is unavailable`)
                  if (!encoderPixelFormat(decoder.pixelFormat)) {
                    throw new Error(
                      `Pixel-lossless JPEG XL encode does not support ${decoder.pixelFormat}`,
                    )
                  }
                  const semantics = decoder.colorSemantics
                  return {
                    pixelSource: Object.freeze({
                      container: kind === 'png' ? ('PNG' as const) : ('TIFF' as const),
                      pixelFormat: decoder.pixelFormat,
                      color: semantics
                        ? `${semantics.family}; ${semantics.primaries}; ${semantics.transfer.kind}; ${semantics.range} range`
                        : 'Decoder did not report explicit color semantics',
                      alpha: decoder.pixelFormat.startsWith('rgba')
                        ? ('straight' as const)
                        : ('none' as const),
                    }),
                  }
                })()
        if (!isCurrent(request.generation, request.requestId, abort)) return
        stored = Object.freeze({
          generation: request.generation,
          name: request.name,
          kind,
          bytes,
        })
        const response = {
          type: 'opened',
          requestId: request.requestId,
          generation: request.generation,
          name: request.name,
          sourceKind: kind,
          inputBytes: bytes.byteLength,
          ...details,
          preview: rendered,
        } satisfies JpegXlWorkbenchResponse
        post(response, [rendered.rgba])
        return
      }
      const input = stored
      if (!input || input.generation !== request.generation) {
        throw new Error('Open a JPEG, JPEG XL, PNG, or TIFF file first')
      }
      if (request.type === 'transform') {
        const selected = inputCodec(input.bytes)
        const library = createImageLibrary([jpegxlCodec, pngCodec, jpegCodec, tiffCodec])
        const openOptions = await displayOptions(selected.codec, input.bytes, abort.signal, true)
        let image = (await library.open(input.bytes, openOptions)).autoOrient()
        const metadata = await image.metadata()
        if ((metadata.bitDepth ?? 8) > 8) {
          image = image.convertPixelFormat({ format: metadata.hasAlpha ? 'rgba8' : 'rgb8' })
        }
        image = image.resize({ width: request.width, height: request.height, fit: request.fit })
        const encoded = await (request.format === 'png' ? image.png() : image.jpeg()).toUint8Array({
          signal: abort.signal,
        })
        if (encoded.length > jpegXlWorkbenchMaximumOutputBytes)
          throw new Error('Transformed output exceeds the workbench byte limit')
        const rendered = await preview(
          request.format === 'png' ? pngCodec : jpegCodec,
          encoded,
          abort.signal,
        )
        if (!isCurrent(request.generation, request.requestId, abort)) return
        const bytes = copyBuffer(encoded)
        post(
          {
            type: 'output',
            action: 'transform',
            requestId: request.requestId,
            generation: request.generation,
            name: `${input.name.replace(/\.[^.]+$/u, '')}-resized.${request.format === 'jpeg' ? 'jpg' : 'png'}`,
            bytes,
            preview: rendered,
          },
          [bytes, rendered.rgba],
        )
        return
      }
      if (request.type === 'encode') {
        if (input.kind !== 'png' && input.kind !== 'tiff') {
          throw new Error('Pixel-lossless encode requires a supported PNG or TIFF input')
        }
        const codec = input.kind === 'png' ? pngCodec : tiffCodec
        const source = await nativePixels(codec, input.bytes, abort.signal)
        const semantics = source.decoder.colorSemantics
        if (!semantics || jpegxlCodec.acceptsColorSemantics?.(semantics) !== true) {
          throw new Error(
            'Pixel-lossless JPEG XL encode does not support the source color semantics',
          )
        }
        const sink = new Uint8ArraySink()
        const encoder = await jpegxlCodec.createEncoder?.(sink, {
          width: source.width,
          height: source.height,
          pixelFormat: source.format,
          colorSemantics: semantics,
          options: { mode: 'lossless', effort: 1, container: true },
          limits: defaultImageLimits,
          signal: abort.signal,
        })
        if (!encoder) throw new Error('JPEG XL encoder is unavailable')
        await encoder.write({
          x: 0,
          y: 0,
          width: source.width,
          height: source.height,
          stride:
            source.width * channelCount(source.format) * (source.format.endsWith('16') ? 2 : 1),
          format: source.format,
          data: source.pixels,
        })
        await encoder.finish()
        const encoded = sink.toUint8Array()
        if (encoded.byteLength > jpegXlWorkbenchMaximumOutputBytes) {
          throw new Error('JPEG XL output exceeds the workbench byte limit')
        }
        const reopened = await nativePixels(jpegxlCodec, encoded, abort.signal)
        if (reopened.format !== source.format || !sameBytes(reopened.pixels, source.pixels)) {
          throw new Error('JPEG XL byte-exact local round trip changed decoded samples')
        }
        const rendered = await preview(jpegxlCodec, encoded, abort.signal)
        const inspection = await inspectJpegXl(encoded, { signal: abort.signal })
        if (!isCurrent(request.generation, request.requestId, abort)) return
        generatedJpegXl = Object.freeze({
          generation: request.generation,
          bytes: encoded.slice(),
        })
        const bytes = copyBuffer(encoded)
        const response = {
          type: 'output',
          requestId: request.requestId,
          generation: request.generation,
          action: 'encode',
          name: `${input.name.replace(/\.[^.]+$/u, '')}.jxl`,
          bytes,
          preview: rendered,
          inspection,
          encode: Object.freeze({
            status: 'Experimental',
            sourcePixelFormat: source.format,
            decodedPixelFormat: reopened.format,
            exactDecodedSamples: true,
            inputBytes: input.bytes.byteLength,
            outputBytes: encoded.byteLength,
            sizeDifferenceBytes: encoded.byteLength - input.bytes.byteLength,
            outputToInputRatio: encoded.byteLength / input.bytes.byteLength,
          }),
        } satisfies JpegXlWorkbenchResponse
        post(response, [bytes, rendered.rgba])
        return
      }
      if (request.type === 'transcode') {
        if (input.kind !== 'jpeg') throw new Error('Exact transcode requires a JPEG input')
        const session = createEvidenceSession({ mode: 'summary' })
        try {
          const result = await transcodeJpegToJpegXl(input.bytes, {
            reconstruction: 'required',
            onlyIfSmaller: request.onlyIfSmaller,
            signal: abort.signal,
            evidence: session.context,
          })
          if (result.data.byteLength > jpegXlWorkbenchMaximumOutputBytes) {
            throw new Error('JPEG XL output exceeds the workbench byte limit')
          }
          const rendered = await preview(jpegxlCodec, result.data, abort.signal)
          const inspection = await inspectJpegXl(result.data, { signal: abort.signal })
          if (!isCurrent(request.generation, request.requestId, abort)) return
          generatedJpegXl = Object.freeze({
            generation: request.generation,
            bytes: result.data.slice(),
          })
          const report = session.finalize()
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
            elapsedMilliseconds: result.elapsedMilliseconds,
            libjxlReferenceBytes: await libjxlReferenceBytes(input.bytes),
          })
          const response = {
            type: 'output',
            requestId: request.requestId,
            generation: request.generation,
            action: 'transcode',
            name: `${input.name.replace(/\.[^.]+$/u, '')}.jxl`,
            bytes,
            preview: rendered,
            inspection,
            transcode,
            evidence: report,
          } satisfies JpegXlWorkbenchResponse
          post(response, [bytes, rendered.rgba])
        } catch (cause) {
          session.finalize(abort.signal.aborted ? 'cancelled' : 'failed')
          throw cause
        }
        return
      }
      const generated = generatedJpegXl
      const source =
        input.kind === 'jpegxl'
          ? input.bytes
          : generated?.generation === request.generation
            ? generated.bytes
            : undefined
      if (!source) throw new Error('Transcode the JPEG before reconstruction')
      const jpeg = await reconstructJpegFromJpegXl(source, { signal: abort.signal })
      if (jpeg.byteLength > jpegXlWorkbenchMaximumOutputBytes) {
        throw new Error('Reconstructed JPEG exceeds the workbench byte limit')
      }
      const rendered = await preview(jpegCodec, jpeg, abort.signal)
      if (!isCurrent(request.generation, request.requestId, abort)) return
      const bytes = copyBuffer(jpeg)
      const response = {
        type: 'output',
        requestId: request.requestId,
        generation: request.generation,
        action: 'reconstruct',
        name: `${input.name.replace(/\.[^.]+$/u, '')}-reconstructed.jpg`,
        bytes,
        preview: rendered,
      } satisfies JpegXlWorkbenchResponse
      post(response, [bytes, rendered.rgba])
    } catch (cause) {
      const cancelled = abort.signal.aborted
      if (activeGeneration === request.generation && activeRequestId === request.requestId) {
        post({
          type: 'error',
          requestId: request.requestId,
          generation: request.generation,
          message: cancelled
            ? 'Operation cancelled.'
            : cause instanceof Error
              ? cause.message
              : 'JPEG XL workbench failed',
          cancelled,
        })
      }
    } finally {
      if (activeAbort === abort) activeAbort = undefined
    }
  })()
})
