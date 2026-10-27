DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'admin') THEN
        CREATE ROLE admin LOGIN PASSWORD 'admin';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'keycloak') THEN
        CREATE ROLE keycloak LOGIN PASSWORD 'keycloak_password';
    END IF;
END
$$;


-- Create the database and assign ownership to the admin role
-- This ensures that the superuser cannot delete the database, but the admin role can manage it.
CREATE DATABASE txn_agg OWNER admin;
CREATE DATABASE keycloak OWNER keycloak;

