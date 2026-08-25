-- 030: Classification masters: asset_domains + asset_types
-- Wave 1.5: do NOT hardcode USE. The migrate runner already selects DB_NAME.
-- Manual mysql CLI against a staging clone must stay on that clone.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Asset Domains
CREATE TABLE IF NOT EXISTS `asset_domains` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `code` VARCHAR(64) NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asset_domains_name` (`name`),
  UNIQUE KEY `uk_asset_domains_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Asset Types
CREATE TABLE IF NOT EXISTS `asset_types` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `category_id` INT UNSIGNED NULL,
  `asset_domain_id` INT UNSIGNED NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_asset_types_category` (`category_id`),
  KEY `idx_asset_types_domain` (`asset_domain_id`),
  UNIQUE KEY `uk_asset_types_name_category` (`name`, `category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill FK constraints (if columns exist; safe no-op when already present)
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'asset_types'
    AND CONSTRAINT_NAME = 'fk_asset_types_category'
);
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE `asset_types`
    ADD CONSTRAINT `fk_asset_types_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists2 := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'asset_types'
    AND CONSTRAINT_NAME = 'fk_asset_types_domain'
);
SET @sql := IF(
  @fk_exists2 = 0,
  'ALTER TABLE `asset_types`
    ADD CONSTRAINT `fk_asset_types_domain` FOREIGN KEY (`asset_domain_id`) REFERENCES `asset_domains` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Seed the IT domain (safe because app scope is ITAM; other domains may be added in later waves)
INSERT INTO `asset_domains` (`name`, `code`, `active`, `created_at`, `updated_at`)
SELECT 'IT', 'it', 1, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `asset_domains` WHERE `name` = 'IT' OR `code` = 'it'
);

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '030_classification_asset_domains_and_types', 'Create asset_domains + asset_types masters'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '030_classification_asset_domains_and_types');

SET FOREIGN_KEY_CHECKS = 1;

