-- 059: Extra endpoint-report columns live beside the asset record.
-- Additive only. Do NOT hardcode USE.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'additional_details'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `assets` ADD COLUMN `additional_details` JSON NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '059_asset_additional_details', 'JSON snapshot of extra columns from the latest asset report'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '059_asset_additional_details');

SET FOREIGN_KEY_CHECKS = 1;
