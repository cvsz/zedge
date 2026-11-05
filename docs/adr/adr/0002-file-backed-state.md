# ADR 0002: File-backed state

**Status:** accepted. **Context:** a small self-hosted tool for a handful of users. **Decision:** JSON files with atomic replace and a JSONL audit chain in `DATA_DIR`; no database. **Consequences:** zero setup and easy backup (`scripts/backup.mjs`); single process only; revisit if multi-instance or many users are needed.
