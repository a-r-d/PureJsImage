# CBF compatibility corpus

`prepare-compatibility-sample.ts` downloads a real PILATUS 300K CBF from the Paul Scherrer
Institute CBF example repository, verifies SHA-256
`6d338b78101bcaecfe7322942d067f4ca40f403491773026f23f24004feaf516`, opens it with PureJsImage,
and checks its 487 by 619 signed int32 x-CBF_BYTE_OFFSET detector array metadata.

Source: <https://github.com/paulscherrerinstitute/cbf/blob/88f4f5b6fdcee5577d1f96c46c27a653c6622e20/examples/in16c_010001.cbf>

The third-party file is written to `benchmark/corpus/cbf/compatibility/` for manual compatibility
testing. It is not committed, and normal tests do not use the network.

Run from the repository root:

```sh
node benchmark/cbf/prepare-compatibility-sample.ts
```
