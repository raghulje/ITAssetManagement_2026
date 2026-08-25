-- 036: Conservative location type backfill (Wave 2.2)
-- I3: all existing locations → UNSPECIFIED. No name-based guessing.
-- Does not change id, parent_id, company_id, name, or asset/inventory FKs.
SET NAMES utf8mb4;

SET @unspecified_id := (
  SELECT id FROM location_types WHERE code = 'UNSPECIFIED' LIMIT 1
);

UPDATE locations
SET location_type_id = @unspecified_id
WHERE location_type_id IS NULL
  AND @unspecified_id IS NOT NULL;

INSERT INTO `schema_migrations` (`version`, `description`)
SELECT '036_locations_unspecified_backfill', 'Backfill locations.location_type_id to UNSPECIFIED'
WHERE NOT EXISTS (SELECT 1 FROM `schema_migrations` WHERE `version` = '036_locations_unspecified_backfill');
