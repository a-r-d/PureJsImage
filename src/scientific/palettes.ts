import { invalidInput } from '../errors.ts'

export type ScientificPalette = 'grayscale' | 'viridis' | 'magma' | 'inferno' | 'plasma'

type Rgb = readonly [number, number, number]

interface PaletteStop {
  readonly at: number
  readonly color: Rgb
}

const palette = (entries: readonly PaletteStop[]): readonly PaletteStop[] => Object.freeze(entries)

const stops: Readonly<Record<Exclude<ScientificPalette, 'grayscale'>, readonly PaletteStop[]>> =
  Object.freeze({
    viridis: palette([
      { at: 0, color: [68, 1, 84] },
      { at: 0.13, color: [71, 44, 122] },
      { at: 0.25, color: [59, 82, 139] },
      { at: 0.38, color: [44, 113, 142] },
      { at: 0.5, color: [33, 145, 140] },
      { at: 0.63, color: [39, 173, 129] },
      { at: 0.75, color: [94, 201, 98] },
      { at: 0.88, color: [170, 220, 50] },
      { at: 1, color: [253, 231, 37] },
    ]),
    magma: palette([
      { at: 0, color: [0, 0, 4] },
      { at: 0.13, color: [28, 16, 68] },
      { at: 0.25, color: [79, 18, 123] },
      { at: 0.38, color: [129, 37, 129] },
      { at: 0.5, color: [181, 54, 122] },
      { at: 0.63, color: [229, 80, 100] },
      { at: 0.75, color: [251, 135, 97] },
      { at: 0.88, color: [254, 194, 135] },
      { at: 1, color: [252, 253, 191] },
    ]),
    inferno: palette([
      { at: 0, color: [0, 0, 4] },
      { at: 0.13, color: [31, 12, 72] },
      { at: 0.25, color: [85, 15, 109] },
      { at: 0.38, color: [136, 34, 106] },
      { at: 0.5, color: [186, 54, 85] },
      { at: 0.63, color: [227, 89, 51] },
      { at: 0.75, color: [249, 140, 10] },
      { at: 0.88, color: [249, 201, 50] },
      { at: 1, color: [252, 255, 164] },
    ]),
    plasma: palette([
      { at: 0, color: [13, 8, 135] },
      { at: 0.13, color: [75, 3, 161] },
      { at: 0.25, color: [126, 3, 168] },
      { at: 0.38, color: [168, 34, 150] },
      { at: 0.5, color: [203, 70, 121] },
      { at: 0.63, color: [229, 107, 93] },
      { at: 0.75, color: [248, 148, 65] },
      { at: 0.88, color: [253, 195, 40] },
      { at: 1, color: [240, 249, 33] },
    ]),
  })

const interpolate = (from: number, to: number, amount: number): number =>
  Math.round(from + (to - from) * amount)

const paletteTable = (paletteStops?: readonly PaletteStop[]): Uint8Array => {
  const table = new Uint8Array(256 * 3)
  for (let sample = 0; sample < 256; sample += 1) {
    const normalized = sample / 255
    const offset = sample * 3
    if (paletteStops === undefined) {
      table[offset] = sample
      table[offset + 1] = sample
      table[offset + 2] = sample
      continue
    }
    for (let index = 1; index < paletteStops.length; index += 1) {
      const upper = paletteStops[index]
      const lower = paletteStops[index - 1]
      if (!upper || !lower || normalized > upper.at) continue
      const amount = (normalized - lower.at) / (upper.at - lower.at)
      table[offset] = interpolate(lower.color[0], upper.color[0], amount)
      table[offset + 1] = interpolate(lower.color[1], upper.color[1], amount)
      table[offset + 2] = interpolate(lower.color[2], upper.color[2], amount)
      break
    }
  }
  return table
}

const tables: Readonly<Record<ScientificPalette, Uint8Array>> = Object.freeze({
  grayscale: paletteTable(),
  viridis: paletteTable(stops.viridis),
  magma: paletteTable(stops.magma),
  inferno: paletteTable(stops.inferno),
  plasma: paletteTable(stops.plasma),
})

export const scientificPaletteTable = (palette: ScientificPalette): Uint8Array => {
  const table = tables[palette]
  if (!table) throw invalidInput(`Unknown scientific palette ${palette}`)
  return table
}

export const scientificPaletteColor = (palette: ScientificPalette, value: number): Rgb => {
  const table = scientificPaletteTable(palette)
  const offset = Math.round(Math.max(0, Math.min(1, value)) * 255) * 3
  return [table[offset] ?? 0, table[offset + 1] ?? 0, table[offset + 2] ?? 0]
}
