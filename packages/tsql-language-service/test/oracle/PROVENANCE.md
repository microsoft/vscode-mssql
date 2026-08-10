# Provenance and licensing

The behavior reference audited for this directory is the local
`C:\Users\aaskhan\src\SqlParser` repository. Its component license is
`src/Microsoft/SqlServer/Management/SqlParser/LICENSE.md`, titled “SQL Server Shared Management
Objects (SMO) License Terms.” Those terms are not the MIT license used by vscode-mssql and include
specific source-code distribution restrictions.

The audit was performed at SqlParser revision
`41286b483f1a3d66f8cc57f7458868ec61ac6888`. The configured origin was the internal Azure DevOps
SqlParser repository. Path citations should therefore be interpreted relative to that revision;
they are not links that public consumers are expected to access.

For that reason:

- No SqlParser C# implementation, generated parser material, XML baseline, expected-result block,
  metadata cache, or test harness was copied into this package.
- Fixture SQL uses independently authored, short examples and synthetic `OracleDb` objects. It
  expresses commonplace T-SQL behavior rather than reproducing the AdventureWorks test corpus.
- `provenance` values are path citations identifying where a behavior was observed. They are not
  runtime dependencies, copied content, or an assertion that SqlParser's exact diagnostic wording is
  required.
- Diagnostic expectations use neutral families such as `unknown-object` and exact source spans,
  rather than copying SQL Server/SqlParser messages or numeric error text.

Any future proposal to import SqlParser source, baselines, metadata-cache files, or mechanically
translated test bodies should receive a separate licensing review and update third-party notices as
required. Behavioral reimplementation should continue to use clean, independently written fixtures
like these.
