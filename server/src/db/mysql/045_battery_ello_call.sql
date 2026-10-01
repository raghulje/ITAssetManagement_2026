-- 045: Store Ello.AI create-call ids on battery degradation issues
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'ello_agent_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `ello_agent_id` VARCHAR(64) NULL AFTER `status`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'ello_conversation_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `ello_conversation_id` VARCHAR(64) NULL AFTER `ello_agent_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'ello_siptrunk_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `ello_siptrunk_id` VARCHAR(64) NULL AFTER `ello_conversation_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'ello_call_status'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `ello_call_status` VARCHAR(64) NULL AFTER `ello_siptrunk_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND INDEX_NAME = 'idx_bdi_ello_conversation'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE `battery_degradation_issues` ADD KEY `idx_bdi_ello_conversation` (`ello_conversation_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '045_battery_ello_call', 'Ello.AI conversation ids on battery degradation issues'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '045_battery_ello_call');

SET FOREIGN_KEY_CHECKS = 1;
