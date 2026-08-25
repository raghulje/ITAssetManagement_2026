-- 042: Office location flag + floor/space fields on locations
-- Additive only. Do NOT hardcode USE. Reuses location_types FLOOR / SPACE from 034.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND COLUMN_NAME = 'is_office'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `locations` ADD COLUMN `is_office` TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND COLUMN_NAME = 'seat_count'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `locations` ADD COLUMN `seat_count` INT UNSIGNED NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND COLUMN_NAME = 'space_active'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `locations` ADD COLUMN `space_active` TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND COLUMN_NAME = 'occupant_employee_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `locations` ADD COLUMN `occupant_employee_id` INT UNSIGNED NULL, ADD KEY `idx_locations_occupant` (`occupant_employee_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND CONSTRAINT_NAME = 'fk_locations_occupant_employee'
);
SET @sql := IF(
  @fk = 0,
  'ALTER TABLE `locations` ADD CONSTRAINT `fk_locations_occupant_employee` FOREIGN KEY (`occupant_employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '042_locations_office_space', 'Office location flag, seats, floor active, occupant on locations'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '042_locations_office_space');

SET FOREIGN_KEY_CHECKS = 1;
