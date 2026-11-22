import type { EncodeRequest, ImageCodec, ImageEncoder } from '../../src/codec.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { jpegXlContainerSignature } from '../../src/codecs/jpegxl-container.ts'
import {
  JpegXlEncoderMemory,
  jpegXlPartsByteLength,
} from '../../src/codecs/jpegxl-encoder-memory.ts'
import { resolveJpegXlEncodeOptions } from '../../src/codecs/jpegxl-modular-encode.ts'
import {
  encodeJpegXlVarDct8Async,
  jpegXlVarDctColorBits,
} from '../../src/codecs/jpegxl-vardct-encode.ts'
import { defaultImageLimits, type ImageLimits } from '../../src/limits.ts'
import type { PixelBlock } from '../../src/pixel.ts'
import type { ImageSink } from '../../src/sink.ts'

const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0))
const uint32 = (value: number): number[] => [
  value >>> 24,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
]

/**
 * The public lossy encoder sends opaque 8-bit sRGB input through the libjxl policy. This
 * encoder keeps the established VarDCT stream that the public encoder wrote for that input
 * before, so tests of established features keep their pinned bytes. Like the public
 * encoder, it stages pixels in managed memory, keeps the effort-9 rate-distortion
 * alternate when it saves 1% of color bits, and writes the level-5 container when asked.
 * It does not run the public palette, screenshot or document candidates.
 */
class EstablishedJpegXlEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #channels: 3 | 4
  readonly #distance: number
  readonly #effort: 7 | 9
  readonly #container: boolean
  readonly #limits: Readonly<ImageLimits>
  readonly #memory: JpegXlEncoderMemory
  readonly #pixels: Uint8Array
  #rows = 0

  constructor(
    sink: ImageSink,
    request: EncodeRequest,
    channels: 3 | 4,
    distance: number,
    effort: 7 | 9,
    container: boolean,
    maxWorkingBytes: number,
  ) {
    this.#sink = sink
    this.#width = request.width
    this.#height = request.height
    this.#channels = channels
    this.#distance = distance
    this.#effort = effort
    this.#container = container
    this.#limits = request.limits ?? defaultImageLimits
    this.#memory = new JpegXlEncoderMemory(maxWorkingBytes)
    this.#pixels = this.#memory.allocate(Uint8Array, request.width * request.height * channels)
  }

  get managedPeakBytes(): number {
    return this.#memory.peakBytes
  }
  get managedLiveBytes(): number {
    return this.#memory.liveBytes
  }
  get managedLiveAllocations(): number {
    return this.#memory.liveAllocations
  }

  async write(block: PixelBlock): Promise<void> {
    const rowBytes = this.#width * this.#channels
    if (
      block.x !== 0 ||
      block.y !== this.#rows ||
      block.width !== this.#width ||
      block.y + block.height > this.#height ||
      block.format !== (this.#channels === 4 ? 'rgba8' : 'rgb8') ||
      block.stride < rowBytes
    )
      throw new Error('Established JPEG XL encoder requires ordered full-width rows')
    for (let row = 0; row < block.height; row++)
      this.#pixels.set(
        block.data.subarray(row * block.stride, row * block.stride + rowBytes),
        (this.#rows + row) * rowBytes,
      )
    this.#rows += block.height
  }

  async finish(): Promise<void> {
    const memory = this.#memory
    try {
      if (this.#rows !== this.#height) throw new Error('Established JPEG XL rows are missing')
      const encode = (frame: Readonly<{ strategyPolicy?: 'rate-distortion' }>) =>
        encodeJpegXlVarDct8Async(
          this.#pixels,
          this.#width,
          this.#height,
          this.#distance,
          memory,
          async () => {},
          this.#channels,
          this.#effort,
          undefined,
          8,
          false,
          undefined,
          this.#limits,
          frame,
        )
      const parts = await memory.runAsync(async () => {
        const primary = await encode({})
        if (this.#effort !== 9) return primary
        const alternate = await encode({ strategyPolicy: 'rate-distortion' })
        return jpegXlVarDctColorBits(alternate) * 100 <= jpegXlVarDctColorBits(primary) * 99
          ? alternate
          : primary
      })
      memory.release(this.#pixels)
      const length = jpegXlPartsByteLength(parts)
      if (memory.liveBytes !== length) throw new Error('Established JPEG XL scratch remains')
      if (this.#container)
        await this.#sink.write(
          Uint8Array.of(
            ...jpegXlContainerSignature,
            ...uint32(20),
            ...ascii('ftypjxl '),
            ...uint32(0),
            ...ascii('jxl '),
            ...uint32(length + 8),
            ...ascii('jxlc'),
          ),
        )
      for (const part of parts) await this.#sink.write(part)
    } finally {
      memory.close()
    }
  }
}

/** The public JPEG XL codec with an encoder that writes the established opaque sRGB stream. */
export const establishedJpegXlCodec: ImageCodec = {
  ...jpegxlCodec,
  async createEncoder(sink, request) {
    const { pixelFormat, colorSemantics } = request
    if ((pixelFormat !== 'rgb8' && pixelFormat !== 'rgba8') || !colorSemantics)
      throw new Error('The established JPEG XL encoder accepts structured RGB8 or RGBA8 input')
    const options = resolveJpegXlEncodeOptions(
      request.options,
      pixelFormat,
      colorSemantics,
      request.width,
      request.height,
    )
    if (
      options.mode !== 'lossy' ||
      options.progressive ||
      options.sampleBitDepth !== 8 ||
      (options.effort !== 7 && options.effort !== 9) ||
      colorSemantics.primaries !== 'srgb' ||
      colorSemantics.transfer.kind !== 'srgb'
    )
      throw new Error('The established JPEG XL encoder covers non-progressive 8-bit sRGB input')
    return new EstablishedJpegXlEncoder(
      sink,
      request,
      pixelFormat === 'rgba8' ? 4 : 3,
      options.distance,
      options.effort,
      options.container,
      options.maxWorkingBytes ??
        request.limits?.maxDecodedBytes ??
        defaultImageLimits.maxDecodedBytes,
    )
  },
}
