import { jpegXlWorkbenchWorkerReady } from './jpegxl-workbench-types.ts'

/** Shared job identity, hard cancellation and disposal for every JPEG XL tool. */
export class JxlWorkerClient {
  generation = 0
  requestId = 0
  #worker: Worker | undefined
  #ready = false
  #pending: { value: object; transfer: Transferable[] }[] = []
  readonly receive: (value: unknown) => void
  readonly failed: (message: string) => void
  constructor(receive: (value: unknown) => void, failed: (message: string) => void) {
    this.receive = receive
    this.failed = failed
  }
  post(value: object, transfer: Transferable[] = []): void {
    if (!this.#worker) {
      const worker = new Worker(new URL('./jpegxl-workbench-worker.js', import.meta.url), {
        type: 'module',
      })
      this.#worker = worker
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (this.#worker !== worker) return
        if (event.data === jpegXlWorkbenchWorkerReady) {
          this.#ready = true
          const pending = this.#pending
          this.#pending = []
          for (const request of pending) worker.postMessage(request.value, request.transfer)
          return
        }
        this.receive(event.data)
      }
      worker.onerror = (event) => {
        if (this.#worker !== worker) return
        this.reset()
        this.failed(event.message || 'Worker failed. Retry or open another input.')
      }
      worker.onmessageerror = () => {
        if (this.#worker !== worker) return
        this.reset()
        this.failed('Worker response could not be read. Retry the operation.')
      }
    }
    if (this.#ready) this.#worker.postMessage(value, transfer)
    else this.#pending.push({ value, transfer })
  }
  current(value: { generation: number; requestId: number }): boolean {
    return value.generation === this.generation && value.requestId === this.requestId
  }
  reset(): void {
    this.generation++
    this.requestId++
    this.#ready = false
    this.#pending = []
    this.#worker?.terminate()
    this.#worker = undefined
  }
}
