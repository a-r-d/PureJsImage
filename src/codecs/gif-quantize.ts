// Color reduction for GIF output: exact palettes, Wu's variance-minimizing quantizer, and palette
// mapping with optional Floyd-Steinberg dithering. Pixels are RGBA8; alpha below 128 is
// transparent and never enters a palette.

export const gifAlphaThreshold = 128

const exactSlots = 1024

/**
 * Indexes `count` RGBA8 pixels against an exact palette of at most `maximumColors` opaque colors.
 * Transparent pixels get `transparentIndex`. Returns the number of colors, or -1 when the pixels
 * need more. `paletteOut` receives RGB triples.
 */
export const exactGifPalette = (
  rgba: Uint8Array,
  offset: number,
  stride: number,
  width: number,
  height: number,
  maximumColors: number,
  transparentIndex: number,
  indices: Uint8Array,
  paletteOut: Uint8Array,
  previousColors = 0,
): number => {
  const keys = new Int32Array(exactSlots)
  const slots = new Uint16Array(exactSlots)
  let colors = 0
  // Seed with an existing palette so later frames can reuse it. The transparent entry's RGB is
  // only a placeholder and must never match an opaque pixel.
  for (let index = 0; index < previousColors; index += 1) {
    colors = index + 1
    if (index === transparentIndex) continue
    const key =
      ((paletteOut[index * 3] ?? 0) << 16) |
      ((paletteOut[index * 3 + 1] ?? 0) << 8) |
      (paletteOut[index * 3 + 2] ?? 0)
    let slot = Math.imul(key, 0x9e3779b1) >>> 22
    while ((slots[slot] ?? 0) !== 0 && keys[slot] !== key) slot = (slot + 1) & (exactSlots - 1)
    if ((slots[slot] ?? 0) === 0) {
      keys[slot] = key
      slots[slot] = index + 1
    }
  }
  if (colors === transparentIndex && colors < maximumColors) colors += 1
  let lastKey = -1
  let lastIndex = 0
  let target = 0
  for (let y = 0; y < height; y += 1) {
    let source = offset + y * stride
    for (let x = 0; x < width; x += 1, source += 4, target += 1) {
      if ((rgba[source + 3] ?? 0) < gifAlphaThreshold) {
        indices[target] = transparentIndex
        continue
      }
      const key =
        ((rgba[source] ?? 0) << 16) | ((rgba[source + 1] ?? 0) << 8) | (rgba[source + 2] ?? 0)
      if (key !== lastKey) {
        let slot = Math.imul(key, 0x9e3779b1) >>> 22
        let entry = slots[slot] ?? 0
        while (entry !== 0 && keys[slot] !== key) {
          slot = (slot + 1) & (exactSlots - 1)
          entry = slots[slot] ?? 0
        }
        if (entry === 0) {
          if (colors >= maximumColors) return -1
          const index = colors
          colors += 1
          if (colors === transparentIndex && colors < maximumColors) colors += 1
          keys[slot] = key
          slots[slot] = index + 1
          paletteOut[index * 3] = key >>> 16
          paletteOut[index * 3 + 1] = (key >>> 8) & 0xff
          paletteOut[index * 3 + 2] = key & 0xff
          entry = index + 1
        }
        lastKey = key
        lastIndex = entry - 1
      }
      indices[target] = lastIndex
    }
  }
  return colors
}

// Wu's quantizer works on a 33 x 33 x 33 histogram of 5-bit channels with cumulative moments.
const side = 33
const sideSquared = side * side
const histogramSize = side * side * side

interface WuScratch {
  readonly weight: Float64Array
  readonly red: Float64Array
  readonly green: Float64Array
  readonly blue: Float64Array
  readonly moment: Float64Array
  // Per-bin sums before the cumulative pass, for k-means refinement.
  readonly binWeight: Float64Array
  readonly binRed: Float64Array
  readonly binGreen: Float64Array
  readonly binBlue: Float64Array
  readonly bins: Int32Array
}

let wuScratch: WuScratch | undefined

const scratch = (): WuScratch => {
  wuScratch ??= {
    weight: new Float64Array(histogramSize),
    red: new Float64Array(histogramSize),
    green: new Float64Array(histogramSize),
    blue: new Float64Array(histogramSize),
    moment: new Float64Array(histogramSize),
    binWeight: new Float64Array(histogramSize),
    binRed: new Float64Array(histogramSize),
    binGreen: new Float64Array(histogramSize),
    binBlue: new Float64Array(histogramSize),
    bins: new Int32Array(histogramSize),
  }
  return wuScratch
}

interface Box {
  r0: number
  r1: number
  g0: number
  g1: number
  b0: number
  b1: number
  volume: number
}

const at = (r: number, g: number, b: number): number => r * sideSquared + g * side + b

const volume = (box: Box, moments: Float64Array): number =>
  (moments[at(box.r1, box.g1, box.b1)] ?? 0) -
  (moments[at(box.r1, box.g1, box.b0)] ?? 0) -
  (moments[at(box.r1, box.g0, box.b1)] ?? 0) +
  (moments[at(box.r1, box.g0, box.b0)] ?? 0) -
  (moments[at(box.r0, box.g1, box.b1)] ?? 0) +
  (moments[at(box.r0, box.g1, box.b0)] ?? 0) +
  (moments[at(box.r0, box.g0, box.b1)] ?? 0) -
  (moments[at(box.r0, box.g0, box.b0)] ?? 0)

// The part of a box's moment sum that does not change as its upper bound on `axis` moves.
const bottom = (box: Box, axis: 0 | 1 | 2, moments: Float64Array): number => {
  if (axis === 0) {
    return (
      -(moments[at(box.r0, box.g1, box.b1)] ?? 0) +
      (moments[at(box.r0, box.g1, box.b0)] ?? 0) +
      (moments[at(box.r0, box.g0, box.b1)] ?? 0) -
      (moments[at(box.r0, box.g0, box.b0)] ?? 0)
    )
  }
  if (axis === 1) {
    return (
      -(moments[at(box.r1, box.g0, box.b1)] ?? 0) +
      (moments[at(box.r1, box.g0, box.b0)] ?? 0) +
      (moments[at(box.r0, box.g0, box.b1)] ?? 0) -
      (moments[at(box.r0, box.g0, box.b0)] ?? 0)
    )
  }
  return (
    -(moments[at(box.r1, box.g1, box.b0)] ?? 0) +
    (moments[at(box.r1, box.g0, box.b0)] ?? 0) +
    (moments[at(box.r0, box.g1, box.b0)] ?? 0) -
    (moments[at(box.r0, box.g0, box.b0)] ?? 0)
  )
}

const top = (box: Box, axis: 0 | 1 | 2, position: number, moments: Float64Array): number => {
  if (axis === 0) {
    return (
      (moments[at(position, box.g1, box.b1)] ?? 0) -
      (moments[at(position, box.g1, box.b0)] ?? 0) -
      (moments[at(position, box.g0, box.b1)] ?? 0) +
      (moments[at(position, box.g0, box.b0)] ?? 0)
    )
  }
  if (axis === 1) {
    return (
      (moments[at(box.r1, position, box.b1)] ?? 0) -
      (moments[at(box.r1, position, box.b0)] ?? 0) -
      (moments[at(box.r0, position, box.b1)] ?? 0) +
      (moments[at(box.r0, position, box.b0)] ?? 0)
    )
  }
  return (
    (moments[at(box.r1, box.g1, position)] ?? 0) -
    (moments[at(box.r1, box.g0, position)] ?? 0) -
    (moments[at(box.r0, box.g1, position)] ?? 0) +
    (moments[at(box.r0, box.g0, position)] ?? 0)
  )
}

const variance = (box: Box, wu: WuScratch): number => {
  const r = volume(box, wu.red)
  const g = volume(box, wu.green)
  const b = volume(box, wu.blue)
  const weight = volume(box, wu.weight)
  if (weight <= 0) return 0
  return volume(box, wu.moment) - (r * r + g * g + b * b) / weight
}

interface Cut {
  readonly score: number
  readonly position: number
}

const maximize = (
  box: Box,
  axis: 0 | 1 | 2,
  first: number,
  last: number,
  wholeR: number,
  wholeG: number,
  wholeB: number,
  wholeWeight: number,
  wu: WuScratch,
): Cut => {
  const baseR = bottom(box, axis, wu.red)
  const baseG = bottom(box, axis, wu.green)
  const baseB = bottom(box, axis, wu.blue)
  const baseWeight = bottom(box, axis, wu.weight)
  let best = 0
  let position = -1
  for (let cut = first; cut < last; cut += 1) {
    let r = baseR + top(box, axis, cut, wu.red)
    let g = baseG + top(box, axis, cut, wu.green)
    let b = baseB + top(box, axis, cut, wu.blue)
    let weight = baseWeight + top(box, axis, cut, wu.weight)
    if (weight === 0) continue
    let score = (r * r + g * g + b * b) / weight
    r = wholeR - r
    g = wholeG - g
    b = wholeB - b
    weight = wholeWeight - weight
    if (weight === 0) continue
    score += (r * r + g * g + b * b) / weight
    if (score > best) {
      best = score
      position = cut
    }
  }
  return { score: best, position }
}

const split = (box: Box, next: Box, wu: WuScratch): boolean => {
  const wholeR = volume(box, wu.red)
  const wholeG = volume(box, wu.green)
  const wholeB = volume(box, wu.blue)
  const wholeWeight = volume(box, wu.weight)
  const cutR = maximize(box, 0, box.r0 + 1, box.r1, wholeR, wholeG, wholeB, wholeWeight, wu)
  const cutG = maximize(box, 1, box.g0 + 1, box.g1, wholeR, wholeG, wholeB, wholeWeight, wu)
  const cutB = maximize(box, 2, box.b0 + 1, box.b1, wholeR, wholeG, wholeB, wholeWeight, wu)
  let axis: 0 | 1 | 2
  if (cutR.score >= cutG.score && cutR.score >= cutB.score) {
    if (cutR.position < 0) return false
    axis = 0
  } else if (cutG.score >= cutB.score) axis = 1
  else axis = 2
  next.r1 = box.r1
  next.g1 = box.g1
  next.b1 = box.b1
  if (axis === 0) {
    next.r0 = box.r1 = cutR.position
    next.g0 = box.g0
    next.b0 = box.b0
  } else if (axis === 1) {
    next.g0 = box.g1 = cutG.position
    next.r0 = box.r0
    next.b0 = box.b0
  } else {
    next.b0 = box.b1 = cutB.position
    next.r0 = box.r0
    next.g0 = box.g0
  }
  box.volume = (box.r1 - box.r0) * (box.g1 - box.g0) * (box.b1 - box.b0)
  next.volume = (next.r1 - next.r0) * (next.g1 - next.g0) * (next.b1 - next.b0)
  return true
}

/**
 * Builds a palette of at most `maximumColors` colors for the opaque pixels of an RGBA8 region with
 * Wu's quantizer. Returns the number of colors written to `paletteOut` as RGB triples.
 */
export const wuGifPalette = (
  rgba: Uint8Array,
  offset: number,
  stride: number,
  width: number,
  height: number,
  maximumColors: number,
  paletteOut: Uint8Array,
): number => {
  const wu = scratch()
  const { weight, red, green, blue, moment } = wu
  weight.fill(0)
  red.fill(0)
  green.fill(0)
  blue.fill(0)
  moment.fill(0)
  for (let y = 0; y < height; y += 1) {
    const end = offset + y * stride + width * 4
    for (let source = offset + y * stride; source < end; source += 4) {
      if ((rgba[source + 3] ?? 0) < gifAlphaThreshold) continue
      const r = rgba[source] ?? 0
      const g = rgba[source + 1] ?? 0
      const b = rgba[source + 2] ?? 0
      const bin = ((r >>> 3) + 1) * sideSquared + ((g >>> 3) + 1) * side + (b >>> 3) + 1
      weight[bin] = (weight[bin] ?? 0) + 1
      red[bin] = (red[bin] ?? 0) + r
      green[bin] = (green[bin] ?? 0) + g
      blue[bin] = (blue[bin] ?? 0) + b
      moment[bin] = (moment[bin] ?? 0) + r * r + g * g + b * b
    }
  }
  wu.binWeight.set(weight)
  wu.binRed.set(red)
  wu.binGreen.set(green)
  wu.binBlue.set(blue)
  // Cumulative moments over the three axes.
  const areaWeight = new Float64Array(side)
  const areaRed = new Float64Array(side)
  const areaGreen = new Float64Array(side)
  const areaBlue = new Float64Array(side)
  const areaMoment = new Float64Array(side)
  for (let r = 1; r < side; r += 1) {
    areaWeight.fill(0)
    areaRed.fill(0)
    areaGreen.fill(0)
    areaBlue.fill(0)
    areaMoment.fill(0)
    for (let g = 1; g < side; g += 1) {
      let lineWeight = 0
      let lineRed = 0
      let lineGreen = 0
      let lineBlue = 0
      let lineMoment = 0
      for (let b = 1; b < side; b += 1) {
        const index = at(r, g, b)
        lineWeight += weight[index] ?? 0
        lineRed += red[index] ?? 0
        lineGreen += green[index] ?? 0
        lineBlue += blue[index] ?? 0
        lineMoment += moment[index] ?? 0
        areaWeight[b] = (areaWeight[b] ?? 0) + lineWeight
        areaRed[b] = (areaRed[b] ?? 0) + lineRed
        areaGreen[b] = (areaGreen[b] ?? 0) + lineGreen
        areaBlue[b] = (areaBlue[b] ?? 0) + lineBlue
        areaMoment[b] = (areaMoment[b] ?? 0) + lineMoment
        const previous = index - sideSquared
        weight[index] = (weight[previous] ?? 0) + (areaWeight[b] ?? 0)
        red[index] = (red[previous] ?? 0) + (areaRed[b] ?? 0)
        green[index] = (green[previous] ?? 0) + (areaGreen[b] ?? 0)
        blue[index] = (blue[previous] ?? 0) + (areaBlue[b] ?? 0)
        moment[index] = (moment[previous] ?? 0) + (areaMoment[b] ?? 0)
      }
    }
  }
  const total = weight[histogramSize - 1] ?? 0
  if (total === 0) return 0

  const boxes: Box[] = [{ r0: 0, r1: 32, g0: 0, g1: 32, b0: 0, b1: 32, volume: 32 * 32 * 32 }]
  const variances = [variance(boxes[0] as Box, wu)]
  let next = 0
  for (let count = 1; count < maximumColors; count += 1) {
    const box = boxes[next] as Box
    const created: Box = { r0: 0, r1: 0, g0: 0, g1: 0, b0: 0, b1: 0, volume: 0 }
    if (split(box, created, wu)) {
      boxes.push(created)
      variances[next] = box.volume > 1 ? variance(box, wu) : 0
      variances.push(created.volume > 1 ? variance(created, wu) : 0)
    } else {
      variances[next] = 0
    }
    next = 0
    let largest = variances[0] ?? 0
    for (let index = 1; index < boxes.length; index += 1) {
      const value = variances[index] ?? 0
      if (value > largest) {
        largest = value
        next = index
      }
    }
    if (largest <= 0) break
  }
  let colors = 0
  for (const box of boxes) {
    const boxWeight = volume(box, wu.weight)
    if (boxWeight <= 0) continue
    paletteOut[colors * 3] = Math.round(volume(box, wu.red) / boxWeight)
    paletteOut[colors * 3 + 1] = Math.round(volume(box, wu.green) / boxWeight)
    paletteOut[colors * 3 + 2] = Math.round(volume(box, wu.blue) / boxWeight)
    colors += 1
  }
  refinePalette(wu, paletteOut, colors, refinementPasses)
  return colors
}

/**
 * Exact nearest-palette search. Entries are sorted by green; the scan moves outward from the
 * pixel's green and stops in each direction once the green distance alone exceeds the best match.
 */
class PaletteSearch {
  readonly #red = new Int32Array(256)
  readonly #green = new Int32Array(256)
  readonly #blue = new Int32Array(256)
  readonly #index = new Int32Array(256)
  // Unsorted entries, so a caller's hint can be scored directly.
  readonly #byIndex = new Int32Array(256 * 3)
  #size = 0

  reset(palette: Uint8Array, colors: number, skip: number): void {
    const order: number[] = []
    for (let index = 0; index < colors; index += 1) {
      this.#byIndex[index * 3] = palette[index * 3] ?? 0
      this.#byIndex[index * 3 + 1] = palette[index * 3 + 1] ?? 0
      this.#byIndex[index * 3 + 2] = palette[index * 3 + 2] ?? 0
      if (index !== skip) order.push(index)
    }
    order.sort((a, b) => (palette[a * 3 + 1] ?? 0) - (palette[b * 3 + 1] ?? 0))
    this.#size = order.length
    for (let position = 0; position < order.length; position += 1) {
      const index = order[position] ?? 0
      this.#index[position] = index
      this.#red[position] = palette[index * 3] ?? 0
      this.#green[position] = palette[index * 3 + 1] ?? 0
      this.#blue[position] = palette[index * 3 + 2] ?? 0
    }
  }

  /** `hint` is a likely answer, such as the previous pixel's entry; it only bounds the scan. */
  nearest(r: number, g: number, b: number, hint: number): number {
    const red = this.#red
    const green = this.#green
    const blue = this.#blue
    const size = this.#size
    let low = 0
    let high = size
    while (low < high) {
      const middle = (low + high) >>> 1
      if ((green[middle] ?? 0) < g) low = middle + 1
      else high = middle
    }
    let bestIndex = this.#index[low < size ? low : size - 1] ?? 0
    let bestDistance = 0x7fffffff
    if (hint >= 0) {
      const hr = (this.#byIndex[hint * 3] ?? 0) - r
      const hg = (this.#byIndex[hint * 3 + 1] ?? 0) - g
      const hb = (this.#byIndex[hint * 3 + 2] ?? 0) - b
      // One more than the hint's distance, so an equally near sorted entry still wins ties.
      bestDistance = hr * hr + hg * hg + hb * hb + 1
      bestIndex = hint
    }
    let up = low
    let down = low - 1
    while (up < size || down >= 0) {
      if (up < size) {
        const dg = (green[up] ?? 0) - g
        const near = dg * dg
        if (near >= bestDistance) {
          up = size
        } else {
          const dr = (red[up] ?? 0) - r
          const db = (blue[up] ?? 0) - b
          const distance = near + dr * dr + db * db
          if (distance < bestDistance) {
            bestDistance = distance
            bestIndex = this.#index[up] ?? 0
          }
          up += 1
        }
      }
      if (down >= 0) {
        const dg = (green[down] ?? 0) - g
        const near = dg * dg
        if (near >= bestDistance) {
          down = -1
        } else {
          const dr = (red[down] ?? 0) - r
          const db = (blue[down] ?? 0) - b
          const distance = near + dr * dr + db * db
          if (distance < bestDistance) {
            bestDistance = distance
            bestIndex = this.#index[down] ?? 0
          }
          down -= 1
        }
      }
    }
    return bestIndex
  }
}

let paletteSearch: PaletteSearch | undefined

const refinementPasses = 3

/** Lloyd passes over the histogram bins: move each entry to the mean of the bins nearest to it. */
const refinePalette = (
  wu: WuScratch,
  palette: Uint8Array,
  colors: number,
  passes: number,
): void => {
  const { binWeight, binRed, binGreen, binBlue, bins } = wu
  let binCount = 0
  for (let bin = 0; bin < histogramSize; bin += 1) {
    if ((binWeight[bin] ?? 0) > 0) {
      bins[binCount] = bin
      binCount += 1
    }
  }
  if (binCount <= colors) return
  paletteSearch ??= new PaletteSearch()
  const search = paletteSearch
  const sums = new Float64Array(colors * 4)
  for (let pass = 0; pass < passes; pass += 1) {
    search.reset(palette, colors, -1)
    sums.fill(0)
    for (let item = 0; item < binCount; item += 1) {
      const bin = bins[item] ?? 0
      const weight = binWeight[bin] ?? 0
      const r = (binRed[bin] ?? 0) / weight
      const g = (binGreen[bin] ?? 0) / weight
      const b = (binBlue[bin] ?? 0) / weight
      const index = search.nearest(Math.round(r), Math.round(g), Math.round(b), -1) * 4
      sums[index] = (sums[index] ?? 0) + weight
      sums[index + 1] = (sums[index + 1] ?? 0) + (binRed[bin] ?? 0)
      sums[index + 2] = (sums[index + 2] ?? 0) + (binGreen[bin] ?? 0)
      sums[index + 3] = (sums[index + 3] ?? 0) + (binBlue[bin] ?? 0)
    }
    for (let index = 0; index < colors; index += 1) {
      const weight = sums[index * 4] ?? 0
      if (weight <= 0) continue
      palette[index * 3] = Math.round((sums[index * 4 + 1] ?? 0) / weight)
      palette[index * 3 + 1] = Math.round((sums[index * 4 + 2] ?? 0) / weight)
      palette[index * 3 + 2] = Math.round((sums[index * 4 + 3] ?? 0) / weight)
    }
  }
}

// Summed absolute RGB difference to the left and upper neighbors at which dithering stops.
const contrastLimit = 48
// Largest error, in levels per channel, that diffusion may add to one pixel.
const errorCap = 32

// Nearest entries are cached per 6-bit channel cell. Index plus one; zero is unknown.
const cacheBits = 18
let nearestCache: Uint16Array | undefined

export const mapGifPalette = (
  rgba: Uint8Array,
  offset: number,
  stride: number,
  width: number,
  height: number,
  palette: Uint8Array,
  colors: number,
  transparentIndex: number,
  dither: number,
  indices: Uint8Array,
): void => {
  nearestCache ??= new Uint16Array(1 << cacheBits)
  const cache = nearestCache
  cache.fill(0)
  paletteSearch ??= new PaletteSearch()
  const search = paletteSearch
  search.reset(palette, colors, transparentIndex)
  if (dither <= 0) {
    let lastKey = -1
    let lastIndex = 0
    let target = 0
    for (let y = 0; y < height; y += 1) {
      let source = offset + y * stride
      for (let x = 0; x < width; x += 1, source += 4, target += 1) {
        if ((rgba[source + 3] ?? 0) < gifAlphaThreshold) {
          indices[target] = transparentIndex
          continue
        }
        const r = rgba[source] ?? 0
        const g = rgba[source + 1] ?? 0
        const b = rgba[source + 2] ?? 0
        const key = (r << 16) | (g << 8) | b
        if (key !== lastKey) {
          const cell = ((r >>> 2) << 12) | ((g >>> 2) << 6) | (b >>> 2)
          let entry = cache[cell] ?? 0
          if (entry === 0) {
            entry = search.nearest(r, g, b, lastIndex === transparentIndex ? -1 : lastIndex) + 1
            cache[cell] = entry
          }
          lastKey = key
          lastIndex = entry - 1
        }
        indices[target] = lastIndex
      }
    }
    return
  }

  // Errors are kept in 1/16 units for the current and next row, with one guard pixel each side.
  const strength = Math.round(Math.min(1, dither) * 256)
  let current = new Int32Array((width + 2) * 3)
  let following = new Int32Array((width + 2) * 3)
  // The previous pixel's entry bounds the next search.
  let hint = -1
  for (let y = 0; y < height; y += 1) {
    const reverse = (y & 1) === 1
    const step = reverse ? -1 : 1
    const rowSource = offset + y * stride
    const rowTarget = y * width
    for (let i = 0; i < width; i += 1) {
      const x = reverse ? width - 1 - i : i
      const source = rowSource + x * 4
      const errorIndex = (x + 1) * 3
      if ((rgba[source + 3] ?? 0) < gifAlphaThreshold) {
        indices[rowTarget + x] = transparentIndex
        continue
      }
      // Dither fully in smooth areas, less where the source already has edges or texture.
      const sourceR = rgba[source] ?? 0
      const sourceG = rgba[source + 1] ?? 0
      const sourceB = rgba[source + 2] ?? 0
      const left = x > 0 ? source - 4 : source + 4
      const above = y > 0 ? source - stride : source
      const contrast =
        Math.abs(sourceR - (rgba[left] ?? 0)) +
        Math.abs(sourceG - (rgba[left + 1] ?? 0)) +
        Math.abs(sourceB - (rgba[left + 2] ?? 0)) +
        Math.abs(sourceR - (rgba[above] ?? 0)) +
        Math.abs(sourceG - (rgba[above + 1] ?? 0)) +
        Math.abs(sourceB - (rgba[above + 2] ?? 0))
      const local =
        contrast >= contrastLimit
          ? 0
          : ((strength * (contrastLimit - contrast)) / contrastLimit) | 0
      let errorR = ((current[errorIndex] ?? 0) * local) >> 12
      let errorG = ((current[errorIndex + 1] ?? 0) * local) >> 12
      let errorB = ((current[errorIndex + 2] ?? 0) * local) >> 12
      errorR = errorR < -errorCap ? -errorCap : errorR > errorCap ? errorCap : errorR
      errorG = errorG < -errorCap ? -errorCap : errorG > errorCap ? errorCap : errorG
      errorB = errorB < -errorCap ? -errorCap : errorB > errorCap ? errorCap : errorB
      let r = sourceR + errorR
      let g = sourceG + errorG
      let b = sourceB + errorB
      r = r < 0 ? 0 : r > 255 ? 255 : r
      g = g < 0 ? 0 : g > 255 ? 255 : g
      b = b < 0 ? 0 : b > 255 ? 255 : b
      const cell = ((r >>> 2) << 12) | ((g >>> 2) << 6) | (b >>> 2)
      let entry = cache[cell] ?? 0
      if (entry === 0) {
        entry = search.nearest(r, g, b, hint) + 1
        cache[cell] = entry
      }
      const index = entry - 1
      hint = index
      indices[rowTarget + x] = index
      errorR = r - (palette[index * 3] ?? 0)
      errorG = g - (palette[index * 3 + 1] ?? 0)
      errorB = b - (palette[index * 3 + 2] ?? 0)
      const ahead = errorIndex + step * 3
      const behind = errorIndex - step * 3
      current[ahead] = (current[ahead] ?? 0) + errorR * 7
      current[ahead + 1] = (current[ahead + 1] ?? 0) + errorG * 7
      current[ahead + 2] = (current[ahead + 2] ?? 0) + errorB * 7
      following[behind] = (following[behind] ?? 0) + errorR * 3
      following[behind + 1] = (following[behind + 1] ?? 0) + errorG * 3
      following[behind + 2] = (following[behind + 2] ?? 0) + errorB * 3
      following[errorIndex] = (following[errorIndex] ?? 0) + errorR * 5
      following[errorIndex + 1] = (following[errorIndex + 1] ?? 0) + errorG * 5
      following[errorIndex + 2] = (following[errorIndex + 2] ?? 0) + errorB * 5
      following[ahead] = (following[ahead] ?? 0) + errorR
      following[ahead + 1] = (following[ahead + 1] ?? 0) + errorG
      following[ahead + 2] = (following[ahead + 2] ?? 0) + errorB
    }
    const swap = current
    current = following
    following = swap
    following.fill(0)
  }
}
