# T-SQL language-service architecture

## Design constraints

- The package is host-neutral: portable parser, semantic, feature, and worker code does not import
  VS Code or a database driver.
- One immutable document snapshot owns the source text, SQLCMD projection, syntax tree, semantic
  model, pinned metadata generation, diagnostics, and statistics for a document version.
- Editor features read that published snapshot. They do not parse or bind independently.
- Incremental and fresh analysis must remain equivalent. Reuse is an optimization, never a second
  correctness path.
- Metadata absence, loading, truncation, and failure are distinct states. Only authoritative absence
  may produce a missing-object diagnostic.

## Layer ownership

| Layer                  | Owns                                                                 | Must not own                |
| ---------------------- | -------------------------------------------------------------------- | --------------------------- |
| `text`                 | UTF-16 snapshots, changes, ranges                                    | SQL syntax                  |
| `sqlcmd`               | directives, projection, source maps                                  | T-SQL or metadata           |
| `syntax`               | lossless tokens, Lezer trees, recovery, incremental reuse            | binding or catalog policy   |
| `metadata`             | immutable generations and provider contracts                         | editor APIs or syntax trees |
| `semantics`            | scopes, symbols, calls, types, catalog binding, semantic diagnostics | host UI                     |
| `coloring`             | token classifications over syntax and semantics                      | parsing or metadata loading |
| `features`             | completion, hover, navigation, signatures, folding, source mapping   | document mutation           |
| `runtime`              | document lifecycle and publication of one analysis snapshot          | VS Code adaptation          |
| `worker`               | serializable runtime protocol and transports                         | host-specific objects       |
| extension preview host | connection state, VS Code providers, metadata refresh, scripting     | parser internals            |

The architecture boundary script also rejects dependency cycles and host imports in portable code.
The [text inspection policy](TEXT_INSPECTION_POLICY.md) defines the narrow lexical and recovery
cases where a bounded regular expression may supplement—but never replace—the published tree.

## Document lifecycle

```text
source edit
   │
   ├─ SQLCMD projection/source map
   │
   ├─ syntax update (Lezer fragments and unchanged GO-chunk reuse)
   │
   ├─ semantic update (changed ranges plus pinned metadata view)
   │
   └─ immutable DocumentAnalysisSnapshot
          ├─ diagnostics
          ├─ completion / hover / signatures
          ├─ definition / references / rename / selection
          ├─ folding / coloring
          └─ statistics
```

An ordinary SQL document has an identity projection. A SQLCMD document is analyzed in projected
coordinates and all host-facing results pass through the shared source-coordinate policy.

## Metadata model

`MetadataProvider.pin()` returns an immutable view for one generation. A runtime pins once while
binding and stores that generation in the semantic snapshot. Providers may hydrate sections lazily;
completion and hover can request missing details without blocking unrelated structural features.

The extension currently uses the Simple Query adapter behind a connection-scoped session pool. The
package also exposes null, in-memory, and dev/query adapters. Provider contract tests cover refresh,
cancellation, late completion, failure preservation, comparison policy, and section completeness.

## Feature providers

`TsqlLanguageFeatureService` is a thin dispatcher. Completion, hover, navigation, signatures,
folding, and coloring have separate owners and all receive the same runtime. Source-mapped wrappers
are decorators; they translate coordinates but do not analyze SQL.

## Worker model

The package exposes the same serializable request protocol for in-process, Node worker, and browser
worker transports. Worker requests retain document state between calls. The preview extension is
currently wired to the in-process runtime; switching its transport is a host integration decision,
not a parser rewrite.

## Performance invariants

- A feature request over an existing snapshot performs zero parses, binds, and metadata pins.
- A metadata-only rebind reuses the syntax snapshot by identity.
- An edit must match a fresh analysis and reuse unaffected semantic units and GO chunks.
- Correctness checks run outside benchmark timing.
- Performance reports use warmups, repeated interleaved samples, p50, p95, dispersion, environment
  identity, and machine-readable JSON.
