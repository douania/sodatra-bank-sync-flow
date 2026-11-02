-- target: 12_access.sql
-- Mutant : une date D future est acceptée.
SELECT tr_test.mutate('public.treasury_balances_at_v1(date)', 'IF p_as_of > v_today THEN', 'IF false THEN');
