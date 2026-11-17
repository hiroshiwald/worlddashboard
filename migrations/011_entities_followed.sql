-- Operator's own follow list. status = 'tracked' means "known to the system"
-- (ingest adds those rows); followed = true means the operator pressed Track.
-- Only Track sets it; Ignore and Stop tracking clear it. Existing rows start false.
ALTER TABLE entities ADD COLUMN followed BOOLEAN NOT NULL DEFAULT false;
