-- Données Daily v2 synthétiques (registre, exports, unités, lignes) couvrant
-- chaque cas du GO. Mode réplica le temps de l'amorçage ; cohérence vérifiée.
-- Une journée n'est close que si un fichier qui la livre porte une ligne
-- ultérieure, ou si l'ouverture suivante retenue confirme sa clôture.
\set ON_ERROR_STOP on
SET session_replication_role = replica;

-- 1. ORA CSV, période déclarée : journées sans mouvement prouvées par les lignes
-- ultérieures. L'export suivant relivre le 07 avec une ligne (provisoire) du 10.
SELECT tr_test.seed_registry('ora_main', 'ORA', 'XOF', 'TR ORA principal');
SELECT tr_test.seed_export('e_ora_main', 'ora_main', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-07', '2026-10-08');
SELECT tr_test.put('u_ora_main_01', tr_test.seed_unit('e_ora_main', '2026-10-01', 1000, 1100, p_pairs => 1, p_value_dated => 2));
SELECT tr_test.seed_unit('e_ora_main', '2026-10-02', 1100, 1200);
SELECT tr_test.seed_unit('e_ora_main', '2026-10-05', 1200, 1150);
SELECT tr_test.put('u_ora_main_07', tr_test.seed_unit('e_ora_main', '2026-10-07', 1150, 1300));
SELECT tr_test.seed_export('e_ora_main_tail', 'ora_main', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-07', '2026-10-11', NULL);
SELECT tr_test.seed_redelivery('e_ora_main_tail', 'u_ora_main_07');
SELECT tr_test.seed_unit('e_ora_main_tail', '2026-10-10', 1300, 1310, p_staging_status => 'provisional', p_canonical => false);

-- 2. BDK CSV : chaîne rompue entre deux journées consécutives.
SELECT tr_test.seed_registry('bdk_break', 'BDK', 'XOF', 'TR BDK rupture');
SELECT tr_test.seed_export('e_bdk_break', 'bdk_break', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-03', '2026-10-04');
SELECT tr_test.seed_unit('e_bdk_break', '2026-10-01', 1000, 900);
SELECT tr_test.seed_unit('e_bdk_break', '2026-10-02', 950, 1000);
SELECT tr_test.seed_unit('e_bdk_break', '2026-10-03', 1000, 1010);

-- 3. ATB Excel : période DÉDUITE, aucune preuve des journées sans mouvement.
SELECT tr_test.seed_registry('atb_gap', 'ATB', 'XOF', 'TR ATB principal');
SELECT tr_test.seed_export('e_atb_gap', 'atb_gap', 'structured_bank_statement_xls', 'structured-excel-0q/atb-online-xls-v1',
  '2026-10-01', '2026-10-06', NULL);
SELECT tr_test.seed_unit('e_atb_gap', '2026-10-01', 500, 600);
SELECT tr_test.seed_unit('e_atb_gap', '2026-10-02', 600, 650);
SELECT tr_test.seed_unit('e_atb_gap', '2026-10-05', 650, 700);
SELECT tr_test.seed_unit('e_atb_gap', '2026-10-06', 700, 710);

-- 4. BIS Excel : solde non dérivable, puis discontinuité à travers des journées non prouvées.
SELECT tr_test.seed_registry('bis_gap', 'BIS', 'XOF', 'TR BIS principal');
SELECT tr_test.seed_export('e_bis_gap', 'bis_gap', 'structured_bank_statement_xls', 'structured-excel-0q/bis-online-xls-v1',
  '2026-10-01', '2026-10-06', NULL);
SELECT tr_test.seed_unit('e_bis_gap', '2026-10-01', 100, 110);
SELECT tr_test.seed_unit('e_bis_gap', '2026-10-02', NULL, NULL, p_aggregates => 'unavailable');
SELECT tr_test.seed_unit('e_bis_gap', '2026-10-05', 999, 1000);
SELECT tr_test.seed_unit('e_bis_gap', '2026-10-06', 1000, 1005);

-- 5. BICIS Excel non qualifié : journée provisoire le 02.
SELECT tr_test.seed_registry('bicis_prov', 'BICIS', 'XOF', 'TR BICIS principal');
SELECT tr_test.seed_export('e_bicis_prov', 'bicis_prov', 'structured_bank_statement_xls', 'structured-excel-0q/bicis-online-xls-v1',
  '2026-10-01', '2026-10-02', '2026-10-02');
SELECT tr_test.seed_unit('e_bicis_prov', '2026-10-01', 300, 310);
SELECT tr_test.seed_unit('e_bicis_prov', '2026-10-02', 310, 320, p_staging_status => 'provisional', p_canonical => false);

-- 6. ORA : devise des relevés contradictoire avec le registre.
SELECT tr_test.seed_registry('ora_cur', 'ORA', 'XOF', 'TR ORA devise');
SELECT tr_test.seed_export('e_ora_cur', 'ora_cur', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-02', '2026-10-03');
SELECT tr_test.seed_unit('e_ora_cur', '2026-10-01', 10, 20, p_unit_currency => 'EUR');
SELECT tr_test.seed_unit('e_ora_cur', '2026-10-02', 20, 30, p_unit_currency => 'EUR');

-- 7. BRIDGE : compte du registre désactivé après son ajout à l'inventaire (voir 20).
SELECT tr_test.seed_registry('bridge_inactive', 'BRIDGE', 'XOF', 'TR BRIDGE principal');
-- 8. BDK en EUR : hors périmètre.
SELECT tr_test.seed_registry('eur_acc', 'BDK', 'EUR', 'TR BDK euro');
-- 11. ORA : compte du registre hors inventaire.
SELECT tr_test.seed_registry('ora_unlisted', 'ORA', 'XOF', 'TR ORA hors inventaire');
-- 16. ORA : aucun relevé.
SELECT tr_test.seed_registry('ora_nostmt', 'ORA', 'XOF', 'TR ORA sans relevé');
-- Compte du registre servant au rattachement d'un compte attendu non enregistré.
SELECT tr_test.seed_registry('bdk_new', 'BDK', 'XOF', 'TR BDK nouveau');

-- 12. ORA : relevé à revoir.
SELECT tr_test.seed_registry('ora_review', 'ORA', 'XOF', 'TR ORA à revoir');
SELECT tr_test.seed_export('e_ora_review', 'ora_review', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-01', '2026-10-02');
SELECT tr_test.seed_unit('e_ora_review', '2026-10-01', 10, 20, p_validation => 'needs_review');

-- 13. BDK CSV sans date de référence (le pipeline ne rend aucune journée BDK
-- provisoire) : jours antérieurs à la dernière ligne prouvés ; la dernière
-- journée livrée et les jours suivants ne le sont pas.
SELECT tr_test.seed_registry('bdk_noref', 'BDK', 'XOF', 'TR BDK sans référence');
SELECT tr_test.seed_export('e_bdk_noref', 'bdk_noref', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-06', NULL);
SELECT tr_test.seed_unit('e_bdk_noref', '2026-10-01', 10, 20);
SELECT tr_test.seed_unit('e_bdk_noref', '2026-10-03', 20, 30);

-- 14. ORA : export non entièrement accepté (unité en conflit) : aucune preuve.
SELECT tr_test.seed_registry('ora_conflict', 'ORA', 'XOF', 'TR ORA conflit');
SELECT tr_test.seed_export('e_ora_conflict', 'ora_conflict', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-03', '2026-10-04');
SELECT tr_test.seed_unit('e_ora_conflict', '2026-10-01', 40, 50);
SELECT tr_test.seed_unit('e_ora_conflict', '2026-10-03', 50, 60, p_staging_status => 'conflict', p_canonical => false);

-- 15. ORA : journées sans mouvement AVANT le premier mouvement, dans la période
-- déclarée : solde = ouverture (toujours connue) de la première unité.
SELECT tr_test.seed_registry('ora_lead', 'ORA', 'XOF', 'TR ORA amont');
SELECT tr_test.seed_export('e_ora_lead', 'ora_lead', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-09-28', '2026-10-02', '2026-10-03');
SELECT tr_test.seed_unit('e_ora_lead', '2026-10-01', 500, 600);

-- 17. ORA : l'ouverture du 04 contredit le solde du 01 reporté à travers des
-- journées prouvées sans mouvement (rupture POSTÉRIEURE aux dates 01 à 03).
SELECT tr_test.seed_registry('ora_after', 'ORA', 'XOF', 'TR ORA rupture ultérieure');
SELECT tr_test.seed_export('e_ora_after', 'ora_after', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-05', '2026-10-06');
SELECT tr_test.seed_unit('e_ora_after', '2026-10-01', 100, 200);
SELECT tr_test.seed_unit('e_ora_after', '2026-10-04', 250, 300);
SELECT tr_test.seed_unit('e_ora_after', '2026-10-05', 300, 310);

-- 18. BDK : export déposé le 03 à 11 h (Dakar), date de référence saisie au 04,
-- avec une ligne datée du 05 (postérieure au dépôt : aucune valeur de preuve).
SELECT tr_test.seed_registry('bdk_intraday', 'BDK', 'XOF', 'TR BDK intrajournalier');
SELECT tr_test.seed_export('e_bdk_intraday', 'bdk_intraday', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-05', '2026-10-04', p_created_at => '2026-10-03 11:00:00+00');
SELECT tr_test.seed_unit('e_bdk_intraday', '2026-10-01', 100, 150);
SELECT tr_test.put('u_bdk_intraday_03', tr_test.seed_unit('e_bdk_intraday', '2026-10-03', 150, 170));
SELECT tr_test.seed_unit('e_bdk_intraday', '2026-10-05', 170, 180, p_staging_status => 'provisional', p_canonical => false);

-- 19. ORA : un second export dispute les journées du premier (02 non retenu,
-- 03 en conflit, 05 en attente de revue).
SELECT tr_test.seed_registry('ora_contest', 'ORA', 'XOF', 'TR ORA contesté');
SELECT tr_test.seed_export('e_ora_contest', 'ora_contest', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-06', '2026-10-07');
SELECT tr_test.seed_unit('e_ora_contest', '2026-10-01', 10, 20);
SELECT tr_test.seed_unit('e_ora_contest', '2026-10-03', 20, 30);
SELECT tr_test.seed_unit('e_ora_contest', '2026-10-04', 30, 40);
SELECT tr_test.seed_unit('e_ora_contest', '2026-10-05', 40, 50);
SELECT tr_test.seed_unit('e_ora_contest', '2026-10-06', 50, 60);
SELECT tr_test.seed_export('e_ora_contest2', 'ora_contest', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-05', '2026-10-06');
SELECT tr_test.seed_unit('e_ora_contest2', '2026-10-02', 20, 25, p_staging_status => 'staged', p_canonical => false);
SELECT tr_test.seed_unit('e_ora_contest2', '2026-10-03', 20, 35, p_staging_status => 'conflict', p_canonical => false);
SELECT tr_test.seed_unit('e_ora_contest2', '2026-10-05', 40, 45, p_staging_status => 'needs_review', p_canonical => false);

-- 20. ORA : unité produite par une version de parseur non prise en charge.
SELECT tr_test.seed_registry('ora_oldparser', 'ORA', 'XOF', 'TR ORA ancien parseur');
SELECT tr_test.seed_export('e_ora_oldparser', 'ora_oldparser', 'structured_bank_statement_csv', 'structured-csv-0a',
  '2026-10-01', '2026-10-02', '2026-10-03');
SELECT tr_test.seed_unit('e_ora_oldparser', '2026-10-01', 10, 20);
SELECT tr_test.seed_unit('e_ora_oldparser', '2026-10-02', 20, 30);

-- 21. ORA : les journées 02-03 ne sont déclarées sans mouvement que par un
-- export à revoir (identité de compte non corroborée) ; les journées 05-07, que
-- par un export dont une journée livrée est à revoir.
SELECT tr_test.seed_registry('ora_identity', 'ORA', 'XOF', 'TR ORA identité');
SELECT tr_test.seed_export('e_ora_id1', 'ora_identity', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-01', '2026-10-02');
SELECT tr_test.put('u_ora_id_01', tr_test.seed_unit('e_ora_id1', '2026-10-01', 10, 20));
SELECT tr_test.seed_export('e_ora_id4', 'ora_identity', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-04', '2026-10-04', '2026-10-05');
SELECT tr_test.put('u_ora_id_04', tr_test.seed_unit('e_ora_id4', '2026-10-04', 20, 25));
SELECT tr_test.seed_export('e_ora_id8', 'ora_identity', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-08', '2026-10-08', '2026-10-09');
SELECT tr_test.put('u_ora_id_08', tr_test.seed_unit('e_ora_id8', '2026-10-08', 25, 30));
SELECT tr_test.seed_export('e_ora_id_coded', 'ora_identity', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-04', '2026-10-05', p_codes => ARRAY['ACCOUNT_IDENTITY_NOT_CORROBORATED']);
SELECT tr_test.seed_redelivery('e_ora_id_coded', 'u_ora_id_01');
SELECT tr_test.seed_redelivery('e_ora_id_coded', 'u_ora_id_04');
SELECT tr_test.seed_export('e_ora_id_review', 'ora_identity', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-04', '2026-10-08', '2026-10-09');
SELECT tr_test.seed_redelivery('e_ora_id_review', 'u_ora_id_04', p_validation => 'needs_review',
  p_codes => ARRAY['RUNNING_BALANCE_CHAIN_INCOHERENT']);
SELECT tr_test.seed_redelivery('e_ora_id_review', 'u_ora_id_08');

-- 22. ORA : la journée suivant D, retenue mais à revoir, ouvre sur un autre solde.
SELECT tr_test.seed_registry('ora_next', 'ORA', 'XOF', 'TR ORA suivante à revoir');
SELECT tr_test.seed_export('e_ora_next', 'ora_next', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-03', '2026-10-04');
SELECT tr_test.seed_unit('e_ora_next', '2026-10-01', 100, 200);
SELECT tr_test.seed_unit('e_ora_next', '2026-10-02', 500, 600, p_validation => 'needs_review');
SELECT tr_test.seed_unit('e_ora_next', '2026-10-03', 600, 610);

-- 23. ATB Excel : un même fichier du vendredi 02 au mardi 06 ; le lundi ouvre
-- sur un autre solde que la clôture du vendredi, sans ligne le week-end.
SELECT tr_test.seed_registry('atb_weekend', 'ATB', 'XOF', 'TR ATB week-end');
SELECT tr_test.seed_export('e_atb_weekend', 'atb_weekend', 'structured_bank_statement_xls', 'structured-excel-0q/atb-online-xls-v1',
  '2026-10-02', '2026-10-06', NULL);
SELECT tr_test.seed_unit('e_atb_weekend', '2026-10-02', 100, 200);
SELECT tr_test.seed_unit('e_atb_weekend', '2026-10-05', 500, 550);
SELECT tr_test.seed_unit('e_atb_weekend', '2026-10-06', 550, 560);

-- 24. ORA : dernière journée de trois fichiers successifs ; le 01 est confirmé par
-- l'ouverture du 02, le 03 contredit par celle du 04.
SELECT tr_test.seed_registry('ora_cont', 'ORA', 'XOF', 'TR ORA continuité');
SELECT tr_test.seed_export('e_ora_cont_a', 'ora_cont', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-01', '2026-10-02');
SELECT tr_test.seed_unit('e_ora_cont_a', '2026-10-01', 10, 20);
SELECT tr_test.seed_export('e_ora_cont_b', 'ora_cont', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-02', '2026-10-03', '2026-10-04');
SELECT tr_test.seed_unit('e_ora_cont_b', '2026-10-02', 20, 30);
SELECT tr_test.seed_unit('e_ora_cont_b', '2026-10-03', 30, 40);
SELECT tr_test.seed_export('e_ora_cont_c', 'ora_cont', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-04', '2026-10-05', '2026-10-06');
SELECT tr_test.seed_unit('e_ora_cont_c', '2026-10-04', 45, 50);
SELECT tr_test.seed_unit('e_ora_cont_c', '2026-10-05', 50, 55);

-- 25. ORA : la première journée est disputée (version en attente) ; l'ouverture
-- du 02 contredit sa clôture. La chaîne ne se réancre pas sur le 02.
SELECT tr_test.seed_registry('ora_reset', 'ORA', 'XOF', 'TR ORA réancrage');
SELECT tr_test.seed_export('e_ora_reset', 'ora_reset', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-03', '2026-10-04');
SELECT tr_test.seed_unit('e_ora_reset', '2026-10-01', 100, 200);
SELECT tr_test.seed_unit('e_ora_reset', '2026-10-02', 900, 1000);
SELECT tr_test.seed_unit('e_ora_reset', '2026-10-03', 1000, 1010);
SELECT tr_test.seed_export('e_ora_reset2', 'ora_reset', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-01', '2026-10-02');
SELECT tr_test.seed_unit('e_ora_reset2', '2026-10-01', 100, 210, p_staging_status => 'needs_review', p_canonical => false);

-- 26. ORA : la période déclarée du premier fichier dépasse sa dernière ligne (01) ;
-- le second fichier prouve le 04 sans mouvement par sa ligne du 05.
SELECT tr_test.seed_registry('ora_tail', 'ORA', 'XOF', 'TR ORA fin de période');
SELECT tr_test.seed_export('e_ora_tail_a', 'ora_tail', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-01', '2026-10-03', NULL);
SELECT tr_test.seed_unit('e_ora_tail_a', '2026-10-01', 10, 20);
SELECT tr_test.seed_export('e_ora_tail_b', 'ora_tail', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-04', '2026-10-05', NULL);
SELECT tr_test.seed_unit('e_ora_tail_b', '2026-10-05', 20, 30);

SET session_replication_role = origin;
SELECT tr_test.assert_seed_consistent();

SELECT 'PASS 35_seed_daily_v2' AS marker;
