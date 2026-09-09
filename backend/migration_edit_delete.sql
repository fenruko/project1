-- Run against your EXISTING database to support editing and deleting messages.
-- psql -U chatapp_user -d chatapp -f migration_edit_delete.sql

ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;
