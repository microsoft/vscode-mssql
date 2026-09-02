# Text inspection policy

The generated grammar and its immutable syntax snapshot own T-SQL structure. Completion, binding,
diagnostics, hover, navigation, signatures, folding, and coloring must not parse a document again.

## Allowed text inspection

Regular expressions and character scans are allowed only for bounded lexical facts that the tree
does not represent, or for an explicitly tested recovery/edit shape inside a structural owner from
the tree. They must never scan across statements or batches to decide which SQL construct owns a
caret or token.

| Owner                                          | Narrow responsibility                                                                          | Direct evidence                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `semantics/identifiers.ts`                     | Complete and incomplete identifier spelling, quoting, escapes, and multipart components        | `test/unit/features/hostile-identifiers.test.ts`, identifier unit tests |
| `features/completionExpansions.ts`             | Whitespace and empty-delimiter cleanup after the tree has selected an INSERT or star expansion | `test/unit/features/completion/smart-expansion.test.ts`                 |
| `features/signatureHelp.ts`                    | Active named argument and output-modifier spelling inside a parser-owned argument node         | `test/unit/features/signature-help/*.test.ts`                           |
| `features/foldingRanges.ts`                    | Comment-region markers and blank-line separation                                               | folding-range tests                                                     |
| `semantics/diagnostics/diagnosticTextFacts.ts` | Named, bounded compatibility/recovery facts absent from individual grammar nodes               | `test/unit/semantics/diagnostic-text-facts.test.ts`                     |
| `semantics/diagnostics/*Diagnostics.ts`        | Family-local lexical value validation after a typed structural node has been selected          | matching `test/unit/semantics/diagnostics/*.test.ts` suites             |
| `semantics/vectorSemanticDiagnostics.ts`       | Vector option/value spelling within typed vector nodes                                         | `test/unit/semantics/diagnostics/vector.test.ts`                        |
| `semantics/model/expressionTypes.ts`           | Literal and declared-type spelling after expression/type nodes are known                       | semantic-model and type-inference tests                                 |

Node-kind checks, catalog lookups, and indexed semantic-model queries are not secondary parsers.
They consume the single published Lezer syntax tree and bound snapshot. New code that needs to know
"which clause or statement is this?" must add or use a tree/cursor-context helper. New identifier
patterns must use the central identifier module; the architecture check rejects independent Unicode
identifier grammars.

`features/metadataEffects.ts` is the one deliberate parser entry outside document publication. It
classifies SQL that the host reports as actually executed, which may be a selection or transformed
payload and therefore may not equal any open document snapshot. Its output is only a catalog-cache
invalidation decision; it does not answer an editor feature or create competing document state.

When recovery makes bounded text inspection unavoidable, the owning function must be named for the
fact it answers, explain its range boundary, and have positive, negative, malformed-input, Unicode,
and edge/boundary coverage appropriate to that fact.
