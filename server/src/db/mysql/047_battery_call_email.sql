-- 047: One-time call-complete email flag per Ello conversation
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_calls' AND COLUMN_NAME = 'email_sent_at'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_calls` ADD COLUMN `email_sent_at` DATETIME NULL AFTER `ended_at`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '047_battery_call_email', 'Email flag when a battery Ello conversation ends'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '047_battery_call_email');

SET FOREIGN_KEY_CHECKS = 1;
