# Production readiness assessment — Lezer T-SQL language service

Assessed at `40d3d30bf` (`feat: centralize T-SQL binding on one shared semantic model`) on Windows,
Node v24.15.0. Every figure below was measured on this checkout with the commands named beside it;
none is estimated. Machine calibration against the
[progress ledger](LANGUAGE_SERVICE_PROGRESS_LEDGER.md) baseline: parser warm full at 100 KiB measured
151 ms here against the ledger's 143 ms, so timings are comparable to that entry.

## Grade summary

| Area              | Grade  | One-line justification                                                            |
| ----------------- | ------ | --------------------------------------------------------------------------------- |
| Grammar coverage  | **A-** | 99.2% of the conformance corpus parses clean; ahead of ScriptDOM on Fabric        |
| Semantic coverage | **B**  | 46 diagnostics firing, all six profiles green, but 36 ScriptDOM families unmapped |
| Package size      | **A**  | 865 KB gzipped for the whole service, two small runtime dependencies              |
| Parser speed      | **B+** | Keystroke stays interactive to 1 MB; full parse is 0.67 MB/s                      |
| Semantic speed    | **B**  | Was quadratic and is now linear; a 200 KB keystroke went 48 s to 0.2 s            |
| **Overall**       | **B**  | Ships, with cold open of very large scripts the remaining budget question         |

The parser is in good shape. The semantic layer had one defect severe enough to block release on its
own; it has been fixed and the fix is described in
[section 5](#5-the-semantic-layer-was-quadratic-and-is-now-linear).

## 1. Grammar coverage — A-

`npm run report:corpus` over the 489-file SqlParser conformance corpus:

| Class                    | Clean           | Raw recovery nodes |
| ------------------------ | --------------- | ------------------ |
| Parseable                | 481/485 (99.2%) | 39                 |
| `validSupported`         | 179/182 (98.4%) | 15                 |
| `validProfileGated`      | 302/303 (99.7%) | 24                 |
| `intentionallyMalformed` | 1/4 (25.0%)     | 11                 |

By platform: azure-sql 7/7, fabric 20/20, synapse-dw 6/6, sql-server-or-common 448/452.

**Against ScriptDOM** (`npm run report:scriptdom-diff`), 471 of 489 fixtures agree exactly. Of the 14
where we accept and ScriptDOM rejects, most are cases where **this grammar is ahead of
`TSql170Parser`**: `CLONE TABLE`, `CLUSTER BY`, `ORDER BY ALL`, `GROUP BY ALL`, and nested CTEs are
real Fabric Warehouse syntax that ScriptDOM does not yet know.

Scale: 4,046 grammar lines, 1,468 node kinds, 169 statement families, 136 clause kinds, 183 reserved
and 347 contextual keywords.

**Why not an A.** `npm run report:dialect` measures a different axis and gives a much lower number:
**28 of 73 ScriptDOM families covered, 9 out of scope, 36 missing.** The corpus is 99% clean because
the corpus exercises the families that are implemented. Both numbers are honest; they answer
different questions, and the second is the one that predicts behaviour on scripts nobody has tested
yet. Neither figure should be quoted alone.

## 2. Semantic coverage — B

- **46 distinct semantic diagnostic codes** fire across the conformance corpus. The most frequent are
  `ScalarVariableRequired` (390), `MultiPartIdentifierBindingError` (63), `MSSQL207` (46),
  `NotRecognizedFunctionName` (24), `VariableNameNotUnique` (21).
- **All six engine profiles are green** on `npm run report:dialect`: sql-server 55/55,
  azure-sql-database 22/22, azure-sql-managed-instance 10/10, azure-synapse-dedicated 28/28,
  fabric-warehouse 29/29, unknown 8/8 — with zero unexpected recovery in any of them, and every
  classification bucket (valid, unsupportedProfile, invalid, incomplete) fully covered.
- **15 of 15 profile-gated features have a scenario**, from 33 registered features.
- Editor features are exercised per profile: completion, hover, signature help, definition, and
  colouring each have coverage in all six.
- 52 semantic and feature test files; 1,415 tests pass offline.

**Why not higher.** The same 36 missing ScriptDOM families bound semantic coverage as well — a
statement the grammar cannot shape is a statement the binder never sees. The gap is in breadth, not
depth: what is covered is covered thoroughly.

## 3. Package size — A

Clean `dist` after `rm -rf dist && npm run build:typescript && npm run build:workers`:

| Component          | Raw      | Gzipped |
| ------------------ | -------- | ------- |
| Shipped JavaScript | 3,035 KB | 865 KB  |
| Generated parser   | 525 KB   | 225 KB  |
| Type declarations  | 263 KB   | —       |
| Source maps        | 1,580 KB | —       |
| **`dist` total**   | 5.6 MB   | —       |

Runtime dependencies are `@lezer/common` and `@lezer/lr` only. 865 KB gzipped for a complete T-SQL
language service is comfortably within what an extension carries.

**One cleanup found.** The working `dist` measured 15 MB before this assessment because it held stale
output from earlier iterations — `dist/parser/` (3.3 MB), `dist/analysis/`, `dist/core/`,
`dist/semantic/` — none of which has a corresponding `src/` directory. `tsc` does not remove outputs
whose sources are gone. A clean build is 5.6 MB. Worth deleting `dist` in CI packaging so a stale
tree cannot be shipped.

## 4. Benchmarks — parser B+, memory A

Parser only, `LezerSyntaxService` with the semantic layer excluded, generated T-SQL corpus, best of
three full parses and best of five keystrokes:

| Document | Full parse | Keystroke | Throughput | Heap held | Heap / text |
| -------- | ---------- | --------- | ---------- | --------- | ----------- |
| 10 KB    | 21 ms      | 12.7 ms   | 0.46 MB/s  | 0.6 MiB   | 60x         |
| 100 KB   | 146 ms     | 13.3 ms   | 0.67 MB/s  | 0.5 MiB   | 4.8x        |
| 1 MB     | 1,506 ms   | 21.9 ms   | 0.66 MB/s  | 2.4 MiB   | 2.4x        |
| 10 MB    | 14,898 ms  | 123.7 ms  | 0.67 MB/s  | 18.2 MiB  | 1.8x        |

**Throughput is linear** at a flat 0.67 MB/s from 100 KB to 10 MB — no scaling defect in the parser.
Memory is well behaved and the per-byte ratio improves with size, which is what a shared tree should
do.

**The keystroke path is the one that matters and it holds up**: 13 ms at 100 KB and 22 ms at 1 MB,
against the 20 ms parse budget the runtime states. At 10 MB a keystroke costs 124 ms — over budget,
but 10 MB is a generated-script scenario rather than an editing one.

**Why not an A.** Cold open of a 1 MB script costs 1.5 seconds and a 10 MB script 15 seconds, both on
the UI-visible path. `benchmarks/run.mjs` shows the batch cache working as designed — a keystroke
reparses 1 of 12 chunks at 100 KB — so the incremental path is sound and it is first-open that needs
either work or an accepted budget.

## 5. The semantic layer was quadratic, and is now linear

### What it was

`InProcessLanguageServiceRuntime.open` and `.change` before the fix:

| Size   | Open      | One keystroke |
| ------ | --------- | ------------- |
| 10 KB  | 270 ms    | 174 ms        |
| 50 KB  | 3,175 ms  | 3,112 ms      |
| 100 KB | 12,211 ms | 11,101 ms     |
| 200 KB | 48,754 ms | 47,922 ms     |

Doubling the document quadrupled the time. Two measurements made it unambiguous: splitting the
phases at 100 KB gave **parse 202 ms, bind 12,619 ms**, so the parser was not involved; and
`binder.update()` with **1,558 units reused and 0 rebound still cost 11,324 ms**, so the cost was not
rebinding either. It was work done over the whole document regardless of what had changed.

### The cause, and why it was one cause rather than three

A CPU profile of the pure-reuse update put 76% of the time in tree traversal and 0.4% in the
semantic rules themselves. Three call sites were responsible, and they were the same mistake:

1. `localColumnsForName` walked the **entire document from the root** for every name that failed to
   resolve against the catalog — and an editor with no connected catalog resolves nothing, so every
   table reference took that path.
2. `columnType` and `columnTypeNamed` filtered **every relation in the document** for every column
   reference, then searched each relation's column list.
3. The binder filtered **the whole diagnostic list** once per unit to find that unit's diagnostics.

Each answered a lookup by scanning the collection it happened to be holding. Asked once per
reference, each is quadratic in the document.

Notably this was already a known shape here: a comment at `catalogSemanticBinder.ts` records that
`scopeOf` had the identical problem and was fixed with a keyed map, because _"scanning every scope
for every source made a large repeated SELECT document quadratic in its number of statements."_ Three
siblings of that bug survived.

### The fix

`src/semantics/model/lookups.ts` states the rule the layer now follows: **a lookup is keyed on what
is being looked up.** It provides two primitives and every site uses them.

- `RangeIndex<T>` answers _which of these lie inside this range_ and _which completed before this
  offset_, by binary search, preserving the collection's original order so tie-breaking is unchanged.
- `columnIndexFor` keys columns by folded name **and** indexes each name's bindings by position.
  Both keys are needed: keying only on the name works until a script reuses `id` or `name` across
  thousands of relations, at which point one name's list is the document again.

Every index is cached against the identity of the array it describes. Those arrays are rebuilt
whenever the model is, so an entry cannot outlive its data and nothing has to remember to invalidate.

### What it is now

| Size   | Open     | Open/KB | One keystroke | Edit/KB |
| ------ | -------- | ------- | ------------- | ------- |
| 25 KB  | 321 ms   | 12.85   | 87 ms         | 3.48    |
| 50 KB  | 414 ms   | 8.28    | 100 ms        | 2.00    |
| 100 KB | 724 ms   | 7.24    | 109 ms        | 1.09    |
| 200 KB | 1,030 ms | 5.15    | 206 ms        | 1.03    |
| 400 KB | 1,818 ms | 4.55    | 397 ms        | 0.99    |

Cost per kilobyte falls and then flattens, and doubling the document doubles the time — 1.77x and
1.93x across the last step. That is linear.

End to end through the worker at 100 KB, which is the figure this assessment first flagged:

| Measurement          | Before    | After      |
| -------------------- | --------- | ---------- |
| Worker edit, wall    | 11,923 ms | **107 ms** |
| Worker edit, binding | 11,892 ms | **84 ms**  |
| Worker initial open  | 12,586 ms | **934 ms** |

### Evidence that behaviour did not change

- 1,415 of 1,415 offline tests pass.
- The 755 semantic diagnostics the conformance corpus produces are **byte-identical** before and
  after: both fingerprint to `c27ea996dc40af79818b0692dd967afb`.
- Grammar conformance is unchanged at 481/485.

### The guard

`test/performance/semantic-scaling.test.js` asserts the _shape_ of the cost rather than a
millisecond figure: doubling the document must not more than triple the time. Quadratic growth fails
it by a wide margin while a slow or loaded machine does not, because both measurements move together.

Verified in both directions — it passes against the fixed code, and against the original it fails
with _"Doubling the document multiplied bind time by 3.89x"_. A test that has never been seen to fail
is not a guard.

### What remains

The keystroke path is now well inside budget at ordinary sizes. Cold open is linear but still 4.5 ms
per KB, so a 1 MB script costs roughly 4.5 seconds to open — worth either further work or an
explicitly accepted budget, but no longer a scaling defect.

## Recommendation

**The blocker is cleared.** The semantic layer is linear, a keystroke on a 200 KB script costs 206 ms
against 48 seconds before, and behaviour is provably unchanged.

**The parser is ready.** 99.2% corpus conformance, ahead of ScriptDOM on Fabric, linear throughput,
sound incremental behaviour, 865 KB gzipped.

Remaining, in order:

1. **Close the 36 missing ScriptDOM families.** This is now the largest gap and the one that decides
   behaviour on scripts nobody has tested. Track family coverage, not corpus conformance — the corpus
   is already 99% clean because it exercises what is implemented, so it will barely move.
2. **Decide the cold-open budget.** Opening is linear but 4.5 ms/KB, so a 1 MB script takes about
   4.5 seconds. Either reduce it or state it.
3. **Delete `dist` in CI packaging**, so stale output from removed sources cannot ship.
