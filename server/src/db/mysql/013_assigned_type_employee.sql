-- 013: Allow assets to be checked out to HRMS employees
ALTER TABLE `assets`
  MODIFY COLUMN `assigned_type` ENUM('user','location','asset','employee') NULL;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '013_assigned_type_employee', 'Allow assigned_type=employee for asset checkout'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '013_assigned_type_employee');
