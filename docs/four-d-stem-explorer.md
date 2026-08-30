# 4D-STEM explorer

## Quick Answer

The [browser explorer](https://purejsimage.com/4d-stem/) shows a scan map beside the diffraction
pattern at one scan position. Click the scan map to move the cursor. Draw a detector ROI to create a
virtual detector map. Draw a scan ROI to sum or average diffraction patterns. The work stays in a
dedicated browser worker and uses bounded source regions and output tiles.

## What the built-in example proves

The built-in file is a generated processed Merlin MIB acquisition with an HDR sidecar. It has a
7 by 5 scan grid and a 17 by 15 detector. Its uint16 counts contain a central beam, displaced disks,
two specimen regions, and an annular signal. The same generator supplies exact expectations to the
operation tests.

The MIB reader establishes the four axis roles only when the HDR sidecar has a valid frame count and
rectangular scan shape. The application does not infer 4D-STEM from array rank alone.
Automatic recognition requires two labeled spatial axes and two labeled reciprocal-space axes.
Callers can validate an explicit role override with `validateFourDStemAxisRoles()` when a reader
uses different IDs but preserves those semantics and a readable detector plane.

## Use a local MIB acquisition

1. Open the 4D-STEM explorer.
2. Choose the processed `.mib` file.
3. Choose its `.hdr` sidecar when it is available.
4. Select **Open local MIB**.

Local files stay in the tab. A processed MIB without navigation metadata remains a frame sequence,
so it cannot enter the linked scan workspace. Packed raw R64 detector words are not supported.

## Use the analysis bundle

The bundle is separate from the general built-in analysis entry. Importing it creates no global
registry or provider.

```ts
import { createTileRuntime } from "purejsimage/analysis/runtime";
import {
  createFourDStemAnalysisBundle,
  fourDStemOperationParameters,
  virtualDetectorMapOperationId,
} from "purejsimage/analysis/4d-stem";

const runtime = createTileRuntime({
  limits: {
    maxCacheBytes: 32 * 1024 * 1024,
    maxTileBytes: 4 * 1024 * 1024,
  },
});

const bundle = createFourDStemAnalysisBundle({
  runtime,
  tileWidth: 32,
  tileHeight: 32,
});

const parameters = fourDStemOperationParameters({
  roles: {
    navigationX: "scanX",
    navigationY: "scanY",
    detectorX: "kx",
    detectorY: "ky",
  },
  roi: {
    kind: "annulus",
    x: 64,
    y: 64,
    innerRadius: 12,
    outerRadius: 28,
  },
  reduction: "sum",
});

console.log(virtualDetectorMapOperationId, parameters, bundle.operations.capabilitySnapshot);
```

Pass the returned operation registry, value-type registry, and providers into the existing analysis
controller. Bind the open `ScientificDataset` as the graph input. The output is another lazy
`ScientificDataset`, so normal plane rendering and numeric-tile adapters can consume it.

## Numeric behavior

Both operations return float64 samples. Declared no-data samples do not contribute to the sum or
mean divisor. Zero counts remain valid. NaN propagates, and an ROI with no valid samples returns NaN.
Integer paths reject a worst-case sum that would exceed JavaScript's exact float64 integer range.
They never wrap silently. A 64-bit integer sum uses an exact scalar accumulator for a virtual
detector ROI and rejects unsafe output conversion.

## Real data path

The repository includes an opt-in verifier for the CC-BY-4.0 Zenodo record
`10.5281/zenodo.4307783`, **Ni-W Based Alloy 4D STEM Data**, attributed to Xiaobing Hu, Stephanie M.
Ribet, Roberto dos Reis, and Vinayak P. Dravid. Its `4D_data.dm4` file is 1,193,664,554 bytes with
the published checksum `md5:8a848d7bbe62f771f86e24e206189e97`. The verified dataset is uint8 with
a 342 by 213 scan and a 128 by 128 detector.

Run the network-dependent verifier explicitly:

```sh
npm run fixtures:digital-micrograph:remote
```

The verifier opens the public HTTP source through bounded ranges, confirms the descriptor and a
pinned raw sample window, and rejects excess fetched bytes. Normal CI does not contact Zenodo. The
live site uses the small same-origin fixture because public CORS and Range behavior can change.
The generic scientific explorer can open supported DM4 datasets. The linked 4D workspace remains
MIB-only until a DM4 descriptor proves the required navigation and detector roles.

## Reproduce the bounded I/O benchmark

Run:

```sh
npm run bench:4d-stem
```

The generated `3 × 2` navigation tile and annular detector ROI use bounded detector bounding-box
row spans for each requested scan position. The benchmark fails if that request reads the complete
MIB source or uses a complete detector-frame read.
