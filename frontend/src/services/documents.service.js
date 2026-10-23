import api from './api'

export const fetchDocuments = (search = '') =>
    api.get('/documents', { params: search ? { search } : {} }).then((res) => res.data)

export const fetchShareableOfficers = () =>
    api.get('/documents/officers').then((res) => res.data)

export const createFolder = (name, parentId) =>
    api.post('/documents/folders', { name, parentId }).then((res) => res.data)

export const uploadDocuments = (files, parentId, onUploadProgress) => {
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))
    if (parentId != null) formData.append('parentId', parentId)

    return api
        .post('/documents/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress,
        })
        .then((res) => res.data)
}

export const renameDocument = (id, name) =>
    api.patch(`/documents/${id}`, { name }).then((res) => res.data)

export const updateDocumentAccess = (id, access) =>
    api.put(`/documents/${id}/access`, access).then((res) => res.data)

export const trashDocument = (id) =>
    api.post(`/documents/${id}/trash`).then((res) => res.data)

export const restoreDocument = (id) =>
    api.post(`/documents/${id}/restore`).then((res) => res.data)

export const permanentlyDeleteDocument = (id) =>
    api.delete(`/documents/${id}`).then((res) => res.data)

export const getDocumentDownloadUrl = (id) => `${api.defaults.baseURL}/documents/${id}/download`
export const getDocumentPreviewUrl = (id) => `${api.defaults.baseURL}/documents/${id}/preview`