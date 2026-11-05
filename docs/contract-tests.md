# Contract tests from recorded Cloudflare responses (EC-102)

The console's mock (`test/mock-cf.js`) is only as good as its match with the real API. The recorder in `test/support/recorder.js` closes that gap.

**Record (needs a real token; run by a person, never in CI):**
1. Use a throwaway domain and a token with the narrowest permissions the screens you exercise need.
2. Build the client with `createCF({ token, apiBase, fetchImpl: recordingFetch('test/fixtures/cloudflare') })` and drive the calls (a small script is enough).
3. Fixtures are written redacted: secret-looking keys blanked, emails masked, 32-hex ids replaced by stable placeholders. **Read every file before committing.** Redaction is a safety net, not a guarantee.

**Replay (CI):** `replayFetch(dir)` serves the stored responses and throws on any request that has no recording, so drift shows up as a failing test.

Status: the harness is tested against the mock only. No real recordings are committed, so the committed-fixtures test is skipped.
