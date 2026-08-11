# Zero-dependency Aperio SVS viewer demo

The deployed example is <https://purejsimage.com/wsi/>. Its plain TypeScript worker opens an
original Aperio SVS through `HttpRangeSource`, `openTiffDocument`, and `openAperioSvs`; decodes
native pyramid tiles; and transfers finished `ImageBitmap`s to a 2D canvas. There is no runtime
package dependency, tile server, proxy, sidecar index, or format conversion.

## Point it at another slide

Paste an absolute `https://` URL into the page and choose **Open original SVS**. The demo accepts
only Aperio SVS. The object host must honor byte ranges and make the range metadata visible to
browser JavaScript. A probe should return all of the following:

```text
206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-1023/TOTAL_BYTES
Access-Control-Allow-Origin: https://purejsimage.com
Access-Control-Expose-Headers: Content-Range
```

`Access-Control-Allow-Origin: *` is also sufficient for a public slide. The
`Access-Control-Expose-Headers` line matters: without it, a cross-origin response may contain the
right bytes while JavaScript is still unable to read `Content-Range`. Do not put a proxy in front
of a failing host and call that the same demo; configure CORS on the object bucket instead.

## Local development

From the repository root:

```sh
npm run docs:dev
```

Then open the `/wsi/` route printed by Astro. The default remote slide requires an internet
connection. The committed CC0 `tests/fixtures/aperio-cmu-1-small-region.svs` is intentionally used
by automated tests instead of copied into the production site.

## Known limitations

- This is an existence proof and measurement instrument, not a complete pathology viewer.
- It supports Aperio SVS only and assumes native tiled pyramid levels.
- The bitmap LRU is bounded to 192 decoded tiles; source range caching is separately bounded in
  the worker.
- Display is RGB/gray 8-bit canvas output. Annotations, measurements, color-management controls,
  and clinical validation are out of scope.
- Remote availability and CORS configuration remain the responsibility of the object host.
