/** Exact byte permutations for development metric invariance checks. */
export const displayAuditTransforms = [
  'identity',
  'flipX',
  'flipY',
  'rotate180',
  'transpose',
] as const
export type DisplayAuditTransform = (typeof displayAuditTransforms)[number]
export function transformSquareRgba(
  bytes: Uint8Array,
  size: number,
  kind: DisplayAuditTransform,
): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 1 || bytes.length !== size * size * 4)
    throw new Error('Invalid square RGBA extent')
  const out = new Uint8Array(bytes.length)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx =
        kind === 'transpose' ? y : kind === 'flipX' || kind === 'rotate180' ? size - 1 - x : x
      const sy =
        kind === 'transpose' ? x : kind === 'flipY' || kind === 'rotate180' ? size - 1 - y : y
      for (let c = 0; c < 4; c++) out[(y * size + x) * 4 + c] = bytes[(sy * size + sx) * 4 + c] ?? 0
    }
  return out
}
