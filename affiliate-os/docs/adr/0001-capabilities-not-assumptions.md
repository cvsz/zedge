# ADR 0001: Providers declare capabilities; nothing is assumed

**Status:** accepted. **Decision:** each adapter publishes the capabilities it actually supports; unsupported ones are `manual` or `unsupported`, never faked with scraping or automation that breaks terms. **Consequences:** the system works with no platform API (manual adapter); verification of each capability is an explicit, recorded task.
