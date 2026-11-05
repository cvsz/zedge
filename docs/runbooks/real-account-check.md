# Runbook: first run against a real Cloudflare account (EC-101)

1. Create a throwaway domain and a scoped API token with only the permissions for the screens you will try (README lists them). Note the expiry.
2. Start the console with `CLOUDFLARE_ACCOUNT_IDS` set to that account only, `APPROVAL_REQUIRED=1` off.
3. Walk each screen: create, change, delete one thing. Record any error text from Cloudflare.
4. For each mismatch, fix the payload and add a recorded-response contract test (EC-102) with secrets removed.
5. Take a snapshot before testing DNS and rules; confirm a restore works.
6. Revoke the token and delete the throwaway resources.
