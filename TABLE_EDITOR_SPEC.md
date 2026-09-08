# Table Editor UX and Reliability Specification

Status: Draft for review; implementation is not authorized by this document.

Date: 2026-09-07

## 1. Purpose

Build a SQL Server table editor that makes small data changes fast, predictable, and recoverable. Users must understand what will be written, retain their work when operations fail, and receive an accurate account of the database outcome.

This specification covers the grid, a sticky bottom insertion row, staged changes, validation, saving, conflict recovery, and the correctness work needed to support those interactions. It also defines the shared `sql-feature` package that will house editing and diagnostics, including DMV functionality.

### Product assumptions

- The primary workflow is quick developer data fixes. DBA maintenance and spreadsheet-style bulk editing are secondary until the audience is confirmed.
- Changes remain local until the user explicitly selects Save.
- One save submits all pending rows for this table in one transaction. Selective save is outside the initial scope.
- The editor operates on the connection and table with which it was opened; connection identity must not be inferred from display names.
- The sticky bottom insertion pattern is the proposed design direction, not an already implemented capability.
- Package direction is decided: consolidate the existing editing and diagnostics engines into `packages/sql-feature`, named `sql-feature`, with explicit feature entry points. Do not introduce separate `sql-core` or `sql-dmv` packages for this work. This document update does not itself create or migrate implementation files.

### Success criteria

1. Navigation, refresh, failed validation, and failed saves never silently discard a draft.
2. An acknowledged save corresponds to the exact submitted draft revision.
3. Values preserve their database meaning and precision through reading, editing, and writing.
4. Known unsupported operations are explained before the user enters data.
5. Every actionable error identifies an operation, row, and column where that information is available.
6. Keyboard users can complete the same editing and recovery workflows as pointer users.

### Initial non-goals

- Schema editing, arbitrary query-result editing, or changing identity values through IDENTITY_INSERT.
- Automatic database writes on blur, Tab, Enter, or navigation.
- General CSV import, cross-table transactions, or unlimited bulk transformations.
- Silent retry of writes with an unknown outcome.
- Promising that every view, custom type, trigger configuration, or keyless table is editable.

## 2. Current findings and evidence

These findings came from source inspection and focused source-level probes. They are not an end-to-end live-server verification. The 61 existing sql-edit unit tests passed when transpiled in memory; that does not establish controller, adapter, or transaction correctness.

| Priority | Finding                                                                                         | Required outcome                                                                                          | Evidence                                                                         |
| -------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P0       | Page loads assign new row IDs while staged edits retain old IDs; buildEdits skips missing rows. | Draft identity survives paging, sorting, filtering, and refresh. Missing targets are errors.              | `extensions/mssql/src/tableExplorer/tableEditorWebviewController.ts`             |
| P0       | The query adapter accepts completedWithErrors and ignores server messages.                      | Writes require explicit successful completion and preserve structured errors.                             | `extensions/mssql/src/sqlDiagnostics/dataPlaneRunner.ts`                         |
| P0       | Decimal/numeric encoding passes values through float.                                           | Exact types retain precision and scale in writes and comparisons.                                         | `packages/sql-edit/src/types/valueCodec.ts`                                      |
| P0       | Editing remains available during save, followed by clearing all staged edits.                   | Submitted revisions are immutable; success clears only acknowledged changes.                              | Controller and `extensions/mssql/src/webviews/pages/TableEditor/tableEditor.tsx` |
| P0       | Truncation markers are flattened; a failed full-value fetch falls back to an editable preview.  | Incomplete values cannot be saved as complete values.                                                     | Adapter, controller, and `packages/sql-edit/src/session/editSession.ts`          |
| P1       | Declared alias type name is used as an encoding type; the Name/name error was reproduced.       | Resolve alias base types, retain declared types for display, and reject unsupported types before editing. | `packages/sql-edit/src/metadata/tableMetadata.ts` and value codec                |
| P1       | Double-click on nullable scalar cells writes NULL.                                              | Double-click enters editing/selects text; NULL is an explicit action.                                     | Table editor React page                                                          |
| P1       | Untouched insert cells display like NULL even though they are omitted.                          | Default, generated, required, NULL, and empty string are distinct states.                                 | Shared table editor interface, controller, React page                            |
| P1       | Generic save error offers Refresh as recovery.                                                  | Recovery depends on the failure category and preserves drafts.                                            | Controller and React page                                                        |
| P1       | Every caught commit error claims nothing was applied.                                           | Connection loss or missing acknowledgement can produce outcome unknown.                                   | EditSession.commit                                                               |

P0 denotes potential loss of drafts, incorrect database values, or inaccurate save outcomes. P1 denotes a core workflow blocker or misleading interaction. The alias-type fix should be delivered with the first correctness tranche because it blocks the demonstrated workflow.

## 3. Screen structure

```text
server / database / schema.table                              Connected

[Save 3 rows] [Review changes (3)] [Undo] [Redo] [+ New row] [Filter] [Refresh]

Column headers: name, key/read-only indicators; type details on demand
┌──────┬────────────────┬─────────────────────┬────────────────────────┐
│      │ DepartmentID   │ Name                │ ModifiedDate           │
├──────┼────────────────┼─────────────────────┼────────────────────────┤
│      │ 1              │ Engineering         │ 2008-04-30 00:00:00     │
│ Edit │ 2              │ Proposed value      │ 2008-04-30 00:00:00     │
└──────┴────────────────┴─────────────────────┴────────────────────────┘
Sticky insertion area: [+ New row] or active draft aligned to columns
Horizontal scrollbar
16 loaded · 1 pending insert · 1 issue             Page controls / page size

Optional inspector: Changes | Issues | SQL
```

### Layout requirements

- Use the repository's FluentSlickGrid wrapper and existing virtualization libraries.
- Virtualize long row and inspector lists; do not mount an input for every cell.
- The grid owns column widths and horizontal scroll position. Headers, data, and the insertion area share that model.
- Keep the row-status gutter and insertion action reachable when horizontally scrolled.
- Reserve layout space for the insertion area and scrollbar; neither overlays the last data row.
- Show server, database, schema, and table. Long identifiers may truncate with accessible full text.
- Show key columns and explain the identity strategy on demand. A primary-key badge is not a promise of conflict-free saving.
- Row counts distinguish loaded database rows from pending inserts. Counting all matches is explicit, cancellable, and does not block local editing.
- Page controls must not imply a known final page unless it is known. Determine next-page availability accurately, including exact page-size boundaries.
- Inspector placement may be beside or below the grid according to available space; it must not compress the grid into unusable columns.

## 4. Sticky bottom insertion row

### 4.1 Collapsed state

- Display a compact, sticky `+ New row` action at the bottom of the grid viewport.
- Use a subtle background and top border, not a saturated new-row fill.
- Do not show numbered empty records beneath the loaded data.
- The toolbar New row action and a keyboard-accessible command focus this same insertion surface.
- If insertion is unavailable, show a disabled action with an accessible explanation. Capability is operation-specific: lack of a safe update identity does not inherently prove INSERT is unsupported.

### 4.2 Start insertion

1. Activate New row.
2. Expand one editable draft aligned with the grid columns.
3. Focus the first writable field in the current column order, scrolling it into view if necessary.
4. Show `New` in the row-status gutter; do not assign a persisted record number.
5. Show Generated, Default, Required, or NULL according to metadata and the draft's explicit state.

Merely opening or focusing the blank insertion surface does not increment the pending count. The first intentional value operation creates a pending insert. A row whose editable fields are all defaultable can be inserted through an explicit `Insert using defaults` action; an empty surface alone must never create that write.

### 4.3 Entering values

- The active insert remains visible while existing rows scroll vertically.
- Column resizing, reordering, and horizontal scrolling apply identically to the draft.
- An identity/computed/server-generated field is not focusable as an editor and explains how its value is assigned.
- Users can select Use default only where supported, Set NULL only where nullable, or enter an explicit value.
- A required field remains visibly required until a value is supplied; it must not masquerade as an existing NULL value.
- Validation messages remain attached to the relevant field and are also listed in Issues.

### 4.4 Finish one draft and add another

- Tab advances through writable fields. Shift+Tab moves backward.
- At the last writable field, Tab validates the active row. If locally valid, move it to the pending-insert collection and focus a fresh insertion surface. This does not write to SQL Server.
- If invalid, retain the draft and focus the first invalid field. Provide a normal way to leave the insertion area without completing the row; it must not become a keyboard trap.
- Enter commits the current cell. It does not submit the row to the database or unexpectedly create another row.
- A visible Add another action performs the same staging action for pointer users.
- Pending inserts appear in a labeled section after the loaded records and in Changes, independent of database sort/filter order. Only the active insertion surface is sticky; completed drafts do not build an unbounded sticky stack.
- Pending inserts remain editable and removable. Removing a pending insert is a local undoable operation, not a database DELETE.

### 4.5 Cancellation and saving

- Escape cancels the current cell edit first. Cancelling the entire draft is a separate explicit row action.
- Cancelling an untouched insertion surface simply collapses it.
- Save includes a modified active insert after flushing its cell editor and validating the complete pending set.
- Save ignores an untouched insertion surface.
- A successful insert reconciles its generated key and server-produced values with the draft. Re-read when needed to capture trigger effects.
- If the inserted record is outside the active filter or loaded page, announce that fact and offer a way to locate it. Do not silently change filters or sort order.

## 5. Cell editing and value semantics

### 5.1 Navigation and editing

- Single click selects a cell. Double-click or F2 enters editing. Typing into an eligible selected cell begins a replacement edit using conventional grid behavior.
- Arrow keys navigate when not editing; within an editor they retain appropriate caret/control behavior.
- Tab commits and advances; Enter commits; Escape cancels the active cell edit.
- Local editor text updates immediately. Extension-host round trips must not be required to render each keystroke.
- Blur stages an edited value. It never saves to the database.
- Save first flushes the active editor, including text entered immediately before clicking Save.
- Cell actions include Revert cell, Set NULL, and Use default when applicable. Row deletion is an explicit row command, not an overloaded text-editing gesture.
- Undo/redo groups a cell edit or a paste as one meaningful operation. Navigation alone is not an undo entry.
- After a save, old undo entries cannot pretend to undo committed database changes. A future revert-after-save feature must stage a new explicit write.

### 5.2 Semantic states

| State              | Display                                                | Write meaning                                         |
| ------------------ | ------------------------------------------------------ | ----------------------------------------------------- |
| Explicit value     | Formatted value; exact text in editor                  | Write the encoded value                               |
| Empty string       | Visually identifiable empty-string state when selected | Write an empty string for compatible types            |
| Explicit NULL      | Muted `NULL`, distinct from blank                      | Write SQL NULL                                        |
| Default            | `Default`, with definition on demand                   | Omit insert column or use supported DEFAULT operation |
| Generated          | `Generated on save` for new rows                       | Never send an explicit value                          |
| Required/unset     | `Required`                                             | Validation issue if an insert is submitted            |
| Incomplete preview | Preview plus incomplete indicator                      | Read-only until complete content is available         |

Default expressions are evaluated by the database, never simulated by placing a guessed value in the draft. Do not change a defaulted timestamp merely because the user focused its cell.

### 5.3 Type-aware editors

- Text: inline editor; preserve whitespace and distinguish an empty string from NULL.
- Exact numeric types: retain canonical decimal text, validate declared precision/scale and range, and avoid JavaScript Number or SQL float conversions for exact values.
- Date/time: readable display, exact precision and offset retained in editing; no implicit timezone conversion for types that lack a timezone.
- Nullable bit: explicit True, False, NULL choices. Non-nullable bit omits NULL.
- Long text, XML, JSON, vector: resizable document editor with type-appropriate validation where available. Apply stages locally; Cancel leaves the draft unchanged.
- Binary/spatial/variant/custom types: enable writing only when a verified representation preserves semantics. Preserve sql_variant underlying type or make the unsupported operation explicit; do not silently convert every variant to text.
- Alias types: retain schema-qualified declared type for display, resolve supported underlying type for validation/encoding, and preserve column length/precision/scale.

Metadata shared with the UI must include operation capabilities, nullability, default availability, length, precision, scale, generated state, and read-only reasons. CLR types must not be treated as ordinary aliases solely because they share a system type identifier.

## 6. Draft ownership and navigation

### Identity model

- Existing-row drafts retain the original identity, original values/concurrency token, proposed changes, and a stable client draft ID.
- Composite keys remain structured typed values; translated text, display formatting, and ambiguous concatenation cannot serve as identity.
- Editing a key column does not replace the original identity until the write is acknowledged.
- Insert drafts use temporary client IDs until their database identity is known.
- Keyless editing requires an explicit supported strategy with exact-one-row enforcement. Do not silently merge indistinguishable records into one draft.

### Draft lifecycle

- Draft storage is independent of loaded pages. Replacing a page never replaces draft ownership.
- Filtering, sorting, page-size changes, and paging preserve drafts and expose off-screen changes through the inspector.
- Refresh retrieves new server data without overwriting the original baseline used to detect conflicts.
- If refresh reveals a changed or deleted target, retain the proposal and mark a conflict.
- Never skip a pending operation because its row is not on the current page.
- A reverted update with no remaining differences becomes clean. An insert can remain intentional even when its fields use defaults.
- A staged delete keeps enough prior draft state for Undo to restore the previous edit.

### Closing and restoration

- Closing a dirty editor must either support a real Save/Discard/Cancel guard through a suitable VS Code document lifecycle or recover the draft on reopening. A webview disposal callback alone is not a close guard.
- Choose and validate the host lifecycle before implementation. Do not claim close protection that the panel API cannot provide.
- If drafts are persisted for recovery, define storage location, retention, explicit discard, and connection/table binding; do not send cell values to telemetry.
- Restored drafts require fresh server comparison before saving.

## 7. Save protocol and operation coordination

### Save sequence

1. Flush the active cell editor and acknowledge all local staging actions.
2. Validate all pending rows, including off-screen drafts. Return all predictable issues rather than only the first encountered error.
3. Capture an immutable draft revision and operation ID.
4. Freeze mutations to that revision. For the first release, disable all draft mutations during saving; grid inspection may remain available.
5. Compile the write batch and SQL preview from the same snapshot and metadata.
6. Execute on the intended connection with explicit transaction handling and structured error collection.
7. Classify the result as acknowledged success, confirmed failure/rollback, conflict, or outcome unknown.
8. On acknowledged success, reconcile affected rows and clear only that submitted revision.
9. Report follow-up read failures separately from the write outcome.

### Execution requirements

- Queue database operations on a session that allows only one active query. Count, page reads, full-cell fetches, and save cannot race each other.
- Use request generations to prevent obsolete reads from replacing newer filter/sort/page state.
- completedWithErrors is not a successful write outcome.
- Retain SQL error number, message, constraint/object information, and statement/draft identity where available. Unknown mappings must remain unknown rather than point to a guessed row.
- Ensure transaction cleanup on supported failure paths; verify actual rollback and connection reusability with integration tests. A transaction-shaped string is insufficient evidence.
- Exact-one-row guards must distinguish zero matches from multiple matches.
- Do not assume deleting before updating before inserting solves all uniqueness or foreign-key dependencies. Detect supported ordering cases, and explain unsupported batches without partial application.
- A missing response after a possible commit produces outcome unknown. Do not clear drafts or automatically retry inserts.
- Reconciliation after unknown outcome must establish what happened; value similarity alone is not proof that an insert was this operation.
- Cancellation of a write requires the same outcome classification; a Cancel request is not proof of rollback.

### User-visible save states

| State                      | UI behavior                                                                   |
| -------------------------- | ----------------------------------------------------------------------------- |
| Clean                      | Save disabled; no pending count                                               |
| Pending                    | Save N rows; count includes inserts, updates, deletes once per row            |
| Invalid                    | Save cannot submit; Issues shows causes and offers focus navigation           |
| Saving                     | Progress status; draft mutations disabled; prevent duplicate submissions      |
| Saved                      | Announce affected rows; reconcile generated values; clear acknowledged drafts |
| Failed, rollback confirmed | Explain that no submitted changes were applied; keep drafts                   |
| Conflict                   | Compare original/current/proposed values; keep drafts                         |
| Outcome unknown            | Explain uncertainty; preserve snapshot; require reconciliation before retry   |
| Saved, refresh failed      | Explicitly report successful save and failed reload; offer Reload             |

If clicking Save is how validation is first requested, it must expose issues rather than remain silently disabled. Once issues are known, a visible Go to issues action remains available.

## 8. Validation and recovery

### Validation layers

- Validate inexpensive known rules locally when a cell is committed: encoding, length, required input, nullability, numeric range/precision, and supported representation.
- Repeat authoritative validation in the extension/engine before compiling SQL.
- Server constraints, permissions, triggers, and concurrency remain authoritative at execution time.
- Avoid red errors while a user is halfway through typing a valid value; show them on cell commit or save attempt.
- Metadata-dependent capabilities refresh when schema changes are detected. Preserve the user's draft and explain incompatible changes.

### Error presentation

- Show a concise summary with an accurate outcome and a specific next action.
- Inline markers and the Issues inspector identify draft and column when known.
- Keep technical SQL details expandable/copyable. Do not replace all errors with a generic Refresh button.
- Example confirmed failure: `Could not save 3 rows. No changes were applied. Name exceeds its maximum length.` Actions: Go to issue, Details.
- Example unknown outcome: `The connection was lost before save completion was confirmed. Your pending changes have been retained.` Action: Reconcile.
- Compile-time validation errors must carry structured draft/column identity just as execution errors do.

### Conflict resolution

Show three values for each affected field: Original, On server now, and Your change. Permit keeping the current server value or explicitly reapplying a proposal against a freshly captured baseline. A concurrent deletion needs its own recovery action; do not silently turn an update into an insert.

Prefer rowversion when present. Without it, define and test comparison semantics for every supported writable type. Structured columns excluded from equality predicates cannot silently receive a guarantee of lost-update protection. If safe conflict detection is unavailable, explain the limitation and restrict the operation or obtain an explicit informed choice.

## 9. Changes, Issues, and SQL inspector

- Changes groups inserts, updates, and deletes, showing row identity and original-to-proposed differences.
- Each entry can focus its grid row or reveal an off-page draft without silently clearing active filters.
- Revert cell, revert row, remove pending insert, and discard all are distinct actions.
- Discard all affects pending drafts, not persisted database records, and should be recoverable through local undo where feasible.
- Issues lists current validation/conflict problems and supports Next/Previous issue navigation.
- SQL shows the batch for the current validated snapshot. An invalid draft shows its compilation issue, not an apparently executable stale script.
- Support Copy SQL and Open in SQL editor. Opening a script does not mark drafts saved; external execution is outside this editor's acknowledgement path.
- Changing a draft invalidates the previously generated preview until regenerated.

## 10. Filtering, selection, and paste

- Filter operators depend on column capabilities. Do not offer text contains for a type that cannot support it.
- Distinguish Is NULL from Equals empty string in labels and behavior.
- Applying filters preserves pending changes and labels pending inserts as not yet evaluated against the server filter.
- Support column resizing, selection, and rectangular copy/paste using existing grid conventions.
- Paste is one undoable staging operation. Validate destination types and dimensions before applying it; never silently skip locked cells or shift values to different columns.
- Default behavior for a paste that intersects non-writable columns is to reject it with an explanation and retain the clipboard source unchanged.
- Text `NULL` in a text paste is literal text by default. Semantic NULL/default insertion requires an explicit action or documented structured import mode.
- Multi-row paste may create multiple pending inserts, without making all of them sticky or immediately saving them.

## 11. Visual design, accessibility, and localization

- Use theme tokens and verify light, dark, and high-contrast themes.
- Dirty cells receive subtle shading; row state also has an icon/text label. Color alone cannot distinguish new, changed, deleted, or failed states.
- Focus uses a clearly visible outline distinct from dirty/error styling.
- Keep exact raw values available even when display formatting or ellipsis is used.
- Avoid repeating inactive undo/delete controls on every row when selection or a row menu can expose them clearly.
- Expose grid coordinates, column names, types/read-only state, and validation descriptions to assistive technology using the grid's supported accessibility model.
- Sort controls are keyboard accessible and announce sort direction.
- Insertion, document editing, issue navigation, and conflict resolution must restore focus predictably.
- Announce save start/outcome and row creation without announcing every keystroke or rerender.
- Localize every user-facing string through the repository's locConstants sources. Use parameterized strings, not concatenated plural suffixes. Do not edit generated localization output.
- Follow repository startup scheduling guidance: requestAnimationFrame for visual synchronization and queueMicrotask for immediate nonvisual work.

## 12. Acceptance scenarios

| ID  | Scenario                                                          | Expected result                                                                                                                                                          |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A01 | Edit an AdventureWorks alias-typed Name column.                   | Supported base type encodes correctly; no unsupported name error.                                                                                                        |
| A02 | Edit, refresh, then save.                                         | Original draft is retained and either saved or explicitly conflicted.                                                                                                    |
| A03 | Edit on page 1, navigate to page 2, edit again, save.             | Both pending rows are submitted exactly once.                                                                                                                            |
| A04 | Filter or sort a dirty row out of view.                           | Draft remains in Changes and in the save snapshot.                                                                                                                       |
| A05 | Enter the last character and immediately click Save.              | Submitted value includes that character.                                                                                                                                 |
| A06 | Attempt edits/discard/add during saving.                          | Initial release blocks mutation; acknowledged revision remains exact.                                                                                                    |
| A07 | SQL reports completedWithErrors.                                  | No success acknowledgement or draft clearing.                                                                                                                            |
| A08 | A later statement violates a constraint.                          | Real-server test verifies the entire batch rolls back and the session is reusable.                                                                                       |
| A09 | Connection drops before commit acknowledgement.                   | Outcome unknown; no blind retry or false rollback claim.                                                                                                                 |
| A10 | Save succeeds but follow-up read fails.                           | Saved status is retained; reload failure is reported separately.                                                                                                         |
| A11 | Edit high-precision decimal values.                               | Exact values survive write/read and original-value comparison.                                                                                                           |
| A12 | Open a value larger than the page bound.                          | Complete content is fetched and verified before editing is enabled.                                                                                                      |
| A13 | Full-value fetch fails or exceeds supported limits.               | Preview remains read-only; no Apply path writes the prefix.                                                                                                              |
| A14 | Double-click a nullable text value.                               | Enters editing/selects text; never sets NULL.                                                                                                                            |
| A15 | Enter NULL, empty string, and default in separate inserts.        | Distinct SQL meanings and distinct visible states.                                                                                                                       |
| A16 | Open an untouched New row surface, then Save other edits.         | No unintended insert occurs.                                                                                                                                             |
| A17 | Insert using defaults on a compatible table.                      | Exactly one explicitly requested default insert is staged and saved.                                                                                                     |
| A18 | Tab out of the last field of a valid insert.                      | Draft is retained; fresh insertion surface opens; no database write occurs.                                                                                              |
| A19 | Tab out of an invalid insert.                                     | Issue is shown, values remain, and keyboard users can still leave the surface.                                                                                           |
| A20 | Scroll and resize columns while entering an insert.               | Draft stays aligned and visible; final data row and scrollbar remain reachable.                                                                                          |
| A21 | Insert a row excluded by the active filter.                       | Save acknowledged; explanation and locate action provided.                                                                                                               |
| A22 | Another session updates/deletes the target.                       | Supported conflict policy detects it and preserves the proposal.                                                                                                         |
| A23 | Exact-one-row guard matches multiple records.                     | Rollback and explicit ambiguity message, not changed/deleted guess.                                                                                                      |
| A24 | Close and reopen with pending work.                               | Chosen close-guard/recovery contract preserves or explicitly discards the draft.                                                                                         |
| A25 | Paste across a generated/read-only column.                        | Entire incompatible paste is rejected clearly, without silent value shifting.                                                                                            |
| A26 | Edit nullable bit through all states.                             | True, False, NULL remain selectable and distinct.                                                                                                                        |
| A27 | Page contains exactly pageSize rows and no more.                  | Next-page affordance does not lead to a falsely advertised data page.                                                                                                    |
| A28 | Use keyboard and screen reader in high-contrast mode.             | Full edit/save/recovery flow remains operable and understandable.                                                                                                        |
| A29 | Consume editing and diagnostics from sql-feature.                 | Consumers use explicit public entry points; neither feature imports the other's implementation.                                                                          |
| A30 | Run a DMV query and an edit through the shared execution adapter. | Both preserve structured outcomes and exact cell semantics; editing does not accept display-only truncation as a complete value.                                         |
| A31 | Build and test sql-feature outside the extension host.            | Feature logic has no VS Code or webview dependency; supported runtime requirements are declared.                                                                         |
| A32 | Complete the package migration.                                   | Workspace scripts, extension dependencies, builds, tests, and packaging use sql-feature; old package references are removed except intentional historical documentation. |

## 13. Verification and observability

### Automated coverage

- Codec/metadata tests: aliases, exact numeric boundaries, defaults, unsupported capabilities, typed comparisons, structured and incomplete values.
- Controller tests: draft survival, off-page compilation, immutable save revisions, active-editor flushing, stale reads, close/recovery integration, and post-save read failure.
- Adapter tests: structured server messages, completedWithErrors, connection loss, cancellation, and preserved truncation metadata.
- UI tests: insertion lifecycle, focus, NULL/default semantics, document-editor safety, paste, undo/redo, and actionable issues. Await asynchronous rendering before assertions.
- Real-server integration: transactions/rollback, constraints, triggers, rowversion, key changes, alias types, exact numerics, long values, concurrent sessions, and interrupted acknowledgements.
- Package boundaries: verify declared exports resolve, reject cross-feature private imports and VS Code dependencies, and exercise migrated consumers through public entry points. Run the package and affected MSSQL lint/test targets using the workspace's configured commands.
- Use repository Sinon/Chai/sinon-chai conventions for MSSQL tests and appropriate existing package conventions elsewhere. Test behavior, not incidental callback order.

### Performance validation

- Exercise supported page-size extremes, wide tables, long text previews, many pending drafts, and an open inspector.
- Verify mounted rows/editors remain bounded with virtualization and that typing does not wait for RPC.
- Measure input responsiveness, page rendering, save duration, and memory before setting release budgets. No measured performance claim is made by this specification.

### Diagnostics

- Record operation IDs, draft revision IDs, duration, row-operation counts, outcome category, error classification, and reconciliation result.
- Never include raw cell values, credentials, generated SQL containing values, or connection secrets in telemetry.
- Use structured diagnostics to distinguish validation, execution, conflict, transport, and reload failures.

## 14. Delivery sequence

### Phase 0: sql-feature foundation and migration

Create `packages/sql-feature` with the module boundaries and public exports in section 17. Reconcile the shared execution contracts before moving consumers; preserve exact values, structured errors, and truncation metadata. Migrate editing and diagnostics with their existing tests, then update extension imports, dependencies, workspace targets, and packaging. Remove superseded packages after all consumers have migrated. Keep the migration reviewable and distinguish behavior-preserving moves from correctness fixes. Package consolidation must not defer known data-loss fixes from Phase 1.

### Phase 1: Save and value correctness

Fix alias resolution, exact numeric encoding, execution outcome classification, truncation safety, and mutation races. Establish real-server transaction tests. Remove double-click-to-NULL. Do not depend on a full visual rewrite to address these defects.

### Phase 2: Durable draft model

Decouple drafts from pages; add structured semantic value states, operation-specific capabilities, validation issues, request coordination, and conflict handling. Resolve the close/recovery lifecycle. Prove navigation cannot lose drafts.

### Phase 3: Grid and insertion experience

Adopt FluentSlickGrid, implement local active editors and the sticky insertion surface, add keyboard navigation/undo, integrate the inspector, and reconcile inserted identities and visibility.

### Phase 4: Completion and rollout

Finish paste, accessibility, localization, theme verification, diagnostics, and performance measurements. Keep the feature in its existing preview rollout until the acceptance scenarios for supported capabilities pass. Document unsupported capabilities explicitly.

## 15. Open decisions requiring product review

1. Confirm the primary audience: quick developer fixes, DBA maintenance, or bulk spreadsheet editing. This changes emphasis and rollout order, not the correctness requirements.
2. Confirm the desired row-entry keyboard convention: proposed Tab-at-last-field stages and starts another row; Enter commits only the cell.
3. Choose the supported close/recovery mechanism after validating VS Code lifecycle capabilities and draft-storage expectations.
4. Decide which keyless and structured-type conflict scenarios are supported at initial release; do not imply universal safe editing.
5. Decide whether multi-row paste is required for the first preview or a follow-up. Basic cell navigation and draft safety remain required.

## 16. References

- Repository guidance: [AGENTS.md](AGENTS.md), [DEVELOPMENT.md](DEVELOPMENT.md).
- Current UI: [tableEditor.tsx](extensions/mssql/src/webviews/pages/TableEditor/tableEditor.tsx).
- Shared state: [tableEditor.ts](extensions/mssql/src/sharedInterfaces/tableEditor.ts).
- Controller: [tableEditorWebviewController.ts](extensions/mssql/src/tableExplorer/tableEditorWebviewController.ts).
- Adapter: [dataPlaneRunner.ts](extensions/mssql/src/sqlDiagnostics/dataPlaneRunner.ts).
- Engine: [sql-edit](packages/sql-edit/src/index.ts).
- Existing diagnostics engine: [sql-diagnostics](packages/sql-diagnostics/src/index.ts). These existing source links document the reviewed implementation; the target architecture is described below.
- SQL Server distinguishes system and user-defined type identifiers: [sys.types documentation](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-types-transact-sql).
- Conversion from decimal/numeric to float can lose precision: [decimal and numeric documentation](https://learn.microsoft.com/en-us/sql/t-sql/data-types/decimal-and-numeric-transact-sql).

## 17. sql-feature package architecture

Companion SQL Server Agent plan: [SQL_AGENT_EXPERIENCE_PLAN.md](SQL_AGENT_EXPERIENCE_PLAN.md) covers job creation, scheduling, listing, history, and reviewed management. It is planning-only.

Companion Query Store plan: [QUERY_STORE_EXPERIENCE_PLAN.md](QUERY_STORE_EXPERIENCE_PLAN.md) covers setup, settings, historical diagnosis, and reviewed interventions. It is planning-only.

Companion DMV plan: [DMV_EXPERIENCE_PLAN.md](DMV_EXPERIENCE_PLAN.md) defines the standalone entry point, guided setup, evidence presentation, and diagnostic interpretation. It is planning-only.

### 17.1 Decision and scope

Use one package, `sql-feature`, for reusable SQL Server feature engines. Initially consolidate all existing functionality from `sql-edit` and `sql-diagnostics`: editing, DMV diagnostics, Query Store, profiling/Extended Events, and SQL Agent operations. A single package is not permission to create a single undifferentiated module.

The package owns SQL generation, domain validation, capability requirements, result interpretation, and feature execution workflows. The extension owns concrete connections/data-plane integration, VS Code APIs, webview state transport, localization, grid presentation, and user interaction. Node.js-specific functionality such as file parsing must declare its runtime requirements; do not imply browser compatibility for every entry point.

### 17.2 Structure and public API

Query Store and SQL Server Agent also require separate extension entry points: `mssql.queryStore.open` opens its own database-scoped Query Store panel; `mssql.sqlAgent.open` opens its own instance-scoped Agent jobs panel. Neither requires navigating the combined SQL Diagnostics panel. Each owns its setup/readiness flow; see the companion plans for requirements.

```text
packages/sql-feature/
  src/
    core/                   Shared execution/value/error contracts and capabilities
    edit/                   Metadata, codecs, DML, concurrency, edit session engine
    diagnostics/
      dmv/                  Requests, blocking, waits, query statistics, and related analysis
      querystore/           Query Store queries and operations
      profiler/             Extended Events capture, parsing, and analysis
    agent/                  SQL Agent queries and operations
  test/                     Tests grouped by the corresponding modules
```

Declare these public package export paths:

| Import                               | Responsibility                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `sql-feature/core`                   | Shared execution contracts, exact value representation, structured errors/outcomes, server capabilities |
| `sql-feature/edit`                   | Table editing metadata, validation, compilation, concurrency, and execution                             |
| `sql-feature/diagnostics/dmv`        | Diagnostic DMV catalog, capability requirements, typed results, and analysis                            |
| `sql-feature/diagnostics/querystore` | Query Store feature API                                                                                 |
| `sql-feature/diagnostics/profiler`   | Profiler and Extended Events feature API                                                                |
| `sql-feature/agent`                  | SQL Agent feature API                                                                                   |

Use explicit imports rather than a root barrel exporting every feature. Consumers must not deep-import private source/dist paths. Each entry point exports only its supported API, with implementation details remaining private.

### 17.3 Dependency rules

- Feature modules may depend on core. Core must not depend on feature modules, VS Code, React, Fluent UI, or concrete connection backends.
- Features must not import another feature's private implementation. Cross-feature orchestration belongs in the extension or a deliberately defined composition API.
- Put a helper in core only when it represents a real shared contract or invariant. Keep feature-specific SQL, interpretation rules, and defaults with their feature.
- Avoid eager initialization or imports of profiler/file-processing code when a consumer imports editing or DMV functionality.
- Enforce boundaries through lint/import restrictions and public-entry-point checks.

### 17.4 Shared execution contract

The existing engines have similar-looking but semantically different SqlRunner and QueryResult interfaces. Consolidation must resolve these differences rather than copy them into one file or choose the more permissive definition.

- Separate composable capabilities for bounded query execution, streaming, retained-cell fetching, and server discovery. Editing should require only the capabilities it uses.
- Represent exact values and incomplete values explicitly. Display conversion is a separate operation and cannot discard information needed for writes or comparisons.
- Preserve structured server messages and distinguish success, completion with errors, cancellation, connection loss, and unknown write outcome.
- Specify retained-cell ownership and lifetime so disposing a result cannot unexpectedly invalidate content a feature still needs to fetch.
- Define cancellation and per-session operation coordination consistently across features.
- Keep the concrete adapter in the extension's shared data-plane integration layer, outside the diagnostics feature directory. Both editing and diagnostics consume that adapter through the common contracts.
- Allow read and write workflows to interpret partial results differently, but never let a diagnostics convenience policy convert an errored write into success.

### 17.5 DMV ownership

Diagnostic DMV functionality belongs in `sql-feature/diagnostics/dmv`; no separate DMV package is planned. Organize it by diagnostic purpose, such as requests, blocking, waits, and query statistics, rather than one module per underlying system view.

Each diagnostic operation should define stable identity, input validation, platform/version/scope requirements, permission requirements, SQL generation, result schema, units, and interpretation rules. Capability support and actual permission to execute are separate facts; unsupported and permission-denied states must remain distinguishable.

Where snapshot comparison is supported, preserve collection time and relevant server/database identity. Detect counter resets or incompatible samples before presenting deltas or rates. Keep snapshot comparison semantics with the diagnostic feature.

DMV use alone does not determine ownership: an editing-specific metadata query remains in edit even if it reads a DMV. SQL Agent remains its own module because job administration is broader than diagnostic observation.

UI column widths, localized labels, selection state, and grid layout remain in the extension. Domain output may expose semantic units and stable field identifiers so the UI can format results without parsing display text.

### 17.6 Migration requirements

1. Inventory public symbols and consumers of both existing packages, including scripts, tests, and packaging targets.
2. Define and test the unified core contracts against both editing and diagnostics needs.
3. Move feature implementations and tests into sql-feature, preserving behavior except separately identified correctness fixes.
4. Add explicit package exports and migrate the shared adapter and extension consumers.
5. Update manifests, lockfiles, TypeScript references/configuration, build/watch/test/lint targets, and bundling or packaging rules as applicable.
6. Verify standalone feature tests and affected extension integration tests through the public exports.
7. Remove old sql-edit/sql-diagnostics workspace packages once migration is complete. If temporary compatibility re-exports are needed during the transition, keep one implementation and remove the shims before declaring migration complete.

Do not migrate VS Code controllers or webviews into sql-feature merely to reduce the number of extension files. Do not add empty modules for hypothetical future features. The table-editor behavior and acceptance requirements in this specification remain unchanged by package consolidation.
