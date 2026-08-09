import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { ZipArchive } from 'archiver'

interface AssetLocation {
  readonly bucket: string
  readonly key: string
  readonly region: string
}

const directory = dirname(fileURLToPath(import.meta.url))
const assetDirectory = `${directory}/.asset`
const archivePath = `${directory}/.asset.zip`
const locationPath = `${directory}/.asset-location.json`

const readAssetLocation = async (): Promise<AssetLocation | undefined> => {
  let text: string
  try {
    text = await readFile(locationPath, 'utf8')
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  const parsed: unknown = JSON.parse(text)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('bucket' in parsed) ||
    typeof parsed.bucket !== 'string' ||
    !('key' in parsed) ||
    typeof parsed.key !== 'string' ||
    !('region' in parsed) ||
    typeof parsed.region !== 'string'
  ) {
    throw new Error(`Invalid staged asset location: ${locationPath}`)
  }
  return { bucket: parsed.bucket, key: parsed.key, region: parsed.region }
}

const cleanup = async (): Promise<void> => {
  const location = await readAssetLocation()
  if (location) {
    const client = new S3Client({ region: location.region })
    await client.send(new DeleteObjectCommand({ Bucket: location.bucket, Key: location.key }))
    await client.send(new DeleteBucketCommand({ Bucket: location.bucket }))
    client.destroy()
    console.log(`Deleted temporary asset bucket ${location.bucket}`)
  }
  await Promise.all([rm(locationPath, { force: true }), rm(archivePath, { force: true })])
}

if (process.argv.includes('--cleanup')) {
  await cleanup()
} else {
  await cleanup()
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(archivePath)
    const archive = new ZipArchive({ zlib: { level: 9 } })
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(assetDirectory, false)
    void archive.finalize()
  })

  const region = process.env.AWS_REGION ?? 'us-east-1'
  if (region !== 'us-east-1') {
    throw new Error('The Lambda benchmark staging bucket is restricted to us-east-1')
  }
  const location: AssetLocation = {
    bucket: `pji-lambda-bench-${randomUUID()}`,
    key: 'lambda-benchmark.zip',
    region,
  }
  const client = new S3Client({ region })
  try {
    await client.send(new CreateBucketCommand({ Bucket: location.bucket }))
    const archiveStat = await stat(archivePath)
    await client.send(
      new PutObjectCommand({
        Bucket: location.bucket,
        Key: location.key,
        Body: createReadStream(archivePath),
        ContentLength: archiveStat.size,
      }),
    )
    await writeFile(locationPath, `${JSON.stringify(location, null, 2)}\n`)
    console.log(`Staged ${archiveStat.size} bytes in s3://${location.bucket}/${location.key}`)
  } catch (error: unknown) {
    try {
      await client.send(new DeleteBucketCommand({ Bucket: location.bucket }))
    } catch {
      // Preserve the original staging error; the bucket may not have been created.
    }
    throw error
  } finally {
    client.destroy()
  }
}
