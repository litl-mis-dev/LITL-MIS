const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3')
const { getSignedUrl: presign } = require('@aws-sdk/s3-request-presigner')

// Cloudflare R2 speaks the S3 API; the endpoint is per Cloudflare account.
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const BUCKET = process.env.R2_BUCKET

// Public base URL of the bucket (its r2.dev URL or a custom domain such as
// https://files.example.com). Objects under it are readable by anyone.
const PUBLIC_BASE_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

const toPublicUrl = (storagePath) =>
  `${PUBLIC_BASE_URL}/${storagePath.split('/').map(encodeURIComponent).join('/')}`

const uploadFile = async (storagePath, buffer, mimeType) => {
  try {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: storagePath,
      Body: buffer,
      ContentType: mimeType,
    }))
  } catch (err) {
    throw new Error(`R2 upload failed: ${err.message}`)
  }

  return { path: storagePath, publicUrl: toPublicUrl(storagePath) }
}

const deleteFile = async (storagePath) => {
  if (!storagePath) return
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storagePath }))
  } catch (err) {
    console.error(`[Storage] deleteFile warning (${storagePath}): ${err.message}`)
  }
}

const deleteFiles = async (storagePaths) => {
  const paths = (storagePaths ?? []).filter(Boolean)
  if (paths.length === 0) return
  // DeleteObjects accepts at most 1000 keys per request.
  for (let i = 0; i < paths.length; i += 1000) {
    const batch = paths.slice(i, i + 1000)
    try {
      const { Errors } = await r2.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }))
      if (Errors?.length) console.error(`[Storage] deleteFiles warning: ${Errors.length} object(s) not deleted`)
    } catch (err) {
      console.error(`[Storage] deleteFiles warning: ${err.message}`)
    }
  }
}

// options.download: when set, the browser saves the file under that name
// instead of opening it (same option the Supabase client accepted).
const getSignedUrl = async (storagePath, expiresIn = 300, options = {}) => {
  const params = { Bucket: BUCKET, Key: storagePath }
  if (options.download) {
    const fileName = typeof options.download === 'string' ? options.download : storagePath.split('/').pop()
    params.ResponseContentDisposition =
      `attachment; filename="${fileName.replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  }
  try {
    return await presign(r2, new GetObjectCommand(params), { expiresIn })
  } catch (err) {
    throw new Error(`R2 signed URL failed: ${err.message}`)
  }
}

// Reads a file back out of R2 as a Buffer — used where the actual bytes need
// to be re-hashed or re-served (e.g. certificate integrity checks, zipped
// bulk downloads).
const downloadFile = async (storagePath) => {
  try {
    const { Body } = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: storagePath }))
    return Buffer.from(await Body.transformToByteArray())
  } catch (err) {
    throw new Error(`R2 download failed: ${err.message}`)
  }
}

module.exports = { uploadFile, deleteFile, deleteFiles, getSignedUrl, downloadFile }
