# Language feature review TODO

Ticked items are implemented with tests; the progress ledger records the evidence for each.

## Shared foundations

- [ ] Replace the separate built-in name, completion, hover, signature, arity, and return-type lists with one versioned registry.
- [ ] Add a grammar-node coverage matrix for coloring, folding, hover, definition, and signature help.
- [ ] Add incomplete-typing and recovery cases to every feature's shared fixture matrix.
- [ ] Keep all features on the published syntax/semantic snapshot; forbid feature-local parsing and metadata enumeration.
- [ ] Add latency and allocation gates for full documents, viewports, edits, and metadata rebinding.

## Coloring

- [ ] Clip and color multiline comments and strings that cross a range request boundary.
- [ ] Make semantic-token updates computationally incremental instead of recoloring the full document before diffing.
- [ ] Forward real document changes and changed semantic units into color-delta calculation.
- [ ] Classify every grammar-backed object, principal, securable, routine, type, alias, and member role.
- [ ] Complete read, write, declaration, definition, system, deprecated, and default-library modifiers.
- [ ] Add compatibility-level and engine-flavor tests for versioned keywords and built-ins.
- [ ] Add metadata-rebind, stale-version, cancellation, Unicode, and very-large-document adapter tests.

## Folding

- [ ] Replace broad `*Statement` inference with a reviewed fold policy for every structural grammar node.
- [ ] Cover advanced query, programmable-object, security, administrative, JSON, XML, and specialized DDL bodies.
- [ ] Verify folds sharing a start line choose the most useful region without hiding valid nested folds.
- [ ] Verify closing-line behavior for blocks, comments, regions, clauses, batches, and generated VS Code ranges.
- [ ] Correct transaction folding around savepoints, named rollback, nesting, and batch boundaries.
- [ ] Add malformed and partially typed block tests that never invent or cross a statement boundary.

## Hover

- [ ] Serve built-in signatures, return types, availability, and documentation from the shared registry.
- [ ] Complete system-variable, data-type synonym, JSON, vector, XML, spatial, hierarchyid, and CLR-member hover.
- [ ] Add rich hover for aliases, CTE/result shapes, local routines, expressions, schemas, databases, and principals.
- [x] Prevent a generic syntactic hover from masking a richer catalog or bound-symbol hover.
- [ ] Refresh or await lazily hydrated columns and parameters so the first hover is useful.
- [ ] Add exact-token boundary, quoted-name, multipart-name, recovery, and stale-metadata tests.

## Definitions

- [x] Replace literal NUL separators in `objectDefinitions.ts` so the source remains text and reviewable.
- [ ] Bind definition targets for columns, DML targets, routines, types, synonyms, triggers, sequences, principals, and securables.
- [ ] Add scripting mappings and metadata kinds for every scriptable definition target, including CLR types.
- [ ] Verify same-document CREATE/ALTER/DROP visibility and cross-database navigation at the cursor offset.
- [ ] Make shared definition fetches cancellation-safe for independent callers and do not cache aborted or empty results.
- [ ] Reject an asynchronous result when the source document version or metadata generation changed.
- [ ] Version or invalidate virtual definition documents and bound their content cache.
- [x] Include object kind in virtual document identity to avoid namespace collisions.
- [ ] Return origin and target selection ranges through a definition-link contract.
- [x] Record scripting failures and latency in preview statistics without showing noisy editor errors.

## Signature help

- [ ] Populate built-in overloads, types, optional parameters, variadic parameters, return types, and version gates from the shared registry.
- [x] Fix `PARSE` and `TRY_PARSE` so `USING` advances to the culture parameter.
- [ ] Cover every grammar-specific callable or function-like expression, not only generic function calls.
- [ ] Preserve signature context through missing names, missing delimiters, nested calls, recovery nodes, and partially typed arguments.
- [x] Complete active-parameter tracking for named arguments, multiple VALUES rows, INSERT column lists, and keyword-separated arguments.
- [ ] Add automatic trigger/retrigger behavior for EXEC arguments and keyword-separated conversion arguments.
- [ ] Make metadata hydration produce useful help on the first request and remain cancellation/version safe.

## Integration and acceptance

- [ ] Add extension adapter tests for cancellation and edits arriving during hover, definition, signature, folding, and coloring requests.
- [ ] Add end-to-end preview tests using catalog objects, local DDL, cross-schema names, and cross-database names.
- [ ] Run the feature matrix over the organized T-SQL corpus with zero new false diagnostics or recovery regressions.
- [ ] Require full/incremental equivalence and stable ranges after edits at the start, middle, and end of a document.
- [ ] Require package fast tests, extension typecheck, focused adapter tests, and feature performance gates before completion.
