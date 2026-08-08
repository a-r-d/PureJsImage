import { createSharpEngine } from './sharp.ts'

export const engine = createSharpEngine({ id: 'sharp-single-thread', singleThread: true })
