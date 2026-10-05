-- 055: Cache English translations of Battery Degradation call transcripts
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_calls' AND COLUMN_NAME = 'transcript_en'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_calls` ADD COLUMN `transcript_en` JSON NULL AFTER `transcript`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '055_battery_transcript_en', 'Cache English translations of Battery Degradation transcripts'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '055_battery_transcript_en');

SET FOREIGN_KEY_CHECKS = 1;
