-- 046: Multiple Ello conversations per battery degradation issue
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `battery_degradation_calls` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `issue_id` INT UNSIGNED NOT NULL,
  `sequence` INT UNSIGNED NOT NULL,
  `ello_agent_id` VARCHAR(64) NULL,
  `ello_conversation_id` VARCHAR(64) NULL,
  `ello_siptrunk_id` VARCHAR(64) NULL,
  `ello_call_status` VARCHAR(64) NULL,
  `bot_summary` TEXT NULL,
  `recording_url` VARCHAR(512) NULL,
  `transcript` JSON NULL,
  `duration` VARCHAR(32) NULL,
  `connected_at` VARCHAR(64) NULL,
  `ended_at` VARCHAR(64) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bdi_call_seq` (`issue_id`, `sequence`),
  KEY `idx_bdi_call_issue` (`issue_id`),
  KEY `idx_bdi_call_conversation` (`ello_conversation_id`),
  CONSTRAINT `fk_bdi_calls_issue` FOREIGN KEY (`issue_id`) REFERENCES `battery_degradation_issues` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `battery_degradation_calls` (
  `issue_id`, `sequence`, `ello_agent_id`, `ello_conversation_id`, `ello_siptrunk_id`,
  `ello_call_status`, `bot_summary`, `recording_url`, `transcript`, `created_at`, `updated_at`
)
SELECT
  i.`id`,
  1,
  i.`ello_agent_id`,
  i.`ello_conversation_id`,
  i.`ello_siptrunk_id`,
  i.`ello_call_status`,
  i.`bot_summary`,
  i.`recording_url`,
  i.`transcript`,
  i.`updated_at`,
  i.`updated_at`
FROM `battery_degradation_issues` i
WHERE i.`deleted_at` IS NULL
  AND i.`ello_conversation_id` IS NOT NULL
  AND i.`ello_conversation_id` != ''
  AND NOT EXISTS (
    SELECT 1 FROM `battery_degradation_calls` c WHERE c.`issue_id` = i.`id`
  );

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '046_battery_ello_conversations', 'Multiple Ello conversations per battery issue'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '046_battery_ello_conversations');

SET FOREIGN_KEY_CHECKS = 1;
