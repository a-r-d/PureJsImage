import type { JpegXlProgressiveRequest, JpegXlSession } from '../../src/jpegxl.ts'
import { openJpegXlSession } from '../../src/jpegxl.ts'

interface AlphaStage {
  readonly kind: string
  readonly width: number
  readonly height: number
  format: string
  data: Uint8Array
}

const collect = async (
  session: JpegXlSession,
  request: Readonly<JpegXlProgressiveRequest>,
): Promise<readonly AlphaStage[]> => {
  const stages: AlphaStage[] = []
  let stage: AlphaStage | undefined
  let rows = 0
  for await (const event of session.progressive(request)) {
    if (event.type === 'stage-start') {
      stage = {
        kind: event.stage.kind,
        width: event.stage.width,
        height: event.stage.height,
        format: '',
        data: new Uint8Array(),
      }
      stages.push(stage)
      rows = 0
    } else if (event.type === 'block') {
      const block = event.block
      try {
        if (!stage || block.y !== rows || block.width !== stage.width)
          throw new Error('Grouped alpha stage has invalid row geometry')
        if (!stage.data.length) {
          stage.format = block.format
          stage.data = new Uint8Array(stage.height * block.stride)
        }
        stage.data.set(block.data, block.y * block.stride)
        rows += block.height
      } finally {
        block.release?.()
      }
    } else if (event.type === 'stage-complete' && rows !== stage?.height)
      throw new Error('Grouped alpha stage has missing rows')
  }
  return stages
}

const sample = (view: DataView, format: string, index: number): number => {
  if (format === 'rgba8') return view.getUint8(index) / 255
  if (format === 'rgba16') return view.getUint16(index * 2, false) / 65_535
  if (format === 'rgbaf32') return view.getFloat32(index * 4, false)
  throw new Error(`Unexpected grouped alpha format ${format}`)
}

export const verifyJpegXlGroupedAlpha = async (
  bytes: Uint8Array,
  reference: Uint8Array,
  width: number,
  height: number,
  format: string,
  referenceColorScale = 1,
) => {
  const session = await openJpegXlSession(bytes, { maxCachedBytes: 0 })
  let maximumColor = 0,
    maximumAlpha = 0,
    maximumViewport = 0
  let stageCount = 0
  try {
    const plan = session.plan({ until: 'dc' })
    if (
      plan.fallbackReasons.length ||
      plan.workingMemoryClass !== 'full-native-alpha-and-dc-restoration'
    )
      throw new Error('Grouped alpha must declare its native plane storage')
    const full = await collect(session, {})
    stageCount = full.length
    if (full[0]?.kind !== 'dc' || full.at(-1)?.kind !== 'final' || stageCount < 3)
      throw new Error('Grouped alpha did not emit DC, pass and final stages')
    const oracle = new DataView(reference.buffer, reference.byteOffset, reference.byteLength)
    for (const stage of full) {
      if (
        stage.format !== format ||
        stage.width !== width ||
        stage.height !== height ||
        stage.data.length !== reference.length
      )
        throw new Error('Grouped alpha stage format differs from its independent reference')
      const actual = new DataView(stage.data.buffer, stage.data.byteOffset, stage.data.byteLength)
      for (let index = 0; index < width * height * 4; index++) {
        const error = Math.abs(
          sample(actual, format, index) -
            sample(oracle, format, index) * (index % 4 === 3 ? 1 : referenceColorScale),
        )
        if (!Number.isFinite(error)) throw new Error('Non-finite grouped alpha error')
        if (index % 4 === 3) maximumAlpha = Math.max(maximumAlpha, error)
        else if (stage.kind === 'final') maximumColor = Math.max(maximumColor, error)
      }
    }
    for (const region of [
      { x: 249, y: 249, width: 22, height: Math.min(10, height - 249) },
      { x: width - 1, y: height - 3, width: 1, height: 3 },
    ]) {
      const selected = await collect(session, { region })
      if (selected.length !== full.length) throw new Error('Missing selected alpha stages')
      for (let stageIndex = 0; stageIndex < selected.length; stageIndex++) {
        const cropped = selected[stageIndex],
          complete = full[stageIndex]
        if (!cropped || !complete || cropped.format !== format)
          throw new Error('Selected alpha stage format differs')
        const actual = new DataView(
          cropped.data.buffer,
          cropped.data.byteOffset,
          cropped.data.byteLength,
        )
        const expected = new DataView(
          complete.data.buffer,
          complete.data.byteOffset,
          complete.data.byteLength,
        )
        for (let y = 0; y < region.height; y++)
          for (let x = 0; x < region.width * 4; x++) {
            const error = Math.abs(
              sample(actual, format, y * region.width * 4 + x) -
                sample(expected, format, ((region.y + y) * width + region.x) * 4 + x),
            )
            if (!Number.isFinite(error)) throw new Error('Non-finite selected alpha error')
            maximumViewport = Math.max(maximumViewport, error)
          }
      }
    }
    if (session.managedLiveBytes !== 0) throw new Error('Uncached alpha session retained data')
  } finally {
    await session.close()
  }
  if (session.managedLiveBytes !== 0) throw new Error('Closed alpha session retained data')
  return { maximumColor, maximumAlpha, maximumViewport, stageCount }
}
