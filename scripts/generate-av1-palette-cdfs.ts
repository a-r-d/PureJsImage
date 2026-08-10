import { writeFile } from 'node:fs/promises'

const revision = '5e04f3f75e73a5898d7616c47c52f032144b8f80'
const specificationUrl = `https://raw.githubusercontent.com/AOMediaCodec/av1-spec/${revision}/10.additional.tables.md`
const outputPath = 'src/codecs/av1-palette-cdfs.ts'
const response = await fetch(specificationUrl)
if (!response.ok) {
  throw new Error(`AV1 specification request failed with HTTP ${response.status}`)
}
const specification = await response.text()

const table = (name: string): readonly (readonly number[])[] => {
  const nameOffset = specification.indexOf(name)
  const opening = specification.indexOf('{', nameOffset)
  if (nameOffset < 0 || opening < 0) {
    throw new Error(`AV1 specification table ${name} is missing`)
  }
  let depth = 0
  let closing = -1
  for (let index = opening; index < specification.length; index += 1) {
    const character = specification[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        closing = index
        break
      }
    }
  }
  if (closing < 0) throw new Error(`AV1 specification table ${name} is unterminated`)
  const body = specification.slice(opening + 1, closing)
  const rows = [...body.matchAll(/\{([^{}]+)\}/g)].map((row) =>
    [...(row[1]?.matchAll(/\d+/g) ?? [])].map((value) => Number(value[0])),
  )
  if (rows.length === 0 || rows.some((row) => row.length < 3)) {
    throw new Error(`AV1 specification table ${name} is malformed`)
  }
  for (const row of rows) {
    if (row.at(-2) !== 32768 || row.at(-1) !== 0) {
      throw new Error(`AV1 specification table ${name} has an invalid CDF row`)
    }
  }
  return rows
}

const chunks = <T>(values: readonly T[], size: number): readonly (readonly T[])[] => {
  if (values.length % size !== 0) throw new Error('AV1 palette table has invalid dimensions')
  return Array.from({ length: values.length / size }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  )
}

const paletteYModeRows = table('Default_Palette_Y_Mode_Cdf')
const paletteUvModeDefaults = table('Default_Palette_Uv_Mode_Cdf')
const paletteYSizeDefaults = table('Default_Palette_Y_Size_Cdf')
const paletteUvSizeDefaults = table('Default_Palette_Uv_Size_Cdf')
if (
  paletteYModeRows.length !== 21 ||
  paletteUvModeDefaults.length !== 2 ||
  paletteYSizeDefaults.length !== 7 ||
  paletteUvSizeDefaults.length !== 7
) {
  throw new Error('AV1 palette mode or size tables have invalid dimensions')
}
const paletteYModeDefaults = chunks(paletteYModeRows, 3)
const paletteSizeDefaults = [paletteYSizeDefaults, paletteUvSizeDefaults]
const colorMapDefaults = ['Y', 'Uv'].map((plane) =>
  Array.from({ length: 7 }, (_, index) => {
    const size = index + 2
    const rows = table(`Default_Palette_Size_${size}_${plane}_Color_Cdf`)
    if (rows.length !== 5 || rows.some((row) => row.length !== size + 1)) {
      throw new Error(`AV1 palette size ${size} ${plane} color table has invalid dimensions`)
    }
    return rows
  }),
)

const source =
  `// Generated from AV1 specification 10.additional.tables.md at ${revision}.\n` +
  `// Regenerate with scripts/generate-av1-palette-cdfs.ts; do not edit manually.\n` +
  `export const paletteYModeDefaults = ${JSON.stringify(paletteYModeDefaults)} as const\n\n` +
  `export const paletteUvModeDefaults = ${JSON.stringify(paletteUvModeDefaults)} as const\n\n` +
  `export const paletteSizeDefaults = ${JSON.stringify(paletteSizeDefaults)} as const\n\n` +
  `export const colorMapDefaults = ${JSON.stringify(colorMapDefaults)} as const\n`
await writeFile(outputPath, source)
console.log(`Generated ${outputPath} from AV1 specification ${revision}`)
