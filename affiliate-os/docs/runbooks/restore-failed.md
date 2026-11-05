# A restore did not verify

**Symptom:** after restoring a backup, the audit chain check fails or tables are missing.

**Check:**
1. `npm run migrate -w @affiliate-os/db -- status` against the restored database. Missing migrations mean the dump is older than the code: run `up`.
2. Run the audit verification for each organization (`auth.audit.verify`). A break at entry N means the rows after N were edited, removed, or the dump was taken mid-write.
3. Compare the latest audit anchor you stored outside the database with the restored chain: a shorter chain than the anchor means the backup predates it (data loss), not tampering.
4. Roles (`aff_app`, `aff_readonly`, `aff_provisioner`) are cluster-wide and are not in a per-database dump. Create them (migration 0001 does so idempotently).

**Act:** restore from the next-oldest backup, or accept the documented loss window; never "repair" audit rows by hand.

**Verify:** migrations current, every organization's chain verifies, `npm run e2e:pg`-style smoke (`/healthz`, `/readyz`, a sign-in) passes against the restored database.

**Note:** backup and restore automation does not exist yet (it is on the backlog), so this runbook has only been reasoned about.
