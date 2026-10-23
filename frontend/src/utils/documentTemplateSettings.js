// Same pattern as membershipCertificateSettings.js
// Stores the Disbursement & Return Fund A4 template in localStorage.

export const DOCUMENT_TEMPLATE_SETTINGS_KEY = 'litl-disbursement-template-settings'

export const DEFAULT_DOCUMENT_TEMPLATE_SETTINGS = {
  templateImage: { images: [], activeImageId: null },
}

export function ensureDocumentImageGroup(value) {
  if (value?.images && Array.isArray(value.images)) {
    return {
      images: value.images,
      activeImageId: value.activeImageId ?? value.images[0]?.id ?? null,
    }
  }
  if (value?.dataUrl) {
    const migrated = {
      id:         value.id ?? `${Date.now()}-${value.name ?? 'template'}`,
      name:       value.name ?? 'Uploaded template',
      type:       value.type ?? 'image/*',
      size:       value.size ?? 0,
      dataUrl:    value.dataUrl,
      uploadedAt: value.uploadedAt ?? new Date().toISOString(),
    }
    return { images: [migrated], activeImageId: migrated.id }
  }
  return { images: [], activeImageId: null }
}

export function normalizeDocumentTemplateSettings(settings) {
  return {
    ...DEFAULT_DOCUMENT_TEMPLATE_SETTINGS,
    ...settings,
    templateImage: ensureDocumentImageGroup(settings?.templateImage),
  }
}

export function getActiveDocumentTemplate(settings) {
  const group = ensureDocumentImageGroup(settings?.templateImage)
  return group.images.find((img) => img.id === group.activeImageId) ?? group.images[0] ?? null
}

export function readDocumentTemplateSettings() {
  try {
    const raw = localStorage.getItem(DOCUMENT_TEMPLATE_SETTINGS_KEY) || '{}'
    return normalizeDocumentTemplateSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_DOCUMENT_TEMPLATE_SETTINGS
  }
}