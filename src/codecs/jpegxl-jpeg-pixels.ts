import { throwIfAborted } from '../abort.ts'
import type { DecodeRequest } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type { JpegCoefficientComponent, JpegCoefficientImage } from './jpeg-coefficients.ts'

// JPEG XL reconstructs JPEG component samples without the intermediate 8-bit IDCT clip.
// Keep two block rows per component so chroma interpolation happens before output quantization.
const basis = Float64Array.from({ length: 64 }, (_, index) => {
  const frequency = index >>> 3
  return (
    0.5 *
    (frequency === 0 ? Math.SQRT1_2 : 1) *
    Math.cos(((2 * (index & 7) + 1) * frequency * Math.PI) / 16)
  )
})

class ComponentRows {
  readonly width: number
  readonly height: number
  readonly #image: JpegCoefficientImage
  readonly #channel: number
  readonly #colorMap: Int32Array | undefined
  readonly #component: JpegCoefficientComponent
  readonly #rows: readonly [Float32Array, Float32Array]
  readonly #indices = Int32Array.of(-1, -1)
  readonly #scratch = new Float64Array(64)
  readonly #dequantized = new Float64Array(64)
  constructor(
    component: JpegCoefficientComponent,
    width: number,
    height: number,
    image: JpegCoefficientImage,
    channel: number,
    colorMap?: Int32Array,
  ) {
    this.#image = image
    this.#channel = channel
    this.#colorMap = colorMap
    this.#component = component
    this.width = width
    this.height = height
    this.#rows = [new Float32Array(width * 8), new Float32Array(width * 8)]
  }
  row(y: number): Float32Array {
    const blockY = y >>> 3
    const slot = blockY & 1
    const output = this.#rows[slot]
    if (!output) throw invalidInput('JPEG XL component row storage is missing')
    if (this.#indices[slot] !== blockY) {
      const component = this.#component
      const bias =
        this.#channel === 0
          ? 0.9299455010825141
          : this.#channel === 1
            ? 0.945349926692846
            : 0.9500648966626563
      const dequantized = this.#dequantized
      for (let blockX = 0; blockX < Math.ceil(this.width / 8); blockX += 1) {
        const coefficientOffset = (blockY * component.blocksPerLineForMcu + blockX) * 64
        const luma = this.#image.components[0]
        const local =
          this.#colorMap?.[
            Math.floor(blockY / 8) * Math.ceil(this.#image.width / 64) + Math.floor(blockX / 8)
          ] ?? 0
        for (let i = 0; i < 64; i += 1) {
          const coefficient = component.coefficients[coefficientOffset + i] ?? 0
          const q = component.quantization[i] ?? 1
          let residual = coefficient
          let lumaValue = 0
          if (
            i !== 0 &&
            local !== 0 &&
            luma &&
            component.horizontalSampling === this.#image.maximumHorizontalSampling &&
            component.verticalSampling === this.#image.maximumVerticalSampling
          ) {
            const lumaCoefficient = luma.coefficients[coefficientOffset + i] ?? 0
            const lumaQ = luma.quantization[i] ?? 1
            const coefficientRatio = Math.floor(
              (Math.trunc((2048 * lumaQ) / q) * Math.trunc((local * 2048) / 84) + 1024) / 2048,
            )
            residual -= Math.floor((lumaCoefficient * coefficientRatio + 1024) / 2048)
            const correctedLuma =
              Math.abs(lumaCoefficient) === 1
                ? lumaCoefficient * 0.9299455010825141
                : lumaCoefficient === 0
                  ? 0
                  : lumaCoefficient - 0.145 / lumaCoefficient
            lumaValue = (correctedLuma * lumaQ * local) / 84
          }
          const corrected =
            i === 0
              ? residual
              : Math.abs(residual) === 1
                ? residual * bias
                : residual === 0
                  ? 0
                  : residual - 0.145 / residual
          dequantized[i] = corrected * q + lumaValue
        }
        for (let v = 0; v < 8; v += 1)
          for (let x = 0; x < 8; x += 1) {
            let sum = 0
            for (let u = 0; u < 8; u += 1)
              sum += (dequantized[v * 8 + u] ?? 0) * (basis[u * 8 + x] ?? 0)
            this.#scratch[v * 8 + x] = sum
          }
        for (let y = 0; y < 8; y += 1)
          for (let x = 0; x < 8 && blockX * 8 + x < this.width; x += 1) {
            let sum = 0
            for (let v = 0; v < 8; v += 1)
              sum += (this.#scratch[v * 8 + x] ?? 0) * (basis[v * 8 + y] ?? 0)
            output[y * this.width + blockX * 8 + x] = sum + 128
          }
      }
      this.#indices[slot] = blockY
    }
    return output.subarray((y & 7) * this.width, ((y & 7) + 1) * this.width)
  }
}

export async function* decodeJpegXlJpegPixels(
  image: JpegCoefficientImage,
  request: Readonly<DecodeRequest>,
  colorMaps: readonly [Int32Array, Int32Array],
): AsyncGenerator<PixelBlock> {
  const width = request.width ?? image.width
  const height = request.height ?? image.height
  const originX = request.x ?? 0
  const originY = request.y ?? 0
  const channels = image.components.length === 1 ? 1 : 3
  const outputRows = Array.from({ length: channels }, () => new Float32Array(width))
  const components = image.components.map((component, index) => {
    const scaleX = component.horizontalSampling / image.maximumHorizontalSampling
    const scaleY = component.verticalSampling / image.maximumVerticalSampling
    const rows = new ComponentRows(
      component,
      Math.ceil(image.width * scaleX),
      Math.ceil(image.height * scaleY),
      image,
      index,
      index === 0 ? undefined : colorMaps[index - 1],
    )
    const indices = new Uint32Array(width)
    const right = new Uint32Array(width)
    const fractions = new Float32Array(width)
    for (let x = 0; x < width; x += 1) {
      const coordinate = Math.max(0, Math.min(rows.width - 1, (originX + x + 0.5) * scaleX - 0.5))
      indices[x] = Math.floor(coordinate)
      right[x] = Math.min(rows.width - 1, Math.floor(coordinate) + 1)
      fractions[x] = coordinate - Math.floor(coordinate)
    }
    return { rows, scaleY, indices, right, fractions }
  })
  for (let y = 0; y < height; y += 1) {
    throwIfAborted(request.signal)
    for (let c = 0; c < channels; c += 1) {
      const component = components[c]
      const samples = outputRows[c]
      if (!component || !samples) throw invalidInput('JPEG XL component plane is missing')
      const coordinate = Math.max(
        0,
        Math.min(component.rows.height - 1, (originY + y + 0.5) * component.scaleY - 0.5),
      )
      const topY = Math.floor(coordinate)
      const top = component.rows.row(topY)
      const bottom = component.rows.row(Math.min(component.rows.height - 1, topY + 1))
      const vertical = coordinate - topY
      for (let x = 0; x < width; x += 1) {
        const left = component.indices[x] ?? 0
        const right = component.right[x] ?? 0
        const horizontal = component.fractions[x] ?? 0
        const upper = (top[left] ?? 0) * (1 - horizontal) + (top[right] ?? 0) * horizontal
        const lower = (bottom[left] ?? 0) * (1 - horizontal) + (bottom[right] ?? 0) * horizontal
        samples[x] = upper * (1 - vertical) + lower * vertical
      }
    }
    const data = new Uint8Array(width * channels)
    for (let x = 0; x < width; x += 1) {
      const first = outputRows[0]?.[x] ?? 0
      if (channels === 1) data[x] = Math.max(0, Math.min(255, Math.round(first)))
      else {
        const second = outputRows[1]?.[x] ?? 0
        const third = outputRows[2]?.[x] ?? 0
        const rgb = image.colorTransform === 'rgb'
        data[x * 3] = Math.max(
          0,
          Math.min(255, Math.round(rgb ? first : first + 1.402 * (third - 128))),
        )
        data[x * 3 + 1] = Math.max(
          0,
          Math.min(
            255,
            Math.round(
              rgb ? second : first - 0.344136286 * (second - 128) - 0.714136286 * (third - 128),
            ),
          ),
        )
        data[x * 3 + 2] = Math.max(
          0,
          Math.min(255, Math.round(rgb ? third : first + 1.772 * (second - 128))),
        )
      }
    }
    yield {
      x: 0,
      y,
      width,
      height: 1,
      stride: data.length,
      format: channels === 1 ? 'gray8' : 'rgb8',
      data,
    }
  }
}
