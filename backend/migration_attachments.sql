-- Run this against your EXISTING database to add support for image/audio attachments.
-- psql -U chatapp_user -d chatapp -f migration_attachments.sql

ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type TEXT; -- 'image' or 'audio'
