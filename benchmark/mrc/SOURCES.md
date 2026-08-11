# MRC compatibility corpus

`prepare-official-sample.ts` downloads `EMD-3197.map` from the CCP-EM `mrcfile` test corpus,
verifies SHA-256 `351d5090d4c56eb5fc41796842ad64abecc238b8da6181f8857be5844dbbc262`,
opens it with PureJsImage, and checks its 20 by 20 by 20 float32 volume metadata.

Source: <https://github.com/ccpem/mrcfile/blob/a2a8c6b569a57b7f18b023b5056fa7a14f2f99c2/tests/test_data/EMD-3197.map>

The third-party file is written to `benchmark/corpus/mrc/official/` for manual compatibility
testing. It is not committed, and normal tests do not use the network.

Run from the repository root:

```sh
node benchmark/mrc/prepare-official-sample.ts
```
