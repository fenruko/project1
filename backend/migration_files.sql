-- Run against your EXISTING database to support any file type as an attachment,
-- not just image/audio, by storing the original filename and size.
-- psql -U chatapp_user -d chatapp -f migration_files.sql

ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;
