export const MEMBERSHIP_CERTIFICATE_SETTINGS_KEY = "litl-membership-certificate-settings";

export const DEFAULT_MEMBERSHIP_CERTIFICATE_SETTINGS = {
    templateImage: { images: [], activeImageId: null },
};

export function ensureImageGroup(value) {
    if (value?.images && Array.isArray(value.images)) {
        return {
            images: value.images,
            activeImageId: value.activeImageId ?? value.images[0]?.id ?? null,
        };
    }

    if (value?.dataUrl) {
        const migratedImage = {
            id: value.id ?? `${Date.now()}-${value.name ?? "uploaded-template"}`,
            name: value.name ?? "Uploaded template",
            type: value.type ?? "image/*",
            size: value.size ?? 0,
            dataUrl: value.dataUrl,
            uploadedAt: value.uploadedAt ?? new Date().toISOString(),
        };

        return {
            images: [migratedImage],
            activeImageId: migratedImage.id,
        };
    }

    return { images: [], activeImageId: null };
}

export function normalizeMembershipCertificateSettings(settings) {
    return {
        ...DEFAULT_MEMBERSHIP_CERTIFICATE_SETTINGS,
        ...settings,
        templateImage: ensureImageGroup(settings?.templateImage),
    };
}

export function getActiveMembershipCertificateTemplate(settings) {
    const group = ensureImageGroup(settings?.templateImage);

    return group.images.find((image) => image.id === group.activeImageId) ?? group.images[0] ?? null;
}

export function readMembershipCertificateSettings() {
    try {
        const settings = JSON.parse(localStorage.getItem(MEMBERSHIP_CERTIFICATE_SETTINGS_KEY) || "{}");

        return normalizeMembershipCertificateSettings(settings);
    } catch {
        return DEFAULT_MEMBERSHIP_CERTIFICATE_SETTINGS;
    }
}
