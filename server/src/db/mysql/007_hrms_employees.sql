-- 007: HRMS Employees directory (separate from app login users)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

USE `ITAssetManagement_2026`;

CREATE TABLE IF NOT EXISTS `employees` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_code` VARCHAR(64) NOT NULL COMMENT 'EMPLOYEE_ID from HRMS',
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL DEFAULT '',
  `title` VARCHAR(32) NULL,
  `sex` VARCHAR(16) NULL,
  `date_of_birth` DATE NULL,
  `joining_date` DATE NULL,
  `date_of_exit` DATE NULL,
  `legal_entity_code` VARCHAR(64) NULL,
  `branch_code` VARCHAR(64) NULL,
  `department_code` VARCHAR(64) NULL,
  `department_name` VARCHAR(191) NULL,
  `business_line` VARCHAR(191) NULL,
  `designation` VARCHAR(191) NULL,
  `grade_name` VARCHAR(64) NULL,
  `supervisor_employee_code` VARCHAR(64) NULL,
  `pan_number` VARCHAR(32) NULL,
  `email` VARCHAR(191) NULL,
  `personal_email` VARCHAR(191) NULL,
  `mobile` VARCHAR(64) NULL,
  `work_mobile` VARCHAR(64) NULL,
  `office_location` VARCHAR(191) NULL,
  `employee_pincode` VARCHAR(20) NULL,
  `employment_status` VARCHAR(32) NULL,
  `employment_status_description` VARCHAR(100) NULL,
  `employee_status` VARCHAR(32) NULL,
  `employee_status_description` VARCHAR(100) NULL,
  `emp_added_on` DATETIME NULL,
  `refex_company_name` VARCHAR(191) NULL,
  `refex_location` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `synced_at` DATETIME NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_employees_code` (`employee_code`),
  KEY `idx_employees_email` (`email`),
  KEY `idx_employees_employment_status` (`employment_status`),
  KEY `idx_employees_department` (`department_name`),
  KEY `idx_employees_company` (`refex_company_name`),
  KEY `idx_employees_deleted` (`deleted_at`),
  KEY `idx_employees_name` (`last_name`, `first_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '007_hrms_employees', 'HRMS employees directory'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '007_hrms_employees');

SET FOREIGN_KEY_CHECKS = 1;
