# T-SQL conformance corpus

This package-owned corpus makes the language-service conformance suite self-contained. Its initial
fixture set is vendored from ScriptDOM's `Test/SqlDom/TestScripts` directory. The files are copied
byte-for-byte; tests must decode each file according to the encoding recorded in `manifest.json`.

- Source: Microsoft SQL Script DOM
- Source repository: `https://msdata.visualstudio.com/SQLToolsAndLibraries/_git/ScriptDOM`
- Source commit: `9aec6298a36d6e27ca0f2ad574bb3fd80aea30f5`
- Source path: `Test/SqlDom/TestScripts`
- Imported: 2026-08-13
- License: MIT; see `LICENSE`
- Inventory: 489 files, 494,560 bytes

The corpus spans common SQL Server syntax, version-specific SQL Server syntax, Azure SQL,
Synapse/DW, Fabric, legacy compatibility forms, and four intentionally malformed recovery files.
Those dimensions are recorded as hints in `manifest.json`; they are not inferred at test time.

The conformance runner reports syntax coverage separately for:

1. SQL Server 2019 (`compatibilityLevel: 150`)
2. SQL Server 2022 (`compatibilityLevel: 160`)
3. SQL Server 2025 (`compatibilityLevel: 170`)
4. Azure SQL
5. Synapse/DW
6. Fabric
7. Intentional recovery fixtures

Vendoring this corpus does not make ScriptDOM an implementation dependency. The parser and
language-service code do not import or execute ScriptDOM.

After compiling the package, run `npm run report:corpus` to measure current conformance entirely
from this directory. `baseline.json` is a monotonic regression guard: every parseable fixture must
retain or reduce its raw Lezer recovery-node count. Regenerate it deliberately with
`npm run report:corpus -- --write-baseline` only after reviewing a parser improvement.
