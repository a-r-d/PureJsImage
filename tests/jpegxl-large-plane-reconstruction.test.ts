import { expect, it } from 'vitest'
import { verifyJpegXlLargePlaneReconstruction } from './helpers/jpegxl-large-plane-reconstruction.ts'

it('preserves the prior large-window stream and pixel digests at moderate and coarse distances', async () => {
  // Measured on pushed c154f365 before the fused reconstruction change.
  expect(await verifyJpegXlLargePlaneReconstruction()).toEqual({
    width: 96,
    height: 64,
    inputChecksum: 2798721981,
    cases: [
      { distance: 2, bytes: 3251, encodedChecksum: 1207793515, decodedChecksum: 168456943 },
      { distance: 7, bytes: 1554, encodedChecksum: 2121071213, decodedChecksum: 710189350 },
    ],
  })
})

it('preserves the fine photo stream, geometry and scratch cleanup', async () => {
  // Measured on pushed ad7c275a before the DCT16 rounding/error fusion.
  expect(await verifyJpegXlLargePlaneReconstruction([0.65])).toEqual({
    width: 96,
    height: 64,
    inputChecksum: 2798721981,
    cases: [
      { distance: 0.65, bytes: 4540, encodedChecksum: 3419419173, decodedChecksum: 3673000494 },
    ],
  })
})

it('preserves fine cone and coarse photo streams at effort 9', async () => {
  // The same pre-fusion public fixture exercises the untuned effort-9 path.
  expect(await verifyJpegXlLargePlaneReconstruction([0.65, 2, 7], 9)).toEqual({
    width: 96,
    height: 64,
    inputChecksum: 2798721981,
    cases: [
      { distance: 0.65, bytes: 4352, encodedChecksum: 2402615198, decodedChecksum: 4285852333 },
      { distance: 2, bytes: 3130, encodedChecksum: 1113709489, decodedChecksum: 2758444065 },
      { distance: 7, bytes: 1509, encodedChecksum: 218794502, decodedChecksum: 1419390579 },
    ],
  })
})
