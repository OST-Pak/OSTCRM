DROP TABLE IF EXISTS role_assignments;
DROP TABLE IF EXISTS users;
DROP TYPE IF EXISTS app_role;
DROP FUNCTION IF EXISTS app.refuse_change();
DROP FUNCTION IF EXISTS app.touch_row();
DROP FUNCTION IF EXISTS app.can_read();
DROP FUNCTION IF EXISTS app.is_signed_in();
DROP FUNCTION IF EXISTS app.role_in(text[]);
DROP FUNCTION IF EXISTS app.current_role();
DROP FUNCTION IF EXISTS app.current_user_id();
DROP FUNCTION IF EXISTS app.uuid_v7();
REVOKE USAGE ON SCHEMA public FROM app_user;
DROP SCHEMA IF EXISTS app;
-- app_user is a cluster-wide role shared across databases; it is left in place on purpose.
