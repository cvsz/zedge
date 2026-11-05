-- Scheduling dates for content (AFF-007b). A SCHEDULED item must say when.
ALTER TABLE content ADD COLUMN scheduled_for timestamptz;
ALTER TABLE content ADD CONSTRAINT content_scheduled_has_date CHECK (status <> 'SCHEDULED' OR scheduled_for IS NOT NULL);
CREATE INDEX content_org_scheduled ON content (organization_id, scheduled_for) WHERE scheduled_for IS NOT NULL;
