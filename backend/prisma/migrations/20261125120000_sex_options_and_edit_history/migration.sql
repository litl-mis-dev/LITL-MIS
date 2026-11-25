-- Sex is Male or Female only ("Prefer not to say" was removed from the forms).
-- Rows still holding PREFER_NOT_TO_SAY make this fail instead of being changed
-- silently; the database is reset for this release.
ALTER TABLE `Member` MODIFY `sex` ENUM('MALE', 'FEMALE') NOT NULL;
ALTER TABLE `PendingRegistration` MODIFY `sex` ENUM('MALE', 'FEMALE') NOT NULL;

-- Edit history: each Activity Log entry can name the record it changed.
ALTER TABLE `AuditLog` ADD COLUMN `entityType` VARCHAR(40) NULL,
    ADD COLUMN `entityId` INTEGER NULL;
CREATE INDEX `AuditLog_entityType_entityId_idx` ON `AuditLog`(`entityType`, `entityId`);
