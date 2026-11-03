-- 011: Keep only HRMS-synced (+ explicitly user-tagged) company/dept/location masters
-- Soft-delete any leftover rows that are not from HRMS sync.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

USE `ITAssetManagement_2026`;

UPDATE `companies`
SET `deleted_at` = COALESCE(`deleted_at`, NOW()), `updated_at` = NOW()
WHERE `deleted_at` IS NULL
  AND (`notes` IS NULL OR `notes` NOT LIKE 'Synced from HRMS%')
  AND (
    `name` IN ('Acme Corp', 'Contoso Ltd', 'Manual Test Company XYZ')
    OR `name` LIKE 'Acme %'
    OR `name` LIKE 'Contoso %'
  );

UPDATE `locations`
SET `deleted_at` = COALESCE(`deleted_at`, NOW()), `updated_at` = NOW()
WHERE `deleted_at` IS NULL
  AND (`notes` IS NULL OR `notes` NOT LIKE 'Synced from HRMS%')
  AND `name` IN (
    'HQ Warehouse', 'Floor 1', 'Floor 3', 'Remote',
    'Conference Room A', 'Repair Bench', 'Archive'
  );

UPDATE `departments`
SET `deleted_at` = COALESCE(`deleted_at`, NOW()), `updated_at` = NOW()
WHERE `deleted_at` IS NULL
  AND (`notes` IS NULL OR `notes` NOT LIKE 'Synced from HRMS%')
  AND `name` IN ('Engineering', 'IT', 'Finance', 'Sales')
  AND (`company_id` IS NULL OR `company_id` IN (
    SELECT id FROM (
      SELECT id FROM companies WHERE name IN ('Acme Corp', 'Contoso Ltd')
    ) AS _c
  ));

-- Clear Acme emails on seed users
UPDATE `users`
SET `email` = REPLACE(`email`, '@acme.com', '@refex.com'),
    `updated_at` = NOW()
WHERE `email` LIKE '%@acme.com';

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '011_purge_non_hrms_masters', 'Purge leftover mock masters; fix acme emails'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '011_purge_non_hrms_masters');

SET FOREIGN_KEY_CHECKS = 1;
