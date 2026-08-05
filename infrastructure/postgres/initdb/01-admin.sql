DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'admin') THEN
        CREATE ROLE admin LOGIN PASSWORD 'admin';
    END IF;
END
$$;


-- Create the database and assign ownership to the admin role
-- This ensures that the superuser cannot delete the database, but the admin role can manage it.
CREATE DATABASE txn_agg OWNER admin;
