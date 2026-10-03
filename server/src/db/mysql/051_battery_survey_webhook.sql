-- 051: Survey answers (battery + other issues) and webhook stamp
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'preferred_language'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `preferred_language` VARCHAR(64) NULL AFTER `close_comments`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'battery_issue_confirmed'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `battery_issue_confirmed` VARCHAR(16) NULL AFTER `preferred_language`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'other_issue_reported'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `other_issue_reported` VARCHAR(16) NULL AFTER `battery_issue_confirmed`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'other_issue_description'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `other_issue_description` TEXT NULL AFTER `other_issue_reported`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'webhook_sent_at'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `webhook_sent_at` DATETIME NULL AFTER `other_issue_description`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '051_battery_survey_webhook', 'Battery survey answers and webhook stamp'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '051_battery_survey_webhook');

SET FOREIGN_KEY_CHECKS = 1;
