-- Check TSQL 90-specific column / table syntax

CREATE TABLE t0 (
	A31 as -A1 persisted, -- persisted
	A32 as -A1 persisted not null, -- persisted, null constraint
	A33 as -A1 persisted check (A33 < 10), -- persisted, check constraint
	A34 as -A1 persisted foreign key references t1(c1), -- persisted, foreign key
	A51 as A0 persisted constraint PK_KEY Primary key,	-- Check computed column, with constraints
    cz as -A1 persisted not null references t1(c1) check (1 > 1) -- multiple constraints on one column
)
on partitionScheme (someColumn);
GO
-- partitionScheme(column)
CREATE TABLE foo (id int NOT NULL) on partitionScheme (someColumn) Textimage_on [default]
GO

-- Referencing built-in types with sys
CREATE TABLE t1(
    c1 sys.int,
    c2 national sys.text,
    c3 national sys.Char varying,
    c4 sys.binARY varying,
    c5 [sys]."Char" varying,
    c6 sys.[xml](CONTENT dbo.xsd1))