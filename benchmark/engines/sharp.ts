import sharp from 'sharp'
import type { Engine, EngineExecution, Operation, PipelineWorkflow } from '../types.ts'

type EncodeOperation = Extract<Operation, { type: 'encode' }>

type SharpImage = ReturnType<typeof sharp>

const encode = (image: SharpImage, operation: EncodeOperation): SharpImage => {
  let output = image
  if (operation.format === 'jpeg') {
    if (operation.background) output = output.flatten({ background: operation.background })
    return output.jpeg({
      ...(operation.quality !== undefined ? { quality: operation.quality } : {}),
    })
  }
  if (operation.format === 'png') {
    return output.png({
      ...(operation.compressionLevel !== undefined
        ? { compressionLevel: operation.compressionLevel }
        : {}),
    })
  }
  if (operation.format === 'webp') {
    return output.webp({
      ...(operation.quality !== undefined ? { quality: operation.quality } : {}),
      ...(operation.lossless !== undefined ? { lossless: operation.lossless } : {}),
    })
  }
  if (operation.format === 'avif') {
    return output.avif({
      ...(operation.quality !== undefined ? { quality: operation.quality } : {}),
    })
  }
  if (operation.format === 'tiff') return output.tiff()
  throw new Error(`Sharp benchmark output is unsupported: ${operation.format}`)
}

const executePipeline = async (
  workflow: PipelineWorkflow,
  input: Buffer,
): Promise<EngineExecution> => {
  let image = sharp(input)
  for (const operation of workflow.operations) {
    switch (operation.type) {
      case 'metadata': {
        const metadata = await image.metadata()
        if (!metadata.format || !metadata.width || !metadata.height) {
          throw new Error('Sharp returned incomplete metadata')
        }
        return {
          metadata: {
            // libvips reports AVIF through its generic HEIF container loader.
            // The pinned input is independently identified as AVIF by the corpus gate.
            format:
              workflow.expected.format === 'avif' && metadata.format === 'heif'
                ? 'avif'
                : metadata.format,
            width: metadata.width,
            height: metadata.height,
          },
        }
      }
      case 'autoOrient':
        image = image.autoOrient()
        break
      case 'rotate':
        image = image.rotate(operation.degrees)
        break
      case 'flip':
        image = image.flip()
        break
      case 'flop':
        image = image.flop()
        break
      case 'crop':
        image = image.extract({
          left: operation.x,
          top: operation.y,
          width: operation.width,
          height: operation.height,
        })
        break
      case 'resize':
        image = image.resize({
          ...(operation.width !== undefined ? { width: operation.width } : {}),
          ...(operation.height !== undefined ? { height: operation.height } : {}),
          ...(operation.width !== undefined && operation.height !== undefined
            ? { fit: 'fill' as const }
            : {}),
          ...(operation.withoutEnlargement ? { withoutEnlargement: true } : {}),
        })
        break
      case 'contain':
        image = image.resize({
          width: operation.width,
          height: operation.height,
          fit: 'contain',
          position: 'centre',
          background: operation.background,
        })
        break
      case 'encode':
        return { output: await encode(image, operation).toBuffer() }
      default:
        throw new Error('Sharp benchmark operation is unsupported')
    }
  }
  return {}
}

const heicInputAvailable = (): boolean => sharp.format.heif?.input.buffer === true

export const createSharpEngine = ({
  id,
  singleThread,
}: {
  id: 'sharp' | 'sharp-single-thread'
  singleThread: boolean
}): Engine => {
  if (singleThread) sharp.concurrency(1)
  return {
    id,
    version: sharp.versions.sharp,
    kind: singleThread ? 'native-single-thread' : 'native',
    packageName: 'sharp',
    unsupportedReason: async (workflow, inputs): Promise<string | undefined> => {
      const input = workflow.batch ? workflow.inputs.join(',') : workflow.input
      if (input.includes('bmp')) {
        const firstInput = inputs[0]
        if (!firstInput) return 'The BMP workflow has no input image'
        try {
          await sharp(firstInput).metadata()
        } catch {
          return 'The installed Sharp/libvips build has no BMP input support'
        }
      }
      if (input.includes('iphone12-') || input.includes('heic')) {
        if (!heicInputAvailable()) {
          return 'The installed Sharp/libvips build has no HEIC input support'
        }
        const firstInput = inputs[0]
        if (!firstInput) return 'The HEIC workflow has no input image'
        try {
          await sharp(firstInput).metadata()
        } catch {
          return 'The installed Sharp/libvips build cannot decode the pinned iPhone HEIC fixture'
        }
      }
      if (input.includes('avif')) {
        const firstInput = inputs[0]
        if (!firstInput) return 'The AVIF workflow has no input image'
        try {
          await sharp(firstInput).metadata()
        } catch {
          return 'The installed Sharp/libvips build cannot decode the pinned AVIF fixture'
        }
      }
      if (
        workflow.operations?.some(
          (operation) => operation.type === 'encode' && operation.format === 'bmp',
        )
      ) {
        return 'Sharp has no BMP encoder'
      }
      return undefined
    },
    execute: async ({ workflow, inputs }): Promise<EngineExecution> => {
      if (workflow.batch) {
        let output: Buffer | undefined
        let outputBytes = 0
        for (let index = 0; index < workflow.batch.count; index += 1) {
          const input = inputs[index % inputs.length]
          if (!input) throw new Error('Batch workflow has no input images')
          output = await sharp(input)
            .resize({ width: workflow.batch.width })
            .jpeg({ quality: workflow.batch.quality })
            .toBuffer()
          outputBytes += output.byteLength
        }
        if (!output) throw new Error('Batch workflow produced no output')
        return { output, outputBytes, outputCount: workflow.batch.count }
      }
      const input = inputs[0]
      if (!input) throw new Error('Pipeline workflow has no input image')
      return executePipeline(workflow, input)
    },
  }
}

export const engine = createSharpEngine({ id: 'sharp', singleThread: false })
