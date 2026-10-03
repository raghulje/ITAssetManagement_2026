-- 052: Proof attachments required when a technician closes a battery issue
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'close_attachments'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `close_attachments` JSON NULL AFTER `close_comments`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '052_battery_close_attachments', 'Technician close-proof attachments for Battery Degradation'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '052_battery_close_attachments');

SET FOREIGN_KEY_CHECKS = 1;
