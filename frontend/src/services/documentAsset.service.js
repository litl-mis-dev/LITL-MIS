import api from './api'

export const getDocumentAssets = () =>
  api.get('/document-assets').then(r => r.data)

export const uploadDocumentAsset = (assetType, file) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post(`/document-assets/${assetType}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

export const deleteDocumentAsset = (assetType) =>
  api.delete(`/document-assets/${assetType}`).then(r => r.data)