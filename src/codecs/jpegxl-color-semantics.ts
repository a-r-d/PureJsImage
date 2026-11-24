import type { PixelColorSemantics } from '../color.ts'

export const acceptsJpegXlColorSemantics = (semantics: PixelColorSemantics): boolean =>
  (semantics.chromaticities === undefined ||
    ((semantics.family !== 'gray' || semantics.chromaticities.primaries === undefined) &&
      [semantics.chromaticities.whitePoint, ...(semantics.chromaticities.primaries ?? [])].every(
        (point) =>
          [point.x, point.y].every(
            (value) => Number.isFinite(value) && Math.abs(value) <= 2.097151,
          ),
      ))) &&
  (semantics.family === 'gray' || semantics.family === 'rgb') &&
  (semantics.family === 'gray' ||
    semantics.primaries === 'srgb' ||
    semantics.primaries === 'display-p3' ||
    semantics.primaries === 'rec2020' ||
    (semantics.primaries === 'unspecified' && semantics.chromaticities?.primaries !== undefined)) &&
  (semantics.transfer.kind === 'srgb' ||
    semantics.transfer.kind === 'bt709' ||
    semantics.transfer.kind === 'linear' ||
    semantics.transfer.kind === 'pq' ||
    semantics.transfer.kind === 'hlg' ||
    (semantics.transfer.kind === 'gamma' &&
      semantics.transfer.exponent >= 1 &&
      semantics.transfer.exponent <= 8_192)) &&
  semantics.matrix === 'identity' &&
  semantics.range === 'full' &&
  (semantics.alpha === 'none' ||
    semantics.alpha === 'straight' ||
    semantics.alpha === 'premultiplied') &&
  (semantics.provenance === 'assumed-default' ||
    semantics.provenance === 'container-signaled' ||
    semantics.provenance === 'decoder-converted') &&
  (semantics.icc === undefined ||
    (semantics.provenance === 'decoder-converted' && semantics.icc.relevance === 'source'))

/**
 * Full-range samples whose source signaled no primaries or ICC profile. A transfer curve, such as
 * a PNG gAMA value, may still be signaled.
 */
export const isUntaggedJpegXlColorSemantics = (semantics: PixelColorSemantics): boolean =>
  semantics.primaries === 'unspecified' &&
  !semantics.chromaticities &&
  !semantics.icc &&
  semantics.provenance !== 'icc' &&
  semantics.transfer.kind !== 'source-profile' &&
  semantics.matrix === 'identity' &&
  semantics.range === 'full'

/** The JPEG XL codec's pipeline check. Untagged integer samples are encoded as sRGB, or in a kept ICC profile. */
export const acceptsJpegXlFloatColorSemantics = (semantics: PixelColorSemantics): boolean =>
  acceptsJpegXlColorSemantics(semantics) ||
  isUntaggedJpegXlColorSemantics(semantics) ||
  ((semantics.family === 'gray' || semantics.family === 'rgb') &&
    semantics.transfer.kind === 'source-profile' &&
    semantics.icc !== undefined &&
    semantics.matrix === 'identity' &&
    semantics.range === 'full' &&
    (semantics.alpha === 'none' ||
      semantics.alpha === 'straight' ||
      semantics.alpha === 'premultiplied'))
