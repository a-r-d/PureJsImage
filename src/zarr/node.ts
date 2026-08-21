import { invalidInput } from '../errors.ts'
import { FileSource } from '../node-source.ts'
import type { ZarrObject, ZarrObjectStore } from './core.ts'
import { normalizeZarrObjectPath } from './core.ts'

const isMissingPathError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error.code === 'ENOENT' || error.code === 'ENOTDIR')

/** Node-only local-directory adapter for the runtime-neutral Zarr object-store contract. */
export class ZarrDirectoryObjectStore implements ZarrObjectStore {
  readonly #root: string
  #closed = false

  private constructor(root: string) {
    this.#root = root
  }

  static async open(root: string): Promise<ZarrDirectoryObjectStore> {
    const { resolve } = await import('node:path')
    return new ZarrDirectoryObjectStore(resolve(root))
  }

  async resolve(relative: string, signal?: AbortSignal): Promise<ZarrObject | undefined> {
    if (this.#closed) throw invalidInput('Zarr directory store is closed')
    signal?.throwIfAborted()
    const name = normalizeZarrObjectPath(relative)
    const { resolve, sep } = await import('node:path')
    const path = resolve(this.#root, ...name.split('/'))
    if (!path.startsWith(`${this.#root}${sep}`)) {
      throw invalidInput('Zarr object path escapes the configured directory root')
    }
    try {
      const source = await FileSource.open(path, signal === undefined ? {} : { signal })
      return Object.freeze({ id: name, source })
    } catch (error) {
      if (isMissingPathError(error)) return undefined
      throw error
    }
  }

  close(): void {
    this.#closed = true
  }
}
