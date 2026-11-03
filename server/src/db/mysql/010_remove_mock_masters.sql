-- 010: Soft-delete seed mock masters (Acme / Contoso / demo locations)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

USE `ITAssetManagement_2026`;

UPDATE `companies`
SET `deleted_at` = COALESCE(`deleted_at`, NOW()), `updated_at` = NOW()
WHERE `deleted_at` IS NULL
  AND (
    `name` IN ('Acme Corp', 'Contoso Ltd', 'Manual Test Company XYZ')
    OR `name` LIKE 'Acme %'
    OR `name` LIKE 'Contoso %'
  );

UPDATE `locations`
SET `deleted_at` = COALESCE(`deleted_at`, NOW()), `updated_at` = NOW()
WHERE `deleted_at` IS NULL
  AND `name` IN (
    'HQ Warehouse', 'Floor 1', 'Floor 3', 'Remote',
    'Conference Room A', 'Repair Bench', 'Archive'
  );

-- Only soft-delete seed demo departments that still point at Acme/Contoso
UPDATE `departments` d
JOIN `companies` c ON c.id = d.company_id
SET d.`deleted_at` = COALESCE(d.`deleted_at`, NOW()), d.`updated_at` = NOW()
WHERE d.`deleted_at` IS NULL
  AND c.`name` IN ('Acme Corp', 'Contoso Ltd')
  AND d.`name` IN ('Engineering', 'IT', 'Finance', 'Sales');

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '010_remove_mock_masters', 'Soft-delete Acme/Contoso mock company/location masters'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '010_remove_mock_masters');

SET FOREIGN_KEY_CHECKS = 1;
