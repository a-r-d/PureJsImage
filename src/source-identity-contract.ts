import type { ImageSource } from './source.ts'

export type SourceIdentity =
  | ContentSourceIdentity
  | RemoteSourceIdentity
  | LocalFileSourceIdentity
  | SessionSourceIdentity

export interface ContentSourceIdentity {
  readonly kind: 'content'
  readonly strength: 'strong'
  readonly stability: 'content-addressed'
  readonly algorithm: 'sha256'
  readonly digest: string
  readonly size: number
}

export interface RemoteSourceIdentity {
  readonly kind: 'remote'
  readonly strength: 'strong' | 'weak'
  readonly stability: 'versioned' | 'best-effort'
  readonly url: string
  readonly size: number
  readonly validator?: {
    readonly kind: 'etag' | 'version-id' | 'last-modified'
    readonly value: string
  }
}

export interface LocalFileSourceIdentity {
  readonly kind: 'local-file'
  readonly strength: 'weak'
  readonly stability: 'metadata'
  readonly nameOrPath: string
  readonly size: number
  readonly lastModified: number
}

export interface SessionSourceIdentity {
  readonly kind: 'session'
  readonly strength: 'session'
  readonly stability: 'instance'
  readonly id: string
  readonly size: number
}

export const imageSourceIdentity = Symbol('purejsimage.imageSourceIdentity')

export interface IdentifiedImageSource extends ImageSource {
  [imageSourceIdentity](): SourceIdentity | Promise<SourceIdentity>
}

let sessionCounter = 0

export const createSourceSessionIdentity = (size: number): SessionSourceIdentity =>
  Object.freeze({
    kind: 'session',
    strength: 'session',
    stability: 'instance',
    id: `${++sessionCounter}`,
    size,
  })

const fallbackIdentities = new WeakMap<ImageSource, SessionSourceIdentity>()

export const inheritImageSourceIdentity = async (source: ImageSource): Promise<SourceIdentity> => {
  const identify = source[imageSourceIdentity]
  if (identify !== undefined) return identify.call(source)
  let identity = fallbackIdentities.get(source)
  if (identity === undefined) {
    identity = createSourceSessionIdentity(source.size)
    fallbackIdentities.set(source, identity)
  }
  return identity
}
