-- 058: Current place can be a typed location (not only a master office),
-- and each asset can store its own manufacturer (HP, Lenovo, BEETEL, …).
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assets'
    AND COLUMN_NAME = 'location_text'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `assets` ADD COLUMN `location_text` VARCHAR(255) NULL AFTER `rtd_location_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assets'
    AND COLUMN_NAME = 'manufacturer_id'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `assets`
     ADD COLUMN `manufacturer_id` INT UNSIGNED NULL AFTER `model_id`,
     ADD KEY `idx_assets_manufacturer` (`manufacturer_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assets'
    AND CONSTRAINT_NAME = 'fk_assets_manufacturer'
);
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE `assets`
     ADD CONSTRAINT `fk_assets_manufacturer`
       FOREIGN KEY (`manufacturer_id`) REFERENCES `manufacturers` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '058_asset_place_and_manufacturer', 'Asset transfer place text and per-asset manufacturer'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '058_asset_place_and_manufacturer');

SET FOREIGN_KEY_CHECKS = 1;
