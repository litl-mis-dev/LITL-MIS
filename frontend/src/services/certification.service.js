import api from './api'

export const getCertificationTree = () =>
  api.get('/certification/tree').then(r => r.data)

export const getEventCertificationFolder = (eventId) =>
  api.get(`/certification/events/${eventId}`).then(r => r.data)

export const issueCertificate = (eventId, files, onUploadProgress) => {
  const formData = new FormData()
  const fileList = Array.isArray(files) || files instanceof FileList ? Array.from(files) : [files]
  fileList.forEach((file) => formData.append('certificates', file))
  return api.post(`/certification/events/${eventId}/certificates`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  }).then(r => r.data)
}

export const revokeCertificate = (certificateId, reason) =>
  api.post(`/certification/certificates/${certificateId}/revoke`, { reason }).then(r => r.data)

// Downloads a file as a blob (reporting progress via onDownloadProgress) and
// saves it through a temporary object URL — lets the UI show a real
// percentage instead of handing off to a plain <a href> the browser controls.
function saveBlob(blob, fallbackFileName) {
  const disposition = blob.__contentDisposition || '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const fileName = match?.[1] || fallbackFileName;

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export const downloadCertificateFile = async (certificateId, fallbackFileName, onDownloadProgress) => {
  const response = await api.get(`/certification/certificates/${certificateId}/download`, {
    responseType: 'blob',
    onDownloadProgress,
  });
  response.data.__contentDisposition = response.headers['content-disposition'];
  saveBlob(response.data, fallbackFileName);
};

export const downloadEventCertificatesZipFile = async (eventId, fallbackFileName, onDownloadProgress) => {
  const response = await api.get(`/certification/events/${eventId}/certificates/download`, {
    responseType: 'blob',
    onDownloadProgress,
  });
  response.data.__contentDisposition = response.headers['content-disposition'];
  saveBlob(response.data, fallbackFileName);
};

// Public — no auth required.
export const verifyCertificate = (publicId) =>
  api.get(`/certification/verify/${encodeURIComponent(publicId)}`).then(r => r.data)