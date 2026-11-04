-- 061: Consultants who can be assigned assets. Code is CON-0001, CON-0002, ...
-- Additive only. Do NOT hardcode USE.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `consultants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `consultant_code` VARCHAR(16) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL DEFAULT '',
  `email` VARCHAR(191) NULL,
  `phone` VARCHAR(64) NULL,
  `company_name` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_consultants_code` (`consultant_code`),
  KEY `idx_consultants_name` (`first_name`, `last_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `assets`
  MODIFY COLUMN `assigned_type` ENUM('user','location','asset','employee','consultant') NULL;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '061_consultants', 'Consultants directory with CON-0001 style ids'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '061_consultants');

SET FOREIGN_KEY_CHECKS = 1;
