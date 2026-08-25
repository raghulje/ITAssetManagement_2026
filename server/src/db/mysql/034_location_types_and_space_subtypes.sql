-- 034: Location type + space subtype masters (Wave 2.2)
-- Do NOT hardcode USE. The migrate runner / staging script already selects DB_NAME.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `location_types` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `description` VARCHAR(255) NULL,
  `hierarchy_level` INT NOT NULL DEFAULT 0,
  `is_space` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_location_types_code` (`code`),
  UNIQUE KEY `uk_location_types_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `space_subtypes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `description` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_space_subtypes_code` (`code`),
  UNIQUE KEY `uk_space_subtypes_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `location_types` (`name`, `code`, `description`, `hierarchy_level`, `is_space`, `is_active`, `created_at`, `updated_at`)
SELECT 'Unspecified', 'UNSPECIFIED', 'Legacy / unclassified physical location', 0, 0, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `location_types` WHERE `code` = 'UNSPECIFIED');

INSERT INTO `location_types` (`name`, `code`, `description`, `hierarchy_level`, `is_space`, `is_active`, `created_at`, `updated_at`)
SELECT 'Site', 'SITE', 'Site / campus / office location', 1, 0, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `location_types` WHERE `code` = 'SITE');

INSERT INTO `location_types` (`name`, `code`, `description`, `hierarchy_level`, `is_space`, `is_active`, `created_at`, `updated_at`)
SELECT 'Building', 'BUILDING', 'Building within a site', 2, 0, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `location_types` WHERE `code` = 'BUILDING');

INSERT INTO `location_types` (`name`, `code`, `description`, `hierarchy_level`, `is_space`, `is_active`, `created_at`, `updated_at`)
SELECT 'Floor', 'FLOOR', 'Floor within a building', 3, 0, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `location_types` WHERE `code` = 'FLOOR');

INSERT INTO `location_types` (`name`, `code`, `description`, `hierarchy_level`, `is_space`, `is_active`, `created_at`, `updated_at`)
SELECT 'Zone', 'ZONE', 'Zone on a floor', 4, 0, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `location_types` WHERE `code` = 'ZONE');

INSERT INTO `location_types` (`name`, `code`, `description`, `hierarchy_level`, `is_space`, `is_active`, `created_at`, `updated_at`)
SELECT 'Department Area', 'DEPARTMENT_AREA', 'Department area on a floor', 4, 0, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `location_types` WHERE `code` = 'DEPARTMENT_AREA');

INSERT INTO `location_types` (`name`, `code`, `description`, `hierarchy_level`, `is_space`, `is_active`, `created_at`, `updated_at`)
SELECT 'Space', 'SPACE', 'Assignable space (cabin, meeting room, workstation, …)', 5, 1, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `location_types` WHERE `code` = 'SPACE');

INSERT INTO `space_subtypes` (`name`, `code`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT 'Cabin', 'CABIN', 'Cabin / enclosed desk space', 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `space_subtypes` WHERE `code` = 'CABIN');

INSERT INTO `space_subtypes` (`name`, `code`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT 'Meeting Room', 'MEETING_ROOM', 'Meeting / conference room', 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `space_subtypes` WHERE `code` = 'MEETING_ROOM');

INSERT INTO `space_subtypes` (`name`, `code`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT 'Server Room', 'SERVER_ROOM', 'Server / IT room', 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `space_subtypes` WHERE `code` = 'SERVER_ROOM');

INSERT INTO `space_subtypes` (`name`, `code`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT 'Store Room', 'STORE_ROOM', 'Store / storage room', 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `space_subtypes` WHERE `code` = 'STORE_ROOM');

INSERT INTO `space_subtypes` (`name`, `code`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT 'Workstation', 'WORKSTATION', 'Workstation / desk', 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `space_subtypes` WHERE `code` = 'WORKSTATION');

INSERT INTO `space_subtypes` (`name`, `code`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT 'Other', 'OTHER', 'Other space subtype', 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `space_subtypes` WHERE `code` = 'OTHER');

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '034_location_types_and_space_subtypes', 'Create location_types and space_subtypes masters'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '034_location_types_and_space_subtypes');

SET FOREIGN_KEY_CHECKS = 1;
