export type M7DiagnosticPreparation =
  | { readonly kind: 'crop'; readonly centerX: number; readonly centerY: number }
  | { readonly kind: 'resize' }

/** Development-only derivatives. Never substitute these for the frozen original-size corpus. */
export const m7DiagnosticCases: readonly {
  readonly id: string
  readonly reason: string
  readonly preparation: M7DiagnosticPreparation
}[] = [
  {
    id: 'im26-5052',
    reason: 'French brochure size outlier and repeated fine text',
    preparation: { kind: 'crop', centerX: 0.68, centerY: 0.32 },
  },
  {
    id: 'im26-5034',
    reason: 'English brochure size outlier and serif text',
    preparation: { kind: 'crop', centerX: 0.68, centerY: 0.7 },
  },
  {
    id: 'im26-5334',
    reason: 'Table size outlier, colored rules and flat cells',
    preparation: { kind: 'crop', centerX: 0.245, centerY: 0.42 },
  },
  {
    id: 'im26-5032',
    reason: 'Map labels, thin colored lines and flat areas',
    preparation: { kind: 'crop', centerX: 0.49, centerY: 0.64 },
  },
  {
    id: 'im26-1030',
    reason: 'General photographic detail and color',
    preparation: { kind: 'resize' },
  },
  { id: 'im26-1416', reason: 'Sunset gradients and dark regions', preparation: { kind: 'resize' } },
  {
    id: 'im26-2018',
    reason: 'Monochrome photo outlier, skin and dark gradients',
    preparation: { kind: 'resize' },
  },
  { id: 'im26-2400', reason: 'Natural texture', preparation: { kind: 'resize' } },
]

export function m7DiagnosticGeometry(
  width: number,
  height: number,
  preparation: M7DiagnosticPreparation,
): { left: number; top: number; width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('Invalid diagnostic source dimensions')
  if (preparation.kind === 'resize') {
    const scale = Math.min(1, 1024 / Math.max(width, height))
    return {
      left: 0,
      top: 0,
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    }
  }
  if (
    ![preparation.centerX, preparation.centerY].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    )
  )
    throw new Error('Invalid diagnostic crop center')
  const cropWidth = Math.min(1024, width),
    cropHeight = Math.min(1024, height)
  return {
    left: Math.max(
      0,
      Math.min(width - cropWidth, Math.round(width * preparation.centerX - cropWidth / 2)),
    ),
    top: Math.max(
      0,
      Math.min(height - cropHeight, Math.round(height * preparation.centerY - cropHeight / 2)),
    ),
    width: cropWidth,
    height: cropHeight,
  }
}
