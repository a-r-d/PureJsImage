import type { DecodeRequest, DecoderOptions, ImageDecoder } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import { type PixelBlock, resumePixelBlocks } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import type { JpegAcceleration } from './jpeg.ts'
import {
  type BaselineJpeg,
  decodeBaselineJpeg,
  decodeProgressiveJpeg,
  type JpegCoefficientRenderImage,
  type JpegRegion,
  parseBaselineJpegSource,
  parseCoefficientJpegSource,
} from './jpeg-baseline.ts'

const region = (width: number, height: number, request: DecodeRequest = {}): JpegRegion => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const outputWidth = request.width ?? width - x
  const outputHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    x < 0 ||
    y < 0 ||
    outputWidth < 1 ||
    outputHeight < 1
  ) {
    throw invalidInput('JPEG decode region is invalid')
  }
  if (x + outputWidth > width || y + outputHeight > height) {
    throw invalidInput(
      `Decode region ${x},${y} ${outputWidth}x${outputHeight} exceeds ${width}x${height}`,
    )
  }
  return { x, y, width: outputWidth, height: outputHeight }
}

const scaleDenominator = (request: DecodeRequest): 1 | 2 | 4 | 8 => {
  const scale = request.scaleDenominator ?? 1
  if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) {
    throw invalidInput('JPEG decode scale denominator must be 1, 2, 4, or 8')
  }
  return scale
}

async function* acceleratedRows(
  accelerated: AsyncIterable<PixelBlock>,
  reference: AsyncIterable<PixelBlock>,
): AsyncGenerator<PixelBlock> {
  const iterator = accelerated[Symbol.asyncIterator]()
  let emitted = 0
  try {
    while (true) {
      let result: IteratorResult<PixelBlock>
      try {
        result = await iterator.next()
      } catch {
        break
      }
      if (result.done) return
      emitted = Math.max(emitted, result.value.y + result.value.height)
      yield result.value
    }
  } finally {
    try {
      await iterator.return?.()
    } catch {}
  }
  yield* resumePixelBlocks(reference, emitted)
}

class JpegDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgb8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: true,
    progressive: false,
  })
  readonly #jpeg: BaselineJpeg
  readonly #accelerations: readonly JpegAcceleration[]
  readonly #tolerantDecoding: boolean

  constructor(
    jpeg: BaselineJpeg,
    accelerations: readonly JpegAcceleration[],
    tolerantDecoding: boolean,
  ) {
    this.width = jpeg.width
    this.height = jpeg.height
    this.#jpeg = jpeg
    this.#accelerations = accelerations
    this.#tolerantDecoding = tolerantDecoding
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const scale = scaleDenominator(request)
    const output = region(Math.ceil(this.width / scale), Math.ceil(this.height / scale), request)
    for (const acceleration of this.#accelerations) {
      if (!acceleration.decode) continue
      let accelerated: AsyncIterable<PixelBlock> | undefined
      try {
        accelerated = await acceleration.decode({
          jpeg: this.#jpeg,
          region: output,
          scaleDenominator: scale,
          tolerantDecoding: this.#tolerantDecoding,
        })
      } catch {
        continue
      }
      if (!accelerated) continue

      yield* acceleratedRows(
        accelerated,
        decodeBaselineJpeg(this.#jpeg, output, scale, undefined, this.#tolerantDecoding),
      )
      return
    }
    yield* decodeBaselineJpeg(this.#jpeg, output, scale, undefined, this.#tolerantDecoding)
  }
}

class ProgressiveJpegDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgb8' as const
  readonly capabilities: ImageDecoder['capabilities']
  readonly #jpeg: JpegCoefficientRenderImage

  readonly #acceleration: JpegAcceleration | undefined

  constructor(
    jpeg: JpegCoefficientRenderImage,
    progressive: boolean,
    acceleration?: JpegAcceleration,
  ) {
    this.width = jpeg.width
    this.height = jpeg.height
    this.#jpeg = jpeg
    this.#acceleration = acceleration
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: false,
      scaledDecode: true,
      progressive,
    })
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const scale = scaleDenominator(request)
    const output = region(Math.ceil(this.width / scale), Math.ceil(this.height / scale), request)
    const reference = decodeProgressiveJpeg(this.#jpeg, output, scale)
    if (this.#acceleration?.renderCoefficients) {
      let blocks: AsyncIterable<PixelBlock> | undefined
      try {
        blocks = await this.#acceleration.renderCoefficients({
          jpeg: this.#jpeg,
          region: output,
          scaleDenominator: scale,
        })
      } catch {}
      if (blocks) {
        yield* acceleratedRows(blocks, reference)
        return
      }
    }
    yield* reference
  }
}

export const createJpegDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  accelerations: readonly JpegAcceleration[] = [],
): Promise<ImageDecoder> => {
  const applyIcc = options.preserveIcc !== true
  const baseline = await parseBaselineJpegSource(source, applyIcc)
  if (baseline) {
    validateImageDimensions(baseline.width, baseline.height, 1, limits)
    return new JpegDecoder(baseline, accelerations, options.tolerantDecoding === true)
  }
  for (const acceleration of accelerations) {
    if (!acceleration.progressiveCoefficients) continue
    try {
      const image = await acceleration.progressiveCoefficients(source, limits, options)
      if (image) {
        validateImageDimensions(image.width, image.height, 1, limits)
        return new ProgressiveJpegDecoder(image, true, acceleration)
      }
    } catch {
      // No rows have been emitted. The reference parser owns error reporting.
    }
  }
  const progressive = await parseCoefficientJpegSource(
    source,
    (width, height) => {
      validateImageDimensions(width, height, 1, limits)
    },
    applyIcc,
    limits.maxDecodedBytes,
    options.tolerantDecoding === true,
  )
  if (!progressive) throw invalidInput('JPEG coding process is unsupported')
  return new ProgressiveJpegDecoder(progressive, progressive.progressive)
}
