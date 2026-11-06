-- target: 25_inventory_rules.sql
-- Mutant : l'empreinte périmée redevient un échec de sérialisation (40001), rejoué en boucle par PostgREST.
SELECT tr_test.mutate('public.treasury_admin_attest_inventory_v1(text, text, text)',
  'ERRCODE = ''22023'', MESSAGE = ''TREASURY_INVENTORY_CHANGED''',
  'ERRCODE = ''40001'', MESSAGE = ''TREASURY_INVENTORY_CHANGED''');
