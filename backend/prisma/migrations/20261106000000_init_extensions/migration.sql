-- Phase 0: database extensions.
-- pg_trgm powers fuzzy college-name matching for the plain-words search (Phase 5).
-- Extensions are not modelled in the Prisma schema, so they are created here by hand.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
