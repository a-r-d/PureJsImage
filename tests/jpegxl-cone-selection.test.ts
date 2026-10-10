import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('preserves independently verified effort-9 cone photo samples across partial JPEG XL groups', async () => {
  // Match the bundled public path used by independent qualification and browsers.
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./helpers/jpegxl-cone-selection.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    minify: true,
    write: false,
  })
  const output = bundle.outputFiles[0]
  if (!output) throw new Error('JPEG XL fixture bundle is missing')
  const namespace: unknown = await import(
    `data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`
  )
  if (
    namespace === null ||
    typeof namespace !== 'object' ||
    !('verifyConePhoto' in namespace) ||
    typeof namespace.verifyConePhoto !== 'function'
  )
    throw new Error('JPEG XL fixture export is missing')
  const result: unknown = await namespace.verifyConePhoto()
  // Estimated order/family selection changes serialization; both decoders retain these pixels.
  expect(result).toMatchObject({
    bytes: 127948,
    encodedChecksum: 527620913,
    decodedChecksum: 1449741427,
    callerChecksum: 3043653419,
    selectedDct16Blocks: 65532,
    xScale: 2,
    bScale: 1,
    samples: 2057 * 2040 * 4,
    alphaError: 0,
    ownedLive: 0,
    ownedAllocations: 0,
  })
  if (
    result === null ||
    typeof result !== 'object' ||
    !('meanColorError' in result) ||
    !('ownedPeak' in result)
  )
    throw new Error('JPEG XL fixture result is incomplete')
  expect(result.meanColorError).toBeLessThan(0.6)
  expect(result.ownedPeak).toBeLessThanOrEqual(67_108_864)
}, 600_000)
