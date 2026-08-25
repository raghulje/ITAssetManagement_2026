-- 038: Add domain_id to shared inventory modules (assets, licenses, accessories, consumables, components)
-- Additive nullable FK. Existing rows stay valid until 039 backfill.
-- Do NOT hardcode USE.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- assets.domain_id
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'domain_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `assets` ADD COLUMN `domain_id` INT UNSIGNED NULL AFTER `id`, ADD KEY `idx_assets_domain` (`domain_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND CONSTRAINT_NAME = 'fk_assets_domain'
);
SET @sql := IF(
  @fk = 0,
  'ALTER TABLE `assets` ADD CONSTRAINT `fk_assets_domain` FOREIGN KEY (`domain_id`) REFERENCES `asset_domains` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- licenses.domain_id
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licenses' AND COLUMN_NAME = 'domain_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `licenses` ADD COLUMN `domain_id` INT UNSIGNED NULL AFTER `id`, ADD KEY `idx_licenses_domain` (`domain_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licenses' AND CONSTRAINT_NAME = 'fk_licenses_domain'
);
SET @sql := IF(
  @fk = 0,
  'ALTER TABLE `licenses` ADD CONSTRAINT `fk_licenses_domain` FOREIGN KEY (`domain_id`) REFERENCES `asset_domains` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- accessories.domain_id
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accessories' AND COLUMN_NAME = 'domain_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `accessories` ADD COLUMN `domain_id` INT UNSIGNED NULL AFTER `id`, ADD KEY `idx_accessories_domain` (`domain_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accessories' AND CONSTRAINT_NAME = 'fk_accessories_domain'
);
SET @sql := IF(
  @fk = 0,
  'ALTER TABLE `accessories` ADD CONSTRAINT `fk_accessories_domain` FOREIGN KEY (`domain_id`) REFERENCES `asset_domains` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- consumables.domain_id
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consumables' AND COLUMN_NAME = 'domain_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `consumables` ADD COLUMN `domain_id` INT UNSIGNED NULL AFTER `id`, ADD KEY `idx_consumables_domain` (`domain_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consumables' AND CONSTRAINT_NAME = 'fk_consumables_domain'
);
SET @sql := IF(
  @fk = 0,
  'ALTER TABLE `consumables` ADD CONSTRAINT `fk_consumables_domain` FOREIGN KEY (`domain_id`) REFERENCES `asset_domains` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- components.domain_id
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'components' AND COLUMN_NAME = 'domain_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `components` ADD COLUMN `domain_id` INT UNSIGNED NULL AFTER `id`, ADD KEY `idx_components_domain` (`domain_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'components' AND CONSTRAINT_NAME = 'fk_components_domain'
);
SET @sql := IF(
  @fk = 0,
  'ALTER TABLE `components` ADD CONSTRAINT `fk_components_domain` FOREIGN KEY (`domain_id`) REFERENCES `asset_domains` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '038_inventory_domain_id', 'Add domain_id to assets/licenses/accessories/consumables/components'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '038_inventory_domain_id');

SET FOREIGN_KEY_CHECKS = 1;
