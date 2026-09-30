/** Shared job identity, hard cancellation and disposal for every JPEG XL tool. */
export class JxlWorkerClient {
  generation = 0
  requestId = 0
  #worker: Worker | undefined
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
      worker.onmessage = (event) => {
        if (this.#worker === worker) this.receive(event.data)
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
    this.#worker.postMessage(value, transfer)
  }
  current(value: { generation: number; requestId: number }): boolean {
    return value.generation === this.generation && value.requestId === this.requestId
  }
  reset(): void {
    this.generation++
    this.requestId++
    this.#worker?.terminate()
    this.#worker = undefined
  }
}
