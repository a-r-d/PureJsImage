import type { JpegXlDevelopmentDecisions } from '../../../src/codecs/jpegxl-development-decisions.ts'
import { libjxlDcOverrides } from './libjxl-dc-port.ts'

export interface AllocationPoint {
  alpha: number
  acScale: number
  smoothing: 'off' | 'on' | 'own'
}

export function parseAllocation(value: string): AllocationPoint {
  const [alphaText, scaleText, smoothing, extra] = value.split(',')
  const alpha = Number(alphaText),
    acScale = Number(scaleText)
  if (
    !['0', '0.25', '0.5', '0.75', '1'].includes(alphaText ?? '') ||
    !['0.8', '1', '1.25', '1.6'].includes(scaleText ?? '') ||
    extra !== undefined ||
    (smoothing !== 'off' && smoothing !== 'on' && smoothing !== 'own')
  )
    throw new Error('Invalid allocation: use alpha,acScale,off|on|own')
  return { alpha, acScale, smoothing }
}

export function allocationOverrides(
  point: AllocationPoint,
  distance: number,
): JpegXlDevelopmentDecisions {
  const dc = libjxlDcOverrides(distance, false).dc
  if (!dc) throw new Error('Missing ported DC steps')
  return {
    allocation: {
      acPrecisionScale: point.acScale,
      dcAlpha: point.alpha,
      dcSteps: dc.quantization,
      ...(point.smoothing === 'own' ? {} : { smoothDc: point.smoothing === 'on' }),
    },
  }
}

export const allocationGrid: readonly AllocationPoint[] = [0, 0.25, 0.5, 0.75, 1].flatMap((alpha) =>
  [0.8, 1, 1.25, 1.6].flatMap((acScale): AllocationPoint[] => [
    { alpha, acScale, smoothing: 'off' },
    ...(alpha >= 0.5 ? [{ alpha, acScale, smoothing: 'on' as const }] : []),
  ]),
)

export function allocationName(point: AllocationPoint): string {
  return `a${point.alpha}-s${point.acScale}-${point.smoothing}`.replaceAll('.', 'p')
}
