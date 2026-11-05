DROP INDEX IF EXISTS content_org_scheduled;
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_scheduled_has_date;
ALTER TABLE content DROP COLUMN IF EXISTS scheduled_for;
