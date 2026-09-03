-- ============================================================================
-- AIBOS — Initial migration
-- ============================================================================
-- This migration is the source of truth created by Prisma.
-- The companion file `migration.sql` (in the same folder) contains the
-- RLS policies + extension setup that Prisma does NOT generate.
--
-- Prisma will populate the schema below automatically; we keep this file
-- as the entry point so `prisma migrate deploy` runs the right scripts.
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- The complete Prisma-generated DDL is created from `schema.prisma`.
-- It is exported into this migration directory by running:
--   npx prisma migrate dev --name init
-- Once generated, the SQL produced by Prisma will be present as
-- `migration.sql` in this same directory.
-- ============================================================================
