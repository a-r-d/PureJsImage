import { initialize } from './adapters.ts'
import {
  classifyError,
  type Fixture,
  type Output,
  type Pixels,
  rgba8,
  type Settings,
  type Subject,
} from './model.ts'
export interface Job {
  subject: Subject
  fixture: Fixture
  operation: 'decode-lossless' | 'decode-lossy' | 'encode' | 'roundtrip'
  settings: Settings
  repeats: number
}
export async function execute(
  job: Job,
  input: Uint8Array,
  pixels: Pixels,
  asset: (path: string) => Promise<ArrayBuffer>,
  vipsLocation?: string,
) {
  const coldStart = performance.now()
  let adapter: Awaited<ReturnType<typeof initialize>> | undefined
  try {
    adapter = await initialize(job.subject, asset, vipsLocation)
    const initialized = performance.now()
    if ((job.operation === 'encode' || job.operation === 'roundtrip') && !adapter.encode)
      return {
        status: 'API not exposed' as const,
        detail: 'Published binding has no encoder',
        output: null,
        times: [],
        coldMs: null,
        initializationMs: initialized - coldStart,
      }
    if (job.subject === 'jsquash' && !(pixels.data instanceof Uint8Array))
      return {
        status: 'API not exposed' as const,
        detail: 'ImageData API exposes RGBA8 only; no silent native precision conversion',
        output: null,
        times: [],
        coldMs: null,
        initializationMs: initialized - coldStart,
      }
    const operation = async (): Promise<Output> => {
      if (!adapter) throw new Error('Adapter closed')
      if (job.operation === 'encode') {
        if (!adapter.encode) throw new Error('Encoder unavailable')
        return adapter.encode(pixels, job.settings)
      }
      const output = await adapter.decode(input, !(pixels.data instanceof Uint8Array))
      if (job.operation === 'roundtrip') {
        if (output.kind !== 'pixels' || !adapter.encode)
          throw new Error('Raw decode and encode APIs required')
        return adapter.encode(rgba8(output.pixels), job.settings)
      }
      return output.kind === 'pixels' && output.pixels.data instanceof Uint8Array
        ? { kind: 'pixels', pixels: rgba8(output.pixels) }
        : output
    }
    let output = await operation()
    const coldMs = performance.now() - coldStart,
      times: number[] = []
    for (let repeat = 0; repeat < job.repeats; repeat++) {
      const start = performance.now()
      output = await operation()
      times.push(performance.now() - start)
    }
    return {
      status: 'verified' as const,
      detail: 'Execution completed; independent validation pending',
      output,
      times,
      coldMs,
      initializationMs: initialized - coldStart,
    }
  } catch (error) {
    return {
      ...classifyError(error),
      output: null,
      times: [],
      coldMs: null,
      initializationMs: null,
    }
  } finally {
    adapter?.close()
  }
}
