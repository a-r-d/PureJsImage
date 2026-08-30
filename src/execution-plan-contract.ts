import type { AbortOptions } from './abort.ts'
import type { CodecRegistry, ImageCodec } from './codec.ts'
import type { ImageLimits } from './limits.ts'
import type { PipelineOperation } from './pipeline.ts'
import type { ImageRuntime } from './runtime.ts'
import type { ImageSource } from './source.ts'

export const imageExecutionPlanInput = Symbol('purejsimage.imageExecutionPlanInput')

export interface ImageExecutionPlanContext {
  readonly source: ImageSource
  readonly codec: ImageCodec
  readonly registry: CodecRegistry
  readonly frame: number | undefined
  readonly resolutionLevel: number | undefined
  readonly tolerantDecoding: boolean
  readonly limits: ImageLimits
  readonly runtime: ImageRuntime
}

export interface ImageExecutionPlanTarget {
  [imageExecutionPlanInput](): {
    readonly context: ImageExecutionPlanContext
    readonly operations: readonly PipelineOperation[]
  }
}

export interface ExplainImageOptions extends AbortOptions {}
