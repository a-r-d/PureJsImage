import type { DecoderOptions, DecodeRequest, ImageDecoder } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import { type PixelBlock, resumePixelBlocks } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import {
  type BaselineJpeg,
  decodeBaselineJpeg,
  decodeProgressiveJpeg,
  type JpegRegion,
  type ProgressiveJpeg,
  parseBaselineJpegSource,
  parseCoefficientJpegSource,
} from './jpeg-baseline.ts'
import type { JpegAcceleration } from './jpeg.ts'

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

      const iterator = accelerated[Symbol.asyncIterator]()
      let firstOutputRow = 0
      while (true) {
        let result: IteratorResult<PixelBlock>
        try {
          result = await iterator.next()
        } catch {
          try {
            await iterator.return?.()
          } catch {}
          yield* resumePixelBlocks(
            decodeBaselineJpeg(this.#jpeg, output, scale, undefined, this.#tolerantDecoding),
            firstOutputRow,
          )
          return
        }
        if (result.done) return
        const block = result.value
        firstOutputRow = Math.max(firstOutputRow, block.y + block.height)
        yield block
      }
    }
    yield* decodeBaselineJpeg(this.#jpeg, output, scale, undefined, this.#tolerantDecoding)
  }
}

class ProgressiveJpegDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgb8' as const
  readonly capabilities: ImageDecoder['capabilities']
  readonly #jpeg: ProgressiveJpeg

  constructor(jpeg: ProgressiveJpeg) {
    this.width = jpeg.width
    this.height = jpeg.height
    this.#jpeg = jpeg
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: false,
      scaledDecode: true,
      progressive: jpeg.progressive,
    })
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const scale = scaleDenominator(request)
    const output = region(Math.ceil(this.width / scale), Math.ceil(this.height / scale), request)
    yield* decodeProgressiveJpeg(this.#jpeg, output, scale)
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
  return new ProgressiveJpegDecoder(progressive)
}
