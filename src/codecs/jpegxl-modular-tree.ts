import {
  defaultJpegXlWeightedPredictor,
  type JpegXlModularNode,
  JpegXlWeightedPredictor,
} from './jpegxl-decode.ts'
import {
  allocateJpegXlArray,
  type JpegXlEncoderMemory,
  withJpegXlMemory,
} from './jpegxl-encoder-memory.ts'
import { invalidJpegXlInput, rethrowJpegXlNonLimitError } from './jpegxl-errors.ts'
import { sortJpegXlModularTrainingKeys } from './jpegxl-modular-sort.ts'

type Decision =
  | { readonly kind: 'leaf'; readonly predictor: number }
  | {
      readonly kind: 'branch'
      readonly property: number
      readonly split: number
      readonly greater: Decision
      readonly lessOrEqual: Decision
    }

const decisionNeedsWeighted = (node: Decision): boolean =>
  node.kind === 'leaf'
    ? node.predictor === 6
    : node.property === 15 ||
      decisionNeedsWeighted(node.greater) ||
      decisionNeedsWeighted(node.lessOrEqual)

interface TrainingNode {
  samples: Uint32Array | undefined
  readonly depth: number
  readonly predictor: number
  readonly split?: { readonly feature: number; readonly value: number; readonly gain: number }
  children?: { readonly greater: TrainingNode; readonly lessOrEqual: TrainingNode }
}

const properties = [9, 10, 11, 12, 13, 15] as const

// The hybrid token determines its extra-bit count; no per-sample copy is needed.
const residualExtraBitCounts = Uint8Array.from({ length: 256 }, (_, token) =>
  token < 16 ? 0 : Math.floor((token - 16) / 4) + 2,
)

const weightedPredictor = (width: number, memory?: JpegXlEncoderMemory): JpegXlWeightedPredictor =>
  new JpegXlWeightedPredictor(width, defaultJpegXlWeightedPredictor, {
    predictions: allocateJpegXlArray(memory, Float64Array, 4),
    predictionErrors: Array.from({ length: 4 }, () =>
      allocateJpegXlArray(memory, Uint32Array, (width + 2) * 2),
    ),
    errors: allocateJpegXlArray(memory, Int32Array, (width + 2) * 2),
  })

const packResidual = (value: number): number => (value < 0 ? -2 * value - 1 : 2 * value)

const residualToken = (value: number): number => {
  if (value < 16) return value
  const exponent = Math.floor(Math.log2(value))
  return 16 + (exponent - 4) * 4 + Math.floor((value - 2 ** exponent) / 2 ** (exponent - 2))
}

const clusterHistograms = (
  residuals: Uint32Array,
  contexts: Uint16Array,
  leaves: number,
  memory?: JpegXlEncoderMemory,
): { readonly map: Uint8Array; readonly count: number } =>
  withJpegXlMemory(memory, () => {
    const bins = 128
    const frequencies = allocateJpegXlArray(memory, Uint32Array, leaves * bins)
    const totals = allocateJpegXlArray(memory, Uint32Array, leaves)
    const parents = allocateJpegXlArray(memory, Uint16Array, leaves)
    const entropy = allocateJpegXlArray(memory, Float64Array, leaves)
    const symbols = allocateJpegXlArray(memory, Uint16Array, leaves)
    const losses = allocateJpegXlArray(memory, Float64Array, leaves * leaves)
    const countLog = allocateJpegXlArray(memory, Float64Array, 4096)
    for (let n = 1; n < countLog.length; n++) countLog[n] = n * Math.log2(n)
    const logCount = (count: number): number =>
      count < countLog.length ? (countLog[count] ?? 0) : count * Math.log2(count)
    for (let index = 0; index < residuals.length; index++) {
      const context = contexts[index] ?? 0
      const slot = context * bins + residualToken(residuals[index] ?? 0)
      frequencies[slot] = (frequencies[slot] ?? 0) + 1
      totals[context] = (totals[context] ?? 0) + 1
    }
    let active = 0
    for (let leaf = 0; leaf < leaves; leaf++) {
      parents[leaf] = leaf
      let sum = 0,
        used = 0
      for (let token = 0; token < bins; token++) {
        const count = frequencies[leaf * bins + token] ?? 0
        sum += logCount(count)
        if (count) used++
      }
      entropy[leaf] = logCount(totals[leaf] ?? 0) - sum
      symbols[leaf] = used
      if (totals[leaf]) active++
    }
    const loss = (first: number, second: number): number => {
      let sum = 0
      for (let token = 0; token < bins; token++)
        sum += logCount(
          (frequencies[first * bins + token] ?? 0) + (frequencies[second * bins + token] ?? 0),
        )
      return (
        logCount((totals[first] ?? 0) + (totals[second] ?? 0)) -
        sum -
        (entropy[first] ?? 0) -
        (entropy[second] ?? 0) -
        (64 + 4 * Math.min(symbols[first] ?? 0, symbols[second] ?? 0))
      )
    }
    for (let first = 0; first < leaves; first++)
      for (let second = 0; second < first; second++)
        if (totals[first] && totals[second]) losses[first * leaves + second] = loss(first, second)
    while (active > 1) {
      let best = Number.POSITIVE_INFINITY,
        first = -1,
        second = -1
      for (let a = 0; a < leaves; a++) {
        if (!totals[a]) continue
        for (let b = 0; b < a; b++) {
          if (!totals[b]) continue
          const value = losses[a * leaves + b] ?? 0
          if (value < best) {
            best = value
            first = a
            second = b
          }
        }
      }
      if (first < 0 || second < 0 || (active <= 128 && best >= 0)) break
      let sum = 0,
        used = 0
      for (let token = 0; token < bins; token++) {
        const slot = second * bins + token
        const count = (frequencies[slot] ?? 0) + (frequencies[first * bins + token] ?? 0)
        frequencies[slot] = count
        sum += logCount(count)
        if (count) used++
      }
      totals[second] = (totals[second] ?? 0) + (totals[first] ?? 0)
      totals[first] = 0
      parents[first] = second
      entropy[second] = logCount(totals[second] ?? 0) - sum
      symbols[second] = used
      active--
      for (let leaf = 0; leaf < leaves; leaf++)
        if (totals[leaf] && leaf !== second)
          losses[Math.max(leaf, second) * leaves + Math.min(leaf, second)] = loss(leaf, second)
    }
    const dense = allocateJpegXlArray(memory, Uint16Array, leaves)
    let count = 0
    for (let leaf = 0; leaf < leaves; leaf++) if (totals[leaf]) dense[leaf] = count++
    const map = allocateJpegXlArray(memory, Uint8Array, leaves)
    for (let leaf = 0; leaf < leaves; leaf++) {
      let root = leaf
      while (parents[root] !== root) root = parents[root] ?? root
      map[leaf] = dense[root] ?? 0
    }
    return { map, count: Math.max(1, count) }
  })

const clampedResidual = (sample: number, left: number, top: number, topLeft: number): number => {
  const prediction = Math.max(
    Math.min(left, top),
    Math.min(Math.max(left, top), left + top - topLeft),
  )
  const residual = sample - prediction
  return packResidual(residual)
}

const learnPlane = (
  plane: Int32Array,
  width: number,
  predictor: number,
  residuals: Uint32Array,
  residualOffset: number,
  memory?: JpegXlEncoderMemory,
  maxSamples = 65536,
  splitOverhead = 1,
): Decision =>
  withJpegXlMemory(memory, () => {
    const count = Math.min(maxSamples, plane.length)
    // Zero sampled residuals give the original predictor zero cost and one symbol, so no split.
    let allZero = true
    for (let sample = 0; sample < count; sample++) {
      const fraction = (Math.imul(sample + 1, 0x9e3779b1) >>> 0) / 4294967296
      const position = Math.min(
        plane.length - 1,
        Math.floor(((sample + fraction) * plane.length) / count),
      )
      if (residuals[residualOffset + position] !== 0) {
        allZero = false
        break
      }
    }
    if (allZero) return { kind: 'leaf', predictor }
    const candidates = [predictor]
    if (predictor !== 5) candidates.push(5)
    if (predictor !== 6) candidates.push(6)
    const modes = candidates.length
    const features = allocateJpegXlArray(memory, Int32Array, count * properties.length)
    const tokens = allocateJpegXlArray(memory, Uint8Array, count * modes)
    const indices = allocateJpegXlArray(memory, Uint32Array, count)
    const positions = allocateJpegXlArray(memory, Uint32Array, count)
    const countLog = allocateJpegXlArray(memory, Float64Array, count + 1)
    const weightedProperties = allocateJpegXlArray(memory, Int32Array, 16)
    const weighted = weightedPredictor(width, memory)
    for (let n = 1; n <= count; n++) countLog[n] = n * Math.log2(n)
    for (let sample = 0; sample < count; sample++) {
      const fraction = (Math.imul(sample + 1, 0x9e3779b1) >>> 0) / 4294967296
      positions[sample] = Math.min(
        plane.length - 1,
        Math.floor(((sample + fraction) * plane.length) / count),
      )
      indices[sample] = sample
    }
    let sample = 0
    for (let position = 0; position < plane.length; position++) {
      const y = Math.floor(position / width),
        x = position - y * width
      const left = x > 0 ? (plane[position - 1] ?? 0) : y > 0 ? (plane[position - width] ?? 0) : 0
      const top = y > 0 ? (plane[position - width] ?? 0) : left
      const topLeft = x > 0 && y > 0 ? (plane[position - width - 1] ?? 0) : left
      const topRight = y > 0 && x + 1 < width ? (plane[position - width + 1] ?? 0) : top
      const topTop = y > 1 ? (plane[position - 2 * width] ?? 0) : top
      const prediction = weighted.predict(
        x,
        y,
        width,
        top,
        left,
        topRight,
        topLeft,
        topTop,
        weightedProperties,
      )
      weighted.update(plane[position] ?? 0, x, y)
      if (position !== positions[sample]) continue
      const featureOffset = sample * properties.length
      features[featureOffset] = left + top - topLeft
      features[featureOffset + 1] = left - topLeft
      features[featureOffset + 2] = topLeft - top
      features[featureOffset + 3] = top - topRight
      features[featureOffset + 4] = top - topTop
      features[featureOffset + 5] = weightedProperties[15] ?? 0
      for (let mode = 0; mode < modes; mode++) {
        const token = residualToken(
          candidates[mode] === 5
            ? clampedResidual(plane[position] ?? 0, left, top, topLeft)
            : candidates[mode] === 6
              ? packResidual((plane[position] ?? 0) - prediction)
              : (residuals[residualOffset + position] ?? 0),
        )
        tokens[sample * modes + mode] = token
      }
      sample++
    }
    const evaluate = (samples: Uint32Array, depth: number): TrainingNode =>
      withJpegXlMemory(memory, () => {
        const counts = allocateJpegXlArray(memory, Uint32Array, 256 * modes)
        const histogramLog = allocateJpegXlArray(memory, Float64Array, modes)
        const extraBits = allocateJpegXlArray(memory, Uint32Array, modes)
        for (const sample of samples) {
          for (let mode = 0; mode < modes; mode++) {
            const token = tokens[sample * modes + mode] ?? 0
            const index = mode * 256 + token
            counts[index] = (counts[index] ?? 0) + 1
            extraBits[mode] = (extraBits[mode] ?? 0) + (residualExtraBitCounts[token] ?? 0)
          }
        }
        let bestMode = 0,
          unsplitBits = Number.POSITIVE_INFINITY,
          symbols = 0
        for (let mode = 0; mode < modes; mode++) {
          let sum = 0,
            used = 0
          for (let token = 0; token < 256; token++) {
            const frequency = counts[mode * 256 + token] ?? 0
            sum += countLog[frequency] ?? 0
            if (frequency) used++
          }
          histogramLog[mode] = sum
          const bits = (countLog[samples.length] ?? 0) - sum + (extraBits[mode] ?? 0)
          if (bits < unsplitBits) {
            unsplitBits = bits
            bestMode = mode
            symbols = used
          }
        }
        const leaf: TrainingNode = { samples, depth, predictor: candidates[bestMode] ?? predictor }
        if (samples.length < 64 || depth >= 16 || symbols <= 1) return leaf
        const sorted = allocateJpegXlArray(memory, Float64Array, samples.length)
        const leftCounts = allocateJpegXlArray(memory, Uint32Array, 256 * modes)
        const rightCounts = allocateJpegXlArray(memory, Uint32Array, 256 * modes)
        let sortScratch: Float64Array | undefined
        if (samples.length >= 1024) {
          try {
            sortScratch = allocateJpegXlArray(memory, Float64Array, samples.length)
          } catch (error) {
            rethrowJpegXlNonLimitError(error)
          }
        }
        let bestGain = ((96 + symbols * 4) * count * splitOverhead) / plane.length
        let bestFeature = -1,
          bestSplit = 0
        for (let feature = 0; feature < properties.length; feature++) {
          for (let i = 0; i < samples.length; i++) {
            const sample = samples[i] ?? 0
            sorted[i] = (features[sample * properties.length + feature] ?? 0) * count + sample
          }
          // The prefix scan uses the same numeric key order, including ties.
          // Optional scratch is allocated after required storage; LIMIT keeps native sorting.
          if (sortScratch) sortJpegXlModularTrainingKeys(sorted, sortScratch, leftCounts)
          else sorted.sort()
          leftCounts.fill(0)
          rightCounts.set(counts)
          // There are always two or three predictor modes. Keep their prefix sums
          // local, preserving Float64 operation order and Uint32 extra-bit sums.
          let leftLog0 = 0,
            leftLog1 = 0,
            leftLog2 = 0,
            rightLog0 = histogramLog[0] ?? 0,
            rightLog1 = histogramLog[1] ?? 0,
            rightLog2 = histogramLog[2] ?? 0,
            leftExtra0 = 0,
            leftExtra1 = 0,
            leftExtra2 = 0,
            nextValue = Math.floor((sorted[0] ?? 0) / count)
          for (let i = 0; i + 1 < samples.length; i++) {
            const key = sorted[i] ?? 0
            const value = nextValue,
              sample = key - value * count,
              offset = sample * modes,
              token0 = tokens[offset] ?? 0,
              token1 = tokens[offset + 1] ?? 0,
              index0 = token0,
              index1 = 256 + token1,
              left0 = leftCounts[index0] ?? 0,
              right0 = rightCounts[index0] ?? 0,
              left1 = leftCounts[index1] ?? 0,
              right1 = rightCounts[index1] ?? 0
            leftLog0 = leftLog0 + (countLog[left0 + 1] ?? 0) - (countLog[left0] ?? 0)
            rightLog0 = rightLog0 + (countLog[right0 - 1] ?? 0) - (countLog[right0] ?? 0)
            leftLog1 = leftLog1 + (countLog[left1 + 1] ?? 0) - (countLog[left1] ?? 0)
            rightLog1 = rightLog1 + (countLog[right1 - 1] ?? 0) - (countLog[right1] ?? 0)
            leftCounts[index0] = left0 + 1
            rightCounts[index0] = right0 - 1
            leftCounts[index1] = left1 + 1
            rightCounts[index1] = right1 - 1
            leftExtra0 = (leftExtra0 + (residualExtraBitCounts[token0] ?? 0)) >>> 0
            leftExtra1 = (leftExtra1 + (residualExtraBitCounts[token1] ?? 0)) >>> 0
            if (modes === 3) {
              const token2 = tokens[offset + 2] ?? 0,
                index2 = 512 + token2,
                left2 = leftCounts[index2] ?? 0,
                right2 = rightCounts[index2] ?? 0
              leftLog2 = leftLog2 + (countLog[left2 + 1] ?? 0) - (countLog[left2] ?? 0)
              rightLog2 = rightLog2 + (countLog[right2 - 1] ?? 0) - (countLog[right2] ?? 0)
              leftCounts[index2] = left2 + 1
              rightCounts[index2] = right2 - 1
              leftExtra2 = (leftExtra2 + (residualExtraBitCounts[token2] ?? 0)) >>> 0
            }
            // Reuse this boundary value to decode the next key, including skipped splits.
            nextValue = Math.floor((sorted[i + 1] ?? 0) / count)
            const leftCount = i + 1,
              rightCount = samples.length - leftCount
            if (leftCount < 32 || rightCount < 32 || value === nextValue) continue
            const leftCountLog = countLog[leftCount] ?? 0,
              rightCountLog = countLog[rightCount] ?? 0,
              leftBits = Math.min(
                leftCountLog - leftLog0 + leftExtra0,
                leftCountLog - leftLog1 + leftExtra1,
                modes === 3 ? leftCountLog - leftLog2 + leftExtra2 : Infinity,
              ),
              rightBits = Math.min(
                rightCountLog - rightLog0 + (extraBits[0] ?? 0) - leftExtra0,
                rightCountLog - rightLog1 + (extraBits[1] ?? 0) - leftExtra1,
                modes === 3
                  ? rightCountLog - rightLog2 + (extraBits[2] ?? 0) - leftExtra2
                  : Infinity,
              )
            const gain = unsplitBits - leftBits - rightBits
            if (gain > bestGain) {
              bestGain = gain
              bestFeature = feature
              bestSplit = value
            }
          }
        }
        if (bestFeature < 0) return leaf
        return {
          ...leaf,
          split: { feature: bestFeature, value: bestSplit, gain: bestGain },
        }
      })
    const root = evaluate(indices, 0)
    const active = [root]
    for (let leaves = 1; leaves < 256; leaves++) {
      let bestIndex = -1,
        bestGain = 0
      for (let index = 0; index < active.length; index++) {
        const gain = active[index]?.split?.gain ?? 0
        if (gain > bestGain) {
          bestGain = gain
          bestIndex = index
        }
      }
      if (bestIndex < 0) break
      const node = active[bestIndex],
        split = node?.split,
        samples = node?.samples
      if (!node || !split || !samples) throw invalidJpegXlInput('training node is missing')
      let lessCount = 0
      for (const sample of samples)
        if ((features[sample * properties.length + split.feature] ?? 0) <= split.value) lessCount++
      const less = allocateJpegXlArray(memory, Uint32Array, lessCount)
      const greater = allocateJpegXlArray(memory, Uint32Array, samples.length - lessCount)
      let a = 0,
        b = 0
      for (const sample of samples) {
        if ((features[sample * properties.length + split.feature] ?? 0) <= split.value)
          less[a++] = sample
        else greater[b++] = sample
      }
      memory?.release(samples)
      node.samples = undefined
      node.children = {
        greater: evaluate(greater, node.depth + 1),
        lessOrEqual: evaluate(less, node.depth + 1),
      }
      active.splice(bestIndex, 1, node.children.greater, node.children.lessOrEqual)
    }
    const decision = (node: TrainingNode): Decision => {
      if (!node.children) return { kind: 'leaf', predictor: node.predictor }
      const property = node.split ? properties[node.split.feature] : undefined
      if (!node.split || property === undefined)
        throw invalidJpegXlInput('learned property is missing')
      return {
        kind: 'branch',
        property,
        split: node.split.value,
        greater: decision(node.children.greater),
        lessOrEqual: decision(node.children.lessOrEqual),
      }
    }
    return decision(root)
  })

export const learnJpegXlModularTree = (
  values: readonly Int32Array[],
  widths: readonly number[],
  predictors: readonly number[],
  residuals: Uint32Array,
  memory?: JpegXlEncoderMemory,
  maxSamples = 65536,
  splitOverhead = 1,
):
  | {
      readonly nodes: readonly JpegXlModularNode[]
      readonly contexts: Uint16Array
      readonly residuals: Uint32Array
      readonly leaves: number
      readonly histogramMap: Uint8Array
      readonly histogramCount: number
    }
  | undefined =>
  withJpegXlMemory(memory, () => {
    const roots: Decision[] = []
    let residualOffset = 0
    for (let channel = 0; channel < values.length; channel++) {
      const plane = values[channel],
        width = widths[channel],
        predictor = predictors[channel]
      if (!plane || width === undefined || predictor === undefined)
        throw invalidJpegXlInput('learned plane is missing')
      roots.push(
        learnPlane(
          plane,
          width,
          predictor,
          residuals,
          residualOffset,
          memory,
          maxSamples,
          splitOverhead,
        ),
      )
      residualOffset += plane.length
    }
    if (
      roots.every((root, channel) => root.kind === 'leaf' && root.predictor === predictors[channel])
    )
      return undefined
    const channels = (first: number, last: number): Decision => {
      if (first === last) {
        const root = roots[first]
        if (!root) throw invalidJpegXlInput('learned root is missing')
        return root
      }
      const split = Math.floor((first + last) / 2)
      return {
        kind: 'branch',
        property: 0,
        split,
        greater: channels(split + 1, last),
        lessOrEqual: channels(first, split),
      }
    }
    const pending = [channels(0, roots.length - 1)]
    const nodes: JpegXlModularNode[] = []
    let leaves = 0
    for (let i = 0; i < pending.length; i++) {
      const node = pending[i]
      if (!node) throw invalidJpegXlInput('learned node is missing')
      if (node.kind === 'leaf')
        nodes.push({
          kind: 'leaf',
          predictor: node.predictor,
          offset: 0,
          multiplier: 1,
          context: leaves++,
        })
      else {
        const greater = pending.length
        pending.push(node.greater, node.lessOrEqual)
        nodes.push({
          kind: 'branch',
          property: node.property,
          split: node.split,
          greater,
          lessOrEqual: greater + 1,
        })
      }
    }
    const { contexts, residuals: learnedResiduals } = applyJpegXlModularTree(
      nodes,
      values,
      widths,
      residuals,
      memory,
      roots.map(decisionNeedsWeighted),
    )
    const histograms = clusterHistograms(learnedResiduals, contexts, leaves, memory)
    return {
      nodes: Object.freeze(nodes),
      contexts,
      residuals: learnedResiduals,
      leaves,
      histogramMap: histograms.map,
      histogramCount: histograms.count,
    }
  })

export const applyJpegXlModularTree = (
  nodes: readonly JpegXlModularNode[],
  values: readonly Int32Array[],
  widths: readonly number[],
  originalResiduals: Uint32Array,
  memory?: JpegXlEncoderMemory,
  weightedChannels?: readonly boolean[],
) => {
  const count = originalResiduals.length
  const contexts = allocateJpegXlArray(memory, Uint16Array, count)
  const residuals = allocateJpegXlArray(memory, Uint32Array, count)
  const usesWeighted = nodes.some((node) =>
    node.kind === 'leaf' ? node.predictor === 6 : node.property === 15,
  )
  let offset = 0
  for (let channel = 0; channel < values.length; channel++) {
    const plane = values[channel],
      width = widths[channel]
    if (!plane || width === undefined) throw invalidJpegXlInput('learned context plane is missing')
    const weighted =
      (weightedChannels?.[channel] ?? usesWeighted) ? weightedPredictor(width, memory) : undefined
    const weightedProperties = allocateJpegXlArray(memory, Int32Array, 16)
    for (let position = 0; position < plane.length; position++) {
      const y = Math.floor(position / width),
        x = position - y * width
      const left = x > 0 ? (plane[position - 1] ?? 0) : y > 0 ? (plane[position - width] ?? 0) : 0
      const top = y > 0 ? (plane[position - width] ?? 0) : left
      const topLeft = x > 0 && y > 0 ? (plane[position - width - 1] ?? 0) : left
      const topRight = y > 0 && x + 1 < width ? (plane[position - width + 1] ?? 0) : top
      const topTop = y > 1 ? (plane[position - 2 * width] ?? 0) : top
      const prediction =
        weighted?.predict(x, y, width, top, left, topRight, topLeft, topTop, weightedProperties) ??
        0
      let index = 0
      while (true) {
        const node = nodes[index]
        if (!node) throw invalidJpegXlInput('learned context node is missing')
        if (node.kind === 'leaf') {
          contexts[offset] = node.context
          residuals[offset] =
            node.predictor === 5
              ? clampedResidual(plane[position] ?? 0, left, top, topLeft)
              : node.predictor === 6
                ? packResidual((plane[position] ?? 0) - prediction)
                : (originalResiduals[offset] ?? 0)
          offset++
          break
        }
        const property =
          node.property === 0
            ? channel
            : node.property === 9
              ? left + top - topLeft
              : node.property === 10
                ? left - topLeft
                : node.property === 11
                  ? topLeft - top
                  : node.property === 12
                    ? top - topRight
                    : node.property === 13
                      ? top - topTop
                      : (weightedProperties[15] ?? 0)
        index = property > node.split ? node.greater : node.lessOrEqual
      }
      weighted?.update(plane[position] ?? 0, x, y)
    }
  }
  return { residuals, contexts }
}
