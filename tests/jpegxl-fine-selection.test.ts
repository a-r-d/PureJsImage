import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('exercises fine JPEG XL channel and spatial quantization on a large photo', async () => {
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
  if (!output) throw new Error('JPEG XL fine fixture bundle is missing')
  const namespace: unknown = await import(
    `data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`
  )
  if (
    namespace === null ||
    typeof namespace !== 'object' ||
    !('verifyFinePhoto' in namespace) ||
    typeof namespace.verifyFinePhoto !== 'function'
  )
    throw new Error('JPEG XL fine fixture export is missing')
  const result: unknown = await namespace.verifyFinePhoto()
  // Effort 7 omits complete alternatives; both decoders retain the original fine-photo pixels.
  expect(result).toMatchObject({
    bytes: 380202,
    encodedChecksum: 1879902157,
    decodedChecksum: 3722419263,
    callerChecksum: 2647578060,
    samples: 2049 * 2048 * 4,
    coveredRows: 2048,
    releasedBlocks: 2048,
    alphaError: 0,
    xScale: 0,
    bScale: 1,
    epfIterations: 0,
    lfOwnedLive: 0,
    ownedLive: 0,
    ownedAllocations: 0,
  })
  if (
    result === null ||
    typeof result !== 'object' ||
    !('quantizers' in result) ||
    !Array.isArray(result.quantizers) ||
    !('ownedPeak' in result)
  )
    throw new Error('JPEG XL fine fixture result is incomplete')
  expect(result.quantizers.length).toBeGreaterThan(1)
  expect(result.ownedPeak).toBeLessThanOrEqual(67_108_864)
}, 600_000)
