UPDATE contacts SET extra = extra || jsonb_build_object('verifiedAt', verified_on::text) WHERE verified_on IS NOT NULL;
ALTER TABLE contacts DROP COLUMN verified_on;
