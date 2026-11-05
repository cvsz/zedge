-- Reverses 0001. Roles are cluster-wide and may be shared with other databases, so they are left in place.
DROP FUNCTION IF EXISTS aff_create_organization(text);
DROP TABLE IF EXISTS audit_entries, affiliate_links, creatives, content, campaigns, channels, brands, users, organizations CASCADE;
DROP FUNCTION IF EXISTS aff_creative_immutable();
DROP FUNCTION IF EXISTS aff_forbid_change();
DROP FUNCTION IF EXISTS aff_current_org();
