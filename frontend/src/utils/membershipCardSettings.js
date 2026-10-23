import { ensureImageGroup } from "./membershipCertificateSettings.js";

export const MEMBERSHIP_CARD_SETTINGS_KEY = "litl-membership-card-settings";

export const DEFAULT_MEMBERSHIP_CARD_SETTINGS = {
    frontTemplateImage: { images: [], activeImageId: null },
    backTemplateImage: { images: [], activeImageId: null },
};

export function normalizeMembershipCardSettings(settings) {
    const legacyTemplateImage = settings?.templateImage;

    return {
        ...DEFAULT_MEMBERSHIP_CARD_SETTINGS,
        ...settings,
        frontTemplateImage: ensureImageGroup(settings?.frontTemplateImage ?? legacyTemplateImage),
        backTemplateImage: ensureImageGroup(settings?.backTemplateImage),
    };
}

export function getActiveMembershipCardTemplate(settings, side = "front") {
    const key = side === "back" ? "backTemplateImage" : "frontTemplateImage";
    const group = ensureImageGroup(settings?.[key]);

    return group.images.find((image) => image.id === group.activeImageId) ?? group.images[0] ?? null;
}

export function readMembershipCardSettings() {
    try {
        const settings = JSON.parse(localStorage.getItem(MEMBERSHIP_CARD_SETTINGS_KEY) || "{}");

        return normalizeMembershipCardSettings(settings);
    } catch {
        return DEFAULT_MEMBERSHIP_CARD_SETTINGS;
    }
}
