import type { DecodeRequest, ImageDecoder } from '../codec.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import { type ImageLimitOptions, resolveLimits, validateInputSize } from '../limits.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import {
  type Jp2ChannelMapping,
  type Jp2ChannelDefinition,
  type Jp2Header,
  displayLayout,
} from './jpeg2000-metadata.ts'
import { parseCodestream, type ParsedCodestream } from './jpeg2000-packets.ts'

interface Jpeg2000Description {
  readonly container: Jp2Header
  readonly codestream: Uint8Array
  readonly parsed: ParsedCodestream
}

const decodeRegion = (
  width: number,
  height: number,
  request: DecodeRequest,
): { x: number; y: number; width: number; height: number } => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const regionWidth = request.width ?? width - x
  const regionHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(regionWidth) ||
    !Number.isSafeInteger(regionHeight) ||
    x < 0 ||
    y < 0 ||
    regionWidth < 1 ||
    regionHeight < 1 ||
    x + regionWidth > width ||
    y + regionHeight > height
  ) {
    throw invalidInput('JPEG 2000 decode region is invalid')
  }
  return { x, y, width: regionWidth, height: regionHeight }
}

export class Jpeg2000Decoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: true,
    progressive: false,
  })
  readonly #description: Jpeg2000Description

  constructor(description: Jpeg2000Description) {
    this.#description = description
    this.width = description.container.width
    this.height = description.container.height
    this.pixelFormat = displayLayout(description.container).format
  }

  decode(request: DecodeRequest = {}): AsyncIterable<PixelBlock> {
    const scale = request.scaleDenominator ?? 1
    if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) {
      throw invalidInput('JPEG 2000 decode scale denominator must be 1, 2, 4, or 8')
    }
    const scaledWidth = Math.ceil(this.width / scale)
    const scaledHeight = Math.ceil(this.height / scale)
    const region = decodeRegion(scaledWidth, scaledHeight, request)
    return this.#decodeRegion(region, scale)
  }

  async *#decodeRegion(
    region: ReturnType<typeof decodeRegion>,
    scale: 1 | 2 | 4 | 8,
  ): AsyncGenerator<PixelBlock> {
    const { reconstructPixelBlocks } = await import('./jpeg2000-decode.ts')
    yield* reconstructPixelBlocks(
      this.#description.codestream,
      this.#description.parsed,
      this.#description.container,
      region,
      scale,
    )
  }
}

export type Jpeg2000CodestreamColorSpace = 'gray' | 'rgb' | 'ycbcr'

export type Jpeg2000CodestreamOptions = ImageLimitOptions & {
  readonly colorSpace?: Jpeg2000CodestreamColorSpace
}

export const createJpeg2000CodestreamDecoder = (
  codestream: Uint8Array,
  options: Readonly<Jpeg2000CodestreamOptions> = {},
): ImageDecoder => {
  const limits = resolveLimits(options)
  validateInputSize(codestream.byteLength, limits)
  const parsed = parseCodestream(codestream, limits)
  const width = parsed.size.xSize - parsed.size.xOrigin
  const height = parsed.size.ySize - parsed.size.yOrigin
  const components = parsed.size.components
  const requestedColorSpace = options.colorSpace ?? (components.length === 1 ? 'gray' : 'rgb')
  if (
    (requestedColorSpace === 'gray' && components.length !== 1) ||
    (requestedColorSpace !== 'gray' && components.length !== 3)
  ) {
    throw unsupportedOperation(
      `JPEG 2000 ${requestedColorSpace} decoding does not support ${components.length} components`,
    )
  }
  const container: Jp2Header = {
    width,
    height,
    components: components.length,
    bitDepths: Object.freeze(components.map((component) => component.precision)),
    signed: Object.freeze(components.map((component) => component.signed)),
    colorSpace:
      requestedColorSpace === 'gray' ? 'gray' : requestedColorSpace === 'ycbcr' ? 'sycc' : 'srgb',
    channelMappings: Object.freeze(
      components.map((_, component): Jp2ChannelMapping => ({ component })),
    ),
    channelDefinitions: Object.freeze(
      Array.from(
        { length: requestedColorSpace === 'gray' ? 1 : 3 },
        (_, channel): Jp2ChannelDefinition => ({ channel, type: 0, association: channel + 1 }),
      ),
    ),
    codestreamOffset: 0,
    codestreamLength: codestream.byteLength,
  }
  return new Jpeg2000Decoder({ container, codestream, parsed })
}
