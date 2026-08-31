import { createEvidenceSession, instrumentImageSource } from '../../../src/evidence.ts'
import {
  openGainMapImage,
  type GainMapImageInspection,
  type GainMapJpegMetadataMode,
  type GainMapTransformOperation,
  type OpenedGainMapImage,
} from '../../../src/hdr/index.ts'
import { MemorySource } from '../../../src/source.ts'
import { isHdrSurgeryRequest, type HdrSurgeryResponse } from './hdr-surgery-types.ts'

interface StoredImage {
  readonly name: string
  readonly bytes: Uint8Array
}

interface RenderedImage {
  readonly inspection: GainMapImageInspection
  readonly basePreviewRgba: Uint8ClampedArray
  readonly gainPreviewRgba: Uint8ClampedArray
  readonly linearRgb: Float32Array
  readonly previewRgba: Uint8ClampedArray
  readonly falseColorRgba: Uint8ClampedArray
  readonly report: ReturnType<ReturnType<typeof createEvidenceSession>['finalize']>
}

let stored: StoredImage | undefined
let activeAbort: AbortController | undefined
let activeGeneration = -1
let activeRequestId = -1

const post = (message: HdrSurgeryResponse, transfer: Transferable[] = []): void => {
  self.postMessage(message, { transfer })
}

const copyBuffer = (view: ArrayBufferView): ArrayBuffer => {
  const output = new ArrayBuffer(view.byteLength)
  new Uint8Array(output).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  return output
}

const srgb = (linear: number): number => {
  const mapped = Math.max(0, linear) / (1 + Math.max(0, linear))
  const encoded = mapped <= 0.0031308 ? mapped * 12.92 : 1.055 * mapped ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(encoded * 255)))
}

const falseColor = (value: number): readonly [number, number, number] => {
  const normalized = Math.max(0, Math.min(1, Math.log2(1 + Math.max(0, value)) / 4))
  const red = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * normalized - 3)))
  const green = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * normalized - 2)))
  const blue = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * normalized - 1)))
  return [Math.round(red * 255), Math.round(green * 255), Math.round(blue * 255)]
}

const componentRgba = (data: Uint8Array, channels: 1 | 3 | 4): Uint8ClampedArray => {
  const pixels = data.byteLength / channels
  const output = new Uint8ClampedArray(pixels * 4)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const source = pixel * channels
    const target = pixel * 4
    const red = data[source] ?? 0
    output[target] = red
    output[target + 1] = channels === 1 ? red : (data[source + 1] ?? 0)
    output[target + 2] = channels === 1 ? red : (data[source + 2] ?? 0)
    output[target + 3] = channels === 4 ? (data[source + 3] ?? 0) : 255
  }
  return output
}

const renderStored = async (
  displayBoost: number,
  operations: readonly GainMapTransformOperation[],
  signal: AbortSignal,
): Promise<RenderedImage> => {
  if (!stored) throw new Error('Open an HDR JPEG before rendering')
  const session = createEvidenceSession({
    mode: 'summary',
    limits: { maxEvents: 256, maxSerializedBytes: 256 * 1024, maxSourceRanges: 128 },
  })
  const source = instrumentImageSource(
    new MemorySource(stored.bytes),
    session.context.child('hdr-surgery-source'),
  )
  const opened = await openGainMapImage(source, { signal, evidence: session.context })
  const image = transformedImage(opened, operations)
  try {
    const inspection = image.inspection()
    const pixels =
      inspection.metadata.baseDimensions.width * inspection.metadata.baseDimensions.height
    if (pixels > 4_194_304) {
      throw new Error('Browser preview is limited to 4,194,304 pixels; crop or resize first')
    }
    const linearRgb = new Float32Array(pixels * 3)
    for await (const block of image.render({ displayBoost, signal })) {
      try {
        if (block.pixelFormat === 'rgbf32') {
          linearRgb.set(block.data, block.y * block.width * 3)
        } else {
          for (let pixel = 0; pixel < block.width * block.height; pixel += 1) {
            const sourceOffset = pixel * 4
            const targetOffset = block.y * block.width * 3 + pixel * 3
            linearRgb[targetOffset] = block.data[sourceOffset] ?? 0
            linearRgb[targetOffset + 1] = block.data[sourceOffset + 1] ?? 0
            linearRgb[targetOffset + 2] = block.data[sourceOffset + 2] ?? 0
          }
        }
      } finally {
        block.release?.()
      }
    }
    const previewRgba = new Uint8ClampedArray(pixels * 4)
    const falseColorRgba = new Uint8ClampedArray(pixels * 4)
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const sourceOffset = pixel * 3
      const targetOffset = pixel * 4
      const red = linearRgb[sourceOffset] ?? 0
      const green = linearRgb[sourceOffset + 1] ?? 0
      const blue = linearRgb[sourceOffset + 2] ?? 0
      previewRgba[targetOffset] = srgb(red)
      previewRgba[targetOffset + 1] = srgb(green)
      previewRgba[targetOffset + 2] = srgb(blue)
      previewRgba[targetOffset + 3] = 255
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
      const [falseRed, falseGreen, falseBlue] = falseColor(luminance)
      falseColorRgba[targetOffset] = falseRed
      falseColorRgba[targetOffset + 1] = falseGreen
      falseColorRgba[targetOffset + 2] = falseBlue
      falseColorRgba[targetOffset + 3] = 255
    }
    const components = await image.previewTransformedComponents({ signal })
    return {
      inspection,
      basePreviewRgba: componentRgba(components.base.data, components.base.channels),
      gainPreviewRgba: componentRgba(components.gainMap.data, components.gainMap.channels),
      linearRgb,
      previewRgba,
      falseColorRgba,
      report: session.finalize(),
    }
  } catch (error) {
    session.finalize(signal.aborted ? 'cancelled' : 'failed')
    throw error
  } finally {
    opened.close()
  }
}

const transformedImage = (
  opened: OpenedGainMapImage,
  operations: readonly GainMapTransformOperation[],
): OpenedGainMapImage => {
  let image = opened
  for (const operation of operations) {
    if (operation.type === 'auto-orient') image = image.autoOrient()
    else if (operation.type === 'crop') image = image.crop(operation)
    else if (operation.type === 'flip-horizontal') image = image.flipHorizontal()
    else if (operation.type === 'flip-vertical') image = image.flipVertical()
    else if (operation.type === 'rotate') image = image.rotate(operation.degrees)
    else image = image.resize(operation)
  }
  return image
}

const repackStored = async (
  metadataMode: GainMapJpegMetadataMode,
  operations: readonly GainMapTransformOperation[],
  baseQuality: number,
  gainMapQuality: number,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  if (!stored) throw new Error('Open an HDR JPEG before generating output')
  const opened = await openGainMapImage(stored.bytes, { signal })
  try {
    const output = await transformedImage(opened, operations).jpeg({
      metadataMode,
      baseQuality,
      gainMapQuality,
      signal,
    })
    const reopened = await openGainMapImage(output, { signal })
    reopened.close()
    return output
  } finally {
    opened.close()
  }
}

const avifStored = async (
  operations: readonly GainMapTransformOperation[],
  signal: AbortSignal,
): Promise<Uint8Array> => {
  if (!stored) throw new Error('Open an HDR JPEG before generating output')
  const opened = await openGainMapImage(stored.bytes, { signal })
  try {
    return transformedImage(opened, operations).avif({ signal })
  } finally {
    opened.close()
  }
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isHdrSurgeryRequest(event.data)) return
  const request = event.data
  if (
    request.generation < activeGeneration ||
    (request.generation === activeGeneration && request.requestId < activeRequestId)
  ) {
    return
  }
  activeGeneration = request.generation
  activeRequestId = request.requestId
  if (request.type === 'cancel') {
    activeAbort?.abort(new DOMException('HDR Surgery cancelled', 'AbortError'))
    return
  }
  activeAbort?.abort(new DOMException('Superseded by a newer HDR Surgery request', 'AbortError'))
  const abort = new AbortController()
  activeAbort = abort
  void (async () => {
    try {
      if (request.type === 'open') {
        stored = Object.freeze({ name: request.name, bytes: new Uint8Array(request.bytes) })
        const rendered = await renderStored(request.displayBoost, request.operations, abort.signal)
        const response = {
          type: 'result',
          requestId: request.requestId,
          generation: request.generation,
          name: request.name,
          inspection: rendered.inspection,
          basePreviewRgba: copyBuffer(rendered.basePreviewRgba),
          gainPreviewRgba: copyBuffer(rendered.gainPreviewRgba),
          linearRgb: copyBuffer(rendered.linearRgb),
          previewRgba: copyBuffer(rendered.previewRgba),
          falseColorRgba: copyBuffer(rendered.falseColorRgba),
          report: rendered.report,
        } satisfies HdrSurgeryResponse
        post(response, [
          response.basePreviewRgba,
          response.gainPreviewRgba,
          response.linearRgb,
          response.previewRgba,
          response.falseColorRgba,
        ])
        return
      }
      if (request.type === 'render') {
        const rendered = await renderStored(request.displayBoost, request.operations, abort.signal)
        const response = {
          type: 'rendered',
          requestId: request.requestId,
          generation: request.generation,
          linearRgb: copyBuffer(rendered.linearRgb),
          previewRgba: copyBuffer(rendered.previewRgba),
          falseColorRgba: copyBuffer(rendered.falseColorRgba),
          report: rendered.report,
          inspection: rendered.inspection,
          basePreviewRgba: copyBuffer(rendered.basePreviewRgba),
          gainPreviewRgba: copyBuffer(rendered.gainPreviewRgba),
        } satisfies HdrSurgeryResponse
        post(response, [
          response.linearRgb,
          response.previewRgba,
          response.falseColorRgba,
          response.basePreviewRgba,
          response.gainPreviewRgba,
        ])
        return
      }
      if (request.type === 'avif') {
        const output = await avifStored(request.operations, abort.signal)
        const bytes = copyBuffer(output)
        post(
          {
            type: 'avif',
            requestId: request.requestId,
            generation: request.generation,
            bytes,
          },
          [bytes],
        )
        return
      }
      const output = await repackStored(
        request.metadataMode,
        request.operations,
        request.baseQuality,
        request.gainMapQuality,
        abort.signal,
      )
      const bytes = copyBuffer(output)
      post(
        {
          type: 'repacked',
          requestId: request.requestId,
          generation: request.generation,
          bytes,
          metadataMode: request.metadataMode,
        },
        [bytes],
      )
    } catch (cause) {
      const cancelled = abort.signal.aborted
      post({
        type: 'error',
        requestId: request.requestId,
        generation: request.generation,
        message: cancelled
          ? 'Operation cancelled.'
          : cause instanceof Error
            ? cause.message
            : String(cause),
        cancelled,
      })
    } finally {
      if (activeAbort === abort) activeAbort = undefined
    }
  })()
})
