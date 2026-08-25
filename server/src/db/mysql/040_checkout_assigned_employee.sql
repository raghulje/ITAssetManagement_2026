-- 040: Employee assignment on licenses / accessories / consumables (unified People)
-- Additive. Existing user/asset assignments remain valid.
-- Do NOT hardcode USE.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- license_seats.assigned_employee_id
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'license_seats' AND COLUMN_NAME = 'assigned_employee_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `license_seats` ADD COLUMN `assigned_employee_id` INT UNSIGNED NULL AFTER `assigned_to`, ADD KEY `idx_license_seats_employee` (`assigned_employee_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'license_seats' AND CONSTRAINT_NAME = 'fk_license_seats_employee'
);
SET @sql := IF(
  @fk = 0,
  'ALTER TABLE `license_seats` ADD CONSTRAINT `fk_license_seats_employee` FOREIGN KEY (`assigned_employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- accessories_checkout.assigned_employee_id
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accessories_checkout' AND COLUMN_NAME = 'assigned_employee_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `accessories_checkout` ADD COLUMN `assigned_employee_id` INT UNSIGNED NULL AFTER `assigned_to`, ADD KEY `idx_acc_checkout_employee` (`assigned_employee_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accessories_checkout' AND CONSTRAINT_NAME = 'fk_acc_checkout_employee'
);
SET @sql := IF(
  @fk = 0,
  'ALTER TABLE `accessories_checkout` ADD CONSTRAINT `fk_acc_checkout_employee` FOREIGN KEY (`assigned_employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Extend accessories assigned_type to include employee (additive ENUM value)
SET @sql := (
  SELECT IF(
    COLUMN_TYPE LIKE '%employee%',
    'SELECT 1',
    'ALTER TABLE `accessories_checkout` MODIFY COLUMN `assigned_type` ENUM(''user'',''location'',''asset'',''employee'') NOT NULL DEFAULT ''user'''
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accessories_checkout' AND COLUMN_NAME = 'assigned_type'
  LIMIT 1
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- consumables_users.assigned_employee_id + nullable assigned_to (employee-only rows)
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consumables_users' AND COLUMN_NAME = 'assigned_employee_id'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `consumables_users` ADD COLUMN `assigned_employee_id` INT UNSIGNED NULL AFTER `assigned_to`, ADD KEY `idx_cons_users_employee` (`assigned_employee_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consumables_users' AND CONSTRAINT_NAME = 'fk_cons_users_employee'
);
SET @sql := IF(
  @fk = 0,
  'ALTER TABLE `consumables_users` ADD CONSTRAINT `fk_cons_users_employee` FOREIGN KEY (`assigned_employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Make assigned_to nullable so an employee assignment does not require an app user
SET @nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consumables_users' AND COLUMN_NAME = 'assigned_to'
  LIMIT 1
);
SET @sql := IF(
  @nullable = 'NO',
  'ALTER TABLE `consumables_users` MODIFY COLUMN `assigned_to` INT UNSIGNED NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '040_checkout_assigned_employee', 'Employee assignment columns for licenses/accessories/consumables'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '040_checkout_assigned_employee');

SET FOREIGN_KEY_CHECKS = 1;
