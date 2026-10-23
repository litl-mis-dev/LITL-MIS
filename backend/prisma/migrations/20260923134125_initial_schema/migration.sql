-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `studentNumber` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `emailType` ENUM('CVSU', 'PERSONAL') NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `role` ENUM('PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN', 'SECRETARY', 'SEN_INTERNAL_AFFAIRS', 'SEN_EXTERNAL_AFFAIRS', 'SEN_FINANCE', 'SEN_AUDIT', 'SEN_BUSINESS_AFFAIRS', 'SEN_LOGISTICS_PROPERTIES', 'SEN_PUBLICITY_INFORMATION', 'SEN_ACADEMIC_AFFAIRS', 'SEN_RULES_CONSTITUTIONAL_AMENDMENTS', 'SEN_SPORTS_ARTS_CULTURE', 'SEN_STUDENT_RIGHTS_WELFARE', 'YEAR_REP_1', 'YEAR_REP_2', 'YEAR_REP_3', 'YEAR_REP_4', 'ADVISER_DEPT_CHAIR', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `status` ENUM('PENDING_EMAIL_VERIFICATION', 'PENDING_OFFICER_APPROVAL', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING_OFFICER_APPROVAL',
    `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_studentNumber_key`(`studentNumber`),
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Member` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `middleName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `suffix` VARCHAR(191) NULL,
    `sex` ENUM('MALE', 'FEMALE', 'PREFER_NOT_TO_SAY') NOT NULL,
    `yearLevel` VARCHAR(191) NOT NULL,
    `section` VARCHAR(191) NOT NULL,
    `avatar` VARCHAR(191) NULL,
    `avatarPath` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'GRADUATED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `qrCode` LONGTEXT NULL,

    UNIQUE INDEX `Member_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Otp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `purpose` ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET') NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Otp_userId_purpose_used_idx`(`userId`, `purpose`, `used`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PendingRegistration` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `middleName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `suffix` VARCHAR(191) NULL,
    `sex` ENUM('MALE', 'FEMALE', 'PREFER_NOT_TO_SAY') NOT NULL,
    `studentNumber` VARCHAR(191) NOT NULL,
    `yearLevel` VARCHAR(191) NOT NULL,
    `section` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `emailType` ENUM('CVSU', 'PERSONAL') NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `otpCodeHash` VARCHAR(191) NOT NULL,
    `otpExpiresAt` DATETIME(3) NOT NULL,
    `otpAttempts` INTEGER NOT NULL DEFAULT 0,
    `lastOtpSentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PendingRegistration_token_key`(`token`),
    UNIQUE INDEX `PendingRegistration_studentNumber_key`(`studentNumber`),
    UNIQUE INDEX `PendingRegistration_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OfficerAssignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `memberId` INTEGER NOT NULL,
    `role` ENUM('PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN', 'SECRETARY', 'SEN_INTERNAL_AFFAIRS', 'SEN_EXTERNAL_AFFAIRS', 'SEN_FINANCE', 'SEN_AUDIT', 'SEN_BUSINESS_AFFAIRS', 'SEN_LOGISTICS_PROPERTIES', 'SEN_PUBLICITY_INFORMATION', 'SEN_ACADEMIC_AFFAIRS', 'SEN_RULES_CONSTITUTIONAL_AMENDMENTS', 'SEN_SPORTS_ARTS_CULTURE', 'SEN_STUDENT_RIGHTS_WELFARE', 'YEAR_REP_1', 'YEAR_REP_2', 'YEAR_REP_3', 'YEAR_REP_4', 'ADVISER_DEPT_CHAIR', 'MEMBER') NOT NULL,
    `activeRole` ENUM('PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN', 'SECRETARY', 'SEN_INTERNAL_AFFAIRS', 'SEN_EXTERNAL_AFFAIRS', 'SEN_FINANCE', 'SEN_AUDIT', 'SEN_BUSINESS_AFFAIRS', 'SEN_LOGISTICS_PROPERTIES', 'SEN_PUBLICITY_INFORMATION', 'SEN_ACADEMIC_AFFAIRS', 'SEN_RULES_CONSTITUTIONAL_AMENDMENTS', 'SEN_SPORTS_ARTS_CULTURE', 'SEN_STUDENT_RIGHTS_WELFARE', 'YEAR_REP_1', 'YEAR_REP_2', 'YEAR_REP_3', 'YEAR_REP_4', 'ADVISER_DEPT_CHAIR', 'MEMBER') NULL,
    `startDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endDate` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
    `assignedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OfficerAssignment_memberId_idx`(`memberId`),
    INDEX `OfficerAssignment_role_idx`(`role`),
    INDEX `OfficerAssignment_status_idx`(`status`),
    UNIQUE INDEX `OfficerAssignment_activeRole_key`(`activeRole`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `role` ENUM('PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN', 'SECRETARY', 'SEN_INTERNAL_AFFAIRS', 'SEN_EXTERNAL_AFFAIRS', 'SEN_FINANCE', 'SEN_AUDIT', 'SEN_BUSINESS_AFFAIRS', 'SEN_LOGISTICS_PROPERTIES', 'SEN_PUBLICITY_INFORMATION', 'SEN_ACADEMIC_AFFAIRS', 'SEN_RULES_CONSTITUTIONAL_AMENDMENTS', 'SEN_SPORTS_ARTS_CULTURE', 'SEN_STUDENT_RIGHTS_WELFARE', 'YEAR_REP_1', 'YEAR_REP_2', 'YEAR_REP_3', 'YEAR_REP_4', 'ADVISER_DEPT_CHAIR', 'MEMBER') NOT NULL,
    `module` ENUM('DASHBOARD', 'MEMBER_LIST', 'MEMBERS_APPROVAL', 'AUDIT', 'HASH_CHAIN', 'EVENT', 'DOCUMENTS', 'CERTIFICATION', 'FINANCIAL', 'ACTIVITY_LOGS', 'SETTINGS_ROLES', 'SETTINGS_DESIGN') NOT NULL,
    `level` ENUM('NONE', 'VIEW', 'EDIT') NOT NULL DEFAULT 'NONE',
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RolePermission_role_idx`(`role`),
    UNIQUE INDEX `RolePermission_role_module_key`(`role`, `module`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorId` INTEGER NULL,
    `targetUserId` INTEGER NULL,
    `action` VARCHAR(191) NOT NULL,
    `details` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `hash` CHAR(64) NULL,
    `previousHash` CHAR(64) NULL,

    INDEX `AuditLog_actorId_idx`(`actorId`),
    INDEX `AuditLog_targetUserId_idx`(`targetUserId`),
    INDEX `AuditLog_action_idx`(`action`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Semester` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolYear` VARCHAR(191) NOT NULL,
    `semester` ENUM('FIRST', 'SECOND') NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `hasBeenActivated` BOOLEAN NOT NULL DEFAULT false,
    `beginningBalance` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `endingBalance` DECIMAL(10, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Semester_schoolYear_semester_key`(`schoolYear`, `semester`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `memberId` INTEGER NOT NULL,
    `semesterId` INTEGER NOT NULL,
    `obligationSemesterId` INTEGER NULL,
    `amount` DECIMAL(10, 2) NOT NULL DEFAULT 100.00,
    `paidAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recordedById` INTEGER NOT NULL,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Payment_memberId_semesterId_idx`(`memberId`, `semesterId`),
    INDEX `Payment_memberId_obligationSemesterId_idx`(`memberId`, `obligationSemesterId`),
    INDEX `Payment_semesterId_idx`(`semesterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FundCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `percentage` DECIMAL(5, 2) NOT NULL,
    `semesterId` INTEGER NOT NULL,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `isTurnoverFund` BOOLEAN NOT NULL DEFAULT false,
    `fixedAllocationAmount` DECIMAL(10, 2) NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FundCategory_semesterId_idx`(`semesterId`),
    UNIQUE INDEX `FundCategory_name_semesterId_key`(`name`, `semesterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Disbursement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `purposeOfFund` TEXT NOT NULL,
    `titleOfActivities` VARCHAR(191) NOT NULL,
    `fundCategoryId` INTEGER NOT NULL,
    `semesterId` INTEGER NOT NULL,
    `disbursedBy` VARCHAR(191) NOT NULL,
    `disbursedByPosition` VARCHAR(191) NOT NULL,
    `approvedBy` VARCHAR(191) NOT NULL,
    `approvedByPosition` VARCHAR(191) NOT NULL,
    `receivedBy` VARCHAR(191) NOT NULL,
    `receivedByPosition` VARCHAR(191) NOT NULL,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Disbursement_reference_key`(`reference`),
    INDEX `Disbursement_fundCategoryId_idx`(`fundCategoryId`),
    INDEX `Disbursement_semesterId_idx`(`semesterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnFund` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(191) NOT NULL,
    `receivedFrom` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `disbursementId` INTEGER NOT NULL,
    `refundedBy` VARCHAR(191) NOT NULL,
    `refundedByPosition` VARCHAR(191) NOT NULL,
    `receivedBy` VARCHAR(191) NOT NULL,
    `receivedByPosition` VARCHAR(191) NOT NULL,
    `auditedBy` VARCHAR(191) NOT NULL,
    `auditedByPosition` VARCHAR(191) NOT NULL,
    `approvedBy` VARCHAR(191) NOT NULL,
    `approvedByPosition` VARCHAR(191) NOT NULL,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `semesterId` INTEGER NOT NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReturnFund_reference_key`(`reference`),
    INDEX `ReturnFund_disbursementId_idx`(`disbursementId`),
    INDEX `ReturnFund_semesterId_idx`(`semesterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Audit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `disbursementId` INTEGER NULL,
    `returnFundId` INTEGER NULL,
    `status` ENUM('PENDING', 'REVIEW', 'FOR_CLARIFICATION', 'CLEARED') NOT NULL DEFAULT 'PENDING',
    `remarks` TEXT NULL,
    `reviewedById` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Audit_disbursementId_key`(`disbursementId`),
    UNIQUE INDEX `Audit_returnFundId_key`(`returnFundId`),
    INDEX `Audit_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `time` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `proponent` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('COMING_SOON', 'OPEN', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'COMING_SOON',
    `access` TEXT NOT NULL,
    `hasGoogleForm` BOOLEAN NOT NULL DEFAULT false,
    `googleFormUrl` VARCHAR(191) NULL,
    `createdById` INTEGER NOT NULL,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Event_status_idx`(`status`),
    INDEX `Event_date_idx`(`date`),
    INDEX `Event_isArchived_idx`(`isArchived`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventAttendance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` INTEGER NOT NULL,
    `qrCode` VARCHAR(191) NOT NULL,
    `checkedInAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EventAttendance_eventId_idx`(`eventId`),
    UNIQUE INDEX `EventAttendance_eventId_qrCode_key`(`eventId`, `qrCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PendingEmailChange` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `newEmail` VARCHAR(191) NOT NULL,
    `otpCodeHash` VARCHAR(191) NOT NULL,
    `otpExpiresAt` DATETIME(3) NOT NULL,
    `otpAttempts` INTEGER NOT NULL DEFAULT 0,
    `lastOtpSentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PendingEmailChange_token_key`(`token`),
    UNIQUE INDEX `PendingEmailChange_userId_key`(`userId`),
    INDEX `PendingEmailChange_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('FOLDER', 'FILE') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `parentId` INTEGER NULL,
    `previousParentId` INTEGER NULL,
    `ownerId` INTEGER NOT NULL,
    `storagePath` TEXT NULL,
    `publicUrl` TEXT NULL,
    `originalFileName` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NULL,
    `size` INTEGER NULL,
    `fileType` VARCHAR(191) NULL,
    `isTrashed` BOOLEAN NOT NULL DEFAULT false,
    `trashedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DocumentItem_parentId_idx`(`parentId`),
    INDEX `DocumentItem_ownerId_idx`(`ownerId`),
    INDEX `DocumentItem_isTrashed_idx`(`isTrashed`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentGroupAccess` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `documentId` INTEGER NOT NULL,
    `group` ENUM('MEMBERS', 'ADVISER') NOT NULL,

    INDEX `DocumentGroupAccess_documentId_idx`(`documentId`),
    UNIQUE INDEX `DocumentGroupAccess_documentId_group_key`(`documentId`, `group`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentOfficerAccess` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `documentId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `permission` ENUM('VIEW', 'EDIT') NOT NULL DEFAULT 'VIEW',

    INDEX `DocumentOfficerAccess_documentId_idx`(`documentId`),
    INDEX `DocumentOfficerAccess_userId_idx`(`userId`),
    UNIQUE INDEX `DocumentOfficerAccess_documentId_userId_key`(`documentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentAsset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetType` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `storagePath` TEXT NOT NULL,
    `publicUrl` TEXT NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `fileSize` INTEGER NOT NULL,
    `uploadedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DocumentAsset_assetType_key`(`assetType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CertificationArchive` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolYear` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CertificationArchive_schoolYear_key`(`schoolYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventCertificationFolder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` INTEGER NOT NULL,
    `certificationArchiveId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EventCertificationFolder_eventId_key`(`eventId`),
    INDEX `EventCertificationFolder_certificationArchiveId_idx`(`certificationArchiveId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Certificate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `certificateNumber` VARCHAR(191) NOT NULL,
    `publicId` VARCHAR(191) NOT NULL,
    `eventCertificationFolderId` INTEGER NOT NULL,
    `eventId` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `originalFileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `fileSize` INTEGER NOT NULL,
    `storagePath` TEXT NOT NULL,
    `publicUrl` TEXT NOT NULL,
    `certificateHash` CHAR(64) NOT NULL,
    `issuedById` INTEGER NOT NULL,
    `revokedById` INTEGER NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokeReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Certificate_certificateNumber_key`(`certificateNumber`),
    UNIQUE INDEX `Certificate_publicId_key`(`publicId`),
    INDEX `Certificate_eventCertificationFolderId_idx`(`eventCertificationFolderId`),
    INDEX `Certificate_eventId_idx`(`eventId`),
    INDEX `Certificate_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MembershipCertificate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `certificateNumber` VARCHAR(191) NOT NULL,
    `paymentId` INTEGER NOT NULL,
    `memberId` INTEGER NOT NULL,
    `semesterId` INTEGER NOT NULL,
    `certificateHash` CHAR(64) NOT NULL,
    `issuedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MembershipCertificate_certificateNumber_key`(`certificateNumber`),
    UNIQUE INDEX `MembershipCertificate_paymentId_key`(`paymentId`),
    INDEX `MembershipCertificate_memberId_idx`(`memberId`),
    INDEX `MembershipCertificate_semesterId_idx`(`semesterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `type` ENUM('REGISTRATION_APPROVED', 'REGISTRATION_REJECTED', 'EVENT_CREATED', 'EVENT_STATUS_CHANGED', 'EVENT_UPDATED', 'MEMBER_APPROVAL_REQUEST', 'ANNOUNCEMENT', 'AUDIT_STATUS_CHANGED') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `link` VARCHAR(191) NULL,
    `groupKey` VARCHAR(191) NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Notification_userId_isRead_idx`(`userId`, `isRead`),
    INDEX `Notification_userId_groupKey_idx`(`userId`, `groupKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `recipients` ENUM('MEMBERS', 'OFFICERS', 'BOTH') NOT NULL,
    `priority` ENUM('NORMAL', 'IMPORTANT') NOT NULL DEFAULT 'NORMAL',
    `expiresAt` DATETIME(3) NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Announcement_priority_expiresAt_idx`(`priority`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushSubscription` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `endpoint` VARCHAR(500) NOT NULL,
    `p256dh` VARCHAR(191) NOT NULL,
    `auth` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PushSubscription_userId_idx`(`userId`),
    UNIQUE INDEX `PushSubscription_userId_endpoint_key`(`userId`, `endpoint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Member` ADD CONSTRAINT `Member_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Otp` ADD CONSTRAINT `Otp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OfficerAssignment` ADD CONSTRAINT `OfficerAssignment_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `Member`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OfficerAssignment` ADD CONSTRAINT `OfficerAssignment_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `Member`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `Semester`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_obligationSemesterId_fkey` FOREIGN KEY (`obligationSemesterId`) REFERENCES `Semester`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FundCategory` ADD CONSTRAINT `FundCategory_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `Semester`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FundCategory` ADD CONSTRAINT `FundCategory_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Disbursement` ADD CONSTRAINT `Disbursement_fundCategoryId_fkey` FOREIGN KEY (`fundCategoryId`) REFERENCES `FundCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Disbursement` ADD CONSTRAINT `Disbursement_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `Semester`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Disbursement` ADD CONSTRAINT `Disbursement_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnFund` ADD CONSTRAINT `ReturnFund_disbursementId_fkey` FOREIGN KEY (`disbursementId`) REFERENCES `Disbursement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnFund` ADD CONSTRAINT `ReturnFund_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `Semester`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnFund` ADD CONSTRAINT `ReturnFund_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Audit` ADD CONSTRAINT `Audit_disbursementId_fkey` FOREIGN KEY (`disbursementId`) REFERENCES `Disbursement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Audit` ADD CONSTRAINT `Audit_returnFundId_fkey` FOREIGN KEY (`returnFundId`) REFERENCES `ReturnFund`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Audit` ADD CONSTRAINT `Audit_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventAttendance` ADD CONSTRAINT `EventAttendance_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PendingEmailChange` ADD CONSTRAINT `PendingEmailChange_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentItem` ADD CONSTRAINT `DocumentItem_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `DocumentItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentItem` ADD CONSTRAINT `DocumentItem_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentGroupAccess` ADD CONSTRAINT `DocumentGroupAccess_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `DocumentItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentOfficerAccess` ADD CONSTRAINT `DocumentOfficerAccess_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `DocumentItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentOfficerAccess` ADD CONSTRAINT `DocumentOfficerAccess_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAsset` ADD CONSTRAINT `DocumentAsset_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventCertificationFolder` ADD CONSTRAINT `EventCertificationFolder_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventCertificationFolder` ADD CONSTRAINT `EventCertificationFolder_certificationArchiveId_fkey` FOREIGN KEY (`certificationArchiveId`) REFERENCES `CertificationArchive`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Certificate` ADD CONSTRAINT `Certificate_eventCertificationFolderId_fkey` FOREIGN KEY (`eventCertificationFolderId`) REFERENCES `EventCertificationFolder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Certificate` ADD CONSTRAINT `Certificate_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Certificate` ADD CONSTRAINT `Certificate_issuedById_fkey` FOREIGN KEY (`issuedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Certificate` ADD CONSTRAINT `Certificate_revokedById_fkey` FOREIGN KEY (`revokedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MembershipCertificate` ADD CONSTRAINT `MembershipCertificate_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MembershipCertificate` ADD CONSTRAINT `MembershipCertificate_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `Member`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MembershipCertificate` ADD CONSTRAINT `MembershipCertificate_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `Semester`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MembershipCertificate` ADD CONSTRAINT `MembershipCertificate_issuedById_fkey` FOREIGN KEY (`issuedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Announcement` ADD CONSTRAINT `Announcement_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushSubscription` ADD CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
