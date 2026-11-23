import { execute, type Job } from './execute.ts'
import type { Pixels } from './model.ts'

declare const self: {
  location: Location
  onmessage:
    | ((event: MessageEvent<{ job: Job; input: Uint8Array; pixels: Pixels }>) => Promise<void>)
    | null
  postMessage(value: unknown): void
}
self.onmessage = async (event: MessageEvent<{ job: Job; input: Uint8Array; pixels: Pixels }>) => {
  // Dedicated-worker messages use an empty origin and a null source; ignore anything else.
  if (!event.isTrusted || event.origin !== '' || event.source !== null) return
  const { job, input, pixels } = event.data
  const result = await execute(
    job,
    input,
    pixels,
    async (name) => {
      const response = await fetch(`/assets/${name}`)
      if (!response.ok) throw new Error(`Asset HTTP ${response.status}`)
      return response.arrayBuffer()
    },
    `${self.location.origin}/assets/vips`,
  )
  self.postMessage(result)
}
