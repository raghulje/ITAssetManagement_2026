-- 008: Keep exact Adrenalin GetEmployeeDetails payload per employee
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

USE `ITAssetManagement_2026`;

ALTER TABLE `employees`
  ADD COLUMN `hrms_payload` JSON NULL COMMENT 'Raw GetEmployeeDetails row from Adrenalin' AFTER `notes`;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '008_employee_hrms_payload', 'Store raw HRMS employee payload JSON'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '008_employee_hrms_payload');

SET FOREIGN_KEY_CHECKS = 1;
