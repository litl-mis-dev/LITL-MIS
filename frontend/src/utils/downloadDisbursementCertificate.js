import {
    CANVAS_WIDTH,
    createCertificateCanvas,
    drawCertificateBody,
    downloadCanvasAsPdf,
    drawCenteredText,
    drawDocumentMeta,
    drawSignatureBlock,
    getCertificateContentLayout,
    getValue,
    loadActiveDocumentAssets,
} from "./certificatePdf";

function getDisbursementCertificateData(record) {
    const details = record.details ?? {};

    return {
        name: details.name ?? record.recipient,
        amount: details.amount ?? record.amount,
        fund: details.fund ?? details.purposeOfFund ?? record.purpose,
        activity: details.activity ?? details.titleOfActivities ?? record.titleOfActivities,
        sourceOfFund: details.sourceOfFund ?? details.sourceOfFundName ?? record.sourceOfFund,
        disbursedByName: details.disbursedByName ?? details.disbursedBy,
        disbursedByPosition: details.disbursedByPosition,
        approvedByName: details.approvedByName ?? details.approvedBy,
        approvedByPosition: details.approvedByPosition,
        receivedByName: details.receivedByName ?? details.receivedBy,
        receivedByPosition: details.receivedByPosition,
    };
}

function renderCertificateCanvas(record, assets = {}) {
    const certificate = getDisbursementCertificateData(record);
    const { canvas, context } = createCertificateCanvas(assets, {
        documentLabel: "Cash Acknowledgement Receipt",
        issueNo: record.id,
        frameMargins: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
        },
    });

    context.fillStyle = "#111827";
    context.font = "700 24px Arial";
    drawCenteredText(context, "CASH ACKNOWLEDGEMENT RECEIPT FORM", 0, 395, CANVAS_WIDTH);

    drawDocumentMeta(context, record);

    const bodyText =
        `This is to certify that ${getValue(certificate.name)} has received the total amount of ` +
        `${getValue(certificate.amount)} as ${getValue(certificate.fund)} for/in ${getValue(certificate.activity)}, ` +
        `sourced from ${getValue(certificate.sourceOfFund)}.`;

    const nextY = Math.max(drawCertificateBody(context, bodyText), 840);

    context.strokeStyle = "#111827";
    context.fillStyle = "#111827";
    const { contentLeft, contentRight } = getCertificateContentLayout(context);
    const signatureWidth = 390;
    const leftSignatureX = contentLeft;
    const rightSignatureX = contentRight - signatureWidth;

    drawSignatureBlock(
        context,
        "DISBURSED BY:",
        certificate.disbursedByName,
        certificate.disbursedByPosition,
        leftSignatureX,
        nextY,
        signatureWidth
    );
    drawSignatureBlock(
        context,
        "APPROVED BY:",
        certificate.approvedByName,
        certificate.approvedByPosition,
        rightSignatureX,
        nextY,
        signatureWidth
    );
    drawSignatureBlock(
        context,
        "RECEIVED BY:",
        certificate.receivedByName,
        certificate.receivedByPosition,
        leftSignatureX,
        nextY + 250,
        signatureWidth
    );

    return canvas;
}

export async function downloadDisbursementCertificate(record) {
    const filename = `${record.id ?? "disbursement"}-certificate.pdf`;
    const assets = await loadActiveDocumentAssets();

    downloadCanvasAsPdf(renderCertificateCanvas(record, assets), filename);
}
