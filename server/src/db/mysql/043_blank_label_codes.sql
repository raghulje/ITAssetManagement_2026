-- 043: Pre-printed blank QR / barcode labels (register on first scan)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `label_batches` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kind` VARCHAR(16) NOT NULL,
  `count` INT UNSIGNED NOT NULL,
  `created_by` INT UNSIGNED NULL,
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_label_batches_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `label_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `batch_id` INT UNSIGNED NOT NULL,
  `token` VARCHAR(64) NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'blank',
  `asset_id` INT UNSIGNED NULL,
  `qr_image_path` VARCHAR(255) NULL,
  `barcode_image_path` VARCHAR(255) NULL,
  `public_url` VARCHAR(512) NULL,
  `created_by` INT UNSIGNED NULL,
  `created_at` DATETIME NULL,
  `registered_at` DATETIME NULL,
  `registered_by` INT UNSIGNED NULL,
  `printed_at` DATETIME NULL,
  `print_count` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_label_codes_token` (`token`),
  UNIQUE KEY `uk_label_codes_code` (`code`),
  KEY `idx_label_codes_batch` (`batch_id`),
  KEY `idx_label_codes_status` (`status`),
  KEY `idx_label_codes_asset` (`asset_id`),
  CONSTRAINT `fk_label_codes_batch` FOREIGN KEY (`batch_id`) REFERENCES `label_batches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '043_blank_label_codes', 'Pre-printed blank QR/barcode labels registered on first scan'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '043_blank_label_codes');

SET FOREIGN_KEY_CHECKS = 1;
