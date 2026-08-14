# T-SQL grammar provenance and coverage

The language service implements an independently expressed Lezer grammar. It uses the following
Microsoft sources as behavioral references; generated parsers or parser implementation code are not
copied into the package.

## Authorities

| Concern                                | Primary reference                                           | How it is used                                                                                |
| -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Syntax validity and versioned grammar  | ScriptDOM `TSql150.g`, `TSql160.g`, and `TSql170.g`         | Rule shape, legal alternatives, and SQL Server 2019/2022/2025 feature availability            |
| Editor recovery and syntax diagnostics | SqlParser `sql.150.y`, `sql.160.y`, and `sql.170.y`         | Recovery boundaries and the message, severity, and UTF-16 span expected for malformed input   |
| Reserved and contextual vocabulary     | SqlParser `Keywords/keywords.txt` and `ContextKeywords.txt` | The committed generated keyword catalog used by token classification and grammar specializers |
| Lossless lexical behavior              | `dev/query` lexer                                           | Trivia, exact offsets, line-start state, batch separators, and incremental/full equivalence   |

The checked source inventories contain 480, 482, and 486 top-level ScriptDOM parser rules for
versions 150, 160, and 170. The corresponding SqlParser grammars contain 1,663, 1,685, and 1,716
productions. The keyword catalog contains 183 unique globally reserved spellings and 347 unique
contextual spellings (524 unique spellings in the union at the time of import).

Run the explicit importer when SqlParser's keyword catalogs change:

```powershell
node scripts/import-sqlparser-keywords.mjs --sqlparser-root C:\path\to\SqlParser
```

Normal builds consume the committed `src/syntax/keywords.generated.ts` file and do not depend on a
local SqlParser checkout.

## Version policy

The supported profiles are SQL Server 2019 (compatibility 150), SQL Server 2022 (160), and SQL
Server 2025 (170). The parser accepts the structural superset needed by an editor. Feature-profile
diagnostics report syntax that is unavailable for the selected engine or compatibility level.

Keyword recognition is not restricted to keywords introduced in those three releases. The complete
T-SQL vocabulary remains classified so that older, deprecated, administrative, and contextual
constructs can be parsed and colored correctly. Contextual words remain valid identifiers outside
the grammar contexts that give them keyword meaning.

## Porting rules

1. Every Lezer rule has a short comment stating its purpose.
2. Every added rule has positive, negative, recovery, and incremental/full-equivalence tests where
   those cases are meaningful.
3. Syntax diagnostics are compared to SqlParser's message, severity, and exact UTF-16 span.
4. Unsupported syntax remains visible as an error node; it is never hidden by a generic
   "unknown statement" production.
5. Grammar helper rules stay unnamed where possible so the retained tree contains semantic
   structure rather than punctuation wrappers.
6. Benchmarks run after coherent rule groups and track correctness separately from latency,
   throughput, retained tree size, and incremental reuse.

## Coverage order

The port proceeds in reviewable vertical slices: lexical/script/batch foundations; expressions and
queries; DML; table and programmable-object DDL; control flow; security and administration; then
specialized SQL Server 2019/2022/2025 features such as JSON and vector indexes/search. Coverage is
tracked against both grammar inventories rather than inferred from a handful of example files.
