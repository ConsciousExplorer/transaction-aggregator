-- Categories first — rules resolve them by name (ids are GENERATED ALWAYS).
INSERT INTO categories (name) VALUES
  ('uncategorized'),
  ('groceries'),
  ('dining'),
  ('transport'),
  ('retail'),
  ('entertainment'),
  ('healthcare'),
  ('utilities'),
  ('transfers'),
  ('loan_repayment')
ON CONFLICT (name) DO NOTHING;

-- Rules v1. priority ascending = evaluation order, first match wins:
-- mcc map (100s) → source defaults (900s) → engine falls back to 'uncategorized'.
INSERT INTO categorization_rules
  (categorization_rule_id, version, priority, matcher_type, pattern, category_id, active)
VALUES
  (1,  1, 100, 'mcc', '5411',              (SELECT category_id FROM categories WHERE name = 'groceries'),     true),
  (2,  1, 101, 'mcc', '5812',              (SELECT category_id FROM categories WHERE name = 'dining'),        true),
  (3,  1, 102, 'mcc', '5814',              (SELECT category_id FROM categories WHERE name = 'dining'),        true),
  (4,  1, 103, 'mcc', '5541',              (SELECT category_id FROM categories WHERE name = 'transport'),     true),
  (5,  1, 104, 'mcc', '5912',              (SELECT category_id FROM categories WHERE name = 'healthcare'),    true),
  (6,  1, 105, 'mcc', '5999',              (SELECT category_id FROM categories WHERE name = 'retail'),        true),
  (7,  1, 106, 'mcc', '7832',              (SELECT category_id FROM categories WHERE name = 'entertainment'), true),
  (8,  1, 107, 'mcc', '4900',              (SELECT category_id FROM categories WHERE name = 'utilities'),     true),
  (9,  1, 900, 'source_default', 'loan',              (SELECT category_id FROM categories WHERE name = 'loan_repayment'), true),
  (10, 1, 901, 'source_default', 'internal_transfer', (SELECT category_id FROM categories WHERE name = 'transfers'),      true),
  (11, 1, 902, 'source_default', 'eft',               (SELECT category_id FROM categories WHERE name = 'transfers'),      true)
ON CONFLICT (categorization_rule_id) DO NOTHING;
