# Compliance notes

This is an operator's tool, not a regulated product, and nothing here is legal advice. Points that matter if you operate it for others:

- **Access control and separation of duties:** roles, per-user domains and optional two-person approval support least privilege.
- **Accountability:** the audit log records every change with the user and time and is tamper-evident; export it to your log store for long-term retention.
- **Credentials:** two-factor is supported; SSO is not yet (EC-104).
- **Cloudflare terms:** the console uses the public API with a token you control; it adds no workarounds. Follow Cloudflare's rate limits and acceptable-use terms for your plan.
- **Data location:** all console state is on your host.
