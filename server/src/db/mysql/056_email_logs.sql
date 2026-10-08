-- 056: Outbound email delivery log (sent / failed / skipped, recipients)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `email_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email_type` VARCHAR(64) NOT NULL DEFAULT 'generic',
  `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
  `related_type` VARCHAR(64) NULL,
  `related_id` INT UNSIGNED NULL,
  `to_addresses` TEXT NOT NULL,
  `subject` VARCHAR(500) NOT NULL,
  `message_id` VARCHAR(255) NULL,
  `error_message` TEXT NULL,
  `meta_json` JSON NULL,
  `created_at` DATETIME NOT NULL,
  `sent_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_email_logs_created` (`created_at`),
  KEY `idx_email_logs_status` (`status`),
  KEY `idx_email_logs_type` (`email_type`),
  KEY `idx_email_logs_related` (`related_type`, `related_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '056_email_logs', 'Outbound email delivery log'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '056_email_logs');

SET FOREIGN_KEY_CHECKS = 1;
