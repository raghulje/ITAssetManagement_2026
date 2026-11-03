-- 015: Purge all seed / mock demo inventory and related rows (keep HRMS + real imports)

-- Component / license links on SNIPE assets
DELETE ca FROM components_assets ca
INNER JOIN assets a ON a.id = ca.asset_id
WHERE a.asset_tag LIKE 'SNIPE-%';

UPDATE license_seats ls
INNER JOIN assets a ON a.id = ls.asset_id
SET ls.asset_id = NULL, ls.updated_at = NOW()
WHERE a.asset_tag LIKE 'SNIPE-%';

DELETE m FROM maintenances m
INNER JOIN assets a ON a.id = m.asset_id
WHERE a.asset_tag LIKE 'SNIPE-%';

DELETE ca FROM checkout_acceptances ca
INNER JOIN assets a ON a.id = ca.checkoutable_id
WHERE ca.checkoutable_type = 'asset' AND a.asset_tag LIKE 'SNIPE-%';

UPDATE action_logs al
INNER JOIN assets a ON a.id = al.item_id AND al.item_type = 'asset'
SET al.deleted_at = NOW(), al.updated_at = NOW()
WHERE a.asset_tag LIKE 'SNIPE-%' AND al.deleted_at IS NULL;

UPDATE assets
SET deleted_at = NOW(), updated_at = NOW()
WHERE asset_tag LIKE 'SNIPE-%' AND deleted_at IS NULL;

-- Demo licenses + seats
DELETE FROM license_seats
WHERE license_id IN (
  SELECT id FROM (
    SELECT id FROM licenses
    WHERE name IN ('Microsoft 365 E3', 'Adobe Creative Cloud', 'JetBrains All Products')
  ) t
);

UPDATE licenses
SET deleted_at = NOW(), updated_at = NOW()
WHERE name IN ('Microsoft 365 E3', 'Adobe Creative Cloud', 'JetBrains All Products')
  AND deleted_at IS NULL;

-- Demo accessories / consumables / components
DELETE FROM accessories_checkout
WHERE accessory_id IN (
  SELECT id FROM (SELECT id FROM accessories WHERE name IN ('USB-C Hub', 'Logitech MX Master 3')) t
);
UPDATE accessories
SET deleted_at = NOW(), updated_at = NOW()
WHERE name IN ('USB-C Hub', 'Logitech MX Master 3') AND deleted_at IS NULL;

DELETE FROM consumables_users
WHERE consumable_id IN (
  SELECT id FROM (SELECT id FROM consumables WHERE name IN ('HP Toner 26A', 'AA Batteries (pack)')) t
);
UPDATE consumables
SET deleted_at = NOW(), updated_at = NOW()
WHERE name IN ('HP Toner 26A', 'AA Batteries (pack)') AND deleted_at IS NULL;

DELETE FROM components_assets
WHERE component_id IN (
  SELECT id FROM (SELECT id FROM components WHERE name IN ('16GB DDR4 SODIMM', '1TB NVMe SSD')) t
);
UPDATE components
SET deleted_at = NOW(), updated_at = NOW()
WHERE name IN ('16GB DDR4 SODIMM', '1TB NVMe SSD') AND deleted_at IS NULL;

-- Kits
DELETE FROM kits_models WHERE kit_id IN (SELECT id FROM (SELECT id FROM kits WHERE name IN ('Standard Engineer Kit', 'Sales Starter Kit')) t);
DELETE FROM kits_licenses WHERE kit_id IN (SELECT id FROM (SELECT id FROM kits WHERE name IN ('Standard Engineer Kit', 'Sales Starter Kit')) t);
DELETE FROM kits_accessories WHERE kit_id IN (SELECT id FROM (SELECT id FROM kits WHERE name IN ('Standard Engineer Kit', 'Sales Starter Kit')) t);
DELETE FROM kits_consumables WHERE kit_id IN (SELECT id FROM (SELECT id FROM kits WHERE name IN ('Standard Engineer Kit', 'Sales Starter Kit')) t);
DELETE FROM kits WHERE name IN ('Standard Engineer Kit', 'Sales Starter Kit');

-- Seed models unused by live (non-deleted) assets
UPDATE models m
SET m.deleted_at = NOW(), m.updated_at = NOW()
WHERE m.name IN (
  'MacBook Pro 14"', 'ThinkPad X1 Carbon', 'UltraSharp U2723QE',
  'iPhone 15', 'Surface Laptop 5', 'OptiPlex 7050'
)
AND m.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM assets a
  WHERE a.model_id = m.id AND a.deleted_at IS NULL
);

-- Demo suppliers
UPDATE suppliers
SET deleted_at = NOW(), updated_at = NOW()
WHERE name IN ('CDW', 'Dell Direct') AND deleted_at IS NULL;

-- Demo users (keep real admin / HRMS app users)
UPDATE users
SET deleted_at = NOW(), updated_at = NOW()
WHERE username IN ('jdoe', 'slee', 'akim') AND deleted_at IS NULL;

DELETE FROM checkout_requests WHERE user_id IN (
  SELECT id FROM (SELECT id FROM users WHERE username IN ('jdoe', 'slee', 'akim')) t
);

-- Fake import history rows
DELETE FROM imports WHERE name IN ('assets_aug.csv', 'users_q2.csv');

-- Acme / Contoso leftovers
UPDATE companies
SET deleted_at = NOW(), updated_at = NOW()
WHERE deleted_at IS NULL
  AND (
    name IN ('Acme Corp', 'Contoso Ltd', 'Manual Test Company XYZ')
    OR name LIKE 'Acme %'
    OR name LIKE 'Contoso %'
  );

UPDATE locations
SET deleted_at = NOW(), updated_at = NOW()
WHERE deleted_at IS NULL
  AND name IN (
    'HQ Warehouse', 'Floor 1', 'Floor 3', 'Remote',
    'Conference Room A', 'Repair Bench', 'Archive'
  )
  AND (notes IS NULL OR notes NOT LIKE 'Synced from HRMS%');

UPDATE settings SET default_currency = 'INR', updated_at = NOW() WHERE id = 1;

INSERT INTO schema_migrations (version, description)
SELECT '015_purge_all_mock_demo', 'Purge SNIPE/Acme/Jane Doe seed demo inventory'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '015_purge_all_mock_demo');
