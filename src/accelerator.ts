import type { ImageCodec } from './codec.ts'

export type ImageAcceleratorKind = 'runtime' | 'wasm' | 'webgpu'

/**
 * An explicitly registered implementation that augments one reference codec.
 *
 * Accelerators own their workload selection and must return the reference
 * behavior whenever they cannot preserve the requested semantics or improve
 * the complete operation.
 */
export interface ImageCodecAccelerator {
  readonly format: string
  readonly id: string
  readonly kind: ImageAcceleratorKind
  accelerate(reference: ImageCodec): ImageCodec
}

export interface ImageLibraryConfiguration {
  readonly codecs: Iterable<ImageCodec>
  readonly accelerators?: Iterable<ImageCodecAccelerator>
}

export type ImageLibraryRegistration = Iterable<ImageCodec> | ImageLibraryConfiguration

const isConfiguration = (
  registration: ImageLibraryRegistration,
): registration is ImageLibraryConfiguration => 'codecs' in registration

export const resolveCodecRegistration = (
  registration: ImageLibraryRegistration,
): readonly ImageCodec[] => {
  if (!isConfiguration(registration)) return [...registration]

  const codecs = [...registration.codecs]
  const acceleratorIds = new Set<string>()
  for (const accelerator of registration.accelerators ?? []) {
    if (acceleratorIds.has(accelerator.id)) {
      throw new Error(`Accelerator already registered: ${accelerator.id}`)
    }
    acceleratorIds.add(accelerator.id)
    const index = codecs.findIndex((codec) => codec.format === accelerator.format)
    const reference = codecs[index]
    if (index < 0 || !reference) {
      throw new Error(
        `Accelerator ${accelerator.id} requires a registered ${accelerator.format} codec`,
      )
    }
    const accelerated = accelerator.accelerate(reference)
    if (accelerated.format !== reference.format) {
      throw new Error(
        `Accelerator ${accelerator.id} changed codec format ${reference.format} to ${accelerated.format}`,
      )
    }
    codecs[index] = accelerated
  }
  return codecs
}
