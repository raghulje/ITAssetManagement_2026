-- 044: Battery Degradation Issue module (intake + voice transcript)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `battery_degradation_issues` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(64) NULL,
  `email` VARCHAR(191) NULL,
  `company` VARCHAR(191) NULL,
  `message` TEXT NULL,
  `bot_summary` TEXT NULL,
  `recording_url` VARCHAR(512) NULL,
  `recording_path` VARCHAR(255) NULL,
  `recording_mime` VARCHAR(128) NULL,
  `recording_original_name` VARCHAR(255) NULL,
  `transcript` JSON NULL,
  `tracker` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'in_progress',
  `created_by` INT UNSIGNED NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bdi_status` (`status`),
  KEY `idx_bdi_email` (`email`),
  KEY `idx_bdi_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `battery_degradation_issues` (
  `name`, `phone`, `email`, `company`, `message`, `bot_summary`,
  `transcript`, `tracker`, `status`, `created_at`, `updated_at`
)
SELECT
  'Rajesh Kumar',
  '9876543210',
  'rajesh.kumar@refex.com',
  'Refex Industries',
  'Department: IT Support — laptop battery draining within two hours on a full charge.',
  'The assistant contacted Rajesh Kumar about a reported laptop battery degradation issue. Rajesh confirmed the device is a Dell Latitude assigned from IT stock, that the battery lasts under two hours, and agreed to the call being recorded. The assistant asked whether the asset tag is visible and whether the device stays on charge overnight.',
  CAST('[
    {"speaker":"bot","text":"Hello, am I speaking to Rajesh Kumar?"},
    {"speaker":"user","text":"Yes."},
    {"speaker":"bot","text":"Hello Rajesh, this is Refex One from IT Asset Management. I see a battery degradation ticket for your laptop. Do you have a quick minute to discuss this?"},
    {"speaker":"user","text":"Yes."},
    {"speaker":"bot","text":"Great. I may record notes from this call so we do not miss anything for your battery issue. Is that okay with you?"},
    {"speaker":"user","text":"Okay."},
    {"speaker":"bot","text":"How long does the battery last after a full charge, and is the asset tag on the underside of the laptop?"},
    {"speaker":"user","text":"About two hours. Tag is REF-IT-1842."}
  ]' AS JSON),
  CAST('[
    {"key":"start","label":"Start","status":"completed","source":"Battery Degradation Issue","at":"2026-10-01 08:19:00"},
    {"key":"voice","label":"Voice Bot Conversation","status":"completed","source":"Refex IT","call_status":"Connected","duration":"48s"},
    {"key":"assign","label":"Assign technician","status":"skipped","source":"UserTask"},
    {"key":"summary","label":"Enter issue summary","status":"in_progress","assignee":"IT Asset Manager"},
    {"key":"completed","label":"Completed","status":"not_started","source":"Battery Degradation Issue"}
  ]' AS JSON),
  'in_progress',
  '2026-10-01 08:19:00',
  '2026-10-01 08:19:00'
WHERE NOT EXISTS (
  SELECT 1 FROM `battery_degradation_issues` WHERE `email` = 'rajesh.kumar@refex.com' AND `deleted_at` IS NULL
);

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '044_battery_degradation_issues', 'Battery Degradation Issue module'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '044_battery_degradation_issues');

SET FOREIGN_KEY_CHECKS = 1;
