// Frozen benchmark mapping, independent of encoder distance and image statistics.
// Relative RGBE radiance 1 is assigned 203 nits. This is a display assignment,
// not a claim that the source camera measured absolute luminance.
export const m7PqFromRelativeLight = (light: number): number => {
  if (!Number.isFinite(light) || light < 0) throw new Error('Invalid relative light')
  const normalized = Math.min(1, (light * 203) / 10000)
  const power = normalized ** (2610 / 16384)
  return ((3424 / 4096 + (2413 / 128) * power) / (1 + (2392 / 128) * power)) ** (2523 / 32)
}

export const m7RelativeLightFromPq = (encoded: number): number => {
  if (!Number.isFinite(encoded) || encoded < 0 || encoded > 1)
    throw new Error('Invalid normalized PQ sample')
  const power = encoded ** (32 / 2523)
  return (
    (Math.max(0, power - 3424 / 4096) / (2413 / 128 - (2392 / 128) * power)) ** (16384 / 2610) *
    (10000 / 203)
  )
}

export const m7DisplaySample = (light: number, headroom: 1 | 2 | 4): number => {
  if (!Number.isFinite(light)) throw new Error('Invalid display light')
  const normalized = Math.min(1, Math.max(0, light / headroom))
  const srgb =
    normalized <= 0.0031308 ? 12.92 * normalized : 1.055 * normalized ** (1 / 2.4) - 0.055
  return Math.round(srgb * 255)
}

export const m7CompositeSample = (color: number, alpha: number, background: 0 | 1): number => {
  if (
    !Number.isInteger(color) ||
    color < 0 ||
    color > 255 ||
    !Number.isInteger(alpha) ||
    alpha < 0 ||
    alpha > 255
  )
    throw new Error('Invalid RGBA8 sample')
  const encoded = color / 255
  const light = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
  const opacity = alpha / 255
  return m7DisplaySample(light * opacity + background * (1 - opacity), 1)
}
