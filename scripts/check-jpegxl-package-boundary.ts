import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const replayOnly =
  /\b(?:JpegXlDevelopmentDecisions|developmentDecisions|developmentOrderFamilies|developmentFirstBlocks|developmentCorrelation|developmentFilters|encodeJpegXlDevelopmentModularGroup)\b|jpegxl-lab-codec\//u
export async function checkJpegXlPackageBoundary(codecs: string): Promise<void> {
  const names = (await readdir(codecs)).filter((name) => name.startsWith('jpegxl'))
  if (!names.includes('jpegxl-vardct-encode.js') || !names.includes('jpegxl-jpeg-encode.js'))
    throw new Error('Build the JPEG XL package before checking replay isolation')
  for (const name of names) {
    if (name.startsWith('jpegxl-development-decisions.'))
      throw new Error(`JPEG XL replay declaration was emitted to dist/codecs/${name}`)
    if (!name.endsWith('.js') && !name.endsWith('.d.ts')) continue
    const text = await readFile(join(codecs, name), 'utf8')
    const found = text.match(replayOnly)
    if (found)
      throw new Error(`JPEG XL replay field ${found[0]} was emitted to dist/codecs/${name}`)
  }
  console.log('Published JPEG XL codec modules exclude decision replay')
}

if (import.meta.main)
  await checkJpegXlPackageBoundary(fileURLToPath(new URL('../dist/codecs/', import.meta.url)))
