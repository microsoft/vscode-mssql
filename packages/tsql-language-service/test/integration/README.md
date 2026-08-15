# T-SQL language service integration tests

This opt-in suite connects to a real SQL Server through `tedious` and exercises the public
simple-query metadata boundary plus language-service features. It is intentionally separate from
the deterministic unit and grammar tests.

1. Copy `.env.example` to `.env` in the package directory.
2. Set `TSQL_INTEGRATION_CONNECTION_STRING` to a test SQL Server.
3. Run `npm run test:integration`.

The suite skips when the variable is absent. Credentials are never stored in committed files.
Catalog queries use `WITH (NOLOCK)` and the current tests are read-only.
