# ADR 0002: Observed and modeled metrics are never mixed

**Status:** accepted. **Decision:** every metric row records `basis` and `source`. Clicks are observed by the link service; conversions only come from the provider; anything inferred is `modeled` and labelled. **Consequences:** dashboards can filter by basis; learning loops only train on observed data unless told otherwise.
