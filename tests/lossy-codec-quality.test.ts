import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'

import { Image } from './image-library.ts'

const width = 256
const height = 192

// Pinned sharp 0.35.3/libwebp q90 encode of the repository's tundra fixture at 64x48.
// Its 4x4 vertical-left modes catch reconstruction errors that propagate through later blocks.
const oracleWebp = Buffer.from(
  'UklGRnwFAABXRUJQVlA4IHAFAABQGACdASpAADAAPjEUh0KiIQwGAwAQAYJYgCxH3IDr7x+Kv4q9OVyrE3eEDZ/lH/O7/TzAfqh+0fvy+i//j+kz1AG8v2azvCxHcpPtORP2magXbXiV4A7XX+W3p/P/7D/svUC7mf7bjI4JnwBjq39v44vqL2BP1m34xK1WxE1+EOJdZqpl5+NKUfn2HDY+In5MvUvtEdPA/goVc5XsHVI1mmrLohoq+5EXgNmWBmVKMmjO/ToBADeb2P4EwxSCYoA68LsjVJvAabVVAAD+/KUI/xS1H4QNeHybT3dSEP5u7QEf/Nuy6PW6aBPMmfCz7ZOb/lXltDpogb055ON4WCeBRlbkbZvASHjJ3qQvgRxvgQTsKNs8V3/HiuX7d+TTMKL/8Fo+E7tT/1Km78rT43JAqP/4tORhTsVAQ5hs/e+jN0U1CVcO1sFMmfiVi42TRg/QS1UNEFseNxHyCoOmQtuI3fNlfw+uT5kzE1Vhp3oKZJRp0ZV5pQLv+wsfEhEULAXcUCZyk4aa59VyyrHtIYiPixcdaD/vxgYU0Mx/Cl+TIJgWohk0yEDSVJtGpm0d07P7kABnC++IzduXQ+M+IJqPowi3EJs3rDiz0WI00R12L4n7Q/M80zzIV+t4iiUIFFj/277guPdImYznbdxgRE7AjkFFFGXcZaicSnH4yWj9x6jAvBv9+/CwxfVX002TZkvzDwy4FcLztfaP/HJ1uDCq5XnqwBGodKIUnWSVWQX54WPRZF9iw88GF/E7tjRJHtFi0stcBmbxKwv6WsRnuv2pKTg1xUlySJ2kbxIQXOFmINZMcWn29c7pH2GBIPyt8ytxlQg+GvAPByq4s+H/e0lY7D4if8VYPMDhq0WP3bB0SY5ec6Esb2SfirjcirAYwKMnRehiNL9p3aat7ySttPGXwhaDacWLRqCtmmfCxUEKNtcuxn+e3KWJi5C7DxVJjAv+enszmdcMHgFFLV1/UKhw3vWvS5t73oMZaFgD4K3zsgwhEd0W0pnnY9IyGFOw/9meAuGpndVLAQIgi2NmuLy0s0+ScJcKqNxpADlLKlsTyCzGwNc8j6JCCPeE/Sjf5nNduA5F+Afaf254ciCq5l9fQXBUcWB2mNyfkWNsRTEikSl0oqVLt+yfNXs2TS1P7px7PErh18DJmIuGKU2bM5vbErLfZUbcE4l0P8q/4PzLO4c1ICpY7+XhyFAxgGosvwPdFsk+gnQLQElkb2Ssys/vZ2raWUcNGaBjrt+FscEXXZ00oKJ/JU6JRm3pojM2A/+slf2qFSLLyuRkFjCf5uHoBV96hoQbI3XlibeGvf/sNRZcKuWbZsFqUMScTQkaTa+V1t0TcJPZKpJfecH6aHl1DK2VFrTgBdrOMjRnOwhxGzW5uPkfzUYBf7KcVyWF632ejbnd/j7iRsVgGgs4g7NtI6RuJgwjPNTijivG1gCs0DTReIT1jpp22PIjb/8548yRL+VHY5R1ey5BUhAWko2KSGLCt7ogmgQkJA5bfH4xgD3dbGyUOwx8TLtghU/bj2EsgX/DHDcqCuUQAT2mQZIPmCYB93vDr0PlS1ItAdFWccUB8JqSxJzhGjDYhwZMkB/ljRv64Ub4C+CYu7LPregMOqW5r94hw+W4cg+MRDutZJi2Ooa2WdGpAACSHSxrIlVTSKGYKWCzG6vL7IgNjdfocfG6DZZIQNFKhyGIXTPMqcmLXvCpgyj+7OYoxrioC6K1v02FLZg+eaL37gBj8fTxhuWqCl8XKSVX7s0/gaGZHcVId0PLmegOhkVCM+ZqdsnmQLwsTukyqa8T46CLtgnIMi3uQuHwJ8bE5JWmLfV89P33qwHR2MAKNIMMdw9wAAA=',
  'base64',
)

const clampByte = (value: number): number => Math.max(0, Math.min(255, value))

const sourceRgb = (): Uint8Array => {
  const output = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const texture = ((x * 29 + y * 17 + ((x * y) % 97)) & 31) - 16
      const patch = ((x >> 4) + (y >> 4)) & 1 ? 10 : -10
      output[offset] = clampByte(25 + (x * 180) / width + (y * 30) / height + texture / 2 + patch)
      output[offset + 1] = clampByte(
        35 + (y * 150) / height + ((width - x) * 50) / width - texture / 3 - patch,
      )
      output[offset + 2] = clampByte(
        180 - (y * 120) / height + (x * 50) / width + texture + patch / 2,
      )
    }
  }
  return output
}

const source = sourceRgb()

const sourcePng = (): Uint8Array => {
  const png = new PNG({ width, height })
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    png.data[pixel * 4] = source[pixel * 3] ?? 0
    png.data[pixel * 4 + 1] = source[pixel * 3 + 1] ?? 0
    png.data[pixel * 4 + 2] = source[pixel * 3 + 2] ?? 0
    png.data[pixel * 4 + 3] = 255
  }
  return PNG.sync.write(png)
}

const pngRgb = (input: Uint8Array): Uint8Array => {
  const decoded = PNG.sync.read(Buffer.from(input))
  const output = new Uint8Array(decoded.width * decoded.height * 3)
  for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += 1) {
    output[pixel * 3] = decoded.data[pixel * 4] ?? 0
    output[pixel * 3 + 1] = decoded.data[pixel * 4 + 1] ?? 0
    output[pixel * 3 + 2] = decoded.data[pixel * 4 + 2] ?? 0
  }
  return output
}

const psnr = (expected: Uint8Array, actual: Uint8Array): number => {
  expect(actual.byteLength).toBe(expected.byteLength)
  let squaredError = 0
  for (let index = 0; index < expected.byteLength; index += 1) {
    const difference = (actual[index] ?? 0) - (expected[index] ?? 0)
    squaredError += difference * difference
  }
  if (squaredError === 0) return Number.POSITIVE_INFINITY
  return 10 * Math.log10((255 * 255 * expected.byteLength) / squaredError)
}

const sharpSource = () => sharp(source, { raw: { width, height, channels: 3 } })

describe('lossy codec oracle quality', () => {
  it('decodes libwebp output without a systematic reconstruction ceiling', async () => {
    const oracle = await sharp(oracleWebp).removeAlpha().raw().toBuffer()
    const decodedPng = await (await Image.open(oracleWebp)).png().toBuffer()
    const decoded = pngRgb(decodedPng)

    expect(psnr(oracle, decoded)).toBeGreaterThan(39)
  })

  it('produces lossy WebP that passes an independent libwebp decode', async () => {
    const encoded = await (await Image.open(sourcePng())).webp({ quality: 75 }).toBuffer()
    const decoded = await sharp(encoded).removeAlpha().raw().toBuffer()

    expect(psnr(source, decoded)).toBeGreaterThan(26)
  })

  it('decodes libjpeg output within the independent oracle tolerance', async () => {
    const encoded = await sharpSource().jpeg({ quality: 80, chromaSubsampling: '4:2:0' }).toBuffer()
    const oracle = await sharp(encoded).removeAlpha().raw().toBuffer()
    const decodedPng = await (await Image.open(encoded)).png().toBuffer()
    const decoded = pngRgb(decodedPng)

    expect(psnr(source, decoded)).toBeGreaterThan(28)
    expect(psnr(oracle, decoded)).toBeGreaterThan(40)
  })

  it('produces JPEG that passes an independent libjpeg decode', async () => {
    const encoded = await (await Image.open(sourcePng())).jpeg({ quality: 80 }).toBuffer()
    const decoded = await sharp(encoded).removeAlpha().raw().toBuffer()

    expect(psnr(source, decoded)).toBeGreaterThan(26)
  })
})
