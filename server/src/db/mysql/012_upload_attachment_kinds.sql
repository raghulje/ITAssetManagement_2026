-- 012: Asset attachment kinds (invoice, PO, other)
SET NAMES utf8mb4;

USE `ITAssetManagement_2026`;

ALTER TABLE `uploads`
  MODIFY COLUMN `kind` ENUM(
    'image', 'file', 'signature', 'eula', 'audit',
    'invoice', 'po', 'other'
  ) NOT NULL DEFAULT 'file';

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '012_upload_attachment_kinds', 'Add invoice/po/other upload kinds for asset attachments'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '012_upload_attachment_kinds');
