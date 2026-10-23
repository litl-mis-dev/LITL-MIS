export const DOCUMENT_SETTINGS_STORAGE_KEY = 'litl-officer-document-settings'

export const DEFAULT_DOCUMENT_SETTINGS = {
  headerImage: { images: [], activeImageId: null },
  footerImage: { images: [], activeImageId: null },
}

// Two sections — one per settings tab.
// Each section maps to exactly one Supabase asset type.
export const documentSections = {
  disbursement: {
    assetType:   'disbursementTemplate',
    inputId:     'disbursement-template-upload',
    title:       'Disbursement & Return Fund Template',
    description: 'Upload a full A4 portrait template image. Used as the background for both Disbursement and Return Fund documents. Dynamic content is printed on top.',
  },
  certificate: {
    assetType:   'memberCertificate',
    inputId:     'certificate-template-upload',
    title:       'Member Certificate Template',
    description: 'Upload a full A4 portrait template image used as the background when generating Member Certificates.',
  },
}

export const SEMESTER_LABELS = { FIRST: '1st Semester', SECOND: '2nd Semester' }
export const CONFIRM_KEYWORD = 'ACTIVATE'