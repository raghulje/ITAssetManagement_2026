-- 032: models.asset_type_id (nullable, optional classification association)
-- Wave 1.5: do NOT hardcode USE. Apply against whatever database the session already selected.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'models'
    AND COLUMN_NAME = 'asset_type_id'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `models`
    ADD COLUMN `asset_type_id` INT UNSIGNED NULL AFTER `fieldset_id`,
    ADD KEY `idx_models_asset_type` (`asset_type_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK constraint (if not present)
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'models'
    AND CONSTRAINT_NAME = 'fk_models_asset_type'
);

SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE `models`
    ADD CONSTRAINT `fk_models_asset_type`
      FOREIGN KEY (`asset_type_id`) REFERENCES `asset_types` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '032_classification_models_asset_type_id', 'Add models.asset_type_id + FK to asset_types'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '032_classification_models_asset_type_id');

SET FOREIGN_KEY_CHECKS = 1;

