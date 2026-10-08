# sql-core

VS Code-independent SQL building blocks and data providers for agents and tools. The package does
not import `vscode`.

| Import                 | Contents                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sql-core`             | Shared building blocks: the `SqlReader` contract, T-SQL literal functions, platform detection, and SQL error categories. |
| `sql-core/performance` | Performance providers: top queries, active requests, and blocking chains.                                                |

- Callers supply a `SqlReader` that runs T-SQL and returns result sets. The MSSQL extension provides
  readers for the SQL data plane and the headless query executor.
- Readers do not bind parameters. Every value in generated SQL must go through a function in
  `literals`, which validates it first.
- Providers return codes, not display text. Callers localize the text.

## Commands

```bash
npm run build -- --target sql-core
npm test -- --target sql-core
npm run lint -- --target sql-core
```
