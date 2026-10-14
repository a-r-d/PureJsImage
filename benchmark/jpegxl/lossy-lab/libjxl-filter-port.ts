/**
 * Sources: libjxl lib/jxl/enc_frame.cc (LoopFilterFromParams) and
 * lib/jxl/enc_heuristics.cc (initial field and EPF sharpness), v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar defaults for effort 7, default decoding speed, SDR VarDCT.
 * No override machinery. Supplies independent filters when our old selector
 * is bypassed, avoiding computation of an EPF field that depends on that search.
 */
export function libjxlFilterDefaults(distance: number) {
  if (!(distance >= 0.25 && distance <= 25)) throw new Error('Invalid filter distance')
  const gaborish = distance > 0.5
  return {
    gaborish,
    epfIterations: Number(distance >= 0.7) + Number(distance >= 1.5) + Number(distance >= 4),
    sharpness: 4,
    quantDistance: gaborish ? distance : distance * 0.62,
  }
}
