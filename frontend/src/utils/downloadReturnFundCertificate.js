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

function renderCertificateCanvas(record, assets = {}) {
    const details = record.details ?? {};
    const { canvas, context } = createCertificateCanvas(assets, {
        documentLabel: "Return Fund Acknowledgement",
        issueNo: record.id,
    });

    context.fillStyle = "#111827";
    context.font = "700 24px Arial";
    drawCenteredText(context, "RETURN FUND ACKNOWLEDGEMENT FORM", 0, 395, CANVAS_WIDTH);

    drawDocumentMeta(context, record);

    const bodyText =
        `This is to certify that ${getValue(details.receivedFrom)} has returned the total amount of ` +
        `${getValue(details.amount)} as ${getValue(details.fund ?? details.purposeOfFund)} for/in ${getValue(details.activity ?? details.titleOfActivities)}, ` +
        `sourced from ${getValue(details.sourceOfFund ?? details.sourceOfFundName)}.`;

    const nextY = Math.max(drawCertificateBody(context, bodyText), 840);

    context.strokeStyle = "#111827";
    context.fillStyle = "#111827";
    const { contentLeft, contentRight } = getCertificateContentLayout(context);
    const signatureWidth = 390;
    const leftSignatureX = contentLeft;
    const rightSignatureX = contentRight - signatureWidth;

    drawSignatureBlock(
        context,
        "REFUNDED BY:",
        details.refundedByName ?? details.refundedBy,
        details.refundedByPosition,
        leftSignatureX,
        nextY,
        signatureWidth
    );
    drawSignatureBlock(
        context,
        "RECEIVED BY:",
        details.receivedByName ?? details.receivedBy,
        details.receivedByPosition,
        leftSignatureX,
        nextY + 250,
        signatureWidth
    );
    drawSignatureBlock(
        context,
        "AUDITED BY:",
        details.auditedByName ?? details.auditedBy,
        details.auditedByPosition,
        rightSignatureX,
        nextY,
        signatureWidth
    );
    drawSignatureBlock(
        context,
        "APPROVED BY:",
        details.approvedByName ?? details.approvedBy,
        details.approvedByPosition,
        rightSignatureX,
        nextY + 250,
        signatureWidth
    );

    return canvas;
}

export async function downloadReturnFundCertificate(record) {
    const filename = `${record.id ?? "return-fund"}-certificate.pdf`;
    const assets = await loadActiveDocumentAssets();

    downloadCanvasAsPdf(renderCertificateCanvas(record, assets), filename);
}