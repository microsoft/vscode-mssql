# Capability matrix

Status meanings:

- **Implemented**: shipped through the package contract with automated correctness tests.
- **Partial**: useful coverage exists, but important supported-language cases remain.
- **Experimental**: implemented and tested, but the extension integration or operational envelope
  still needs broader evaluation.
- **Planned**: intentionally outside the current public contract.

| Capability                        | Status       | Current boundary                                                                                                                                                                                               |
| --------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lossless T-SQL lexing and parsing | Partial      | Broad modern SQL Server, Azure SQL, Synapse, and Fabric coverage; the conformance baseline still records recovery in uncommon constructs.                                                                      |
| Incremental syntax                | Implemented  | Native Lezer fragments plus unchanged GO-chunk reuse; a single batch may still require whole-batch work.                                                                                                       |
| SQLCMD projection and mapping     | Experimental | Direct, worker, and preview routes are mapped; included-file authoring remains host-owned.                                                                                                                     |
| Semantic binding                  | Partial      | Locals, scopes, aliases, CTEs, rowsets, columns, calls, types, catalog objects, and same-document DDL are modeled. Uncommon administrative semantics remain.                                                   |
| Syntax diagnostics                | Partial      | Recovery diagnostics are precise for covered grammar and incomplete typing states; uncommon grammar gaps can still recover generically.                                                                        |
| Semantic diagnostics              | Partial      | Catalog, scope, type, DML/DDL, routine, option, security, XML, spatial, JSON, vector, and platform families are covered; unsupported families stay visible in the active backlog.                              |
| Completion                        | Partial      | Contextual keywords, identifiers, locals, schemas, cross-schema/database objects, columns, principals, types, routines, star expansion, and insert expansion. Some uncommon statements need richer candidates. |
| Completion resolution             | Implemented  | Documentation is resolved without reparsing.                                                                                                                                                                   |
| Hover                             | Partial      | Bound objects, columns, locals, types, expressions, built-ins, and availability; some specialized metadata lacks rich descriptions.                                                                            |
| Signature help                    | Partial      | Built-ins, catalog/document routines, INSERT values, conversions, and keyword operators; uncommon callable forms remain.                                                                                       |
| Local definition                  | Implemented  | Variables, parameters, CTEs, aliases, and document-local objects.                                                                                                                                              |
| Catalog definition                | Experimental | Package descriptor/cache plus extension scripting integration; backend scripting availability controls results.                                                                                                |
| References and rename             | Partial      | Bound document-local identities only; catalog-wide reference search and rename are not claimed.                                                                                                                |
| Document symbols                  | Implemented  | Parser/semantic snapshot based.                                                                                                                                                                                |
| Selection ranges                  | Implemented  | Syntax-tree based.                                                                                                                                                                                             |
| Folding                           | Implemented  | Structural blocks, clauses, comments, regions, and host range limits.                                                                                                                                          |
| Semantic coloring                 | Implemented  | Lexical, syntactic, bound, write/declaration, system, quoted, temporary, and availability roles.                                                                                                               |
| Formatting                        | Planned      | No formatting API is exported.                                                                                                                                                                                 |
| Inlay hints                       | Planned      | Deliberately not exported.                                                                                                                                                                                     |
| Metadata providers                | Experimental | Null, in-memory, Simple Query, and dev/query adapters share one provider contract.                                                                                                                             |
| Node worker                       | Experimental | Persistent document state and feature/source-map routes are tested.                                                                                                                                            |
| Browser worker                    | Experimental | Serializable contract and handler parity are tested; extension deployment is not enabled.                                                                                                                      |
| Observability                     | Implemented  | Snapshot-consistent latency, reuse, metadata generation/completeness, redacted catalog events, and export contracts.                                                                                           |

See [Current readiness](CURRENT_READINESS.md) for verification commands and release blockers.
