export interface BrowserWorkflowResult {
  readonly detail: string
  readonly outputBytes: number
}

export interface BrowserCompatibilityHarness {
  animatedGifFrameSelection(): Promise<BrowserWorkflowResult>
  avifAlphaPremultiplied(): Promise<BrowserWorkflowResult>
  avifAlphaStraight(): Promise<BrowserWorkflowResult>
  avifBoundedAlphaRows(): Promise<BrowserWorkflowResult>
  avifBoundedRows(): Promise<BrowserWorkflowResult>
  avifBoundedResize(): Promise<BrowserWorkflowResult>
  avifCleanAperture(): Promise<BrowserWorkflowResult>
  avifCommonPhotoSyntax(): Promise<BrowserWorkflowResult>
  avifFilteredSuperres(): Promise<BrowserWorkflowResult>
  avifGrid(): Promise<BrowserWorkflowResult>
  avifHighBit10(): Promise<BrowserWorkflowResult>
  avifHighBit12(): Promise<BrowserWorkflowResult>
  avifHighBitTiles(): Promise<BrowserWorkflowResult>
  avifExpandedHighBit(): Promise<BrowserWorkflowResult>
  avifLossyMultitile(): Promise<BrowserWorkflowResult>
  avifIntrabc(): Promise<BrowserWorkflowResult>
  avifMonochrome(): Promise<BrowserWorkflowResult>
  avifQuantizationMatrix(): Promise<BrowserWorkflowResult>
  avifNonstillSequence(): Promise<BrowserWorkflowResult>
  avifPalette(): Promise<BrowserWorkflowResult>
  avifSuperres(): Promise<BrowserWorkflowResult>
  avifQ0Lossless(): Promise<BrowserWorkflowResult>
  avifYuv422(): Promise<BrowserWorkflowResult>
  avifYuv444(): Promise<BrowserWorkflowResult>
  failureCleanup(): Promise<BrowserWorkflowResult>
  heifPqDisplay(): Promise<BrowserWorkflowResult>
  inputTypes(): Promise<readonly BrowserWorkflowResult[]>
  jpegPipeline(): Promise<BrowserWorkflowResult>
  wasmJpeg(): Promise<BrowserWorkflowResult>
  wasmJpegEncode(): Promise<BrowserWorkflowResult>
  wasmPng(): Promise<BrowserWorkflowResult>
  progressiveJpeg(): Promise<BrowserWorkflowResult>
  orientation(): Promise<BrowserWorkflowResult>
  pngAlphaPipeline(): Promise<BrowserWorkflowResult>
  resizeDefaultKernel(): Promise<BrowserWorkflowResult>
  webpLossless(): Promise<BrowserWorkflowResult>
  webpLossyDecode(): Promise<BrowserWorkflowResult>
}

export interface BrowserBenchmarkMeasurement {
  readonly correctness: string
  readonly firstOperationMilliseconds: number
  readonly javascriptBytesLoaded: number
  readonly label: string
  readonly moduleInitializationMilliseconds: number
  readonly outputBytes: number
  readonly scope: 'codec-only' | 'complete-pipeline' | 'native-complete-pipeline'
  readonly warmMedianMilliseconds: number
  readonly wasmBytesLoaded: number
}

export interface BrowserBenchmarkReport {
  readonly browser: string
  readonly generatedAt: string
  readonly measurements: readonly BrowserBenchmarkMeasurement[]
  readonly note: string
  readonly warmRuns: number
}

export interface BrowserBenchmarkHarness {
  run(): Promise<BrowserBenchmarkReport>
}

export interface BrowserBenchmarkModule {
  prepare(input: ArrayBuffer): Promise<void>
  run(): Promise<number>
  verify(): Promise<string>
}

declare global {
  interface Window {
    pureJsImageBrowserBenchmark: BrowserBenchmarkHarness
    pureJsImageBrowserTests: BrowserCompatibilityHarness
  }
}
