-- 033: Safe backfill for classification foundation
-- Wave 1.5: do NOT hardcode USE. Apply against whatever database the session already selected.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- This wave only auto-backfills the unambiguous ITAM asset side:
--   categories.category_type = 'asset'
-- Everything else remains null/unclassified (requires review later).

SET @it_domain_id := (
  SELECT id FROM asset_domains WHERE code = 'it' AND deleted_at IS NULL LIMIT 1
);

-- categories.domain_id backfill (only for asset categories, only when NULL)
SET @domain_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'categories'
    AND COLUMN_NAME = 'domain_id'
);

SET @sql := IF(
  @domain_col_exists = 1 AND @it_domain_id IS NOT NULL,
  'UPDATE categories
    SET domain_id = @it_domain_id
    WHERE deleted_at IS NULL
      AND category_type = ''asset''
      AND domain_id IS NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Create asset_types for each distinct existing asset category.
-- Initial mapping rule: asset_type name = category.name (deterministic), one asset_type per category name+id.
INSERT INTO asset_types (name, category_id, asset_domain_id, created_at, updated_at)
SELECT
  c.name,
  c.id AS category_id,
  c.domain_id AS asset_domain_id,
  NOW(),
  NOW()
FROM categories c
WHERE c.deleted_at IS NULL
  AND c.category_type = 'asset'
  AND NOT EXISTS (
    SELECT 1 FROM asset_types at
    WHERE at.deleted_at IS NULL
      AND at.category_id = c.id
      AND at.name = c.name
  );

-- models.asset_type_id backfill: map each model to the asset_type created for its category (if asset-category).
SET @model_asset_type_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'models'
    AND COLUMN_NAME = 'asset_type_id'
);

SET @sql := IF(
  @model_asset_type_col_exists = 1,
  'UPDATE models m
    SET m.asset_type_id = (
      SELECT at.id
      FROM asset_types at
      WHERE at.deleted_at IS NULL
        AND at.category_id = m.category_id
        AND at.name = (SELECT c2.name FROM categories c2 WHERE c2.id = m.category_id LIMIT 1)
      LIMIT 1
    )
    WHERE m.deleted_at IS NULL
      AND m.asset_type_id IS NULL
      AND m.category_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM categories c3
        WHERE c3.id = m.category_id
          AND c3.deleted_at IS NULL
          AND c3.category_type = ''asset''
      )',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '033_classification_safe_backfill', 'Backfill safe asset_types + models.asset_type_id for asset categories'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '033_classification_safe_backfill');

SET FOREIGN_KEY_CHECKS = 1;

