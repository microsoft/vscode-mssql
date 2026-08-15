# Claude diagnostic work guide

Use [SEMANTIC_DIAGNOSTIC_BACKLOG.md](./SEMANTIC_DIAGNOSTIC_BACKLOG.md) as the authoritative work
queue. It contains one implementation line for every remaining catalog entry. Keep its checkboxes
and exact supported/remaining counts current after every accepted batch.

## Completion contract

A diagnostic family is complete only when:

- behavior comes from reviewed T-SQL examples and structured syntax/binding facts, not text scans;
- code, severity, message arguments, and smallest useful range are exact;
- tests cover the error, nearby valid SQL, malformed SQL, quoted/multipart names, applicable
  CREATE/ALTER forms, incomplete metadata, and incremental/fresh equivalence;
- all package tests and the checked-in corpus guard pass without weakening a baseline; and
- the relevant direct benchmark has no unexplained material regression.

The six catalog entries `ParseResultsShouldNotContainNullElement`, `CommaOr`, `Expecting`,
`EndOfFile`, `Comma`, and `Period` are preconditions/message fragments, not standalone product
diagnostics. Correct the denominator with explicit inventory tests before reporting coverage.

## Autonomous batch loop

Work on no more than three dependency-compatible families at a time:

1. Select the next unchecked backlog line and add a dated progress entry before editing code.
2. Prove the required syntax node, binder fact, and metadata completeness state exist. If not, add
   the narrow foundation first or mark the item blocked with the exact missing contract. Never use
   a heuristic to bypass a missing prerequisite.
3. Add failing tests first, using `suite`/`test` and a short comment describing the protected T-SQL
   behavior.
4. Implement at the lowest correct layer:
    - token/statement shape in syntax;
    - statement-local structural rules in syntax diagnostics;
    - resolved names, scopes, types, and cross-statement facts in the binder;
    - persisted-object facts only through authoritative metadata.
5. Run focused tests, then `node --test test/*.test.js`. Do not update a corpus baseline to hide a
   regression. If one aggregate test fails, enumerate every regressed fixture and error-count delta.
6. Run `benchmarks/semantic-diagnostics.mjs` for binder work. If grammar changed, also run the
   100 KiB and 1 MiB parser benchmark. Record before/after p50 and p95.
7. Check completed lines, update exact counts, record evidence, then continue automatically only
   when the current batch is clean.

## One-line execution order

- [ ] Remove the six non-diagnostic catalog entries from the coverage denominator.
- [ ] Finish syntax-only option/statement validators in related batches of at most three.
- [ ] Finish cursor grammar, then its three cursor-option validators.
- [ ] Finish routine and trigger validators that need no catalog metadata.
- [ ] Structure external-stream options, then implement `RequiredParam` and `DuplicateParam`.
- [ ] Add immutable build-mode settings and contract tests, then its 14 dependent validators.
- [ ] Add complete index/statistics metadata to every provider, then index/view/constraint families.
- [ ] Add complete trigger ownership/action metadata, then trigger catalog families.
- [ ] Add SQL expression types/nullability/conversions, then binding and type-clash families.
- [ ] Add complete CLR/UDT member metadata, then member-resolution families.
- [ ] Add security metadata for credentials, certificates, and asymmetric keys, then absence checks.
- [ ] Add authoritative collation metadata, then `InvalidCollation`.
- [ ] Finish pivot/unpivot and XML invocation families, then audit the complete inventory.

The backlog’s individual lines are the implementation recipes. Do not replace them with broad
milestones.

## Metadata rules

A missing-object diagnostic may fire only when the relevant provider section is complete and
current. Unknown, loading, stale, timed-out, cancelled, permission-denied, or unavailable metadata
is not evidence that an object is absent.

Metadata contract changes must be narrow and additive. Update the simple-query, development, null,
and in-memory providers plus their shared contract suite in the same batch. Test both
confirmed-absent and incomplete-catalog behavior. Never put credentials in source or tests, and do
not mutate integration databases.

## Grammar and build rules

Change grammar only when the required structured node is absent. Add concise rule comments, group
closely related additions, then generate once with:

```powershell
node --max-old-space-size=8192 scripts/build-grammar.mjs
```

Do not run TypeScript compilation while grammar generation is running. Do not add permissive
catch-all rules that hide unsupported syntax or create phantom statements. Compile and test the
library; do not package the extension as part of this loop.

## Progress record

Append this after each batch:

```text
### YYYY-MM-DD — family-a, family-b
- Status: complete | blocked
- Layer: syntax | binder | metadata
- Evidence: focused N/N; full N/N; corpus regressions 0
- Coverage: supported X/Y; product families remaining Z
- Performance: binder p50 A→B ms, p95 C→D ms (plus parser figures if grammar changed)
- Notes: exact blocked dependency or notable false-positive guard
```

Stop and document the blocker instead of guessing when exact behavior is not established, syntax
cannot represent the construct, authoritative metadata is missing, false-positive guards fail, a
corpus file regresses, or benchmark movement is unexplained.

The final gate is: every real catalog family is complete or explicitly removed as a non-diagnostic,
zero package failures, zero corpus regressions, fresh/incremental equivalence, and recorded
benchmark results.
