# PureJsImage

## Project Architecture, Scope, and Performance Plan

**Working description**

> PureJsImage is building a broad suite of first-party image codecs in strict
> TypeScript, designed for low memory use, portable deployment, strong
> conformance, hostile-input safety, and competitive performance.

Production codec implementations live in this repository. A shared lazy image
and raster pipeline provides metadata inspection, region decode, transforms,
resizing, conversion, and encoding across Node.js, modern browsers, serverless
deployments, and specialized raster workloads.

The original motivating workload is the common application path that Jimp makes
easy—decode, orient, crop, resize, and encode—without Jimp's source-sized mutable
RGBA boundary. That workload remains important evidence for the architecture,
but it does not define the project's eventual codec or raster scope.

PureJsImage is not an advanced image editor, drawing API, or canvas library. Its
pipeline exists to make the codec suite useful for ordinary application images
and for native numeric, scientific, geospatial, and whole-slide rasters.

The top-level engineering constraints are:

1. production codecs implemented first-party in this repository;
2. a permanent strict TypeScript reference engine;
3. zero production runtime dependencies;
4. portable Node.js and modern-browser behavior;
5. codec-native bounded execution where the format permits it;
6. competitive performance measured on complete workflows;
7. explicit unsupported boundaries instead of plausible corruption;
8. hostile-input and allocation safety;
9. independent conformance and pixel validation; and
10. modular codec loading with optional, explicit first-party acceleration.

All source, scripts, benchmarks, and tests must use the latest stable TypeScript
with strict mode enabled. `any` is not permitted. External `unknown` data must
be narrowed through runtime validation.

---

# 1. Motivation

Jimp has an attractive deployment model, but its architecture is poorly suited to modern image-processing workloads.

Jimp's normal representation of an image is effectively a complete decoded bitmap:

```text
encoded image
    ↓
decode entire image
    ↓
full RGBA bitmap in memory
    ↓
operation
    ↓
operation
    ↓
operation
    ↓
encode entire image
```

Its public bitmap interface exposes width, height, and a complete pixel buffer. Jimp's own documentation warns that its JavaScript image format implementations are not optimized for performance and may allocate large amounts of memory.

For a 6000 × 4000 RGBA image:

```text
6000 × 4000 × 4 = 96,000,000 bytes
```

The decoded pixel buffer alone is roughly 96 MB.

Intermediate buffers, resize passes, format conversions, source buffers, encoder buffers, garbage waiting for collection, and temporary allocations can make actual process memory considerably higher.

PureJsImage should not make "image" synonymous with "one giant mutable RGBA buffer."

Instead:

```text
input
 ↓
decoder
 ↓
bounded blocks / rows
 ↓
fused transforms
 ↓
encoder
 ↓
output
```

The goal is both lower memory usage and less unnecessary CPU work.

The original production impetus is image processing in AWS Lambda. Lambda
memory determines both reliability and cost, and Jimp's full RGBA bitmap plus
temporary resize and codec buffers can force a function into a much larger
memory tier than its output warrants. PureJsImage must make the common upload
normalization path safe at constrained Lambda memory sizes. A faster pipeline
that still retains a source-sized bitmap has not fully solved the motivating
problem.

---

# 2. Project Goals

The project goals below operationalize the codec-suite mission and engineering
constraints above. Runtime portability is a release requirement alongside
package size, speed, memory behavior, safety, and codec compatibility; an
implementation is not complete if the same public contract works in only one
JavaScript host.

## 2.1 Small

The library should remain aggressively small.

The core package should contain:

* Pipeline representation
* Buffer management
* Resize implementation
* Crop implementation
* Pixel-format utilities
* Codec registry
* Input/output abstraction

Codecs should be independently importable through package subpath exports or
other tree-shakeable entrypoints without creating a production dependency tree.

Users converting JPEG to JPEG should not need GIF, TIFF, AVIF, WebP, fonts, drawing primitives, convolution filters, or animation code.

A desired package structure is:

```text
purejsimage
purejsimage/jpeg
purejsimage/png
purejsimage/gif
purejsimage/webp
purejsimage/avif
```

The supported codecs and processing implementation must ship inside the
PureJsImage package. Installing PureJsImage must not install third-party runtime
packages, native addons, external binaries, or sibling codec packages.

Benchmark runners, fixture generators, test decoders, and comparison libraries
belong in `devDependencies` only. The production package must declare no
`dependencies` or `optionalDependencies`. Production codecs must be implemented
in this repository rather than bundling or vendoring a third-party runtime
implementation. This first-party, zero-dependency constraint is a release gate
and should be verified against the packed npm artifact.

---

## 2.2 Fast

PureJsImage should be competitive on complete real-world codec and raster
pipelines.

The target is not:

> Beat Sharp at everything.

Sharp is backed by libvips and highly optimized native image-processing code.
Use it when native deployment is acceptable and maximum throughput is the
primary requirement.

The target is:

> Make the portable strict TypeScript reference engine fast enough for
> production, then add explicit first-party acceleration where measurement
> justifies it.

Jimp remains a useful comparison for the original application-image workload,
not the boundary of the project.

Important benchmark:

```text
JPEG
 ↓
orientation correction
 ↓
crop
 ↓
resize
 ↓
JPEG quality 80
```

This matters more than whether `invert()` executes 10% faster.

---

## 2.3 Low memory pressure

PureJsImage should avoid materializing complete intermediate images whenever the operation and codec permit it.

The preferred execution unit should be a bounded block of pixels:

```text
scanline
```

or:

```text
small row block
```

and, where useful:

```text
tile
```

A full bitmap may still be necessary for certain codecs or operations, but it must be a fallback execution strategy rather than the fundamental image representation.

For common baseline JPEGs used by Lambda upload workflows, the goal is stricter:
decode MCU rows incrementally, push crop/downscale requirements toward the
decoder, and release rows as soon as they cannot affect the output. Peak working
memory should be governed primarily by compressed input, active MCU rows,
resize support, and output dimensions—not by source width times source height.
Progressive JPEG decoding is required because it is common on the web. Unlike a
single-scan baseline image, later progressive scans can refine earlier blocks,
so a decoder may retain compact DCT coefficients across scans. It must still
avoid a source-sized RGB or RGBA bitmap, reconstruct output in bounded rows,
and benchmark progressive input as a separate memory class. Unusual JPEG coding
processes may remain explicitly unsupported. Any future fallback must also be
first-party, visible in metadata/diagnostics, and measured separately.

Transforms such as EXIF orientations 3-8 may require output rows in a different
order from decoder rows. They should use bounded tiles and temporary storage
rather than falling back to a source-sized in-memory bitmap. For the Lambda
northstar, a modest CPU or temporary-I/O cost is acceptable when it removes
hundreds of megabytes of peak RSS and preserves correct output. Temporary files
must be uniquely named, removed on success or failure, and documented because
their capacity requirement still scales with decoded pixel area.

---

## 2.4 Portable across modern JavaScript runtimes

The first-party TypeScript engine should run in modern browsers and server
runtimes without changing codec or pipeline semantics. Node.js is a primary
production target, not an assumption embedded in the portable core.

The shared runtime graph must use standard JavaScript, TypedArrays, Blob, and
explicit source, sink, compression, and temporary-storage interfaces. Platform
adapters may provide Node file paths and temporary files, browser File/Blob
input, browser Blob output, CompressionStream, and origin-private storage.

Platform capability selection must happen outside codec and pixel hot loops.
Missing browser primitives must fail explicitly or use a documented bounded
fallback; they must never silently switch to an unbounded full-frame bitmap.
Every release should verify a browser-targeted bundle with no Node built-ins and
run representative decode, transform, and encode pipelines in a real browser.

---

## 2.5 Broad first-party codec coverage

The architecture must not hard-code a fixed format list into the processing
engine. Formats are independently registered codecs implementing a common
contract, with capability depth and unsupported boundaries documented per
codec.

Current or tracked formats include:

* JPEG
* PNG
* BMP
* GIF
* TIFF
* WebP
* AVIF
* JPEG 2000
* HEIF/HEIC
* JPEG XL
* future formats chosen through the roadmap

Adding or deepening a codec must not require architectural changes to the shared
pipeline.

Official production codecs must be implemented in this repository. External
libraries may be used as development-only conformance and benchmark oracles,
but their implementation code must not be copied, bundled, vendored, or loaded
by the published runtime.

---

# 3. Reference Engine and Accelerators

The project needs explicit terms so optional acceleration cannot blur its
identity.

The **reference engine** is the first-party strict TypeScript implementation. It
must:

* contain no native Node addons;
* require no system libraries;
* spawn no external binaries;
* compile without `node-gyp`;
* use portable JavaScript and TypeScript runtime APIs;
* run across Node.js and modern browsers wherever required primitives exist; and
* remain the default, supported path after accelerators exist.

An **accelerator** is an optional first-party WASM or future compute
implementation that preserves the reference contract. It must use a separate
explicit import and registration, may decline unsupported work, and must fall
back cleanly to the reference engine. Importing the root package or a normal
codec entry must never load, download, or silently select an accelerator.

The package must therefore remain useful with zero runtime dependencies and no
required WASM or native code. Development-only libraries, native tools, browser
codecs, and system codecs may serve as independent oracles; they must not become
production implementations.

AVIF illustrates the policy. Its container and implemented AV1 pixel decoder
are first-party strict TypeScript, while libavif, libaom, dav1d, browsers, and
other implementations are development oracles. The checked capability contract
defines the currently supported still-image subset and explicit rejection
boundaries.

A planned initial AVIF encoder is deliberately constrained: opaque 8-bit input,
AV1 Main Profile, YUV 4:2:0, one tile, and one intra-only still picture.
Correctness, portability, and bounded memory come before compression efficiency.
Alpha, lossless, 4:2:2, 4:4:4, higher bit depths, grids, and animation expand
only after the baseline is implemented, independently validated, and measured.

Decoder compatibility remains the higher priority because PureJsImage must
consume files produced elsewhere. AV1 still-picture and
reduced-still-picture-header modes keep general video encoding outside this
project; the target is a practical image codec integrated with the shared
pipeline, not a general-purpose AV1 video implementation.


---

# 4. V1 Scope

V1 should deliberately be much narrower than Jimp.

## Required

### Image input

Support:

```ts
await images.open(buffer)
await images.open(uint8Array)
await images.open(arrayBuffer)
await images.open(path)
```

Here, `images` is a library instance initialized with the codecs accepted by
the application. The root package must not register or import codecs
implicitly.

Browser-compatible source abstractions should permit:

```ts
Blob
ReadableStream
```

where practical.

### Image metadata

Metadata must be available without requiring callers to access or materialize a
mutable bitmap:

```ts
const metadata = await image.metadata()
```

At minimum, it returns:

```ts
{
  width,
  height,
  format,
  mimeType,
  hasAlpha,
  orientation
}
```

Where available:

```ts
{
  colorSpace,
  bitDepth,
  frames
}
```

### Format conversion

Examples:

```ts
JPEG → PNG
PNG → JPEG
JPEG → WebP
WebP → PNG
AVIF → JPEG
```

Actual available combinations depend on installed codecs.

### Resize

Required APIs:

```ts
.resize({
  width: 1200
})
```

```ts
.resize({
  height: 800
})
```

```ts
.resize({
  width: 1200,
  height: 800,
  fit: "contain"
})
```

```ts
.resize({
  width: 1200,
  height: 800,
  fit: "cover"
})
```

Supported fit modes:

```text
contain
cover
fill
inside
outside
```

Their output geometry must be explicit:

* `contain` scales proportionally and places the result inside an output canvas
  of exactly the requested width and height.
* `cover` scales proportionally and crops to exactly the requested width and
  height.
* `fill` resizes to exactly the requested width and height without preserving
  aspect ratio.
* `inside` preserves aspect ratio and returns dimensions no larger than the
  requested bounds, without adding a canvas.
* `outside` preserves aspect ratio and returns dimensions large enough to cover
  the requested bounds, without cropping.

`contain` must support placement and canvas background options:

```ts
.resize({
  width: 256,
  height: 256,
  fit: "contain",
  position: "center",
  background: "transparent"
})
```

This is a single-source resize-and-pad operation, not general multi-image
compositing. It should remain compatible with a linear, streaming pipeline.

Width-only and height-only resize must preserve aspect ratio. A
`withoutEnlargement` option should allow callers to express a maximum dimension
without a separate conditional resize:

```ts
.resize({
  width: 1024,
  withoutEnlargement: true
})
```

### Crop

```ts
.crop({
  x: 100,
  y: 200,
  width: 800,
  height: 600
})
```

Crop should be a first-class pipeline operation because it enables major performance optimizations.

### Quality / compression

Example:

```ts
.jpeg({
  quality: 80
})
```

or generically:

```ts
.encode("jpeg", {
  quality: 80
})
```

Formats should expose codec-specific compression controls without leaking them into the core architecture.

For PNG, this may mean:

```ts
{
  compressionLevel: 6
}
```

rather than pretending PNG has JPEG-style quality.

### Orientation

Real-world camera images make EXIF orientation support important.

V1 should support:

```ts
.autoOrient()
```

### Output

Required:

```ts
.toBuffer()
.toFile(path)
```

Strongly desirable:

```ts
.stream()
```

### Alpha conversion

Encoding an alpha-bearing input to a format without alpha, especially JPEG,
must have deterministic background-flattening behavior. Callers must be able to
choose the background explicitly:

```ts
.encode("jpeg", {
  quality: 80,
  background: "#ffffff"
})
```

The default background must be documented and stable. It must not depend on
uninitialized RGB values under fully transparent pixels.

### Common Lambda upload workloads

V1 must cover common serverless image-processing workloads without requiring
the mutable Jimp bitmap API or general compositing. Representative examples
include:

* user-uploaded JPEG or PNG images normalized to a 1024px or 2048px width
  limit;
* images received from text messages through services such as Twilio MMS; and
* JPEG/PNG/GIF logo or avatar normalization to a centered 256 x 256 PNG.

User-uploaded and Twilio MMS images require Buffer input, metadata inspection,
optional aspect-preserving downscale, JPEG conversion, quality control, and
Buffer output:

```ts
const image = await images.open(buffer)
const { width } = await image.metadata()

const output = await (width > maxWidth
  ? image.resize({ width: maxWidth })
  : image)
  .encode("jpeg", {
    quality: 80,
    background: "#ffffff"
  })
  .toBuffer()
```

The accepted input set for this workload is JPEG, PNG, and GIF. GIF input uses
the first composited frame; animated output is not required.

Logo and avatar normalization requires aspect-preserving fit into an exact 256
x 256 transparent canvas, centered placement, PNG conversion, and Buffer
output:

```ts
const output = await images.open(buffer)
  .resize({
    width: 256,
    height: 256,
    fit: "contain",
    position: "center",
    background: "transparent"
  })
  .encode("png", { compressionLevel: 6 })
  .toBuffer()
```

This replaces the common `scaleToFit()`, blank-image constructor, bitmap
width/height reads, `blit()`, and `getBuffer()` sequence with one bounded
pipeline. PNG compression is intentionally expressed as `compressionLevel`;
the meaningless Jimp-style PNG `quality` option is not a compatibility
requirement.

---

# 5. Explicit V1 Non-Goals

Do not reproduce the entire Jimp API.

The following should **not** block V1:

* Fonts
* Text rendering
* Bitmap fonts
* Arbitrary drawing
* Circles
* Lines
* Complex compositing
* Masks
* Shadows
* Advanced filters
* Posterization
* Dithering
* Fisheye
* Displacement
* Advanced convolutions
* Animated image editing
* Content-aware resizing
* Image diffing
* Perceptual hashes

These can be built later on top of a good pixel-processing engine.

The project succeeds if V1 does:

```text
read
convert
resize
crop
compress
write
```

extremely well.

---

# 6. Proposed Public API

The API should look familiar to Jimp/Sharp users without inheriting Jimp's mutable bitmap semantics.

Example:

```ts
import { createImageLibrary } from "purejsimage";
import { jpegCodec } from "purejsimage/codecs/jpeg";

const images = createImageLibrary([jpegCodec]);

const image = await images.open("input.jpg");

await image
  .autoOrient()
  .crop({
    x: 100,
    y: 100,
    width: 2000,
    height: 1500
  })
  .resize({
    width: 800
  })
  .encode("jpeg", {
    quality: 80
  })
  .toFile("output.jpg");
```

Operations should be immutable descriptions of future work.

Calling:

```ts
image.resize(...)
```

should not resize anything yet.

Instead it should create something conceptually similar to:

```text
Source
 ↓
AutoOrient
 ↓
Crop
 ↓
Resize
 ↓
JPEG Encode
```

Execution begins only when a sink is requested:

```ts
.toBuffer()
.toFile()
.stream()
```

This enables optimization before processing begins.

---

# 7. Do Not Expose a Mutable Bitmap as the Primary API

PureJsImage should not provide this as its core abstraction:

```ts
image.bitmap.data
```

Full materialization should be explicit:

```ts
const bitmap = await image.materialize({
  format: "rgba8"
});
```

This communicates to both the developer and the implementation that a potentially expensive operation has been requested.

Pixel access can still exist:

```ts
await image.getPixel(x, y)
```

and:

```ts
await image.region({
  x,
  y,
  width,
  height
})
```

but those methods should not force unrelated pipelines into full-image bitmap semantics.

---

# 8. Internal Architecture

The initial architecture should have five major layers:

```text
Source
Codec
Pipeline
Executor
Sink
```

---

# 9. Source Layer

Input should be abstracted from codecs.

Conceptually:

```ts
interface ImageSource {
  size?: number;

  read(
    offset: number,
    length: number
  ): Promise<Uint8Array>;

  stream?(): AsyncIterable<Uint8Array>;
}
```

Implementations:

```text
BufferSource
Uint8ArraySource
FileSource
BlobSource
StreamSource
```

This allows codecs to avoid requiring an entire compressed file to exist in memory.

For example:

```text
5 MB JPEG on disk
```

does not inherently require:

```text
5 MB input Buffer
+
96 MB bitmap
+
temporary buffers
```

to coexist.

---

# 10. Codec Layer

Codecs must be independent of image transformations.

Conceptually:

```ts
interface ImageCodec {
  readonly format: string;
  readonly mimeTypes: string[];

  detect(data: Uint8Array): boolean;

  metadata(
    source: ImageSource
  ): Promise<ImageMetadata>;

  createDecoder(
    source: ImageSource,
    options?: DecodeOptions
  ): Promise<ImageDecoder>;

  createEncoder(
    options: EncodeOptions
  ): Promise<ImageEncoder>;
}
```

Decoder:

```ts
interface ImageDecoder {
  readonly width: number;
  readonly height: number;
  readonly pixelFormat: PixelFormat;

  decode(
    request: DecodeRequest
  ): AsyncIterable<PixelBlock>;
}
```

A decoder should advertise capabilities:

```ts
interface DecoderCapabilities {
  sequential: boolean;
  regionDecode: boolean;
  scaledDecode: boolean;
  progressive: boolean;
}
```

This matters enormously for optimization.

The engine can only perform region decode when the codec can actually provide it.

The architecture should never assume every format has identical decoding behavior.

---

# 11. Pixel Representation

Do not make RGBA8 the only internal pixel representation.

V1 can initially implement:

```text
RGB8
RGBA8
Gray8
```

but the type system should permit:

```text
RGB16
RGBA16
YUV420
YUV444
```

later.

Example:

```ts
type PixelFormat =
  | "gray8"
  | "rgb8"
  | "rgba8"
  | "rgb16"
  | "rgba16"
  | "yuv420p8"
  | "yuv420p10";
```

This becomes particularly valuable for modern formats.

A future AVIF pipeline should not necessarily require:

```text
AVIF YUV
 ↓
RGBA
 ↓
resize
 ↓
RGBA
 ↓
YUV
 ↓
AVIF
```

when parts of the pipeline could operate directly on YUV planes.

Do not implement all these formats in V1.

Just avoid designing an interface that makes them impossible later.

---

# 12. PixelBlock

The basic executor unit should be something conceptually like:

```ts
interface PixelBlock {
  x: number;
  y: number;

  width: number;
  height: number;

  stride: number;

  format: PixelFormat;

  data: Uint8Array;
  release?: () => void;
}
```

Consumers may retain a block and its data for as long as needed. When a block
provides `release()`, calling it declares that the data will no longer be read
and allows the producer to recycle the backing typed buffer. Release is
optional and idempotent.

The block may represent:

* one scanline
* several scanlines
* one tile
* eventually one planar image region

The public API should not know or care.

---

# 13. Prefer Row Blocks Over a Complex Tile Engine in V1

A full tile dependency engine sounds attractive but is probably unnecessary for the initial feature set.

For:

```text
crop
resize
colorspace conversion
encode
```

sequential row/block execution works extremely well.

Example:

```text
JPEG decoder
 ↓
32 rows
 ↓
crop stage
 ↓
resize stage
 ↓
JPEG encoder
```

Only a bounded number of decoded rows need to exist at once.

This architecture is:

* easier to implement
* smaller
* easier to optimize
* easier to benchmark
* easier to reason about
* well suited to separable resize algorithms

Tiles can be introduced where random spatial access actually provides an advantage.

---

# 14. Pipeline Planner

PureJsImage should represent operations first and execute them later.

Example:

```ts
image
  .crop(...)
  .resize(...)
  .encode(...)
```

becomes:

```text
[
  CropOperation,
  ResizeOperation,
  EncodeOperation
]
```

Before running it, the planner should analyze the pipeline.

The planner does not need to be a sophisticated compiler in V1.

It should initially answer:

1. What source region is actually required?
2. What dimensions exist after each operation?
3. Which operations can be combined?
4. What pixel format should connect decoder and encoder?
5. Does the decoder support region/scaled decoding?
6. Does execution require a full frame?
7. What block size should be used?

---

# 15. Crop Pushdown

Consider:

```ts
images.open("8000x6000.jpg")
  .crop({
    x: 5000,
    y: 3000,
    width: 1000,
    height: 1000
  })
  .resize({
    width: 200
  });
```

The naive implementation:

```text
decode 48,000,000 pixels
 ↓
crop 1,000,000 pixels
 ↓
resize
```

The planner should attempt:

```text
determine relevant source region
 ↓
decode/retain only relevant data
 ↓
resize
```

Even if a JPEG decoder cannot seek directly to an arbitrary rectangle, sequential decoding can discard rows and columns that cannot contribute to the result without retaining them.

Region-aware codecs may do even better.

---

# 16. Resize Architecture

Resize is one of the most important operations in the entire project.

It deserves dedicated optimization.

V1 should implement at least:

```text
nearest
bilinear
```

Strongly recommended:

```text
Lanczos3
```

for high-quality downsampling.

Resize should be separable:

```text
2D resize
=
horizontal resize
+
vertical resize
```

This reduces computational complexity and allows streaming execution.

---

# 17. Precomputed Resampling Coefficients

Do not repeatedly calculate mapping and weights for every pixel/channel.

For each output coordinate, precompute the source samples and coefficients.

Conceptually:

```ts
interface SampleWeights {
  start: number;
  weights: Float32Array;
}
```

For bilinear:

```ts
{
  i0,
  i1,
  w0,
  w1
}
```

These values are identical across all rows or columns.

Calculate once.

Reuse for every row.

---

# 18. Streaming Vertical Resize

A naive two-pass resize can require a full intermediate image.

Avoid that.

For vertical filtering, maintain a ring buffer containing only the horizontally resized source rows necessary for upcoming output rows.

Example:

```text
source rows
 ↓
horizontal resize
 ↓
ring buffer
 ↓
vertical resize
 ↓
output row
```

If an output row needs four neighboring source rows, retain roughly four horizontally resized rows rather than the entire intermediate image.

This is one of the biggest potential memory wins in PureJsImage.

---

# 19. Avoid Allocation in Hot Loops

Pixel-processing loops should allocate nothing.

Bad:

```ts
for (...) {
  const pixel = {
    r: data[i],
    g: data[i + 1],
    b: data[i + 2]
  };

  ...
}
```

Better:

```ts
for (let i = 0; i < end; i += 4) {
  let r = data[i];
  let g = data[i + 1];
  let b = data[i + 2];

  ...
}
```

Avoid:

* callbacks per pixel
* temporary arrays
* object creation
* destructuring in hot loops
* polymorphic data structures
* repeated bounds calculation
* repeated function dispatch

Give V8 simple predictable loops.

---

# 20. Buffer Pooling

Repeated allocation of large typed arrays increases GC pressure.

The executor should maintain a small reusable buffer pool.

Conceptually:

```ts
pool.acquire(size)
pool.release(buffer)
```

Buffers may be grouped into size classes:

```text
64 KB
256 KB
1 MB
4 MB
```

Do not over-engineer this initially.

The important principle is:

> Intermediate pixel buffers should generally be reused rather than continuously allocated and abandoned.

---

# 21. Adaptive Block Size

There is no reason to run a scheduler for a 32 × 32 icon.

PureJsImage should choose execution strategies based on workload size.

Conceptually:

```text
tiny image
→ contiguous buffer

medium image
→ row blocks

large image
→ streaming blocks / tiles
```

For very small images, full materialization may actually be fastest and simpler.

Low memory should not become dogma that harms performance.

---

# 22. Operation Fusion

V1 has relatively few transformations, but the architecture should support fusion.

For example:

```text
decode
 ↓
orientation
 ↓
crop
 ↓
resize
```

Crop can often be represented as source-coordinate restrictions rather than a separate copy.

Future V2 pipelines like:

```ts
.brightness()
.contrast()
.saturation()
.grayscale()
```

should eventually compile into one pixel traversal rather than four.

Naive:

```text
read entire image
brightness
write image

read entire image
contrast
write image

read entire image
saturation
write image
```

Desired:

```text
load pixel
brightness
contrast
saturation
store pixel
```

The architecture must not make each API call synonymous with one full memory pass.

---

# 23. Color Transform Compilation

Many future color operations can be mathematically combined.

Potential examples:

* brightness
* contrast
* saturation
* grayscale
* channel scaling
* some colorization operations

These can frequently be represented by a color matrix or related affine transform.

Several API operations can therefore become:

```text
Operation A
+
Operation B
+
Operation C

↓

one compiled transform
```

This belongs in V2 but should influence V1 architecture.

---

# 24. Worker Threads

Do not make workers the first performance optimization.

Moving buffers between workers can cost more than the computation being parallelized.

Initial priority should be:

1. Better algorithms
2. Less work
3. Fewer memory passes
4. Fewer allocations
5. Better buffer reuse
6. Region pruning
7. Cached resize coefficients
8. Only then parallelism

Workers are most useful for:

* very large images
* computationally expensive resampling
* multiple images
* future convolution operations

Batch parallelism may be more valuable than splitting individual images.

For example:

```ts
await Promise.all([
  resize("1.jpg"),
  resize("2.jpg"),
  resize("3.jpg"),
  resize("4.jpg")
]);
```

may already naturally utilize application-level concurrency.

---

# 25. Codec Strategy

Codecs are likely to become the largest tension between:

```text
small
fast
pure JS
modern formats
```

These goals sometimes conflict.

The project should acknowledge this rather than pretending otherwise.

---

# 26. V1 Format Priorities

## Tier 1: Required

### JPEG

Must support:

* decode
* encode
* quality
* orientation metadata

JPEG is probably the single most important codec.

### PNG

Must support:

* decode
* encode
* alpha
* compression level

### GIF input

Must support the narrow compatibility surface needed by common upload
normalization pipelines:

* detect
* decode the first composited frame
* preserve that frame's transparency
* convert that frame to JPEG or PNG

GIF encoding and animated editing are not V1 requirements.

The first-frame decoder should retain indexed pixels rather than expanding the
entire logical screen to a mutable RGBA bitmap. It must support global and local
color tables, transparency, image offsets, and interlaced storage, then emit
ordered RGBA PixelBlocks for the shared crop, resize, and encoder pipeline.

These formats cover the common Lambda upload workloads as well as a huge
portion of general image-processing use cases.

---

## Tier 2: Strongly desirable

### WebP

Modern and extremely common.

Pure-JS support is fragmented. There are current packages implementing pieces such as pure-JS lossless WebP decoding, while broader encoders commonly use WASM/libwebp.

PureJsImage must provide first-party still-image decoding for both lossless
VP8L and the common lossy VP8 bitstream. Detection or metadata-only handling
does not count as WebP input support. Lossless decoding should cover color
caches, LZ77 references, spatial prefix groups, and all specified transforms.
Lossy decoding must be tested against ordinary web photographs. WebP encoding
is the next requirement after both still-image input variants work. Animated
WebP remains outside V1.

The codec abstraction should allow multiple implementations.

### BMP

PureJsImage must provide first-party BMP detection, metadata, decode, and
encode without a runtime dependency. Input support should include OS/2 and
Windows DIB headers, 1/4/8-bit palettes, RLE4/RLE8, 16/24/32-bit pixels,
RGB555/RGB565 and arbitrary valid channel bitfields, top-down and bottom-up
storage, row padding, and V4/V5 alpha masks.

Uncompressed input should emit logical top-down PixelBlocks from bounded source
row groups and honor decoder crop regions. Because RLE command streams are
bottom-up and can contain position deltas, their explicit fallback may retain a
compact one-byte index plane, not a four-byte RGBA bitmap. Encoding should be
streamable through a top-down DIB and preserve alpha when requested.

---

## Tier 3

### AVIF

First-party pure-JavaScript AVIF is a headline goal and the next codec after
WebP and BMP. It remains a V1 stretch goal rather than a V1 release blocker.

Phase A implements bounded ISOBMFF inspection without pixel decoding:

```ts
const metadata = await (await images.open(input)).metadata();
// width, height, bitDepth, chromaSubsampling, codecProfile, hasAlpha
```

Phase B1 implements bounded `iinf`/`iloc` item extraction for file-relative
`mdat` and `idat` construction, joins multi-extent payloads, resolves direct,
grid-tile, and alpha coded images, and parses AV1 low-overhead OBUs plus the
complete sequence header. Container `av1C` values are compared with the
sequence header as a compatibility diagnostic; the bitstream remains
authoritative when legacy inputs disagree. This milestone deliberately stops
before entropy decoding or pixel reconstruction.

Phase B2 begins pixel reconstruction with a deliberately restricted,
dependency-free correctness slice: reduced still-picture headers, one tile,
8-bit Main Profile YUV 4:2:0, lossless square partitions, DC prediction, and
all-zero coefficient blocks. It produces real PixelBlocks through the normal
pipeline and returns `UNSUPPORTED_OPERATION` for AV1 syntax it cannot yet
reconstruct. This first slice is not broad AVIF decoder support and its current
full YUV/RGBA frame storage must be replaced with bounded reconstruction state
as compatibility expands.

Phase B implements a broad still decoder, starting with single-image 8-bit AV1
Main Profile YUV 4:2:0. Phase C implements the constrained still encoder:

```ts
registerCodec(avifCodec);
```

Then:

```ts
await image
  .encode("avif", {
    quality: 65
  })
  .toFile(...);
```

Optional runtime or WASM providers may remain available, but they do not count
as official AVIF support and must never be required by the package.

The compatibility target is a checksum-pinned 200-500-image corpus spanning
libaom, rav1e, SVT-AV1, libavif, browsers, ImageMagick, Sharp/libvips, real web
files, bit depths, chroma layouts, alpha, grids, color profiles, and malformed
inputs. Every implementation milestone must record compatibility, wall time,
peak RSS, and output correctness. AVIF-to-resize-to-AVIF should eventually keep
data in YUV planes when possible rather than materializing full RGBA frames.

### TIFF

Useful for compatibility but much less important to the primary web-image use case.

### JPEG XL

Architecture target, not V1 requirement.

---

# 27. Runtime Codec Providers

Eventually a format might have several providers.

Example:

```text
AVIF
├── runtime WebCodecs provider
├── WASM provider
└── future pure-JS provider
```

The browser `ImageDecoder` API can expose runtime-supported image formats, although browser availability is currently not universal.

The codec registry can therefore eventually select:

```text
best available implementation
```

without changing the image-processing API.

---

# 28. Encoding and Compression API

Compression settings should be format-specific but consistent where possible.

Example:

```ts
.encode("jpeg", {
  quality: 80,
  progressive: true
})
```

```ts
.encode("webp", {
  quality: 75,
  lossless: false
})
```

```ts
.encode("png", {
  compressionLevel: 8
})
```

Later:

```ts
.encode("avif", {
  quality: 55,
  speed: 6
})
```

Do not invent misleading universal settings where codecs mean fundamentally different things.

---

# 29. Future Target-Size Compression

A very useful V1.1 feature:

```ts
.encode("jpeg", {
  maxBytes: 250_000
})
```

The library could perform a bounded quality search:

```text
quality 80
 ↓
too large

quality 65
 ↓
too small

quality 72
 ↓
near target
```

Potential API:

```ts
.compress({
  format: "jpeg",
  maxBytes: 250_000,
  minQuality: 40,
  maxQuality: 90
})
```

This requires multiple encodes and therefore should not complicate the initial V1 encoder path.

---

# 30. Performance Philosophy

PureJsImage should optimize **work avoided** before optimizing work performed.

Priority:

### 1. Do not process pixels that cannot affect output.

### 2. Do not traverse pixels more times than necessary.

### 3. Do not allocate buffers unnecessarily.

### 4. Keep working sets small enough for CPU cache.

### 5. Reuse calculated values.

### 6. Specialize common paths.

### 7. Parallelize only when worthwhile.

This architecture can outperform Jimp without requiring exotic tricks.

---

# 31. Performance Targets

Initial aspirational targets against current Jimp:

### Common transformations

```text
resize:
2x+ faster

crop + resize:
2x to 5x+ faster

format conversion + resize:
1.5x to 3x+ faster

multi-operation pipelines:
2x to 5x+ faster
```

Specific favorable pipelines may exceed these numbers significantly.

Do not make benchmark claims publicly until reproducible benchmark data exists.

---

# 32. Memory Targets

For operations that can stream:

> Peak transformation working memory should scale approximately with output width, filter radius, and block size rather than source image area.

This is more important than a particular MB target.

Example:

```text
10,000 × 10,000 input
 ↓
resize to 1,000 × 1,000
```

should not inherently require a:

```text
400 MB RGBA bitmap
```

inside the transformation engine.

The decoder may still impose format-specific requirements, but the processing architecture should not.

For the primary 4000x3000 JPEG-to-1200px Lambda workflow, beating Jimp by a
small percentage is not sufficient. The release trajectory should show that
source-sized decode buffers and duplicate RGB/RGBA copies are being removed,
with the eventual baseline-JPEG path retaining only bounded MCU/component rows.

---

# 33. Benchmark Suite

Benchmarks should exist almost immediately, before optimization work begins.

Without a permanent benchmark suite, architectural performance goals will slowly become opinions.

Compare:

```text
PureJsImage
Jimp
```

Optionally include:

```text
Sharp
```

as a native performance reference rather than an expected competitor.

---

# 34. Benchmark Workloads

Use realistic source files.

### Benchmark A

```text
4000×3000 JPEG
→ resize width 1200
→ JPEG quality 80
```

### Benchmark B

```text
6000×4000 JPEG
→ crop center 3000×2000
→ resize 800×533
→ JPEG quality 75
```

### Benchmark C

```text
4000×3000 PNG
→ resize width 1000
→ PNG
```

### Benchmark D

```text
PNG with transparency
→ resize
→ PNG
```

### Benchmark E

```text
JPEG
→ PNG
```

### Benchmark F

```text
PNG
→ JPEG quality 80
```

### Benchmark G

Batch:

```text
100 mixed JPEG images
→ 1200px thumbnails
```

### Benchmark H

Large image:

```text
10000×10000
→ 1000×1000
```

This should specifically measure peak memory.

### Benchmark I

Lambda user-upload and Twilio MMS normalization:

```text
mixed JPEG / transparent PNG / GIF first-frame inputs
→ shrink to at most 1024px wide without enlargement
→ flatten alpha deterministically
→ JPEG quality 80
```

### Benchmark J

Lambda logo and avatar normalization:

```text
mixed JPEG / transparent PNG / GIF first-frame inputs
→ contain within a centered 256 x 256 transparent canvas
→ PNG
```

These application-style workloads must compare both runtime and peak memory
against equivalent Jimp pipelines.

---

# 35. Benchmark Metrics

Collect at least:

```text
wall-clock execution time
operations/sec
peak RSS
heapUsed
external memory / ArrayBuffer memory
output file size
```

Correctness also matters.

For lossless operations:

```text
pixel equality
```

For resize:

```text
comparison against reference implementation
```

For lossy encoding:

```text
SSIM or another quality metric
```

Performance improvements that substantially degrade visual quality do not count.

---

# 36. Benchmark Discipline

Every major optimization should answer:

```text
What benchmark became faster?

By how much?

What happened to memory?

What happened to output quality?

What happened to code/package size?
```

Store historical benchmark results.

A CI performance regression system can come later.

---

# 37. Repository Structure

Potential structure:

```text
purejsimage/
│
├── packages/
│   ├── core/
│   ├── jpeg/
│   ├── png/
│   ├── gif/
│   ├── bmp/
│   ├── webp/
│   └── avif/
│
├── benchmarks/
│   ├── fixtures/
│   ├── jimp/
│   ├── purejsimage/
│   └── results/
│
├── test/
│   ├── resize/
│   ├── crop/
│   ├── codecs/
│   └── integration/
│
├── docs/
│   ├── architecture.md
│   ├── codecs.md
│   └── performance.md
│
└── package.json
```

A monorepo makes independent codec packages considerably easier.

---

# 38. TypeScript vs JavaScript

Author the project in TypeScript.

Publish normal JavaScript plus `.d.ts` declarations.

Do not let elaborate TypeScript abstractions leak into hot runtime code.

Runtime performance matters more than type-system cleverness.

Target modern JavaScript runtimes rather than carrying large compatibility layers for obsolete Node versions.

---

# 39. Testing Strategy

Every codec should have fixture-based tests.

Required classes:

### Round-trip

```text
decode
→ encode
→ decode
```

### Conversion

```text
JPEG → PNG
PNG → JPEG
```

### Resize correctness

Compare known fixtures and dimensions.

### Crop correctness

Test boundaries:

```text
top-left
bottom-right
1px regions
full image
invalid coordinates
```

### Orientation

Test all EXIF orientation values.

### Alpha

Ensure transparency survives appropriate conversion.

Also verify deterministic flattening when PNG or GIF input is encoded to JPEG,
and exact-size transparent padding when `fit: "contain"` is used.

### Common Lambda workflow fixtures

Keep fixture-based coverage for the two representative upload pipelines:

```text
JPEG / PNG / GIF Buffer
→ inspect width
→ shrink only when wider than 1024 or 2048
→ JPEG quality 80
→ Buffer
```

```text
JPEG / PNG / GIF Buffer
→ contain within centered 256 x 256 transparent canvas
→ PNG
→ Buffer
```

Assert output format and dimensions, aspect ratio, padding placement,
transparent padding, first-frame GIF behavior, and no enlargement when that
option is selected.

### Malformed files

Image parsers process untrusted binary input.

Fuzzing should eventually be part of the project.

At minimum, malformed inputs must fail cleanly rather than allocate absurd amounts of memory or enter uncontrolled loops.

---

# 40. Security Limits

Image formats are hostile-input territory.

Add configurable limits such as:

```ts
{
  maxWidth,
  maxHeight,
  maxPixels,
  maxInputBytes,
  maxFrames,
  maxDecodedBytes
}
```

Never trust width/height headers enough to immediately allocate:

```text
width × height × channels
```

without overflow and limit checks.

Protect against decompression bombs.

This should be a V1 requirement.

---

# 41. V1 Development Sequence

## Phase 0: Benchmark Jimp

Before implementation:

1. Build benchmark harness.
2. Record Jimp speed.
3. Record Jimp peak memory.
4. Store representative fixture images.
5. Establish correctness references.

This gives the project an objective baseline.

---

## Phase 1: Core abstractions

Implement:

```text
ImageSource
Image metadata
Codec registry
Pipeline representation
PixelBlock
Buffer pool
Sink interface
```

No filters.

No text.

No fancy plugins.

---

## Phase 2: PNG

Get one complete format working end-to-end.

```text
PNG decode
 ↓
PixelBlocks
 ↓
PNG encode
```

Then:

```text
PNG
→ crop
→ PNG
```

This proves the architecture.

---

## Phase 3: Resize engine

Implement:

```text
nearest
bilinear
Lanczos3 if practical
```

Then build:

```text
streaming horizontal resize
ring-buffer vertical resize
coefficient cache
```

Benchmark constantly.

---

## Phase 4: JPEG

Implement/integrate:

```text
JPEG decode
JPEG encode
quality
EXIF orientation
```

Then optimize the primary workload:

```text
JPEG
→ autoOrient
→ crop
→ resize
→ JPEG
```

This is probably the project's most important milestone.

---

## Phase 5: Cross-format conversion

Make:

```text
JPEG → PNG
PNG → JPEG
GIF first composited frame → PNG
GIF first composited frame → JPEG
```

first-class and heavily tested.

---

## Phase 6: API cleanup

Only after the engine works:

* finalize method names
* improve errors
* write docs
* stabilize types
* add convenience APIs

Do not design twenty APIs before understanding what the executor needs.

---

## Phase 7: Additional codecs

In approximate priority:

```text
WebP
BMP
AVIF
TIFF
```

Expanded GIF support, including encoding or animation, may be added here after
the required first-frame decoder is complete.

Architecture should prevent these from expanding the core package.

---

# 42. V1 Release Criteria

PureJsImage 1.0 should not ship because it has a long feature checklist.

It should ship when it has a short checklist that works extremely well.

Required:

* JPEG decode/encode
* PNG decode/encode
* GIF detection and first-composited-frame decode
* automatic format detection
* conversion between JPEG and PNG
* conversion from the first GIF frame to JPEG and PNG
* resize
* exact-size `contain` with position and transparent/background padding
* crop
* JPEG quality control
* PNG compression control
* deterministic alpha flattening for JPEG output
* EXIF orientation
* metadata access without mutable bitmap access
* Buffer input/output
* file input/output on Node
* Blob, File, ArrayBuffer, and Uint8Array input in modern browsers
* Uint8Array, Blob, and custom sink output in modern browsers
* browser-targeted packaging without Node built-ins or Buffer polyfills
* strict input limits
* good error handling
* benchmark suite
* substantially better performance than Jimp on primary workloads
* substantially reduced memory pressure on streaming-capable workloads
* passing common Lambda upload workload fixtures

Strongly desirable:

* streaming output
* WebP
* additional browser storage and compression backends beyond the required
  modern baseline

Not required:

* text
* fonts
* filters
* drawing
* arbitrary compositing
* animation

---

# 43. V2

Once the V1 execution architecture is proven, expand it rather than bloating V1.

Potential V2 capabilities:

### Color operations

```text
brightness
contrast
gamma
saturation
hue
grayscale
invert
normalize
```

These should use fused pixel passes.

### Filters

```text
blur
sharpen
convolution
edge detection
```

The block executor will need halo/neighborhood support.

### Compositing

```text
overlay
mask
alpha composite
watermark
```

This may motivate a real DAG rather than a linear pipeline.

### Text

Only then introduce:

```text
font loading
font metrics
text layout
text rendering
```

Text is almost an independent graphics subsystem and has little to do with the original goal of fast image conversion/resizing.

Do not drag it into the first release.

### Animated images

Eventually:

```text
animated GIF
animated WebP
animated AVIF
```

Frames introduce another execution dimension and should be designed deliberately.

---

# 44. Potential V3 Architecture Evolution

If compositing and multi-source operations become important:

```ts
background.composite(
  foreground.resize(...)
)
```

the pipeline is no longer linear.

At that point introduce a proper execution DAG:

```text
Source A ─ Resize ─┐
                   ├─ Composite ─ Encode
Source B ─ Crop ───┘
```

A spatial tile scheduler becomes much more valuable here.

Do not pay this complexity cost before V1 requires it.

---

# 45. Debugging and Explainability

A future useful API:

```ts
await pipeline.explain()
```

Example output:

```text
Input
JPEG 6048×4024 RGB8

AutoOrient
orientation: 6
fused into coordinate mapping

Crop
source region: 1200,500 → 5200,3500

Resize
4000×3000 → 1200×900
algorithm: Lanczos3
execution: row blocks
block height: 32

Encode
JPEG
quality: 80

Estimated working memory:
7.8 MB
```

This would be extremely valuable for debugging performance and demonstrating why PureJsImage uses less memory.

Not required for V1, but architecturally attractive.

---

# 46. API Compatibility Philosophy

PureJsImage should not attempt literal Jimp API compatibility.

Doing so risks importing Jimp's architectural assumptions.

Instead, provide a small migration guide:

```ts
const image = await Jimp.read(input);

image.resize({ width: 800 });

const output = await image.getBuffer("image/jpeg", {
  quality: 80
});
```

becomes approximately:

```ts
const output = await images.open(input)
  .resize({ width: 800 })
  .encode("jpeg", { quality: 80 })
  .toBuffer();
```

If demand exists, a compatibility wrapper can eventually provide:

```text
@purejsimage/jimp-compat
```

Do not make compatibility constrain the core.

---

# 47. Core Design Rules

The following rules should be treated almost like project commandments.

### Rule 1

**An Image is a description of pixels, not necessarily an allocated bitmap.**

### Rule 2

**Do not allocate the whole image unless necessary.**

### Rule 3

**Do not process pixels that cannot contribute to output.**

### Rule 4

**Do not traverse pixels multiple times when operations can be combined.**

### Rule 5

**Do not allocate inside hot pixel loops.**

### Rule 6

**Reuse intermediate memory.**

### Rule 7

**Codecs are plugins, not core architecture.**

### Rule 8

**Modern format support must not force every user to download every codec.**

### Rule 9

**Optimize real pipelines, not toy microbenchmarks.**

### Rule 10

**Every performance claim must be benchmarked.**

### Rule 11

**Full bitmap access is an explicit escape hatch, not the default model.**

### Rule 12

**Do not implement features merely because Jimp has them.**

---

# 48. Initial North-Star Benchmark

If the project only had one benchmark, use this:

```text
Input:
6000×4000 JPEG photograph

Operations:
auto-orient
center crop to 4:3
resize to 1200×900
encode JPEG quality 80

Measure:
execution time
peak RSS
output size
visual quality
```

Then compare:

```text
Jimp
PureJsImage
Sharp
```

Jimp is the competitor.

Sharp is the theoretical/native reference point.

The project's architectural progress should be visible in this benchmark.

---

# 49. Success Definition

PureJsImage succeeds when it is a broad, production-quality suite of first-party
image codecs with a shared raster pipeline—not when it reproduces a drawing or
full-bitmap manipulation API.

A developer handling ordinary application images should be able to replace a
Jimp-style decode, orient, crop, resize, and encode workflow with:

```text
smaller dependency surface
lower peak memory
competitive measured performance
portable Node.js and browser behavior
explicit codec capability boundaries
```

A developer handling TIFF, OME-TIFF, GeoTIFF/COG, whole-slide, or N-channel
numeric data should be able to use the same source and codec architecture
through the raster API without forcing native samples through an RGBA bitmap.

Each mature codec should accumulate a checked capability contract, permanent
conformance corpus, hostile-input coverage, bounded execution where its format
permits it, practical encode and decode depth, and optional first-party
acceleration when benchmarks justify the added implementation.

The long-term positioning is:

> **PureJsImage is a first-party image codec suite and low-memory raster engine
> in strict TypeScript.**

Jimp remains the original motivating comparison. It does not define the
project's eventual scope.
