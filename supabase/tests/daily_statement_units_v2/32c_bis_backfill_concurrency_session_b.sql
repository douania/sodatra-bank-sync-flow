-- Session B starts while A holds the same canonical day lock. Once unblocked,
-- it must observe A's canonical unit and return duplicate without lines.
\set ON_ERROR_STOP on

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.bis_concurrency_deposit('b','bisc_b');
SELECT poc_test.ctx_set('bisc_b_commit_at',clock_timestamp()::text);
COMMIT;
