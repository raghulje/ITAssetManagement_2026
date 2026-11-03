-- 060: P2P GRN / PO / invoice fields on assets, plus the IT user who registered the asset in the field.
-- Additive only. Do NOT hardcode USE.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'grn_number'
);
SET @sql := IF(@col = 0, 'ALTER TABLE `assets` ADD COLUMN `grn_number` VARCHAR(80) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'invoice_number'
);
SET @sql := IF(@col = 0, 'ALTER TABLE `assets` ADD COLUMN `invoice_number` VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'invoice_date'
);
SET @sql := IF(@col = 0, 'ALTER TABLE `assets` ADD COLUMN `invoice_date` DATE NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'po_number'
);
SET @sql := IF(@col = 0, 'ALTER TABLE `assets` ADD COLUMN `po_number` VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'p2p_line_key'
);
SET @sql := IF(@col = 0, 'ALTER TABLE `assets` ADD COLUMN `p2p_line_key` VARCHAR(191) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'p2p_payload'
);
SET @sql := IF(@col = 0, 'ALTER TABLE `assets` ADD COLUMN `p2p_payload` JSON NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'registered_by'
);
SET @sql := IF(@col = 0, 'ALTER TABLE `assets` ADD COLUMN `registered_by` INT UNSIGNED NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'registered_at'
);
SET @sql := IF(@col = 0, 'ALTER TABLE `assets` ADD COLUMN `registered_at` DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND INDEX_NAME = 'uk_assets_p2p_line_key'
);
SET @sql := IF(@idx = 0, 'ALTER TABLE `assets` ADD UNIQUE KEY `uk_assets_p2p_line_key` (`p2p_line_key`)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND INDEX_NAME = 'idx_assets_grn_number'
);
SET @sql := IF(@idx = 0, 'ALTER TABLE `assets` ADD KEY `idx_assets_grn_number` (`grn_number`)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND INDEX_NAME = 'idx_assets_po_number'
);
SET @sql := IF(@idx = 0, 'ALTER TABLE `assets` ADD KEY `idx_assets_po_number` (`po_number`)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND INDEX_NAME = 'idx_assets_invoice_number'
);
SET @sql := IF(@idx = 0, 'ALTER TABLE `assets` ADD KEY `idx_assets_invoice_number` (`invoice_number`)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND INDEX_NAME = 'idx_assets_registered_by'
);
SET @sql := IF(@idx = 0, 'ALTER TABLE `assets` ADD KEY `idx_assets_registered_by` (`registered_by`)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `p2p_grn_events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `grn_number` VARCHAR(80) NULL,
  `po_number` VARCHAR(100) NULL,
  `invoice_number` VARCHAR(100) NULL,
  `status` VARCHAR(32) NOT NULL,
  `payload` JSON NULL,
  `result` JSON NULL,
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_p2p_events_grn` (`grn_number`),
  KEY `idx_p2p_events_po` (`po_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing field captures already store the signed-in user. Copy that onto the asset.
UPDATE `assets` a
INNER JOIN (
  SELECT c.asset_id, c.captured_by, COALESCE(c.captured_at, c.created_at) AS captured_at
  FROM `asset_captures` c
  INNER JOIN (
    SELECT asset_id, MIN(id) AS id
    FROM `asset_captures`
    WHERE captured_by IS NOT NULL
    GROUP BY asset_id
  ) first_capture ON first_capture.id = c.id
) src ON src.asset_id = a.id
SET a.registered_by = src.captured_by,
    a.registered_at = COALESCE(a.registered_at, src.captured_at),
    a.created_by = COALESCE(a.created_by, src.captured_by)
WHERE a.registered_by IS NULL
  AND a.deleted_at IS NULL;

UPDATE `assets` a
INNER JOIN `label_codes` l ON l.asset_id = a.id AND l.registered_by IS NOT NULL
SET a.registered_by = l.registered_by,
    a.registered_at = COALESCE(a.registered_at, l.registered_at),
    a.created_by = COALESCE(a.created_by, l.registered_by)
WHERE a.registered_by IS NULL
  AND a.deleted_at IS NULL;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '060_p2p_grn_and_registrar', 'P2P GRN consumption fields and field registrar on assets'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '060_p2p_grn_and_registrar');

SET FOREIGN_KEY_CHECKS = 1;
