# Grammar provenance and maintenance

The T-SQL grammar, tokenizers, recovery policy, semantic model, and diagnostics in this package are
maintained as an independent implementation under the repository MIT license. They are not generated
from another parser and do not create a runtime dependency on one.

Rules are derived from public SQL Server, Azure SQL, Azure Synapse, and Fabric documentation plus
independently maintained positive, negative, incomplete-input, dialect, and real-world fixtures in
this repository. Public conformance tools may be used as differential evidence, but a differential
result is reviewed rather than copied or treated as the implementation.

## Required change discipline

Every grammar change includes:

1. a short comment explaining the construct and any ambiguity or recovery choice;
2. positive tests for supported complete forms;
3. negative tests proving nearby invalid forms remain invalid;
4. incomplete-typing and next-statement recovery tests where the construct is editor-facing;
5. incremental-versus-fresh equivalence;
6. per-fixture corpus deltas with no hidden regression;
7. a same-machine benchmark when a hot or ambiguous rule changes.

Generated files under `src/syntax/lezer/generated/` are committed and protected by an input/output
hash. Run:

```powershell
npm run build:grammar
npm run check:grammar
```

The keyword registry is committed source. Updates must cite the public product documentation that
introduced, changed, or removed the keyword and must keep token classification, completion, and
profile availability in agreement.

## Diagnostic evidence

Syntax and semantic diagnostics are asserted by stable code, severity, message, and exact UTF-16
range. Message catalogs alone are not evidence that a diagnostic exists: each supported family has
an executable positive and negative path, and unknown metadata never becomes an authoritative
absence diagnostic.
