import type { ImageSink } from './sink.ts'

export interface TemporaryStore {
  read(position: number, target: Uint8Array): Promise<void>
  write(position: number, data: Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface TemporaryStoreOptions {
  readonly expectedBytes: number
  readonly prefix: string
}

export interface DeflateOptions {
  readonly level: number
  readonly strategy: 'default' | 'rle'
}

export interface DeflateEncoder {
  /** Scratch for the next write, if available. The producer discards the view after writing. */
  inputBuffer?(length: number): Uint8Array | undefined
  write(data: Uint8Array): Promise<void>
  finish(): Promise<void>
  abort(reason: unknown): Promise<void>
}

export interface ImageRuntime {
  availableParallelism?(): number
  createTemporaryStore(options: TemporaryStoreOptions): Promise<TemporaryStore>
  createDeflateEncoder(
    options: DeflateOptions,
    onData: (chunk: Uint8Array) => Promise<void>,
  ): DeflateEncoder
  createParallelDeflateEncoder?(
    options: DeflateOptions,
    onData: (chunk: Uint8Array) => Promise<void>,
    threads: number,
    inputBytes: number,
  ): Promise<DeflateEncoder | undefined>
  deflate(data: Uint8Array, options: DeflateOptions): Promise<Uint8Array>
}

export interface CollectedOutput<Output extends Uint8Array> {
  readonly sink: ImageSink
  result(): Output
}
