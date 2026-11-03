-- Lot 1 opérationnel, concurrence (R6, C9) : deux livraisons en attente,
-- déposées par le pipeline réel, support de deux courses à sessions réelles.
\set ON_ERROR_STOP on
SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_race_u', opx.deposit('race_u'));
SELECT opx.put('d_race_v', opx.deposit('race_v'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT opx.put('race_u_day', to_jsonb(opx.day_unit(opx.uid('d_race_u'))));
SELECT 'PASS 38a_decision_concurrency_setup' AS marker;
