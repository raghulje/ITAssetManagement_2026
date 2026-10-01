-- 048: Call result (completed / ignored / rejected) + ignored callback
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'call_result'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `call_result` VARCHAR(32) NULL AFTER `ello_call_status`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_calls' AND COLUMN_NAME = 'call_result'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_calls` ADD COLUMN `call_result` VARCHAR(32) NULL AFTER `ello_call_status`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_calls' AND COLUMN_NAME = 'disconnect_reason'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_calls` ADD COLUMN `disconnect_reason` VARCHAR(191) NULL AFTER `call_result`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_calls' AND COLUMN_NAME = 'callback_queued_at'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_calls` ADD COLUMN `callback_queued_at` DATETIME NULL AFTER `email_sent_at`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `battery_degradation_issues`
SET `call_result` = 'yet_to_call'
WHERE (`call_result` IS NULL OR `call_result` = '')
  AND (`ello_conversation_id` IS NULL OR `ello_conversation_id` = '');

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '048_battery_call_result', 'Call result labels and ignored 30-minute callback'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '048_battery_call_result');

SET FOREIGN_KEY_CHECKS = 1;
