-- 054: Store Ello call recordings on disk so playback does not depend on Ello URLs
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_calls' AND COLUMN_NAME = 'recording_path'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_calls` ADD COLUMN `recording_path` VARCHAR(255) NULL AFTER `recording_url`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_calls' AND COLUMN_NAME = 'recording_mime'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_calls` ADD COLUMN `recording_mime` VARCHAR(128) NULL AFTER `recording_path`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_calls' AND COLUMN_NAME = 'recording_original_name'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_calls` ADD COLUMN `recording_original_name` VARCHAR(191) NULL AFTER `recording_mime`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '054_battery_call_recordings', 'Download and store Battery Degradation call recordings locally'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '054_battery_call_recordings');

SET FOREIGN_KEY_CHECKS = 1;
