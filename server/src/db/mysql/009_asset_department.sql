-- 009: Tag assets with department (HRMS master)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

USE `ITAssetManagement_2026`;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assets'
    AND COLUMN_NAME = 'department_id'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `assets` ADD COLUMN `department_id` INT UNSIGNED NULL AFTER `company_id`, ADD KEY `idx_assets_department` (`department_id`), ADD CONSTRAINT `fk_assets_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '009_asset_department', 'Add department_id to assets'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '009_asset_department');

SET FOREIGN_KEY_CHECKS = 1;
