-- Rename deployable default status for Refex wording
UPDATE status_labels
SET name = 'In Stock', updated_at = NOW()
WHERE name IN ('Ready to Assign', 'Ready to Deploy')
  AND type = 'deployable'
  AND deleted_at IS NULL;

INSERT INTO schema_migrations (version, description)
SELECT '014_status_in_stock', 'Rename Ready to Assign status label to In Stock'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '014_status_in_stock');
