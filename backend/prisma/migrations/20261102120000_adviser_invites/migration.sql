-- AlterTable
ALTER TABLE `User` ADD COLUMN `adviserTitle` ENUM('ADVISER', 'DEPT_CHAIR') NULL,
    MODIFY `studentNumber` VARCHAR(191) NULL,
    MODIFY `status` ENUM('PENDING_EMAIL_VERIFICATION', 'PENDING_OFFICER_APPROVAL', 'APPROVED', 'REJECTED', 'DEACTIVATED') NOT NULL DEFAULT 'PENDING_OFFICER_APPROVAL';

-- AlterTable
ALTER TABLE `Member` MODIFY `yearLevel` VARCHAR(191) NULL,
    MODIFY `section` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `AdviserInvite` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `suffix` VARCHAR(191) NULL,
    `title` ENUM('ADVISER', 'DEPT_CHAIR') NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `invitedById` INTEGER NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `acceptedUserId` INTEGER NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdviserInvite_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `AdviserInvite_acceptedUserId_key`(`acceptedUserId`),
    INDEX `AdviserInvite_email_idx`(`email`),
    INDEX `AdviserInvite_title_idx`(`title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AdviserInvite` ADD CONSTRAINT `AdviserInvite_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdviserInvite` ADD CONSTRAINT `AdviserInvite_acceptedUserId_fkey` FOREIGN KEY (`acceptedUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

