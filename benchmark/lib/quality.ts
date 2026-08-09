import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { calculateResizeDimensions } from '../../src/pipeline.ts'
import type { PipelineWorkflow, QualityPsnr } from '../types.ts'

interface RgbaImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

const isPng = (bytes: Uint8Array): boolean =>
  bytes.length >= 8 &&
  bytes[0] === 0x89 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x4e &&
  bytes[3] === 0x47 &&
  bytes[4] === 0x0d &&
  bytes[5] === 0x0a &&
  bytes[6] === 0x1a &&
  bytes[7] === 0x0a

const isJpeg = (bytes: Uint8Array): boolean =>
  bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8

const decodeRgba = (bytes: Uint8Array): RgbaImage => {
  if (isPng(bytes)) {
    const decoded = PNG.sync.read(Buffer.from(bytes))
    return { width: decoded.width, height: decoded.height, data: decoded.data }
  }
  if (isJpeg(bytes)) {
    const decoded = jpeg.decode(bytes, {
      formatAsRGBA: true,
      tolerantDecoding: false,
      useTArray: true,
    })
    return { width: decoded.width, height: decoded.height, data: decoded.data }
  }
  throw new Error('Quality PSNR currently requires JPEG or PNG input and output')
}

const cropRgba = (
  image: RgbaImage,
  crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): RgbaImage => {
  if (
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width < 1 ||
    crop.height < 1 ||
    crop.x + crop.width > image.width ||
    crop.y + crop.height > image.height
  ) {
    throw new Error('Quality-reference crop is outside the source image')
  }
  const data = new Uint8Array(crop.width * crop.height * 4)
  const rowBytes = crop.width * 4
  for (let row = 0; row < crop.height; row += 1) {
    const sourceOffset = ((crop.y + row) * image.width + crop.x) * 4
    data.set(image.data.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes)
  }
  return { width: crop.width, height: crop.height, data }
}

const resizeExactArea = (image: RgbaImage, width: number, height: number): RgbaImage => {
  if (width === image.width && height === image.height) return image
  if (width > image.width || height > image.height) {
    throw new Error('Quality exact-area oracle does not support enlargement')
  }
  const output = new Uint8Array(width * height * 4)
  const scaleX = image.width / width
  const scaleY = image.height / height

  for (let outputY = 0; outputY < height; outputY += 1) {
    const top = outputY * scaleY
    const bottom = (outputY + 1) * scaleY
    const firstY = Math.floor(top)
    const lastY = Math.ceil(bottom)
    for (let outputX = 0; outputX < width; outputX += 1) {
      const left = outputX * scaleX
      const right = (outputX + 1) * scaleX
      const firstX = Math.floor(left)
      const lastX = Math.ceil(right)
      let redAlpha = 0
      let greenAlpha = 0
      let blueAlpha = 0
      let alpha = 0
      let area = 0

      for (let sourceY = firstY; sourceY < lastY; sourceY += 1) {
        const overlapY = Math.max(0, Math.min(bottom, sourceY + 1) - Math.max(top, sourceY))
        for (let sourceX = firstX; sourceX < lastX; sourceX += 1) {
          const overlapX = Math.max(0, Math.min(right, sourceX + 1) - Math.max(left, sourceX))
          const weight = overlapX * overlapY
          const sourceOffset = (sourceY * image.width + sourceX) * 4
          const sourceAlpha = image.data[sourceOffset + 3] ?? 0
          redAlpha += (image.data[sourceOffset] ?? 0) * sourceAlpha * weight
          greenAlpha += (image.data[sourceOffset + 1] ?? 0) * sourceAlpha * weight
          blueAlpha += (image.data[sourceOffset + 2] ?? 0) * sourceAlpha * weight
          alpha += sourceAlpha * weight
          area += weight
        }
      }

      const target = (outputY * width + outputX) * 4
      const unpremultiply = alpha > 0 ? 1 / alpha : 0
      output[target] = Math.round(redAlpha * unpremultiply)
      output[target + 1] = Math.round(greenAlpha * unpremultiply)
      output[target + 2] = Math.round(blueAlpha * unpremultiply)
      output[target + 3] = Math.round(alpha / area)
    }
  }

  return { width, height, data: output }
}

const flattenWhite = (image: RgbaImage): RgbaImage => {
  const data = new Uint8Array(image.data.length)
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3] ?? 0
    const inverseAlpha = 255 - alpha
    data[offset] = Math.round(((image.data[offset] ?? 0) * alpha + 255 * inverseAlpha) / 255)
    data[offset + 1] = Math.round(
      ((image.data[offset + 1] ?? 0) * alpha + 255 * inverseAlpha) / 255,
    )
    data[offset + 2] = Math.round(
      ((image.data[offset + 2] ?? 0) * alpha + 255 * inverseAlpha) / 255,
    )
    data[offset + 3] = 255
  }
  return { width: image.width, height: image.height, data }
}

export const createQualityReference = (
  workflow: PipelineWorkflow,
  input: Uint8Array,
): RgbaImage | undefined => {
  if (workflow.qualityReference !== 'exact-area') return undefined
  let image = decodeRgba(input)
  for (const operation of workflow.operations) {
    if (operation.type === 'crop') {
      image = cropRgba(image, operation)
    } else if (operation.type === 'resize') {
      const withoutEnlargement = operation.withoutEnlargement ?? false
      const dimensions =
        operation.width !== undefined
          ? operation.height !== undefined
            ? calculateResizeDimensions(image.width, image.height, {
                width: operation.width,
                height: operation.height,
                withoutEnlargement,
              })
            : calculateResizeDimensions(image.width, image.height, {
                width: operation.width,
                withoutEnlargement,
              })
          : operation.height !== undefined
            ? calculateResizeDimensions(image.width, image.height, {
                height: operation.height,
                withoutEnlargement,
              })
            : undefined
      if (!dimensions) throw new Error(`Quality-reference resize ${workflow.id} has no dimensions`)
      image = resizeExactArea(image, dimensions.width, dimensions.height)
    } else if (operation.type === 'encode') {
      if (operation.background === '#ffffff') image = flattenWhite(image)
    } else {
      throw new Error(
        `Quality-reference workflow ${workflow.id} does not support ${operation.type}`,
      )
    }
  }
  return image
}

export const measureQualityPsnr = (
  output: Uint8Array,
  reference: RgbaImage | undefined,
): QualityPsnr | undefined => {
  if (!reference) return undefined
  const actual = decodeRgba(output)
  if (actual.width !== reference.width || actual.height !== reference.height) {
    throw new Error(
      `Quality output was ${actual.width}x${actual.height}, expected ${reference.width}x${reference.height}`,
    )
  }
  let squaredError = 0
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    const referenceAlpha = reference.data[offset + 3] ?? 0
    const actualAlpha = actual.data[offset + 3] ?? 0
    const referenceScale = referenceAlpha / 255
    const actualScale = actualAlpha / 255
    for (let channel = 0; channel < 3; channel += 1) {
      const difference =
        (actual.data[offset + channel] ?? 0) * actualScale -
        (reference.data[offset + channel] ?? 0) * referenceScale
      squaredError += difference * difference
    }
    const alphaDifference = actualAlpha - referenceAlpha
    squaredError += alphaDifference * alphaDifference
  }
  if (squaredError === 0) return 'exact'
  const meanSquaredError = squaredError / reference.data.length
  return 10 * Math.log10((255 * 255) / meanSquaredError)
}
