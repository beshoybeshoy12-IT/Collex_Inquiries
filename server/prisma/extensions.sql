-- Extensions the schema depends on.
-- `migrate deploy` runs this through the migration that creates it; `db push`
-- runs it via `npm run db:extensions` first, because push applies the schema
-- without running migrations and the trigram indexes below would fail with
-- "operator class gin_trgm_ops does not exist".
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
