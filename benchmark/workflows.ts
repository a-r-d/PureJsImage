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
const tiff = (): Operation => ({ type: 'encode', format: 'tiff' })
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
    qualityReference: 'exact-area',
    input: 'tundra-4000x3000',
    operations: [{ type: 'resize', width: 1200 }, jpeg(80)],
    expected: {
      format: 'jpeg',
      width: 1200,
      height: 900,
      pixelSamples: [
        { x: 0, y: 0, red: 165, green: 216, blue: 251, tolerance: 8 },
        { x: 300, y: 225, red: 92, green: 104, blue: 80, tolerance: 15 },
        { x: 1199, y: 899, red: 185, green: 199, blue: 177, tolerance: 20 },
      ],
    },
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
    expected: {
      format: 'jpeg',
      width: 1200,
      height: 900,
      pixelSamples: [
        { x: 0, y: 0, red: 148, green: 173, blue: 207, tolerance: 8 },
        { x: 300, y: 225, red: 187, green: 190, blue: 195, tolerance: 8 },
        { x: 600, y: 450, red: 228, green: 225, blue: 222, tolerance: 8 },
      ],
    },
  },
  {
    id: 'jpeg-crop-resize',
    title: '6000x4000 JPEG, center crop 3000x2000, resize 800x533',
    tier: 'standard',
    qualityReference: 'exact-area',
    input: 'old-faithful-6000x4000',
    operations: [
      { type: 'crop', x: 1500, y: 1000, width: 3000, height: 2000 },
      { type: 'resize', width: 800, height: 533 },
      jpeg(75),
    ],
    expected: {
      format: 'jpeg',
      width: 800,
      height: 533,
      pixelSamples: [
        { x: 0, y: 0, red: 181, green: 183, blue: 196, tolerance: 10 },
        { x: 200, y: 133, red: 183, green: 189, blue: 199, tolerance: 12 },
        { x: 400, y: 266, red: 223, green: 221, blue: 218, tolerance: 10 },
      ],
    },
  },
  {
    id: 'png-resize-1000',
    title: '4000x3000 RGBA PNG to 1000px PNG',
    tier: 'standard',
    qualityReference: 'exact-area',
    input: 'rgba-gradient-4000x3000',
    operations: [{ type: 'resize', width: 1000 }, png(6)],
    expected: {
      format: 'png',
      width: 1000,
      height: 750,
      pixelSamples: [
        { x: 250, y: 187, red: 64, green: 64, blue: 215, alpha: 67, tolerance: 6 },
        { x: 500, y: 375, red: 128, green: 128, blue: 175, alpha: 73, tolerance: 6 },
        { x: 999, y: 749, red: 255, green: 255, blue: 83, alpha: 94, tolerance: 4 },
      ],
    },
  },
  {
    id: 'png-alpha-resize',
    title: 'Transparent PNG resize with alpha preservation',
    tier: 'smoke',
    qualityReference: 'exact-area',
    input: 'transparent-logo-1200x480',
    operations: [{ type: 'resize', width: 800 }, png(6)],
    expected: {
      format: 'png',
      width: 800,
      height: 320,
      cornerAlpha: 0,
      pixelSamples: [
        { x: 200, y: 80, red: 20, green: 147, blue: 210, alpha: 220, tolerance: 2 },
        { x: 400, y: 160, red: 20, green: 121, blue: 210, alpha: 220, tolerance: 2 },
        { x: 600, y: 240, red: 20, green: 158, blue: 210, alpha: 220, tolerance: 2 },
      ],
    },
  },
  {
    id: 'jpeg-to-png',
    title: '2400x2400 JPEG to PNG',
    tier: 'standard',
    qualityReference: 'exact-area',
    input: 'earthrise-2400x2400',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 2400,
      height: 2400,
      pixelSamples: [
        { x: 0, y: 0, red: 0, green: 0, blue: 0, alpha: 255, tolerance: 2 },
        { x: 1200, y: 1200, red: 215, green: 240, blue: 249, alpha: 255, tolerance: 10 },
        { x: 2399, y: 2399, red: 101, green: 104, blue: 101, alpha: 255, tolerance: 4 },
      ],
    },
  },
  {
    id: 'png-to-jpeg',
    title: 'Transparent PNG to JPEG quality 80 on white',
    tier: 'standard',
    qualityReference: 'exact-area',
    input: 'transparent-logo-1200x480',
    operations: [jpeg(80, '#ffffff')],
    expected: {
      format: 'jpeg',
      width: 1200,
      height: 480,
      cornerRgbMinimum: 240,
      pixelSamples: [
        { x: 300, y: 120, red: 53, green: 162, blue: 217, tolerance: 8 },
        { x: 600, y: 240, red: 51, green: 139, blue: 215, tolerance: 8 },
        { x: 900, y: 360, red: 52, green: 171, blue: 215, tolerance: 8 },
      ],
    },
  },
  {
    id: 'auto-orient-6',
    title: 'EXIF orientation 6 JPEG auto-orient and encode',
    tier: 'standard',
    input: 'exif-orientation-6',
    operations: [{ type: 'autoOrient' }, jpeg(80)],
    expected: {
      format: 'jpeg',
      width: 1800,
      height: 1200,
      pixelSamples: [
        { x: 0, y: 0, red: 110, green: 156, blue: 219, tolerance: 5 },
        { x: 900, y: 600, red: 113, green: 128, blue: 145, tolerance: 5 },
        { x: 1799, y: 1199, red: 31, green: 29, blue: 30, tolerance: 5 },
      ],
    },
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
    id: 'lambda-twilio-mms-jpeg-1024',
    title: 'Lambda Twilio MMS upload: JPEG downscale to 1024 and encode JPEG 80',
    tier: 'standard',
    input: 'tundra-4000x3000',
    operations: [{ type: 'resize', width: 1024, withoutEnlargement: true }, jpeg(80, '#ffffff')],
    expected: { format: 'jpeg', width: 1024, height: 768 },
  },
  {
    id: 'lambda-user-upload-png-2048',
    title: 'Lambda user image upload: PNG downscale to 2048 and JPEG 80',
    tier: 'standard',
    input: 'rgba-gradient-4000x3000',
    operations: [{ type: 'resize', width: 2048, withoutEnlargement: true }, jpeg(80, '#ffffff')],
    expected: { format: 'jpeg', width: 2048, height: 1536 },
  },
  {
    id: 'lambda-twilio-mms-gif-no-enlarge',
    title: 'Lambda Twilio MMS upload: small GIF first frame without enlargement',
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
    id: 'lambda-logo-jpeg',
    title: 'Lambda logo normalization: portrait JPEG in centered transparent 256 canvas',
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
    id: 'lambda-logo-png',
    title: 'Lambda logo normalization: transparent PNG in centered transparent 256 canvas',
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
    id: 'lambda-logo-gif',
    title: 'Lambda logo normalization: GIF first frame in centered transparent 256 canvas',
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
    id: 'transform-quarter-turn-jpeg',
    title: '4000x3000 JPEG rotate 90 clockwise, resize to 1200px, and encode JPEG 80',
    tier: 'transforms',
    input: 'tundra-4000x3000',
    operations: [{ type: 'rotate', degrees: 90 }, { type: 'resize', width: 1200 }, jpeg(80)],
    expected: {
      format: 'jpeg',
      width: 1200,
      height: 1600,
      pixelSamples: [
        { x: 100, y: 200, red: 69, green: 94, blue: 54, tolerance: 12 },
        { x: 600, y: 800, red: 155, green: 160, blue: 101, tolerance: 15 },
        { x: 1199, y: 1599, red: 95, green: 167, blue: 235, tolerance: 6 },
      ],
    },
    timeoutMs: 120000,
  },
  {
    id: 'transform-arbitrary-angle-jpeg',
    title: '1200x480 transparent PNG rotate 17 degrees and flatten to JPEG 80',
    tier: 'transforms',
    input: 'transparent-logo-1200x480',
    operations: [{ type: 'rotate', degrees: 17 }, jpeg(80, '#ffffff')],
    expected: {
      format: 'jpeg',
      width: 1288,
      height: 810,
      cornerRgbMinimum: 240,
      pixelSamples: [
        { x: 300, y: 200, red: 52, green: 152, blue: 216, tolerance: 15 },
        { x: 644, y: 405, red: 52, green: 139, blue: 216, tolerance: 15 },
        { x: 987, y: 612, red: 53, green: 181, blue: 216, tolerance: 15 },
      ],
    },
    timeoutMs: 120000,
  },
  {
    id: 'transform-crop-after-resize-jpeg',
    title: '4000x3000 JPEG resize, crop in resized coordinates, resize again, and encode JPEG 80',
    tier: 'transforms',
    input: 'tundra-4000x3000',
    operations: [
      { type: 'resize', width: 1600 },
      { type: 'crop', x: 200, y: 150, width: 1200, height: 900 },
      { type: 'resize', width: 600 },
      jpeg(80),
    ],
    expected: {
      format: 'jpeg',
      width: 600,
      height: 450,
      pixelSamples: [
        { x: 100, y: 100, red: 57, green: 80, blue: 67, tolerance: 8 },
        { x: 300, y: 225, red: 146, green: 155, blue: 97, tolerance: 12 },
        { x: 599, y: 449, red: 162, green: 166, blue: 151, tolerance: 7 },
      ],
    },
    timeoutMs: 120000,
  },
  {
    id: 'transform-flip-flop-jpeg',
    title: '257x193 RGBA PNG vertical flip, horizontal flop, and flatten to JPEG 90',
    tier: 'transforms',
    input: 'odd-rgba-257x193',
    operations: [{ type: 'flip' }, { type: 'flop' }, jpeg(90, '#ffffff')],
    expected: {
      format: 'jpeg',
      width: 257,
      height: 193,
      pixelSamples: [
        { x: 64, y: 48, red: 235, green: 220, blue: 190, tolerance: 25 },
        { x: 128, y: 96, red: 143, green: 116, blue: 59, tolerance: 45 },
        { x: 256, y: 192, red: 255, green: 255, blue: 255, tolerance: 4 },
      ],
    },
  },
  {
    id: 'heif-iphone-metadata',
    title: 'Read metadata from a 4032x3024 iPhone HEIC grid image',
    tier: 'heif',
    input: 'iphone12-greyhounds-4032x3024-heic',
    operations: [{ type: 'metadata' }],
    expected: { format: 'heif', width: 4032, height: 3024 },
  },
  {
    id: 'heif-iphone-full-png',
    title: 'Auto-orient and fully decode a 4032x3024 iPhone HEIC grid to PNG',
    tier: 'heif',
    input: 'iphone12-greyhounds-4032x3024-heic',
    operations: [{ type: 'autoOrient' }, png(6)],
    expected: {
      format: 'png',
      width: 3024,
      height: 4032,
      // Independent ImageMagick/libheif decode. Small tolerances cover the
      // documented in-loop and YUV conversion rounding differences.
      pixelSamples: [
        { x: 0, y: 0, red: 179, green: 180, blue: 182, alpha: 255, tolerance: 3 },
        { x: 257, y: 311, red: 180, green: 154, blue: 131, alpha: 255, tolerance: 3 },
        { x: 1512, y: 2016, red: 17, green: 18, blue: 4, alpha: 255, tolerance: 3 },
        { x: 3023, y: 4031, red: 86, green: 90, blue: 102, alpha: 255, tolerance: 3 },
      ],
    },
    timeoutMs: 120000,
  },
  {
    id: 'heif-iphone-resize-jpeg',
    title: 'Auto-orient a 4032x3024 iPhone HEIC grid and resize to 1200px JPEG 80',
    tier: 'heif',
    input: 'iphone12-classic-car-4032x3024-heic',
    operations: [{ type: 'autoOrient' }, { type: 'resize', width: 1200 }, jpeg(80)],
    expected: {
      format: 'jpeg',
      width: 1200,
      height: 1600,
      pixelSamples: [
        { x: 0, y: 0, red: 130, green: 139, blue: 150, alpha: 255, tolerance: 8 },
        { x: 101, y: 203, red: 156, green: 165, blue: 174, alpha: 255, tolerance: 8 },
        { x: 600, y: 800, red: 71, green: 84, blue: 88, alpha: 255, tolerance: 8 },
        { x: 1199, y: 1599, red: 38, green: 38, blue: 34, alpha: 255, tolerance: 8 },
      ],
    },
    timeoutMs: 120000,
  },
  {
    id: 'heif-iphone-crop-resize-png',
    title: 'Auto-orient, crop, and resize an iPhone HEIC grid to 800x600 PNG',
    tier: 'heif',
    input: 'iphone12-old-safe-wall-4032x3024-heic',
    operations: [
      { type: 'autoOrient' },
      { type: 'crop', x: 512, y: 800, width: 2000, height: 1500 },
      { type: 'resize', width: 800 },
      png(6),
    ],
    expected: {
      format: 'png',
      width: 800,
      height: 600,
      pixelSamples: [
        { x: 0, y: 0, red: 140, green: 135, blue: 132, alpha: 255, tolerance: 8 },
        { x: 73, y: 91, red: 191, green: 165, blue: 148, alpha: 255, tolerance: 8 },
        { x: 400, y: 300, red: 137, green: 124, blue: 116, alpha: 255, tolerance: 8 },
        { x: 799, y: 599, red: 114, green: 82, blue: 68, alpha: 255, tolerance: 8 },
      ],
    },
    timeoutMs: 120000,
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
    expected: {
      format: 'jpeg',
      width: 1000,
      height: 750,
      pixelSamples: [
        { x: 0, y: 0, red: 0, green: 1, blue: 12, tolerance: 15 },
        { x: 250, y: 187, red: 62, green: 63, blue: 219, tolerance: 15 },
        { x: 500, y: 375, red: 127, green: 126, blue: 170, tolerance: 15 },
      ],
    },
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
    id: 'ico-metadata-mixed',
    title: 'Read metadata and select the best image from a mixed 16/32/256 ICO',
    tier: 'ico',
    input: 'ico-mixed-16-32-256',
    operations: [{ type: 'metadata' }],
    expected: { format: 'ico', width: 256, height: 256 },
    defaultRuns: 7,
  },
  {
    id: 'ico-png-primary-png',
    title: 'Decode the selected 256x256 PNG-backed ICO image to PNG',
    tier: 'ico',
    input: 'ico-mixed-16-32-256',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 256,
      height: 256,
      pixelSamples: [
        { x: 0, y: 0, red: 0, green: 0, blue: 0, alpha: 0 },
        { x: 128, y: 128, red: 128, green: 128, blue: 0, alpha: 128 },
        { x: 255, y: 255, red: 255, green: 255, blue: 0, alpha: 254 },
      ],
    },
    defaultRuns: 7,
  },
  {
    id: 'ico-dib32-alpha-png',
    title: 'Decode a 128x128 BGRA ICO with partial alpha to PNG',
    tier: 'ico',
    input: 'ico-dib32-alpha-128',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 128,
      height: 128,
      pixelSamples: [
        { x: 0, y: 0, red: 0, green: 0, blue: 0, alpha: 64 },
        { x: 64, y: 64, red: 192, green: 64, blue: 128, alpha: 192 },
        { x: 127, y: 127, red: 125, green: 123, blue: 254, alpha: 238 },
      ],
    },
    defaultRuns: 7,
  },
  {
    id: 'ico-dib24-mask-png',
    title: 'Decode a 96x96 24-bit ICO with one-bit transparency to PNG',
    tier: 'ico',
    input: 'ico-dib24-mask-96',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 96,
      height: 96,
      pixelSamples: [
        { x: 0, y: 0, red: 0, green: 0, blue: 0, alpha: 0 },
        { x: 48, y: 48, red: 129, green: 129, blue: 192, alpha: 255 },
        { x: 95, y: 95, red: 255, green: 255, blue: 108, alpha: 0 },
      ],
    },
    defaultRuns: 7,
  },
  {
    id: 'ico-favicon-resize-png',
    title: 'Decode a mixed ICO and resize its selected 256px image to a 64px PNG',
    tier: 'ico',
    input: 'ico-mixed-16-32-256',
    operations: [{ type: 'resize', width: 64 }, png(6)],
    expected: { format: 'png', width: 64, height: 64, cornerAlpha: 0 },
    defaultRuns: 7,
  },
  {
    id: 'ico-dib24-resize-jpeg',
    title: 'Decode a masked 24-bit ICO, resize to 192px, and flatten to JPEG',
    tier: 'ico',
    input: 'ico-dib24-mask-96',
    operations: [{ type: 'resize', width: 192 }, jpeg(80, '#ffffff')],
    expected: { format: 'jpeg', width: 192, height: 192, cornerRgbMinimum: 240 },
    defaultRuns: 7,
  },
  {
    id: 'tiff-metadata-large',
    title: 'Read metadata from a 4000x3000 stripped RGB TIFF',
    tier: 'tiff',
    input: 'tiff-gradient-4000x3000',
    operations: [{ type: 'metadata' }],
    expected: { format: 'tiff', width: 4000, height: 3000 },
  },
  {
    id: 'tiff-large-raw',
    title: 'Decode a 4000x3000 stripped RGB TIFF to raw pixels',
    tier: 'tiff',
    input: 'tiff-gradient-4000x3000',
    operations: [{ type: 'raw' }],
    expected: {
      format: 'tiff',
      width: 4000,
      height: 3000,
      pixelFormat: 'rgb8',
      decodedBytes: 36_000_000,
      rawSha256: 'b0a815ffad6857cb7e7ce492e17b32d3606e305083a51e4edf130c5c022cbcc3',
    },
  },
  {
    id: 'tiff-region-raw',
    title: 'Decode a 1000x750 region from a stripped RGB TIFF to raw pixels',
    tier: 'tiff',
    input: 'tiff-gradient-4000x3000',
    operations: [{ type: 'raw', x: 1000, y: 750, width: 1000, height: 750 }],
    expected: {
      format: 'tiff',
      width: 1000,
      height: 750,
      pixelFormat: 'rgb8',
      decodedBytes: 2_250_000,
      rawSha256: 'f79540d3b9bb7de086e1c0e5b84b32144d374bca0c7b2126308147d66a53f0fc',
    },
  },
  {
    id: 'tiff-bigtiff-rgb16-raw',
    title: 'Decode a 1024x768 stripped 16-bit RGB BigTIFF to rgb16 pixels',
    tier: 'tiff',
    input: 'tiff-bigtiff-rgb16-1024x768',
    operations: [{ type: 'raw' }],
    expected: {
      format: 'tiff',
      width: 1024,
      height: 768,
      pixelFormat: 'rgb16',
      decodedBytes: 4_718_592,
      rawSha256: 'dd41ddfc28e6f06d2866275acc199bd2532a5a1755c8e295a6b0f53806eb4df2',
    },
  },
  {
    id: 'tiff-cmyk8-planar-raw',
    title: 'Decode a 1024x768 planar 8-bit CMYK TIFF to rgb8 pixels',
    tier: 'tiff',
    input: 'tiff-cmyk8-planar-1024x768',
    operations: [{ type: 'raw' }],
    expected: {
      format: 'tiff',
      width: 1024,
      height: 768,
      pixelFormat: 'rgb8',
      decodedBytes: 2_359_296,
      rawSha256: 'e84b5eb87b2a8a913d77431b485468dc391feded7e53eee637042f196fab825d',
    },
  },
  {
    id: 'tiff-packed12-strip-raw',
    title: 'Decode a 2048x1536 stripped 12-bit RGB TIFF to rgb16 pixels',
    tier: 'tiff',
    input: 'tiff-packed12-strip-2048x1536',
    operations: [{ type: 'raw' }],
    expected: {
      format: 'tiff',
      width: 2048,
      height: 1536,
      pixelFormat: 'rgb16',
      decodedBytes: 18_874_368,
      rawSha256: 'b6774b8bce7caaae34eba0fe312c2eb776ea7e7eb74145319121d61c8b667f33',
    },
  },
  {
    id: 'tiff-packed12-tile-raw',
    title: 'Decode a padded-edge 2051x1539 tiled 12-bit RGB TIFF to rgb16 pixels',
    tier: 'tiff',
    input: 'tiff-packed12-tile-2051x1539',
    operations: [{ type: 'raw' }],
    expected: {
      format: 'tiff',
      width: 2051,
      height: 1539,
      pixelFormat: 'rgb16',
      decodedBytes: 18_938_934,
      rawSha256: '653ef50775a3cabd3152701c8e57eb0538f7484a6b58c465fff61987cef9ea37',
    },
  },
  {
    id: 'tiff-large-resize-jpeg',
    title: '4000x3000 stripped RGB TIFF to 1000px JPEG quality 80',
    tier: 'tiff',
    input: 'tiff-gradient-4000x3000',
    operations: [{ type: 'resize', width: 1000 }, jpeg(80)],
    expected: {
      format: 'jpeg',
      width: 1000,
      height: 750,
      pixelSamples: [
        { x: 0, y: 0, red: 0, green: 1, blue: 12, tolerance: 15 },
        { x: 250, y: 187, red: 62, green: 63, blue: 219, tolerance: 15 },
        { x: 500, y: 375, red: 127, green: 126, blue: 170, tolerance: 15 },
      ],
    },
  },
  {
    id: 'tiff-rgb-png',
    title: 'Big-endian 8-bit RGB TIFF to PNG with exact reference pixels',
    tier: 'tiff',
    input: 'libtiff-rgb-3c-8b',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 157,
      height: 151,
      pixelSamples: [
        { x: 0, y: 0, red: 162, green: 52, blue: 53, alpha: 255 },
        { x: 78, y: 75, red: 73, green: 15, blue: 13, alpha: 255 },
        { x: 156, y: 150, red: 178, green: 202, blue: 160, alpha: 255 },
      ],
    },
  },
  {
    id: 'tiff-gray8-png',
    title: 'Big-endian 8-bit grayscale TIFF to PNG',
    tier: 'tiff',
    input: 'libtiff-minisblack-1c-8b',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 157,
      height: 151,
      pixelSamples: [
        { x: 0, y: 0, red: 85, green: 85, blue: 85, alpha: 255 },
        { x: 78, y: 75, red: 32, green: 32, blue: 32, alpha: 255 },
        { x: 156, y: 150, red: 190, green: 190, blue: 190, alpha: 255 },
      ],
    },
  },
  {
    id: 'tiff-bilevel-png',
    title: 'Big-endian 1-bit white-is-zero TIFF to PNG',
    tier: 'tiff',
    input: 'libtiff-miniswhite-1c-1b',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 157,
      height: 151,
      pixelSamples: [
        { x: 0, y: 0, red: 0, green: 0, blue: 0, alpha: 255 },
        { x: 1, y: 1, red: 255, green: 255, blue: 255, alpha: 255 },
        { x: 156, y: 150, red: 255, green: 255, blue: 255, alpha: 255 },
      ],
    },
  },
  {
    id: 'tiff-palette8-png',
    title: 'Big-endian 8-bit palette TIFF to PNG',
    tier: 'tiff',
    input: 'libtiff-palette-1c-8b',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 157,
      height: 151,
      pixelSamples: [
        { x: 0, y: 0, red: 170, green: 53, blue: 40, alpha: 255 },
        { x: 78, y: 75, red: 76, green: 19, blue: 14, alpha: 255 },
        { x: 156, y: 150, red: 171, green: 208, blue: 169, alpha: 255 },
      ],
    },
  },
  {
    id: 'tiff-packbits-planar-alpha-png',
    title: 'Little-endian PackBits planar grayscale and alpha TIFF to PNG',
    tier: 'tiff',
    input: 'libtiff-packbits-gray-alpha',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 64,
      height: 64,
      cornerAlpha: 0,
      pixelSamples: [
        { x: 0, y: 0, alpha: 0 },
        { x: 31, y: 31, alpha: 255 },
        { x: 40, y: 40, alpha: 152 },
        { x: 63, y: 63, alpha: 0 },
      ],
    },
  },
  {
    id: 'tiff-deflate-png',
    title: 'Deflate-compressed grayscale TIFF with trailing strip data to PNG',
    tier: 'tiff',
    input: 'libtiff-deflate-extra-strip-data',
    operations: [png(6)],
    expected: {
      format: 'png',
      width: 500,
      height: 500,
      pixelSamples: [
        { x: 0, y: 0, red: 107, green: 107, blue: 107, alpha: 255 },
        { x: 250, y: 250, red: 197, green: 197, blue: 197, alpha: 255 },
        { x: 499, y: 499, red: 181, green: 181, blue: 181, alpha: 255 },
      ],
    },
  },
  {
    id: 'tiff-lzw-single-strip-resize',
    title: '7795x3122 1-bit LZW single-strip TIFF to 1000px PNG',
    tier: 'tiff',
    input: 'libtiff-lzw-single-strip',
    operations: [{ type: 'resize', width: 1000 }, png(6)],
    expected: { format: 'png', width: 1000, height: 401 },
    defaultWarmups: 0,
    timeoutMs: 120000,
  },
  {
    id: 'png-to-tiff',
    title: 'Transparent 1200x480 PNG to uncompressed RGBA TIFF',
    tier: 'tiff',
    input: 'transparent-logo-1200x480',
    operations: [tiff()],
    expected: { format: 'tiff', width: 1200, height: 480 },
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
    expected: {
      format: 'jpeg',
      width: 800,
      height: 1000,
      pixelSamples: [
        { x: 0, y: 0, red: 19, green: 30, blue: 72, tolerance: 10 },
        { x: 200, y: 250, red: 30, green: 44, blue: 82, tolerance: 10 },
        { x: 799, y: 999, red: 2, green: 4, blue: 17, tolerance: 10 },
      ],
    },
  },
  {
    id: 'webp-memory-lossy-resize-jpeg',
    title: '4000x3000 lossy WebP memory-pressure resize to 1024px JPEG',
    tier: 'webp',
    input: 'webp-gradient-lossy-4000x3000',
    operations: [{ type: 'resize', width: 1024 }, jpeg(80)],
    expected: {
      format: 'jpeg',
      width: 1024,
      height: 768,
      pixelSamples: [
        { x: 0, y: 0, red: 0, green: 1, blue: 5, tolerance: 24 },
        { x: 512, y: 384, red: 129, green: 129, blue: 174, tolerance: 24 },
        { x: 1023, y: 767, red: 254, green: 255, blue: 78, tolerance: 24 },
      ],
    },
    defaultWarmups: 0,
    timeoutMs: 120000,
  },
  {
    id: 'webp-memory-lossless-resize-jpeg',
    title: '4000x3000 lossless WebP memory-pressure resize to 1024px JPEG',
    tier: 'webp',
    input: 'webp-gradient-lossless-4000x3000',
    operations: [{ type: 'resize', width: 1024 }, jpeg(80)],
    expected: {
      format: 'jpeg',
      width: 1024,
      height: 768,
      pixelSamples: [
        { x: 0, y: 0, red: 0, green: 0, blue: 3, tolerance: 24 },
        { x: 512, y: 384, red: 128, green: 128, blue: 175, tolerance: 24 },
        { x: 1023, y: 767, red: 255, green: 255, blue: 83, tolerance: 24 },
      ],
    },
    defaultWarmups: 0,
    timeoutMs: 120000,
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
    expected: {
      format: 'webp',
      width: 1200,
      height: 900,
      pixelSamples: [
        { x: 0, y: 0, red: 169, green: 217, blue: 255, alpha: 255, tolerance: 20 },
        { x: 300, y: 225, red: 94, green: 110, blue: 84, alpha: 255, tolerance: 20 },
        { x: 600, y: 450, red: 206, green: 216, blue: 154, alpha: 255, tolerance: 20 },
        { x: 900, y: 675, red: 103, green: 131, blue: 58, alpha: 255, tolerance: 20 },
        { x: 1199, y: 899, red: 192, green: 200, blue: 179, alpha: 255, tolerance: 20 },
      ],
    },
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
    qualityReference: 'exact-area',
    input: 'stress-gradient-10000x10000',
    operations: [{ type: 'resize', width: 1000, height: 1000 }, png(6)],
    expected: {
      format: 'png',
      width: 1000,
      height: 1000,
      pixelSamples: [
        { x: 0, y: 0, red: 0, green: 0, blue: 0, alpha: 255, tolerance: 1 },
        { x: 500, y: 500, red: 56, green: 56, blue: 56, alpha: 255, tolerance: 1 },
        { x: 999, y: 999, red: 112, green: 112, blue: 112, alpha: 255, tolerance: 1 },
      ],
    },
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
  'lambda-twilio-mms-jpeg-1024',
  'lambda-user-upload-png-2048',
  'lambda-logo-jpeg',
  'tiny-transparent-convert',
  'high-entropy-png-to-jpeg',
])

const phase5WorkflowIds = new Set([
  'jpeg-to-png',
  'png-to-jpeg',
  'gif-first-frame-png',
  'lambda-twilio-mms-gif-no-enlarge',
  'lambda-logo-gif',
])

const comparableTransformWorkflowIds = new Set([
  'transform-quarter-turn-jpeg',
  'transform-crop-after-resize-jpeg',
  'transform-flip-flop-jpeg',
])

const competitorWorkflowIds = new Set([
  'metadata-jpeg-large',
  'jpeg-resize-1200',
  'northstar-photo-pipeline',
  'jpeg-crop-resize',
  'png-resize-1000',
  'png-alpha-resize',
  'png-to-jpeg',
  'jpeg-to-png',
  'auto-orient-6',
  'stress-100mp-downscale',
  'bmp-large-resize-jpeg',
  'tiff-large-resize-jpeg',
  'webp-large-resize-jpeg',
  'heif-iphone-resize-jpeg',
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
    return workflows.filter(
      (workflow) =>
        workflow.tier !== 'bmp' &&
        workflow.tier !== 'heif' &&
        workflow.tier !== 'ico' &&
        workflow.tier !== 'tiff' &&
        workflow.tier !== 'webp',
    )
  }
  if (profile === 'bmp') {
    return workflows.filter((workflow) => workflow.tier === 'bmp')
  }
  if (profile === 'webp') {
    return workflows.filter((workflow) => workflow.tier === 'webp')
  }
  if (profile === 'heif') {
    return workflows.filter((workflow) => workflow.tier === 'heif')
  }
  if (profile === 'ico') {
    return workflows.filter((workflow) => workflow.tier === 'ico')
  }
  if (profile === 'tiff') {
    return workflows.filter((workflow) => workflow.tier === 'tiff')
  }
  if (profile === 'transforms') {
    return workflows.filter((workflow) => workflow.tier === 'transforms')
  }
  if (profile === 'transforms-comparable') {
    return workflows.filter((workflow) => comparableTransformWorkflowIds.has(workflow.id))
  }
  if (profile === 'competitors') {
    return workflows.filter((workflow) => competitorWorkflowIds.has(workflow.id))
  }
  throw new Error(`Unknown profile: ${profile}`)
}
