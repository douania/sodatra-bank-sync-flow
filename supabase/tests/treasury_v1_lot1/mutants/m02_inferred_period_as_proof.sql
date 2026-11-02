-- target: 40_balances.sql
-- Mutant : une période DÉDUITE (Excel ATB) est acceptée comme preuve.
ALTER TABLE treasury_private.supported_formats DISABLE TRIGGER treasury_supported_formats_append_only;
UPDATE treasury_private.supported_formats SET period_provenance = 'DECLARED' WHERE bank = 'ATB';
