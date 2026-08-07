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

const bmp = (): Operation => ({ type: 'encode', format: 'bmp' })
const webp = (quality: number): Operation => ({ type: 'encode', format: 'webp', quality })
const losslessWebp = (): Operation => ({ type: 'encode', format: 'webp', lossless: true })

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
    id: 'bmp-metadata-large',
    title: 'Read metadata from a 4000x3000 24-bit BMP',
    tier: 'bmp',
    input: 'bmp-gradient-4000x3000',
    operations: [{ type: 'metadata' }],
    expected: { format: 'bmp', width: 4000, height: 3000 },
  },
  {
    id: 'bmp-large-resize-jpeg',
    title: '4000x3000 24-bit BMP to 1000px JPEG quality 80',
    tier: 'bmp',
    input: 'bmp-gradient-4000x3000',
    operations: [{ type: 'resize', width: 1000 }, jpeg(80)],
    expected: { format: 'jpeg', width: 1000, height: 750 },
  },
  {
    id: 'bmp-pal1-png',
    title: '1-bit paletted BMP to PNG with exact reference pixels',
    tier: 'bmp',
    input: 'bmpsuite-pal1',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 127,
      height: 64,
      pixelSamples: [
        { x: 0, y: 0, red: 255, green: 255, blue: 255, alpha: 255 },
        { x: 1, y: 1, red: 0, green: 0, blue: 0, alpha: 255 },
        { x: 126, y: 63, red: 0, green: 0, blue: 0, alpha: 255 },
      ],
    },
  },
  {
    id: 'bmp-pal4-png',
    title: 'Uncompressed 4-bit paletted BMP to PNG',
    tier: 'bmp',
    input: 'bmpsuite-pal4',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 127,
      height: 64,
      pixelSamples: [
        { x: 0, y: 0, red: 255, green: 0, blue: 0, alpha: 255 },
        { x: 10, y: 10, red: 255, green: 128, blue: 255, alpha: 255 },
        { x: 126, y: 63, red: 0, green: 0, blue: 0, alpha: 255 },
      ],
    },
  },
  {
    id: 'bmp-rle4-png',
    title: 'RLE4-compressed paletted BMP to PNG',
    tier: 'bmp',
    input: 'bmpsuite-pal4-rle',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 127,
      height: 64,
      pixelSamples: [
        { x: 0, y: 0, red: 255, green: 0, blue: 0, alpha: 255 },
        { x: 10, y: 10, red: 255, green: 128, blue: 255, alpha: 255 },
        { x: 95, y: 40, red: 255, green: 255, blue: 0, alpha: 255 },
      ],
    },
  },
  {
    id: 'bmp-rle8-png',
    title: 'RLE8-compressed paletted BMP to PNG',
    tier: 'bmp',
    input: 'bmpsuite-pal8-rle',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 127,
      height: 64,
      pixelSamples: [
        { x: 0, y: 0, red: 255, green: 0, blue: 0, alpha: 255 },
        { x: 10, y: 10, red: 255, green: 85, blue: 102, alpha: 255 },
        { x: 125, y: 62, red: 51, green: 85, blue: 102, alpha: 255 },
      ],
    },
  },
  {
    id: 'bmp-top-down-crop-resize',
    title: 'Top-down 8-bit BMP crop and resize to PNG',
    tier: 'bmp',
    input: 'bmpsuite-pal8-top-down',
    operations: [
      { type: 'crop', x: 7, y: 5, width: 100, height: 50 },
      { type: 'resize', width: 200, height: 100 },
      png(6),
    ],
    expected: { format: 'png', width: 200, height: 100 },
  },
  {
    id: 'bmp-padding-odd-png',
    title: '125-pixel-wide paletted BMP row-padding conversion',
    tier: 'bmp',
    input: 'bmpsuite-pal8-padding-125',
    operations: [png(6)],
    expected: { format: 'png', width: 125, height: 62 },
  },
  {
    id: 'bmp-os2-png',
    title: 'OS/2 v1 8-bit paletted BMP to PNG',
    tier: 'bmp',
    input: 'bmpsuite-pal8-os2',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 127,
      height: 64,
      pixelSamples: [
        { x: 0, y: 0, red: 255, green: 0, blue: 0, alpha: 255 },
        { x: 10, y: 10, red: 255, green: 85, blue: 102, alpha: 255 },
      ],
    },
  },
  {
    id: 'bmp-v5-png',
    title: 'BITMAPV5HEADER 8-bit paletted BMP to PNG',
    tier: 'bmp',
    input: 'bmpsuite-pal8-v5',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 127,
      height: 64,
      pixelSamples: [
        { x: 0, y: 0, red: 255, green: 0, blue: 0, alpha: 255 },
        { x: 125, y: 62, red: 51, green: 85, blue: 102, alpha: 255 },
      ],
    },
  },
  {
    id: 'bmp-rgb16-555-png',
    title: '16-bit RGB555 BMP to PNG with scaled channel checks',
    tier: 'bmp',
    input: 'bmpsuite-rgb16-555',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 127,
      height: 64,
      pixelSamples: [
        { x: 1, y: 1, red: 255, green: 8, blue: 8, alpha: 255 },
        { x: 10, y: 10, red: 214, green: 82, blue: 82, alpha: 255 },
        { x: 126, y: 63, red: 99, green: 99, blue: 123, alpha: 255 },
      ],
    },
  },
  {
    id: 'bmp-rgb16-565-png',
    title: '16-bit RGB565 bitfield BMP to PNG',
    tier: 'bmp',
    input: 'bmpsuite-rgb16-565',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 127,
      height: 64,
      pixelSamples: [
        { x: 1, y: 1, red: 255, green: 8, blue: 8, alpha: 255 },
        { x: 10, y: 10, red: 214, green: 81, blue: 82, alpha: 255 },
        { x: 126, y: 63, red: 99, green: 97, blue: 123, alpha: 255 },
      ],
    },
  },
  {
    id: 'bmp-rgb32-bitfields-png',
    title: '32-bit reordered bitfield BMP to PNG',
    tier: 'bmp',
    input: 'bmpsuite-rgb32-bitfields',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 127,
      height: 64,
      pixelSamples: [
        { x: 0, y: 0, red: 255, green: 0, blue: 0, alpha: 255 },
        { x: 10, y: 10, red: 215, green: 82, blue: 82, alpha: 255 },
        { x: 126, y: 63, red: 96, green: 96, blue: 126, alpha: 255 },
      ],
    },
  },
  {
    id: 'bmp-rgba32-v5-png',
    title: '32-bit V5 alpha-bitfield BMP to PNG',
    tier: 'bmp',
    input: 'bmpsuite-rgba32-v5',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 127,
      height: 64,
      pixelSamples: [
        { x: 0, y: 0, red: 255, green: 0, blue: 0, alpha: 255 },
        { x: 31, y: 31, alpha: 0 },
        { x: 126, y: 63, red: 96, green: 96, blue: 126, alpha: 255 },
      ],
    },
  },
  {
    id: 'bmp-rgb24-crop-resize-jpeg',
    title: '24-bit BMP crop, resize, and JPEG conversion',
    tier: 'bmp',
    input: 'bmpsuite-rgb24',
    operations: [
      { type: 'crop', x: 10, y: 4, width: 100, height: 56 },
      { type: 'resize', width: 400 },
      jpeg(80),
    ],
    expected: { format: 'jpeg', width: 400, height: 224 },
  },
  {
    id: 'jpeg-to-bmp',
    title: '2400x2400 JPEG to 800x800 24-bit BMP',
    tier: 'bmp',
    input: 'earthrise-2400x2400',
    operations: [{ type: 'resize', width: 800 }, bmp()],
    expected: { format: 'bmp', width: 800, height: 800 },
  },
  {
    id: 'webp-metadata-large',
    title: 'Read metadata from a 1600x2000 lossy WebP photograph',
    tier: 'webp',
    input: 'webp-fbi-portrait-1600x2000',
    operations: [{ type: 'metadata' }],
    expected: { format: 'webp', width: 1600, height: 2000 },
  },
  {
    id: 'webp-large-resize-jpeg',
    title: '1600x2000 lossy WebP photograph to 800px JPEG quality 80',
    tier: 'webp',
    input: 'webp-fbi-portrait-1600x2000',
    operations: [{ type: 'resize', width: 800 }, jpeg(80)],
    expected: { format: 'jpeg', width: 800, height: 1000 },
  },
  {
    id: 'webp-lossy-photo-png',
    title: 'Google gallery lossy photograph to PNG with reference pixel checks',
    tier: 'webp',
    input: 'webp-gallery-cherry-1024x772',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 1024,
      height: 772,
      pixelSamples: [
        { x: 0, y: 0, red: 27, green: 125, blue: 192, alpha: 255, tolerance: 24 },
        { x: 512, y: 386, red: 82, green: 173, blue: 231, alpha: 255, tolerance: 24 },
        { x: 1023, y: 771, red: 18, green: 21, blue: 0, alpha: 255, tolerance: 24 },
      ],
    },
  },
  {
    id: 'webp-lossy-photo-crop-resize',
    title: 'Second lossy WebP photograph crop, resize, and JPEG conversion',
    tier: 'webp',
    input: 'webp-gallery-fire-1024x752',
    operations: [
      { type: 'crop', x: 112, y: 76, width: 800, height: 600 },
      { type: 'resize', width: 400 },
      jpeg(80),
    ],
    expected: { format: 'jpeg', width: 400, height: 300 },
  },
  {
    id: 'webp-lossless-alpha-png',
    title: 'Lossless WebP rose with alpha to exact PNG pixels',
    tier: 'webp',
    input: 'webp-lossless-rose-400x301',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 400,
      height: 301,
      cornerAlpha: 0,
      pixelSamples: [
        { x: 100, y: 75, red: 239, green: 142, blue: 33, alpha: 255 },
        { x: 200, y: 150, red: 153, green: 75, blue: 1, alpha: 255 },
        { x: 399, y: 300, red: 57, green: 131, blue: 218, alpha: 0 },
      ],
    },
  },
  {
    id: 'webp-lossless-odd-png',
    title: 'Odd-sized lossless WebP graphic to exact PNG pixels',
    tier: 'webp',
    input: 'webp-lossless-tux-386x395',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 386,
      height: 395,
      cornerAlpha: 0,
      pixelSamples: [
        { x: 193, y: 197, red: 162, green: 116, blue: 0, alpha: 255 },
        { x: 289, y: 296, red: 183, green: 183, blue: 183, alpha: 255 },
        { x: 385, y: 394, red: 204, green: 150, blue: 0, alpha: 0 },
      ],
    },
  },
  {
    id: 'webp-lossy-alpha-png',
    title: 'Lossy WebP with compressed alpha to PNG',
    tier: 'webp',
    input: 'webp-lossy-alpha-800x600',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 800,
      height: 600,
      cornerAlpha: 0,
      pixelSamples: [
        { x: 0, y: 0, alpha: 0 },
        { x: 200, y: 150, red: 75, green: 73, blue: 140, tolerance: 24 },
        { x: 200, y: 150, alpha: 232 },
        { x: 400, y: 300, red: 255, green: 236, blue: 243, tolerance: 24 },
        { x: 400, y: 300, alpha: 255 },
        { x: 799, y: 599, alpha: 0 },
      ],
    },
  },
  {
    id: 'jpeg-to-webp-lossy',
    title: '4000x3000 JPEG to 1200px lossy WebP quality 80',
    tier: 'webp',
    input: 'tundra-4000x3000',
    operations: [{ type: 'resize', width: 1200 }, webp(80)],
    expected: { format: 'webp', width: 1200, height: 900 },
  },
  {
    id: 'png-to-webp-lossless',
    title: 'Transparent PNG to lossless WebP',
    tier: 'webp',
    input: 'transparent-logo-1200x480',
    operations: [losslessWebp()],
    expected: { format: 'webp', width: 1200, height: 480 },
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
    return workflows.filter((workflow) => workflow.tier === 'smoke' || workflow.tier === 'standard')
  }
  if (profile === 'phase4') {
    return workflows.filter((workflow) => phase4WorkflowIds.has(workflow.id))
  }
  if (profile === 'phase5') {
    return workflows.filter((workflow) => phase5WorkflowIds.has(workflow.id))
  }
  if (profile === 'full') {
    return workflows.filter((workflow) => workflow.tier !== 'bmp' && workflow.tier !== 'webp')
  }
  if (profile === 'bmp') {
    return workflows.filter((workflow) => workflow.tier === 'bmp')
  }
  if (profile === 'webp') {
    return workflows.filter((workflow) => workflow.tier === 'webp')
  }
  throw new Error(`Unknown profile: ${profile}`)
}
