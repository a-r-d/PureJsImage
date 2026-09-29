import type { ImageSource } from 'purejsimage/browser'
import { openJpegXlSession } from 'purejsimage/jpegxl'

declare const self: {
  onmessage:
    | ((event: MessageEvent<{ subject: 'purejsimage' | 'oxide'; size: number }>) => Promise<void>)
    | null
  postMessage(value: unknown): void
}
self.onmessage = async (event) => {
  const start = performance.now(),
    reads: { offset: number; requested: number; transferred: number }[] = []
  try {
    if (event.data.subject === 'purejsimage') {
      const source: ImageSource = {
        size: event.data.size,
        async read(offset, length) {
          const response = await fetch('/input.jxl', {
            headers: {
              Range: `bytes=${offset}-${Math.min(event.data.size - 1, offset + length - 1)}`,
            },
          })
          if (response.status !== 206)
            throw new Error(`Expected byte range response, got ${response.status}`)
          const bytes = new Uint8Array(await response.arrayBuffer())
          reads.push({ offset, requested: length, transferred: bytes.length })
          return bytes
        },
      }
      const session = await openJpegXlSession(source),
        stages: unknown[] = []
      let firstUsefulMs: number | null = null,
        firstTransferred: number | null = null
      try {
        for await (const e of session.progressive({
          region: { x: 10, y: 10, width: 32, height: 32 },
          scaleDenominator: 2,
        })) {
          if (e.type === 'block') {
            if (firstUsefulMs === null) {
              firstUsefulMs = performance.now() - start
              firstTransferred = reads.reduce((sum, r) => sum + r.transferred, 0)
            }
            if (!e.block.data.length) throw new Error('Empty output')
            e.block.release?.()
          } else if (e.type === 'stage-complete')
            stages.push({
              kind: e.stage.kind,
              width: e.stage.width,
              height: e.stage.height,
              groups: e.stage.plan.groupIds,
            })
        }
      } finally {
        await session.close()
      }
      self.postMessage({
        status: firstUsefulMs === null ? 'incorrect output' : 'verified',
        firstUsefulMs,
        firstTransferred,
        transferredTotal: reads.reduce((sum, r) => sum + r.transferred, 0),
        reads,
        stages,
        scope:
          'HTTP Range source, 32x32 region at scale 2; first nonempty pixel block; no canvas upload; geometry-only preview check',
      })
    } else {
      const { default: init, JxlImage } = await import('jxl-oxide-wasm')
      await init({ module_or_path: await (await fetch('/oxide.wasm')).arrayBuffer() })
      const image = new JxlImage()
      let initialized = false,
        delivered = 0
      try {
        for (let offset = 0; offset < event.data.size; offset += 4096) {
          const end = Math.min(event.data.size - 1, offset + 4095),
            bytes = new Uint8Array(
              await (
                await fetch('/input.jxl', { headers: { Range: `bytes=${offset}-${end}` } })
              ).arrayBuffer(),
            )
          reads.push({ offset, requested: end - offset + 1, transferred: bytes.length })
          delivered += image.feedBytes(bytes)
          initialized ||= image.tryInit()
          if (initialized) {
            try {
              const frame = image.render(),
                png = frame.encodeToPng()
              self.postMessage({
                status: 'verified',
                firstUsefulMs: performance.now() - start,
                firstTransferred: reads.reduce((sum, r) => sum + r.transferred, 0),
                delivered,
                inputBytes: event.data.size,
                pngBytes: png.length,
                beforeComplete: delivered < event.data.size,
                reads,
                scope:
                  'Sequential 4096-byte HTTP chunks; first render exported to PNG; full frame, no reduced-resolution API, no canvas upload',
              })
              return
            } catch {
              /* Need another bounded input chunk. */
            }
          }
        }
        throw new Error('No useful PNG before/end of input')
      } finally {
        image.free()
      }
    }
  } catch (error) {
    self.postMessage({ status: 'execution failure', detail: String(error), reads })
  }
}
