import { join } from 'node:path'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { FileSource } from '../../src/source.ts'
import { avifCorpusDirectory, avifFixtures } from './corpus.ts'

let codedImages = 0
let grids = 0
let alphaImages = 0
const configurationMismatches: string[] = []

for (const fixture of avifFixtures) {
  const inspection = await inspectAvifBitstreams(
    await FileSource.open(join(avifCorpusDirectory, fixture.file)),
  )
  codedImages += inspection.codedImages.length
  if (inspection.primaryItemType === 'grid') grids += 1
  if (inspection.alphaItemId !== undefined) alphaImages += 1
  for (const image of inspection.codedImages) {
    if (!image.configurationMatchesSequence) {
      configurationMismatches.push(`${fixture.file}#${image.itemId}`)
    }
  }
  console.log(
    `${fixture.file}: ${inspection.primaryItemType}, ${inspection.codedImages.length} coded item(s)`,
  )
}

console.log(
  `verified ${avifFixtures.length}/${avifFixtures.length} files, ${codedImages} unique coded items, ${grids} grid, ${alphaImages} with alpha`,
)
console.log(
  configurationMismatches.length === 0
    ? 'all av1C records match their sequence headers'
    : `${configurationMismatches.length} av1C mismatch(es): ${configurationMismatches.join(', ')}`,
)
