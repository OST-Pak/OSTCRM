DROP TABLE IF EXISTS idempotency_keys, outbox, errors, ai_runs;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tgname, tgrelid::regclass AS tbl FROM pg_trigger WHERE tgname LIKE '%\_audit' AND NOT tgisinternal LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.tbl);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS app.audit_row();
DROP TABLE IF EXISTS audit_log;
DROP FUNCTION IF EXISTS app.setting(text);
