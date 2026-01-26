Schema Designer tool spec (scalable vNext)

## Context
Existing Schema Designer runs in a VS Code Webview inside `vscode-mssql`.
Flow: Webview ⇄ RPC ⇄ Extension host ⇄ (LLM tool calls) ⇄ GHCP agent mode.
The UI already maintains an undo stack for user operations.

## Problems to solve
### Primary problem: transcript bloat
The current schema designer tool returns the entire schema JSON on every mutation (and often on errors).
In GHCP agent mode, tool outputs can be persisted in the transcript, causing:
- rapid context window blow-up (schema duplicated many times),
- higher latency/cost,
- degraded reliability due to prompt bloat.

### Secondary problem: stale edits
Schema may be edited by both UI and LLM in the same session (typically sequentially, rarely concurrently).
Without an explicit version contract, stale AI edits can overwrite changes or fail ambiguously.

## Assumptions
- “Quick start” schema generation is the main AI workload (roughly ~10–20 tables).
- Edits are generally fast; true concurrent UI+LLM edits are uncommon.
- No need to design a new undo system (the UI already has one).

## Requirements
R1: Minimize tool output size by default
- Mutating tool calls must not return full schema state.
- Any “large” outputs must be opt-in and/or returned via a non-transcript channel (e.g., file export), not inline JSON.

R2: Canonical state must remain outside the chat transcript
- The transcript/tool results must never be treated as the authoritative schema store.

R3: Provide a scalable “mutation receipt” contract
- Every mutation returns a small receipt sufficient to continue work (new version + minimal change summary + validation/diagnostics).

R4: Support efficient bulk edits
- Must support applying many edits in one operation to cover quick-start generation and reduce tool-call count.

R5: Deterministic conflict/staleness handling
- Mutations must accept an `expectedVersion` and fail deterministically on mismatch.
- Failures must return enough information to resync/retry without dumping full schema.

R6: Targeted reads for resync
- Must support fetching small “views” (overview and per-table at minimum).
- Must support explicit limits for large schemas (e.g., omit columns in overviews rather than returning unbounded data).

R7: UI edits and AI edits share one update pipeline
- Regardless of origin (UI vs LLM), edits must be validated/applied consistently and update the same canonical state/version.

R8: Preserve existing UI undo behavior
- Changes must not break current undo stack semantics for user operations.
- Tool-driven edits should behave like user edits (each edit becomes an undo step).

## Non-goals
- User-facing revert-to-arbitrary-revision (beyond existing undo).
- Long-term revision history storage (unless required for diagnostics/telemetry).
- App/domain-specific schema generation APIs (tools remain generic to the designer).

---

## Proposed tool contract (vNext)
This spec proposes replacing the current schema mutation API with a versioned, view-based API that never returns full schema state by default.

### Naming / compatibility
- Keep a single tool named `mssql_schema_designer` for continuity, using a discriminated union input shape with an `operation` field (e.g., `show`, `get_overview`, `get_table`, `apply_edits`).
- Existing operations that return full schema (`get_schema`, `replace_schema`, etc.) should be removed or deprecated.

### Canonical state location
- Canonical schema state is owned by the Schema Designer webview session (not by the transcript and not by the tool result).
- The tool acts as a thin RPC wrapper around that state.
Implementation note (current architecture)
- In the current webview implementation, the semantic schema model is derived from the graph state (tables as nodes, relationships as edges). The canonical `SchemaDesigner.Schema` used for script generation is reconstructed from nodes/edges rather than maintained as a separate store.

### Error model (common)
All operations return JSON with `success: boolean`.
On failure, return a small structured error:
```json
{ "success": false, "reason": "…", "message": "…" }
```
Common `reason` values:
- `no_active_designer`: no visible/active designer exists.
- `stale_state`: `expectedVersion` mismatched (includes `currentVersion` and `currentOverview`).
- `target_mismatch`: request `targetHint` does not match the active designer (includes `activeTarget` and echoes `targetHint`).
- `not_found`: referenced table/column does not exist.
- `ambiguous_identifier`: reference matched more than one entity (tool must not guess).
- `validation_error`: edit is invalid. For `apply_edits`, include `failedEditIndex`, `appliedEdits`, and the post-partial `currentVersion`.
- `invalid_request`: missing required fields (e.g., missing `expectedVersion`).
- `internal_error`: unexpected failures (message should be short).
Output-size rule: errors must never include full schema state.
When available, responses (success and failure) should include the active designer identity:
```json
{ "server": "...", "database": "..." }
```
Optional error hints (bounded)
- For some validation failures, the tool may include small, bounded hint fields to reduce retry churn without requiring a separate metadata call.
- These fields must be short, capped, and never include full schema state.

Example validation error with hints
```json
{
  "success": false,
  "reason": "validation_error",
  "message": "Schema 'sales' not available",
  "hints": {
    "allowedSchemas": ["dbo", "sys"]
  }
}
```

```json
{
  "success": false,
  "reason": "validation_error",
  "message": "Data type 'strng' is invalid",
  "hints": {
    "allowedDataTypesSample": ["int", "bigint", "nvarchar", "datetime2"]
  }
}
```
Example target mismatch
```json
{
  "success": false,
  "reason": "target_mismatch",
  "message": "Active schema designer does not match targetHint",
  "activeTarget": { "server": "...", "database": "..." },
  "targetHint": { "server": "...", "database": "..." }
}
```

### Version token
Introduce an opaque `version: string` representing the current canonical schema revision.
- The contract requirement: the token must change after any successful schema mutation, regardless of origin (UI or tool).
- Recommendation: implement `version` as a canonical-schema content hash computed from the current schema model.
  - This avoids “plumbing” an explicit revision counter through every UI action while still ensuring UI edits change the token.
  - The hash must be computed over the *semantic schema model only* (tables/columns/constraints), excluding UI-only state like layout/positions/selection.
  - The hash should exclude non-semantic generated IDs where possible to avoid false staleness (normalize + sort by logical names).

---

## Identifiers and references
The designer maintains internal UUID identifiers for tables/columns/foreign keys. The tool contract is name-first to avoid requiring those IDs in the transcript.

### `TableRef`
```json
{ "schema": "dbo", "name": "Orders", "id": "optional" }
```

### `ColumnRef`
```json
{ "name": "OrderId", "id": "optional" }
```

### `ForeignKeyRef`
```json
{ "name": "FK_Orders_Customers", "id": "optional" }
```

### Resolution rules
- Matching is case-insensitive for `schema`, `table`, `column`, and `foreignKey` names.
- If `id` is provided, the tool must resolve by `id` first.
- Otherwise the tool resolves by name within scope:
  - table scope: (`schema`,`name`)
  - column scope: (`tableRef`,`column.name`)
  - foreign key scope: (`tableRef`,`foreignKey.name`)
- If resolution returns 0 matches: fail with `reason: "not_found"`.
- If resolution returns >1 matches: fail with `reason: "ambiguous_identifier"`.
  - This should be rare; duplicates should be treated as invalid by the schema designer’s validation.

## Operations
All operations target the *active* schema designer by default.
If no designer is active/visible, operations (except `show`) must return `success: false` with `reason: "no_active_designer"`.
The tool should wait for the designer to be initialized before servicing reads/mutations (no separate “ready” handshake in the contract).
For mutation operations, callers may provide a lightweight `targetHint` (server+database) to fail fast if the active designer is not the intended target.

### 1) `show`
Opens (or reveals) the schema designer for a given connection and makes it active.

Input
```json
{ "operation": "show", "connectionId": "..." }
```

Output (never includes schema)
```json
{ "success": true, "message": "Opened schema designer", "version": "...", "server": "...", "database": "..." }
```
Notes
- The UI/webview initialization is inherently async; `show` must tolerate that.
- Contract decision: `show` should only return once the designer is initialized enough to service `get_overview` / `get_table` / `apply_edits` (or return an error).
- `show` is only needed to open a designer. If a designer is already active/visible, agents can start with `get_overview` directly.

### 2) `get_overview`
Returns a bounded “overview” of the current schema suitable for grounding without dumping full state.

Input
```json
{
  "operation": "get_overview",
  "options": {
    "includeColumns": "namesAndTypes"
  }
}
```

Output
```json
{
  "success": true,
  "version": "...",
  "server": "...",
  "database": "...",
  "overview": {
    "tables": [
      { "schema": "dbo", "name": "Orders", "columns": [ { "name": "OrderId", "dataType": "int" } ] }
    ],
    "columnsOmitted": false
  }
}
```
Options
- `includeColumns`: `"none" | "names" | "namesAndTypes"` (default `"namesAndTypes"`).
Sizing guidance
- For typical quick-start sizes (~10–20 tables, ~10 columns each), returning table + column names/types is expected to be small enough for agent grounding.
- Threshold: if the schema has more than **40 tables** or more than **400 total columns**, the tool must omit columns (set `columnsOmitted: true`) while still returning the full list of table names.
  - When `columnsOmitted: true`, each table entry must omit the `columns` field entirely (not `[]`) to minimize output.
  - The agent can then call `get_table` for only the specific tables it needs.

### 3) `get_table`
Returns details for a single table (bounded read).

Input
```json
{
  "operation": "get_table",
  "payload": { "table": { "schema": "dbo", "name": "Orders" } },
  "options": { "includeColumns": "namesAndTypes", "includeForeignKeys": true }
}
```

Output
```json
{
  "success": true,
  "version": "...",
  "server": "...",
  "database": "...",
  "table": {
    "schema": "dbo",
    "name": "Orders",
    "columns": [ { "name": "OrderId", "dataType": "int", "isPrimaryKey": true, "isNullable": false } ],
    "foreignKeys": []
  }
}
```
Notes
- Table addressing is by logical name (`schema` + `name`) to avoid requiring the tool to return internal IDs.
- Implementations may optionally include stable `id` fields, but callers must not rely on them.
Options
- `includeColumns`: `"none" | "names" | "namesAndTypes" | "full"` (default `"namesAndTypes"`).
- `includeForeignKeys`: boolean (default `false`).
Rationale
- A dedicated `get_column` is not required in v1; it increases call count without much transcript-size benefit.
- If we later need deeper or arbitrary reads, we can add additional typed read operations (e.g., `get_foreign_keys`), but v1 intentionally keeps reads simple.
Notes
- When `includeColumns: "full"`, the tool may include internal `id` fields for the table/columns to support debugging and disambiguation. These IDs are optional and must not be required for normal operation.

### 4) `apply_edits` (bulk mutation)
Applies a sequential list of edits in a single call and returns a small mutation receipt.

Input
```json
{
  "operation": "apply_edits",
  "payload": {
    "expectedVersion": "...",
    "targetHint": { "server": "...", "database": "..." },
    "edits": [
      { "op": "add_table", "table": { "schema": "dbo", "name": "Orders" } },
      { "op": "add_column", "table": { "schema": "dbo", "name": "Orders" }, "column": { "name": "OrderId", "dataType": "int", "isPrimaryKey": true } }
    ]
  }
}
```
Notes
- `expectedVersion` is required for mutations. If it is missing, the tool must fail with `reason: "invalid_request"`.
- If `targetHint` is provided and does not match the active designer, the tool must fail with `reason: "target_mismatch"` (no edits applied).

Success output (receipt only)
```json
{
  "success": true,
  "version": "...",
  "server": "...",
  "database": "...",
  "receipt": {
    "appliedEdits": 2,
    "changes": {
      "tablesAdded": [ { "schema": "dbo", "name": "Orders" } ],
      "columnsAdded": [ { "table": { "schema": "dbo", "name": "Orders" }, "column": { "name": "OrderId" } } ]
    },
    "warnings": []
  }
}
```
Notes
- `receipt.changes` is a minimal summary and should include only fields relevant to the applied edits to keep outputs small.
- The tool may additionally include (when relevant): `tablesDropped`, `tablesUpdated`, `columnsDropped`, `columnsUpdated`, `foreignKeysAdded`, `foreignKeysDropped`, `foreignKeysUpdated`.

Stale output (no schema dump)
```json
{
  "success": false,
  "reason": "stale_state",
  "message": "Schema changed since last read",
  "currentVersion": "...",
  "server": "...",
  "database": "...",
  "currentOverview": {
    "tables": [ { "schema": "dbo", "name": "Orders" } ],
    "columnsOmitted": true
  },
  "suggestedNextCall": { "operation": "get_overview", "options": { "includeColumns": "namesAndTypes" } }
}
```
Notes
- A version mismatch does not identify “what changed” by itself; the model reconciles by comparing the returned `currentOverview.tables` to its last known overview, then calling `get_table` only for the tables it needs to touch.
- `currentOverview` must follow the same size rules as `get_overview`:
  - if under the omission threshold, it should include columns when `includeColumns` would include them;
  - if over the threshold, it must omit columns (`columnsOmitted: true`).
- The tool does not maintain or return a detailed “impacted paths” map; that bookkeeping is intentionally avoided to keep the contract simple and robust.

Mutation semantics
- The edit list is applied sequentially; later edits in the same batch see earlier changes.
- Validation occurs per-edit; the default failure mode is **fail-fast** (stop at first invalid edit).
Notes
- There is no separate “single edit” operation: callers can submit a single-element `edits` array.
- Tool response acts as the commit acknowledgement: the returned `version` / `currentVersion` must correspond to the post-mutation canonical schema state.
- Implementations must not treat `getScript` (or other UI refresh events) as a completion/ack signal. If UI state application is async, compute the post-mutation schema/version from the in-memory “next” graph/state being applied (or use an equivalent deterministic mechanism) before responding.
- Partial failure handling (non-atomic):
  - If edit at index `failedEditIndex` fails validation, edits `0..failedEditIndex-1` remain applied (no rollback).
  - The error response must include `failedEditIndex`, `appliedEdits` (equal to `failedEditIndex`), and the post-partial `currentVersion` so the agent can retry safely.

Example validation error (partial success)
```json
{
  "success": false,
  "reason": "validation_error",
  "message": "Column 'OrderId' already exists in table 'dbo.Orders'",
  "failedEditIndex": 1,
  "appliedEdits": 1,
  "currentVersion": "...",
  "server": "...",
  "database": "..."
}
```

Undo semantics
- Each edit in `apply_edits` must be recorded as a separate undo entry (equivalent to how user-driven edits accrue).
- UI-originated edits preserve existing undo behavior.

---

## Edit model (UI parity)
Edits should cover all schema mutations available in the UI (tables, columns, foreign keys).
Layout-only UI operations (moving tables, auto-arrange, expand/collapse) are explicitly out of scope because they do not change the semantic schema model used for script generation.

### Primitive payload shapes
`ColumnCreate` (same fields user can edit in the UI):
```json
{
  "name": "OrderId",
  "dataType": "int",
  "maxLength": "",
  "precision": 0,
  "scale": 0,
  "isPrimaryKey": true,
  "isIdentity": true,
  "identitySeed": 1,
  "identityIncrement": 1,
  "isNullable": false,
  "defaultValue": "",
  "isComputed": false,
  "computedFormula": "",
  "computedPersisted": false
}
```

`ForeignKeyCreate`:
```json
{
  "name": "FK_Orders_Customers",
  "referencedTable": { "schema": "dbo", "name": "Customers" },
  "mappings": [ { "column": "CustomerId", "referencedColumn": "Id" } ],
  "onDeleteAction": 1,
  "onUpdateAction": 1
}
```

### Supported edit operations (UI parity)
Table
- `add_table`: `{ table: TableRef, initialColumns?: ColumnCreate[] }`
  - If `initialColumns` is omitted, the designer may create its default initial column(s) (e.g., `Id`).
- `drop_table`: `{ table: TableRef }`
- `set_table`: `{ table: TableRef, set: { name?: string, schema?: string } }`

Column
- `add_column`: `{ table: TableRef, column: ColumnCreate }`
- `drop_column`: `{ table: TableRef, column: ColumnRef }`
- `set_column`: `{ table: TableRef, column: ColumnRef, set: { ...subset of ColumnCreate fields... } }`
  - Renames are supported by setting `set: { name: "NewName" }`.

Foreign key / relationship
- `add_foreign_key`: `{ table: TableRef, foreignKey: ForeignKeyCreate }`
- `drop_foreign_key`: `{ table: TableRef, foreignKey: ForeignKeyRef }`
- `set_foreign_key`: `{ table: TableRef, foreignKey: ForeignKeyRef, set: { name?: string, onDeleteAction?: number, onUpdateAction?: number, referencedTable?: TableRef, mappings?: { column: string, referencedColumn: string }[] } }`
  - Updating `mappings` replaces the full set of column mappings for that foreign key.
  - (optional) a future extension can add granular `add_fk_mapping` / `drop_fk_mapping` if needed, but UI parity is satisfied by full replacement.

Notes
- Prefer logical addressing (schema/table/column names) plus `expectedVersion` for safety.
- Matching should be case-insensitive for identifiers, but the tool should preserve the canonical casing used by the designer/database when presenting names.
- ID-based addressing is explicitly not required for v1 (it increases read pressure and transcript size); if IDs are ever introduced, they must be optional.
- Table names must be unique per schema (case-insensitive). Column names must be unique per table (case-insensitive). If the underlying model violates this, mutations should fail with `ambiguous_identifier` rather than guessing.
- The tool should normalize/validate (e.g., required fields, unique names, FK mapping) in the same pipeline used by UI edits.

---

## Output size rules (hard constraints)
- `show`: no schema.
- `apply_edits`: no schema.
- `get_overview`: bounded; defaults to table names + column names/types; for large schemas must omit columns (set `columnsOmitted: true`) but must still return table names.
- `get_table`: bounded to a single table; optionally omit foreign keys by default.
- Any export/debug operation that requires full schema must write to a file (or another non-transcript channel) and return a reference, not the JSON.

---

## Recommended usage (agent guidance)
- Do not poll `get_overview`. Treat it as a grounding/resync call.
- Typical call patterns:
  - If a designer is already open/visible: start with `get_overview` (no `show` needed).
  - Start of a design session: `show` → `get_overview`.
  - Before a batch of edits: ensure you have a recent `version` from the last `get_overview`/`get_table` and pass it as `expectedVersion` to `apply_edits`.
  - On `stale_state`: compare `currentOverview` (or call `get_overview`) and then use `get_table` only for the few tables you need to modify.
- Prefer `get_table` for “deep” context instead of repeatedly re-fetching the entire overview.
- Mutating operations should be treated as user-impacting; the host may show a confirmation UI before running `apply_edits`.
- All non-`show` operations target the active/visible designer; if you get `no_active_designer`, call `show` first.

---

## Deferred / not in v1 (tracking)
- Designer targeting via durable `designerId`/`sessionId` in requests/responses (instead of relying on “active/visible” + `targetHint`).
- Atomic `apply_edits` option (transactional rollback) vs non-atomic partial success; keep v1 non-atomic.
- Receipt size caps (counts-only or truncated lists) for very large batches.
- Table-count caps / filtering / paging for `get_overview` on very large schemas.
- Column-count caps / selective column reads for `get_table` on very wide tables.
- Separate `schemaCommitted` event/notification beyond the tool response (the tool response itself is the v1 acknowledgement).
- Include `isPrimaryKey` in `get_overview` column items (high-signal grounding).
- Include `overview` in `show` response to save a follow-up `get_overview` call.
- `get_metadata` operation (or `show` returning metadata) to retrieve `schemaNames` and full `dataTypes` list.
- `get_relationships` operation to return a lightweight FK topology across the schema.
- Foreign key referencing when FK `name` is empty: require a name for tool-created FKs or define an alternative FK reference strategy.
- Version/hash normalization rules tightened further (e.g., explicit lowercasing before hashing).
- String enums for FK actions (`"cascade"|"no_action"|…`) instead of numeric values.

---

## Requirements coverage (sanity check)
- R1/R2: Mutations (`apply_edits`) and errors never return full schema; reads are bounded (`get_overview`, `get_table`).
- R3: `apply_edits` returns a small receipt + new `version`.
- R4: Bulk edits are supported via a single `apply_edits` call with many edits.
- R5: `expectedVersion` is required; mismatches return `stale_state` with `currentVersion` + small `currentOverview`.
- R6: Resync uses overview/table reads with an explicit column-omission threshold for large schemas.
- R7: Both UI and tool edits share the same canonical store and advance the same `version`.
- R8: Tool edits accrue undo steps like user edits (no special undo system required).

---

## Verification (non-normative)
This extension feature is UI-driven and not easily E2E-testable in CI without VS Code + a live server. The following checks are recommended to validate implementation correctness.

Automatable (unit/contract)
- Tool contract tests (golden responses) for each operation:
  - No full schema JSON returned for mutations or errors.
  - `target_mismatch` returns `activeTarget` + `targetHint`.
  - `stale_state` returns `currentVersion` + bounded `currentOverview`.
  - `validation_error` (partial success) returns `failedEditIndex`, `appliedEdits`, and post-partial `currentVersion`.
- Version hashing tests:
  - Same semantic schema yields same `version` regardless of ordering/layout/IDs.
  - Case-insensitive rename does not cause spurious staleness if names are normalized for hashing.
- Overview sizing tests:
  - Over omission threshold (>40 tables or >400 columns) sets `columnsOmitted: true` and omits `columns` fields.

Manual (developer workflow)
- Open a schema designer, then call `get_overview` without calling `show` (active-designer behavior).
- Apply a small `apply_edits` batch and confirm `version` changes and UI reflects the edits.
- Force a mismatch (edit in UI, then attempt `apply_edits` with old `expectedVersion`) and confirm deterministic `stale_state`.
- Confirm tool calls do not rely on `getScript` timing (no `requestAnimationFrame`/timeout races for returned `version`).

 
