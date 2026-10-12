import type { LabMode } from './fixture-selection.ts'

interface LadderOptions {
  readonly mode: LabMode
  readonly promotion: boolean
  readonly finalReport: boolean
  readonly effort: 7 | 9
  readonly branch?: string
}

/** Keep the campaign ladder fixed; only the final main report extends it. */
export function lossyLabDistances(options: LadderOptions): readonly number[] {
  if (options.finalReport) {
    if (
      options.mode !== 'lab' ||
      !options.promotion ||
      options.effort !== 7 ||
      options.branch !== 'main'
    )
      throw new Error('Distances 10 and 14 require the final effort-7 lab report on promoted main')
    return [0.45, 0.65, 0.9, 1.3, 1.85, 3, 3.8, 5.35, 7.5, 10, 14]
  }
  if (options.mode === 'speed') return [2]
  return options.mode === 'screen' || options.mode === 'scale'
    ? [0.5, 1, 2, 4, 7]
    : [0.45, 0.65, 0.9, 1.3, 1.85, 3, 3.8, 5.35, 7.5]
}
