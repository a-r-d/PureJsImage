import type { ImageDecoder } from '../codec.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import { type ImageSource, readExactly } from '../source.ts'
import { ColorManagedDecoder, parseRgbIccTransform } from './icc.ts'
import {
  type Jp2PaletteColumn,
  type Jp2Header,
  describeContainer,
  type ComponentSpec,
  type QuantStep,
  type Quantization,
  type Jp2DisplayLayout,
  displayLayout,
  validateContainerSize,
} from './jpeg2000-metadata.ts'
import { decodeJpeg2000CodeBlock, type Jpeg2000Subband } from './jpeg2000-tier1.ts'
import { inverseJpeg2000Wavelet, type Jpeg2000ResolutionCoefficients } from './jpeg2000-wavelet.ts'
import {
  parseCodestream,
  type ParsedCodestream,
  type Subband,
  type Tile,
} from './jpeg2000-packets.ts'
import { Jpeg2000Decoder } from './jpeg2000-codestream.ts'

const blockRows = 32

interface ReconstructedComponent {
  readonly x0: number
  readonly y0: number
  readonly width: number
  readonly height: number
  readonly scale: number
  readonly values: Float32Array
}

const gainLog2 = (band: Jpeg2000Subband): number => (band === 'HH' ? 2 : band === 'LL' ? 0 : 1)

export const quantStep = (
  quantization: Quantization,
  sequentialIndex: number,
  resolutionLevel: number,
): QuantStep => {
  if (quantization.style === 1) {
    const derived = quantization.steps[0]
    if (!derived) throw invalidInput('JPEG 2000 derived quantization step is missing')
    return {
      exponent: derived.exponent + (resolutionLevel > 0 ? 1 - resolutionLevel : 0),
      mantissa: derived.mantissa,
    }
  }
  const step = quantization.steps[sequentialIndex]
  if (!step) throw invalidInput('JPEG 2000 quantization step table is too short')
  return step
}

const decodeBand = (
  codestream: Uint8Array,
  target: Float32Array,
  levelWidth: number,
  levelX0: number,
  levelY0: number,
  band: Subband,
  delta: number,
  magnitudeBits: number,
  reversible: boolean,
  resetContexts: boolean,
  roiShift: number,
  segmentationSymbols: boolean,
  verticalCausal: boolean,
): void => {
  const bandWidth = band.x1 - band.x0
  const horizontalHigh = band.type === 'HL' || band.type === 'HH' ? 1 - (levelX0 & 1) : levelX0 & 1
  const verticalHigh =
    (band.type === 'LH' || band.type === 'HH' ? 1 - (levelY0 & 1) : levelY0 & 1) * levelWidth
  for (const block of band.blocks) {
    if (block.chunks.length === 0) continue
    let byteLength = 0
    let codingPasses = 0
    for (const chunk of block.chunks) {
      byteLength += chunk.end - chunk.start
      codingPasses += chunk.codingPasses
    }
    const encoded = new Uint8Array(byteLength)
    let write = 0
    for (const chunk of block.chunks) {
      const bytes = codestream.subarray(chunk.start, chunk.end)
      encoded.set(bytes, write)
      write += bytes.byteLength
    }
    const blockWidth = block.clippedX1 - block.clippedX0
    const blockHeight = block.clippedY1 - block.clippedY0
    const decoded = decodeJpeg2000CodeBlock({
      data: encoded,
      width: blockWidth,
      height: blockHeight,
      band: block.band,
      zeroBitPlanes: block.zeroBitPlanes,
      codingPasses,
      resetContexts,
      segmentationSymbols,
      verticalCausal,
    })
    let bandOffset = block.clippedX0 - band.x0 + (block.clippedY0 - band.y0) * bandWidth
    let coefficient = 0
    for (let y = 0; y < blockHeight; y += 1) {
      const bandRow = Math.floor(bandOffset / bandWidth)
      const interleaveOffset =
        2 * bandRow * (levelWidth - bandWidth) + horizontalHigh + verticalHigh
      for (let x = 0; x < blockWidth; x += 1) {
        const magnitude = decoded.magnitude[coefficient] ?? 0
        if (magnitude !== 0) {
          const planes = decoded.decodedBitPlanes[coefficient] ?? 0
          let coefficientMagnitude =
            (magnitude + (reversible ? 0 : 0.5)) * 2 ** (magnitudeBits - planes)
          if (roiShift > 0 && coefficientMagnitude >= 2 ** roiShift) {
            coefficientMagnitude /= 2 ** roiShift
          }
          const signed =
            (decoded.negative[coefficient] === 1 ? -coefficientMagnitude : coefficientMagnitude) *
            delta
          const targetOffset = band.type === 'LL' ? bandOffset : interleaveOffset + bandOffset * 2
          if (targetOffset < 0 || targetOffset >= target.length) {
            throw invalidInput(
              `JPEG 2000 ${band.type} coefficient ${targetOffset} maps outside ${target.length} values`,
            )
          }
          target[targetOffset] = signed
        }
        bandOffset += 1
        coefficient += 1
      }
      bandOffset += bandWidth - blockWidth
    }
  }
}

const reconstructComponent = (
  codestream: Uint8Array,
  tile: Tile,
  componentIndex: number,
  specification: ComponentSpec,
  scaleDenominator: 1 | 2 | 4 | 8,
): ReconstructedComponent => {
  const component = tile.components[componentIndex]
  if (!component) throw invalidInput('JPEG 2000 tile component is missing')
  const requestedReduction = Math.log2(scaleDenominator)
  const selectedLevel = Math.max(0, component.style.decompositionLevels - requestedReduction)
  const componentScale = 2 ** (component.style.decompositionLevels - selectedLevel)
  const levels: Jpeg2000ResolutionCoefficients[] = []
  let sequentialStep = 0
  for (const resolution of component.resolutions) {
    const width = resolution.x1 - resolution.x0
    const height = resolution.y1 - resolution.y0
    if (resolution.level > selectedLevel) break
    const values = new Float32Array(width * height)
    for (const band of resolution.bands) {
      const step = quantStep(component.quantization, sequentialStep, resolution.level)
      if (component.quantization.style !== 1) sequentialStep += 1
      const delta = component.style.reversible
        ? 1
        : 2 ** (specification.precision + gainLog2(band.type) - step.exponent) *
          (1 + step.mantissa / 2048)
      const magnitudeBits = component.quantization.guardBits + step.exponent - 1
      const codedMagnitudeBits = magnitudeBits + component.roiShift
      if (magnitudeBits < 0 || codedMagnitudeBits > 31) {
        throw unsupportedOperation(
          `JPEG 2000 coefficient magnitude ${codedMagnitudeBits} is unsupported`,
        )
      }
      decodeBand(
        codestream,
        values,
        width,
        resolution.x0,
        resolution.y0,
        band,
        delta,
        codedMagnitudeBits,
        component.style.reversible,
        component.style.resetContexts,
        component.roiShift,
        component.style.segmentationSymbols,
        component.style.verticalCausal,
      )
    }
    levels.push({ x0: resolution.x0, y0: resolution.y0, width, height, values })
  }
  const reconstructed = inverseJpeg2000Wavelet(levels, component.style.reversible)
  return {
    x0: reconstructed.x0,
    y0: reconstructed.y0,
    width: reconstructed.width,
    height: reconstructed.height,
    scale: componentScale,
    values: reconstructed.values,
  }
}

export const roundHalfAwayFromZero = (value: number): number =>
  value < 0 ? -Math.round(-value) : Math.round(value)

const ycbcrTables = (() => {
  const redFromCr = new Int16Array(256)
  const greenFromCb = new Int32Array(256)
  const greenFromCr = new Int32Array(256)
  const blueFromCb = new Int16Array(256)
  for (let value = 0; value < 256; value += 1) {
    const chroma = value - 128
    redFromCr[value] = roundHalfAwayFromZero(1.402 * chroma)
    greenFromCb[value] = roundHalfAwayFromZero(65_536 * (0.5 - 0.34414 * chroma))
    greenFromCr[value] = roundHalfAwayFromZero(65_536 * -0.71414 * chroma)
    blueFromCb[value] = roundHalfAwayFromZero(1.772 * chroma)
  }
  return Object.freeze({ redFromCr, greenFromCb, greenFromCr, blueFromCb })
})()

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

const normalizedSample = (value: number, specification: ComponentSpec): number => {
  const shifted = specification.signed ? value : value + 2 ** (specification.precision - 1)
  const maximum = 2 ** specification.precision - 1
  return clampByte((shifted * 255) / maximum)
}

export const componentValueAt = (
  component: ReconstructedComponent,
  specification: ComponentSpec,
  referenceX: number,
  referenceY: number,
): number => {
  const x = Math.floor(referenceX / (specification.xSampling * component.scale)) - component.x0
  const y = Math.floor(referenceY / (specification.ySampling * component.scale)) - component.y0
  const clampedX = Math.max(0, Math.min(component.width - 1, x))
  const clampedY = Math.max(0, Math.min(component.height - 1, y))
  return component.values[clampedY * component.width + clampedX] ?? 0
}

const paletteSample = (value: number, column: Jp2PaletteColumn): number => {
  const shifted = column.signed ? value + 2 ** (column.bitDepth - 1) : value
  return clampByte((shifted * 255) / (2 ** column.bitDepth - 1))
}

const channelSampleAt = (
  container: Jp2Header,
  parsed: ParsedCodestream,
  components: readonly ReconstructedComponent[],
  channel: number,
  referenceX: number,
  referenceY: number,
): number => {
  const mapping = container.channelMappings[channel]
  if (!mapping) throw invalidInput(`JP2 channel mapping ${channel} is missing`)
  const component = components[mapping.component]
  const specification = parsed.size.components[mapping.component]
  if (!component || !specification) throw invalidInput('JP2 mapped component is missing')
  const value = componentValueAt(component, specification, referenceX, referenceY)
  if (mapping.paletteColumn === undefined) return normalizedSample(value, specification)
  const palette = container.palette
  const column = palette?.columns[mapping.paletteColumn]
  if (!palette || !column) throw invalidInput('JP2 mapped palette column is missing')
  const rawIndex = specification.signed
    ? Math.round(value)
    : Math.round(value + 2 ** (specification.precision - 1))
  const index = Math.max(0, Math.min(palette.entries - 1, rawIndex))
  return paletteSample(column.values[index] ?? 0, column)
}

interface ReconstructedTile {
  readonly tile: Tile
  readonly components: readonly ReconstructedComponent[]
}

export const reconstructTile = (
  codestream: Uint8Array,
  parsed: ParsedCodestream,
  tile: Tile,
  scaleDenominator: 1 | 2 | 4 | 8,
): ReconstructedTile => {
  const components = parsed.size.components.map((specification, index) =>
    reconstructComponent(codestream, tile, index, specification, scaleDenominator),
  )
  if (tile.style.transformComponents) {
    const first = parsed.size.components[0]
    if (!first || components.length < 3) {
      throw invalidInput('JPEG 2000 multiple-component transform requires three components')
    }
    for (let index = 0; index < 3; index += 1) {
      const specification = parsed.size.components[index]
      if (
        !specification ||
        specification.precision !== first.precision ||
        specification.xSampling !== 1 ||
        specification.ySampling !== 1 ||
        components[index]?.scale !== components[0]?.scale
      ) {
        throw unsupportedOperation(
          'JPEG 2000 transformed components must share precision, sampling, and resolution',
        )
      }
    }
  }
  return { tile, components }
}

const transformedColorAt = (
  parsed: ParsedCodestream,
  rendered: ReconstructedTile,
  referenceX: number,
  referenceY: number,
): readonly [number, number, number] => {
  const first = rendered.components[0]
  const second = rendered.components[1]
  const third = rendered.components[2]
  const specification = parsed.size.components[0]
  const secondSpec = parsed.size.components[1]
  const thirdSpec = parsed.size.components[2]
  if (!first || !second || !third || !specification || !secondSpec || !thirdSpec) {
    throw invalidInput('JPEG 2000 transformed color components are missing')
  }
  const y = componentValueAt(first, specification, referenceX, referenceY)
  const u = componentValueAt(second, secondSpec, referenceX, referenceY)
  const v = componentValueAt(third, thirdSpec, referenceX, referenceY)
  const offset = specification.signed ? 0 : 2 ** (specification.precision - 1)
  const maximum = 2 ** specification.precision - 1
  if (rendered.tile.style.reversible) {
    const green = y + offset - Math.floor((u + v) / 4)
    return [((green + v) * 255) / maximum, (green * 255) / maximum, ((green + u) * 255) / maximum]
  }
  const luminance = y + offset
  return [
    ((luminance + 1.402 * v) * 255) / maximum,
    ((luminance - 0.34413 * u - 0.71414 * v) * 255) / maximum,
    ((luminance + 1.772 * u) * 255) / maximum,
  ]
}

const writeRenderedPixel = (
  output: Uint8Array,
  target: number,
  container: Jp2Header,
  parsed: ParsedCodestream,
  layout: Jp2DisplayLayout,
  rendered: ReconstructedTile,
  referenceX: number,
  referenceY: number,
): void => {
  if (layout.format === 'gray8') {
    output[target] = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.colorChannels[0] ?? 0,
      referenceX,
      referenceY,
    )
    return
  }
  let red: number
  let green: number
  let blue: number
  if (container.colorSpace === 'gray') {
    red = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.colorChannels[0] ?? 0,
      referenceX,
      referenceY,
    )
    green = red
    blue = red
  } else if (rendered.tile.style.transformComponents) {
    const mappings = layout.colorChannels.map((channel) => container.channelMappings[channel])
    if (
      mappings.some(
        (mapping, index) =>
          !mapping || mapping.paletteColumn !== undefined || mapping.component !== index,
      )
    ) {
      throw unsupportedOperation('JP2 transformed color channels use an unsupported mapping')
    }
    ;[red, green, blue] = transformedColorAt(parsed, rendered, referenceX, referenceY)
  } else {
    const first = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.colorChannels[0] ?? 0,
      referenceX,
      referenceY,
    )
    const second = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.colorChannels[1] ?? 1,
      referenceX,
      referenceY,
    )
    const third = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.colorChannels[2] ?? 2,
      referenceX,
      referenceY,
    )
    if (container.colorSpace === 'sycc') {
      red = first + (ycbcrTables.redFromCr[third] ?? 0)
      green =
        first +
        (((ycbcrTables.greenFromCb[second] ?? 0) + (ycbcrTables.greenFromCr[third] ?? 0)) >> 16)
      blue = first + (ycbcrTables.blueFromCb[second] ?? 0)
    } else {
      red = first
      green = second
      blue = third
    }
  }
  let alpha = 255
  if (layout.alphaChannel !== undefined) {
    alpha = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.alphaChannel,
      referenceX,
      referenceY,
    )
    if (layout.premultiplied && alpha > 0 && alpha < 255) {
      red = (red * 255) / alpha
      green = (green * 255) / alpha
      blue = (blue * 255) / alpha
    } else if (layout.premultiplied && alpha === 0) {
      red = 0
      green = 0
      blue = 0
    }
  }
  output[target] = clampByte(red)
  output[target + 1] = clampByte(green)
  output[target + 2] = clampByte(blue)
  if (layout.outputChannels === 4) output[target + 3] = alpha
}

export const reconstructPixelBlocks = async function* (
  codestream: Uint8Array,
  parsed: ParsedCodestream,
  container: Jp2Header,
  region: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  },
  scaleDenominator: 1 | 2 | 4 | 8,
): AsyncGenerator<PixelBlock> {
  const layout = displayLayout(container)
  const regionEndX = region.x + region.width
  const regionEndY = region.y + region.height
  let tileIndex = 0
  while (tileIndex < parsed.tiles.length) {
    const firstTile = parsed.tiles[tileIndex]
    if (!firstTile) throw invalidInput('JPEG 2000 tile row is missing')
    const rowY0 = firstTile.y0
    const rowY1 = firstTile.y1
    const rowTiles: Tile[] = []
    while (tileIndex < parsed.tiles.length) {
      const tile = parsed.tiles[tileIndex]
      if (!tile || tile.y0 !== rowY0 || tile.y1 !== rowY1) break
      rowTiles.push(tile)
      tileIndex += 1
    }
    const outputRowY0 = Math.ceil((rowY0 - parsed.size.yOrigin) / scaleDenominator)
    const outputRowY1 = Math.ceil((rowY1 - parsed.size.yOrigin) / scaleDenominator)
    const rowStart = Math.max(region.y, outputRowY0)
    const rowEnd = Math.min(regionEndY, outputRowY1)
    if (rowStart >= rowEnd) continue
    const renderedTiles = rowTiles
      .filter((tile) => {
        const x0 = Math.ceil((tile.x0 - parsed.size.xOrigin) / scaleDenominator)
        const x1 = Math.ceil((tile.x1 - parsed.size.xOrigin) / scaleDenominator)
        return x0 < regionEndX && x1 > region.x
      })
      .map((tile) => reconstructTile(codestream, parsed, tile, scaleDenominator))
    for (let outputY = rowStart; outputY < rowEnd; outputY += blockRows) {
      const rows = Math.min(blockRows, rowEnd - outputY)
      const stride = region.width * layout.outputChannels
      const data = new Uint8Array(stride * rows)
      for (const rendered of renderedTiles) {
        const tileX0 = Math.ceil((rendered.tile.x0 - parsed.size.xOrigin) / scaleDenominator)
        const tileX1 = Math.ceil((rendered.tile.x1 - parsed.size.xOrigin) / scaleDenominator)
        const outputX0 = Math.max(region.x, tileX0)
        const outputX1 = Math.min(regionEndX, tileX1)
        for (let localY = 0; localY < rows; localY += 1) {
          const scaledY = outputY + localY
          const referenceY = parsed.size.yOrigin + scaledY * scaleDenominator
          for (let scaledX = outputX0; scaledX < outputX1; scaledX += 1) {
            const referenceX = parsed.size.xOrigin + scaledX * scaleDenominator
            const target = localY * stride + (scaledX - region.x) * layout.outputChannels
            writeRenderedPixel(
              data,
              target,
              container,
              parsed,
              layout,
              rendered,
              referenceX,
              referenceY,
            )
          }
        }
      }
      yield {
        x: 0,
        y: outputY - region.y,
        width: region.width,
        height: rows,
        stride,
        format: layout.format,
        data,
      }
    }
  }
}

export const createJpeg2000Decoder = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageDecoder> => {
  const container = await describeContainer(source, limits)
  const codestream = await readExactly(
    source,
    container.codestreamOffset,
    container.codestreamLength,
  )
  const parsed = parseCodestream(codestream, limits)
  validateContainerSize(container, parsed.size)
  const decoder = new Jpeg2000Decoder({ container, codestream, parsed })
  const colorTransform =
    container.icc && container.colorSpace !== 'gray'
      ? parseRgbIccTransform(container.icc)
      : undefined
  return colorTransform ? new ColorManagedDecoder(decoder, colorTransform) : decoder
}
