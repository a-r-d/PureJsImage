import type { ImageSource } from '../src/index.ts'
import { MemorySource } from '../src/index.ts'

/**
 * Enforces the weakest supported ImageSource buffer lifetime: each read gets a
 * fresh buffer and the preceding buffer becomes invalid as the next read starts.
 */
export class HostileSource implements ImageSource {
  readonly size: number
  readonly #source: MemorySource
  #previous: Uint8Array | undefined

  constructor(input: Uint8Array) {
    this.#source = new MemorySource(Uint8Array.from(input))
    this.size = input.byteLength
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.#previous?.fill(0)
    const output = (await this.#source.read(offset, length)).slice()
    this.#previous = output
    return output
  }
}
