-- Add initial actegories
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
  ('loan_repayment'),
  ('income'),
  ('insurance'),
  ('subscriptions'),
  ('fitness'),
  ('education'),
  ('recurring_payments')
ON CONFLICT (name) DO NOTHING;

-- 2. Ruleset
INSERT INTO rule_sets (version, notes) VALUES
  (1, 'Initial ruleset: 100% coverage of generator-emitted MCCs and debit-order creditors; every source has a default.')
ON CONFLICT (version) DO NOTHING;

-- 3. Rules
INSERT INTO categorization_rules (ruleset_version, priority, matcher_type, pattern, category_id)
SELECT 1, v.priority, v.matcher_type, v.pattern, c.category_id
FROM (VALUES
  -- mcc: exact match on transactions.mcc (card is the only source that carries one)
  (100, 'mcc', '5411', 'groceries'),
  (101, 'mcc', '5422', 'groceries'),
  (102, 'mcc', '5451', 'groceries'),
  (103, 'mcc', '5812', 'dining'),
  (104, 'mcc', '5813', 'dining'),
  (105, 'mcc', '5814', 'dining'),
  (106, 'mcc', '5541', 'transport'),
  (107, 'mcc', '5542', 'transport'),
  (108, 'mcc', '4121', 'transport'),
  (109, 'mcc', '5311', 'retail'),
  (110, 'mcc', '5611', 'retail'),
  (111, 'mcc', '5651', 'retail'),
  (112, 'mcc', '5815', 'entertainment'),
  (113, 'mcc', '7832', 'entertainment'),
  (114, 'mcc', '7841', 'entertainment'),
  (115, 'mcc', '5912', 'healthcare'),
  (116, 'mcc', '8011', 'healthcare'),
  (117, 'mcc', '8021', 'healthcare'),
  (118, 'mcc', '5999', 'retail'),
  (119, 'mcc', '4900', 'utilities'),

  -- keyword: case-insensitive string over merchant_name + description,
  (300, 'keyword', 'discovery life',    'insurance'),
  (301, 'keyword', 'old mutual',        'insurance'),
  (302, 'keyword', 'sanlam',            'insurance'),
  (303, 'keyword', 'momentum',          'insurance'),
  (304, 'keyword', 'outsurance',        'insurance'),
  (305, 'keyword', 'hollard',           'insurance'),
  (310, 'keyword', 'eskom',             'utilities'),
  (311, 'keyword', 'city of cape town', 'utilities'),
  (312, 'keyword', 'joburg water',      'utilities'),
  (313, 'keyword', 'telkom',            'utilities'),
  (320, 'keyword', 'dstv',              'subscriptions'),
  (321, 'keyword', 'netflix',           'subscriptions'),
  (322, 'keyword', 'showmax',           'subscriptions'),
  (323, 'keyword', 'spotify',           'subscriptions'),
  (324, 'keyword', 'apple music',       'subscriptions'),
  (330, 'keyword', 'virgin active',     'fitness'),
  (331, 'keyword', 'planet fitness',    'fitness'),
  (332, 'keyword', 'sweat1000',         'fitness'),
  (340, 'keyword', 'curro',             'education'),
  (341, 'keyword', 'reddam',            'education'),
  (342, 'keyword', 'crawford',          'education'),
  (350, 'keyword', 'capitec loans',     'loan_repayment'),
  (351, 'keyword', 'wesbank',           'loan_repayment'),
  (352, 'keyword', 'mfc',               'loan_repayment'),

  -- source_transaction_type: matches "{source}:{metadata.transaction_type}"
  (500, 'source_transaction_type', 'loan:repayment',    'loan_repayment'),
  (501, 'source_transaction_type', 'loan:disbursement', 'income'),

  -- source_default: default for each transactino source
  (900, 'source_default', 'card',              'uncategorized'),
  (901, 'source_default', 'loan',              'loan_repayment'),
  (902, 'source_default', 'debit_order',       'recurring_payments'),
  (903, 'source_default', 'eft',               'transfers'),
  (904, 'source_default', 'internal_transfer', 'transfers')
) AS v(priority, matcher_type, pattern, category_name)
JOIN categories c ON c.name = v.category_name
ON CONFLICT (ruleset_version, priority) DO NOTHING;