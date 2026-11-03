-- 016: Indian English category / label wording
UPDATE categories
SET name = 'Mouse', updated_at = NOW()
WHERE name = 'Mice' AND deleted_at IS NULL;

UPDATE categories
SET name = 'Hub', updated_at = NOW()
WHERE name = 'Hubs' AND deleted_at IS NULL;

UPDATE categories
SET name = 'Battery', updated_at = NOW()
WHERE name = 'Batteries' AND deleted_at IS NULL;

INSERT INTO schema_migrations (version, description)
SELECT '016_indian_english_labels', 'Rename Mice/Hubs/Batteries to singular Indian-English labels'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '016_indian_english_labels');
