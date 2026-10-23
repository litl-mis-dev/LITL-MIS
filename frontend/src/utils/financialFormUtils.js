export const sourceOptions = [
    "Membership Fees",
    "Organization Budget",
    "Donation",
    "Fundraising",
    "Sponsorship",
];

export const emptyDisbursementForm = {
    name: "",
    amount: "",
    fund: "",
    activity: "",
    sourceOfFund: "",
    disbursedByName: "",
    disbursedByPosition: "Senator for Finance",
    approvedByName: "",
    approvedByPosition: "President",
    receivedByName: "",
    receivedByPosition: "",
};

export const emptyReturnFundForm = {
    receivedFrom: "",
    amount: "",
    fund: "",
    activity: "",
    sourceOfFund: "",
    refundedByName: "",
    refundedByPosition: "",
    receivedByName: "",
    receivedByPosition: "Senator for Finance",
    auditedByName: "",
    auditedByPosition: "Senator for Audit",
    approvedByName: "",
    approvedByPosition: "President",
};

export function formatPesoAmount(value) {
    const digits = value.replace(/\D/g, "");

    if (!digits) {
        return "";
    }

    const amount = Number(digits) / 100;
    return `₱${amount.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}
