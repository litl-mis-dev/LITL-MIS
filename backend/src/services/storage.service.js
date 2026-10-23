const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET

const uploadFile = async (storagePath, buffer, mimeType) => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: true })

  if (error) throw new Error(`Supabase upload failed: ${error.message}`)

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
  return { path: data.path, publicUrl: urlData.publicUrl }
}

const deleteFile = async (storagePath) => {
  if (!storagePath) return
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath])
  if (error) console.error(`[Storage] deleteFile warning (${storagePath}): ${error.message}`)
}

const deleteFiles = async (storagePaths) => {
  const paths = (storagePaths ?? []).filter(Boolean)
  if (paths.length === 0) return
  const { error } = await supabase.storage.from(BUCKET).remove(paths)
  if (error) console.error(`[Storage] deleteFiles warning: ${error.message}`)
}

const getSignedUrl = async (storagePath, expiresIn = 300, options = {}) => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn, options)
  if (error) throw new Error(`Supabase signed URL failed: ${error.message}`)
  return data.signedUrl
}

// Reads a file back out of Supabase Storage as a Buffer — used where the
// actual bytes need to be re-hashed or re-served (e.g. certificate integrity
// checks, zipped bulk downloads).
const downloadFile = async (storagePath) => {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error) throw new Error(`Supabase download failed: ${error.message}`)
  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

module.exports = { uploadFile, deleteFile, deleteFiles, getSignedUrl, downloadFile }