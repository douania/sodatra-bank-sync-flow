-- Soldes à une date comptable D : couverture positive et absence de preuve,
-- journée provisoire, non close, disputée, chaîne rompue ou contredite après D,
-- compte absent ou inactif, solde historique, devise contradictoire, NSIA sans
-- format, absence de zéro par défaut, dates et fraîcheur. Lecture seule ;
-- rejouable dans une transaction (mutants).
\set ON_ERROR_STOP on

-- En tête : scénarios dont l'altération change le STATUT rendu (mutants m09,
-- m14, m19 à m21, m31 à m36), avant les contrôles de motifs et de provenance.
-- Période déclarée au-delà de la dernière ligne : rien n'est prouvé ; le 04,
-- prouvé par la ligne du 05 de l'export suivant, prend l'ouverture du 05.
SELECT tr_test.check('2026-10-01', 'ora_tail', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'ORA dernière ligne du premier fichier');
SELECT tr_test.check('2026-10-02', 'ora_tail', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'ORA période déclarée sans ligne ultérieure');
SELECT tr_test.check('2026-10-04', 'ora_tail', 'AVAILABLE', '20.00', '', 'ORA sans mouvement avant l''ouverture suivante');

-- Constat CTO P1 : une contradiction ou une incertitude portée par une journée
-- non résolue se propage aux dates postérieures jusqu'à sa résolution.
-- Journée disputée continue : la suivante s'appuie sur une clôture non résolue.
SELECT tr_test.check('2026-10-01', 'ora_pending_mid', 'AVAILABLE', '200.00', '', 'ORA avant la journée disputée');
SELECT tr_test.check('2026-10-02', 'ora_pending_mid', 'NOT_COVERED', NULL, 'DAY_CONTESTED', 'ORA journée retenue mais disputée');
SELECT tr_test.check('2026-10-03', 'ora_pending_mid', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ORA appui sur une clôture disputée');
-- Journée livrée seulement par une version non retenue, enjambée par la continuité.
SELECT tr_test.check('2026-10-02', 'ora_staged_mid', 'NOT_COVERED', NULL, 'DAY_CONTESTED', 'ORA journée livrée non retenue');
SELECT tr_test.check('2026-10-03', 'ora_staged_mid', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ORA continuité enjambant une journée non résolue');
-- L'ouverture d'une journée disputée est contrôlée : la rupture (1400 puis 9000)
-- bloque la journée disputée et les dates postérieures.
SELECT tr_test.check('2026-10-01', 'ora_dispute', 'BLOCKED', NULL, 'CHAIN_BROKEN_AFTER_DATE', 'ORA clôture contredite par la journée disputée');
SELECT tr_test.check('2026-10-02', 'ora_dispute', 'BLOCKED', NULL, 'CHAIN_BROKEN,DAY_CONTESTED', 'ORA rupture portée par la journée disputée');
SELECT tr_test.check('2026-10-03', 'ora_dispute', 'BLOCKED', NULL, 'CHAIN_BROKEN,CHAIN_UNPROVEN', 'ORA date postérieure à la journée disputée');
-- Report arrière : il vient de l'ouverture contrôlée, il ne prouve pas la continuité.
SELECT tr_test.check('2026-10-03', 'ora_back', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ORA report arrière d''une ouverture non continue');
SELECT tr_test.check('2026-10-04', 'ora_back', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ORA ouverture après un écart non prouvé');
-- Journée non résolue AVANT le premier relevé retenu : le premier ancrage n'est pas prouvé.
SELECT tr_test.check('2026-10-03', 'ora_lead_pending', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ORA report arrière après une journée disputée en amont');
SELECT tr_test.check('2026-10-04', 'ora_lead_pending', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ORA premier relevé après une journée disputée');
SELECT tr_test.check('2026-10-02', 'ora_first_pending', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ORA premier relevé après la livraison disputée');
SELECT tr_test.check('2026-10-01', 'ora_first_pending', 'NOT_COVERED', NULL, 'DAY_CONTESTED', 'ORA livraison disputée avant tout relevé retenu');
-- Une unité sans solde dérivable, qui ne se résoudra pas, n'empêche pas l'ancrage suivant.
SELECT tr_test.check('2026-10-04', 'bis_nobal_first', 'AVAILABLE', '510.00', '', 'BIS ancrage après une journée sans solde');
-- Clôture prouvée seulement par des fichiers dignes de preuve : ni identité non
-- corroborée, ni journée livrée à revoir.
SELECT tr_test.check('2026-10-01', 'ora_identity', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'ORA clôture par un fichier d''identité non corroborée');
SELECT tr_test.check('2026-10-04', 'ora_identity', 'NOT_COVERED', NULL, 'DAY_NOT_CLOSED', 'ORA clôture par un fichier à revoir');
-- Devise contrôlée jusqu'à l'unité qui fournit un solde reporté en arrière.
SELECT tr_test.check('2026-09-30', 'ora_cur', 'BLOCKED', NULL, 'CURRENCY_CONTRADICTION', 'ORA report arrière depuis une unité en EUR');

-- Journées disputées par un second export : non retenue, conflit, en attente.
-- L'incertitude se propage aux dates postérieures jusqu'à leur résolution.
SELECT tr_test.check('2026-10-01', 'ora_contest', 'AVAILABLE', '20.00', '', 'ORA avant les journées disputées');
SELECT tr_test.check('2026-10-02', 'ora_contest', 'NOT_COVERED', NULL, 'DAY_CONTESTED', 'ORA mouvement livré non retenu');
SELECT tr_test.check('2026-10-03', 'ora_contest', 'BLOCKED', NULL, 'CHAIN_UNPROVEN,DAY_CONFLICT', 'ORA journée en conflit');
SELECT tr_test.check('2026-10-04', 'ora_contest', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN', 'ORA journée suivant un conflit non résolu');
SELECT tr_test.check('2026-10-05', 'ora_contest', 'NOT_COVERED', NULL, 'CHAIN_UNPROVEN,DAY_CONTESTED', 'ORA journée en attente de revue');

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
  PERFORM tr_test.assert_eq(a -> 'dates' ->> 'bank_date_observed', '2026-10-09', 'date bancaire observée');
  PERFORM tr_test.assert_eq(a -> 'dates' ->> 'age_days', (treasury_private.today() - date '2026-10-09')::text, 'fraîcheur en jours');
  PERFORM tr_test.assert_eq(a -> 'dates' ->> 'balance_source_day', '2026-10-02', 'jour source du solde reporté');
  PERFORM tr_test.assert_eq(jsonb_array_length(a -> 'sources')::text, '4', 'unité, clôture, chaîne, période déclarée');
  s := a -> 'sources' -> 0;
  PERFORM tr_test.assert_eq(s ->> 'kind' || '/' || (s ->> 'role'), 'CANONICAL_UNIT/CLOSING', 'source 1 : clôture de l''unité');
  PERFORM tr_test.assert_eq(s ->> 'export_id', tr_test.id('e_ora_main')::text, 'référence du fichier de l''unité');
  PERFORM tr_test.assert(s ->> 'ingested_at' IS NOT NULL AND s ->> 'export_ingested_at' IS NOT NULL, 'ingestion de l''unité et de son export');
  s := a -> 'sources' -> 1;
  PERFORM tr_test.assert_eq(s ->> 'kind' || '/' || (s ->> 'later_line_day'), 'CLOSURE_LATER_LINE/2026-10-07', 'source 2 : ligne ultérieure');
  s := a -> 'sources' -> 2;
  PERFORM tr_test.assert_eq(s ->> 'kind' || '/' || (s ->> 'link') || '/' || (s ->> 'reference_day'), 'CHAIN_LINK/OK/2026-10-01',
    'source 3 : contrôle de chaîne');
  s := a -> 'sources' -> 3;
  PERFORM tr_test.assert_eq(s ->> 'kind', 'DECLARED_PERIOD', 'source 4 : période déclarée');
  PERFORM tr_test.assert_eq(s ->> 'period_start' || '/' || (s ->> 'closed_until'), '2026-10-01/2026-10-06', 'période et clôture');
  PERFORM tr_test.assert_eq(s ->> 'export_id', tr_test.id('e_ora_main')::text, 'référence du fichier probant');
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
SELECT tr_test.check('2026-10-06', 'ora_identity', 'NOT_COVERED', NULL, 'DAY_WITHOUT_PROOF', 'ORA export avec une journée à revoir');

-- Journées sans mouvement avant le premier mouvement d'une période déclarée :
-- solde = ouverture de la première unité, même non close.
SELECT tr_test.check('2026-09-29', 'ora_lead', 'AVAILABLE', '500.00', '', 'ORA amont prouvé');
SELECT tr_test.check('2026-09-27', 'ora_lead', 'NOT_COVERED', NULL, 'NO_STATEMENT', 'ORA avant toute période');

-- Constat CTO P2 (provenance), après les contrôles de statut : les preuves de
-- clôture et de continuité effectivement utilisées sont rendues, avec leurs
-- références et leurs dates.
DO $$
DECLARE a jsonb; s jsonb;
BEGIN
  -- Le 07 est clos par le fichier suivant (relivraison et ligne du 10).
  a := tr_test.account(tr_test.read_as('t_reader', '2026-10-07'), 'ora_main');
  PERFORM tr_test.assert_eq(jsonb_array_length(a -> 'sources')::text, '4', 'ORA 07 : unité, clôture, chaîne, période');
  s := a -> 'sources' -> 0;
  PERFORM tr_test.assert_eq(s ->> 'unit_id', tr_test.id('u_ora_main_07')::text, 'ORA 07 : unité source');
  s := a -> 'sources' -> 1;
  PERFORM tr_test.assert_eq(s ->> 'kind', 'CLOSURE_LATER_LINE', 'ORA 07 : preuve de clôture par ligne ultérieure');
  PERFORM tr_test.assert_eq(s ->> 'export_id', tr_test.id('e_ora_main_tail')::text, 'ORA 07 : fichier suivant probant');
  PERFORM tr_test.assert_eq(s ->> 'delivery' || '/' || (s ->> 'later_line_day'), 'duplicate/2026-10-10', 'ORA 07 : relivraison, ligne du 10');
  PERFORM tr_test.assert(s ->> 'export_ingested_at' IS NOT NULL, 'ORA 07 : dépôt du fichier probant');
  -- Ouverture du 07 comparée à la clôture du 05, reportée à travers le 06 prouvé sans mouvement.
  s := a -> 'sources' -> 2;
  PERFORM tr_test.assert_eq(s ->> 'link' || '/' || (s ->> 'reference_day'), 'OK/2026-10-05', 'ORA 07 : clôture comparée');
  s := a -> 'sources' -> 3;
  PERFORM tr_test.assert_eq(s ->> 'kind' || '/' || (s ->> 'export_id') || '/' || (s ->> 'closed_until'),
    'DECLARED_PERIOD/' || tr_test.id('e_ora_main')::text || '/2026-10-06', 'ORA 07 : période qui prouve le 06');
  -- Le 01 est clos par l'ouverture égale du 04, à travers les 02 et 03 prouvés sans
  -- mouvement par un troisième fichier ; le quatrième, sans ligne, ne prouve rien.
  a := tr_test.account(tr_test.read_as('t_reader', '2026-10-01'), 'ora_prov');
  PERFORM tr_test.assert_eq(jsonb_array_length(a -> 'sources')::text, '4', 'ORA preuve de continuité : quatre sources');
  s := a -> 'sources' -> 1;
  PERFORM tr_test.assert_eq(s ->> 'kind' || '/' || (s ->> 'unit_id') || '/' || (s ->> 'export_id'),
    'CLOSURE_NEXT_OPENING/' || tr_test.id('u_ora_prov_04')::text || '/' || tr_test.id('e_ora_prov_b')::text,
    'ORA preuve de continuité : unité suivante');
  s := a -> 'sources' -> 3;
  PERFORM tr_test.assert_eq(s ->> 'export_id' || '/' || (s ->> 'period_start') || '/' || (s ->> 'closed_until'),
    tr_test.id('e_ora_prov_c')::text || '/2026-10-02/2026-10-03', 'ORA preuve de continuité : période des 02 et 03');
  -- Le 01 est clos par l'ouverture égale du 02 (fichier suivant).
  a := tr_test.account(tr_test.read_as('t_reader', '2026-10-01'), 'ora_cont');
  s := a -> 'sources' -> 1;
  PERFORM tr_test.assert_eq(s ->> 'kind' || '/' || (s ->> 'day'), 'CLOSURE_NEXT_OPENING/2026-10-02', 'ORA continuité : unité suivante');
  PERFORM tr_test.assert_eq(s ->> 'export_id', tr_test.id('e_ora_cont_b')::text, 'ORA continuité : fichier de l''unité suivante');
  PERFORM tr_test.assert(s ->> 'unit_id' IS NOT NULL AND s ->> 'ingested_at' IS NOT NULL, 'ORA continuité : références et dates');
  PERFORM tr_test.assert_eq((a -> 'sources' -> 2) ->> 'link', 'ANCHOR', 'ORA continuité : premier relevé');
  -- Report arrière : ouverture de l'unité suivante, continuité et période prouvées.
  a := tr_test.account(tr_test.read_as('t_reader', '2026-10-04'), 'ora_tail');
  PERFORM tr_test.assert_eq(jsonb_array_length(a -> 'sources')::text, '3', 'ORA report arrière : trois sources');
  s := a -> 'sources' -> 0;
  PERFORM tr_test.assert_eq(s ->> 'role' || '/' || (s ->> 'day'), 'OPENING/2026-10-05', 'ORA report arrière : ouverture du 05');
  s := a -> 'sources' -> 1;
  PERFORM tr_test.assert_eq(s ->> 'link' || '/' || (s ->> 'reference_day'), 'CONTINUOUS_GAP/2026-10-01',
    'ORA report arrière : continuité avec la clôture du 01');
  s := a -> 'sources' -> 2;
  PERFORM tr_test.assert_eq(s ->> 'export_id' || '/' || (s ->> 'closed_until'), tr_test.id('e_ora_tail_b')::text || '/2026-10-04',
    'ORA report arrière : période déclarée probante');
  -- Contrôle de chaîne en échec rendu avec sa référence (solde observé, non retenu).
  a := tr_test.account(tr_test.read_as('t_reader', '2026-10-03'), 'ora_dispute');
  s := a -> 'sources' -> 2;
  PERFORM tr_test.assert_eq(s ->> 'link' || '/' || (s ->> 'reference_day'), 'UNPROVEN/2026-10-02',
    'ORA disputé : continuité non prouvée depuis la journée disputée');
END $$;

-- Constat CTO P2 (fraîcheur) : une date observée n'est pas une date couverte.
DO $$
DECLARE a jsonb;
BEGIN
  a := tr_test.account(tr_test.read_as('t_reader', '2026-10-02'), 'bdk_break');
  PERFORM tr_test.assert(jsonb_typeof(a -> 'dates' -> 'bank_date_covered') = 'null', 'BDK rupture : aucune date couverte');
  PERFORM tr_test.assert(jsonb_typeof(a -> 'dates' -> 'age_days') = 'null', 'BDK rupture : aucune fraîcheur');
  PERFORM tr_test.assert_eq(a -> 'dates' ->> 'bank_date_observed', '2026-10-02', 'BDK rupture : date observée');
  a := tr_test.account(tr_test.read_as('t_reader', '2026-10-05'), 'ora_contest');
  PERFORM tr_test.assert_eq((a -> 'dates' ->> 'bank_date_covered') || '/' || (a -> 'dates' ->> 'bank_date_observed'),
    '2026-10-01/2026-10-04', 'ORA contesté : couvert avant la dispute, observé ensuite');
END $$;

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
  PERFORM tr_test.assert_eq(c ->> 'accounts_expected', '32', 'dénominateur : 32 comptes XOF attendus');
  PERFORM tr_test.assert_eq(c ->> 'accounts_out_of_scope', '1', 'un compte hors périmètre listé à part');
  PERFORM tr_test.assert_eq(jsonb_array_length(r -> 'accounts')::text, '33', 'tous les comptes attendus restent listés');
  PERFORM tr_test.assert(c -> 'reasons' ? 'INVENTORY_NOT_ATTESTED', 'inventaire non attesté');
  PERFORM tr_test.assert(c -> 'reasons' ? 'REGISTRY_ACCOUNTS_OUTSIDE_INVENTORY', 'compte du registre hors inventaire signalé');
  PERFORM tr_test.assert(r -> 'inventory' -> 'unlisted_registry_accounts' @> jsonb_build_array(jsonb_build_object(
    'registry_account_id', tr_test.id('ora_unlisted'))), 'compte hors inventaire nommé');
  -- ORA 1200 + ATB 650 + BDK sans référence 20 + BDK intrajournalier 150 + ORA continuité 30
  -- + ORA preuve de continuité 200 : seuls comptes disponibles au 02.
  PERFORM tr_test.assert_eq(c ->> 'amount', '2250.00', 'sous-total des seuls comptes disponibles');
  PERFORM tr_test.assert_eq(c ->> 'accounts_available', '6', 'six comptes disponibles');
END $$;

-- Reproduction exacte du constat CTO P1 sur ORA principal (montants fictifs) :
-- le 21, disputé, ouvre sur 9000 après une clôture de 1400 le 20.
SET session_replication_role = replica;
SELECT tr_test.seed_export('cto_chain_a','ora_main','structured_bank_statement_csv','structured-csv-0b','2026-10-20','2026-10-23','2026-10-24');
SELECT tr_test.seed_unit('cto_chain_a','2026-10-20',1300,1400);
SELECT tr_test.seed_unit('cto_chain_a','2026-10-21',9000,9100);
SELECT tr_test.seed_unit('cto_chain_a','2026-10-22',9100,9200);
SELECT tr_test.seed_unit('cto_chain_a','2026-10-23',9200,9300);
SELECT tr_test.seed_export('cto_chain_b','ora_main','structured_bank_statement_csv','structured-csv-0b','2026-10-21','2026-10-21','2026-10-22');
SELECT tr_test.seed_unit('cto_chain_b','2026-10-21',9000,9110,p_staging_status=>'needs_review',p_canonical=>false);
SET session_replication_role = origin;
SELECT tr_test.check('2026-10-22', 'ora_main', 'BLOCKED', NULL, 'CHAIN_BROKEN,CHAIN_UNPROVEN', 'CTO P1 : date postérieure à la journée disputée');
SELECT tr_test.check('2026-10-07', 'ora_main', 'AVAILABLE', '1300.00', '', 'CTO P1 : dates antérieures inchangées');
SELECT tr_test.assert_eq((a -> 'dates' ->> 'bank_date_covered') || '/' || (a -> 'dates' ->> 'bank_date_observed'),
  '2026-10-09/2026-10-22', 'CTO P1 : couverture inchangée, observation distincte')
FROM tr_test.account(tr_test.read_as('t_reader', '2026-10-22'), 'ora_main') a;

-- Une seule définition : pour chaque compte, la date bancaire couverte est
-- exactement la dernière date D rendue disponible, quelle que soit la date lue.
DO $$
DECLARE v_bad text; v_with_cover integer;
BEGIN
  WITH reads AS (
    SELECT g::date AS d, tr_test.read_as('t_reader', g::date) AS r
    FROM generate_series(date '2026-09-20', date '2026-10-31', interval '1 day') g
  ), rows AS (
    SELECT rd.d, a ->> 'alias' AS alias, a ->> 'status' AS status, (a -> 'dates' ->> 'bank_date_covered')::date AS covered
    FROM reads rd, jsonb_array_elements(rd.r -> 'accounts') a
  ), per AS (
    SELECT alias, max(d) FILTER (WHERE status = 'AVAILABLE') AS last_available,
           count(DISTINCT coalesce(covered::text, '-')) AS variants, max(covered) AS covered
    FROM rows GROUP BY alias
  )
  SELECT string_agg(alias || ' ' || coalesce(last_available::text, '-') || ' / ' || coalesce(covered::text, '-'), '; '),
         (SELECT count(*) FROM per WHERE covered IS NOT NULL)
    INTO v_bad, v_with_cover
    FROM per WHERE variants <> 1 OR last_available IS DISTINCT FROM covered;
  PERFORM tr_test.assert(v_bad IS NULL, 'date couverte = dernière date disponible : ' || coalesce(v_bad, ''));
  PERFORM tr_test.assert(v_with_cover >= 10, 'au moins dix comptes couverts (propriété non vide)');
END $$;

-- Changement de qualification : pilote ou suspension rendent le compte non couvert.
SELECT treasury_private.set_bank_format_qualification('ORA', 'structured_bank_statement_csv', 'PILOT', 'tr-test:pilote',
  'Passage synthétique en pilote', 'operateur-test');
SELECT tr_test.check('2026-10-07', 'ora_main', 'NOT_COVERED', NULL, 'FORMAT_PILOT', 'ORA en pilote');
-- La couverture suit la qualification : un format en pilote ne couvre aucune date.
SELECT tr_test.assert(jsonb_typeof(a -> 'dates' -> 'bank_date_covered') = 'null'
                      AND a -> 'dates' ->> 'bank_date_observed' = '2026-10-22', 'ORA en pilote : observé, non couvert')
FROM tr_test.account(tr_test.read_as('t_reader', '2026-10-07'), 'ora_main') a;
SELECT treasury_private.set_bank_format_qualification('ORA', 'structured_bank_statement_csv', 'SUSPENDED', 'tr-test:suspension',
  'Suspension synthétique', 'operateur-test');
SELECT tr_test.check('2026-10-07', 'ora_main', 'NOT_COVERED', NULL, 'FORMAT_SUSPENDED', 'ORA suspendu');

SELECT 'PASS 40_balances' AS marker;
