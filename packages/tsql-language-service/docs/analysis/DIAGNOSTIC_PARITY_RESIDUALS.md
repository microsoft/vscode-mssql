# Diagnostic parity: measured state and classified residuals

Date: 2026-09-03

This is a **snapshot of an in-progress comparison, not a completion report.** It records what the
package currently reports against an external behavioral corpus, classifies every difference, and
names the differences that are open work rather than decisions.

The corpus holds 4,343 T-SQL fixtures, each one SQL input plus the diagnostics a reference parser
reports for it. The comparison normalizes whitespace and compares message multisets per fixture.
The corpus and the comparison harness live outside this repository, so any measurement quoted in a
review has to name the corpus revision it came from; the counts below are only meaningful against
the corpus captured on the date above.

## What the comparison measures, and what it does not

The comparison runs the binder against an **empty metadata provider**. Every table, column, schema,
and variable in every fixture is therefore unresolved, and the diagnostics that follow from that are
counted as differences even though an editor connected to a database reports none of them. That
accounts for most of the surplus below and has to be read out before the remaining numbers mean
anything.

## Current numbers

| Measure                                                                   |                    Value |
| ------------------------------------------------------------------------- | -----------------------: |
| Expected diagnostic occurrences                                           |                    2,079 |
| Matched                                                                   |            1,789 (86.0%) |
| Unmatched                                                                 |                      290 |
| Surplus (reported, not expected)                                          |                    3,567 |
| Shapes the service reports nothing for while the corpus expects something | 6 shapes, 17 occurrences |

These numbers move with every change. Re-run the classifier rather than quoting them from here.

## Every surplus occurrence, classified

The classifier assigns each surplus occurrence to exactly one class and leaves none unassigned.

| Class                          |     Count | What it is                                                                                                                                                                                                     |
| ------------------------------ | --------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog-unresolved`           |     2,045 | `Invalid object name`, `The specified schema name … does not exist`, `Must declare the scalar variable`, and their siblings. Entirely an artifact of comparing without a catalog.                              |
| `syntax-recovery-position`     |       525 | The same defect reported at a different token, because the two parsers resynchronize differently after a failure. The fixture expects a diagnostic; both report one.                                           |
| `catalog-shape`                |       445 | Rules keyed on resolved metadata: duplicate columns, incompatible object kinds, dropped objects that do not exist. Also unreachable without a catalog.                                                         |
| `semantic-rule`                |       439 | Rules the corpus does not model at all: function-body restrictions, CTE recursion, duplicate variable declarations, argument counts, numeric precision limits, and the named-parameter rowset contracts below. |
| `syntax-wording-at-same-place` |        57 | Same range, different words.                                                                                                                                                                                   |
| `syntax-on-accepted-input`     |        55 | The honest remainder. Constructs this package rejects and the corpus accepts. Enumerated under open work.                                                                                                      |
| `engine-availability`          |         1 | A version/platform gate the corpus does not model.                                                                                                                                                             |
| **Total**                      | **3,567** | No occurrence is left unclassified.                                                                                                                                                                            |

Classifying the surplus is what found six diagnostics this package was reporting against valid
Transact-SQL: a computed column demanded a data type, `DATEPART` rejected its single-letter
abbreviations, `CREATE TYPE … FROM json/sysname/vector` was rejected, `APPROX_COUNT_DISTINCT` and
`CHECKSUM_AGG` were unknown routines, `FOR XML AUTO, ROOT('x')` was read as a row tag, and a comment
between `WITH` and `CHECK OPTION` broke the clause. Each is fixed and covered by a test.

## Deliberate divergences

### Named-parameter rowsets report the defect, not the parse state

`VECTOR_SEARCH` takes a fixed sequence of named arguments. The corpus reports a rejected argument as
the parse failure it caused; this package reports what is wrong with the call:

| Input                   | Corpus                                                   | This package                                                                                                    |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| arguments out of order  | `Incorrect syntax near 'SIMILAR_TO'.  Expecting COLUMN.` | `VECTOR_SEARCH parameters must appear in that order: TABLE, COLUMN, SIMILAR_TO, METRIC, TOP_N, L, M, START_ID.` |
| two-part `COLUMN` value | `Incorrect syntax near '.'.  Expecting ','.`             | `The VECTOR_SEARCH COLUMN parameter must be a one-part column name.`                                            |
| subquery argument       | `Incorrect syntax near '('.`                             | `A subquery is not allowed for the SIMILAR_TO parameter.`                                                       |

Every fixture in this family is reported at the same location; none is silent. This is the largest
single unmatched class, at 73 occurrences.

### Constructs newer than the corpus

The corpus predates several shipped forms and reports them as syntax errors. Matching it would mean
rejecting documented, supported syntax.

- Azure SQL Hyperscale cutover: `ALTER DATABASE … WITH MANUAL_CUTOVER`, `… PERFORM_CUTOVER`.
- The SQL Server 2022 `WINDOW` clause.
- `OPENJSON` written with a schema qualifier.
- `COMPUTE`, which this package still parses for older scripts.

### Corpus expectations that reject valid documented syntax

- `CREATE SERVER AUDIT a TO SECURITY_LOG WITH (…)` — documented and accepted here; the corpus expects
  three diagnostics, the first of which lists `SECURITY_LOG` among the words it expected.
- `CREATE SEMANTIC INDEX … ON myfilegroup` — accepted here, expected to fail at end of file.

### Names the reference loses during recovery

`DECLARE c Non_Existent_Option1 CURSOR …` is reported by the corpus as
`'' is not a recognized CURSOR option.` with an empty name. This package names the word. The code and
range agree; only the reference's empty spelling differs.

### One wording change, made on purpose

`Incorrect syntax near the keyword 'X'.` was replaced by `Incorrect syntax near 'X'.` for every
token. The corpus contains no keyword-form message, and one shape lets a reader match a message to a
token without knowing the reserved-word list. Five existing tests were updated with the change.

## Open work

These are gaps, not decisions. They are listed so a reader does not mistake this document for a
completion claim.

### Constructs this package still rejects

The `syntax-on-accepted-input` class: 55 occurrences, in descending size.

| Construct                                                                                        | Occurrences |
| ------------------------------------------------------------------------------------------------ | ----------: |
| A scalar function body written without `AS`: `CREATE FUNCTION f() RETURNS INT BEGIN … END`       |          25 |
| `BEGIN CONVERSATION a(5) b = 1`                                                                  |          14 |
| `SET x = 6000, y = .10` and similar in one fixture family                                        |           4 |
| `execute %%object (value = -60).method()`                                                        |           2 |
| A Mongolian vowel separator inside an identifier                                                 |           2 |
| `OPTION (PLAN PER VALUE(…))`                                                                     |           2 |
| Six single-occurrence shapes, including `EXECUTE @rc = @name1;5` and a column-less `PRIMARY KEY` |           6 |

The first was attempted twice. Making `AS` optional before a function body puts `BlockChunk` within
reach of states that also accept a data type's parenthesized arguments, and the block tokenizer then
claims them — `DECLARE @v varchar(50)` stops parsing. A guard keyed on whether `AS` is still
shiftable does not separate the two cases. Closing it needs a distinct token for an AS-less block,
gated lexically on `BEGIN`, mounted like `BlockChunk`; that is the shape of the fix, not a small one.

### Diagnostics the corpus expects that this package does not report

Six shapes, 17 occurrences, remain silent. Five are in the deliberate classes above: three Hyperscale
cutover shapes (9), the server audit target (5), and the semantic index filegroup (2). One is open:

- `select 1 DISABLE TRIGGER x ON y` (1) — SQL Server absorbs the word after a select list as a column
  alias, so `TRIGGER` is the error. This package reads `DISABLE TRIGGER` as a new statement. Fixing
  it means preferring the alias reading over starting a statement, which touches every
  contextual-keyword-led statement and is not a local change.

### Recovery cascades not reproduced

After a statement fails, the reference re-reads the remaining text and reports each construct the
statement can no longer hold. This package reproduces that tail where the shape is well determined —
a `WITH (` following the break, and the calls inside an argument list that has already failed — but
not where the reference's tail depends on which of its own parser states recovery reached. The
primary diagnostic, the one naming the actual mistake, is always reported.
