-- Large-catalog fixture (Phase-3 12.2): PerfCatalog database with EXACTLY
-- 10,000 deterministic synthetic tables (t00000..t09999) for OE-at-scale.
-- SKIP-GUARDED: rebuilding 10k tables costs minutes, so the seed only runs
-- when the catalog is absent or has the wrong table count. Verify after:
--   SELECT COUNT(*) FROM PerfCatalog.sys.tables  => 10000

DECLARE @needsBuild BIT = 0;
IF DB_ID(N'PerfCatalog') IS NULL
    SET @needsBuild = 1;
ELSE IF (SELECT COUNT(*) FROM PerfCatalog.sys.tables) <> 10000
    SET @needsBuild = 1;

IF @needsBuild = 1
BEGIN
    IF DB_ID(N'PerfCatalog') IS NOT NULL
    BEGIN
        ALTER DATABASE PerfCatalog SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE PerfCatalog;
    END;
    EXEC (N'CREATE DATABASE PerfCatalog');

    DECLARE @i INT = 0;
    DECLARE @sql NVARCHAR(400);
    WHILE @i < 10000
    BEGIN
        SET @sql = N'CREATE TABLE PerfCatalog.dbo.'
                 + QUOTENAME(N't' + RIGHT(N'0000' + CAST(@i AS NVARCHAR(5)), 5))
                 + N' (Id INT NOT NULL PRIMARY KEY, Name NVARCHAR(64) NOT NULL, Value DECIMAL(18,4) NOT NULL);';
        EXEC (@sql);
        SET @i = @i + 1;
    END;
END;
