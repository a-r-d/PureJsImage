import { invalidInput } from '../errors.ts'
import { FileSource } from '../node-source.ts'
import type { EnviDataset, EnviOpenOptions } from './formats/envi.ts'
import { openEnvi } from './formats/envi.ts'
export type {
  FitsDataset,
  FitsDocument,
  FitsHdu,
  FitsHeaderCard,
  FitsHeaderValue,
  FitsOpenOptions,
} from './formats/fits.ts'
export { openFits } from './formats/fits.ts'

export interface EnviPathOpenOptions extends Omit<EnviOpenOptions, 'header' | 'data'> {
  readonly dataPath?: string
}

const existingFile = async (path: string): Promise<boolean> => {
  const { stat } = await import('node:fs/promises')
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const associatedDataPath = async (headerPath: string): Promise<string> => {
  const { extname } = await import('node:path')
  const extension = extname(headerPath)
  const stem =
    extension.toLowerCase() === '.hdr' ? headerPath.slice(0, -extension.length) : headerPath
  const candidates = [stem, `${stem}.img`, `${stem}.dat`, `${stem}.raw`]
  for (const candidate of candidates) {
    if (candidate !== headerPath && (await existingFile(candidate))) return candidate
  }
  throw invalidInput(
    `Could not resolve the ENVI binary file associated with ${headerPath}; pass dataPath explicitly`,
  )
}

export const openEnviPath = async (
  headerPath: string,
  options: Readonly<EnviPathOpenOptions> = {},
): Promise<EnviDataset> => {
  const dataPath = options.dataPath ?? (await associatedDataPath(headerPath))
  const [header, data] = await Promise.all([FileSource.open(headerPath), FileSource.open(dataPath)])
  const { dataPath: _dataPath, ...portableOptions } = options
  return openEnvi({ ...portableOptions, header, data })
}

export type { EnviDataset, EnviOpenOptions } from './formats/envi.ts'
export { openEnvi } from './formats/envi.ts'
