import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const geoShowcaseSourceAliases: Readonly<Record<string, string>> = Object.freeze({
  'purejsimage/geo': resolve(repositoryRoot, 'src/geo/index.ts'),
  'purejsimage/geo/browser': resolve(repositoryRoot, 'src/geo/browser.ts'),
  'purejsimage/geo/readers/geotiff': resolve(repositoryRoot, 'src/geo/readers/geotiff.ts'),
  'purejsimage/geo/readers/geozarr': resolve(repositoryRoot, 'src/geo/readers/geozarr/index.ts'),
})

const requiredGeoShowcaseInputs = [
  'src/geo/index.ts',
  'src/geo/browser.ts',
  'src/geo/readers/geotiff.ts',
  'src/geo/readers/geozarr/index.ts',
] as const

export const assertGeoShowcaseSourceInputs = (inputs: readonly string[]): void => {
  const normalized = inputs.map((input) => input.replaceAll('\\', '/'))
  if (normalized.some((input) => input.startsWith('dist/') || input.includes('/dist/'))) {
    throw new Error('Geo showcase source build resolved a package-self import through dist')
  }
  for (const required of requiredGeoShowcaseInputs) {
    if (!normalized.some((input) => input.endsWith(required))) {
      throw new Error(`Geo showcase source build did not include ${required}`)
    }
  }
}
