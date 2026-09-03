-- Init script for AIBOS Postgres+pgvector
-- Runs once on first container start.
-- Extensions are created in the target DB by Prisma migrate (via migrations/000_extensions),
-- so this file only configures a few server-level settings that should exist from day 1.

-- (No-op placeholder; Prisma handles CREATE EXTENSION.)
SELECT 1;
