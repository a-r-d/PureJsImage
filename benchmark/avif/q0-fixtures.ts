import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const avifQ0LossyFixture = {
  file: 'lossy-q0-64x48.avif',
  width: 64,
  height: 48,
  baseQuantizer: 12,
  fileSha256: 'f9e59230b447870f951d3366f79b4148d49f8d3976551b7b01a797bb50c6706b',
  decodedRgbaSha256: 'ee1efab2133069f67916f8464194272fde9694b378d899720b29bec5e0b04fad',
} as const

export const avifQ0LosslessFixture = {
  file: 'lossless-q0-64x48.avif',
  width: 64,
  height: 48,
  baseQuantizer: 0,
  fileSha256: '766ec8131a8155f3762a961116b95489683959dc30bcb245fd8b3b4f013935ad',
  decodedRgbaSha256: 'd49269082c04c18e7c81ef36bed98bbcd34dd0217e7d4042dad22801fbbbd7bf',
} as const

export const avifQ0FixtureDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'corpus',
  'files',
  'avif',
)
