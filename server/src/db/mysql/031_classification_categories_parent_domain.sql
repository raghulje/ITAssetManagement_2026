-- 031: Add categories.parent_id + categories.domain_id (max depth 1 enforced in backend)
-- Wave 1.5: do NOT hardcode USE. Apply against whatever database the session already selected.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- parent_id (subcategory parent; root categories keep NULL)
SET @parent_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'categories'
    AND COLUMN_NAME = 'parent_id'
);

SET @sql := IF(
  @parent_col_exists = 0,
  'ALTER TABLE `categories`
    ADD COLUMN `parent_id` INT UNSIGNED NULL AFTER `use_default_eula`,
    ADD KEY `idx_categories_parent` (`parent_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add FK for categories.parent_id -> categories.id (self-FK)
SET @fk1_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'categories'
    AND CONSTRAINT_NAME = 'fk_categories_parent'
);

SET @sql := IF(
  @fk1_exists = 0,
  'ALTER TABLE `categories`
    ADD CONSTRAINT `fk_categories_parent`
      FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- domain_id (optional classification domain; globally reusable)
SET @domain_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'categories'
    AND COLUMN_NAME = 'domain_id'
);

SET @sql := IF(
  @domain_col_exists = 0,
  'ALTER TABLE `categories`
    ADD COLUMN `domain_id` INT UNSIGNED NULL AFTER `parent_id`,
    ADD KEY `idx_categories_domain` (`domain_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add FK for categories.domain_id -> asset_domains.id
SET @fk2_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'categories'
    AND CONSTRAINT_NAME = 'fk_categories_domain'
);

SET @sql := IF(
  @fk2_exists = 0,
  'ALTER TABLE `categories`
    ADD CONSTRAINT `fk_categories_domain`
      FOREIGN KEY (`domain_id`) REFERENCES `asset_domains` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '031_classification_categories_parent_domain', 'Add parent_id + domain_id to categories'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '031_classification_categories_parent_domain');

SET FOREIGN_KEY_CHECKS = 1;

