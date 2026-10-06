import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { object } from '../benchmark/jpegxl/comparison/model.ts'
import {
  runJpegXlPipelines,
  verifyDenseLosslessTraining,
  verifyFastLosslessChannels,
  verifyFlatPaletteGraphic,
  verifyFloatJpegXl,
  verifyGroupedLosslessSearch,
  verifyJpegXlAlphaEntropy,
  verifyJpegXlArtwork,
  verifyJpegXlCoefficientOrders,
  verifyJpegXlDcAllocationRecovery,
  verifyJpegXlDcModel,
  verifyJpegXlFamilyContexts,
  verifyJpegXlLargeDocumentSelection,
  verifyJpegXlLocalContrast,
  verifyJpegXlPatchFeatures,
  verifyJpegXlRateDistortionSelection,
  verifyJpegXlScreenshotPatch,
  verifyJpegXlTreeEntropy,
  verifyLazyJpegXl,
  verifyLearnedLosslessFixture,
  verifyLearnedPalette,
  verifyLevelTenJpegXl,
  verifyLosslessPaletteRgba,
  verifyLosslessPatchFixture,
  verifyM7EffortOneGroups,
  verifyM7EffortSevenAlpha,
  verifyM7EffortSevenPq,
  verifyM7ExactRgbaFallback,
  verifyM7ForwardJpegXl,
  verifyM7ScalarPalettes,
  verifyOpaqueJpegXlGradient,
  verifyRepeatedLosslessColors,
  verifyReversibleLosslessColor,
  verifySampledZeroLearning,
  verifySmallGroupPatch,
} from './jpegxl-pipeline-harness.ts'

for (const width of [512, 513] as const)
  for (const effort of [1, 7] as const)
    test(`JPEG XL grouped lossless preserves hidden RGBA across runtimes, width=${width}, effort=${effort}`, async ({
      page,
    }) => {
      const expected = await verifyGroupedLosslessSearch(width, effort)
      expect(expected).toMatchObject({
        samples: width * 512 * 4,
        ownedLive: 0,
        ownedAllocations: 0,
      })
      await page.goto('/compatibility.html')
      const actual: unknown = await page.evaluate(
        async ({ width, effort }) => {
          const path = '/jpegxl-pipeline.js'
          return (await import(path)).verifyGroupedLosslessSearch(width, effort)
        },
        { width, effort },
      )
      expect(actual).toEqual(expected)
    })

for (const maxWorkingBytes of [undefined, 15_989_965]) {
  test(`JPEG XL dense training and original working fallback agree across runtimes, budget=${maxWorkingBytes}`, async ({
    page,
  }) => {
    const expected = await verifyDenseLosslessTraining(maxWorkingBytes)
    expect(expected).toMatchObject({
      bytes: maxWorkingBytes === undefined ? 17_033 : 17_116,
      encodedChecksum: maxWorkingBytes === undefined ? 1_356_082_369 : 1_452_409_174,
      samples: 513 * 257 * 3,
      ownedLive: 0,
      ownedAllocations: 0,
    })
    if (maxWorkingBytes !== undefined)
      expect(expected.ownedPeak).toBeLessThanOrEqual(maxWorkingBytes)
    await page.goto('/compatibility.html')
    const actual: unknown = await page.evaluate(async (maxWorkingBytes) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyDenseLosslessTraining(maxWorkingBytes)
    }, maxWorkingBytes)
    expect(actual).toEqual(expected)
  })
}

test('JPEG XL weighted DC compression preserves textured gradients across runtimes', async ({
  page,
}) => {
  const expected = await verifyJpegXlDcModel()
  expect(expected.bytes).toBe(4191)
  expect(expected.encodedChecksum).toBe(1900552218)
  expect(expected.inputChecksum).toBe(3720133924)
  expect(expected.decodedChecksum).toBe(142860718)
  expect(expected.samples).toBe(513 * 257 * 4)
  expect(expected.alphaError).toBe(0)
  expect(expected.ownedLive).toBe(0)
  expect(expected.ownedAllocations).toBe(0)
  expect(expected.ownedPeak).toBeLessThanOrEqual(16_777_216)
  await page.goto('/codec-validation.html')
  const result: unknown = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlDcModel()
  })
  expect(object(result)).toEqual(expected)
})

for (const asynchronous of [false, true]) {
  test(
    'JPEG XL optional DC allocation recovery agrees across runtimes, async=' + asynchronous,
    async ({ page }) => {
      const expected = await verifyJpegXlDcAllocationRecovery(asynchronous)
      expect(expected.bytes).toBe(4829)
      expect(expected.encodedChecksum).toBe(728017318)
      expect(expected.inputChecksum).toBe(3720133924)
      expect(expected.decodedChecksum).toBe(142860718)
      expect(expected.alphaError).toBe(0)
      expect(expected.rejectedAllocations).toBeGreaterThan(0)
      expect(expected.ownedPeak).toBeLessThanOrEqual(16_777_216)
      expect(expected.ownedLive).toBe(0)
      expect(expected.ownedAllocations).toBe(0)
      await page.goto('/codec-validation.html')
      const result: unknown = await page.evaluate(async (asynchronous) => {
        const path = '/jpegxl-pipeline.js'
        return (await import(path)).verifyJpegXlDcAllocationRecovery(asynchronous)
      }, asynchronous)
      expect(object(result)).toEqual(expected)
    },
  )
}

for (const maxWorkingBytes of [268435456, 1500000] as const)
  test(`JPEG XL flat palette compression and natural working fallback agree across runtimes, budget=${maxWorkingBytes}`, async ({
    page,
  }) => {
    const expected = await verifyFlatPaletteGraphic(maxWorkingBytes)
    expect(expected.bytes).toBe(maxWorkingBytes === 1500000 ? 10986 : 771)
    expect(expected.maximumAlphaError).toBe(0)
    expect(expected.ownedLive).toBe(0)
    expect(expected.ownedAllocations).toBe(0)
    expect(expected.ownedPeak).toBeLessThanOrEqual(maxWorkingBytes)
    await page.goto('/codec-validation.html')
    const result: unknown = await page.evaluate(async (maxWorkingBytes) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyFlatPaletteGraphic(maxWorkingBytes)
    }, maxWorkingBytes)
    const actual = object(result)
    expect(actual.bytes).toBe(expected.bytes)
    expect(actual.encodedChecksum).toBe(expected.encodedChecksum)
    expect(actual.inputChecksum).toBe(expected.inputChecksum)
    expect(actual.maximumAlphaError).toBe(0)
    expect(actual.ownedLive).toBe(0)
    expect(actual.ownedAllocations).toBe(0)
    expect(actual.ownedPeak).toBeLessThanOrEqual(maxWorkingBytes)
    if (maxWorkingBytes === 1500000) {
      // Native original-color error is ten; portable reconstruction may differ by one level.
      expect(actual.maximumColorError).toBeLessThanOrEqual(11)
    } else {
      expect(actual.decodedChecksum).toBe(2495421557)
      expect(actual.maximumColorError).toBe(8)
      expect(actual.preservedColorOccurrences).toBeGreaterThan(16)
      expect(actual.changedPreservedColors).toBe(0)
    }
  })

for (const maxSamples of [8192, 16384] as const)
  test(`JPEG XL sampled zero and mixed channel learning agree in Node and Chromium with ${maxSamples} samples`, async ({
    page,
  }) => {
    const expected = verifySampledZeroLearning(maxSamples)
    await page.goto('/compatibility.html')
    const actual: unknown = await page.evaluate(async (maxSamples) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifySampledZeroLearning(maxSamples)
    }, maxSamples)
    expect(actual).toEqual(expected)
  })

for (const format of ['rgb8', 'rgba8'] as const)
  test(`JPEG XL small patch groups and DC boundaries agree in Node and Chromium for ${format}`, async ({
    page,
  }) => {
    const expected = await verifySmallGroupPatch(format)
    await page.goto('/compatibility.html')
    const actual = await page.evaluate(async (format) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifySmallGroupPatch(format)
    }, format)
    expect(actual).toEqual(expected)
  })

for (const [offset, wide, limit, bits] of [
  [0, false, 1048576, 6783],
  [7, false, 1048576, 6783],
  [7, true, 1048576, 14966],
  [7, false, 5915, 9612],
] as const)
  test(`JPEG XL tree entropy fields and working fallback agree in Node and Chromium, offset=${offset}, wide=${wide}, limit=${limit}`, async ({
    page,
  }) => {
    const expected = verifyJpegXlTreeEntropy(offset, wide, limit)
    expect(expected.bits).toBe(bits)
    await page.goto('/compatibility.html')
    const actual: unknown = await page.evaluate(
      async ({ offset, wide, limit }) => {
        const path = '/jpegxl-pipeline.js'
        return (await import(path)).verifyJpegXlTreeEntropy(offset, wide, limit)
      },
      { offset, wide, limit },
    )
    expect(actual).toEqual(expected)
  })

for (const options of [
  { depth: 8, channels: 3 },
  { depth: 8, channels: 4 },
  { depth: 16, channels: 3 },
  { depth: 8, channels: 3, maxWorkingBytes: 1_883_954 },
  { depth: 8, channels: 4, maxWorkingBytes: 2_088_939 },
  { depth: 8, channels: 4, width: 1025 },
  { depth: 16, channels: 4, width: 1025 },
] as const)
  test(`JPEG XL learned palette samples and working limits agree in Node and Chromium, ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    const expected = await verifyLearnedPalette(options)
    expect(expected.decodedChecksum).toBe(expected.inputChecksum)
    expect(expected.ownedLive).toBe(0)
    expect(expected.ownedAllocations).toBe(0)
    await page.goto('/compatibility.html')
    const actual: unknown = await page.evaluate(async (options) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyLearnedPalette(options)
    }, options)
    expect(actual).toEqual(expected)
  })

test('JPEG XL alternate palette learning keeps exact visible artwork in Node and Chromium', async ({
  page,
}) => {
  const expected = await verifyJpegXlArtwork({ alpha: 'varying' })
  expect(expected.bytes).toBe(13_807)
  expect(expected.encodedChecksum).toBe(1_526_632_822)
  expect(expected.decodedChecksum).toBe(2_516_035_649)
  expect(expected.visibleError).toBe(0)
  expect(expected.alphaError).toBe(0)
  expect(expected.ownedLive).toBe(0)
  expect(expected.ownedAllocations).toBe(0)
  await page.goto('/compatibility.html')
  const actual: unknown = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlArtwork({ alpha: 'varying' })
  })
  expect(actual).toEqual(expected)
})

for (const extraChannels of [0, 1] as const)
  for (const bounded of [false, true])
    test(`JPEG XL patch metadata agrees in Node and Chromium, extraChannels=${extraChannels}, bounded=${bounded}`, async ({
      page,
    }) => {
      const maxWorkingBytes = bounded ? (extraChannels === 0 ? 23_373 : 27_981) : 1_048_576
      const expected = verifyJpegXlPatchFeatures(extraChannels, maxWorkingBytes)
      expect(expected.ownedLive).toBe(0)
      expect(expected.ownedAllocations).toBe(0)
      await page.goto('/compatibility.html')
      const actual: unknown = await page.evaluate(
        async ({ extraChannels, maxWorkingBytes }) => {
          const path = '/jpegxl-pipeline.js'
          return (await import(path)).verifyJpegXlPatchFeatures(extraChannels, maxWorkingBytes)
        },
        { extraChannels, maxWorkingBytes },
      )
      expect(actual).toEqual(expected)
    })

for (const alpha of ['varying', 'hidden'] as const)
  test(`JPEG XL alpha search retains exact ${alpha}-alpha artwork across runtimes`, async ({
    page,
  }) => {
    const expected = await verifyJpegXlArtwork({ alpha })
    expect(expected.bytes).toBe(13807)
    expect(expected.encodedChecksum).toBe(1526632822)
    expect(expected.decodedChecksum).toBe(2516035649)
    expect(expected.visibleError).toBe(0)
    expect(expected.alphaError).toBe(0)
    expect(expected.ownedLive).toBe(0)
    expect(expected.ownedAllocations).toBe(0)
    await page.goto('/codec-validation.html')
    const actual: unknown = await page.evaluate(async (alpha) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyJpegXlArtwork({ alpha })
    }, alpha)
    expect(actual).toEqual(expected)
  })

for (const maxWorkingBytes of [8_388_608, 16_777_216])
  test(`JPEG XL artwork candidate and storage fallback agree in Node and Chromium, budget=${maxWorkingBytes}`, async ({
    page,
  }) => {
    const expected = await verifyJpegXlArtwork({ maxWorkingBytes })
    expect(expected.alphaError).toBe(0)
    expect(expected.ownedLive).toBe(0)
    expect(expected.ownedAllocations).toBe(0)
    if (maxWorkingBytes === 16_777_216) {
      expect(expected.bytes).toBeLessThan(1_000)
      expect(expected.visibleError).toBe(0)
    } else {
      expect(expected.bytes).toBe(3159)
      expect(expected.encodedChecksum).toBe(2065653775)
    }
    await page.goto('/compatibility.html')
    const actual: unknown = await page.evaluate(async (maxWorkingBytes) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyJpegXlArtwork({ maxWorkingBytes })
    }, maxWorkingBytes)
    expect(actual).toEqual(expected)
  })

test('JPEG XL family context budget fallback agrees in Node and Chromium', async ({ page }) => {
  const expected = await verifyJpegXlFamilyContexts(8, false, false, 10_000_000)
  expect(expected.bytes).toBeLessThanOrEqual(17_950)
  expect(expected.alphaError).toBe(0)
  await page.goto('/compatibility.html')
  const actual: unknown = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlFamilyContexts(8, false, false, 10_000_000)
  })
  expect(actual).toEqual(expected)
})

for (const depth of [8, 16] as const)
  for (const progressive of [false, true])
    for (const opaque of [false, true])
      test(`JPEG XL family contexts agree in Node and Chromium, depth=${depth}, progressive=${progressive}, opaque=${opaque}`, async ({
        page,
      }) => {
        const expected = await verifyJpegXlFamilyContexts(depth, progressive, opaque, 16_777_216)
        expect(expected.alphaError).toBe(0)
        const exactPaletteFloor = depth === 8 && !progressive && opaque
        if (exactPaletteFloor) {
          expect(expected.bytes).toBe(2262)
          expect(expected.decodedChecksum).toBe(1714441565)
        }
        await page.goto(exactPaletteFloor ? '/codec-validation.html' : '/compatibility.html')
        const actual: unknown = await page.evaluate(
          async ({ depth, progressive, opaque }) => {
            const path = '/jpegxl-pipeline.js'
            return (await import(path)).verifyJpegXlFamilyContexts(
              depth,
              progressive,
              opaque,
              16_777_216,
            )
          },
          { depth, progressive, opaque },
        )
        expect(actual).toEqual(expected)
      })

test('JPEG XL adaptive order budget fallback agrees in Node and Chromium', async ({ page }) => {
  const expected = await verifyJpegXlCoefficientOrders(8, false, false, 7_350_000)
  expect(expected.bytes).toBeLessThanOrEqual(12_943)
  expect(expected.alphaError).toBe(0)
  await page.goto('/compatibility.html')
  const actual: unknown = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlCoefficientOrders(8, false, false, 7_350_000)
  })
  expect(actual).toEqual(expected)
})

for (const depth of [8, 16] as const)
  for (const progressive of [false, true])
    for (const opaque of [false, true])
      test(`JPEG XL adaptive coefficient orders agree in Node and Chromium, depth=${depth}, progressive=${progressive}, opaque=${opaque}`, async ({
        page,
      }) => {
        const expected = await verifyJpegXlCoefficientOrders(depth, progressive, opaque)
        expect(expected.alphaError).toBe(0)
        await page.goto('/compatibility.html')
        const actual: unknown = await page.evaluate(
          async ({ depth, progressive, opaque }) => {
            const path = '/jpegxl-pipeline.js'
            return (await import(path)).verifyJpegXlCoefficientOrders(depth, progressive, opaque)
          },
          { depth, progressive, opaque },
        )
        expect(actual).toEqual(expected)
      })

for (const depth of [8, 16] as const)
  test(`JPEG XL ${depth}-bit binary alpha bands agree in Node and Chromium`, async ({ page }) => {
    const expected = await verifyJpegXlAlphaEntropy(depth, true, true, 16_777_216, 'binary-bands')
    expect(expected.alphaError).toBe(0)
    expect(expected.bytes).toBeLessThan(1_600)
    await page.goto('/compatibility.html')
    const actual: unknown = await page.evaluate(async (depth) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyJpegXlAlphaEntropy(
        depth,
        true,
        true,
        16_777_216,
        'binary-bands',
      )
    }, depth)
    if (depth === 16) {
      expect(actual).toEqual(expected)
      return
    }
    const { decodedChecksum: _nodeChecksum, decodedPixels: reference, ...nodeFields } = expected
    const {
      decodedChecksum: _browserChecksum,
      decodedPixels: pixels,
      ...browserFields
    } = object(actual)
    expect(browserFields).toEqual(nodeFields)
    if (!reference || !Array.isArray(pixels) || pixels.length !== reference.length)
      throw new Error('Missing complete binary-alpha pixel grids')
    let maximumVisibleError = 0,
      maximumHiddenColorError = 0
    for (let index = 0; index < reference.length; index++) {
      const actual: unknown = pixels[index]
      const value = reference[index]
      if (typeof actual !== 'number' || value === undefined) throw new Error('Invalid pixel sample')
      if (index % 4 === 3 || reference[(index & ~3) + 3] !== 0)
        maximumVisibleError = Math.max(maximumVisibleError, Math.abs(actual - value))
      else maximumHiddenColorError = Math.max(maximumHiddenColorError, Math.abs(actual - value))
    }
    // Existing XYB-to-sRGB rounding differs by one level only at zero-alpha pixels.
    expect(maximumVisibleError).toBe(0)
    expect(maximumHiddenColorError).toBeLessThanOrEqual(1)
  })

for (const depth of [8, 16] as const)
  for (const maxWorkingBytes of [3_145_728, 67_108_864])
    test(`JPEG XL triangle alpha palettes preserve complete pixels across runtimes, depth=${depth}, budget=${maxWorkingBytes}`, async ({
      page,
    }) => {
      const dimensions = maxWorkingBytes === 67_108_864 ? { width: 512, height: 512 } : undefined
      const expected = await verifyJpegXlAlphaEntropy(
        depth,
        true,
        true,
        maxWorkingBytes,
        'triangles',
        dimensions,
      )
      expect(expected.alphaError).toBe(0)
      await page.goto('/compatibility.html')
      const actual: unknown = await page.evaluate(
        async ({ depth, maxWorkingBytes, dimensions }) => {
          const path = '/jpegxl-pipeline.js'
          return (await import(path)).verifyJpegXlAlphaEntropy(
            depth,
            true,
            true,
            maxWorkingBytes,
            'triangles',
            dimensions,
          )
        },
        { depth, maxWorkingBytes, dimensions },
      )
      if (depth === 16) {
        expect(actual).toEqual(expected)
        return
      }
      const { decodedChecksum: _expectedChecksum, decodedPixels: reference, ...fields } = expected
      const {
        decodedChecksum: _actualChecksum,
        decodedPixels: pixels,
        ...actualFields
      } = object(actual)
      expect(actualFields).toEqual(fields)
      if (!reference || !Array.isArray(pixels) || pixels.length !== reference.length)
        throw new Error('Missing complete triangle-alpha grids')
      let maximumAlphaError = 0,
        maximumColorError = 0
      for (let index = 0; index < reference.length; index++) {
        const value: unknown = pixels[index],
          target = reference[index]
        if (typeof value !== 'number' || target === undefined) throw new Error('Invalid sample')
        if (index % 4 === 3)
          maximumAlphaError = Math.max(maximumAlphaError, Math.abs(value - target))
        else maximumColorError = Math.max(maximumColorError, Math.abs(value - target))
      }
      expect(maximumAlphaError).toBe(0)
      expect(maximumColorError).toBeLessThanOrEqual(1)
    })

for (const depth of [8, 16] as const)
  for (const progressive of [false, true])
    test(`JPEG XL repeated ${depth}-bit alpha agrees in Node and Chromium, progressive=${progressive}`, async ({
      page,
    }) => {
      const expected = await verifyJpegXlAlphaEntropy(depth, progressive, true)
      expect(expected.alphaError).toBe(0)
      expect(expected.bytes).toBeLessThan(1_500)
      await page.goto('/compatibility.html')
      const actual = await page.evaluate(
        async ({ depth, progressive }) => {
          const path = '/jpegxl-pipeline.js'
          return (await import(path)).verifyJpegXlAlphaEntropy(depth, progressive, true)
        },
        { depth, progressive },
      )
      expect(actual).toEqual(expected)
    })

for (const depth of [8, 16] as const)
  test(`JPEG XL ${depth}-bit repeat scratch fallback agrees in Node and Chromium`, async ({
    page,
  }) => {
    const expected = await verifyJpegXlAlphaEntropy(depth, true, true, 3_145_728)
    const ordinary = await verifyJpegXlAlphaEntropy(depth, true, true)
    expect(expected.alphaError).toBe(0)
    expect(expected.decodedChecksum).toBe(ordinary.decodedChecksum)
    expect(expected.bytes).toBeGreaterThan(ordinary.bytes * 2)
    await page.goto('/compatibility.html')
    const actual = await page.evaluate(async (depth) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyJpegXlAlphaEntropy(depth, true, true, 3_145_728)
    }, depth)
    expect(actual).toEqual(expected)
  })

for (const depth of [8, 16] as const) {
  test(`JPEG XL reversible ${depth}-bit color agrees in Node and Chromium`, async ({ page }) => {
    const expected = await verifyReversibleLosslessColor(depth, 1)
    await page.goto('/compatibility.html')
    const actual = await page.evaluate(async (depth) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyReversibleLosslessColor(depth, 1)
    }, depth)
    expect(actual).toEqual(expected)
  })
}

for (const format of ['rgb8', 'rgba8'] as const) {
  for (const background of ['pale', 'flat'] as const) {
    test(`JPEG XL exact lossless ${background} patches agree in Node and Chromium for ${format}`, async ({
      page,
    }) => {
      const expected = await verifyLosslessPatchFixture(format, background)
      await page.goto('/compatibility.html')
      const actual = await page.evaluate(
        async ({ format, background }) => {
          const path = '/jpegxl-pipeline.js'
          return (await import(path)).verifyLosslessPatchFixture(format, background)
        },
        { format, background },
      )
      expect(actual).toEqual(expected)
    })
  }
}

for (const depth of [8, 16] as const) {
  for (const width of [1024, 1025] as const) {
    test(`JPEG XL learned ${depth}-bit lossless agrees in Node and browser at width ${width}`, async ({
      page,
    }) => {
      const expected = await verifyLearnedLosslessFixture(depth, width)
      await page.goto('/compatibility.html')
      const actual = await page.evaluate(
        async ({ depth, width }) => {
          const path = '/jpegxl-pipeline.js'
          return (await import(path)).verifyLearnedLosslessFixture(depth, width)
        },
        { depth, width },
      )
      expect(actual).toEqual(expected)
    })
  }
}

for (const depth of [8, 16] as const) {
  for (const constrained of [false, true]) {
    test(`JPEG XL effort-1 repeated ${depth}-bit colors and working recovery agree across runtimes, constrained=${constrained}`, async ({
      page,
    }) => {
      const budget = constrained ? (depth === 8 ? 2305794 : 2476162) : undefined
      const expected = await verifyRepeatedLosslessColors(depth, budget)
      expect(expected.bytes).toBe(
        constrained ? (depth === 8 ? 19594 : 36492) : depth === 8 ? 474 : 559,
      )
      expect(expected.inputChecksum).toBe(depth === 8 ? 794717347 : 4090140113)
      if (budget !== undefined) expect(expected.ownedPeak).toBeLessThanOrEqual(budget)
      await page.goto('/compatibility.html')
      const actual: unknown = await page.evaluate(
        async ({ depth, budget }) => {
          const path = '/jpegxl-pipeline.js'
          return (await import(path)).verifyRepeatedLosslessColors(depth, budget)
        },
        { depth, budget },
      )
      expect(actual).toEqual(expected)
    })
  }
  test(`JPEG XL effort-1 ${depth}-bit channel models agree in Node and browser`, async ({
    page,
  }) => {
    const expected = await verifyFastLosslessChannels(depth)
    await page.goto('/compatibility.html')
    const actual = await page.evaluate(async (depth) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyFastLosslessChannels(depth)
    }, depth)
    expect(actual).toEqual(expected)
  })
}

for (const progressive of [false, true]) {
  for (const partialAlpha of [false, true]) {
    test(`JPEG XL opaque gradients and final partial alpha agree in Node and Chromium, progressive=${progressive}, partialAlpha=${partialAlpha}`, async ({
      page,
    }) => {
      const expected = await verifyOpaqueJpegXlGradient(progressive, partialAlpha)
      expect(expected.alphaError).toBe(0)
      expect(expected.samples).toBe(129 * 65 * 3)
      expect(expected.meanColorError).toBeLessThan(partialAlpha ? 1.5 : 0.85)
      expect(expected.liveBytes).toBe(0)
      await page.goto('/compatibility.html')
      const actual = await page.evaluate(
        async ({ progressive, partialAlpha }) => {
          const path = '/jpegxl-pipeline.js'
          return (await import(path)).verifyOpaqueJpegXlGradient(progressive, partialAlpha)
        },
        { progressive, partialAlpha },
      )
      expect(actual).toEqual(expected)
    })
  }

  test(`JPEG XL local contrast transition agrees in Node and browser, progressive=${progressive}`, async ({
    page,
  }) => {
    const expected = []
    for (const distance of [1.99, 2.01, 3.99, 4.01])
      expected.push(await verifyJpegXlLocalContrast(progressive, distance))
    await page.goto('/compatibility.html')
    const actual = await page.evaluate(async (progressive) => {
      const path = '/jpegxl-pipeline.js'
      const { verifyJpegXlLocalContrast } = await import(path)
      const results = []
      for (const distance of [1.99, 2.01, 3.99, 4.01])
        results.push(await verifyJpegXlLocalContrast(progressive, distance))
      return results
    }, progressive)
    expect(actual).toEqual(expected)
  })

  test(`JPEG XL local contrast agrees in Node and browser, progressive=${progressive}`, async ({
    page,
  }) => {
    const expected = await verifyJpegXlLocalContrast(progressive)
    expect(expected.rmse).toBeLessThan(3)
    expect(expected.contrast).toBeGreaterThan(0.8)
    await page.goto('/compatibility.html')
    const actual = await page.evaluate(async (progressive) => {
      const path = '/jpegxl-pipeline.js'
      return (await import(path)).verifyJpegXlLocalContrast(progressive)
    }, progressive)
    expect(actual).toEqual(expected)
  })
}

test('JPEG XL rate-distortion selection agrees in Node and browser', async ({ page }) => {
  const expected = await verifyJpegXlRateDistortionSelection()
  expect(expected.selectedBytes).toBeLessThan(expected.conservativeBytes * 0.75)
  expect(expected.frames).toEqual([['regular', 'vardct']])
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlRateDistortionSelection()
  })
  expect(actual).toEqual(expected)
})

test('repeated screenshot JPEG XL patches agree in Node and Chromium', async ({ page }) => {
  const expected = await verifyJpegXlScreenshotPatch()
  expect(expected.frames).toEqual([
    ['reference', 'vardct', 128],
    ['regular', 'vardct', 130],
  ])
  expect(expected.samples).toBe(512 * 512 * 3)
  expect(expected.rmse).toBeLessThan(3)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlScreenshotPatch()
  })
  expect(actual).toEqual(expected)
})

test('large-document JPEG XL lossy selector agrees in Node and browser', async ({ page }) => {
  const expected = verifyJpegXlLargeDocumentSelection()
  expect(expected).toEqual({ eligible: true, darkExcluded: true })
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyJpegXlLargeDocumentSelection()
  })
  expect(actual).toEqual(expected)
})

test('lossless palette RGBA samples match in Node and browser', async ({ page }) => {
  const expected = await verifyLosslessPaletteRgba()
  expect(expected.rows).toBe(64)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyLosslessPaletteRgba()
  })
  expect(actual).toEqual(expected)
})

test('Level 10 binary32 native decode and writer signaling agree with Node', async ({ page }) => {
  const input = new Uint8Array(await readFile('tests/fixtures/jpegxl/m10-level10/lossless-pfm.jxl'))
  const expected = await verifyLevelTenJpegXl(input)
  expect(expected).toMatchObject({
    samples: 750_000,
    writerKind: 'container',
    writerLevel: 10,
    groupedSamples: 1_025,
    vardctKind: 'container',
    vardctLevel: 10,
    animationKind: 'container',
    animationLevel: 10,
    animationAlpha: [0, 1],
  })
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    const response = await fetch('/fixtures/jpegxl-m10-lossless-pfm.jxl')
    return module.verifyLevelTenJpegXl(new Uint8Array(await response.arrayBuffer()))
  })
  expect(actual).toEqual(expected)
})

test('VarDCT header indexing and opening defer pixels in Node and browser', async ({ page }) => {
  const input = new Uint8Array(
    await readFile(
      'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
    ),
  )
  const expected = await verifyLazyJpegXl(input)
  expect(expected.headerRequestedBytes).toBe(141)
  expect(expected.frameEnds).toEqual([10_829, 148_917])
  expect(expected.openPeakBytes).toBe(0)
  expect(expected.openRequestedBytes).toBeLessThan(input.length / 4)
  expect(expected.decodeDuringOpen).toBe(false)
  expect(expected.planPixelDecode).toBe(false)
  expect(expected.managedMemory.currentLiveBytes).toBe(0)
  expect(expected.managedMemory.peakLiveBytes).toBeGreaterThan(0)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    const response = await fetch('/fixtures/jpegxl-multi-group-progressive.jxl')
    return module.verifyLazyJpegXl(new Uint8Array(await response.arrayBuffer()))
  })
  expect(actual).toEqual(expected)
})

test('native float linear-light resize and explicit output conversion agree with Node', async ({
  page,
}) => {
  const input = new Uint8Array(
    await readFile('tests/fixtures/jpegxl/m4-color/vardct-linear-12.jxl'),
  )
  const expected = await verifyFloatJpegXl(input)
  expect(expected.width).toBe(4)
  expect(expected.height).toBe(3)
  expect(expected.colorSemantics?.transfer.kind).toBe('linear')
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    const response = await fetch('/fixtures/jpegxl-m4-vardct-linear-12.jxl')
    return module.verifyFloatJpegXl(new Uint8Array(await response.arrayBuffer()))
  })
  expect(actual).toEqual(expected)
})

test('JPEG XL M5 output workflows agree with Node for all fits, color, depth and alpha', async ({
  page,
}) => {
  const expected = await runJpegXlPipelines(
    async (name) => new Uint8Array(await readFile(`tests/fixtures/jpegxl/m4-color/${name}`)),
  )
  expect(expected).toHaveLength(105)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.runJpegXlPipelines()
  })
  expect(actual).toEqual(expected)
})

for (const id of ['srgb-12', 'p3-8', 'pq-10', 'vardct-linear-12']) {
  test(`workbench opens, inspects, resizes and exports ${id}`, async ({ page }) => {
    await page.goto('/jpeg-xl/convert/')
    await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
    await page.locator('#jxl-file').setInputFiles(`tests/fixtures/jpegxl/m4-color/${id}.jxl`)
    await expect(page.locator('#jxl-status')).toContainText(
      `${id}.jxl inspected and decoded locally`,
    )
    await page.locator('#jxl-width').fill('4')
    await page.locator('#jxl-height').fill('3')
    await page.locator('#jxl-transform').click()
    await expect(page.locator('#jxl-status')).toContainText('Image resized and exported locally')
    await expect(page.locator('#jxl-preview')).toHaveAttribute('width', '4')
    await expect(page.locator('#jxl-preview')).toHaveAttribute('height', '3')
    const download = page.waitForEvent('download')
    await page.locator('#jxl-download').click()
    expect((await download).suggestedFilename()).toBe(`${id}-resized.png`)
  })
}

test('segmented jxlp complete workflow agrees over real HTTP Range in Node and browser', async ({
  page,
  baseURL,
}) => {
  const { verifyRemoteJpegXl } = await import('./jpegxl-pipeline-harness.ts')
  const url = new URL('/fixtures/jpegxl-m5-segmented.jxl', baseURL).href
  const expected = await verifyRemoteJpegXl(url)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async (url) => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyRemoteJpegXl(url)
  }, url)
  expect(actual.values).toEqual(expected.values)
  const source = await readFile('tests/fixtures/jpegxl/m4-color/srgb-12.bin')
  const pixel = [0, 1, 2].map((c) =>
    Math.round((source.readUInt16BE(((7 + 2) * 3 + c) * 2) * 255) / 4095),
  )
  expect(actual.values).toEqual(Array.from({ length: 4 }, () => pixel).flat())
})

test('HDR storage metadata and gray-alpha regression workflows agree with Node', async ({
  page,
}) => {
  const { verifyJpegXlRemediation } = await import('./jpegxl-pipeline-harness.ts')
  const expected = await verifyJpegXlRemediation(
    async (id) => new Uint8Array(await readFile(`tests/fixtures/jpegxl/remediation/${id}.jxl`)),
  )
  expect(expected).toHaveLength(8)
  expect(expected[0]?.toneMapping).toEqual({
    intensityTarget: 2000,
    minNits: 0.125,
    relativeToMaxDisplay: true,
    linearBelow: 0.25,
  })
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyJpegXlRemediation()
  })
  expect(actual).toEqual(expected)
})

test('encoder budget admission and cleanup match Node in a real browser', async ({ page }) => {
  const { verifyJpegXlEncoderBudgets } = await import('./jpegxl-pipeline-harness.ts')
  const expected = await verifyJpegXlEncoderBudgets()
  expect(expected).toHaveLength(12)
  for (let index = 2; index < 12; index += 3)
    expect(expected[index]).toMatchObject({
      bytes: 0,
      live: 0,
      allocations: 0,
      errorCode: 'LIMIT_EXCEEDED',
    })
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlEncoderBudgets()
  })
  expect(actual).toEqual(expected)
})

test('copied JPEG XL display recipes preserve pixels, alpha and orientation in the browser', async ({
  page,
}) => {
  const { verifyJpegXlDisplayRecipes } = await import('./jpegxl-pipeline-harness.ts')
  const expected = await verifyJpegXlDisplayRecipes(
    async (group, id) =>
      new Uint8Array(
        await readFile(`tests/fixtures/jpegxl/${group === 'm4' ? 'm4-color' : group}/${id}.jxl`),
      ),
  )
  expect(expected).toHaveLength(10)
  for (const result of expected) expect(result.bitDepth).toBe(8)
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    return (await import(path)).verifyJpegXlDisplayRecipes()
  })
  expect(actual).toEqual(expected)
})

test('progressive stages, viewport selection, cache reuse and timer cancellation match Node', async ({
  page,
}) => {
  const { verifyProgressiveJpegXl } = await import('./jpegxl-pipeline-harness.ts')
  const expected = await verifyProgressiveJpegXl(
    new Uint8Array(
      await readFile(
        'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
      ),
    ),
  )
  expect(expected.reused).toBe(true)
  expect(expected.cancelled).toBe(true)
  expect(expected.liveBytes).toBe(0)
  expect(expected.stages.map((stage) => stage.kind)).toEqual(['dc', 'pass', 'pass', 'final'])
  await page.goto('/compatibility.html')
  const actual = await page.evaluate(async () => {
    const modulePath = '/jpegxl-pipeline.js'
    const module = await import(modulePath)
    const response = await fetch('/fixtures/jpegxl-multi-group-progressive.jxl')
    return module.verifyProgressiveJpegXl(new Uint8Array(await response.arrayBuffer()))
  })
  expect(actual).toEqual(expected)
})

test('Range explorer shows stages, byte counters and bounded fresh sessions', async ({ page }) => {
  let sourceRequests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/fixtures/jpegxl-multi-group-progressive.jxl')) sourceRequests++
  })
  await page.goto('/jpeg-xl/progressive/')
  await page
    .locator('#tool-url')
    .fill(new URL('/fixtures/jpegxl-multi-group-progressive.jxl', page.url()).href)
  await page.locator('#tool-native-stage').click()
  await expect(page.locator('#tool-status')).toContainText('operation complete')
  await expect(page.locator('#tool-stages li').last()).toContainText('dc complete')
  const first = await page.locator('#tool-details').textContent()
  expect(first).toContain('sourceReadBytes')
  const firstMetrics: unknown = JSON.parse(first ?? '{}')
  if (
    typeof firstMetrics !== 'object' ||
    firstMetrics === null ||
    !('sourceReadBytes' in firstMetrics) ||
    typeof firstMetrics.sourceReadBytes !== 'number'
  )
    throw new Error('Missing source read measurement')
  expect(firstMetrics.sourceReadBytes).toBeLessThan(148_917 / 4)
  const firstRequests = sourceRequests
  expect(firstRequests).toBeGreaterThan(0)
  await page.locator('#tool-native-stage').click()
  await expect(page.locator('#tool-status')).toContainText('operation complete')
  const repeated: unknown = JSON.parse((await page.locator('#tool-details').textContent()) ?? '{}')
  if (typeof repeated !== 'object' || repeated === null || !('sourceReadBytes' in repeated))
    throw new Error('Missing repeated measurement')
  expect(repeated.sourceReadBytes).toBe(firstMetrics.sourceReadBytes)
  expect(sourceRequests).toBeGreaterThan(firstRequests)
  await expect(page.locator('#tool-zoom')).toHaveValue('4')
  await page.locator('#tool-viewport').click()
  // This action reconstructs all four stages; shared CI runners can exceed the
  // default five-second assertion budget while still making valid progress.
  await expect(page.locator('#tool-status')).toContainText('operation complete', {
    timeout: 30_000,
  })
  await expect(page.locator('#tool-canvas')).toHaveAttribute('width', '16')
})

test('an independent embedded preview remains visible when a requested native stage is unavailable', async ({
  page,
}) => {
  await page.goto('/jpeg-xl/progressive/')
  await page
    .locator('#tool-file')
    .setInputFiles('tests/fixtures/jpegxl/m6-preview-modular/embedded-preview.jxl')
  await expect(page.locator('#tool-status')).toContainText('operation complete')
  await page.locator('#tool-native-stage').click()
  await expect(page.locator('#tool-status')).toContainText('cannot substitute final output')
  await expect(page.locator('#tool-canvas')).toHaveAttribute('width', '333')
  await expect(page.locator('#tool-canvas')).toHaveAttribute('height', '77')
  await expect(page.locator('#tool-stages')).toContainText('embedded-preview')
  await page.locator('#tool-run').click()
  await expect(page.locator('#tool-status')).toContainText('operation complete')
  await expect(page.locator('#tool-canvas')).toHaveAttribute('width', '1')
})

test('M7 effort-7 lossy RGBA8 preserves alpha and agrees in Node and browser', async ({ page }) => {
  const expected = await verifyM7EffortSevenAlpha()
  expect(expected.alphaMaximumError).toBe(0)
  await page.goto('/compatibility.html')
  const actual: typeof expected = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyM7EffortSevenAlpha()
  })
  expect(actual).toEqual(expected)
})

test('M7 compact transparent artwork has exact visible color and alpha in Node and browser', async ({
  page,
}) => {
  const expected = await verifyM7ExactRgbaFallback()
  expect(expected.encoding).toBe('modular')
  expect(expected.visibleMaximumError).toBe(0)
  expect(expected.alphaMaximumError).toBe(0)
  expect(expected.invisibleRgbMaximum).toBe(0)
  await page.goto('/compatibility.html')
  const actual: typeof expected = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyM7ExactRgbaFallback()
  })
  expect(actual).toEqual(expected)
})

test('M7 effort-7 lossy PQ16 preserves native output in Node and browser', async ({ page }) => {
  const expected = await verifyM7EffortSevenPq()
  expect(expected.decoded).toHaveLength(17 * 9 * 3)
  await page.goto('/compatibility.html')
  const actual: typeof expected = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyM7EffortSevenPq()
  })
  expect(actual).toEqual(expected)
})

test('M7 lossy and progressive re-encode preserve Node/browser color and precision behavior', async ({
  page,
}) => {
  const expected = await verifyM7ForwardJpegXl(
    async (name) => new Uint8Array(await readFile(`tests/fixtures/jpegxl/m4-color/${name}`)),
  )
  await page.goto('/compatibility.html')
  const actual: typeof expected = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyM7ForwardJpegXl()
  })
  expect(actual).toHaveLength(expected.length)
  for (let index = 0; index < expected.length; index++) {
    const reference = expected[index],
      result = actual[index]
    if (!reference || !result) throw new Error('Missing forward browser result')
    expect({ id: result.id, progressive: result.progressive, format: result.format }).toEqual({
      id: reference.id,
      progressive: reference.progressive,
      format: reference.format,
    })
    expect(result.samples).toHaveLength(reference.samples.length)
    for (let sample = 0; sample < reference.samples.length; sample++)
      expect(
        Math.abs((result.samples[sample] ?? 0) - (reference.samples[sample] ?? 0)),
      ).toBeLessThanOrEqual(reference.format.endsWith('f32') ? 1e-5 : 1)
  }
})

test('M7 effort-1 group entropy preserves portable pixels and size bounds', async ({ page }) => {
  const expected = await verifyM7EffortOneGroups()
  await page.goto('/compatibility.html')
  const actual: typeof expected = await page.evaluate(async () => {
    const path = '/jpegxl-pipeline.js'
    const module = await import(path)
    return module.verifyM7EffortOneGroups()
  })
  expect(actual).toHaveLength(3)
  for (let index = 0; index < expected.length; index++) {
    const reference = expected[index],
      result = actual[index]
    if (!reference || !result) throw new Error('Missing grouped output')
    expect(result.kind).toBe(reference.kind)
    expect(result.bytes).toBeLessThanOrEqual(
      result.kind === 'flat' ? 1736 : result.kind === 'dc-only' ? 8793 : 189405,
    )
    expect(result.samples).toHaveLength(reference.samples.length)
    let maximum = 0
    for (let sample = 0; sample < reference.samples.length; sample++)
      maximum = Math.max(
        maximum,
        Math.abs((result.samples[sample] ?? 0) - (reference.samples[sample] ?? 0)),
      )
    expect(maximum).toBeLessThanOrEqual(1)
  }
})

for (const [width, height] of [
  [1025, 17],
  [1, 1031],
] as const) {
  test(`M7 scalar palettes preserve exact RGB16 in Node and browser ${width}x${height}`, async ({
    page,
  }) => {
    const expected = await verifyM7ScalarPalettes(width, height)
    await page.goto('/compatibility.html')
    const actual = await page.evaluate(
      async ({ width, height }) => {
        const path = '/jpegxl-pipeline.js'
        const module = await import(path)
        return module.verifyM7ScalarPalettes(width, height)
      },
      { width, height },
    )
    expect(actual).toEqual(expected)
  })
}
