import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LabMode } from './fixture-selection.ts'

export const prepareLabOutputDirectory = async (
  directory: string,
  mode: LabMode,
  resumeSpeed: boolean,
): Promise<void> => {
  if (mode === 'speed' && !resumeSpeed) {
    // Fresh timings must never replace an earlier measurement's raw records.
    await mkdir(dirname(directory), { recursive: true })
    await mkdir(directory)
  } else await mkdir(directory, { recursive: true })
}
