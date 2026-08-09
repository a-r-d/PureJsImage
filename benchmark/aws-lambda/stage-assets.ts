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
const fixtureFiles = [
  {
    key: 'fixtures/tundra-4000x3000.jpg',
    path: fileURLToPath(new URL('../corpus/files/tundra-4000x3000.jpg', import.meta.url)),
  },
  {
    key: 'fixtures/rgba-gradient-4000x3000.png',
    path: fileURLToPath(new URL('../corpus/files/rgba-gradient-4000x3000.png', import.meta.url)),
  },
] as const

const uploadFile = async (
  client: S3Client,
  bucket: string,
  key: string,
  path: string,
): Promise<number> => {
  const fileStat = await stat(path)
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`Lambda benchmark asset is missing or empty: ${path}`)
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(path),
      ContentLength: fileStat.size,
    }),
  )
  return fileStat.size
}

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
    for (const key of [location.key, ...fixtureFiles.map((fixture) => fixture.key)]) {
      await client.send(new DeleteObjectCommand({ Bucket: location.bucket, Key: key }))
    }
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
  const uploadedKeys: string[] = []
  try {
    await client.send(new CreateBucketCommand({ Bucket: location.bucket }))
    const archiveBytes = await uploadFile(client, location.bucket, location.key, archivePath)
    uploadedKeys.push(location.key)
    let fixtureBytes = 0
    for (const fixture of fixtureFiles) {
      fixtureBytes += await uploadFile(client, location.bucket, fixture.key, fixture.path)
      uploadedKeys.push(fixture.key)
    }
    await writeFile(locationPath, `${JSON.stringify(location, null, 2)}\n`)
    console.log(
      `Staged ${archiveBytes} code bytes and ${fixtureBytes} fixture bytes in s3://${location.bucket}/`,
    )
  } catch (error: unknown) {
    try {
      for (const key of uploadedKeys) {
        await client.send(new DeleteObjectCommand({ Bucket: location.bucket, Key: key }))
      }
      await client.send(new DeleteBucketCommand({ Bucket: location.bucket }))
    } catch {
      // Preserve the original staging error; the bucket may not have been created.
    }
    throw error
  } finally {
    client.destroy()
  }
}
