-- 053: Store classified types of other IT issues reported on the voice call
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battery_degradation_issues' AND COLUMN_NAME = 'other_issue_types'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `battery_degradation_issues` ADD COLUMN `other_issue_types` JSON NULL AFTER `other_issue_description`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '053_battery_other_issue_types', 'Classify and store other IT issue types from Battery Degradation calls'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '053_battery_other_issue_types');

SET FOREIGN_KEY_CHECKS = 1;
