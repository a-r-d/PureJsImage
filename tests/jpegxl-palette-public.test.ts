import { expect, it } from 'vitest'
import { verifyJpegXlPalettePublic } from './helpers/jpegxl-palette-public.ts'
it('preserves exact palette choices and optional probe ownership through public APIs', async () => {
  const result = await verifyJpegXlPalettePublic()
  expect(result.rawRgb.maximumColorError).toBe(0)
  expect(result.containerRgba.maximumColorError).toBe(0)
  expect(result.cancellation.abortError).toBe(true)
}, 120000)
