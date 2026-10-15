/**
 * Source: libjxl lib/jxl/enc_ac_strategy.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: first-party row traversal of the already ported eighth-power spatial
 * loss. Preserves pixel and arithmetic order; removes per-pixel division and
 * remainder. Uses the existing bounded tile mask and adds no allocation.
 */
export function selectorMaskLoss(
  spatial: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  maskOrigin: number,
  maskOffset: number,
  channelWeight: number,
): number {
  let loss = 0,
    p = 0
  for (let y = 0; y < height; y++) {
    let at = maskOrigin + y * 64
    for (let x = 0; x < width; x++, p++, at++) {
      let error = (spatial[p] ?? 0) * ((mask[at] ?? 1) + maskOffset) * channelWeight
      error *= error
      error *= error
      error *= error
      loss += error
    }
  }
  return loss
}
