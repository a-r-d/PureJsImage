import { invalidInput } from './errors.ts'

export const gainMapHeadroomWeight = (
  baseHdrHeadroom: number,
  alternateHdrHeadroom: number,
  displayBoost: number,
): number => {
  if (
    !Number.isFinite(baseHdrHeadroom) ||
    !Number.isFinite(alternateHdrHeadroom) ||
    !Number.isFinite(displayBoost) ||
    displayBoost < 1
  ) {
    throw invalidInput('Gain-map display headrooms and boost must be finite, with boost at least 1')
  }
  if (baseHdrHeadroom === alternateHdrHeadroom) return 0
  const interpolation = Math.max(
    0,
    Math.min(
      1,
      (Math.log2(displayBoost) - baseHdrHeadroom) / (alternateHdrHeadroom - baseHdrHeadroom),
    ),
  )
  return alternateHdrHeadroom < baseHdrHeadroom ? -interpolation : interpolation
}
