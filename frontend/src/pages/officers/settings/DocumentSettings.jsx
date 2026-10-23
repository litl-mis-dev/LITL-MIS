import { useEffect, useRef, useState } from 'react'
import {
    deleteDocumentAsset,
    getDocumentAssets,
    uploadDocumentAsset,
} from '../../../services/documentAsset.service.js'
import { useRole } from '../../../utils/useRole.js'

const MAX_SIZE_MB    = 5
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

function formatFileSize(size = 0) {
    if (size < 1024)         return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatUploadDate(value) {
    return new Intl.DateTimeFormat('en-PH', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
    }).format(new Date(value))
}

export default function DocumentSettings() {
    const { can } = useRole()
    const canEdit = can('SETTINGS_DESIGN', 'EDIT')
    const [asset,   setAsset]   = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => { loadAsset() }, [])

    async function loadAsset() {
        setLoading(true)
        try {
            const data = await getDocumentAssets()
            setAsset(data.assets?.disbursementTemplate ?? null)
        } catch {
            // show empty state
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return <p className='settings-upload__empty'>Loading template…</p>
    }

    return (
        <div className='settings-document-form'>
            <AssetSection
                assetType='disbursementTemplate'
                title='Disbursement & Return Fund Template'
                description='Upload a full A4 portrait template image. Used as the background for both Disbursement and Return Fund documents.'
                inputId='disbursement-template-upload'
                asset={asset}
                onUploaded={setAsset}
                onDeleted={() => setAsset(null)}
                canEdit={canEdit}
            />
        </div>
    )
}

function AssetSection({ assetType, title, description, inputId, asset, onUploaded, onDeleted, canEdit }) {
    const inputRef = useRef(null)
    const [uploading,  setUploading]  = useState(false)
    const [removing,   setRemoving]   = useState(false)
    const [error,      setError]      = useState('')
    const [success,    setSuccess]    = useState('')
    const [isDragging, setIsDragging] = useState(false)

    const isBusy = uploading || removing

    async function handleFile(file) {
        if (!canEdit) return
        if (!file) return
        setError(''); setSuccess('')
        if (!file.type.startsWith('image/')) { setError('Please upload an image file (JPG, PNG, GIF, WebP).'); return }
        if (file.size > MAX_SIZE_BYTES) { setError(`Image must be less than ${MAX_SIZE_MB}MB.`); return }
        setUploading(true)
        try {
            const data = await uploadDocumentAsset(assetType, file)
            onUploaded(data.asset)
            setSuccess('Template uploaded and saved.')
            setTimeout(() => setSuccess(''), 3000)
        } catch (err) {
            setError(err.response?.data?.message ?? 'Upload failed. Please try again.')
        } finally {
            setUploading(false)
            if (inputRef.current) inputRef.current.value = ''
        }
    }

    async function handleRemove() {
        if (!canEdit) return
        setError(''); setSuccess('')
        setRemoving(true)
        try {
            await deleteDocumentAsset(assetType)
            onDeleted()
            setSuccess('Template removed.')
            setTimeout(() => setSuccess(''), 3000)
        } catch (err) {
            setError(err.response?.data?.message ?? 'Failed to remove. Please try again.')
        } finally {
            setRemoving(false)
        }
    }

    return (
        <div className='settings-section-block'>
            <div className='settings-upload'>
                {canEdit ? (
                <label
                    htmlFor={inputId}
                    className={[
                        'settings-upload__dropzone',
                        isDragging ? 'settings-upload__dropzone--dragging' : '',
                        isBusy     ? 'settings-upload__dropzone--disabled'  : '',
                    ].join(' ')}
                    onDragOver={(e) => { e.preventDefault(); if (!isBusy) setIsDragging(true) }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (!isBusy) handleFile(e.dataTransfer.files?.[0]) }}
                >
                    <input
                        ref={inputRef}
                        id={inputId}
                        type='file'
                        accept='image/*'
                        disabled={isBusy}
                        onChange={(e) => handleFile(e.target.files?.[0])}
                    />
                    <span className='settings-upload__icon' aria-hidden='true'>
                        <svg xmlns='http://www.w3.org/2000/svg' height='24px' viewBox='0 -960 960 960' width='24px' fill='currentColor'>
                            <path d='M440-320v-326L336-542l-56-58 200-200 200 200-56 58-104-104v326h-80ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z' />
                        </svg>
                    </span>
                    <span className='settings-upload__title'>{title}</span>
                    <span className='settings-upload__description'>{description}</span>
                    {!isBusy && (
                        <span className='btn btn--outline btn--sm settings-upload__button'>
                            {asset ? 'Replace Template' : 'Choose Image'}
                        </span>
                    )}
                    {uploading && <span className='settings-upload__title'>Uploading…</span>}
                </label>
                ) : (
                <div className='settings-upload__dropzone settings-upload__dropzone--disabled'>
                    <span className='settings-upload__title'>{title}</span>
                    <span className='settings-upload__description'>{description}</span>
                    <span className='settings-upload__empty'>View only — you don&apos;t have permission to change this template.</span>
                </div>
                )}

                {error   && <p className='settings-upload__error'>{error}</p>}
                {success && <p className='settings-upload__success'>{success}</p>}

                {asset ? (
                    <div className='settings-upload__stack'>
                        <p className='settings-upload__stack-title'>Currently active</p>
                        <div className='settings-upload__preview settings-upload__preview--active'>
                            <img src={asset.url} alt={`${title} preview`} onError={(e) => { e.target.style.display = 'none' }} />
                            <div className='settings-upload__meta'>
                                <p>{asset.fileName}</p>
                                <span>{formatFileSize(asset.fileSize)}</span>
                                {asset.updatedAt && <span>{formatUploadDate(asset.updatedAt)}</span>}
                            </div>
                            <div className='settings-upload__preview-actions'>
                                <span className='settings-upload__active-badge'>Active</span>
                                {canEdit && (
                                    <button type='button' className='btn btn--outline btn--sm' onClick={handleRemove} disabled={isBusy}>
                                        {removing ? 'Removing…' : 'Remove'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <p className='settings-upload__empty'>No custom template uploaded. The default design will be used.</p>
                )}
            </div>
        </div>
    )
}