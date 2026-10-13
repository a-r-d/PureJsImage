/**
 * Sources: libjxl lib/jxl/enc_adaptive_quantization.cc (InitialQuantDC) and
 * lib/jxl/quant_weights.h (DC matrix), v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript; return physical DC steps for our existing writer,
 * leaving AC global scale and quantization untouched. Development experiment.
 */
import type { JpegXlDevelopmentDecisions } from '../../../src/codecs/jpegxl-development-decisions.ts'

export function libjxlDcOverrides(distance: number, smooth: boolean): JpegXlDevelopmentDecisions {
  if (!(distance >= 0.25 && distance <= 25)) throw new Error('Invalid DC-port distance')
  const dcDistance = Math.max(0.5 * distance, Math.min(distance, 0.3 * (distance / 0.3) ** 0.83))
  const quant = Math.min(1.095924047623553 / dcDistance, 50)
  return {
    dc: {
      globalScale: 65536,
      quantDc: 1,
      quantization: [1 / (4096 * quant), 1 / (512 * quant), 1 / (256 * quant)],
    },
    ...(smooth ? { rewriteGeometry: (base) => ({ ...base, smoothDc: true }) } : {}),
  }
}
