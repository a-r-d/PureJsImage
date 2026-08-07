import type { BenchmarkColor, Operation, Workflow } from './types.ts'

const jpeg = (quality: number, background?: BenchmarkColor): Operation => ({
  type: 'encode',
  format: 'jpeg',
  quality,
  ...(background ? { background } : {}),
})

const png = (compressionLevel = 6): Operation => ({
  type: 'encode',
  format: 'png',
  compressionLevel,
})

export const workflows: readonly Workflow[] = [
  {
    id: 'metadata-jpeg-large',
    title: 'Read metadata from a 6000x4000 JPEG',
    tier: 'standard',
    input: 'old-faithful-6000x4000',
    operations: [{ type: 'metadata' }],
    expected: { format: 'jpeg', width: 6000, height: 4000 },
  },
  {
    id: 'jpeg-resize-1200',
    title: '4000x3000 JPEG to 1200px JPEG quality 80',
    tier: 'smoke',
    input: 'tundra-4000x3000',
    operations: [{ type: 'resize', width: 1200 }, jpeg(80)],
    expected: { format: 'jpeg', width: 1200, height: 900 },
  },
  {
    id: 'northstar-photo-pipeline',
    title: '6000x4000 JPEG, center crop 4:3, resize 1200x900, JPEG 80',
    tier: 'standard',
    input: 'old-faithful-6000x4000',
    operations: [
      { type: 'autoOrient' },
      { type: 'crop', x: 333, y: 0, width: 5334, height: 4000 },
      { type: 'resize', width: 1200, height: 900 },
      jpeg(80),
    ],
    expected: { format: 'jpeg', width: 1200, height: 900 },
  },
  {
    id: 'jpeg-crop-resize',
    title: '6000x4000 JPEG, center crop 3000x2000, resize 800x533',
    tier: 'standard',
    input: 'old-faithful-6000x4000',
    operations: [
      { type: 'crop', x: 1500, y: 1000, width: 3000, height: 2000 },
      { type: 'resize', width: 800, height: 533 },
      jpeg(75),
    ],
    expected: { format: 'jpeg', width: 800, height: 533 },
  },
  {
    id: 'png-resize-1000',
    title: '4000x3000 RGBA PNG to 1000px PNG',
    tier: 'standard',
    input: 'rgba-gradient-4000x3000',
    operations: [{ type: 'resize', width: 1000 }, png(6)],
    expected: { format: 'png', width: 1000, height: 750 },
  },
  {
    id: 'png-alpha-resize',
    title: 'Transparent PNG resize with alpha preservation',
    tier: 'smoke',
    input: 'transparent-logo-1200x480',
    operations: [{ type: 'resize', width: 800 }, png(6)],
    expected: {
      format: 'png',
      width: 800,
      height: 320,
      cornerAlpha: 0,
    },
  },
  {
    id: 'jpeg-to-png',
    title: '2400x2400 JPEG to PNG',
    tier: 'standard',
    input: 'earthrise-2400x2400',
    operations: [png(6)],
    expected: { format: 'png', width: 2400, height: 2400 },
  },
  {
    id: 'png-to-jpeg',
    title: 'Transparent PNG to JPEG quality 80 on white',
    tier: 'standard',
    input: 'transparent-logo-1200x480',
    operations: [jpeg(80, '#ffffff')],
    expected: {
      format: 'jpeg',
      width: 1200,
      height: 480,
      cornerRgbMinimum: 240,
    },
  },
  {
    id: 'auto-orient-6',
    title: 'EXIF orientation 6 JPEG auto-orient and encode',
    tier: 'standard',
    input: 'exif-orientation-6',
    operations: [{ type: 'autoOrient' }, jpeg(80)],
    expected: { format: 'jpeg', width: 1800, height: 1200 },
  },
  {
    id: 'gif-first-frame-png',
    title: 'Decode first composited frame of a 70-frame GIF to PNG',
    tier: 'smoke',
    input: 'animated-gif-cc0',
    operations: [png(6)],
    expected: { format: 'png', width: 200, height: 200 },
  },
  {
    id: 'png-palette-roundtrip',
    title: 'Palette PNG decode and encode',
    tier: 'standard',
    input: 'pngsuite-palette-8',
    operations: [png(6)],
    expected: { format: 'png', width: 32, height: 32 },
  },
  {
    id: 'png-crop-roundtrip',
    title: 'Transparent 1200x480 PNG crop to 1000x400 PNG',
    tier: 'standard',
    input: 'transparent-logo-1200x480',
    operations: [{ type: 'crop', x: 100, y: 40, width: 1000, height: 400 }, png(6)],
    expected: { format: 'png', width: 1000, height: 400, cornerAlpha: 0 },
  },
  {
    id: 'png-crop-resize-roundtrip',
    title: '4000x3000 PNG crop to 2000x1500 and resize to 500x375 PNG',
    tier: 'standard',
    input: 'rgba-gradient-4000x3000',
    operations: [
      { type: 'crop', x: 1000, y: 750, width: 2000, height: 1500 },
      { type: 'resize', width: 500 },
      png(6),
    ],
    expected: { format: 'png', width: 500, height: 375 },
  },
  {
    id: 'png-gray16-to-jpeg',
    title: '16-bit grayscale PNG to JPEG',
    tier: 'standard',
    input: 'pngsuite-gray-16',
    operations: [jpeg(80)],
    expected: { format: 'jpeg', width: 32, height: 32 },
  },
  {
    id: 'tooldesk-upload-jpeg-1024',
    title: 'Tooldesk chat upload: JPEG downscale to 1024 and encode JPEG 80',
    tier: 'standard',
    input: 'tundra-4000x3000',
    operations: [{ type: 'resize', width: 1024, withoutEnlargement: true }, jpeg(80, '#ffffff')],
    expected: { format: 'jpeg', width: 1024, height: 768 },
  },
  {
    id: 'tooldesk-upload-png-2048',
    title: 'Tooldesk microsite upload: PNG downscale to 2048 and JPEG 80',
    tier: 'standard',
    input: 'rgba-gradient-4000x3000',
    operations: [{ type: 'resize', width: 2048, withoutEnlargement: true }, jpeg(80, '#ffffff')],
    expected: { format: 'jpeg', width: 2048, height: 1536 },
  },
  {
    id: 'tooldesk-upload-gif-no-enlarge',
    title: 'Tooldesk chat upload: small GIF first frame without enlargement',
    tier: 'standard',
    input: 'static-transparent-640x360',
    operations: [{ type: 'resize', width: 1024, withoutEnlargement: true }, jpeg(80, '#ffffff')],
    expected: {
      format: 'jpeg',
      width: 640,
      height: 360,
      cornerRgbMinimum: 240,
    },
  },
  {
    id: 'tooldesk-logo-jpeg',
    title: 'Tooldesk logo: portrait JPEG in centered transparent 256 canvas',
    tier: 'standard',
    input: 'portrait-2400x3000',
    operations: [
      {
        type: 'contain',
        width: 256,
        height: 256,
        position: 'center',
        background: 'transparent',
      },
      png(6),
    ],
    expected: { format: 'png', width: 256, height: 256, cornerAlpha: 0 },
  },
  {
    id: 'tooldesk-logo-png',
    title: 'Tooldesk logo: transparent PNG in centered transparent 256 canvas',
    tier: 'standard',
    input: 'transparent-logo-1200x480',
    operations: [
      {
        type: 'contain',
        width: 256,
        height: 256,
        position: 'center',
        background: 'transparent',
      },
      png(6),
    ],
    expected: { format: 'png', width: 256, height: 256, cornerAlpha: 0 },
  },
  {
    id: 'tooldesk-logo-gif',
    title: 'Tooldesk logo: GIF first frame in centered transparent 256 canvas',
    tier: 'standard',
    input: 'animated-gif-cc0',
    operations: [
      {
        type: 'contain',
        width: 256,
        height: 256,
        position: 'center',
        background: 'transparent',
      },
      png(6),
    ],
    expected: { format: 'png', width: 256, height: 256 },
  },
  {
    id: 'odd-dimensions-resize',
    title: 'Odd-sized 257x193 RGBA PNG to width 100',
    tier: 'standard',
    input: 'odd-rgba-257x193',
    operations: [{ type: 'resize', width: 100 }, png(6)],
    expected: { format: 'png', width: 100, height: 75 },
  },
  {
    id: 'tiny-transparent-convert',
    title: '1x1 transparent PNG to JPEG on white',
    tier: 'standard',
    input: 'tiny-transparent-1x1',
    operations: [jpeg(80, '#ffffff')],
    expected: {
      format: 'jpeg',
      width: 1,
      height: 1,
      cornerRgbMinimum: 240,
    },
  },
  {
    id: 'high-entropy-png-to-jpeg',
    title: '2048x2048 high-entropy PNG to JPEG quality 80',
    tier: 'standard',
    input: 'noise-2048x2048',
    operations: [jpeg(80)],
    expected: { format: 'jpeg', width: 2048, height: 2048 },
  },
  {
    id: 'batch-100-thumbnails',
    title: 'Batch 100 mixed JPEG images to 320px JPEG thumbnails',
    tier: 'full',
    inputs: ['tundra-4000x3000', 'portrait-2400x3000', 'earthrise-2400x2400'],
    batch: { count: 100, width: 320, quality: 75 },
    expected: { format: 'jpeg', outputs: 100 },
    defaultRuns: 2,
    defaultWarmups: 0,
    timeoutMs: 300000,
  },
  {
    id: 'stress-100mp-downscale',
    title: '10000x10000 RGBA PNG to 1000x1000 PNG',
    tier: 'full',
    input: 'stress-gradient-10000x10000',
    operations: [{ type: 'resize', width: 1000, height: 1000 }, png(6)],
    expected: { format: 'png', width: 1000, height: 1000 },
    defaultRuns: 2,
    defaultWarmups: 0,
    timeoutMs: 120000,
  },
]

const phase4WorkflowIds = new Set([
  'jpeg-resize-1200',
  'northstar-photo-pipeline',
  'jpeg-crop-resize',
  'jpeg-to-png',
  'png-to-jpeg',
  'auto-orient-6',
  'png-gray16-to-jpeg',
  'tooldesk-upload-jpeg-1024',
  'tooldesk-upload-png-2048',
  'tooldesk-logo-jpeg',
  'tiny-transparent-convert',
  'high-entropy-png-to-jpeg',
])

const phase5WorkflowIds = new Set([
  'jpeg-to-png',
  'png-to-jpeg',
  'gif-first-frame-png',
  'tooldesk-upload-gif-no-enlarge',
  'tooldesk-logo-gif',
])

export const workflowsForProfile = (profile: string): readonly Workflow[] => {
  if (profile === 'smoke') {
    return workflows.filter((workflow) => workflow.tier === 'smoke')
  }
  if (profile === 'standard') {
    return workflows.filter((workflow) => workflow.tier !== 'full')
  }
  if (profile === 'phase4') {
    return workflows.filter((workflow) => phase4WorkflowIds.has(workflow.id))
  }
  if (profile === 'phase5') {
    return workflows.filter((workflow) => phase5WorkflowIds.has(workflow.id))
  }
  if (profile === 'full') {
    return workflows
  }
  throw new Error(`Unknown profile: ${profile}`)
}
