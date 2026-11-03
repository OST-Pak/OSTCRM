-- When someone last checked a contact's details ("Mark checked" in the drawer). Contacts not checked in 90 days show as stale.
-- The artifact kept this as verifiedAt; the migration had parked it in extra, so carry it into the column.
ALTER TABLE contacts ADD COLUMN verified_on date;
UPDATE contacts SET verified_on = left(extra->>'verifiedAt', 10)::date, extra = extra - 'verifiedAt'
 WHERE extra->>'verifiedAt' ~ '^\d{4}-\d{2}-\d{2}';
