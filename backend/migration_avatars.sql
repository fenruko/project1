-- Run against your EXISTING database to support profile pictures (photo or GIF).
-- psql -U chatapp_user -d chatapp -f migration_avatars.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_type TEXT; -- 'upload' or 'external' (e.g. GIPHY)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_value TEXT; -- storage key (upload) or direct URL (external)
