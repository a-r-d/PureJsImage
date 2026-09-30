import { invalidInput, unsupportedOperation } from '../errors.ts'
import { type JpegXlFrameStructure, jpegXlXybOutputIsLinear } from './jpegxl-decode.ts'
import type { JpegXlVarDctLowFrequencyState } from './jpegxl-vardct-render.ts'

export interface JpegXlRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface JpegXlProgressiveRequest {
  /** Region in full-resolution encoded or display coordinates. */
  readonly region?: Readonly<JpegXlRegion>
  readonly coordinateSpace?: 'encoded' | 'display'
  readonly scaleDenominator?: 1 | 2 | 4 | 8
  /** Complete DC, a one-based completed pass count, or the final image. */
  readonly until?: 'dc' | 'final' | number
  readonly fallback?: 'allow' | 'reject'
  readonly signal?: AbortSignal
}

export interface JpegXlProgressivePlan {
  readonly encodedRegion: Readonly<JpegXlRegion>
  readonly outputRegion: Readonly<JpegXlRegion>
  readonly coordinateSpace: 'encoded' | 'display'
  readonly scaleDenominator: 1 | 2 | 4 | 8
  readonly passes: number
  readonly groupIds: readonly number[]
  readonly sectionIds: readonly number[]
  readonly internalFrameSections: readonly Readonly<{ frameIndex: number; sectionId: number }>[]
  readonly fullFrameFallback: 'none' | 'output-only' | 'working-planes' | 'static-decoder'
  readonly workingMemoryClass:
    | 'bounded-dc-restoration'
    | 'full-output-with-restoration-bands'
    | 'full-output-and-working-planes'
    | 'static-fallback'
  readonly restorationHalo: number
  readonly dependencyValidation: 'required' | 'complete'
  readonly fallbackReasons: readonly string[]
}

/** Inverse EXIF orientation mapping, shared by dependency planning and pixel emission. */
export const jpegXlEncodedPoint = (
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: number,
): readonly [number, number] => {
  switch (orientation) {
    case 1:
      return [x, y]
    case 2:
      return [width - 1 - x, y]
    case 3:
      return [width - 1 - x, height - 1 - y]
    case 4:
      return [x, height - 1 - y]
    case 5:
      return [y, x]
    case 6:
      return [y, height - 1 - x]
    case 7:
      return [width - 1 - y, height - 1 - x]
    case 8:
      return [width - 1 - y, x]
    default:
      throw invalidInput('JPEG XL orientation is invalid')
  }
}

export const planJpegXlProgressive = (
  frame: Readonly<JpegXlFrameStructure>,
  request: Readonly<JpegXlProgressiveRequest> = {},
  state?: JpegXlVarDctLowFrequencyState,
  dependencies: readonly Readonly<JpegXlFrameStructure>[] = [],
): JpegXlProgressivePlan => {
  if (
    request.fallback !== undefined &&
    request.fallback !== 'allow' &&
    request.fallback !== 'reject'
  )
    throw invalidInput('JPEG XL fallback policy is invalid')
  const coordinateSpace = request.coordinateSpace ?? 'encoded'
  if (coordinateSpace !== 'encoded' && coordinateSpace !== 'display')
    throw invalidInput('JPEG XL coordinate space is invalid')
  const orientation = coordinateSpace === 'display' ? frame.orientation : 1
  const width = orientation >= 5 ? frame.height : frame.width
  const height = orientation >= 5 ? frame.width : frame.height
  const region = request.region ?? { x: 0, y: 0, width, height }
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isSafeInteger) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    region.x + region.width > width ||
    region.y + region.height > height
  )
    throw invalidInput('JPEG XL progressive region is invalid')
  const scale = request.scaleDenominator ?? 1
  if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8)
    throw invalidInput('JPEG XL progressive scale must be 1, 2, 4 or 8')
  const until = request.until ?? 'final'
  if (typeof until === 'number' && until < 1)
    throw invalidInput('JPEG XL completed pass counts start at one')
  const passes = until === 'dc' ? 0 : until === 'final' ? frame.passCount : until
  if (!Number.isSafeInteger(passes) || passes < 0 || passes > frame.passCount)
    throw invalidInput('JPEG XL progressive pass count is invalid')
  const first = jpegXlEncodedPoint(region.x, region.y, frame.width, frame.height, orientation)
  const last = jpegXlEncodedPoint(
    region.x + region.width - 1,
    region.y + region.height - 1,
    frame.width,
    frame.height,
    orientation,
  )
  const encodedRegion = Object.freeze({
    x: Math.min(first[0], last[0]),
    y: Math.min(first[1], last[1]),
    width: Math.abs(first[0] - last[0]) + 1,
    height: Math.abs(first[1] - last[1]) + 1,
  })
  const fallbackReasons: string[] = []
  if (frame.encoding !== 'vardct') fallbackReasons.push('Modular requires its final decode path')
  if (frame.bitDepth > 16)
    fallbackReasons.push('More than 16-bit VarDCT samples require their native static decoder')
  if (
    dependencies.length > 1 ||
    dependencies.some(
      (dependency) =>
        dependency.frameType !== 'dc' ||
        dependency.encoding !== 'modular' ||
        dependency.dcLevel !== 1,
    )
  )
    fallbackReasons.push('Internal frame dependencies require their complete static decode path')
  if (frame.colorTransform !== 'xyb') fallbackReasons.push('This selective path requires XYB')
  const selectiveAlpha =
    frame.extraChannels.length === 1 &&
    frame.extraChannels[0]?.type === 0 &&
    frame.selectedAlphaChannel === 0 &&
    Math.ceil(
      frame.codedWidth /
        ((frame.extraChannelUpsampling[0] ?? 1) * 2 ** frame.extraChannels[0].dimShift),
    ) <= frame.groupDimension &&
    Math.ceil(
      frame.codedHeight /
        ((frame.extraChannelUpsampling[0] ?? 1) * 2 ** frame.extraChannels[0].dimShift),
    ) <= frame.groupDimension
  if (frame.extraChannels.length !== 0 && !selectiveAlpha)
    fallbackReasons.push('Extra channels require their complete dependencies')
  if (frame.upsampling !== 1)
    fallbackReasons.push('Frame upsampling requires its complete dependencies')
  if (frame.sections.length === 1)
    fallbackReasons.push('The frame stores all image data in one section')
  if (state) {
    if (state.frame !== frame || state.released)
      throw invalidInput('JPEG XL plan requires live LF state for this frame')
    if (state.lfGlobal.patches.length)
      fallbackReasons.push('Patches require reference source dependencies')
    if (state.lfGlobal.splines.length)
      fallbackReasons.push('Splines require their full rendering path')
    if (state.lfGlobal.noiseLut) fallbackReasons.push('Noise requires its full rendering path')
  }
  const reducedOrRegion =
    scale !== 1 || encodedRegion.width !== frame.width || encodedRegion.height !== frame.height
  const highDepthWorkingPlanes = frame.bitDepth > 8 || jpegXlXybOutputIsLinear(frame)
  const fullFrameFallback = fallbackReasons.length
    ? 'static-decoder'
    : passes > 0 && reducedOrRegion
      ? !highDepthWorkingPlanes && dependencies.length === 0 && frame.groupsDown > 1
        ? 'output-only'
        : 'working-planes'
      : 'none'
  if (request.fallback === 'reject' && (fallbackReasons.length || fullFrameFallback !== 'none'))
    throw unsupportedOperation(
      `JPEG XL selective decode rejected: ${fallbackReasons.join('; ') || `full-frame ${fullFrameFallback} storage is required`}`,
    )
  const halo = 8
  const startX = Math.max(0, encodedRegion.x - halo)
  const startY = Math.max(0, encodedRegion.y - halo)
  const endX = Math.min(frame.width, encodedRegion.x + encodedRegion.width + halo)
  const endY = Math.min(frame.height, encodedRegion.y + encodedRegion.height + halo)
  const groups: number[] = []
  const allGroups = fallbackReasons.length > 0
  for (let y = 0; y < frame.groupsDown; y += 1) {
    for (let x = 0; x < frame.groupsAcross; x += 1) {
      if (
        allGroups ||
        (x * frame.groupDimension < endX &&
          (x + 1) * frame.groupDimension > startX &&
          y * frame.groupDimension < endY &&
          (y + 1) * frame.groupDimension > startY)
      )
        groups.push(y * frame.groupsAcross + x)
    }
  }
  const sections: number[] = []
  if (frame.sections.length === 1) sections.push(0)
  else {
    for (let id = 0; id <= frame.dcGroupCount; id += 1) sections.push(id)
    if (passes > 0) {
      sections.push(1 + frame.dcGroupCount)
      for (let pass = 0; pass < passes; pass += 1)
        for (const group of groups)
          sections.push(
            2 + frame.dcGroupCount + pass * frame.groupsAcross * frame.groupsDown + group,
          )
    }
  }
  return Object.freeze({
    encodedRegion,
    outputRegion: Object.freeze({ ...region }),
    coordinateSpace,
    scaleDenominator: scale,
    passes,
    groupIds: Object.freeze(groups),
    sectionIds: Object.freeze(sections),
    internalFrameSections: Object.freeze(
      dependencies.flatMap((dependency, frameIndex) =>
        dependency.sections.map((_, sectionId) => Object.freeze({ frameIndex, sectionId })),
      ),
    ),
    fullFrameFallback,
    workingMemoryClass: fallbackReasons.length
      ? 'static-fallback'
      : passes === 0
        ? 'bounded-dc-restoration'
        : !highDepthWorkingPlanes && dependencies.length === 0 && frame.groupsDown > 1
          ? 'full-output-with-restoration-bands'
          : 'full-output-and-working-planes',
    restorationHalo: halo,
    dependencyValidation: state ? 'complete' : 'required',
    fallbackReasons: Object.freeze(fallbackReasons),
  })
}
