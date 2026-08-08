# JPEG 2000 fixture corpus

The corpus combines small project-generated coding fixtures with two
public-domain documentary photographs encoded as JP2. ImageMagick 7.1.2-3 with
its OpenJPEG 2.5.3 delegate and FFmpeg 7.1.1 were used as development encoders.

`wikimedia-blue-marble-openjpeg-lossless.jp2` uses the 1920-pixel Wikimedia
thumbnail of NASA Apollo 17 photograph AS17-148-22727. Wikimedia marks the
source public domain with no attribution required:
https://commons.wikimedia.org/wiki/File:The_Blue_Marble,_AS17-148-22727.png

`loc-court-day-openjpeg-lossless.jp2` uses the Library of Congress 1024-pixel
derivative of Jack Delano's 1941 FSA photograph “Court day. Rustburg, Virginia.”
The Library of Congress records no known restrictions:
https://www.loc.gov/item/2017812242/

The downloaded source checksums are:

```text
d121c85f88eeb7798bc39c19034e4844655f2689484893a6923920a7507a4a13  blue-marble.png
4faa3a552109425196bb7a93ac8da16d510515b912d193c05e849e97df2a4b11  court-day.jpg
```

Reproduction commands:

```sh
curl -L 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/The_Blue_Marble%2C_AS17-148-22727.png/1920px-The_Blue_Marble%2C_AS17-148-22727.png' -o blue-marble.png
curl -L 'https://tile.loc.gov/storage-services/service/pnp/fsa/8c19000/8c19200/8c19248v.jpg' -o court-day.jpg
magick blue-marble.png -strip -quality 100 wikimedia-blue-marble-openjpeg-lossless.jp2
magick court-day.jpg -strip -colorspace Gray -quality 100 loc-court-day-openjpeg-lossless.jp2
magick -size 17x13 gradient:red-blue -quality 100 openjpeg-lossless-rgb16.jp2
magick -seed 2000 -size 19x11 plasma:fractal -colorspace sRGB -quality 45 openjpeg-reversible-rgb16.jp2
magick -size 9x7 gradient:black-white -colorspace Gray -quality 100 openjpeg-lossless-gray16.jp2
ffmpeg -f lavfi -i testsrc=size=32x24:rate=1 -frames:v 1 -pix_fmt rgb24 -c:v jpeg2000 -pred dwt97int -format jp2 ffmpeg-lossy-rgb8.jp2
ffmpeg -f lavfi -i testsrc=size=40x30:rate=1 -frames:v 1 -pix_fmt rgb24 -c:v jpeg2000 -pred dwt97int -format jp2 -tile_width 16 -tile_height 16 ffmpeg-lossy-tiled-rgb8.jp2
```

The RLCP, RPCL, PCRL, and CPRL files repeat the first FFmpeg command with its
matching `-prog` value. The file without a progression suffix uses LRCP.

FFmpeg 7.1.1 writes `ihdr.BPC` as `8` for this 8-bit stream while its `SIZ`
marker correctly writes the Part 1 value `7`. The pinned fixture corrects that
single container byte to `7`; the codestream is unchanged. This keeps the
fixture standards-conforming and preserves the decoder's strict metadata
cross-check.

The corpus covers real photographic RGB and grayscale content, reversible 5/3
RGB and grayscale, and irreversible 9/7 RGB from a second encoder. The
development oracle's exact RGBA hashes are pinned for both public-domain
photographs. Input checksums, decoded hashes, and metadata expectations live in
`benchmark/jpeg2000/verify-corpus.ts`.
