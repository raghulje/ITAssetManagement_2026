-- 050: Battery Degradation admin config (agent id + notify email)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'battery_config'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `settings` ADD COLUMN `battery_config` JSON NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '050_battery_admin_config', 'Battery Degradation agent id and notify email in settings'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '050_battery_admin_config');

SET FOREIGN_KEY_CHECKS = 1;
