-- 057: QR-scan geo-tagged photos + 30s video for IT Asset Managers
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `asset_captures` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asset_id` INT UNSIGNED NOT NULL,
  `captured_by` INT UNSIGNED NULL,
  `storage_path` VARCHAR(500) NOT NULL,
  `original_name` VARCHAR(255) NULL,
  `mime_type` VARCHAR(128) NULL,
  `file_size` INT UNSIGNED NULL,
  `capture_kind` VARCHAR(16) NOT NULL DEFAULT 'photo' COMMENT 'photo | video',
  `captured_at` DATETIME NULL,
  `latitude` DECIMAL(10, 7) NULL,
  `longitude` DECIMAL(10, 7) NULL,
  `accuracy_m` DECIMAL(8, 2) NULL,
  `address` VARCHAR(500) NULL,
  `locality_header` VARCHAR(255) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_asset_captures_asset` (`asset_id`, `deleted_at`),
  KEY `idx_asset_captures_kind` (`capture_kind`),
  CONSTRAINT `fk_asset_captures_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_asset_captures_user` FOREIGN KEY (`captured_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '057_asset_qr_captures', 'QR scan geo-tagged photos and 30s video'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '057_asset_qr_captures');

SET FOREIGN_KEY_CHECKS = 1;
