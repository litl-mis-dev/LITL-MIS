-- Additive only: no existing row is changed. Returns recorded by hand keep
-- autoForDisbursementId NULL; existing events keep their typed budget.

-- AlterTable
ALTER TABLE `ReturnFund` ADD COLUMN `autoForDisbursementId` INTEGER NULL,
    ADD COLUMN `revisedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Event` ADD COLUMN `disbursementId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Notification` MODIFY `type` ENUM('REGISTRATION_APPROVED', 'REGISTRATION_REJECTED', 'EVENT_CREATED', 'EVENT_STATUS_CHANGED', 'EVENT_UPDATED', 'MEMBER_APPROVAL_REQUEST', 'ANNOUNCEMENT', 'AUDIT_STATUS_CHANGED', 'PAYMENT_REMINDER', 'EVENT_REMINDER') NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `ReturnFund_autoForDisbursementId_key` ON `ReturnFund`(`autoForDisbursementId`);

-- CreateIndex
CREATE UNIQUE INDEX `Event_disbursementId_key` ON `Event`(`disbursementId`);

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_disbursementId_fkey` FOREIGN KEY (`disbursementId`) REFERENCES `Disbursement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
