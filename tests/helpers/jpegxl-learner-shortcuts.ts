import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { learnJpegXlModularTree } from '../../src/codecs/jpegxl-modular-tree.ts'

export const verifySampledZeroLearning = (maxSamples: 8192 | 16384) => {
  const width = 256,
    count = width * width,
    memory = new JpegXlEncoderMemory(16_777_216)
  const first = new Int32Array(count)
  const residuals = new Uint32Array(count)
  first[0] = 7
  residuals[0] = 14
  let firstResidual = 0
  try {
    const tree = learnJpegXlModularTree([first], [width], [0], residuals, memory, maxSamples)
    if (tree !== undefined || first[0] !== 7 || residuals[0] !== 14)
      throw new Error('Sampled zero learning discarded an unsampled value')

    const alpha = new Int32Array(count).fill(255)
    const color = new Int32Array(count)
    const mixedResiduals = new Uint32Array(count * 2)
    mixedResiduals[0] = 510
    for (let position = 0; position < count; position++) {
      const value = ((position % width) + Math.floor(position / width)) & 255
      color[position] = value
      mixedResiduals[count + position] = value * 2
    }
    const mixed = learnJpegXlModularTree(
      [alpha, color],
      [width, width],
      [1, 0],
      mixedResiduals,
      memory,
      maxSamples,
    )
    if (!mixed || mixed.residuals.length !== mixedResiduals.length)
      throw new Error('Mixed channel fixture did not learn a model')
    for (let position = 0; position < count; position++) {
      if (
        mixed.residuals[position] !== mixedResiduals[position] ||
        alpha[position] !== 255 ||
        color[position] !== ((position % width) + Math.floor(position / width)) % 256
      )
        throw new Error('Learning changed a constant channel or an original input')
    }
    firstResidual = mixed.residuals[0] ?? 0
  } finally {
    memory.close()
  }
  if (memory.liveBytes !== 0 || memory.liveAllocations !== 0)
    throw new Error('Learner shortcut storage did not close')
  return { maxSamples, preservedResiduals: count, firstResidual }
}
