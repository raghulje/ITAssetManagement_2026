-- 041: Optional domain_attrs JSON on assets + seed ADMIN categories
-- Additive only. Do NOT hardcode USE.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'domain_attrs'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `assets` ADD COLUMN `domain_attrs` JSON NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `categories` (`name`, `category_type`, `domain_id`, `created_at`, `updated_at`)
SELECT v.name, v.category_type, d.id, NOW(), NOW()
FROM `asset_domains` d
JOIN (
  SELECT 'Chair' AS name, 'asset' AS category_type UNION ALL
  SELECT 'Desk', 'asset' UNION ALL
  SELECT 'Table', 'asset' UNION ALL
  SELECT 'Whiteboard', 'asset' UNION ALL
  SELECT 'TV', 'asset' UNION ALL
  SELECT 'Projector', 'asset' UNION ALL
  SELECT 'Air Conditioner', 'asset' UNION ALL
  SELECT 'Biometric Device', 'asset' UNION ALL
  SELECT 'Charging Station', 'asset' UNION ALL
  SELECT 'Water Dispenser', 'asset' UNION ALL
  SELECT 'TV Remote', 'accessory' UNION ALL
  SELECT 'Projector Remote', 'accessory' UNION ALL
  SELECT 'Chair Accessories', 'accessory' UNION ALL
  SELECT 'Pen', 'consumable' UNION ALL
  SELECT 'Notebook', 'consumable' UNION ALL
  SELECT 'Marker', 'consumable' UNION ALL
  SELECT 'Whiteboard Eraser', 'consumable' UNION ALL
  SELECT 'Paper', 'consumable' UNION ALL
  SELECT 'Chair Wheel', 'component' UNION ALL
  SELECT 'Door Lock', 'component' UNION ALL
  SELECT 'Light Driver', 'component' UNION ALL
  SELECT 'AC Filter', 'component'
) v
WHERE d.code = 'admin' AND d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `categories` c
    WHERE c.deleted_at IS NULL
      AND c.name = v.name
      AND c.category_type = v.category_type
      AND c.domain_id = d.id
  );

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '041_assets_domain_attrs_admin_categories', 'Asset domain_attrs JSON and ADMIN category seed'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '041_assets_domain_attrs_admin_categories');

SET FOREIGN_KEY_CHECKS = 1;
