export interface HeifBenchmarkFixture {
  readonly id: string
  readonly device: 'iPhone 12 Pro'
  readonly expected: {
    readonly bitDepth: 8
    readonly chromaSubsampling: '420'
    readonly codedImages: 48
    readonly codecProfile: 3
    readonly colorSpace: 'icc'
    readonly height: 3024
    readonly orientation: 6 | 8
    readonly primaryItemType: 'grid'
    readonly width: 4032
  }
}

export const heifBenchmarkFixtures: readonly HeifBenchmarkFixture[] = [
  {
    id: 'iphone12-greyhounds-4032x3024-heic',
    device: 'iPhone 12 Pro',
    expected: {
      width: 4032,
      height: 3024,
      bitDepth: 8,
      chromaSubsampling: '420',
      codecProfile: 3,
      colorSpace: 'icc',
      orientation: 8,
      primaryItemType: 'grid',
      codedImages: 48,
    },
  },
  {
    id: 'iphone12-classic-car-4032x3024-heic',
    device: 'iPhone 12 Pro',
    expected: {
      width: 4032,
      height: 3024,
      bitDepth: 8,
      chromaSubsampling: '420',
      codecProfile: 3,
      colorSpace: 'icc',
      orientation: 6,
      primaryItemType: 'grid',
      codedImages: 48,
    },
  },
  {
    id: 'iphone12-old-safe-wall-4032x3024-heic',
    device: 'iPhone 12 Pro',
    expected: {
      width: 4032,
      height: 3024,
      bitDepth: 8,
      chromaSubsampling: '420',
      codecProfile: 3,
      colorSpace: 'icc',
      orientation: 6,
      primaryItemType: 'grid',
      codedImages: 48,
    },
  },
]
