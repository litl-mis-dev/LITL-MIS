-- Renames the MemberRoster table to MembersListEntry, keeping every row.
-- (Prisma would generate DROP TABLE + CREATE TABLE here, which loses the
-- list, so this is written by hand. The end result matches schema.prisma.)

-- The foreign key and indexes are recreated under the new table's names.
ALTER TABLE `MemberRoster` DROP FOREIGN KEY `MemberRoster_addedById_fkey`;

RENAME TABLE `MemberRoster` TO `MembersListEntry`;

ALTER TABLE `MembersListEntry`
    DROP INDEX `MemberRoster_studentNumber_key`,
    ADD UNIQUE INDEX `MembersListEntry_studentNumber_key`(`studentNumber`);

ALTER TABLE `MembersListEntry`
    DROP INDEX `MemberRoster_addedById_idx`,
    ADD INDEX `MembersListEntry_addedById_idx`(`addedById`);

ALTER TABLE `MembersListEntry` ADD CONSTRAINT `MembersListEntry_addedById_fkey` FOREIGN KEY (`addedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Saved Activity Log entries switch to the new codes. Neither action is part
-- of the financial hash chain, so no ledger hash depends on these values.
UPDATE `AuditLog` SET `action` = 'MEMBERS_LIST_UPDATED' WHERE `action` = 'MEMBER_ROSTER_UPDATED';

UPDATE `AuditLog`
SET `details` = REPLACE(`details`, '"via":"ROSTER"', '"via":"MEMBERS_LIST"')
WHERE `action` = 'USER_APPROVED' AND `details` LIKE '%"via":"ROSTER"%';
