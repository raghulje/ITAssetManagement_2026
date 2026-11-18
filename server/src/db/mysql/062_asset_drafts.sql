-- 062: In-progress asset create forms. Additive only.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `asset_drafts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_by` INT UNSIGNED NULL,
  `domain_code` VARCHAR(32) NOT NULL DEFAULT 'it',
  `payload` JSON NOT NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_asset_drafts_owner` (`created_by`, `domain_code`),
  KEY `idx_asset_drafts_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '062_asset_drafts', 'Asset create drafts'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '062_asset_drafts');

SET FOREIGN_KEY_CHECKS = 1;
