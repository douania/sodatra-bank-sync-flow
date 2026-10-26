-- Montant en lettres : corpus commun avec amountInWords.synthetic.test.ts (§9-21).
CREATE TABLE pc_test.words_corpus (amount numeric, words text);
-- WORDS-BEGIN
INSERT INTO pc_test.words_corpus (amount, words) VALUES
  (0, 'zéro'),
  (1, 'un'),
  (16, 'seize'),
  (17, 'dix-sept'),
  (20, 'vingt'),
  (21, 'vingt et un'),
  (22, 'vingt-deux'),
  (70, 'soixante-dix'),
  (71, 'soixante et onze'),
  (72, 'soixante-douze'),
  (77, 'soixante-dix-sept'),
  (80, 'quatre-vingts'),
  (81, 'quatre-vingt-un'),
  (90, 'quatre-vingt-dix'),
  (91, 'quatre-vingt-onze'),
  (99, 'quatre-vingt-dix-neuf'),
  (100, 'cent'),
  (101, 'cent un'),
  (180, 'cent quatre-vingts'),
  (200, 'deux cents'),
  (201, 'deux cent un'),
  (280, 'deux cent quatre-vingts'),
  (300, 'trois cents'),
  (1000, 'mille'),
  (1001, 'mille un'),
  (1080, 'mille quatre-vingts'),
  (2000, 'deux mille'),
  (21000, 'vingt et un mille'),
  (80000, 'quatre-vingt mille'),
  (80080, 'quatre-vingt mille quatre-vingts'),
  (180000, 'cent quatre-vingt mille'),
  (200000, 'deux cent mille'),
  (1000000, 'un million'),
  (2000000, 'deux millions'),
  (80000000, 'quatre-vingts millions'),
  (200000000, 'deux cents millions'),
  (1000000000, 'un milliard'),
  (2000000000, 'deux milliards'),
  (777777777, 'sept cent soixante-dix-sept millions sept cent soixante-dix-sept mille sept cent soixante-dix-sept'),
  (999999999999, 'neuf cent quatre-vingt-dix-neuf milliards neuf cent quatre-vingt-dix-neuf millions neuf cent quatre-vingt-dix-neuf mille neuf cent quatre-vingt-dix-neuf');
-- WORDS-END

SELECT pc_test.assert(payables_private.amount_in_words_fr(c.amount) = c.words,
  format('amount %s → [%s], expected [%s]', c.amount, payables_private.amount_in_words_fr(c.amount), c.words))
FROM pc_test.words_corpus c;
SELECT pc_test.expect_error($$SELECT payables_private.amount_in_words_fr(1000000000000)$$, 'PAYABLES_AMOUNT_WORDS_RANGE');
SELECT pc_test.expect_error($$SELECT payables_private.amount_in_words_fr(10.5)$$, 'PAYABLES_AMOUNT_WORDS_RANGE');
SELECT pc_test.assert(payables_private.group_digits(1234567) = '1 234 567' AND payables_private.group_digits(999) = '999',
  'digit grouping');
SELECT pc_test.assert(payables_private.wrap_words('UN DEUX TROIS', 7) = ARRAY['UN DEUX', 'TROIS']
  AND payables_private.wrap_words('ABCDEFGH', 7) IS NULL, 'greedy wrapping');

SELECT 'PASS 15_amount_words_corpus' AS marker;
