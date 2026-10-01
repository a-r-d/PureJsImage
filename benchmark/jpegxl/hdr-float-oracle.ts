/** Dev-only FFmpeg/zimg reference with exact HLG luminance OOTF, selected by agamma=0. */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

export const jpegXlHdrFloatOracle = async (
  directory: string,
  source: Uint8Array,
  width: number,
  height: number,
  colorCount: 1 | 3,
  alpha: boolean,
  associated: boolean,
  primaries: 'srgb' | 'rec2020' | 'display-p3',
  transfer: 'pq' | 'hlg' | 'linear',
): Promise<{ reference: Uint8Array; linearReference: Uint8Array }> => {
  const count = width * height,
    sourceChannels = colorCount + Number(alpha)
  if (source.byteLength !== count * sourceChannels * 4)
    throw new Error('HDR oracle input dimensions differ')
  const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength)
  const read = (pixel: number, channel: number): number =>
    sourceView.getFloat32((pixel * sourceChannels + channel) * 4, false)
  const planar = Float32Array.from({ length: count * 3 }, (_, sample) => {
    const pixel = sample % count,
      channel = [1, 2, 0][Math.floor(sample / count)] ?? 0
    const a = alpha ? read(pixel, colorCount) : 1
    const value = read(pixel, colorCount === 1 ? 0 : channel)
    const straight = associated ? (a <= 0 ? 0 : value / a) : value
    return transfer === 'linear' ? straight : Math.max(0, Math.min(1, straight))
  })
  await writeFile(`${directory}/input.gbrpf32le`, new Uint8Array(planar.buffer))
  const primaryName =
    primaries === 'rec2020' ? 'bt2020' : primaries === 'display-p3' ? 'smpte432' : 'bt709'
  const transferName =
    transfer === 'pq' ? 'smpte2084' : transfer === 'hlg' ? 'arib-std-b67' : 'linear'
  const linear = `zscale=pin=${primaryName}:tin=${transferName}:min=gbr:rin=full:p=${primaryName}:t=linear:m=gbr:r=full:npl=203:agamma=0,format=gbrpf32le`
  const prefix = [
    '-y',
    '-loglevel',
    'error',
    '-threads',
    '1',
    '-filter_threads',
    '1',
    '-f',
    'rawvideo',
    '-pixel_format',
    'gbrpf32le',
    '-video_size',
    `${width}x${height}`,
    '-i',
    `${directory}/input.gbrpf32le`,
  ]
  execFileSync('ffmpeg', [
    ...prefix,
    '-vf',
    linear,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gbrpf32le',
    `${directory}/linear.gbrpf32le`,
  ])
  const peak = (transfer === 'pq' ? 10000 : 1000) / 203
  execFileSync('ffmpeg', [
    ...prefix,
    '-vf',
    `${linear},tonemap=tonemap=reinhard:desat=0:peak=${peak},zscale=pin=${primaryName}:tin=linear:min=gbr:p=bt709:t=iec61966-2-1:m=gbr:r=full,format=rgb24`,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    `${directory}/srgb.rgb`,
  ])
  const rawLinear = new Uint8Array(await readFile(`${directory}/linear.gbrpf32le`)),
    floats = new Float32Array(rawLinear.buffer)
  const srgb = new Uint8Array(await readFile(`${directory}/srgb.rgb`)),
    channels = alpha ? 4 : 3
  const reference = new Uint8Array(count * channels),
    linearReference = new Uint8Array(count * channels * 4)
  const linearView = new DataView(linearReference.buffer)
  for (let pixel = 0; pixel < count; pixel++)
    for (let channel = 0; channel < channels; channel++) {
      const a = alpha ? read(pixel, colorCount) : 1
      reference[pixel * channels + channel] =
        channel === 3
          ? Math.round(Math.max(0, Math.min(1, a)) * 255)
          : (srgb[pixel * 3 + channel] ?? 0)
      linearView.setFloat32(
        (pixel * channels + channel) * 4,
        channel === 3 ? a : (floats[([2, 0, 1][channel] ?? 0) * count + pixel] ?? 0),
        false,
      )
    }
  return { reference, linearReference }
}
