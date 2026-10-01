-- 049: Round-robin technician assignment + close comments
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'assigned_to'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `assigned_to` INT UNSIGNED NULL AFTER `status`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'assigned_at'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `assigned_at` DATETIME NULL AFTER `assigned_to`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'close_comments'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `close_comments` TEXT NULL AFTER `assigned_at`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'closed_at'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `closed_at` DATETIME NULL AFTER `close_comments`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'closed_by'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `closed_by` INT UNSIGNED NULL AFTER `closed_at`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND INDEX_NAME = 'idx_bdi_assigned'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE `battery_degradation_issues` ADD KEY `idx_bdi_assigned` (`assigned_to`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `battery_technician_rr` (
  `id` TINYINT UNSIGNED NOT NULL,
  `last_user_id` INT UNSIGNED NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `battery_technician_rr` (`id`, `last_user_id`) VALUES (1, NULL);

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '049_battery_technician_assign', 'Round-robin IT Asset Manager assignment and close comments'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '049_battery_technician_assign');

SET FOREIGN_KEY_CHECKS = 1;
