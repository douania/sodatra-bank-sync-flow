-- Soldes à une date comptable D : couverture positive et absence de preuve,
-- journée provisoire, non close, disputée, chaîne rompue ou contredite après D,
-- compte absent ou inactif, solde historique, devise contradictoire, NSIA sans
-- format, absence de zéro par défaut, dates et fraîcheur. Lecture seule ;
-- rejouable dans une transaction (mutants).
\set ON_ERROR_STOP on

-- En tête : scénarios dont l'altération change le STATUT rendu (mutants m09,
-- m14, m19 à m21), avant les contrôles de motifs.
-- Période déclarée au-delà de la dernière ligne : rien n'est prouvé ; le 04,
-- prouvé par la ligne du 05 de l'export suivant, prend l'ouverture du 05.
SELECT tr_test.check('2026-10-01', 'ora_tail', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'ORA dernière ligne du premier fichier');
SELECT tr_test.check('2026-10-02', 'ora_tail', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'ORA période déclarée sans ligne ultérieure');
SELECT tr_test.check('2026-10-04', 'ora_tail', 'AVAILABLE', '20.00', '', 'ORA sans mouvement avant l''ouverture suivante');

-- Journées disputées par un second export : non retenue, conflit, en attente.
SELECT tr_test.check('2026-10-01', 'ora_contest', 'AVAILABLE', '20.00', '', 'ORA avant les journées disputées');
SELECT tr_test.check('2026-10-02', 'ora_contest', 'NOT_COVERED', NULL, 'DAY_CONTESTED', 'ORA mouvement livré non retenu');
SELECT tr_test.check('2026-10-03', 'ora_contest', 'BLOCKED', NULL, 'DAY_CONFLICT', 'ORA journée en conflit');
SELECT tr_test.check('2026-10-04', 'ora_contest', 'AVAILABLE', '40.00', '', 'ORA journée suivante, chaîne continue');
SELECT tr_test.check('2026-10-05', 'ora_contest', 'NOT_COVERED', NULL, 'DAY_CONTESTED', 'ORA journée en attente de revue');

-- Couverture positive : unités closes, journées sans mouvement d'une période
-- DÉCLARÉE dont le fichier porte une ligne ultérieure.
SELECT tr_test.check('2026-10-02', 'ora_main', 'AVAILABLE', '1200.00', '', 'ORA unité du jour');
SELECT tr_test.check('2026-10-04', 'ora_main', 'AVAILABLE', '1200.00', '', 'ORA dimanche prouvé sans mouvement');
SELECT tr_test.check('2026-10-06', 'ora_main', 'AVAILABLE', '1150.00', '', 'ORA mardi prouvé sans mouvement');
SELECT tr_test.check('2026-10-07', 'ora_main', 'AVAILABLE', '1300.00', '', 'ORA dernier relevé, clos par l''export suivant');
SELECT tr_test.check('2026-10-09', 'ora_main', 'AVAILABLE', '1300.00', '', 'ORA prouvé par la ligne ultérieure de l''export suivant');
SELECT tr_test.check('2026-10-10', 'ora_main', 'NOT_COVERED', NULL, 'PROVISIONAL_DAY', 'ORA journée provisoire');
-- Au-delà de la dernière ligne d'un export : aucune preuve, dernier solde montré à part.
SELECT tr_test.check('2026-10-11', 'ora_main', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'ORA après la dernière ligne');
SELECT tr_test.assert_eq(tr_test.account(tr_test.read_as('t_reader', '2026-10-11'), 'ora_main') -> 'observed_balance' ->> 'balance',
  '1300.00', 'ORA : dernier solde observé, non retenu');
SELECT tr_test.assert_eq(tr_test.account(tr_test.read_as('t_reader', '2026-10-11'), 'ora_main') -> 'observed_balance' ->> 'date',
  '2026-10-09', 'ORA : date du dernier solde observé');

-- Solde HISTORIQUE à D, pas le dernier solde connu.
SELECT tr_test.assert_eq(tr_test.account(tr_test.read_as('t_reader', '2026-10-02'), 'ora_main') -> 'dates' ->> 'balance_source_day',
  '2026-10-02', 'solde historique : source du jour D');

-- Dates séparées : date bancaire couverte, ingestion par source, instant de lecture.
DO $$
DECLARE r jsonb := tr_test.read_as('t_reader', '2026-10-04'); a jsonb := tr_test.account(r, 'ora_main'); s jsonb;
BEGIN
  PERFORM tr_test.assert_eq(r ->> 'as_of', '2026-10-04', 'date cible');
  PERFORM tr_test.assert(r ->> 'read_at' IS NOT NULL, 'instant de lecture');
  PERFORM tr_test.assert_eq(r ->> 'basis', 'ACCOUNTING_DATE', 'base : date comptable');
  PERFORM tr_test.assert_eq(a -> 'dates' ->> 'bank_date_covered', '2026-10-09', 'date bancaire couverte (toutes dates)');
  PERFORM tr_test.assert_eq(a -> 'dates' ->> 'age_days', (treasury_private.today() - date '2026-10-09')::text, 'fraîcheur en jours');
  PERFORM tr_test.assert_eq(a -> 'dates' ->> 'balance_source_day', '2026-10-02', 'jour source du solde reporté');
  PERFORM tr_test.assert_eq(jsonb_array_length(a -> 'sources')::text, '2', 'deux sources : unité et période déclarée');
  s := a -> 'sources' -> 0;
  PERFORM tr_test.assert_eq(s ->> 'kind', 'CANONICAL_UNIT', 'source 1 : unité');
  PERFORM tr_test.assert(s ->> 'ingested_at' IS NOT NULL AND s ->> 'export_ingested_at' IS NOT NULL, 'ingestion de l''unité et de son export');
  s := a -> 'sources' -> 1;
  PERFORM tr_test.assert_eq(s ->> 'kind', 'DECLARED_PERIOD', 'source 2 : période déclarée');
  PERFORM tr_test.assert_eq(s ->> 'period_start' || '/' || (s ->> 'closed_until'), '2026-10-01/2026-10-06', 'période et clôture');
  PERFORM tr_test.assert(s ->> 'export_ingested_at' IS NOT NULL, 'ingestion de la preuve');
  PERFORM tr_test.assert_eq(a -> 'value_dates' ->> 'total_lines', '4', 'lignes sur 90 jours au 04');
  PERFORM tr_test.assert_eq(a -> 'value_dates' ->> 'lines_with_value_date', '2', 'lignes datées en valeur');
  PERFORM tr_test.assert_eq(a ->> 'qualification', 'QUALIFIED', 'qualification ORA CSV');
END $$;

-- Période DÉDUITE (Excel) : aucune journée sans mouvement n'est prouvée.
SELECT tr_test.check('2026-10-03', 'atb_gap', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'ATB samedi sans preuve');
SELECT tr_test.check('2026-10-05', 'atb_gap', 'AVAILABLE', '700.00', '', 'ATB unité après un intervalle continu');

-- Chaîne rompue : la journée de la rupture ET la journée dont le solde est
-- contredit par l'ouverture suivante sont bloquées.
SELECT tr_test.check('2026-10-01', 'bdk_break', 'BLOCKED', NULL, 'CHAIN_BROKEN_AFTER_DATE', 'BDK clôture contredite le lendemain');
SELECT tr_test.check('2026-10-02', 'bdk_break', 'BLOCKED', NULL, 'CHAIN_BROKEN', 'BDK rupture');
SELECT tr_test.assert_eq(tr_test.account(tr_test.read_as('t_reader', '2026-10-01'), 'bdk_break') -> 'observed_balance' ->> 'balance',
  '900.00', 'BDK : solde contredit montré à part, non retenu');

-- Rupture POSTÉRIEURE à D à travers des journées prouvées sans mouvement : le
-- solde reporté est contredit par l'ouverture du 04, quelle que soit la date D.
SELECT tr_test.check('2026-10-01', 'ora_after', 'BLOCKED', NULL, 'CHAIN_BROKEN_AFTER_DATE', 'ORA unité contredite plus tard');
SELECT tr_test.check('2026-10-02', 'ora_after', 'BLOCKED', NULL, 'CHAIN_BROKEN_AFTER_DATE', 'ORA report contredit plus tard');
SELECT tr_test.check('2026-10-03', 'ora_after', 'BLOCKED', NULL, 'CHAIN_BROKEN_AFTER_DATE', 'ORA veille de la rupture');
SELECT tr_test.check('2026-10-04', 'ora_after', 'BLOCKED', NULL, 'CHAIN_BROKEN', 'ORA journée de la rupture');
-- Toute ouverture connue compte : la journée suivante à revoir contredit D.
SELECT tr_test.check('2026-10-01', 'ora_next', 'BLOCKED', NULL, 'CHAIN_BROKEN_AFTER_DATE', 'ORA contredit par une journée à revoir');
-- Écart à travers des journées sans ligne d'un même fichier : non couvert.
SELECT tr_test.check('2026-10-02', 'atb_weekend', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN_AFTER_DATE', 'ATB vendredi contredit le lundi');
SELECT tr_test.check('2026-10-05', 'atb_weekend', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ATB lundi après un écart');

-- Solde non dérivable : des lignes existent le 02, un écart ultérieur ne
-- contredit donc pas le solde du 01 ; il interdit les soldes suivants.
SELECT tr_test.check('2026-10-01', 'bis_gap', 'AVAILABLE', '110.00', '', 'BIS avant');
SELECT tr_test.check('2026-10-02', 'bis_gap', 'NOT_COVERED', NULL, 'BALANCE_NOT_DERIVED', 'BIS solde non dérivable');
SELECT tr_test.check('2026-10-05', 'bis_gap', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'BIS chaîne non prouvée');
-- La chaîne compare toute clôture canonique connue : aucun réancrage silencieux.
SELECT tr_test.check('2026-10-02', 'ora_reset', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ORA après une journée disputée');

-- Journée provisoire et format non qualifié.
SELECT tr_test.check('2026-10-02', 'bicis_prov', 'NOT_COVERED', NULL, 'FORMAT_NOT_QUALIFIED,PROVISIONAL_DAY', 'BICIS provisoire');
SELECT tr_test.check('2026-10-01', 'bicis_prov', 'NOT_COVERED', NULL, 'FORMAT_NOT_QUALIFIED', 'BICIS non qualifié');
SELECT tr_test.assert_eq(tr_test.account(tr_test.read_as('t_reader', '2026-10-01'), 'bicis_prov') -> 'observed_balance' ->> 'balance',
  '310.00', 'BICIS : solde observé montré à part, non retenu');

-- Devise contradictoire, hors périmètre, registre désactivé, compte absent, NSIA.
SELECT tr_test.check('2026-10-01', 'ora_cur', 'BLOCKED', NULL, 'CURRENCY_CONTRADICTION', 'ORA devise contradictoire');
SELECT tr_test.check('2026-10-01', 'eur_acc', 'OUT_OF_SCOPE', NULL, 'CURRENCY_OUT_OF_SCOPE', 'BDK EUR hors périmètre');
SELECT tr_test.check('2026-10-01', 'bridge_inactive', 'NOT_COVERED', NULL, 'NO_STATEMENT,REGISTRY_ACCOUNT_INACTIVE', 'BRIDGE désactivé');
SELECT tr_test.check('2026-10-01', 'x_bdk_future', 'NOT_COVERED', NULL, 'ACCOUNT_NOT_REGISTERED', 'BDK non enregistré');
SELECT tr_test.check('2026-10-01', 'x_nsia', 'NOT_COVERED', NULL, 'BANK_WITHOUT_FORMAT', 'NSIA sans format');
SELECT tr_test.assert_eq(tr_test.account(tr_test.read_as('t_reader', '2026-10-01'), 'x_nsia') ->> 'qualification',
  'NO_FORMAT', 'NSIA : sans format, sans faux compte Daily v2');
SELECT tr_test.assert((SELECT count(*) FROM public.daily_statement_account_registry WHERE bank = 'NSIA') = 0,
  'aucun compte NSIA créé dans Daily v2');
SELECT tr_test.check('2026-10-01', 'ora_nostmt', 'NOT_COVERED', NULL, 'NO_STATEMENT', 'ORA sans relevé');
SELECT tr_test.check('2026-10-01', 'ora_review', 'NOT_COVERED', NULL, 'UNIT_NEEDS_REVIEW', 'ORA relevé à revoir');

-- Sans date de référence : jours antérieurs à la dernière ligne prouvés ; la
-- dernière journée livrée n'est pas prouvée close, les jours suivants non plus.
SELECT tr_test.check('2026-10-02', 'bdk_noref', 'AVAILABLE', '20.00', '', 'BDK jour intérieur prouvé');
SELECT tr_test.check('2026-10-03', 'bdk_noref', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'BDK dernière journée livrée');
SELECT tr_test.check('2026-10-05', 'bdk_noref', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'BDK fin de période sans ligne');

-- Clôture confirmée par l'ouverture suivante, ou refusée si elle la contredit.
SELECT tr_test.check('2026-10-01', 'ora_cont', 'AVAILABLE', '20.00', '', 'ORA clôture confirmée par l''ouverture suivante');
SELECT tr_test.check('2026-10-03', 'ora_cont', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'ORA clôture non confirmée');
SELECT tr_test.check('2026-10-04', 'ora_cont', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ORA ouverture après une journée non close');

-- Export non entièrement accepté : sa période ne prouve rien ; la journée livrée
-- en conflit sans canonical active n'est pas « sans mouvement ».
SELECT tr_test.check('2026-10-02', 'ora_conflict', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'ORA export en conflit');
SELECT tr_test.check('2026-10-03', 'ora_conflict', 'NOT_COVERED', NULL, 'DAY_CONTESTED', 'ORA journée livrée non retenue');

-- Journée non close : le dépôt du 03 et la date de référence saisie au 04 ne
-- prouvent pas la fin du 03 ; une ligne datée après le dépôt non plus.
SELECT tr_test.check('2026-10-02', 'bdk_intraday', 'AVAILABLE', '150.00', '', 'BDK veille de la dernière ligne, prouvée');
SELECT tr_test.check('2026-10-03', 'bdk_intraday', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'BDK dernière ligne avant dépôt non close');
SELECT tr_test.check('2026-10-04', 'bdk_intraday', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'BDK référence saisie sans valeur de preuve');
SELECT tr_test.assert_eq(tr_test.account(tr_test.read_as('t_reader', '2026-10-03'), 'bdk_intraday') -> 'observed_balance' ->> 'balance',
  '150.00', 'BDK : dernier solde clos montré à part');
-- L'export du lendemain relivre le 03 avec une ligne du 04 : le 03 devient clos.
SET session_replication_role = replica;
SELECT tr_test.seed_export('e_bdk_intraday_next', 'bdk_intraday', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-03', '2026-10-04', NULL, p_created_at => '2026-10-04 08:00:00+00');
SELECT tr_test.seed_redelivery('e_bdk_intraday_next', 'u_bdk_intraday_03');
SELECT tr_test.seed_unit('e_bdk_intraday_next', '2026-10-04', 170, 175);
SET session_replication_role = origin;
SELECT tr_test.check('2026-10-03', 'bdk_intraday', 'AVAILABLE', '170.00', '', 'BDK journée close par l''export suivant');
SELECT tr_test.check('2026-10-04', 'bdk_intraday', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'BDK nouvelle dernière ligne non close');

-- Version de parseur non prise en charge.
SELECT tr_test.check('2026-10-01', 'ora_oldparser', 'NOT_COVERED', NULL, 'PARSER_VERSION_UNSUPPORTED', 'ORA ancien parseur');

-- Une période déclarée par un export à revoir ne prouve rien.
SELECT tr_test.check('2026-10-02', 'ora_identity', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'ORA identité non corroborée');
SELECT tr_test.check('2026-10-04', 'ora_identity', 'AVAILABLE', '25.00', '', 'ORA unité propre après un intervalle continu');
SELECT tr_test.check('2026-10-06', 'ora_identity', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'ORA export avec une journée à revoir');

-- Journées sans mouvement avant le premier mouvement d'une période déclarée :
-- solde = ouverture de la première unité, même non close.
SELECT tr_test.check('2026-09-29', 'ora_lead', 'AVAILABLE', '500.00', '', 'ORA amont prouvé');
SELECT tr_test.check('2026-09-27', 'ora_lead', 'NOT_COVERED', NULL, 'NO_STATEMENT', 'ORA avant toute période');

-- Absence de zéro par défaut : aucun solde rendu pour un compte non disponible,
-- aucun montant consolidé sans compte disponible.
DO $$
DECLARE r jsonb := tr_test.read_as('t_reader', '2026-10-02'); v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM jsonb_array_elements(r -> 'accounts') a
   WHERE a ->> 'status' <> 'AVAILABLE' AND jsonb_typeof(a -> 'balance_at_date') <> 'null';
  PERFORM tr_test.assert(v_bad = 0, 'aucun solde rendu hors statut disponible');
  SELECT count(*) INTO v_bad FROM jsonb_array_elements(r -> 'accounts') a
   WHERE a ->> 'balance_at_date' IN ('0', '0.00');
  PERFORM tr_test.assert(v_bad = 0, 'aucun zéro fabriqué');
  r := tr_test.read_as('t_reader', '2026-09-01');
  PERFORM tr_test.assert(jsonb_typeof(r -> 'consolidation' -> 'amount') = 'null', 'montant consolidé absent, jamais zéro');
  PERFORM tr_test.assert_eq(r -> 'consolidation' ->> 'accounts_available', '0', 'aucun compte disponible au 1er septembre');
END $$;

-- Consolidation de l'état courant : un compte bloqué bloque la ligne ; rien ne disparaît.
DO $$
DECLARE r jsonb := tr_test.read_as('t_reader', '2026-10-02'); c jsonb := r -> 'consolidation';
BEGIN
  PERFORM tr_test.assert_eq(c ->> 'status', 'BLOCKED', 'consolidation bloquée par les ruptures et la devise');
  PERFORM tr_test.assert_eq(c ->> 'accounts_expected', '24', 'dénominateur : 24 comptes XOF attendus');
  PERFORM tr_test.assert_eq(c ->> 'accounts_out_of_scope', '1', 'un compte hors périmètre listé à part');
  PERFORM tr_test.assert_eq(jsonb_array_length(r -> 'accounts')::text, '25', 'tous les comptes attendus restent listés');
  PERFORM tr_test.assert(c -> 'reasons' ? 'INVENTORY_NOT_ATTESTED', 'inventaire non attesté');
  PERFORM tr_test.assert(c -> 'reasons' ? 'REGISTRY_ACCOUNTS_OUTSIDE_INVENTORY', 'compte du registre hors inventaire signalé');
  PERFORM tr_test.assert(r -> 'inventory' -> 'unlisted_registry_accounts' @> jsonb_build_array(jsonb_build_object(
    'registry_account_id', tr_test.id('ora_unlisted'))), 'compte hors inventaire nommé');
  -- ORA 1200 + ATB 650 + BDK sans référence 20 + BDK intrajournalier 150 + ORA continuité 30 :
  -- seuls comptes disponibles au 02.
  PERFORM tr_test.assert_eq(c ->> 'amount', '2050.00', 'sous-total des seuls comptes disponibles');
  PERFORM tr_test.assert_eq(c ->> 'accounts_available', '5', 'cinq comptes disponibles');
END $$;

-- Changement de qualification : pilote ou suspension rendent le compte non couvert.
SELECT treasury_private.set_bank_format_qualification('ORA', 'structured_bank_statement_csv', 'PILOT', 'tr-test:pilote',
  'Passage synthétique en pilote', 'operateur-test');
SELECT tr_test.check('2026-10-07', 'ora_main', 'NOT_COVERED', NULL, 'FORMAT_PILOT', 'ORA en pilote');
SELECT treasury_private.set_bank_format_qualification('ORA', 'structured_bank_statement_csv', 'SUSPENDED', 'tr-test:suspension',
  'Suspension synthétique', 'operateur-test');
SELECT tr_test.check('2026-10-07', 'ora_main', 'NOT_COVERED', NULL, 'FORMAT_SUSPENDED', 'ORA suspendu');

SELECT 'PASS 40_balances' AS marker;
