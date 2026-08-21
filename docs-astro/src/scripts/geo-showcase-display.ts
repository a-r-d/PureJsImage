import { rasterSampleIsNoData, type GeoNumericTile, type RasterNoData } from 'purejsimage/geo'

export interface GeoShowcaseDisplay {
  readonly rgba: Uint8ClampedArray
  readonly ranges: readonly (readonly [number, number])[]
  readonly noDataPixels: number
  readonly dataRegion?: Readonly<{
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }>
}

const noDataColor = [12, 18, 14] as const

export const geoTileSampleOffset = (
  tile: GeoNumericTile,
  x: number,
  y: number,
  component: number,
): number =>
  tile.layout === 'planar'
    ? component * (tile.planeStrideElements ?? 0) + y * tile.rowStrideElements + x
    : y * tile.rowStrideElements + x * tile.componentCount + component

const validSample = (value: number, noData: RasterNoData): boolean =>
  Number.isFinite(value) && !rasterSampleIsNoData(value, noData)

const rangeFor = (
  tile: GeoNumericTile,
  component: number,
  noData: RasterNoData,
): readonly [number, number] => {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const value = Number(tile.data[geoTileSampleOffset(tile, x, y, component)])
      if (!validSample(value, noData)) continue
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [0, 1]
  if (minimum < maximum) return [minimum, maximum]
  return [minimum, minimum + Math.max(1, Math.abs(minimum) * Number.EPSILON)]
}

export const renderGeoTileDisplay = (
  tile: GeoNumericTile,
  noDataByComponent: readonly RasterNoData[],
): GeoShowcaseDisplay => {
  const fallbackNoData: RasterNoData = { kind: 'none' }
  const ranges = Array.from({ length: tile.componentCount }, (_, component) =>
    rangeFor(tile, component, noDataByComponent[component] ?? fallbackNoData),
  )
  const output = new Uint8ClampedArray(tile.width * tile.height * 4)
  let noDataPixels = 0
  let minimumDataX = tile.width
  let minimumDataY = tile.height
  let maximumDataX = -1
  let maximumDataY = -1
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const pixel = y * tile.width + x
      let pixelHasData = false
      for (let channel = 0; channel < 3; channel += 1) {
        const component = tile.componentCount === 1 ? 0 : Math.min(channel, tile.componentCount - 1)
        const value = Number(tile.data[geoTileSampleOffset(tile, x, y, component)])
        const noData = noDataByComponent[component] ?? fallbackNoData
        const range = ranges[component] ?? [0, 1]
        if (validSample(value, noData)) {
          pixelHasData = true
          output[pixel * 4 + channel] = Math.round(
            ((value - range[0]) / (range[1] - range[0])) * 255,
          )
        } else {
          output[pixel * 4 + channel] = noDataColor[channel] ?? 0
        }
      }
      if (pixelHasData) {
        minimumDataX = Math.min(minimumDataX, x)
        minimumDataY = Math.min(minimumDataY, y)
        maximumDataX = Math.max(maximumDataX, x)
        maximumDataY = Math.max(maximumDataY, y)
      } else {
        noDataPixels += 1
      }
      output[pixel * 4 + 3] = 255
    }
  }
  return {
    rgba: output,
    ranges,
    noDataPixels,
    ...(maximumDataX < 0 || maximumDataY < 0
      ? {}
      : {
          dataRegion: {
            x: tile.x + minimumDataX,
            y: tile.y + minimumDataY,
            width: maximumDataX - minimumDataX + 1,
            height: maximumDataY - minimumDataY + 1,
          },
        }),
  }
}
