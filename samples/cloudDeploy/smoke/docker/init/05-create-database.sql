-- ---------------------------------------------------------------------------
--  Creates SmokeDb and enables the instance/database settings tSQLt requires:
--  CLR enabled, CLR strict security off, and the database TRUSTWORTHY ON.
--  Runs against master (see entrypoint.sh).
-- ---------------------------------------------------------------------------
IF DB_ID('SmokeDb') IS NULL
    CREATE DATABASE [SmokeDb];
GO

EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;
GO
EXEC sp_configure 'clr enabled', 1;
RECONFIGURE;
GO
-- SQL Server 2017+ blocks unsigned CLR assemblies unless strict security is
-- off. tSQLt ships an unsigned assembly, so disable it for this dev-only DB.
EXEC sp_configure 'clr strict security', 0;
RECONFIGURE;
GO

ALTER DATABASE [SmokeDb] SET TRUSTWORTHY ON;
GO
