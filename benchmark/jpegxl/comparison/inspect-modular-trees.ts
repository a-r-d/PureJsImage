import { readFile } from 'node:fs/promises'
import { ImageError } from '../../../src/errors.ts'
import { JpegXlBitReader, readJpegXlEntropyCode } from '../../../src/codecs/jpegxl-bitstream.ts'
import {
  inspectJpegXlSource,
  JpegXlCodestreamSource,
} from '../../../src/codecs/jpegxl-container.ts'
import {
  readJpegXlModularTree,
  readJpegXlSourceFrameStructures,
  readJpegXlStandaloneModularHeader,
} from '../../../src/codecs/jpegxl-decode.ts'
import { readJpegXlFrameFeatures } from '../../../src/codecs/jpegxl-frame-features.ts'
import { defaultJpegXlLimits } from '../../../src/codecs/jpegxl-limits.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'
import { hash, json } from './io.ts'

const [output, ...artifacts] = process.argv.slice(2)
if (!output || !artifacts.length) throw new Error('Specify report path and lossless artifacts')
const rows = []
for (const artifact of artifacts) {
  const bytes = await readFile(artifact)
  const source = new MemorySource(bytes)
  const structure = await inspectJpegXlSource(source, defaultJpegXlLimits)
  const codestream = new JpegXlCodestreamSource(source, structure)
  const frames = await readJpegXlSourceFrameStructures(codestream, defaultImageLimits)
  const frameSequence: {
    readonly frameType: string
    readonly encoding: string
    readonly codedWidth: number
    readonly codedHeight: number
    readonly flags: number
    readonly patches: number
    readonly patchRectanglePixels: number
    readonly patchBlendModes: readonly number[]
    readonly sectionBytes: number
    readonly featureBytes: number
    readonly patchReferencePixels: number
    readonly patchPlacementCounts: readonly {
      readonly placements: number
      readonly rectangles: number
    }[]
  }[] = []
  for (const entry of frames) {
    const global = entry.sections[0]
    if (!global) throw new Error('Missing frame global section')
    const features = readJpegXlFrameFeatures(
      await codestream.read(global.offset, global.length),
      0,
      entry.frameFlags,
      entry.codedWidth,
      entry.codedHeight,
      entry.extraChannels.length,
    )
    const references = new Map<string, { readonly pixels: number; placements: number }>()
    for (const patch of features.patches) {
      const key = `${patch.referenceId}:${patch.referenceX}:${patch.referenceY}:${patch.width}:${patch.height}`
      const existing = references.get(key)
      if (existing) existing.placements++
      else references.set(key, { pixels: patch.width * patch.height, placements: 1 })
    }
    const placementCounts = new Map<number, number>()
    let patchReferencePixels = 0
    for (const reference of references.values()) {
      patchReferencePixels += reference.pixels
      placementCounts.set(
        reference.placements,
        (placementCounts.get(reference.placements) ?? 0) + 1,
      )
    }
    frameSequence.push({
      frameType: entry.frameType,
      encoding: entry.encoding,
      codedWidth: entry.codedWidth,
      codedHeight: entry.codedHeight,
      flags: entry.frameFlags,
      patches: features.patches.length,
      patchRectanglePixels: features.patches.reduce(
        (total, patch) => total + patch.width * patch.height,
        0,
      ),
      patchBlendModes: [...new Set(features.patches.map((patch) => patch.blendMode))],
      sectionBytes: entry.sections.reduce((total, section) => total + section.length, 0),
      featureBytes: Math.ceil(features.endingBitPosition / 8),
      patchReferencePixels,
      patchPlacementCounts: [...placementCounts].map(([placements, rectangles]) => ({
        placements,
        rectangles,
      })),
    })
  }
  if (!frames.some((frame) => !frame.isPreview)) throw new Error('Missing non-preview frame')
  for (const frame of frames) {
    if (frame.isPreview) continue
    if (frame.encoding !== 'modular') throw new Error('This diagnostic requires Modular encoding')
    const section = frame.sections[0]
    if (!section) throw new Error('Missing LF global section')
    const payload = await codestream.read(section.offset, section.length)
    const features = readJpegXlFrameFeatures(
      payload,
      0,
      frame.frameFlags,
      frame.codedWidth,
      frame.codedHeight,
      frame.extraChannels.length,
    )
    const reader = new JpegXlBitReader(payload, features.endingBitPosition)
    if (!reader.readBits(1)) reader.skipBits(3 * 16)
    const hasGlobalTree = reader.readBits(1) !== 0
    const trees: { readonly section: string; readonly reader: JpegXlBitReader }[] = []
    if (hasGlobalTree) trees.push({ section: 'global', reader })
    const skippedSections: { readonly section: number; readonly reason: string }[] = []
    if (frame.groupsAcross * frame.groupsDown > 1) {
      for (let group = 0; group < frame.groupsAcross * frame.groupsDown; group++) {
        const index = 2 + frame.dcGroupCount + group
        const section = frame.sections[index]
        if (!section) throw new Error('Missing Modular group section')
        const payload = await codestream.read(section.offset, section.length)
        if (new JpegXlBitReader(payload).readBits(1)) continue
        const x = (group % frame.groupsAcross) * frame.groupDimension
        const y = Math.floor(group / frame.groupsAcross) * frame.groupDimension
        const layouts = Array.from({ length: frame.channelCount }, () => ({
          width: Math.min(frame.groupDimension, frame.codedWidth - x),
          height: Math.min(frame.groupDimension, frame.codedHeight - y),
        }))
        try {
          const start = readJpegXlStandaloneModularHeader(payload, 0, layouts)
          trees.push({ section: `group-${group}`, reader: new JpegXlBitReader(payload, start) })
        } catch (error) {
          if (!(error instanceof ImageError) || error.code !== 'UNSUPPORTED_OPERATION') throw error
          skippedSections.push({
            section: index,
            reason: 'Transform header requires a separate probe',
          })
        }
      }
    }
    if (!trees.length)
      rows.push({
        artifact,
        encodedSha256: hash(bytes),
        bytes: bytes.length,
        width: frame.width,
        height: frame.height,
        frameType: frame.frameType,
        frameSequence,
        hasGlobalTree,
        skippedSections,
      })
    for (const entry of trees) {
      const tree = readJpegXlModularTree(entry.reader)
      const code = readJpegXlEntropyCode(entry.reader, tree.leaves)
      const properties = new Uint32Array(4112),
        predictors = new Uint32Array(14)
      const leavesByChannel = new Uint32Array(frame.channelCount)
      for (let channel = 0; channel < frame.channelCount; channel++) {
        const pending = [0]
        while (pending.length) {
          const index = pending.pop(),
            node = index === undefined ? undefined : tree.nodes[index]
          if (!node) throw new Error('Missing channel tree node')
          if (node.kind === 'leaf') leavesByChannel[channel] = (leavesByChannel[channel] ?? 0) + 1
          else if (node.property === 0)
            pending.push(channel > node.split ? node.greater : node.lessOrEqual)
          else pending.push(node.greater, node.lessOrEqual)
        }
      }
      let nonzeroOffsets = 0,
        nonunitMultipliers = 0,
        maximumDepth = 0
      const depths = new Uint16Array(tree.nodes.length)
      for (let index = 0; index < tree.nodes.length; index++) {
        const node = tree.nodes[index],
          depth = depths[index] ?? 0
        if (!node) throw new Error('Missing tree node')
        maximumDepth = Math.max(maximumDepth, depth)
        if (node.kind === 'branch') {
          properties[node.property] = (properties[node.property] ?? 0) + 1
          depths[node.greater] = depth + 1
          depths[node.lessOrEqual] = depth + 1
        } else {
          predictors[node.predictor] = (predictors[node.predictor] ?? 0) + 1
          if (node.offset !== 0) nonzeroOffsets++
          if (node.multiplier !== 1) nonunitMultipliers++
        }
      }
      rows.push({
        artifact,
        encodedSha256: hash(bytes),
        bytes: bytes.length,
        width: frame.width,
        height: frame.height,
        frameType: frame.frameType,
        frameSequence,
        groupDimension: frame.groupDimension,
        hasGlobalTree,
        section: entry.section,
        skippedSections,
        nodes: tree.nodes.length,
        leaves: tree.leaves,
        leavesByChannel: Array.from(leavesByChannel),
        maximumDepth,
        nonzeroOffsets,
        nonunitMultipliers,
        properties: Array.from(properties, (count, property) => ({ property, count })).filter(
          (row) => row.count,
        ),
        predictors: Array.from(predictors, (count, predictor) => ({ predictor, count })).filter(
          (row) => row.count,
        ),
        entropy: {
          prefix: code.huffmanCodes !== undefined,
          histogramCount: code.uintConfigs.length,
          lz77: code.lz77.enabled,
        },
        tree: tree.nodes,
      })
      console.log(
        `${artifact} ${frame.frameType} ${entry.section}: ${tree.leaves} leaves, ${code.uintConfigs.length} histograms, depth ${maximumDepth}`,
      )
    }
  }
}
await json(output, {
  schemaVersion: 1,
  harnessSha256: hash(await readFile(import.meta.filename)),
  policy:
    'Read MA trees from every non-preview frame, identifying reference atlases and displayed frames separately. Record frame extents, section bytes and patch structure. Local transform headers are explicitly skipped. Tree node counts are structure evidence, not pixel-frequency or compression attribution.',
  rows,
})
