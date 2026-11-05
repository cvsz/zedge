# Runbooks

Written from the code, not from experience in production: **none of these has been exercised in a real incident or a drill.** Run each once in a test environment and correct it. Each one follows: symptom, check, act, verify, escalate.

- [dlq-growth.md](dlq-growth.md): dead letters are piling up
- [outbox-stuck.md](outbox-stuck.md): events are not leaving the outbox
- [auth-outage.md](auth-outage.md): nobody can sign in to the studio
- [restore-failed.md](restore-failed.md): a database restore did not verify
