-- grant-superuser.sql
-- Runs during docker-entrypoint-initdb.d as part of DB initialisation
-- Grants superuser to the app user so it can LOAD 'age' and create extensions

ALTER USER mms_admin SUPERUSER;
