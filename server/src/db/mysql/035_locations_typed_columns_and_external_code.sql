-- 035: Guarded locations.external_code reconciliation + typed location FKs (Wave 2.2)
-- Additive only. Do NOT hardcode USE.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- external_code: add only if missing (already present on prod + staging dumps)
SET @ext_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'locations'
    AND COLUMN_NAME = 'external_code'
);
SET @sql := IF(
  @ext_exists = 0,
  'ALTER TABLE `locations` ADD COLUMN `external_code` VARCHAR(100) NULL AFTER `name`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @lt_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'locations'
    AND COLUMN_NAME = 'location_type_id'
);
SET @sql := IF(
  @lt_exists = 0,
  'ALTER TABLE `locations` ADD COLUMN `location_type_id` INT UNSIGNED NULL AFTER `company_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ss_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'locations'
    AND COLUMN_NAME = 'space_subtype_id'
);
SET @sql := IF(
  @ss_exists = 0,
  'ALTER TABLE `locations` ADD COLUMN `space_subtype_id` INT UNSIGNED NULL AFTER `location_type_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_lt := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND INDEX_NAME = 'idx_locations_type'
);
SET @sql := IF(
  @idx_lt = 0,
  'ALTER TABLE `locations` ADD KEY `idx_locations_type` (`location_type_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_ss := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND INDEX_NAME = 'idx_locations_space_subtype'
);
SET @sql := IF(
  @idx_ss = 0,
  'ALTER TABLE `locations` ADD KEY `idx_locations_space_subtype` (`space_subtype_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_lt := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'locations'
    AND CONSTRAINT_NAME = 'fk_locations_location_type'
);
SET @sql := IF(
  @fk_lt = 0,
  'ALTER TABLE `locations`
    ADD CONSTRAINT `fk_locations_location_type`
    FOREIGN KEY (`location_type_id`) REFERENCES `location_types` (`id`) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_ss := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'locations'
    AND CONSTRAINT_NAME = 'fk_locations_space_subtype'
);
SET @sql := IF(
  @fk_ss = 0,
  'ALTER TABLE `locations`
    ADD CONSTRAINT `fk_locations_space_subtype`
    FOREIGN KEY (`space_subtype_id`) REFERENCES `space_subtypes` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '035_locations_typed_columns_and_external_code', 'Reconcile locations.external_code; add location_type_id and space_subtype_id'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '035_locations_typed_columns_and_external_code');

SET FOREIGN_KEY_CHECKS = 1;
