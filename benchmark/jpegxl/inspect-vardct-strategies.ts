import { type ImageSource, readExactly } from '../../src/source.ts'
import {
  decodeJpegXlModularDcFrameSection,
  decodeJpegXlMultiGroupModularDcFrameSections,
  type JpegXlFrameStructure,
} from '../../src/codecs/jpegxl-decode.ts'
import { JpegXlVarDctMemoryLedger } from '../../src/codecs/jpegxl-vardct-memory.ts'
import { decodeJpegXlDct8Section } from '../../src/codecs/jpegxl-vardct-render.ts'
import {
  decodeJpegXlJpegDcGroup,
  decodeJpegXlJpegLfGlobal,
} from '../../src/codecs/jpegxl-vardct-jpeg.ts'
import { defaultImageLimits } from '../../src/limits.ts'

const uniqueStrategies = (frame: Readonly<JpegXlFrameStructure>, values: Uint8Array): number[] => {
  const found = new Set<number>()
  const blockWidth = Math.ceil(frame.codedWidth / 8)
  for (let index = 0; index < values.length; index += 1) {
    const blockX = index % blockWidth
    const blockY = Math.floor(index / blockWidth)
    if (blockX * 8 < frame.codedWidth && blockY * 8 < frame.codedHeight) {
      found.add(values[index] ?? 255)
    }
  }
  found.delete(255)
  return [...found].sort((left, right) => left - right)
}

export const inspectJpegXlVarDctStrategyIds = async (
  logical: ImageSource,
  frames: readonly JpegXlFrameStructure[],
): Promise<readonly number[]> => {
  const frame = frames.at(-1)
  if (frame?.encoding !== 'vardct') return Object.freeze([])
  const blockWidth = Math.ceil(frame.codedWidth / 8)
  const blockHeight = Math.ceil(frame.codedHeight / 8)
  if (frame.sections.length === 1) {
    const section = frame.sections[0]
    if (!section) throw new Error('JPEG XL integrated VarDCT section is missing')
    const bytes = await readExactly(logical, section.offset, section.length)
    const lf = decodeJpegXlJpegLfGlobal(
      bytes,
      0,
      false,
      frame.frameFlags,
      frame.codedWidth,
      frame.codedHeight,
      frame.alphaBitDepth === undefined ? 0 : 1,
    )
    const dc = decodeJpegXlJpegDcGroup(
      bytes,
      {
        blockWidth,
        blockHeight,
        chromaSubsampling: frame.chromaSubsampling,
        groupId: 0,
        dcGroupCount: 1,
      },
      lf.globalModularCode,
      lf.endingBitPosition,
      false,
    )
    return Object.freeze(uniqueStrategies(frame, dc.strategies))
  }

  const lfSection = frame.sections[0]
  if (!lfSection) throw new Error('JPEG XL separated VarDCT LF section is missing')
  const lfBytes = await readExactly(logical, lfSection.offset, lfSection.length)
  const lf = decodeJpegXlJpegLfGlobal(
    lfBytes,
    0,
    frame.alphaBitDepth === undefined,
    frame.frameFlags,
    frame.codedWidth,
    frame.codedHeight,
    frame.alphaBitDepth === undefined ? 0 : 1,
  )
  let externalDcPlanes: readonly [Float64Array, Float64Array, Float64Array] | undefined
  const memory = new JpegXlVarDctMemoryLedger(defaultImageLimits.maxDecodedBytes)
  for (const dcFrame of frames.slice(0, -1).filter(({ frameType }) => frameType === 'dc')) {
    const sections = await Promise.all(
      dcFrame.sections.map((section) => readExactly(logical, section.offset, section.length)),
    )
    const first = sections[0]
    if (!first) throw new Error('JPEG XL external DC frame section is missing')
    if (dcFrame.encoding === 'modular') {
      externalDcPlanes = sections.slice(1).every((section) => section.length === 0)
        ? decodeJpegXlModularDcFrameSection(first, dcFrame.codedWidth, dcFrame.codedHeight)
        : decodeJpegXlMultiGroupModularDcFrameSections(sections, dcFrame)
    } else {
      if (!externalDcPlanes) throw new Error('JPEG XL external DC dependency is missing')
      const decoded = decodeJpegXlDct8Section(
        first,
        dcFrame,
        defaultImageLimits,
        memory,
        sections.slice(1),
        externalDcPlanes,
        true,
      )
      if (!decoded.dcPlanes) throw new Error('JPEG XL external DC frame output is missing')
      externalDcPlanes = decoded.dcPlanes
    }
  }

  const strategyIds = new Set<number>()
  const dcGroupBlockDimension = frame.groupDimension
  const dcGroupsAcross = Math.ceil(blockWidth / dcGroupBlockDimension)
  for (let groupId = 0; groupId < frame.dcGroupCount; groupId += 1) {
    const dcSection = frame.sections[1 + groupId]
    if (!dcSection) throw new Error('JPEG XL separated VarDCT DC section is missing')
    const groupX = (groupId % dcGroupsAcross) * dcGroupBlockDimension
    const groupY = Math.floor(groupId / dcGroupsAcross) * dcGroupBlockDimension
    const groupWidth = Math.min(dcGroupBlockDimension, blockWidth - groupX)
    const groupHeight = Math.min(dcGroupBlockDimension, blockHeight - groupY)
    let externalGroupPlanes: readonly [Float64Array, Float64Array, Float64Array] | undefined
    if (externalDcPlanes) {
      const slices = externalDcPlanes.map((plane) => {
        const output = new Float64Array(groupWidth * groupHeight)
        for (let y = 0; y < groupHeight; y += 1) {
          output.set(
            plane.subarray(
              (groupY + y) * blockWidth + groupX,
              (groupY + y) * blockWidth + groupX + groupWidth,
            ),
            y * groupWidth,
          )
        }
        return output
      })
      const [first, second, third] = slices
      if (!first || !second || !third) throw new Error('JPEG XL external DC plane is missing')
      externalGroupPlanes = Object.freeze([first, second, third])
    }
    const dcBytes = await readExactly(logical, dcSection.offset, dcSection.length)
    const dc = decodeJpegXlJpegDcGroup(
      dcBytes,
      {
        blockWidth: groupWidth,
        blockHeight: groupHeight,
        chromaSubsampling: frame.chromaSubsampling,
        groupId,
        dcGroupCount: frame.dcGroupCount,
      },
      lf.globalModularCode,
      0,
      true,
      externalGroupPlanes,
    )
    const localFrame = { ...frame, codedWidth: groupWidth * 8, codedHeight: groupHeight * 8 }
    for (const strategy of uniqueStrategies(localFrame, dc.strategies)) strategyIds.add(strategy)
  }
  return Object.freeze([...strategyIds].sort((left, right) => left - right))
}
