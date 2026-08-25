-- 039: Backfill existing inventory records to the IT domain
-- Only fills NULL domain_id. Never overwrites an explicit domain.
-- Do NOT hardcode USE.
SET NAMES utf8mb4;

SET @it_domain_id := (
  SELECT id FROM asset_domains
  WHERE deleted_at IS NULL AND (`code` = 'it' OR `name` = 'IT')
  ORDER BY id ASC
  LIMIT 1
);

-- assets
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'domain_id'
);
SET @sql := IF(
  @col = 1 AND @it_domain_id IS NOT NULL,
  'UPDATE assets SET domain_id = @it_domain_id WHERE domain_id IS NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- licenses
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licenses' AND COLUMN_NAME = 'domain_id'
);
SET @sql := IF(
  @col = 1 AND @it_domain_id IS NOT NULL,
  'UPDATE licenses SET domain_id = @it_domain_id WHERE domain_id IS NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- accessories
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accessories' AND COLUMN_NAME = 'domain_id'
);
SET @sql := IF(
  @col = 1 AND @it_domain_id IS NOT NULL,
  'UPDATE accessories SET domain_id = @it_domain_id WHERE domain_id IS NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- consumables
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consumables' AND COLUMN_NAME = 'domain_id'
);
SET @sql := IF(
  @col = 1 AND @it_domain_id IS NOT NULL,
  'UPDATE consumables SET domain_id = @it_domain_id WHERE domain_id IS NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- components
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'components' AND COLUMN_NAME = 'domain_id'
);
SET @sql := IF(
  @col = 1 AND @it_domain_id IS NOT NULL,
  'UPDATE components SET domain_id = @it_domain_id WHERE domain_id IS NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '039_inventory_domain_it_backfill', 'Backfill NULL inventory domain_id to IT'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '039_inventory_domain_it_backfill');
