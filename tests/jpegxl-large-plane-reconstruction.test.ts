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
