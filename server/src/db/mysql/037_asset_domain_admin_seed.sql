-- 037: Seed ADMIN asset domain (IT already seeded in 030)
-- Additive only. Do NOT hardcode USE. Session database is selected by the migrate runner.
SET NAMES utf8mb4;

INSERT INTO `asset_domains` (`name`, `code`, `active`, `created_at`, `updated_at`)
SELECT 'ADMIN', 'admin', 1, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `asset_domains`
  WHERE deleted_at IS NULL AND (`name` = 'ADMIN' OR `code` = 'admin')
);

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '037_asset_domain_admin_seed', 'Seed ADMIN asset domain for Enterprise Asset Management'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '037_asset_domain_admin_seed');
