-- Après la course : aucun rattachement sur une unité remise en revue.
SELECT pc_test.assert((SELECT status FROM public.payables_bank_match_proposals WHERE id = pc_test.id('match_race_rb')) = 'CONFIRMED',
  'rebind race: the previous confirmed match is untouched');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_bank_match_proposals WHERE line_id = pc_test.id('l_race_rb_r1')),
  'rebind race: nothing was bound to a line whose statement went under review');
SELECT 'PASS 79c_rebind_assert' AS marker;
