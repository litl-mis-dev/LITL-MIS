-- AlterTable
ALTER TABLE `EventCertificationFolder` ADD COLUMN `semesterId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `EventCertificationFolder_semesterId_idx` ON `EventCertificationFolder`(`semesterId`);

-- AddForeignKey
ALTER TABLE `EventCertificationFolder` ADD CONSTRAINT `EventCertificationFolder_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `Semester`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing event folders predate semester folders: file them under the
-- 1st Semester of their school year, or the 2nd if the 1st doesn't exist.
-- Folders whose school year has no semester at all stay NULL.
UPDATE `EventCertificationFolder` f
  JOIN `CertificationArchive` a ON a.`id` = f.`certificationArchiveId`
  JOIN `Semester` s ON s.`schoolYear` = a.`schoolYear` AND s.`semester` = 'FIRST'
  SET f.`semesterId` = s.`id`
  WHERE f.`semesterId` IS NULL;

UPDATE `EventCertificationFolder` f
  JOIN `CertificationArchive` a ON a.`id` = f.`certificationArchiveId`
  JOIN `Semester` s ON s.`schoolYear` = a.`schoolYear` AND s.`semester` = 'SECOND'
  SET f.`semesterId` = s.`id`
  WHERE f.`semesterId` IS NULL;
